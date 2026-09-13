-- 우리집 재무관리 v1.0 - Supabase schema
-- Run once in Supabase SQL Editor on a fresh project.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default '우리집',
  owner_id uuid not null references auth.users(id) on delete restrict,
  annual_saving_goal numeric(18,2) not null default 30000000 check (annual_saving_goal >= 0),
  monthly_investment_goal numeric(18,2) not null default 1500000 check (monthly_investment_goal >= 0),
  currency text not null default 'KRW',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  kind text not null check (kind in ('expense','income','investment')),
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, kind, name)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  txn_date date not null default current_date,
  txn_type text not null check (txn_type in ('expense','income','investment')),
  amount numeric(18,2) not null check (amount >= 0),
  category_name text not null,
  owner_label text not null default '공동' check (owner_label in ('공동','남편','아내')),
  payment_method text,
  memo text,
  entered_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  category_name text not null,
  monthly_limit numeric(18,2) not null check (monthly_limit >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, category_name)
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  kind text not null check (kind in ('asset','liability')),
  name text not null,
  amount numeric(18,2) not null default 0 check (amount >= 0),
  category text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_transactions_household_date
  on public.transactions (household_id, txn_date desc);
create index if not exists idx_transactions_household_type
  on public.transactions (household_id, txn_type);
create index if not exists idx_audit_logs_household_created
  on public.audit_logs (household_id, created_at desc);

create or replace function private.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.is_household_member(hid uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.household_members hm
    where hm.household_id = hid and hm.user_id = auth.uid()
  );
$$;

create or replace function private.is_household_owner(hid uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.households h
    where h.id = hid and h.owner_id = auth.uid()
  );
$$;

create or replace function private.bootstrap_household()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.household_members (household_id, user_id, display_name, role)
  values (new.id, new.owner_id, '남편', 'owner')
  on conflict (household_id, user_id) do nothing;

  insert into public.categories (household_id, kind, name, sort_order) values
    (new.id,'expense','식비',10),(new.id,'expense','생활비',20),
    (new.id,'expense','교통',30),(new.id,'expense','주거',40),
    (new.id,'expense','통신',50),(new.id,'expense','보험',60),
    (new.id,'expense','의료',70),(new.id,'expense','여가',80),
    (new.id,'expense','여행',90),(new.id,'expense','용돈',100),
    (new.id,'expense','가족행사',110),(new.id,'expense','기타',999),
    (new.id,'income','급여',10),(new.id,'income','상여',20),
    (new.id,'income','부수입',30),(new.id,'income','환급',40),
    (new.id,'income','기타',999),
    (new.id,'investment','ISA',10),(new.id,'investment','CMA',20),
    (new.id,'investment','적금',30),(new.id,'investment','연금',40),
    (new.id,'investment','국내주식',50),(new.id,'investment','해외주식',60),
    (new.id,'investment','기타',999)
  on conflict (household_id, kind, name) do nothing;

  insert into public.budgets (household_id, category_name, monthly_limit) values
    (new.id,'식비',600000),(new.id,'생활비',300000),
    (new.id,'교통',200000),(new.id,'여가',200000)
  on conflict (household_id, category_name) do nothing;

  return new;
end;
$$;

create or replace function private.audit_change()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare hid uuid; eid uuid; p jsonb;
begin
  if tg_op = 'DELETE' then
    hid := old.household_id; eid := old.id;
    p := jsonb_build_object('old', to_jsonb(old));
  elsif tg_op = 'INSERT' then
    hid := new.household_id; eid := new.id;
    p := jsonb_build_object('new', to_jsonb(new));
  else
    hid := new.household_id; eid := new.id;
    p := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
  end if;

  insert into public.audit_logs
    (household_id, actor_id, action, entity_type, entity_id, payload)
  values
    (hid, auth.uid(), tg_op, tg_table_name, eid, p);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_households_updated_at on public.households;
create trigger trg_households_updated_at before update on public.households
for each row execute function private.set_updated_at();

drop trigger if exists trg_transactions_updated_at on public.transactions;
create trigger trg_transactions_updated_at before update on public.transactions
for each row execute function private.set_updated_at();

drop trigger if exists trg_budgets_updated_at on public.budgets;
create trigger trg_budgets_updated_at before update on public.budgets
for each row execute function private.set_updated_at();

