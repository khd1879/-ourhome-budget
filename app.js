/* 우리집 재무관리 v1.1 — 대화에 남은 DB 스키마를 기준으로 재구성.
 * index.html: Supabase JS v2 → supabase-config.js → app.js 순서로 로드.
 * 기존 localStorage는 읽기만 하며 삭제하지 않습니다.
 */
(() => {
  'use strict';
  const VERSION = '2.0';
  const labels = {expense:'지출', income:'수입', investment:'저축·투자', asset:'자산', liability:'부채'};
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const won = n => `${Number(n || 0).toLocaleString('ko-KR')}원`;
  const sum = rows => rows.reduce((a,r) => a + Number(r.amount),0);
  let db, root, user, house, data = {}, tab = 'home', month = today().slice(0,7), busy = false, syncing = false, generation = 0, pendingRefresh = null;
  const $ = s => root.querySelector(s);
  const btn = (action,title,id='') => `<button type="button" data-action="${action}" data-id="${esc(id)}" ${action==='repeat'&&title!=='다시 입력'?'data-user-text':''}>${esc(title)}</button>`;
  const field = (name,title,value='',type='text',extra='') => {
    const money=moneyFields.has(name)&&type==='number';
    return `<label>${esc(title)}<input name="${name}" type="${money?'text':type}" value="${esc(money?formatMoney(value):value)}" ${money?'data-money inputmode="decimal" autocomplete="off"':''} ${extra}></label>`;
  };
  const select = (name,title,options,value) => `<label>${esc(title)}<select name="${name}">${options.map(([v,t]) => `<option value="${esc(v)}" ${v===value?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
  const number = v => { v=String(v??'').replace(/,/g,'').trim(); if(!/^\d+(\.\d*)?$/.test(v)) throw Error('금액은 숫자로 입력해 주세요.'); if (String(v).trim()==='' || !Number.isFinite(Number(v)) || Number(v)<0) throw Error('금액은 0 이상의 숫자로 입력해 주세요.'); return Number(v); };
  const checked = async q => { const r = await q; if(r.error) throw r.error; return r.data; };
  function notice(message) { $('#notice').textContent = message; const d=$('#editor'); if(d?.open) { let p=d.querySelector('[role="status"]'); if(!p) {p=document.createElement('p');p.setAttribute('role','status');d.append(p);} p.textContent=message; } }
  function draw(content) { root.innerHTML = `<header><div><small>OUR HOME · v${VERSION}</small><h1>부부 공동 가계부</h1></div><div class="header-controls"><div class="languages" aria-label="Language"><button type="button" data-action="language" data-id="ko" aria-pressed="${appearance.language==='ko'}">🇰🇷 한국어</button><button type="button" data-action="language" data-id="ja" aria-pressed="${appearance.language==='ja'}">🇯🇵 日本語</button></div>${user?btn('logout','로그아웃'):''}</div></header><p id="notice" role="status" aria-live="polite"></p>${content}<dialog id="editor"></dialog>`; }
  async function run(fn) { if(busy) return; busy=true; root.setAttribute('aria-busy','true'); try { await fn(); } catch(e) { notice(`처리하지 못했습니다: ${e.message || e}`); } finally { busy=false; root.removeAttribute('aria-busy'); } }
  async function rows(table,hid) {
    let result=[];
    for(let start=0;;) { const page=await checked(db.from(table).select('*').eq('household_id',hid).order('id').range(start,start+499)); result.push(...page); if(!page.length) return result; start+=page.length; }
  }
  async function refresh(render=true) {
    if(pendingRefresh) { try { await pendingRefresh; } catch {} }
    const promise=fetchState(render); pendingRefresh=promise;
    try { await promise; } finally { if(pendingRefresh===promise) pendingRefresh=null; }
  }
  async function fetchState(render=true) {
    if(!house || syncing) return;
    syncing=true; const g=generation, hid=house.id;
    try {
      const names=['transactions','budgets','accounts','categories','household_members','audit_logs','recurring_expenses','recurring_payments','saving_goals'];
      const results=await Promise.all(names.map(n => rows(n,hid)));
      const h=await checked(db.from('households').select('*').eq('id',hid).single());
      if(g!==generation) return;
      data=Object.fromEntries(names.map((n,i)=>[n,results[i]])); house=h;
      if(render && !$('#editor')?.open && !root.querySelector('form') && !['search','filter-type','filter-owner'].includes(document.activeElement?.id)) dashboard();
      const status=$('#sync'); if(status) status.textContent=`동기화 ${new Date().toLocaleTimeString('ko-KR')}`;
    } finally { syncing=false; }
  }
  async function loadSession(session) {
    const g=++generation; user=session?.user; house=null; data={};
    if(!user) { login(); return; }
    draw('<p>우리집을 불러오는 중입니다…</p>');
    const membership=await checked(db.from('household_members').select('*').eq('user_id',user.id).order('created_at').limit(1));
    if(g!==generation) return;
    if(!membership.length) { onboarding(); return; }
    house=await checked(db.from('households').select('*').eq('id',membership[0].household_id).single());
    if(g!==generation) return;
    await refresh(false); if(g===generation) dashboard();
  }
  function login() { draw(`<section class="card auth"><h2>우리집 기록을 함께</h2><p>각자의 이메일로 로그인하면 같은 가계부를 사용합니다.</p><form data-form="auth">${field('email','이메일','','email','required autocomplete="email"')}${field('password','비밀번호','','password','required minlength="6" autocomplete="current-password"')}<button name="mode" value="login">로그인</button><button name="mode" value="signup">회원가입</button></form></section>`); }
  function onboarding() { draw(`<section class="card"><h2>처음 오셨나요?</h2><form data-form="create">${field('name','우리집 이름','우리집','text','required maxlength="80"')}<button>우리집 만들기 · 남편/관리자</button></form></section><section class="card"><h2>초대코드로 참여</h2><form data-form="join">${field('code','12자리 초대코드','','text','required minlength="12" maxlength="12" pattern="[A-Za-z0-9]{12}"')}${field('display','이름','아내','text','required maxlength="40"')}<button>참여하기</button></form></section>`); }
  function dashboard() {
    const tx=data.transactions||[], active=tx.filter(r=>!r.deleted_at), monthly=active.filter(r=>r.txn_date.startsWith(month));
    const totals=Object.fromEntries(['income','expense','investment'].map(k=>[k,sum(monthly.filter(r=>r.txn_type===k))]));
    let body='';
    if(tab==='home') {
      const annual=sum(active.filter(r=>r.txn_type==='investment'&&r.txn_date.startsWith(month.slice(0,4))));
      body=`<div class="grid">${[['수입',totals.income],['지출',totals.expense],['저축·투자',totals.investment],['잔여현금',totals.income-totals.expense-totals.investment]].map(([t,n])=>`<section class="card"><small>${t}</small><h2>${won(n)}</h2></section>`).join('')}</div><section class="card"><h2>연간 저축·투자 목표</h2><p>${won(annual)} / ${won(house.annual_saving_goal)}</p><progress max="${Number(house.annual_saving_goal)||1}" value="${annual}"></progress><p>월 투자 목표 ${won(house.monthly_investment_goal)} · 이번 달 ${won(totals.investment)}</p></section><h2>최근 거래</h2>${transactionList(monthly.slice().sort((a,b)=>b.txn_date.localeCompare(a.txn_date)).slice(0,10))}`;
    }
    if(tab==='transactions') body=`<h2>거래내역</h2>${transactionList(monthly.slice().sort((a,b)=>b.txn_date.localeCompare(a.txn_date)))}`;
    if(tab==='trash') { const trashed=tx.filter(r=>r.deleted_at); body=`<div class="trash-heading"><div><h2>휴지통</h2><p>${trashed.length}건 · 완전삭제한 거래는 복구할 수 없습니다.</p></div><div class="trash-tools">${trashed.length?btn('trash-restore-all','전체복구')+btn('trash-delete-all','전체삭제'):''}</div></div>${transactionList(trashed,true)}`; }
    if(tab==='budgets') body=`<h2>카테고리별 월 예산</h2>${btn('budget','예산 추가')}<div class="grid">${data.budgets.filter(r=>r.active).map(r=>{const used=sum(monthly.filter(t=>t.txn_type==='expense'&&t.category_name===r.category_name));return `<section class="card"><h3>${userText(r.category_name)}</h3><p>${won(used)} / ${won(r.monthly_limit)}</p><p>${used>r.monthly_limit?'초과 '+won(used-r.monthly_limit):'남음 '+won(r.monthly_limit-used)}</p>${btn('budget','수정',r.id)}${btn('hide-budget','삭제',r.id)}</section>`;}).join('')}</div>`;
    if(tab==='accounts') { const assets=sum(data.accounts.filter(r=>r.kind==='asset')), debt=sum(data.accounts.filter(r=>r.kind==='liability')); body=`<section class="card"><h2>순자산 ${won(assets-debt)}</h2><p>자산 ${won(assets)} · 부채 ${won(debt)}</p></section>${btn('account','자산·부채 추가')}<div class="grid">${data.accounts.map(r=>`<section class="card"><small>${labels[r.kind]} · ${esc(r.category)}</small><h3>${userText(r.name)}</h3><p>${won(r.amount)}</p>${btn('account','수정',r.id)}${btn('delete-account','삭제',r.id)}</section>`).join('')}</div>`; }
    if(tab==='settings') body=`<section class="card"><h2>${userText(house.name)}</h2><p>초대코드 <strong>${esc(house.invite_code)}</strong></p>${btn('copy','초대코드 복사')}<p>${data.household_members.map(m=>`${userText(m.display_name)} (${m.role==='owner'?'관리자':'구성원'})`).join(' · ')}</p>${btn('goals','목표 수정')}</section><section class="card"><h2>백업 및 가져오기</h2>${btn('json','서버 전체 JSON 백업')}${btn('csv','전체 거래 CSV 백업')}${btn('local','v1.0 로컬 데이터 가져오기')}<label>JSON 백업 가져오기<input type="file" id="import-file" accept=".json,application/json"></label><p>가져오기는 거래·예산·자산·카테고리를 추가합니다. 고정비 설정과 납부 연결의 전체 복원은 지원하지 않습니다. 적용 전 내용을 확인할 수 있습니다.</p></section><section class="card"><h2>카테고리</h2>${btn('category','카테고리 추가')}<p>${data.categories.filter(c=>c.active).map(c=>`${userText(c.name)} (${labels[c.kind]})`).join(' · ')}</p></section><section class="card"><h2>최근 변경이력</h2>${data.audit_logs.slice().sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,50).map(r=>`<p>${esc(new Date(r.created_at).toLocaleString('ko-KR'))} · ${userText(data.household_members.find(m=>m.user_id===r.actor_id)?.display_name||'구성원')} · ${esc(r.entity_type)} ${esc(r.action)}</p>`).join('')||'<p>변경이력이 없습니다.</p>'}</section>`;
    if(tab==='settings') body=themeSettings()+body;
    if(tab==='saving') body=savingGoalsView();
    if(tab==='analysis') body=analysisView(active);
    if(tab==='fixed') body=fixedView();
    if(tab==='transactions') body=searchView(monthly);
    if(tab==='home') body=quickView(active)+body;
    draw(`<div class="toolbar"><label>조회 월 <input id="month" type="month" value="${month}"></label><span id="sync">약 5초 간격 동기화</span>${btn('refresh','새로고침')}${btn('transaction','+ 거래 입력')}</div><nav>${[['home','요약'],['transactions','거래'],['saving','목표 저축'],['analysis','분석'],['fixed','고정비'],['budgets','예산'],['accounts','자산'],['trash','휴지통'],['settings','설정']].map(([k,t])=>`<button data-action="tab" data-id="${k}" aria-current="${tab===k?'page':'false'}">${t}</button>`).join('')}</nav>${body}`);
  }
  function transactionList(list,trash=false) { return list.map(r=>`<article class="card row"><div><small>${esc(r.txn_date)} · ${labels[r.txn_type]} · ${esc(r.owner_label)}</small><h3>${userText(r.category_name)} · ${won(r.amount)}</h3><p>${userText(r.memo)} ${userText(r.payment_method)}</p>${r.original_currency==='JPY'?`<small>¥${Number(r.original_amount).toLocaleString('ja-JP')} · 1엔 = ${esc(r.fx_rate)}원 · ${esc(r.fx_date||'직접 입력')}${r.fx_source==='manual_amount'?' · 실제 결제액 적용':''}</small><br>`:''}<small>입력: ${userText(data.household_members.find(m=>m.user_id===r.entered_by)?.display_name||'구성원')}</small></div><div>${trash?btn('restore','복구',r.id)+btn('trash-delete-one','완전삭제',r.id):btn('repeat','다시 입력',r.id)+btn('transaction','수정',r.id)+btn('trash','휴지통으로',r.id)}</div></article>`).join('')||'<section class="card">기록이 없습니다.</section>'; }
  function categoryNames(type, current='') {
    const names=new Set();
    (data.categories||[]).filter(c=>c.kind===type&&c.active).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).forEach(c=>names.add(c.name.trim()));
    (data.transactions||[]).filter(t=>t.txn_type===type).forEach(t=>{if(t.category_name?.trim())names.add(t.category_name.trim());});
    if(current) names.add(current);
    return [...names].filter(Boolean);
  }
  function categoryPicker(type,current='') {
    const options=categoryNames(type,current);
    return `<div id="category-picker">${select('category_name','카테고리',[['','카테고리 선택'],...options.map(n=>[n,n]),['__new_category__','＋ 새 카테고리 입력']],current)}<label id="new-category-label" hidden>새 카테고리 이름<input name="new_category" maxlength="100" disabled placeholder="예: 반려동물"></label></div>`.replace('<select name="category_name">','<select name="category_name" required>');
  }
  function changeCategory(event) {
    const form=event.target.closest('form[data-form="transaction"]'); if(!form) return;
    if(event.target.name==='txn_type') {
      const previous=form.elements.category_name.value;
      const keep=categoryNames(event.target.value).includes(previous)?previous:'';
      form.querySelector('#category-picker').outerHTML=categoryPicker(event.target.value,keep);
    }
    if(event.target.name==='category_name') {
      const adding=event.target.value==='__new_category__';
      const input=form.elements.new_category;
      input.disabled=!adding; input.required=adding; form.querySelector('#new-category-label').hidden=!adding;
      if(adding) input.focus();
    }
    if(form.elements.saving_goal_id){form.elements.saving_goal_id.disabled=form.elements.txn_type.value==='income';if(form.elements.saving_goal_id.disabled)form.elements.saving_goal_id.value='';}
    form.elements.category_name.required=true;
  }
  function editor(kind,id) {
    let r={}, body='';
    if(kind==='transaction') { r=data.transactions.find(x=>x.id===id)||{}; body=field('txn_date','날짜',r.txn_date||today(),'date','required')+select('txn_type','종류',Object.entries(labels).slice(0,3),r.txn_type||'expense')+fxFields(r)+field('amount','원화 반영 금액',r.amount??'','number','required min="0" step="0.01"')+categoryPicker(r.txn_type||'expense',r.category_name||'')+select('owner_label','사용 구분',['공동','남편','아내'].map(x=>[x,x]),r.owner_label||'공동')+field('payment_method','결제수단',r.payment_method)+field('memo','메모',r.memo)+savingGoalPicker(r); }
    if(kind==='budget') { r=data.budgets.find(x=>x.id===id)||{}; body=field('category_name','카테고리',r.category_name,'text','required')+field('monthly_limit','월 예산',r.monthly_limit??'','number','required min="0" step="0.01"'); }
    if(kind==='account') { r=data.accounts.find(x=>x.id===id)||{}; body=select('kind','구분',[['asset','자산'],['liability','부채']],r.kind||'asset')+field('name','이름',r.name,'text','required')+field('amount','금액',r.amount??'','number','required min="0" step="0.01"')+field('category','분류',r.category); }
    if(kind==='goals') body=field('name','우리집 이름',house.name,'text','required')+field('annual_saving_goal','연간 저축·투자 목표',house.annual_saving_goal,'number','required min="0"')+field('monthly_investment_goal','월 투자 목표',house.monthly_investment_goal,'number','required min="0"');
    if(kind==='category') body=select('kind','종류',Object.entries(labels).slice(0,3),'expense')+field('name','카테고리 이름','','text','required');
    const d=$('#editor'); d.innerHTML=`<h2>${kind==='goals'?'목표 설정':'기록 입력'}</h2><form data-form="${kind}" data-id="${esc(id||'')}">${body}<button>저장</button>${btn('close','취소')}</form><p>저장 실패 시 상단 안내를 확인해 주세요.</p>`; d.showModal(); if(kind==='transaction') configureFx(d.querySelector('form'),r);
  }
  async function update(table,id,patch) { const r=await checked(db.from(table).update(patch).eq('id',id).eq('household_id',house.id).select('id')); if(!r.length) throw Error('기록을 찾을 수 없거나 수정 권한이 없습니다. 새로고침해 주세요.'); }
  function download(name,text,type) { const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement('a'); a.href=url; a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000); }
  async function backup() { await refresh(false); return {format:'ourhome-budget',version:VERSION,exported_at:new Date().toISOString(),household:house,...data}; }
  function csvCell(v) { let s=String(v??''); if(/^[=+\-@\t\r]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; }
  async function submit(form,mode) {
    const f=Object.fromEntries(new FormData(form)), kind=form.dataset.form, id=form.dataset.id;
    let categoryWarning='';
    if(kind==='saving-goal') { f.target_amount=number(f.target_amount); if(f.target_amount<=0)throw Error('목표 금액은 0보다 커야 합니다.'); f.name=f.name.trim();if(!f.name)throw Error('목표 이름을 입력해 주세요.');if(id)await update('saving_goals',id,f);else await checked(db.from('saving_goals').insert({...f,household_id:house.id,created_by:user.id}));$('#editor').close();await refresh(false);dashboard();return; }

    if(kind==='transaction') { fxPayload(f,form); f.saving_goal_id=f.txn_type==='income'?null:(f.saving_goal_id||null); if(f.category_name==='__new_category__') f.category_name=f.new_category; delete f.new_category; f.category_name=String(f.category_name||'').trim(); if(!f.category_name || f.category_name.length>100) throw Error('카테고리를 1~100자로 입력해 주세요.'); }
    if(kind==='fixed') { f.amount=number(f.amount); f.due_day=Number(f.due_day); if(!Number.isInteger(f.due_day)||f.due_day<1||f.due_day>31) throw Error('납부일은 1~31일입니다.'); if(id) await update('recurring_expenses',id,f); else await checked(db.from('recurring_expenses').insert({...f,household_id:house.id,created_by:user.id})); $('#editor').close(); await refresh(false); dashboard(); return; }
    if(kind==='auth') { const args={email:f.email.trim(),password:f.password}; if(mode==='signup') { await checked(db.auth.signUp({...args,options:{emailRedirectTo:location.origin+location.pathname}})); notice('회원가입을 요청했습니다. 이메일 인증 후 로그인해 주세요.'); } else { const result=await checked(db.auth.signInWithPassword(args)); await loadSession(result.session); } return; }
    if(kind==='create') { await checked(db.from('households').insert({name:f.name.trim(),owner_id:user.id})); await loadSession({user}); return; }
    if(kind==='join') { await checked(db.rpc('join_household_by_code',{p_invite_code:f.code.trim().toUpperCase(),p_display_name:f.display.trim()})); await loadSession({user}); return; }
    if(kind==='goals') { await checked(db.from('households').update({name:f.name.trim(),annual_saving_goal:number(f.annual_saving_goal),monthly_investment_goal:number(f.monthly_investment_goal)}).eq('id',house.id).select('id').single()); }
    else {
      const table={transaction:'transactions',budget:'budgets',account:'accounts',category:'categories'}[kind];
      if(!table) return;
      for(const key of ['amount','monthly_limit']) if(key in f) f[key]=number(f[key]);
      for(const key of ['name','category_name']) if(key in f && !f[key].trim()) throw Error('이름을 입력해 주세요.');
      if(id) await update(table,id,f);
      else { f.household_id=house.id; if(kind==='transaction') f.entered_by=user.id; if(kind==='account') f.created_by=user.id; await checked(db.from(table).insert(f)); }
    }
    if(kind==='transaction') { try { await checked(db.from('categories').upsert({household_id:house.id,kind:f.txn_type,name:f.category_name,active:true},{onConflict:'household_id,kind,name'})); } catch(e) { categoryWarning=' 거래는 저장됐지만 카테고리 등록에 실패했습니다. 기록이 남아 있는 동안 목록에 표시됩니다.'; } }
    $('#editor').close(); await refresh(false); dashboard(); notice('저장했습니다.'+categoryWarning);
  }
  // v1.0의 알려지지 않은 필드는 임의로 버리지 않고 미리보기에서 차단합니다.
  function normalizeImport(raw) {
    const source=raw.data||raw.state||raw;
    if(!source || typeof source!=='object' || !Array.isArray(source.transactions)) throw Error('transactions 배열이 있는 가계부 JSON이 필요합니다.');
    const types={'지출':'expense','수입':'income','저축':'investment','투자':'investment','저축·투자':'investment'};
    const result={transactions:[],accounts:[],budgets:[],categories:[]};
    for(const [i,r] of source.transactions.entries()) {
      const date=r.txn_date??r.date, type=types[r.txn_type??r.type]||r.txn_type||r.type, category=r.category_name??r.category;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'') || !['income','expense','investment'].includes(type) || typeof category!=='string' || !category.trim()) throw Error(`거래 ${i+1}번의 날짜·종류·카테고리 형식을 확인할 수 없습니다.`);
      const owner=r.owner_label??r.owner??'공동'; if(!['공동','남편','아내'].includes(owner)) throw Error(`거래 ${i+1}번의 사용 구분을 확인해 주세요.`);
      const deleted=r.deleted_at??r.deletedAt??(r.deleted?new Date().toISOString():null);
      if(deleted && !Number.isFinite(Date.parse(deleted))) throw Error('삭제일 형식을 확인해 주세요.');
      const fx=r.original_currency==='JPY'?{original_currency:'JPY',original_amount:number(r.original_amount),fx_rate:number(r.fx_rate),fx_date:r.fx_date||null,fx_source:r.fx_source||'manual'}:{};
      result.transactions.push({...fx,txn_date:date,txn_type:type,amount:number(r.amount),category_name:category,owner_label:owner,payment_method:r.payment_method??r.paymentMethod??r.payment??'',memo:r.memo??r.note??'',deleted_at:deleted});
    }
    if(source.accounts && !Array.isArray(source.accounts)) throw Error('accounts는 배열이어야 합니다.');
    for(const r of source.accounts||[]) { if(!['asset','liability'].includes(r.kind??r.type)||!r.name) throw Error('자산·부채 형식을 확인해 주세요.'); result.accounts.push({kind:r.kind??r.type,name:r.name,amount:number(r.amount),category:r.category??''}); }
    if(source.assets||source.liabilities) throw Error('별도 assets/liabilities 형식은 자동 변환하지 않습니다. 원본 JSON에 맞춘 변환이 필요합니다.');
    const budgets=Array.isArray(source.budgets)?source.budgets:Object.entries(source.budgets||{}).map(([category,amount])=>({category,amount}));
    for(const r of budgets) { const category=r.category_name??r.category; if(!category) throw Error('예산 카테고리를 확인해 주세요.'); result.budgets.push({category_name:category,monthly_limit:number(r.monthly_limit??r.limit??r.amount),active:r.active!==false}); }
    if(source.categories && !Array.isArray(source.categories)) throw Error('categories 형식은 별도 변환이 필요합니다.');
    for(const r of source.categories||[]) { if(!r.name||!['income','expense','investment'].includes(r.kind)) throw Error('카테고리 형식을 확인해 주세요.'); result.categories.push({kind:r.kind,name:r.name,active:r.active!==false,sort_order:Number(r.sort_order)||0}); }
    return result;
  }
  async function importData(raw) {
    const payload=normalizeImport(raw);
    const description=Object.entries(payload).map(([k,v])=>`${k}: ${v.length}건`).join('\n');
    if(!confirm(`다음 기록을 우리집에 추가합니다.\n${description}\n동일한 기록은 건너뜁니다. 목표·구성원·변경이력은 덮어쓰지 않습니다.\n계속할까요?`)) return;
    await refresh(false);
    let added=0;
    // Deterministic fingerprints make repeated imports safe, including retries after partial success.
    for(const [table,list] of Object.entries(payload)) {
      const fingerprint=r=>JSON.stringify(Object.keys(list[0]||{}).map(k=>[k,['amount','monthly_limit','sort_order'].includes(k)?Number(r[k]):(r[k]??'')]));
      const counts=new Map(); for(const r of data[table]) { const key=fingerprint(r); counts.set(key,(counts.get(key)||0)+1); }
      const seen=new Map();
      for(const r of list) {
        const key=fingerprint(r), occurrence=(seen.get(key)||0)+1; seen.set(key,occurrence);
        if(occurrence<=(counts.get(key)||0)) continue;
        if(table==='budgets' && data.budgets.some(x=>x.category_name===r.category_name)) continue;
        if(table==='categories' && data.categories.some(x=>x.kind===r.kind&&x.name===r.name)) continue;
        const record={...r,household_id:house.id}; if(table==='transactions') record.entered_by=user.id; if(table==='accounts') record.created_by=user.id;
        try { await checked(db.from(table).insert(record)); added++; } catch(e) { throw Error(`${added}건까지 추가했습니다. 다시 실행하면 동일한 기록은 건너뜁니다. ${e.message}`); }
      }
    }
    await refresh(false); dashboard(); notice(`${added}건을 가져왔습니다. 원본 로컬 데이터는 그대로 보관했습니다.`);
  }
  async function localImport() {
    const candidates=[];
    for(let i=0;i<localStorage.length;i++) { const key=localStorage.key(i); if(key.startsWith('sb-')) continue; try { const raw=JSON.parse(localStorage.getItem(key)); if(Array.isArray((raw?.data||raw?.state||raw)?.transactions)) candidates.push({key,raw}); } catch {} }
    if(!candidates.length) throw Error('이 주소의 브라우저에서 v1.0 데이터를 찾지 못했습니다. 기존 기기에서 JSON 백업 후 가져와 주세요.');
    const choice=candidates.length===1?0:Number(prompt(candidates.map((r,i)=>`${i+1}. ${r.key}`).join('\n')+'\n가져올 번호를 입력하세요.'))-1;
    if(!candidates[choice]) return; await importData(candidates[choice].raw);
  }
  async function trashOperation(mode,id) {
    const ids=data.transactions.filter(r=>r.deleted_at&&(!id||r.id===id)).map(r=>r.id);
    if(!ids.length) { notice('처리할 휴지통 거래가 없습니다.'); return; }
    const deleting=mode==='delete';
    const message=deleting
      ? `휴지통 거래 ${ids.length}건을 완전히 삭제할까요?\n삭제한 거래는 복구할 수 없고 배우자의 가계부에서도 사라집니다.\n고정비의 납부 연결도 삭제되어 다시 납부 기록을 할 수 있습니다.`
      : `휴지통 거래 ${ids.length}건을 모두 복구할까요?\n복구한 거래는 부부의 거래내역과 월별 합계에 다시 반영됩니다.`;
    if(!confirm(message)) return;
    const count=await checked(db.rpc('manage_household_trash',{p_household_id:house.id,p_transaction_ids:ids,p_action:mode}));
    await refresh(false); dashboard();
    notice(`${count}건을 ${deleting?'완전삭제':'복구'}했습니다. 다른 기기에서 이미 처리한 거래는 제외됩니다.`);
  }
  async function action(name,id) {
    if(name==='language'){appearance.language=id==='ja'?'ja':'ko';saveAppearance();localizeUI();return;}
    if(name==='theme-preset'||name==='theme-reset'){const selected=name==='theme-reset'?'ivory':id;if(!palettes[selected])return;appearance={...appearance,preset:selected,background:palettes[selected][0],button:palettes[selected][1]};saveAppearance();applyAppearance();dashboard();return;}

    if(name==='saving-goal-new'||name==='saving-goal-edit'){savingGoalEditor(id);return;}
    if(name==='saving-goal-add'||name==='saving-goal-spend'){goalTransaction(id,name==='saving-goal-add'?'investment':'expense');return;}
    if(name==='saving-goal-archive'||name==='saving-goal-unarchive'){if(name==='saving-goal-archive'&&!confirm('목표를 보관할까요? 연결 거래는 유지됩니다.'))return;await update('saving_goals',id,{active:name==='saving-goal-unarchive'});await refresh(false);dashboard();return;}

    if(name==='fx-refresh') { await fetchFx($('#editor form')); return; }
    if(name==='trash-delete-one') { await trashOperation('delete',id); return; }
    if(name==='trash-delete-all') { await trashOperation('delete'); return; }
    if(name==='trash-restore-all') { await trashOperation('restore'); return; }

    if(name==='repeat') { repeatTransaction(id); return; }
    if(name==='fixed-new') { fixedEditor(); return; }
    if(name==='fixed-edit') { fixedEditor(id); return; }
    if(name==='fixed-stop' && confirm('이 고정비를 중지할까요? 이전 납부 기록은 남습니다.')) { await update('recurring_expenses',id,{active:false}); await refresh(false); dashboard(); return; }
    if(name==='fixed-pay') { if(!confirm(month+' 납부를 지출로 기록할까요?')) return; await checked(db.rpc('pay_recurring_expense',{p_expense_id:id,p_month:month+'-01'})); await refresh(false); dashboard(); notice('납부를 기록했습니다.'); return; }
    if(name==='close') { $('#editor').close(); return; }
    if(name==='logout') { await checked(db.auth.signOut()); await loadSession(null); return; }
    if(name==='tab') { tab=id; dashboard(); return; }
    if(['transaction','budget','account','goals','category'].includes(name)) { editor(name,id); return; }
    if(name==='refresh') { await refresh(false); dashboard(); }
    if(name==='copy') { await navigator.clipboard.writeText(house.invite_code); notice('초대코드를 복사했습니다.'); }
    if(name==='trash' && confirm('이 거래를 휴지통으로 옮길까요?')) { await update('transactions',id,{deleted_at:new Date().toISOString()}); await refresh(false); dashboard(); }
    if(name==='restore') { await update('transactions',id,{deleted_at:null}); await refresh(false); dashboard(); }
    if(name==='hide-budget' && confirm('이 예산을 삭제할까요?')) { await update('budgets',id,{active:false}); await refresh(false); dashboard(); }
    if(name==='delete-account' && confirm('이 자산·부채 기록을 삭제할까요?')) { await checked(db.from('accounts').delete().eq('id',id).eq('household_id',house.id)); await refresh(false); dashboard(); }
    if(name==='json') download(`ourhome-v2.0-${today()}.json`,JSON.stringify(await backup(),null,2),'application/json');
    if(name==='csv') { await refresh(false); const columns=['txn_date','txn_type','amount','category_name','owner_label','payment_method','memo','entered_by','deleted_at','original_currency','original_amount','fx_rate','fx_date','fx_source']; download(`ourhome-${today()}.csv`,'\uFEFF'+[columns,...data.transactions.map(r=>columns.map(k=>r[k]))].map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8'); }
    if(name==='local') await localImport();
  }
  let searchText='', filterType='', filterOwner='';
  function previousMonth(value, offset=-1) { const [y,m]=value.split('-').map(Number), d=new Date(y,m-1+offset,1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
  function monthlySummary(rows,value) { const list=rows.filter(r=>!r.deleted_at&&r.txn_date.startsWith(value)); return Object.fromEntries(['income','expense','investment'].map(k=>[k,sum(list.filter(r=>r.txn_type===k))])); }
  function changeLabel(current,prior) { if(prior===0) return current===0?'지난달과 동일':'지난달 기록 없음 · '+won(current); const difference=current-prior; return `${difference>0?'+':''}${won(difference)} (${difference>0?'+':''}${(difference/prior*100).toFixed(1)}%)`; }
  function analysisView(active) {
    const now=monthlySummary(active,month), before=monthlySummary(active,previousMonth(month));
    const categories=new Map(); active.filter(r=>r.txn_type==='expense'&&r.txn_date.startsWith(month)).forEach(r=>categories.set(r.category_name,(categories.get(r.category_name)||0)+Number(r.amount)));
    const history=Array.from({length:6},(_,i)=>{const key=previousMonth(month,i-5);return {key,...monthlySummary(active,key)};});
    const max=Math.max(1,...history.flatMap(r=>[r.income,r.expense,r.investment]));
    return `<div class="section-title"><small>MONTHLY INSIGHTS</small><h2>우리집의 한 달, 숫자로 보기</h2><p>전월 전체와 비교합니다. 이번 달이 진행 중이면 비교 금액도 달라질 수 있어요.</p></div><div class="grid">${['income','expense','investment'].map(k=>`<section class="card"><small>${labels[k]}</small><h2>${won(now[k])}</h2><p>${changeLabel(now[k],before[k])}</p></section>`).join('')}</div><section class="card"><h2>최근 6개월 흐름</h2><p class="legend">● 수입 <span>● 지출</span> <em>● 저축·투자</em></p><div class="chart">${history.map(r=>`<div class="chart-col"><div class="bars">${['income','expense','investment'].map(k=>`<div class="bar ${k}" style="height:${r[k]/max*150}px" title="${r.key} ${labels[k]} ${won(r[k])}" aria-label="${r.key} ${labels[k]} ${won(r[k])}"></div>`).join('')}</div><small>${r.key.slice(2)}</small></div>`).join('')}</div><details><summary>월별 금액 보기</summary>${history.map(r=>`<p>${r.key} · 수입 ${won(r.income)} / 지출 ${won(r.expense)} / 투자 ${won(r.investment)}</p>`).join('')}</details></section><section class="card"><h2>어디에 가장 많이 썼을까?</h2>${[...categories].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="category-row"><div><strong>${userText(k)}</strong><span>${won(v)} · ${(v/Math.max(now.expense,1)*100).toFixed(1)}%</span></div><progress value="${v}" max="${Math.max(now.expense,1)}"></progress></div>`).join('')||'<p>이번 달 지출을 입력하면 분석이 나타납니다.</p>'}</section>`;
  }
  function quickView(active) { const unique=new Map(); active.slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).forEach(r=>{const k=r.txn_type+'|'+r.category_name+'|'+r.amount;if(!unique.has(k))unique.set(k,r);}); return `<section class="card quick"><small>ONE MORE, EASILY</small><h2>자주 쓰는 기록, 한 번 더</h2><p>최근 거래를 불러오고 금액만 바꿔 저장하세요.</p>${[...unique.values()].slice(0,5).map(r=>btn('repeat',`${r.category_name} · ${won(r.amount)}`,r.id)).join('')||btn('transaction','첫 거래 입력하기')}</section>`; }
  function repeatTransaction(id) { editor('transaction',id); const form=$('#editor form'); form.dataset.id=''; form.elements.txn_date.value=today(); $('#editor h2').textContent='거래 다시 입력'; if(form.elements.original_currency.value==='JPY') toggleFx(form,true); }
  function searchView(monthly) { return `<div class="section-title"><small>YOUR RECORDS</small><h2>거래 찾기</h2></div><section class="card filters"><label>검색<input id="search" placeholder="카테고리, 메모, 결제수단" value="${esc(searchText)}"></label><label>종류<select id="filter-type">${[['','전체'],...Object.entries(labels).slice(0,3)].map(([k,v])=>`<option value="${k}" ${k===filterType?'selected':''}>${v}</option>`).join('')}</select></label><label>사용 구분<select id="filter-owner">${['','공동','남편','아내'].map(v=>`<option ${v===filterOwner?'selected':''} value="${v}">${v||'전체'}</option>`).join('')}</select></label></section><div id="search-results">${filteredList(monthly)}</div>`; }
  function filteredList(list) { const q=searchText.toLocaleLowerCase(); const rows=list.filter(r=>(!filterType||r.txn_type===filterType)&&(!filterOwner||r.owner_label===filterOwner)&&[r.memo,r.category_name,r.payment_method].join(' ').toLocaleLowerCase().includes(q)).sort((a,b)=>b.txn_date.localeCompare(a.txn_date)); return `<p>${rows.length}건 · 조회 월 ${esc(month)}</p>`+transactionList(rows); }
  function renderSearchResults() { const target=$('#search-results'); if(target) target.innerHTML=filteredList(data.transactions.filter(r=>!r.deleted_at&&r.txn_date.startsWith(month))); }
  function dueDate(r) {const [y,m]=month.split('-').map(Number);return `${month}-${String(Math.min(r.due_day,new Date(y,m,0).getDate())).padStart(2,'0')}`;}
  function paymentFor(r) { return data.recurring_payments.find(p=>p.expense_id===r.id&&p.month===month+'-01'&&data.transactions.some(t=>t.id===p.transaction_id&&!t.deleted_at)); }
  function fixedView() {
    const list=data.recurring_expenses.filter(r=>r.active).sort((a,b)=>a.due_day-b.due_day), unpaid=list.filter(r=>!paymentFor(r));
    return `${fixedOverview(list)}<div class="grid">${list.map(r=>{const paid=paymentFor(r);return `<section class="card"><small>${userText(r.category_name)} · 매월 ${r.due_day}일</small><h2>${userText(r.name)}</h2><h3>${won(r.amount)}</h3><p class="${paid?'paid':'pending'}">${paid?'납부 완료':dueDate(r)<today()?'납부일 지남 · 확인 필요':'납부 예정 '+dueDate(r)}</p>${paid?'':btn('fixed-pay','납부 기록',r.id)}${btn('fixed-edit','수정',r.id)}${btn('fixed-stop','중지',r.id)}</section>`;}).join('')||'<section class="card">통신비, 보험료, 월세부터 등록해 보세요.</section>'}</div>`;
  }
  function fixedEditor(id='') { const r=data.recurring_expenses.find(r=>r.id===id)||{}; const d=$('#editor'); d.innerHTML=`<h2>고정비 ${id?'수정':'등록'}</h2><form data-form="fixed" data-id="${esc(id)}">${field('name','이름',r.name||'','text','required maxlength="100"')}${field('amount','월 금액',r.amount??'','number','required min="0" step="0.01"')}${field('category_name','카테고리',r.category_name||'통신','text','required')}${field('due_day','납부일 (29~31일은 짧은 달에 말일 적용)',r.due_day||1,'number','required min="1" max="31" step="1"')}${select('owner_label','사용 구분',['공동','남편','아내'].map(x=>[x,x]),r.owner_label||'공동')}${field('payment_method','결제수단',r.payment_method||'')}<button>저장</button>${btn('close','취소')}</form>`;d.showModal(); }
  const THEME=`
    #ourhome-v11 .trash-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
    #ourhome-v11 .trash-tools button{font-size:12px;padding:7px 10px;border:1px solid #dedbe5;background:#f0eef5;color:#595269;border-radius:8px}
    #ourhome-v11 button[data-action="trash-delete-all"],#ourhome-v11 button[data-action="trash-delete-one"]{background:#f7eceb;color:#9c4944}

    body{background:#f7f6f2;color:#25283e!important}
    #ourhome-v11{max-width:1100px;padding:40px 24px 80px;letter-spacing:-.025em;color:#25283e}
    #ourhome-v11 header{padding:12px 0 28px;border-bottom:1px solid #e5e2dc;margin-bottom:20px}
    #ourhome-v11 header small,.section-title>small,#ourhome-v11 .quick>small{letter-spacing:.16em;font-size:10px;color:#8b7c6a}
    #ourhome-v11 h1{font-size:29px;letter-spacing:-.055em;font-weight:750}
    #ourhome-v11 h2{font-size:23px;letter-spacing:-.045em}#ourhome-v11 p{color:#777887;font-size:14px;line-height:1.7}
    #ourhome-v11 .card{border:1px solid #eeece7;background:#fff;border-radius:22px;padding:26px;box-shadow:0 6px 24px #25283e03}
    #ourhome-v11 button{background:#343b58;color:#fff;border-radius:12px;font-size:13px;font-weight:600;padding:12px 16px;transition:background .15s}
    #ourhome-v11 button:hover{background:#565f83}#ourhome-v11 nav{border-bottom:1px solid #e5e2dc;padding:4px 0 16px;gap:7px}
    #ourhome-v11 nav button{background:transparent;color:#797987}#ourhome-v11 nav button[aria-current=page]{background:#343b58;color:white;outline:none}
    #ourhome-v11 input,#ourhome-v11 select{border:1px solid #e4e2e9;border-radius:12px;background:#fcfcfd;color:#343b58;font-size:15px}
    #ourhome-v11 button:focus-visible,#ourhome-v11 input:focus-visible,#ourhome-v11 select:focus-visible{outline:3px solid #b6ade1;outline-offset:2px}
    #ourhome-v11 .toolbar{font-size:12px;color:#92919b}#ourhome-v11 .toolbar label{font-size:12px}
    #ourhome-v11 .quick{background:linear-gradient(120deg,#eeebf8,#f8f6ef);border:0}
    #ourhome-v11 .quick button{background:#fff;color:#4b466e;box-shadow:0 2px 6px #4b466e08}
    #ourhome-v11 progress{height:7px;accent-color:#9c8ed0}#ourhome-v11 small{color:#8b8997}
    .section-title{margin:32px 0 22px}.section-title h2{margin:10px 0}
    .chart{display:flex;justify-content:space-around;gap:8px;margin:22px 0}.chart-col{text-align:center;flex:1}.bars{height:160px;display:flex;align-items:flex-end;justify-content:center;gap:5px;margin-bottom:12px}.bar{width:18%;max-width:23px;border-radius:5px 5px 0 0;min-height:1px;background:#343b58}.bar.expense{background:#c3b4db}.bar.investment{background:#d5c5a5}.legend{color:#343b58!important}.legend span{color:#9a80b8}.legend em{color:#a59067;font-style:normal}
    .category-row{margin:22px 0}.category-row>div{display:flex;justify-content:space-between;font-size:14px;margin-bottom:8px}.category-row span{color:#888493}
    #ourhome-v11 .filters{display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px}.paid{color:#548271!important}.pending{color:#aa8060!important}
    #ourhome-v11 dialog{color:#343b58;box-shadow:0 20px 100px #28253733}#ourhome-v11 dialog::backdrop{background:#27263c77;backdrop-filter:blur(4px)}
    @media(max-width:600px){#ourhome-v11{padding:20px 14px 50px}#ourhome-v11 h1{font-size:25px}#ourhome-v11 .card{padding:20px}#ourhome-v11 nav{gap:2px}#ourhome-v11 nav button{padding:10px;font-size:12px}#ourhome-v11 .filters{grid-template-columns:1fr 1fr}#ourhome-v11 .filters label:first-child{grid-column:1/-1}.category-row>div{gap:12px}#ourhome-v11 .grid{grid-template-columns:1fr}}
  `;

  const moneyFields=new Set(['amount','monthly_limit','annual_saving_goal','monthly_investment_goal','original_amount','fx_rate','target_amount']);
  function formatMoney(value) { const raw=String(value??'').replace(/,/g,''); if(!/^\d*(\.\d*)?$/.test(raw)) return String(value??''); const [whole,decimal]=raw.split('.'); return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(decimal===undefined?'':'.'+decimal); }
  function moneyInput(event) {
    const input=event.target; if(!input.matches('input[data-money]')||event.isComposing) return;
    const offset=input.selectionStart??input.value.length, logical=input.value.slice(0,offset).replace(/,/g,'').length;
    input.value=formatMoney(input.value); let count=0,pos=0;
    while(pos<input.value.length&&count<logical) { if(input.value[pos]!==',')count++;pos++; }
    input.setSelectionRange(pos,pos);
    const form=input.closest('form[data-form="transaction"]');
    if(form&&['original_amount','fx_rate'].includes(input.name)) { if(input.name==='fx_rate'){form.dataset.fxRequest=String((Number(form.dataset.fxRequest)||0)+1);form.dataset.fxSource='manual';form.dataset.fxDate='';} calculateFx(form); }
  }
  function fxFields(r) { return select('original_currency','통화',[['KRW','원화 KRW'],['JPY','엔화 JPY']],r.original_currency||'KRW')+`<section id="fx-box" hidden>${field('original_amount','엔화 금액',r.original_amount??'','number','min="0" step="0.01"')}${field('fx_rate','적용 환율 (1엔당 원)',r.fx_rate??'','number','min="0" step="any"')}${btn('fx-refresh','최신 환율 조회')}<p id="fx-status" role="status"></p>${select('fx_mode','원화 반영 방식',[['auto','환율로 자동 계산'],['manual','실제 원화 결제금액 직접 입력']],r.fx_source==='manual_amount'?'manual':'auto')}</section>`; }
  function configureFx(form,r={}) {
    form.dataset.fxDate=r.fx_date||'';form.dataset.fxSource=r.fx_source||'';
    toggleFx(form,false);
  }
  function toggleFx(form,reload=true) {
    const yen=form.elements.original_currency.value==='JPY';
    form.querySelector('#fx-box').hidden=!yen;
    for(const name of ['original_amount','fx_rate','fx_mode']) form.elements[name].disabled=!yen;
    form.elements.original_amount.required=yen;form.elements.fx_rate.required=yen;
    form.elements.amount.readOnly=yen&&form.elements.fx_mode.value==='auto';
    if(yen) { showFxStatus(form); if(reload) {form.elements.fx_rate.value='';form.dataset.fxDate='';form.dataset.fxSource='';form.elements.amount.value='';fetchFx(form);} }
  }
  function showFxStatus(form,message='') { form.querySelector('#fx-status').textContent=message||`${form.dataset.fxDate?'환율 기준일 '+form.dataset.fxDate:'직접 입력 환율'} · ${form.dataset.fxSource?.startsWith('manual')?'직접 조정':'Frankfurter 일별 참고환율'} · 저장한 금액은 이후 환율이 바뀌어도 유지됩니다.`; }
  async function fetchFx(form) {
    const token=String((Number(form.dataset.fxRequest)||0)+1); form.dataset.fxRequest=token;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    showFxStatus(form,'최신 제공 환율을 조회하고 있습니다…');
    try {
      const response=await fetch('https://api.frankfurter.dev/v2/rate/JPY/KRW',{signal:controller.signal,cache:'no-store'});
      if(!response.ok) throw Error('환율 서비스 응답 오류');
      const result=await response.json();
      if(!Number.isFinite(Number(result.rate))||Number(result.rate)<=0||!/^\d{4}-\d{2}-\d{2}$/.test(result.date)) throw Error('환율 응답 형식 오류');
      if(!form.isConnected||form.dataset.fxRequest!==token||form.elements.original_currency.value!=='JPY') return;
      form.elements.fx_rate.value=formatMoney(result.rate);form.dataset.fxDate=result.date;form.dataset.fxSource='frankfurter';
      calculateFx(form);showFxStatus(form);
    } catch(e) { if(form.isConnected&&form.dataset.fxRequest===token) showFxStatus(form,'환율 조회 실패. 다시 조회하거나 1엔당 원화 환율을 직접 입력하세요. 기존 환율이 있으면 그대로 유지됩니다.'); }
    finally { clearTimeout(timer); }
  }
  function calculateFx(form) {
    if(form.elements.original_currency.value!=='JPY'||form.elements.fx_mode.value!=='auto')return;
    try {const yen=number(form.elements.original_amount.value), rate=number(form.elements.fx_rate.value);if(rate<=0)throw Error();form.elements.amount.value=formatMoney(Math.round(yen*rate));}
    catch {form.elements.amount.value='';}
  }
  function fxPayload(f,form) {
    if(f.original_currency==='JPY') {
      f.original_amount=number(f.original_amount);f.fx_rate=number(f.fx_rate);
      if(f.fx_rate<=0)throw Error('환율을 조회하거나 0보다 큰 환율을 입력해 주세요.');
      if(f.fx_mode==='auto')f.amount=Math.round(f.original_amount*f.fx_rate);
      f.fx_date=form.dataset.fxDate||null;
      f.fx_source=f.fx_mode==='manual'?'manual_amount':(form.dataset.fxSource||'manual');
    } else {f.original_currency='KRW';f.original_amount=null;f.fx_rate=null;f.fx_date=null;f.fx_source=null;}
    delete f.fx_mode;
  }

  function goalStats(goal, transactions=data.transactions, date=today()) {
    const linked=transactions.filter(t=>t.saving_goal_id===goal.id&&!t.deleted_at);
    const saved=sum(linked.filter(t=>t.txn_type==='investment'))-sum(linked.filter(t=>t.txn_type==='expense'));
    const remaining=Math.max(0,Number(goal.target_amount)-saved);
    const [y,m]=date.split('-').map(Number),[dy,dm]=goal.target_date.split('-').map(Number);
    const months=goal.target_date<date?0:Math.max(1,(dy-y)*12+dm-m+1);
    return {saved,remaining,months,percent:Math.max(0,saved/Number(goal.target_amount)*100),monthly:months?Math.ceil(remaining/months):null};
  }
  function savingGoalsView() {
    const goals=data.saving_goals.filter(g=>g.active).sort((a,b)=>a.target_date.localeCompare(b.target_date));
    return `${goalOverview(goals)}<div class="grid">${goals.map(g=>{const s=goalStats(g);return `<section class="card"><small>목표일 ${esc(g.target_date)}</small><h2>${userText(g.name)}</h2><h3>${won(s.saved)} <small>/ ${won(g.target_amount)}</small></h3><progress aria-label="${esc(g.name)} 달성률" max="100" value="${Math.min(100,s.percent)}"></progress><p>${s.percent.toFixed(1)}% 달성 · ${s.remaining===0?'목표 달성!':'남은 금액 '+won(s.remaining)}</p><p>${s.remaining===0?'차곡차곡 모았어요.':s.months?`월 ${won(s.monthly)}씩 · 이번 달 포함 ${s.months}개월`:'목표일이 지났어요. 기한을 다시 설정해 주세요.'}</p>${s.saved<0?'<p>연결한 지출이 저축보다 많습니다. 거래 연결을 확인하세요.</p>':''}${btn('saving-goal-add','저축 입력',g.id)}${btn('saving-goal-spend','사용 입력',g.id)}${btn('saving-goal-edit','목표 수정',g.id)}${btn('saving-goal-archive','보관',g.id)}</section>`;}).join('')||'<section class="card">여행비, 비상금, 단기 적금 목표를 만들어 보세요.</section>'}</div><section class="card"><h2>목표 한눈에 보기</h2><div style="overflow-x:auto"><table style="width:100%;min-width:600px;text-align:left;border-collapse:collapse"><thead><tr>${['목표','목표금액','모은 금액','달성률','기한'].map(t=>`<th style="padding:12px">${t}</th>`).join('')}</tr></thead><tbody>${goals.map(g=>{const s=goalStats(g);return `<tr>${[userText(g.name),won(g.target_amount),won(s.saved),s.percent.toFixed(1)+'%',esc(g.target_date)].map(v=>`<td style="padding:12px;border-top:1px solid #eee">${v}</td>`).join('')}</tr>`;}).join('')}</tbody></table></div><p>진행률은 전체 기간의 연결 거래 기준입니다. 월 필요액은 이번 달부터 목표 월까지 균등하게 모으는 가정입니다.</p></section><section class="card"><h2>보관한 목표</h2>${data.saving_goals.filter(g=>!g.active).map(g=>`<p>${userText(g.name)} ${btn('saving-goal-unarchive','다시 표시',g.id)}</p>`).join('')||'<p>보관한 목표가 없습니다.</p>'}</section>`;
  }
  function savingGoalEditor(id='') {
    const g=data.saving_goals.find(x=>x.id===id)||{}; const d=$('#editor');
    d.innerHTML=`<h2>${id?'목표 수정':'새 저축 목표'}</h2><form data-form="saving-goal" data-id="${esc(id)}">${field('name','목표 이름',g.name||'','text','required maxlength="80" placeholder="예: 일본 여행"')}${field('target_amount','목표 금액 (원)',g.target_amount??'','number','required')}${field('target_date','목표일',g.target_date||today(),'date','required')}<button>저장</button>${btn('close','취소')}</form>`; d.showModal();
  }
  function savingGoalPicker(r) { return select('saving_goal_id','목표 연결 (선택)',[['','연결 안 함'],...data.saving_goals.filter(g=>g.active||g.id===r.saving_goal_id).map(g=>[g.id,g.name+(g.active?'':' (보관)')])],r.saving_goal_id||'')+'<small>저축·투자는 목표에 더하고, 지출은 목표에서 차감합니다. 수입에는 연결하지 않습니다.</small>'; }
  function goalTransaction(id,type) {
    editor('transaction');const f=$('#editor form');f.elements.txn_type.value=type;
    changeCategory({target:f.elements.txn_type});f.elements.saving_goal_id.value=id;
  }

  const preferenceKey='ourhome-appearance-v1';
  let appearance={language:'ko',preset:'ivory',background:'#f7f6f2',button:'#343b58'};
  try { const saved=JSON.parse(localStorage.getItem(preferenceKey)||'null'); if(saved) appearance={...appearance,...saved}; } catch {}
  if(!['ko','ja'].includes(appearance.language))appearance.language='ko';
  const palettes={ivory:['#f7f6f2','#343b58'],lavender:['#f3effa','#69548c'],navy:['#edf1f7','#243a60'],dark:['#181b25','#b7a4e3']};
  const validColor=x=>/^#[0-9a-f]{6}$/i.test(x);
  function luminance(hex) { const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4); return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722; }
  function contrastText(color) { const l=luminance(color);return (l+.05)/.05>=1.05/(l+.05)?'#000000':'#ffffff'; }
  function saveAppearance() { try {localStorage.setItem(preferenceKey,JSON.stringify(appearance));}catch{notice('이 기기에서 설정 저장을 사용할 수 없습니다. 현재 화면에만 적용됩니다.');} }
  function applyAppearance() {
    if(!validColor(appearance.background))appearance.background='#f7f6f2';if(!validColor(appearance.button))appearance.button='#343b58';
    const dark=luminance(appearance.background)<.18;
    let style=document.getElementById('appearance-style');if(!style){style=document.createElement('style');style.id='appearance-style';document.head.append(style);}
    style.textContent=`:root{--page:${appearance.background};--button:${appearance.button};--button-text:${contrastText(appearance.button)};--ink:${dark?'#f2f1f6':'#292b3b'};--muted:${dark?'#c4c2cf':'#686676'};--surface:${dark?'#242735':'#ffffff'};--line:${dark?'#45485b':'#e5e2eb'};--soft:${dark?'#303447':'#f0eef6'}}
      body{background:var(--page)!important}#ourhome-v11{color:var(--ink)!important}#ourhome-v11 .card,#ourhome-v11 dialog{background:var(--surface)!important;color:var(--ink)!important;border-color:var(--line)!important}
      #ourhome-v11 p,#ourhome-v11 small{color:var(--muted)}#ourhome-v11 button{background:var(--button);color:var(--button-text)}#ourhome-v11 button:hover{filter:brightness(.94)}#ourhome-v11 nav button{background:transparent;color:var(--ink)}#ourhome-v11 nav button[aria-current=page]{background:var(--button);color:var(--button-text)}
      #ourhome-v11 input,#ourhome-v11 select{background:var(--surface);color:var(--ink);border-color:var(--line)}#ourhome-v11 .quick{background:var(--soft)!important}#ourhome-v11 .quick button{background:var(--surface);color:var(--ink)}#ourhome-v11 header,#ourhome-v11 nav{border-color:var(--line)}
      #ourhome-v11 .hero{padding:30px;border-radius:24px;background:var(--soft);margin:24px 0}#ourhome-v11 .hero-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}#ourhome-v11 .hero h2{font-size:27px;margin:10px 0}#ourhome-v11 .hero-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0}#ourhome-v11 .hero-stat{background:var(--surface);padding:18px;border-radius:16px}#ourhome-v11 .hero-stat strong{display:block;margin-top:9px;font-size:23px;overflow-wrap:anywhere}
      #ourhome-v11 details.help{margin-top:18px;font-size:13px}#ourhome-v11 details.help summary{cursor:pointer;color:var(--muted)}#ourhome-v11 .hero progress{height:10px}#ourhome-v11 .header-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}#ourhome-v11 .languages{display:flex;gap:3px}#ourhome-v11 .languages button{font-size:12px;padding:8px;background:var(--surface);color:var(--ink);border:1px solid var(--line)}#ourhome-v11 .languages button[aria-pressed=true]{outline:2px solid var(--button);outline-offset:-2px}
      #ourhome-v11 .theme-options{display:flex;flex-wrap:wrap;gap:8px}#ourhome-v11 .theme-options button{background:var(--surface);color:var(--ink);border:1px solid var(--line)}#ourhome-v11 .swatch{display:inline-block;width:14px;height:14px;border-radius:50%;margin-right:6px;border:1px solid #999;vertical-align:middle}#ourhome-v11 .color-controls{display:flex;gap:22px;flex-wrap:wrap}#ourhome-v11 input[type=color]{width:80px;height:44px;padding:4px}#ourhome-v11 .theme-options button[aria-pressed=true]{outline:2px solid var(--button)}
      @media(max-width:600px){#ourhome-v11 .hero{padding:20px}#ourhome-v11 .hero-stats{grid-template-columns:1fr;margin:18px 0}#ourhome-v11 .hero-stat{display:flex;align-items:center;justify-content:space-between;gap:12px}#ourhome-v11 .hero-stat strong{margin:0;font-size:21px}#ourhome-v11 .hero h2{font-size:24px}}
    `;
  }
  function themeSettings() {return `<section class="card"><h2>화면 테마</h2><p>언어와 색상은 이 기기에만 저장됩니다.</p><div class="theme-options">${Object.entries(palettes).map(([id,colors])=>`<button type="button" data-action="theme-preset" data-id="${id}" aria-pressed="${appearance.preset===id}"><i class="swatch" style="background:${colors[1]}"></i>${{ivory:'아이보리',lavender:'라벤더',navy:'네이비',dark:'다크'}[id]}</button>`).join('')}</div><div class="color-controls"><label>배경색<input type="color" id="theme-background" value="${appearance.background}"></label><label>버튼색<input type="color" id="theme-button" value="${appearance.button}"></label></div><p>버튼의 글자색은 읽기 편하도록 자동 조정됩니다.</p>${btn('theme-reset','기본 테마로 복원')}</section>`;}
  function summaryStat(label,value) {return `<div class="hero-stat"><small>${label}</small><strong>${won(value)}</strong></div>`;}
  function goalOverview(goals) {
    const target=goals.reduce((a,g)=>a+Number(g.target_amount),0), saved=goals.reduce((a,g)=>a+goalStats(g).saved,0);
    const remaining=goals.reduce((a,g)=>a+goalStats(g).remaining,0),rate=target?Math.max(0,saved/target*100):0;
    return `<section class="hero"><div class="hero-head"><div><small>OUR NEXT CHAPTER</small><h2>우리의 다음 목표를 위해</h2><p>작은 저축을 모아, 함께 원하는 내일로.</p></div>${btn('saving-goal-new','＋ 목표 만들기')}</div><div class="hero-stats">${summaryStat('전체 목표금액',target)}${summaryStat('지금까지 모은 금액',saved)}${summaryStat('목표별 남은 금액',remaining)}</div><p>전체 달성률 <strong>${rate.toFixed(1)}%</strong></p><progress aria-label="전체 달성률" max="100" value="${Math.min(100,rate)}"></progress><details class="help"><summary>ⓘ 사용 안내</summary><p>활성 목표의 전체 기간 거래를 합산합니다. 저축·투자는 더하고 연결 지출은 차감하며, 휴지통 거래는 제외합니다.</p><p>남은 금액은 목표별 부족액의 합입니다. 한 목표의 초과 저축은 다른 목표의 부족액을 줄이지 않습니다.</p><p>기존 거래를 수정해서 목표에 연결할 수 있습니다. 같은 돈을 다시 입력하지 마세요.</p></details></section>`;
  }
  function fixedOverview(list) {
    const unpaid=list.filter(r=>!paymentFor(r)), paid=list.filter(r=>paymentFor(r));
    const completed=paid.reduce((a,r)=>{const p=paymentFor(r);return a+Number(data.transactions.find(t=>t.id===p.transaction_id)?.amount||0);},0);
    return `<section class="hero"><div class="hero-head"><div><small>MONTHLY ROUTINE</small><h2>이번 달 고정비, 한눈에</h2><p>${esc(month)} · 납부 완료 ${paid.length} / ${list.length}</p></div>${btn('fixed-new','＋ 고정비 등록')}</div><div class="hero-stats">${summaryStat('월 예정액',sum(list))}${summaryStat('납부 완료액',completed)}${summaryStat('남은 예정액',sum(unpaid))}</div><p>납부 진행률 ${list.length?Math.round(paid.length/list.length*100):0}%</p><progress aria-label="납부 진행률" max="${list.length||1}" value="${paid.length}"></progress><details class="help"><summary>ⓘ 사용 안내</summary><p>실제로 납부한 뒤 ‘납부 기록’을 누르면 지출에 한 번만 반영됩니다. 자동 출금 기능은 아닙니다.</p><p>예정액은 현재 등록 금액, 완료액은 연결된 실제 거래금액입니다. 금액을 수정했다면 두 값의 합계가 다를 수 있습니다.</p><p>29~31일이 없는 달에는 말일로 기록합니다. 휴지통에 있는 납부 거래는 미납부로 표시됩니다.</p></details></section>`;
  }

  const JA = Object.fromEntries(`
부부 공동 가계부|ふたりの家計簿
로그아웃|ログアウト
로그인|ログイン
회원가입|新規登録
우리집 기록을 함께|家計の記録を一緒に
각자의 이메일로 로그인하면 같은 가계부를 사용합니다.|それぞれのメールアドレスでログインすると、同じ家計簿を使えます。
이메일|メールアドレス
비밀번호|パスワード
처음 오셨나요?|はじめての方へ
우리집 이름|家計簿の名前
우리집 만들기|家計簿を作成
남편/관리자|夫／管理者
초대코드로 참여|招待コードで参加
12자리 초대코드|12桁の招待コード
참여하기|参加する
연결 중입니다…|接続しています…
우리집을 불러오는 중입니다…|家計簿を読み込んでいます…
조회 월|表示月
약 5초 간격 동기화|約5秒ごとに同期
새로고침|更新
거래 입력|取引を入力
목표 저축|目的別貯金
고정비|固定費
휴지통|ゴミ箱
설정|設定
요약|概要
분석|分析
거래|取引
예산|予算
자산|資産
부채|負債
순자산|純資産
저축·투자|貯蓄・投資
지출|支出
수입|収入
잔여현금|残りの現金
연간 저축·투자 목표|年間の貯蓄・投資目標
월 투자 목표|毎月の投資目標
이번 달|今月
최근 거래|最近の取引
거래내역|取引履歴
기록이 없습니다.|記録はありません。
복구|復元
완전삭제|完全削除
전체삭제|すべて削除
전체복구|すべて復元
완전삭제한 거래는 복구할 수 없습니다.|完全削除した取引は復元できません。
휴지통으로|ゴミ箱へ
다시 입력|もう一度入力
수정|編集
입력:|入力者：
공동|共有
남편|夫
아내|妻
카테고리별 월 예산|カテゴリ別の月予算
예산 추가|予算を追加
초과|超過
남음|残り
삭제|削除
자산·부채 추가|資産・負債を追加
초대코드 복사|招待コードをコピー
초대코드|招待コード
관리자|管理者
구성원|メンバー
목표 수정|目標を編集
백업 및 가져오기|バックアップと取り込み
서버 전체 JSON 백업|サーバー全体のJSONバックアップ
전체 거래 CSV 백업|全取引のCSVバックアップ
v1.0 로컬 데이터 가져오기|v1.0のローカルデータを取り込む
JSON 백업 가져오기|JSONバックアップを取り込む
가져오기는 거래·예산·자산·카테고리를 추가합니다. 고정비 설정과 납부 연결의 전체 복원은 지원하지 않습니다. 적용 전 내용을 확인할 수 있습니다.|取り込みでは取引・予算・資産・カテゴリを追加します。固定費設定と支払リンクの完全復元には対応していません。適用前に内容を確認できます。
카테고리 추가|カテゴリを追加
카테고리|カテゴリ
최근 변경이력|最近の変更履歴
변경이력이 없습니다.|変更履歴はありません。
날짜|日付
종류|種類
금액|金額
카테고리 선택|カテゴリを選択
새 카테고리 입력|新しいカテゴリを入力
새 카테고리 이름|新しいカテゴリ名
예: 반려동물|例：ペット
사용 구분|使用者
결제수단|支払方法
메모|メモ
이름|名前
월 예산|月予算
구분|区分
분류|分類
목표 설정|目標設定
기록 입력|記録を入力
저장 실패 시 상단 안내를 확인해 주세요.|保存に失敗した場合は、上の案内をご確認ください。
저장|保存
취소|キャンセル
목표 이름|目標名
예: 일본 여행|例：日本旅行
목표 금액 (원)|目標金額（ウォン）
목표일|目標日
새 저축 목표|新しい貯金目標
목표 만들기|目標を作成
목표 연결 (선택)|目標にリンク（任意）
연결 안 함|リンクしない
저축·투자는 목표에 더하고, 지출은 목표에서 차감합니다. 수입에는 연결하지 않습니다.|貯蓄・投資は目標に加算し、支出は差し引きます。収入にはリンクしません。
보관한 목표|保管中の目標
보관한 목표가 없습니다.|保管中の目標はありません。
다시 표시|再表示
보관|保管
저축 입력|貯金を入力
사용 입력|使用額を入力
목표 달성!|目標達成！
남은 금액|残りの金額
차곡차곡 모았어요.|こつこつ貯まりました。
목표일이 지났어요. 기한을 다시 설정해 주세요.|目標日を過ぎました。期限を見直しましょう。
연결한 지출이 저축보다 많습니다. 거래 연결을 확인하세요.|リンクした支出が貯蓄を上回っています。取引のリンクを確認してください。
여행비, 비상금, 단기 적금 목표를 만들어 보세요.|旅行費、緊急資金、短期積立の目標を作りましょう。
목표 한눈에 보기|目標一覧
목표금액|目標金額
모은 금액|貯めた金額
달성률|達成率
기한|期限
목표|目標
진행률은 전체 기간의 연결 거래 기준입니다. 월 필요액은 이번 달부터 목표 월까지 균등하게 모으는 가정입니다.|進捗は全期間のリンク済み取引に基づきます。月々の必要額は今月から目標月まで均等に貯める想定です。
우리의 다음 목표를 위해|ふたりの次の目標へ
작은 저축을 모아, 함께 원하는 내일로.|小さな積み重ねで、ふたりの望む明日へ。
전체 목표금액|目標金額の合計
지금까지 모은 금액|これまでに貯めた金額
목표별 남은 금액|目標別の不足額の合計
전체 달성률|全体の達成率
사용 안내|使い方
활성 목표의 전체 기간 거래를 합산합니다. 저축·투자는 더하고 연결 지출은 차감하며, 휴지통 거래는 제외합니다.|表示中の目標に紐づく全期間の取引を集計します。貯蓄・投資は加算し、支出は減算、ゴミ箱の取引は除外します。
남은 금액은 목표별 부족액의 합입니다. 한 목표의 초과 저축은 다른 목표의 부족액을 줄이지 않습니다.|残額は各目標の不足額の合計です。ある目標の超過分は、別の目標の不足額から差し引きません。
기존 거래를 수정해서 목표에 연결할 수 있습니다. 같은 돈을 다시 입력하지 마세요.|既存の取引を編集して目標にリンクできます。同じ金額を重複入力しないでください。
이번 달 고정비, 한눈에|今月の固定費をひと目で
월 예정액|月の予定額
납부 완료액|支払済み額
남은 예정액|残りの予定額
납부 진행률|支払の進捗
납부 완료|支払済み
실제로 납부한 뒤 ‘납부 기록’을 누르면 지출에 한 번만 반영됩니다. 자동 출금 기능은 아닙니다.|実際の支払後に「支払を記録」を押すと支出に一度だけ反映されます。自動引落し機能ではありません。
예정액은 현재 등록 금액, 완료액은 연결된 실제 거래금액입니다. 금액을 수정했다면 두 값의 합계가 다를 수 있습니다.|予定額は現在の登録額、支払済み額は実際の取引額です。金額を編集すると合計が一致しない場合があります。
29~31일이 없는 달에는 말일로 기록합니다. 휴지통에 있는 납부 거래는 미납부로 표시됩니다.|29〜31日がない月は月末で記録します。支払取引がゴミ箱にある場合は未払いと表示します。
납부일 지남 · 확인 필요|支払日を経過・要確認
납부 예정|支払予定
납부 기록|支払を記録
중지|停止
통신비, 보험료, 월세부터 등록해 보세요.|通信費、保険料、家賃から登録しましょう。
등록|登録
월 금액|毎月の金額
납부일 (29~31일은 짧은 달에 말일 적용)|支払日（29〜31日がない月は月末）
화면 테마|画面テーマ
언어와 색상은 이 기기에만 저장됩니다.|言語と色はこの端末にのみ保存されます。
아이보리|アイボリー
라벤더|ラベンダー
네이비|ネイビー
다크|ダーク
배경색|背景色
버튼색|ボタンの色
버튼의 글자색은 읽기 편하도록 자동 조정됩니다.|ボタンの文字色は読みやすい色に自動調整されます。
기본 테마로 복원|標準テーマに戻す
이 기기에서 설정 저장을 사용할 수 없습니다. 현재 화면에만 적용됩니다.|この端末では設定を保存できません。現在の画面にのみ適用されます。
우리집의 한 달, 숫자로 보기|わが家の1か月を数字で
전월 전체와 비교합니다. 이번 달이 진행 중이면 비교 금액도 달라질 수 있어요.|前月全体との比較です。今月が途中の場合、比較額も変わります。
최근 6개월 흐름|直近6か月の推移
월별 금액 보기|月別の金額を見る
어디에 가장 많이 썼을까?|何に一番使った？
이번 달 지출을 입력하면 분석이 나타납니다.|今月の支出を入力すると分析が表示されます。
지난달과 동일|前月と同じ
지난달 기록 없음|前月の記録なし
자주 쓰는 기록, 한 번 더|よく使う記録を、もう一度
최근 거래를 불러오고 금액만 바꿔 저장하세요.|最近の取引を呼び出し、金額を変えて保存できます。
첫 거래 입력하기|最初の取引を入力
거래 다시 입력|取引をもう一度入力
거래 찾기|取引を検索
검색|検索
카테고리, 메모, 결제수단|カテゴリ、メモ、支払方法
전체|すべて
통화|通貨
원화 KRW|ウォン KRW
엔화 JPY|日本円 JPY
엔화 금액|円の金額
적용 환율 (1엔당 원)|適用レート（1円あたりのウォン）
최신 환율 조회|最新レートを取得
원화 반영 방식|ウォンへの反映方法
환율로 자동 계산|レートで自動計算
실제 원화 결제금액 직접 입력|実際のウォン決済額を入力
원화 반영 금액|反映するウォン金額
환율 기준일|レート基準日
직접 입력 환율|手入力レート
직접 조정|手動調整
Frankfurter 일별 참고환율|Frankfurterの日次参考レート
저장한 금액은 이후 환율이 바뀌어도 유지됩니다.|保存した金額は、その後のレート変更でも変わりません。
최신 제공 환율을 조회하고 있습니다…|最新の提供レートを取得しています…
환율 조회 실패. 다시 조회하거나 1엔당 원화 환율을 직접 입력하세요. 기존 환율이 있으면 그대로 유지됩니다.|レート取得に失敗しました。再取得するか、1円あたりのウォンレートを入力してください。既存レートは維持されます。
실제 결제액 적용|実際の決済額を適用
직접 입력|手入力
저장했습니다.|保存しました。
초대코드를 복사했습니다.|招待コードをコピーしました。
납부를 기록했습니다.|支払を記録しました。
회원가입을 요청했습니다. 이메일 인증 후 로그인해 주세요.|登録をリクエストしました。メール認証後にログインしてください。
처리하지 못했습니다:|処理できませんでした：
동기화 실패:|同期に失敗しました：
연결 후 다시 시도합니다.|接続後に再試行します。
금액은 숫자로 입력해 주세요.|金額は数字で入力してください。
금액은 0 이상의 숫자로 입력해 주세요.|金額は0以上の数値で入力してください。
카테고리를 1~100자로 입력해 주세요.|カテゴリを1〜100文字で入力してください。
이름을 입력해 주세요.|名前を入力してください。
목표 이름을 입력해 주세요.|目標名を入力してください。
목표 금액은 0보다 커야 합니다.|目標金額は0より大きくしてください。
납부일은 1~31일입니다.|支払日は1〜31日です。
환율을 조회하거나 0보다 큰 환율을 입력해 주세요.|レートを取得するか、0より大きいレートを入力してください。
기록을 찾을 수 없거나 수정 권한이 없습니다. 새로고침해 주세요.|記録が見つからないか、編集権限がありません。更新してください。
이 거래를 휴지통으로 옮길까요?|この取引をゴミ箱に移しますか？
이 예산을 삭제할까요?|この予算を削除しますか？
이 자산·부채 기록을 삭제할까요?|この資産・負債の記録を削除しますか？
목표를 보관할까요? 연결 거래는 유지됩니다.|目標を保管しますか？リンクした取引は維持されます。
이 고정비를 중지할까요? 이전 납부 기록은 남습니다.|この固定費を停止しますか？過去の支払記録は残ります。
납부를 지출로 기록할까요?|支払を支出として記録しますか？
처리할 휴지통 거래가 없습니다.|処理するゴミ箱の取引はありません。
건을 완전히 삭제할까요?|件を完全削除しますか？
삭제한 거래는 복구할 수 없고 배우자의 가계부에서도 사라집니다.|削除した取引は復元できず、パートナーの家計簿からも消えます。
고정비의 납부 연결도 삭제되어 다시 납부 기록을 할 수 있습니다.|固定費の支払リンクも削除され、再度支払を記録できるようになります。
건을 모두 복구할까요?|件をすべて復元しますか？
복구한 거래는 부부의 거래내역과 월별 합계에 다시 반영됩니다.|復元した取引は、ふたりの取引履歴と月別合計に再び反映されます。
했습니다. 다른 기기에서 이미 처리한 거래는 제외됩니다.|しました。他の端末で処理済みの取引は除外されます。
로그인이 필요합니다.|ログインが必要です。
이 가계부에 접근할 수 없습니다.|この家計簿にはアクセスできません。
고정비를 찾을 수 없습니다.|固定費が見つかりません。
중지한 고정비입니다.|停止中の固定費です。
동기화|同期
` .trim().split('\n').map(line=>line.split('|')));
  const translationKeys=Object.keys(JA).sort((a,b)=>b.length-a.length);
  const translationPattern=new RegExp(translationKeys.map(k=>k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');
  function translateText(text) {
    if(appearance.language!=='ja')return text;
    return String(text).replace(translationPattern,key=>JA[key])
      .replace(/(\d[\d,.]*)원/g,'$1ウォン').replace(/(\d+)건/g,'$1件').replace(/(\d+)개월/g,'$1か月')
      .replace(/이번 달 포함/g,'今月を含む').replace(/씩/g,'ずつ').replace(/% 달성/g,'% 達成').replace(/매월 /g,'毎月 ').replace(/(\d+)일/g,'$1日');
  }
  const confirm=message=>window.confirm(translateText(message));
  const prompt=message=>window.prompt(translateText(message));
  function userText(value){return `<span data-user-text>${esc(value)}</span>`;}
  const translatedNodes=new WeakMap(),translatedAttributes=new WeakMap();
  function localizeUI() {
    document.documentElement.lang=appearance.language;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node;
    while(node=walker.nextNode()) {
      if(node.parentElement?.closest('[data-user-text],.languages,script,style,textarea'))continue;
      // Option values and all user-provided names are never changed.
      const option=node.parentElement?.closest('option');
      if(option && ['category_name','saving_goal_id'].includes(option.parentElement.name) && option.value && option.value!=='__new_category__')continue;
      const previous=translatedNodes.get(node);
      const original=previous&&node.nodeValue===previous.output?previous.original:node.nodeValue;
      const output=translateText(original);translatedNodes.set(node,{original,output});if(node.nodeValue!==output)node.nodeValue=output;
    }
    for(const element of root.querySelectorAll('[placeholder],[title],[aria-label]')) {
      if(element.closest('[data-user-text]'))continue;
      let entries=translatedAttributes.get(element)||{};
      for(const key of ['placeholder','title','aria-label'])if(element.hasAttribute(key)){const value=element.getAttribute(key),old=entries[key];const original=old&&value===old.output?old.original:value;const output=translateText(original);entries[key]={original,output};if(value!==output)element.setAttribute(key,output);}
      translatedAttributes.set(element,entries);
    }
    for(const b of root.querySelectorAll('[data-action="language"]'))b.setAttribute('aria-pressed',String(b.dataset.id===appearance.language));
  }
  function observeLanguage() {
    let queued=false; const observer=new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;observer.disconnect();localizeUI();observer.observe(root,{childList:true,subtree:true,characterData:true});});});
    observer.observe(root,{childList:true,subtree:true,characterData:true});localizeUI();
  }

  async function start() {
    document.documentElement.lang='ko';
    root=document.createElement('main'); root.id='ourhome-v11'; document.body.replaceChildren(root);
    const style=document.createElement('style'); style.textContent=`body{margin:0;background:#f3f6f5;color:#18342e;font-family:system-ui,sans-serif}#ourhome-v11{max-width:1000px;margin:auto;padding:24px 18px 60px}#ourhome-v11 *{box-sizing:border-box}#ourhome-v11 header,.toolbar,.row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}#ourhome-v11 h1{font-size:26px;margin:8px 0}#ourhome-v11 h2{font-size:21px}#ourhome-v11 h3{margin:9px 0}#ourhome-v11 small{color:#536c64}#ourhome-v11 .card{background:white;padding:22px;border:1px solid #dce6df;border-radius:18px;margin:14px 0}#ourhome-v11 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}#ourhome-v11 button{background:#176950;color:white;border:0;border-radius:10px;padding:12px 16px;margin:4px;cursor:pointer;font:inherit}#ourhome-v11 button[aria-current=page]{background:#133d30;outline:3px solid #b8dacb}#ourhome-v11 label{display:block;margin:12px 0}#ourhome-v11 input,#ourhome-v11 select{display:block;width:100%;font:inherit;padding:12px;border:1px solid #bccfc5;border-radius:9px;margin-top:6px;background:white;color:#18342e}#ourhome-v11 nav{display:flex;gap:4px;flex-wrap:wrap;margin:18px 0}#ourhome-v11 progress{width:100%;accent-color:#176950}#ourhome-v11 dialog{border:0;border-radius:18px;padding:24px;width:min(94vw,520px);max-height:90vh;overflow:auto}#ourhome-v11 dialog::backdrop{background:#16392e88}#ourhome-v11 .auth{max-width:440px;margin:40px auto}#notice{white-space:pre-wrap;color:#8a3a16}#ourhome-v11 p{overflow-wrap:anywhere}#ourhome-v11 [aria-busy=true]{opacity:.7}`; document.head.append(style); const theme=document.createElement('style'); theme.textContent=THEME; document.head.append(theme);
    applyAppearance();observeLanguage();
    draw('<p>연결 중입니다…</p>');
    db=typeof supabaseClient!=='undefined'?supabaseClient:window.supabaseClient;
    if(!db?.auth) { notice('Supabase 연결 설정이 없습니다. index.html에서 Supabase JS v2, supabase-config.js, app.js 순서로 로드해 주세요.'); return; }
    root.addEventListener('click',e=>{ const b=e.target.closest('[data-action]'); if(b) run(()=>action(b.dataset.action,b.dataset.id)); });
    root.addEventListener('input', e=>{ if(e.target.id==='search') { searchText=e.target.value; renderSearchResults(); } });
    root.addEventListener('change', e=>{ if(e.target.id==='filter-type') { filterType=e.target.value; renderSearchResults(); } if(e.target.id==='filter-owner') { filterOwner=e.target.value; renderSearchResults(); } });
    root.addEventListener('input',moneyInput);
    root.addEventListener('input',e=>{if(['theme-background','theme-button'].includes(e.target.id)&&validColor(e.target.value)){appearance[e.target.id==='theme-background'?'background':'button']=e.target.value;appearance.preset='custom';applyAppearance();for(const b of root.querySelectorAll('.theme-options button'))b.setAttribute('aria-pressed','false');}});
    root.addEventListener('change',e=>{if(['theme-background','theme-button'].includes(e.target.id))saveAppearance();});

    root.addEventListener('change', e=>{ const form=e.target.closest('form[data-form="transaction"]');if(!form)return;if(e.target.name==='original_currency')toggleFx(form);if(e.target.name==='fx_mode'){toggleFx(form,false);calculateFx(form);} });
    root.addEventListener('change',changeCategory);
    root.addEventListener('submit',e=>{ e.preventDefault(); run(()=>submit(e.target,e.submitter?.value)); });
    root.addEventListener('change',e=>{ if(e.target.id==='month' && /^\d{4}-\d{2}$/.test(e.target.value)) {month=e.target.value;dashboard();} if(e.target.id==='import-file'&&e.target.files[0]) {const file=e.target.files[0]; run(async()=>importData(JSON.parse(await file.text())));e.target.value='';} });
    db.auth.onAuthStateChange((event,session)=>{ if(event==='SIGNED_OUT') { generation++; user=null;house=null;data={};login(); } else if(event==='SIGNED_IN' && session?.user.id!==user?.id) setTimeout(()=>run(()=>loadSession(session)),0); });
    await run(async()=>{ const s=await checked(db.auth.getSession()); await loadSession(s.session); });
    setInterval(()=>{if(house&&!busy&&!document.hidden) refresh().catch(e=>notice(`동기화 실패: ${e.message}. 연결 후 다시 시도합니다.`));},5000);
    if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();