drop trigger if exists trg_accounts_updated_at on public.accounts;
create trigger trg_accounts_updated_at before update on public.accounts
for each row execute function private.set_updated_at();

drop trigger if exists trg_bootstrap_household on public.households;
create trigger trg_bootstrap_household after insert on public.households
for each row execute function private.bootstrap_household();

drop trigger if exists trg_audit_transactions on public.transactions;
create trigger trg_audit_transactions after insert or update or delete on public.transactions
for each row execute function private.audit_change();

drop trigger if exists trg_audit_budgets on public.budgets;
create trigger trg_audit_budgets after insert or update or delete on public.budgets
for each row execute function private.audit_change();

drop trigger if exists trg_audit_accounts on public.accounts;
create trigger trg_audit_accounts after insert or update or delete on public.accounts
for each row execute function private.audit_change();

drop trigger if exists trg_audit_categories on public.categories;
create trigger trg_audit_categories after insert or update or delete on public.categories
for each row execute function private.audit_change();

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.accounts enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "households_select_members" on public.households;
create policy "households_select_members" on public.households for select to authenticated
using (private.is_household_member(id) or owner_id = auth.uid());

drop policy if exists "households_insert_owner" on public.households;
create policy "households_insert_owner" on public.households for insert to authenticated
with check (owner_id = auth.uid());

drop policy if exists "households_update_members" on public.households;
create policy "households_update_members" on public.households for update to authenticated
using (private.is_household_member(id))
with check (private.is_household_member(id));

drop policy if exists "households_delete_owner" on public.households;
create policy "households_delete_owner" on public.households for delete to authenticated
using (owner_id = auth.uid());

drop policy if exists "members_select_same_household" on public.household_members;
create policy "members_select_same_household" on public.household_members for select to authenticated
using (private.is_household_member(household_id) or private.is_household_owner(household_id));

drop policy if exists "members_insert_owner_only" on public.household_members;
create policy "members_insert_owner_only" on public.household_members for insert to authenticated
with check (private.is_household_owner(household_id));

drop policy if exists "members_update_owner_only" on public.household_members;
create policy "members_update_owner_only" on public.household_members for update to authenticated
using (private.is_household_owner(household_id))
with check (private.is_household_owner(household_id));

drop policy if exists "members_delete_owner_only" on public.household_members;
create policy "members_delete_owner_only" on public.household_members for delete to authenticated
using (private.is_household_owner(household_id));

drop policy if exists "categories_member_access" on public.categories;
create policy "categories_member_access" on public.categories for all to authenticated
using (private.is_household_member(household_id))
with check (private.is_household_member(household_id));

drop policy if exists "transactions_member_access" on public.transactions;
create policy "transactions_member_access" on public.transactions for all to authenticated
using (private.is_household_member(household_id))
with check (private.is_household_member(household_id) and entered_by = auth.uid());

drop policy if exists "budgets_member_access" on public.budgets;
create policy "budgets_member_access" on public.budgets for all to authenticated
using (private.is_household_member(household_id))
with check (private.is_household_member(household_id));

drop policy if exists "accounts_member_access" on public.accounts;
create policy "accounts_member_access" on public.accounts for all to authenticated
using (private.is_household_member(household_id))
with check (private.is_household_member(household_id) and created_by = auth.uid());

drop policy if exists "audit_select_members" on public.audit_logs;
create policy "audit_select_members" on public.audit_logs for select to authenticated
using (private.is_household_member(household_id));

revoke all on public.households, public.household_members, public.categories,
  public.transactions, public.budgets, public.accounts, public.audit_logs from anon;

grant usage on schema public to authenticated;
grant usage on schema private to authenticated;

grant select, insert, update, delete
on public.households, public.household_members, public.categories,
   public.transactions, public.budgets, public.accounts
to authenticated;

grant select on public.audit_logs to authenticated;

revoke all on function private.is_household_member(uuid) from public;
revoke all on function private.is_household_owner(uuid) from public;
grant execute on function private.is_household_member(uuid) to authenticated;
grant execute on function private.is_household_owner(uuid) to authenticated;

revoke all on function private.set_updated_at() from public;
revoke all on function private.bootstrap_household() from public;
revoke all on function private.audit_change() from public;
