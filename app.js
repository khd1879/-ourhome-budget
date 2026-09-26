/* 우리집 재무관리 v1.1 — 대화에 남은 DB 스키마를 기준으로 재구성.
 * index.html: Supabase JS v2 → supabase-config.js → app.js 순서로 로드.
 * 기존 localStorage는 읽기만 하며 삭제하지 않습니다.
 */
(() => {
  'use strict';
  const VERSION = '2.5.0';
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
      const names=['transactions','budgets','accounts','categories','household_members','audit_logs','recurring_expenses','recurring_payments','saving_goals','goal_allocations','asset_snapshots','portfolio_targets','strategy_books','strategy_book_changes'];
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
    const expanded=[...root.querySelectorAll('details[data-asset-detail][open]')].map(d=>d.dataset.assetDetail);
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
    if(tab==='accounts') body=assetsDashboard();
    if(tab==='portfolio') body=portfolioView();
    if(tab==='strategies') body=strategyView();
    if(tab==='settings') body=`<section class="card"><h2>${userText(house.name)}</h2><p>초대코드 <strong>${esc(house.invite_code)}</strong></p>${btn('copy','초대코드 복사')}<p>${data.household_members.map(m=>`${userText(m.display_name)} (${m.role==='owner'?'관리자':'구성원'})`).join(' · ')}</p>${btn('goals','목표 수정')}</section><section class="card"><h2>백업 및 가져오기</h2>${btn('json','서버 전체 JSON 백업')}${btn('csv','전체 거래 CSV 백업')}${btn('local','v1.0 로컬 데이터 가져오기')}<label>JSON 백업 가져오기<input type="file" id="import-file" accept=".json,application/json"></label><p>가져오기는 거래·예산·자산·카테고리를 추가합니다. 고정비 설정과 납부 연결의 전체 복원은 지원하지 않습니다. 적용 전 내용을 확인할 수 있습니다.</p></section><section class="card"><h2>카테고리</h2>${btn('category','카테고리 추가')}<p>${data.categories.filter(c=>c.active).map(c=>`${userText(c.name)} (${labels[c.kind]})`).join(' · ')}</p></section><section class="card"><h2>최근 변경이력</h2>${data.audit_logs.slice().sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,50).map(r=>`<p>${esc(new Date(r.created_at).toLocaleString('ko-KR'))} · ${userText(data.household_members.find(m=>m.user_id===r.actor_id)?.display_name||'구성원')} · ${esc(r.entity_type)} ${esc(r.action)}</p>`).join('')||'<p>변경이력이 없습니다.</p>'}</section>`;
    if(tab==='settings') body=themeSettings()+body;
    if(tab==='saving') body=savingGoalsView();
    if(tab==='analysis') body=analysisView(active);
    if(tab==='fixed') body=fixedView();
    if(tab==='transactions') body=searchView(monthly);
    if(tab==='home') body=quickView(active)+body;
    draw(`<div class="toolbar"><label>조회 월 <input id="month" type="month" value="${month}"></label><span id="sync">약 5초 간격 동기화</span>${btn('refresh','새로고침')}${btn('transaction','+ 거래 입력')}</div><nav>${[['home','요약'],['transactions','거래'],['saving','목표 저축'],['analysis','분석'],['fixed','고정비'],['budgets','예산'],['accounts','자산'],['portfolio','포트폴리오'],['strategies','전략 투자'],['trash','휴지통'],['settings','설정']].map(([k,t])=>`<button data-action="tab" data-id="${k}" aria-current="${tab===k?'page':'false'}">${t}</button>`).join('')}</nav>${body}`);
    for(const detail of root.querySelectorAll('details[data-asset-detail]'))detail.open=expanded.includes(detail.dataset.assetDetail);
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
    if(kind==='account') {r=data.accounts.find(x=>x.id===id)||{};body=accountFields(r);}
    if(kind==='goals') body=field('name','우리집 이름',house.name,'text','required')+field('annual_saving_goal','연간 저축·투자 목표',house.annual_saving_goal,'number','required min="0"')+field('monthly_investment_goal','월 투자 목표',house.monthly_investment_goal,'number','required min="0"');
    if(kind==='category') body=select('kind','종류',Object.entries(labels).slice(0,3),'expense')+field('name','카테고리 이름','','text','required');
    const d=$('#editor'); d.innerHTML=`<h2>${kind==='goals'?'목표 설정':'기록 입력'}</h2><form data-form="${kind}" data-id="${esc(id||'')}">${body}<button>저장</button>${btn('close','취소')}</form><p>저장 실패 시 상단 안내를 확인해 주세요.</p>`; d.showModal(); if(kind==='transaction') configureFx(d.querySelector('form'),r); if(kind==='account') accountKindChanged(d.querySelector('form'));
  }
  async function update(table,id,patch) { const r=await checked(db.from(table).update(patch).eq('id',id).eq('household_id',house.id).select('id')); if(!r.length) throw Error('기록을 찾을 수 없거나 수정 권한이 없습니다. 새로고침해 주세요.'); }
  function download(name,text,type) { const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement('a'); a.href=url; a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000); }
  async function backup() { await refresh(false); return {format:'ourhome-budget',version:VERSION,exported_at:new Date().toISOString(),household:house,...data}; }
  function csvCell(v) { let s=String(v??''); if(/^[=+\-@\t\r]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; }
  async function submit(form,mode) {
    const f=Object.fromEntries(new FormData(form)), kind=form.dataset.form, id=form.dataset.id;
    let categoryWarning='';
    if(kind.startsWith('strategy-')){await submitStrategy(form,f);return;}
    if(kind==='portfolio-target'){await submitPortfolioTarget(form,f);return;}
    if(kind==='portfolio-plan'){submitPortfolioPlan(form,f);return;}
    if(kind==='funding'){await submitFunding(form,f);return;}
    if(kind==='account') normalizeAccountFields(f);
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
    for(const r of source.accounts||[]) { if(!['asset','liability'].includes(r.kind??r.type)||!r.name) throw Error('자산·부채 형식을 확인해 주세요.'); result.accounts.push({kind:r.kind??r.type,name:r.name,amount:number(r.amount),category:r.category??'',owner_label:ownerOf(r),asset_type:(r.kind??r.type)==='liability'?'unclassified':typeOf(r)}); }
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
    if(name.startsWith('strategy-')){await strategyAction(name,id);return;}
    if(name==='portfolio-target'){portfolioTargetEditor();return;}
    if(name==='portfolio-plan'){portfolioPlanEditor();return;}
    if(name==='snapshot-save'){await saveMonthlySnapshot();return;}
    if(name==='snapshot-current'){month=settlementMonth();dashboard();return;}
    if(name==='funding-new'||name==='funding-edit'){fundingEditor(id);return;}
    if(name==='funding-release'){await releaseFunding(id);return;}
    if(name==='delete-account'&&(data.goal_allocations||[]).some(r=>r.account_id===id)){throw Error('목표자금 배정이 남아 있습니다. 먼저 배정을 해제해 주세요.');}

    if(name==='asset-filter'){if(id==='all'||assetOwners.includes(id)){assetOwnerFilter=id;dashboard();}return;}
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
    return `${goalOverview(goals)}<div class="grid">${goals.map(g=>{const s=goalStats(g);return `<section class="card"><small>목표일 ${esc(g.target_date)}</small><h2>${userText(g.name)}</h2><h3>${won(s.saved)} <small>/ ${won(g.target_amount)}</small></h3><p>계좌에서 확보한 금액 ${won(sum((data.goal_allocations||[]).filter(a=>a.goal_id===g.id)))}</p><progress aria-label="${esc(g.name)} 달성률" max="100" value="${Math.min(100,s.percent)}"></progress><p>${s.percent.toFixed(1)}% 달성 · ${s.remaining===0?'목표 달성!':'남은 금액 '+won(s.remaining)}</p><p>${s.remaining===0?'차곡차곡 모았어요.':s.months?`월 ${won(s.monthly)}씩 · 이번 달 포함 ${s.months}개월`:'목표일이 지났어요. 기한을 다시 설정해 주세요.'}</p>${s.saved<0?'<p>연결한 지출이 저축보다 많습니다. 거래 연결을 확인하세요.</p>':''}${btn('saving-goal-add','저축 입력',g.id)}${btn('saving-goal-spend','사용 입력',g.id)}${btn('saving-goal-edit','목표 수정',g.id)}${btn('saving-goal-archive','보관',g.id)}</section>`;}).join('')||'<section class="card">여행비, 비상금, 단기 적금 목표를 만들어 보세요.</section>'}</div><section class="card"><h2>목표 한눈에 보기</h2><div style="overflow-x:auto"><table style="width:100%;min-width:600px;text-align:left;border-collapse:collapse"><thead><tr>${['목표','목표금액','모은 금액','달성률','기한'].map(t=>`<th style="padding:12px">${t}</th>`).join('')}</tr></thead><tbody>${goals.map(g=>{const s=goalStats(g);return `<tr>${[userText(g.name),won(g.target_amount),won(s.saved),s.percent.toFixed(1)+'%',esc(g.target_date)].map(v=>`<td style="padding:12px;border-top:1px solid #eee">${v}</td>`).join('')}</tr>`;}).join('')}</tbody></table></div><p>진행률은 전체 기간의 연결 거래 기준입니다. 월 필요액은 이번 달부터 목표 월까지 균등하게 모으는 가정입니다.</p></section><section class="card"><h2>보관한 목표</h2>${data.saving_goals.filter(g=>!g.active).map(g=>`<p>${userText(g.name)} ${btn('saving-goal-unarchive','다시 표시',g.id)}</p>`).join('')||'<p>보관한 목표가 없습니다.</p>'}</section>`;
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
    style.textContent=`:root{--oh-page:${appearance.background};--oh-button:${appearance.button};--oh-button-text:${contrastText(appearance.button)};--oh-ink:${dark?'#f2f1f6':'#292b3b'};--oh-muted:${dark?'#c4c2cf':'#686676'};--oh-surface:${dark?'#242735':'#ffffff'};--oh-line:${dark?'#45485b':'#e5e2eb'};--oh-soft:${appearance.background}}
      body{background:var(--oh-page)!important}#ourhome-v11{color:var(--oh-ink)!important}#ourhome-v11 .card,#ourhome-v11 dialog{background:var(--oh-surface)!important;color:var(--oh-ink)!important;border-color:var(--oh-line)!important}
      #ourhome-v11 p,#ourhome-v11 small{color:var(--oh-muted)}#ourhome-v11 button{background:var(--oh-button);color:var(--oh-button-text)}#ourhome-v11 button:hover{filter:brightness(.94)}#ourhome-v11 nav button{background:transparent;color:var(--oh-ink)}#ourhome-v11 nav button[aria-current=page]{background:var(--oh-button);color:var(--oh-button-text)}
      #ourhome-v11 input,#ourhome-v11 select{background:var(--oh-surface);color:var(--oh-ink);border-color:var(--oh-line)}#ourhome-v11 .quick{background:var(--oh-soft)!important}#ourhome-v11 .quick button{background:var(--oh-surface);color:var(--oh-ink)}#ourhome-v11 header,#ourhome-v11 nav{border-color:var(--oh-line)}
      #ourhome-v11 .oh-summary{padding:30px;border-radius:24px;background:var(--oh-soft)!important;border:1px solid var(--oh-line);color:var(--oh-ink)!important;margin:24px 0}#ourhome-v11 .oh-summary-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}#ourhome-v11 .oh-summary h2{font-size:27px;margin:10px 0}#ourhome-v11 .oh-summary-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0}#ourhome-v11 .oh-summary-stat{background:var(--oh-surface)!important;color:var(--oh-ink)!important;padding:18px;border-radius:16px}#ourhome-v11 .oh-summary-stat strong{display:block;margin-top:9px;font-size:23px;overflow-wrap:anywhere;color:var(--oh-ink)!important;-webkit-text-fill-color:var(--oh-ink)!important;background:none!important}#ourhome-v11 .oh-summary-stat small{color:var(--oh-muted)!important;-webkit-text-fill-color:var(--oh-muted)!important}#ourhome-v11 .oh-summary h2,#ourhome-v11 .oh-summary p strong{color:var(--oh-ink)!important;-webkit-text-fill-color:var(--oh-ink)!important}
      #ourhome-v11 details.help{margin-top:18px;font-size:13px}#ourhome-v11 details.help summary{cursor:pointer;color:var(--oh-muted)}#ourhome-v11 .oh-summary progress{height:10px}#ourhome-v11 .header-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}#ourhome-v11 .languages{display:flex;gap:3px}#ourhome-v11 .languages button{font-size:12px;padding:8px;background:var(--oh-surface);color:var(--oh-ink);border:1px solid var(--oh-line)}#ourhome-v11 .languages button[aria-pressed=true]{outline:2px solid var(--oh-button);outline-offset:-2px}
      #ourhome-v11 .theme-options{display:flex;flex-wrap:wrap;gap:8px}#ourhome-v11 .theme-options button{background:var(--oh-surface);color:var(--oh-ink);border:1px solid var(--oh-line)}#ourhome-v11 .swatch{display:inline-block;width:14px;height:14px;border-radius:50%;margin-right:6px;border:1px solid #999;vertical-align:middle}#ourhome-v11 .color-controls{display:flex;gap:22px;flex-wrap:wrap}#ourhome-v11 input[type=color]{width:80px;height:44px;padding:4px}#ourhome-v11 .theme-options button[aria-pressed=true]{outline:2px solid var(--oh-button)}
      @media(max-width:600px){#ourhome-v11 .oh-summary{padding:20px}#ourhome-v11 .oh-summary-stats{grid-template-columns:1fr;margin:18px 0}#ourhome-v11 .oh-summary-stat{display:flex;align-items:center;justify-content:space-between;gap:12px}#ourhome-v11 .oh-summary-stat strong{margin:0;font-size:21px}#ourhome-v11 .oh-summary h2{font-size:24px}}
    `;
  }
  function themeSettings() {return `<section class="card"><h2>화면 테마</h2><p>언어와 색상은 이 기기에만 저장됩니다.</p><div class="theme-options">${Object.entries(palettes).map(([id,colors])=>`<button type="button" data-action="theme-preset" data-id="${id}" aria-pressed="${appearance.preset===id}"><span class="palette-preview" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:42px;height:28px;margin-right:7px;border:1px solid #aaa;border-radius:7px;background:${colors[0]}"><span style="width:23px;height:10px;border-radius:4px;background:${colors[1]}"></span></span>${{ivory:'아이보리',lavender:'라벤더',navy:'네이비',dark:'다크'}[id]}</button>`).join('')}</div><p>견본 바탕은 배경색, 안쪽 막대는 버튼색입니다.</p><div class="color-controls"><label>배경색 <code data-theme-hex="background">${appearance.background}</code><input type="color" id="theme-background" value="${appearance.background}"></label><label>버튼색 <code data-theme-hex="button">${appearance.button}</code><input type="color" id="theme-button" value="${appearance.button}"></label></div><p>버튼의 글자색은 읽기 편하도록 자동 조정됩니다.</p>${btn('theme-reset','기본 테마로 복원')}</section>`;}
  function summaryStat(label,value) {return `<div class="oh-summary-stat"><small>${label}</small><strong style="color:var(--oh-ink)!important;-webkit-text-fill-color:var(--oh-ink)!important">${won(value)}</strong></div>`;}
  function goalOverview(goals) {
    const target=goals.reduce((a,g)=>a+Number(g.target_amount),0), saved=goals.reduce((a,g)=>a+goalStats(g).saved,0);
    const remaining=goals.reduce((a,g)=>a+goalStats(g).remaining,0),rate=target?Math.max(0,saved/target*100):0;
    return `<section class="oh-summary"><div class="oh-summary-head"><div><small>OUR NEXT CHAPTER</small><h2>우리의 다음 목표를 위해</h2><p>작은 저축을 모아, 함께 원하는 내일로.</p></div>${btn('saving-goal-new','＋ 목표 만들기')}</div><div class="oh-summary-stats">${summaryStat('전체 목표금액',target)}${summaryStat('지금까지 모은 금액',saved)}${summaryStat('목표별 남은 금액',remaining)}</div><p>전체 달성률 <strong>${rate.toFixed(1)}%</strong></p><progress aria-label="전체 달성률" max="100" value="${Math.min(100,rate)}"></progress><details class="help"><summary>ⓘ 사용 안내</summary><p>활성 목표의 전체 기간 거래를 합산합니다. 저축·투자는 더하고 연결 지출은 차감하며, 휴지통 거래는 제외합니다.</p><p>남은 금액은 목표별 부족액의 합입니다. 한 목표의 초과 저축은 다른 목표의 부족액을 줄이지 않습니다.</p><p>기존 거래를 수정해서 목표에 연결할 수 있습니다. 같은 돈을 다시 입력하지 마세요.</p></details></section>`;
  }
  function fixedOverview(list) {
    const unpaid=list.filter(r=>!paymentFor(r)), paid=list.filter(r=>paymentFor(r));
    const completed=paid.reduce((a,r)=>{const p=paymentFor(r);return a+Number(data.transactions.find(t=>t.id===p.transaction_id)?.amount||0);},0);
    return `<section class="oh-summary"><div class="oh-summary-head"><div><small>MONTHLY ROUTINE</small><h2>이번 달 고정비, 한눈에</h2><p>${esc(month)} · 납부 완료 ${paid.length} / ${list.length}</p></div>${btn('fixed-new','＋ 고정비 등록')}</div><div class="oh-summary-stats">${summaryStat('월 예정액',sum(list))}${summaryStat('납부 완료액',completed)}${summaryStat('남은 예정액',sum(unpaid))}</div><p>납부 진행률 ${list.length?Math.round(paid.length/list.length*100):0}%</p><progress aria-label="납부 진행률" max="${list.length||1}" value="${paid.length}"></progress><details class="help"><summary>ⓘ 사용 안내</summary><p>실제로 납부한 뒤 ‘납부 기록’을 누르면 지출에 한 번만 반영됩니다. 자동 출금 기능은 아닙니다.</p><p>예정액은 현재 등록 금액, 완료액은 연결된 실제 거래금액입니다. 금액을 수정했다면 두 값의 합계가 다를 수 있습니다.</p><p>29~31일이 없는 달에는 말일로 기록합니다. 휴지통에 있는 납부 거래는 미납부로 표시됩니다.</p></details></section>`;
  }

  const JA = Object.fromEntries(`
전략 투자|戦略投資
전략 만들기|戦略を作成
전략 가져오기|戦略を読み込む
USD 보조 원장입니다. 기존 자산 계좌 금액에 다시 합산하지 않습니다.|USD建ての補助元帳です。既存の資産口座の金額に重複して加算しません。
등록 전략 평가액 합계|登録戦略の評価額合計
등록 전략 현금 합계|登録戦略の現金合計
평가가격 또는 기록 확인 필요|評価価格または記録の確認が必要
입력한 평가가격 기준|入力した評価価格が基準
생활비·비상금과 구분하세요.|生活費・緊急予備資金と分けてください。
진행 전략 보기|運用中の戦略を見る
보관 전략 보기|保管した戦略を見る
첫 전략을 기록해 보세요.|最初の戦略を記録しましょう。
전략을 만든 뒤 최초 입금부터 실제 체결을 순서대로 입력하세요.|戦略を作成し、最初の入金から実際の約定を順番に入力してください。
기존 보유분을 시작할 때는 과거 거래를 기록해야 전체 손익이 맞습니다.|既存の保有分は過去の取引を記録すると全期間の損益が一致します。
기록 확인|記録を確認
전략 백업|戦略のバックアップ
계산과 기록 안내|計算と記録の案内
무한매수법 V4.0은 20·40분할, VR5.0은 기본공식을 지원합니다.|無限買付法V4.0は20・40分割、VR5.0は基本式に対応しています。
주문표는 확인용 계산입니다. 증권사에 주문을 전송하지 않습니다.|注文表は確認用の計算です。証券会社への注文送信は行いません。
V와 밴드는 매매 기준이며 수익이나 손실 한도가 아닙니다.|Vとバンドは売買基準であり、利益や損失の限度ではありません。
손익 평단은 매수 수수료를 포함하고, 주문 규칙 평단은 수수료를 제외합니다. 증권사 평단과 대조하세요.|損益計算の平均取得単価は買付手数料込み、注文ルールの平均単価は手数料抜きです。証券会社の平均単価と照合してください。
두 전략을 함께 운용해도 같은 종목의 위험은 겹칩니다. 위 합계는 등록한 전략만 포함합니다.|両戦略を運用しても同じ銘柄のリスクは重なります。上記合計は登録した戦略のみを含みます。
수익률·자동 시세·원화 환산·세금 추정·주식분할 자동 처리는 지원하지 않습니다.|収益率・自動株価取得・ウォン換算・税額推定・株式分割の自動処理には対応していません。
현금 Pool|現金Pool
주식 평가액|株式評価額
누적 실현손익|累積実現損益
평가손익|評価損益
누적 순입금|累積純入金
총손익|総損益
전략 정보|戦略情報
기본공식|基本式
연결 계좌|連携口座
잔액은 자동 변경하지 않습니다.|残高は自動変更しません。
보유수량|保有数量
손익 평단|損益用平均単価
규칙 평단|ルール用平均単価
평가가격 기준일|評価価格の基準日
직접 입력한 가격입니다.|手動入力した価格です。
체결·입출금 기록|約定・入出金を記録
평가가격 입력|評価価格を入力
하루 결과 확정|一日の結果を確定
사이클 시작|サイクルを開始
주문표 계산|注文表を計算
리버스모드|リバースモード
일반모드|通常モード
미확정 체결이 있습니다. 하루 결과를 확정하세요.|未確定の約定があります。一日の結果を確定してください。
하루 결과 확정 후 다음 주문표를 계산합니다.|一日の結果確定後に次の注文表を計算します。
리버스 첫날은 MOC 매도만 진행합니다.|リバース初日はMOC売却のみです。
사이클 매수 한도|サイクルの買付上限
남은 한도|残りの上限額
실제 매수액이 사이클 한도를 초과했습니다.|実際の買付額がサイクルの上限を超えています。
초기 입금과 매수를 기록한 뒤 최초 사이클을 시작하세요.|初期入金と買付を記録してから最初のサイクルを開始してください。
누적 실현손익 추이|累積実現損益の推移
V 기준값 추이|V基準値の推移
전체 기록|全記録
보관 해제|保管を解除
전략 보관|戦略を保管
전략 이름|戦略名
연결 안 함|連携なし
전략 종류|戦略の種類
무한매수법 V4.0|無限買付法V4.0
종목|銘柄
분할수|分割数
운용 방식|運用方式
적립식|積立式
거치식|据置式
인출식|取崩式
시작 G|開始G
최초 V (USD)|初期V (USD)
거래 기록이 생기면 공식과 초기 설정은 고정됩니다.|取引記録がある場合、公式と初期設定は固定されます。
거래 날짜|取引日
같은 날 순서|同日の順序
기록 종류|記録の種類
체결 수량|約定数量
체결 가격 (USD)|約定価格 (USD)
수수료 (USD)|手数料 (USD)
금액 (USD)|金額 (USD)
실제 체결 가격과 수수료를 입력하세요. 주문표 가격은 체결 가격이 아닙니다.|実際の約定価格と手数料を入力してください。注文表の価格は約定価格ではありません。
새 기록이 평가일보다 늦으면 평가가격을 다시 입력해야 합니다.|新しい記録が評価日より後の場合、評価価格の再入力が必要です。
미국 거래일|米国取引日
하루 매수 결과|一日の買付結果
매수 없음|買付なし
절반 예산 매수|半分の予算で買付
전체 예산 매수|全予算で買付
쿼터매수|クォーター買付
하루 매도 결과|一日の売却結果
매도 없음|売却なし
쿼터매도|クォーター売却
목표가 매도·전량 매도|目標価格売却・全量売却
리버스 분할매도|リバース分割売却
확정 종가 (USD)|確定終値 (USD)
증권사 평단 (선택)|証券会社の平均単価（任意）
같은 날 모든 체결을 입력한 뒤 한 번만 확정하세요. 부분 체결로 결과를 판단할 수 없으면 확정을 보류하세요.|同日の全約定を入力してから一度だけ確定してください。一部約定で結果を判断できない場合は確定を保留してください。
목표가 매도 후 LOC 재매수도 같은 날 결과에 포함하세요.|目標価格売却後のLOC再買付も同日の結果に含めてください。
사이클 시작일|サイクル開始日
이번 사이클 G|今回のサイクルG
적립금 (USD)|積立額 (USD)
인출금 (USD)|取崩額 (USD)
적립·인출은 여기에서 한 번만 입력하세요. 현금과 V에 함께 반영됩니다.|積立・取崩しはこちらで一度だけ入力してください。現金とVの両方に反映されます。
최초 사이클은 입금·초기 매수를 먼저 기록하고 적립·인출 0으로 시작합니다.|初回は入金・初期買付を先に記録し、積立・取崩額0で開始します。
이전 기록|前の記録
다음 기록|次の記録
기록 삭제|記録を削除
주문 기준 날짜|注文の基準日
수수료 여유액 (USD)|手数料の予備額 (USD)
규칙 평단 (선택)|ルール用平均単価（任意）
첫 매수 LOC 가격 (USD)|初回買付LOC価格 (USD)
직전 5거래일 종가|直前5取引日の終値
한 줄에 날짜와 종가를 입력하세요. 실제 직전 미국 거래일 5개인지 확인하세요.|各行に日付と終値を入力してください。直前の米国5取引日であることを確認してください。
수수료 여유액을 제외한 예산으로 계산합니다.|手数料の予備額を差し引いた予算で計算します。
전략 기록을 저장했습니다.|戦略の記録を保存しました。
매수 예산|買付予算
주문 방식|注文方式
가격 (USD)|価格 (USD)
종가 시장가|終値成行
예산 안에서 주문 가능한 수량이 없습니다.|予算内で注文できる数量がありません。
주문표 CSV|注文表CSV
2MB 이하의 전략 백업 파일을 선택하세요.|2MB以下の戦略バックアップを選択してください。
전략 백업 파일을 선택하세요.|戦略バックアップファイルを選択してください。
새 전략으로 가져오기|新しい戦略として読み込む
전략 백업 파일|戦略バックアップファイル
기존 전략을 덮어쓰지 않고 새 전략으로 복원합니다. 중복된 전략은 보관하세요.|既存の戦略を上書きせず、新しい戦略として復元します。重複する戦略は保管してください。
주문표를 다시 계산하세요.|注文表を再計算してください。
기록을 다시 열어 주세요.|記録を開き直してください。
기록을 찾을 수 없습니다.|記録が見つかりません。
이 기록을 삭제하고 이후 계산을 다시 할까요?|この記録を削除して以降を再計算しますか？
전략을 선택해 주세요.|戦略を選択してください。
기록이 두 개 이상 쌓이면 추이를 표시합니다.|記録が2件以上になると推移を表示します。
납부 세금|納付税金
하루 확정|一日の確定
VR 사이클|VRサイクル
입금|入金
출금|出金
매수|買付
매도|売却
배당|配当
수수료|手数料
사이클|サイクル
밴드|バンド
수량|数量
전반|前半
후반|後半
매수 가격은 하단/매수 전 수량을 센트 내림, 매도 가격은 상단/매도 전 수량을 센트 올림합니다.|買付価格は下限/買付前数量をセント切捨て、売却価格は上限/売却前数量をセント切上げします。
사이클 한도는 매수 수수료를 포함해 사용하며 매도대금으로 재충전하지 않습니다.|サイクル上限は買付手数料を含めて消費し、売却代金で補充しません。
첫 매수 LOC 가격은 증권사 주문 가능 범위를 확인해 직접 입력합니다.|初回買付LOC価格は証券会社の注文可能範囲を確認し、手動入力します。
전반 주문표는 평단 위에서 절반 예산, 평단 이하에서 전체 예산을 넘지 않도록 정수 수량을 배분합니다.|前半の注文表は平均単価より上では半分、以下では全予算を超えないよう整数数量を配分します。
입력한 날짜가 실제 직전 5거래일인지 확인하세요. 미국 휴장일은 자동 조회하지 않습니다.|入力日が直前5取引日であることを確認してください。米国休場日は自動照会しません。
LOC는 조건 충족 시 실제 종가에 체결됩니다. 표의 모든 주문이 각 지정 가격에 체결된다고 계산하지 않습니다.|LOCは条件を満たすと実際の終値で約定します。表の各指定価格で約定するとは計算しません。
표는 최대 약 80단계입니다. 깊은 하락에서는 추가 주문표가 필요할 수 있습니다.|表は最大約80段階です。大幅下落では追加の注文表が必要な場合があります。
매수·매도 각각 최대 80단계이며 일부 주문표만 표시될 수 있습니다.|買付・売却はそれぞれ最大80段階で、注文表の一部のみ表示される場合があります。
주문표 계산 가능한 금액 범위를 초과했습니다.|注文表で計算できる金額の範囲を超えています。
값을 확인하세요.|値を確認してください。
전략 이름·소유자·종류를 확인하세요.|戦略名・所有者・種類を確認してください。
무한매수법은 TQQQ/SOXL의 20·40분할을 지원합니다.|無限買付法はTQQQ/SOXLの20・40分割に対応します。
VR 종목·방식·G를 확인하세요.|VRの銘柄・方式・Gを確認してください。
기록은 최대 10,000개입니다.|記録は最大10,000件です。
기록의 ID·날짜·순서·종류를 확인하세요.|記録のID・日付・順序・種類を確認してください。
같은 날짜의 순서가 중복되었습니다.|同じ日付の順序が重複しています。
메모는 300자 이내입니다.|メモは300文字以内です。
하루 확정 뒤의 거래는 다음 날짜에 기록하세요. 같은 날 거래는 확정 기록 앞에 배치하세요.|一日の確定後の取引は次の日付に記録してください。同日の取引は確定記録の前に配置してください。
무한매수법 진행 중에는 외부 입출금을 넣을 수 없습니다.|無限買付法の運用中は外部からの入出金を追加できません。
이전 날짜의 하루 결과를 먼저 확정하세요.|前の日付の結果を先に確定してください。
2주가 지났습니다. 다음 사이클을 먼저 시작하세요.|2週間が経過しました。次のサイクルを先に開始してください。
VR 시작 후 적립·인출은 사이클 전환에서 기록하세요.|VR開始後の積立・取崩しはサイクル切替時に記録してください。
VR에는 무한매수법 하루 확정을 넣을 수 없습니다.|VRには無限買付法の一日確定を入力できません。
하루 확정 날짜가 중복되거나 역순입니다.|確定日が重複しているか逆順です。
거래 날짜와 하루 확정 날짜가 다릅니다.|取引日と確定日が異なります。
하루 매수·매도 결과를 선택하세요.|一日の買付・売却結果を選択してください。
실제 체결 기록과 하루 매수·매도 결과가 다릅니다.|実際の約定記録と一日の売買結果が異なります。
주문 규칙은 정수 주식만 지원합니다.|注文ルールは整数株数のみに対応しています。
일반모드에서는 리버스 매도를 선택할 수 없습니다.|通常モードではリバース売却を選択できません。
쿼터매도와 LOC 매수가 함께 체결된 날은 원본의 일반 처리 범위를 벗어납니다. 체결 내역을 확인하세요.|クォーター売却とLOC買付が同日に約定した場合は原文の通常処理の範囲外です。約定履歴を確認してください。
쿼터매도 수량이 보유수량의 1/4 내림과 다릅니다. 부분 체결일은 아직 확정하지 마세요.|クォーター売却数量が保有数の1/4切捨てと異なります。一部約定の日はまだ確定しないでください。
목표가 매도 후 잔여 보유가 있는 예외입니다. 원본 세칙 확인 전 자동 T 확정을 지원하지 않습니다.|目標価格売却後に残高がある例外です。原文の詳細確認前はTの自動確定に対応しません。
목표가 매도 후 재매수는 나머지 3/4 매도 체결을 확인해야 합니다.|目標価格売却後の再買付は残り3/4の売却約定を確認する必要があります。
후반전은 절반 매수로 확정할 수 없습니다. 부분 체결 여부를 확인하세요.|後半は半分買付として確定できません。一部約定か確認してください。
리버스 하루 결과는 쿼터매수 또는 분할매도입니다.|リバースの一日の結果はクォーター買付または分割売却です。
리버스 첫날은 매수 없이 MOC 매도만 합니다.|リバース初日は買付をせずMOC売却のみです。
리버스 첫날 MOC 매도 체결을 기록한 뒤 확정하세요.|リバース初日のMOC売却約定を記録してから確定してください。
리버스 매도 수량을 확인하세요. 부분 체결일은 아직 확정하지 마세요.|リバース売却数量を確認してください。一部約定の日はまだ確定しないでください。
무한매수법에는 VR 사이클을 넣을 수 없습니다.|無限買付法にはVRサイクルを入力できません。
다음 VR 사이클은 이전 시작일의 14일 뒤입니다. 누락된 사이클을 순서대로 기록하세요.|次のVRサイクルは前回開始日の14日後です。未記録のサイクルを順に入力してください。
G는 1~1000 정수입니다.|Gは1～1000の整数です。
같은 사이클의 적립과 인출 중 하나만 입력하세요.|同じサイクルでは積立か取崩しの一方だけを入力してください。
전략의 적립·거치·인출 방식과 금액이 다릅니다.|戦略の積立・据置・取崩方式と金額が一致しません。
최초 사이클은 시작 자금과 초기 매수를 먼저 기록하고 적립·인출은 0으로 시작하세요.|初回は開始資金と初期買付を先に記録し、積立・取崩額は0で開始してください。
인출 후 V 또는 잔금이 부족합니다.|取崩し後のVまたは現金が不足しています。
VR 최초 매수 또는 보유수량을 먼저 기록하세요.|VRの初回買付または保有数量を先に記録してください。
전략 설정이 필요합니다.|戦略設定が必要です。
평가가격은 마지막 기록 날짜 이후여야 합니다.|評価価格は最後の記録日以降である必要があります。
예약된 기록 필드입니다.|予約された記録フィールドです。
주문 기준 날짜를 입력하세요.|注文の基準日を入力してください。
마지막 기록보다 이전 날짜로 주문표를 만들 수 없습니다.|最後の記録より前の日付では注文表を作成できません。
주문표는 정수 주식만 지원합니다.|注文表は整数株数のみに対応しています。
먼저 VR 최초 사이클을 시작하세요.|先にVRの初回サイクルを開始してください。
VR 보유수량이 0주인 경우의 재시작 세칙을 확인해야 합니다.|VR保有数量が0株の場合の再開始ルールを確認する必要があります。
다음 VR 사이클을 먼저 시작하세요.|次のVRサイクルを先に開始してください。
체결 내역의 하루 결과를 먼저 확정하세요.|約定履歴の一日の結果を先に確定してください。
확정한 종가 다음 거래일의 주문 날짜를 입력하세요.|確定終値の翌取引日以降の注文日を入力してください。
리버스 매도 수량이 0주입니다. 소량 보유 세칙 확인이 필요합니다.|リバース売却数量が0株です。少量保有の詳細ルール確認が必要です。
직전 5거래일 종가 5개가 필요합니다.|直前5取引日の終値が5つ必要です。
종가는 서로 다른 이전 거래일 5개를 입력하세요.|終値には異なる直前5取引日を入力してください。
계산된 주문 가격이 0 이하입니다. 입력값을 확인하세요.|計算された注文価格が0以下です。入力値を確認してください。
다른 기기에서 전략을 변경했습니다. 새로고침 후 다시 확인하세요.|別の端末で戦略が変更されました。更新して再確認してください。
이 가계부에 접근할 수 없습니다.|この家計簿にアクセスできません。
전략 데이터 형식 또는 크기를 확인하세요.|戦略データの形式またはサイズを確認してください。
잔여 현금이 부족합니다.|現金残高が不足しています。
보유 수량보다 많이 매도할 수 없습니다.|保有数量を超えて売却できません。
소수 8자리 이내의 숫자 문자열이 필요합니다.|小数点以下8桁以内の数値文字列が必要です。
0보다 커야 합니다.|0より大きい値が必要です。
마지막 거래보다 오래된 평가가격입니다.|最後の取引より古い評価価格です。
처리하지 못했습니다|処理できませんでした
최근 전략 변경이력|最近の戦略変更履歴
변경된 기록|変更された記録
삭제 기록 복구|削除した記録を復元
복구할 삭제 기록을 찾을 수 없습니다.|復元する削除済み記録が見つかりません。
이미 같은 기록이 있습니다.|同じ記録が既に存在します。
거래 날짜는 미국 거래일을 입력합니다.|取引日には米国の取引日を入力してください。
이전 변경이력 보기|以前の変更履歴を見る
주가 확인|株価を確認
시세·차트 열기|株価・チャートを開く
시세·차트|株価・チャート
TradingView · USD · 지연 가능|TradingView · USD · 遅延の可能性あり
출처: TradingView · USD|提供元: TradingView · USD
제공처에 따라 지연될 수 있습니다. 차트의 거래 시간과 시장 상태를 확인하세요.|提供元によって遅延する場合があります。チャートの取引時間と市場の状態を確認してください。
화면이 표시되지 않으면 아래 종목 페이지에서 확인하세요.|表示されない場合は、下の銘柄ページで確認してください。
이 화면의 가격은 확인용입니다. 평가가격·확정 종가·체결 기록에 자동으로 저장되지 않습니다.|表示価格は参照用です。評価価格・確定終値・約定記録には自動保存されません。
이렇게 사용하세요|使い方
주문 전|注文前
체결 후|約定後
장 마감 후|市場終了後
2주마다|2週間ごと
현재 기록으로 매수·매도 가격과 수량을 계산하고 증권사에서 주문하세요.|現在の記録から売買価格と数量を計算し、証券会社で注文してください。
주문 가격·수량 보기|注文価格・数量を確認
증권사에서 실제로 체결된 수량·가격·수수료를 기록하세요.|証券会社で実際に約定した数量・価格・手数料を記録してください。
그날 체결을 모두 기록한 뒤 T값과 다음 매매 단계를 갱신합니다.|当日の約定をすべて記録してから、T値と次の取引段階を更新します。
새 사이클의 V·밴드·매수 한도를 갱신합니다. 매일 확정할 필요는 없습니다.|新しいサイクルのV・バンド・買付上限を更新します。毎日の確定は不要です。
오늘 체결 마감 · T값 갱신|当日の約定を確定・T値更新
2주 사이클 시작·갱신|2週間サイクル開始・更新
처음에는 입금부터 기록하세요. 주문표를 보는 것만으로 잔금이나 보유수량이 바뀌지 않습니다.|最初は入金から記録してください。注文表の確認だけでは残高や保有数量は変わりません。
손익 계산용 평가가격 입력|損益計算用の評価価格を入力
미확정 체결이 있습니다. 장 마감 후 T값을 갱신하세요.|未確定の約定があります。市場終了後にT値を更新してください。
체결 마감으로 T값을 갱신한 뒤 다음 거래일 주문표를 계산합니다.|約定確定でT値を更新してから、次の取引日の注文表を計算します。
미국 장 마감 후 사용하는 기능입니다. 이미 입력한 체결을 기준으로 T값·일반/리버스모드·사이클을 갱신합니다.|米国市場終了後に使います。入力済みの約定を基にT値・通常/リバースモード・サイクルを更新します。
예: 일반모드에서 하루 전체 예산을 매수하면 T가 1 증가합니다. 체결 건수만큼 증가하지 않습니다.|例：通常モードで1日分の全予算を買付するとTが1増えます。約定件数ごとには増えません。
아래 선택은 체결 기록을 대신하지 않습니다. 실제 매수·매도 기록을 먼저 입력하세요.|以下の選択は約定記録の代わりではありません。実際の売買を先に記録してください。
증권사에 입력할 주문 가격·수량·방식을 미리 계산합니다. 계산만으로 주문되거나 체결 기록이 생기지는 않습니다.|証券会社に入力する注文価格・数量・方式を事前に計算します。計算だけでは発注も約定記録の作成も行いません。
무한매수는 직전 거래일의 체결 마감을, VR은 현재 2주 사이클을 먼저 확인하세요.|無限買付は前取引日の約定確定を、VRは現在の2週間サイクルを先に確認してください。
시세·차트는 외부 제공 화면입니다. 손익에는 직접 저장한 평가가격을 사용합니다. 원화 환산·세금 추정·주식분할 자동 처리는 지원하지 않습니다.|株価・チャートは外部提供の画面です。損益は手動保存した評価価格で計算します。ウォン換算・税額推定・株式分割の自動処理は未対応です。
토스 PC 시세 열기 ↗|Toss PC株価を開く ↗
이 PC에서 연결 프로그램을 실행한 뒤 이용하세요. 토스 현재가는 5초 간격으로 조회합니다.|このPCで接続プログラムを起動してからご利用ください。Tossの現在値は5秒間隔で取得します。


포트폴리오|ポートフォリオ
우리집 포트폴리오|わが家のポートフォリオ
목표 비중 설정|目標比率の設定
가장 큰 자산 종류|最も大きい資産区分
가장 큰 계좌·자산|最も大きい口座・資産
총자산 대비 부채|総資産に対する負債
목표와 현재 비중|目標と現在の比率
추가 자금 배분 계산|追加資金の配分計算
부채를 제외한 총자산 기준입니다. 목표자금도 해당 계좌의 자산에 한 번만 포함됩니다.|負債を除く総資産が基準です。目的別資金も該当口座の資産に一度だけ含まれます。
이 범위의 목표는 부부가 함께 사용합니다.|この範囲の目標は夫婦で共有します。
목표 비중이 없습니다. 직접 정한 비중의 합계가 100%가 되도록 설정하세요.|目標比率がありません。ご自身で決めた比率の合計が100%になるよう設定してください。
분류를 마치면 추가 자금 배분을 계산할 수 있습니다.|分類後に追加資金の配分を計算できます。
등록된 자산 금액이 없어 현재 비중을 계산하지 않습니다.|登録された資産金額がないため、現在比率は計算しません。
현재 금액|現在金額
허용 차이|許容差
비교 전|比較前
목표 초과|目標超過
목표 미달|目標未満
허용 범위|許容範囲
분류 필요|要分類
투입 후 비중|投入後の比率
차이|差
상태|状態
목표 초과·미달은 입력한 기준과의 차이입니다. 계좌 안의 종목 구성이나 연금 안의 투자 비중은 분석하지 않습니다.|目標超過・未満は入力した基準との差です。口座内の銘柄構成や年金内の投資比率は分析しません。
목표자금 확인|目的別資金の確認
미배정 현금|未配分の現金
현금·예적금에서 확보한 목표자금|現金・預貯金で確保した目的別資金
목표자금은 그대로 유지합니다. 추가 자금 계산에는 아직 계좌 잔액에 반영하지 않은 새 돈만 입력하세요.|目的別資金は維持されます。追加資金の計算には、まだ口座残高に反映していない新しい資金だけを入力してください。
자산·목표자금 보기|資産・目的別資金を見る
포트폴리오 계산 안내|ポートフォリオ計算の案内
전체 가구와 소유자별 목표는 각각 설정합니다. 소유자 변경 시 해당 범위의 현재 비중도 달라집니다.|世帯全体と所有者別の目標はそれぞれ設定します。所有者を変えると、その範囲の現在比率も変わります。
허용 차이는 목표에서 벗어나도 허용할 비중 차이입니다. 예를 들어 목표 30%, 허용 차이 5%p이면 25~35%가 허용 범위입니다. 5%p는 초기 입력값이며 권장 투자 기준이 아닙니다.|許容差は目標からの比率のずれの許容幅です。目標30%、許容差5%pなら25〜35%が許容範囲です。5%pは初期入力値であり、推奨する投資基準ではありません。
자산 종류와 계좌 규모를 비교하는 기능입니다. 같은 계좌 안의 종목 집중도, 레버리지 상품 비중, 투자 수익률은 계산하지 않습니다.|資産区分と口座規模を比較する機能です。口座内の銘柄集中度、レバレッジ商品の比率、投資収益率は計算しません。
추가 자금은 투입 후 목표금액의 부족분에 비례해 나눕니다. 기존 자산을 매도하지 않으므로 목표 비중에 완전히 도달하지 않을 수 있습니다. 세금·수수료·매수 단위는 반영하지 않습니다.|追加資金は投入後の目標金額の不足分に比例して配分します。既存資産を売却しないため、目標比率に完全には届かない場合があります。税金・手数料・購入単位は反映しません。
계산은 실제 송금·매매·거래 기록을 만들지 않습니다.|計算しても実際の送金・売買・取引記録は作成されません。
자산 배분과 리밸런싱 참고자료 (Investor.gov)|資産配分とリバランスの参考資料 (Investor.gov)
비중 합계는 100%여야 합니다. 사용하지 않는 자산 종류는 0을 입력하세요.|比率の合計は100%にしてください。使わない資産区分には0を入力してください。
허용 차이 5%p는 초기 입력값이며 권장 투자 기준이 아닙니다.|許容差5%pは初期入力値であり、推奨する投資基準ではありません。
비중 합계|比率の合計
이 범위의 목표 비중을 저장할까요? 배우자에게도 같은 목표가 표시됩니다.|この範囲の目標比率を保存しますか？パートナーにも同じ目標が表示されます。
목표 비중을 저장했습니다.|目標比率を保存しました。
목표 비중을 확인해 주세요.|目標比率を確認してください。
비중은 0~100 사이 소수 둘째 자리까지 입력하세요.|比率は0〜100の範囲で小数第2位まで入力してください。
목표 비중의 합계는 100%여야 합니다.|目標比率の合計は100%にしてください。
허용 차이는 0~100 사이 소수 둘째 자리까지 입력하세요.|許容差は0〜100の範囲で小数第2位まで入力してください。
다른 기기에서 목표 비중을 변경했습니다. 새로고침 후 다시 확인하세요.|別の端末で目標比率が変更されました。更新して再確認してください。
먼저 이 범위의 목표 비중을 설정하세요.|先にこの範囲の目標比率を設定してください。
미분류 자산의 종류를 지정한 뒤 계산하세요.|未分類資産の区分を設定してから計算してください。
추가 자금은 0보다 큰 금액으로 소수 둘째 자리까지 입력하세요.|追加資金は0より大きい金額を小数第2位まで入力してください。
계산 가능한 금액 범위를 초과했습니다.|計算可能な金額の範囲を超えました。
새로 들어올 금액 (원)|新たに入る金額（ウォン）
아직 계좌 잔액에 반영하지 않은 외부 추가 자금만 입력하세요. 기존 현금을 다시 입력하면 중복 계산됩니다.|まだ口座残高に反映していない外部からの追加資金だけを入力してください。既存の現金を再入力すると二重計算になります。
추가 자금 배분안|追加資金の配分案
추가 자금|追加資金
투입 후 총자산|投入後の総資産
추가 배분|追加配分
화면에 불러온 잔액과 목표로 계산한 결과입니다. 잔액이나 목표가 바뀌면 다시 계산하세요.|画面に読み込んだ残高と目標で計算した結果です。残高や目標が変わったら再計算してください。
부족분에 비례해 배분한 금액입니다. 기존 자산 매도 없이 목표에 완전히 도달하지 않을 수 있습니다.|不足分に比例した配分額です。既存資産の売却なしでは目標に完全に届かない場合があります。
계산|計算
현재|現在
닫기|閉じる

월별 자산 결산|月別の資産集計
이번 달 결산 다시 저장|今月の集計を保存し直す
이번 달 결산 저장|今月の集計を保存
이번 달로 이동|今月へ移動
저장 시점의 계좌 금액|保存時点の口座金額
결산 순자산|集計時の純資産
결산 자산|集計時の資産
결산 부채|集計時の負債
저장일시|保存日時
이 월에 저장한 결산이 없습니다. 현재 잔액으로 과거 기록을 만들지 않습니다.|この月の集計はありません。現在の残高から過去の記録は作成しません。
전월 대비 순자산|前月比の純資産
자산 증감|資産の増減
부채 증감|負債の増減
전월 기록이 없어 전월 대비 증감을 계산하지 않습니다.|前月の記録がないため、前月比は計算しません。
입출금과 평가변동이 함께 반영된 잔액 변화입니다. 투자 수익률이 아닙니다.|入出金と評価変動を含む残高の変化です。投資収益率ではありません。
월별 결산 표|月別集計表
저장한 결산이 없습니다.|保存した集計はありません。
저장 당시 계좌 보기|保存時の口座を見る
이 소유자의 저장된 계좌가 없습니다.|この所有者の保存済み口座はありません。
결산 안내|集計の案内
한국·일본 시간 기준 이번 달만 저장할 수 있습니다. 저장한 뒤 계좌 금액이나 소유자를 바꿔도 이전 결산은 유지됩니다.|韓国・日本時間の今月のみ保存できます。保存後に金額や所有者を変えても、過去の集計は維持されます。
같은 달에는 확인 후 최신 잔액으로 다시 저장할 수 있습니다. 지난달 결산은 덮어쓰지 않습니다.|同じ月は確認後に最新残高で保存し直せます。過去の月の集計は上書きしません。
계좌 금액은 자동 조회되지 않습니다. 결산 전에 현재 잔액을 확인하세요. 이번 달 중간에 저장한 기록은 월말 확정액이 아닙니다.|口座金額は自動取得されません。集計前に現在残高を確認してください。月途中の記録は月末確定額ではありません。
이번 달만 결산을 저장할 수 있습니다. 조회 월을 확인해 주세요.|今月のみ集計を保存できます。表示月を確認してください。
이번 달 결산을 서버의 최신 계좌 금액으로 다시 저장할까요? 기존 이번 달 결산이 바뀝니다.|サーバー上の最新口座金額で今月の集計を保存し直しますか？既存の今月の集計が変更されます。
서버에 등록된 현재 자산·부채를 이번 달 결산으로 저장할까요? 실제 계좌 잔액을 먼저 확인해 주세요.|サーバーに登録された現在の資産・負債を今月の集計として保存しますか？先に実際の残高を確認してください。
이번 달 자산 결산을 저장했습니다.|今月の資産集計を保存しました。
다른 기기에서 결산을 변경했습니다. 새로고침 후 다시 확인하세요.|別の端末で集計が変更されました。更新して再確認してください。
가계부를 찾을 수 없습니다.|家計簿が見つかりません。
결산을 저장하면 순자산 그래프가 표시됩니다.|集計を保存すると純資産グラフが表示されます。
최근 12개월 순자산 추이|直近12か月の純資産推移
저장한 월의 금액만 표시합니다. 기록이 없는 월은 선을 연결하지 않습니다.|保存した月の金額だけ表示します。記録のない月は線をつなぎません。
단위: 원|単位：ウォン

현금과 목표자금|現金と目的別資金
자금 배정|資金を割り当て
현금성 계좌 기준|現金口座に基づく
투자 검토 가능한 현금|投資を検討できる現金
보유현금|保有現金
현금에서 확보한 목표자금|現金から確保した目的別資金
예적금에서 확보한 금액|預金・積立から確保した金額
배정액이 계좌 잔액보다 큽니다. 배정을 확인해 주세요.|割当額が口座残高を超えています。割り当てを確認してください。
계산 기준|計算方法
현금성 계좌의 잔액에서 배정한 금액을 뺍니다. 예적금·주식은 바로 쓸 수 있는 현금에 포함하지 않습니다.|現金口座の残高から割当額を差し引きます。預金・積立・株式はすぐ使える現金に含めません。
미등록 카드값이나 예정지출은 차감되지 않습니다. 이 금액은 미배정 현금이며 자동 투자 권고가 아닙니다.|未登録のカード代や予定支出は控除されません。この金額は未割当現金であり、自動的な投資推奨ではありません。
배정은 실제 이체나 저축 거래를 만들지 않습니다. 목표 진행률과 계좌 확보액은 서로 다른 지표입니다.|割り当ては実際の送金や貯蓄取引を作成しません。目標進捗と口座確保額は別の指標です。
계좌별 배정 한도|口座別の割当上限
자산 종류를 현금성 또는 예적금으로 지정해 주세요.|資産の種類を現金または預金・積立に指定してください。
배정 내역|割当履歴
배정 수정|割当を編集
배정 해제|割当を解除
배정 내역이 없습니다.|割当履歴はありません。
먼저 현금성 또는 예적금 계좌를 등록해 주세요.|先に現金または預金・積立口座を登録してください。
먼저 목표 저축에서 목표를 만들어 주세요.|先に目的別貯金で目標を作成してください。
목표자금 배정|目的別資金の割り当て
자금을 보관하는 계좌|資金を保管する口座
계좌 선택|口座を選択
확보할 목표|確保する目標
목표 선택|目標を選択
이 목표에 배정할 총액 (원)|この目標に割り当てる総額（ウォン）
추가 금액이 아닌, 이 계좌에서 이 목표에 확보할 최종 총액을 입력하세요.|追加額ではなく、この口座からこの目標に確保する最終総額を入力してください。
계좌와 목표를 선택해 주세요.|口座と目標を選択してください。
이 목표에 배정 가능한 최대 금액|この目標に割当可能な最大額
현재 배정|現在の割当
배정액은 0보다 커야 합니다. 해제는 배정 해제 버튼을 사용하세요.|割当額は0より大きくしてください。解除には割当解除ボタンを使ってください。
현재 배정 총액을 입력한 금액으로 바꿀까요?|現在の割当総額を入力した金額に変更しますか？
목표자금을 배정했습니다.|目的別資金を割り当てました。
이 배정을 해제할까요? 계좌 잔액과 거래내역은 바뀌지 않습니다.|この割り当てを解除しますか？口座残高と取引履歴は変更されません。
자금 배정을 해제했습니다.|資金の割り当てを解除しました。
배정 금액을 확인해 주세요.|割当金額を確認してください。
계좌를 찾을 수 없습니다.|口座が見つかりません。
같은 가계부의 목표만 연결할 수 있습니다.|同じ家計簿の目標にのみリンクできます。
다른 기기에서 배정을 변경했습니다. 새로고침 후 다시 확인하세요.|別の端末で割り当てが変更されました。更新して再確認してください。
현금성 또는 예적금 계좌만 배정할 수 있습니다.|現金または預金・積立口座のみ割り当てできます。
보관한 목표에는 배정액을 늘릴 수 없습니다.|保管した目標の割当額は増やせません。
계좌 잔액을 초과하여 배정할 수 없습니다.|口座残高を超えて割り当てできません。
먼저 목표자금 배정을 줄이거나 해제해 주세요. 계좌 잔액과 종류를 변경할 수 없습니다.|先に目的別資金の割り当てを減額または解除してください。口座残高と種類を変更できません。
목표자금 배정이 남아 있습니다. 먼저 배정을 해제해 주세요.|目的別資金の割り当てが残っています。先に解除してください。
계좌에서 확보한 금액|口座で確保した金額
잔액|残高
배정|割当

우리집 자산, 한눈에|わが家の資産をひと目で
계좌·자산 이름|口座・資産名
소유자를 선택해 주세요.|所有者を選択してください。
자산 종류를 선택해 주세요.|資産の種類を選択してください。
계좌·자산 이름을 입력해 주세요.|口座・資産名を入力してください。
현재 금액 (원)|現在の金額（ウォン）
분류 메모 (기존 입력)|分類メモ（既存の入力）
자산은 현재 평가액, 부채는 남은 원금을 양수로 입력하세요. 소유자는 입력자와 별개입니다.|資産は現在の評価額、負債は残元金を正の数で入力してください。所有者と入力者は別です。
소유자 필터|所有者フィルター
소유자|所有者
미지정|未指定
자산 종류|資産の種類
미분류|未分類
현금성|現金・預り金
예적금|預金・積立
주식·ETF|株式・ETF
연금|年金
부동산|不動産
기타 자산|その他の資産
합계|合計
전체 가구|世帯全体
총자산|総資産
등록 계좌·자산|登録済み口座・資産
현재 등록 금액 기준 · 월 필터와 별개|現在の登録額に基づきます・月フィルターとは独立
자산 구성|資産構成
부채 제외 · 총자산 기준|負債を除く・総資産に対する割合
자산 금액을 등록하면 구성 그래프가 표시됩니다.|資産額を登録すると構成グラフが表示されます。
계좌별 금액 펼쳐보기|口座別の金額を見る
표시할 자산이 없습니다.|表示する資産がありません。
부채 내역|負債の内訳
등록된 부채가 없습니다.|登録された負債はありません。
자산 분류 점검|資産分類の確認
소유자 미지정|所有者未指定
자산 미분류|資産未分類
기존 기록의 소유자와 종류를 지정하면 사람별 자산을 정확하게 볼 수 있습니다.|既存の記録に所有者と種類を指定すると、人別の資産を正確に表示できます。
등록한 자산의 소유자와 종류가 모두 지정되어 있습니다.|登録した資産の所有者と種類はすべて指定済みです。
미지정 기록 보기|未指定の記録を見る
자산 등록 안내|資産登録の案内
한 계좌의 같은 돈은 한 번만 등록하세요. 계좌 합계와 그 안의 종목을 동시에 더하면 중복 계산됩니다.|同じ口座のお金は一度だけ登録してください。口座合計と中の銘柄を両方加算すると二重計上になります。
목표 저축의 모은 금액은 자산에 다시 더하지 않습니다. 거래를 기록해도 이 화면의 잔액은 자동으로 변경되지 않습니다.|目的別貯金の金額は資産に重ねて加算しません。取引を記録しても、この画面の残高は自動変更されません。
소유자를 모르는 기존 기록은 미지정으로 보존합니다. 예전 분류 내용은 분류 메모에 남습니다.|所有者不明の既存記録は未指定で保存します。従来の分類内容は分類メモに残ります。
음수 순자산은 부채가 자산보다 많은 상태입니다. 자산과 부채는 모두 양수로 입력하세요.|純資産がマイナスなら負債が資産を上回っています。資産・負債はどちらも正の数で入力してください。

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
견본 바탕은 배경색, 안쪽 막대는 버튼색입니다.|見本の背景が背景色、内側のバーがボタンの色です。
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
` .trim().split('\n').filter(line=>line.includes('|')).map(line=>line.split('|')));
  const translationKeys=Object.keys(JA).sort((a,b)=>b.length-a.length);
  const translationPattern=new RegExp(translationKeys.map(k=>k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');
  function translateText(text) {
    if(appearance.language!=='ja')return text;
    return String(text).replace(translationPattern,key=>JA[key])
      .replace(/(\d[\d,.]*)원/g,'$1ウォン').replace(/(\d[\d,.]*)억/g,'$1億').replace(/(\d[\d,.]*)만/g,'$1万').replace(/(\d+)건/g,'$1件').replace(/(\d+)개월/g,'$1か月')
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
      if(option && ['category_name','saving_goal_id','funding_account_id','funding_goal_id','accountId'].includes(option.parentElement.name) && option.value && option.value!=='__new_category__')continue;
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

  const assetOwners=['미지정','남편','아내','공동'];
  const assetTypes=[['unclassified','미분류'],['cash','현금성'],['deposit','예적금'],['stock','주식·ETF'],['pension','연금'],['real_estate','부동산'],['other','기타 자산']];
  let assetOwnerFilter='all';
  function ownerOf(account) {return assetOwners.includes(account.owner_label)?account.owner_label:'미지정';}
  function typeOf(account) {return assetTypes.some(([id])=>id===account.asset_type)?account.asset_type:'unclassified';}
  function assetSummary(accounts,owner='all') {
    const selected=accounts.filter(a=>owner==='all'||ownerOf(a)===owner);
    const assetRows=selected.filter(a=>a.kind==='asset'), debtRows=selected.filter(a=>a.kind==='liability');
    const assets=sum(assetRows),debt=sum(debtRows);
    return {selected,assetRows,debtRows,assets,debt,net:assets-debt,
      unassigned:accounts.filter(a=>ownerOf(a)==='미지정').length,
      unclassified:accounts.filter(a=>a.kind==='asset'&&typeOf(a)==='unclassified').length,
      groups:assetTypes.map(([id,label])=>({id,label,amount:sum(assetRows.filter(a=>typeOf(a)===id)),count:assetRows.filter(a=>typeOf(a)===id).length})).filter(g=>g.count)};
  }
  function accountFields(r) { return select('kind','구분',[['asset','자산'],['liability','부채']],r.kind||'asset')+
    field('name','계좌·자산 이름',r.name||'','text','required maxlength="120"')+
    select('owner_label','소유자',assetOwners.map(x=>[x,x]),ownerOf(r))+
    select('asset_type','자산 종류',assetTypes,typeOf(r))+
    field('amount','현재 금액 (원)',r.amount??'','number','required min="0" step="0.01"')+
    field('category','분류 메모 (기존 입력)',r.category||'')+
    '<p>자산은 현재 평가액, 부채는 남은 원금을 양수로 입력하세요. 소유자는 입력자와 별개입니다.</p>'; }
  function accountKindChanged(form) { const debt=form.elements.kind.value==='liability';const input=form.elements.asset_type;input.disabled=debt;input.closest('label').hidden=debt; }
  function normalizeAccountFields(record) {
    if(!assetOwners.includes(record.owner_label))throw Error('소유자를 선택해 주세요.');
    if(record.kind==='liability')record.asset_type='unclassified';
    if(!assetTypes.some(([k])=>k===record.asset_type))throw Error('자산 종류를 선택해 주세요.');
    record.name=record.name.trim(); if(!record.name)throw Error('계좌·자산 이름을 입력해 주세요.');
    return record;
  }
  function assetsDashboard() {
    const s=assetSummary(data.accounts,assetOwnerFilter);
    const colors={cash:'#66839e',deposit:'#9cafc0',stock:'#9b85b6',pension:'#bcabd4',real_estate:'#b2a078',other:'#83a49c',unclassified:'#9295a2'};
    const missing=s.unassigned+s.unclassified;
    const line=a=>`<article class="oh-asset-account"><div><h3>${userText(a.name)}</h3><small>${esc(ownerOf(a))} · ${labels[a.kind]}${a.category?' · '+userText(a.category):''}</small></div><div class="oh-asset-account-end"><strong>${won(a.amount)}</strong><div>${btn('account','수정',a.id)}${btn('delete-account','삭제',a.id)}</div></div></article>`;
    return `<section class="oh-asset-heading"><div><small>OUR HOME · ASSETS</small><h2>우리집 자산, 한눈에</h2></div>${btn('account','＋ 자산·부채 추가')}</section><div class="oh-asset-filters" aria-label="소유자 필터">${['all','남편','아내','공동','미지정'].map(o=>`<button type="button" data-action="asset-filter" data-id="${o}" aria-pressed="${assetOwnerFilter===o}">${o==='all'?'합계':o}</button>`).join('')}</div>
    <section class="oh-asset-overview"><small>${assetOwnerFilter==='all'?'전체 가구':esc(assetOwnerFilter)} · 순자산</small><div class="oh-asset-net" aria-live="polite">${won(s.net)}</div><div class="oh-asset-subtotals"><div><small>총자산</small><strong>${won(s.assets)}</strong></div><div><small>부채</small><strong>${won(s.debt)}</strong></div><div><small>등록 계좌·자산</small><strong>${s.selected.length}건</strong></div></div><small>현재 등록 금액 기준 · 월 필터와 별개</small></section>
    ${assetHistoryPanel()}<div class="oh-asset-columns"><div><section class="card"><div class="oh-asset-heading"><h2>자산 구성</h2><small>부채 제외 · 총자산 기준</small></div>${s.assets>0?`<div class="oh-asset-stack" role="img" aria-label="${s.groups.map(g=>`${g.label} ${(g.amount/s.assets*100).toFixed(1)}%`).join(', ')}">${s.groups.filter(g=>g.amount>0).map(g=>`<span style="width:${g.amount/s.assets*100}%;background:${colors[g.id]}"></span>`).join('')}</div>`:'<p>자산 금액을 등록하면 구성 그래프가 표시됩니다.</p>'}
    ${s.groups.map(g=>`<div class="oh-asset-composition-row"><span><i style="background:${colors[g.id]}"></i>${g.label}</span><strong>${won(g.amount)}</strong><small>${s.assets?(g.amount/s.assets*100).toFixed(1):'0.0'}%</small></div>`).join('')}
    <details data-asset-detail="accounts"><summary>계좌별 금액 펼쳐보기</summary>${s.assetRows.length?s.assetRows.map(line).join(''):'<p>표시할 자산이 없습니다.</p>'}</details></section>
    <section class="card"><h2>부채 내역</h2>${s.debtRows.length?s.debtRows.map(line).join(''):'<p>등록된 부채가 없습니다.</p>'}</section></div>
    <aside>${fundingPanel()}<section class="card"><h2>자산 분류 점검</h2><small>전체 가구 기준</small><div class="oh-asset-composition-row"><span>소유자 미지정</span><strong>${s.unassigned}건</strong></div><div class="oh-asset-composition-row"><span>자산 미분류</span><strong>${s.unclassified}건</strong></div><p>${missing?'기존 기록의 소유자와 종류를 지정하면 사람별 자산을 정확하게 볼 수 있습니다.':'등록한 자산의 소유자와 종류가 모두 지정되어 있습니다.'}</p>${s.unassigned?btn('asset-filter','미지정 기록 보기','미지정'):''}</section>
    <section class="card"><h2>자산 등록 안내</h2><details data-asset-detail="help"><summary>ⓘ 사용 안내</summary><p>한 계좌의 같은 돈은 한 번만 등록하세요. 계좌 합계와 그 안의 종목을 동시에 더하면 중복 계산됩니다.</p><p>목표 저축의 모은 금액은 자산에 다시 더하지 않습니다. 거래를 기록해도 이 화면의 잔액은 자동으로 변경되지 않습니다.</p><p>소유자를 모르는 기존 기록은 미지정으로 보존합니다. 예전 분류 내용은 분류 메모에 남습니다.</p><p>음수 순자산은 부채가 자산보다 많은 상태입니다. 자산과 부채는 모두 양수로 입력하세요.</p></details></section></aside></div>`;
  }
  const ASSET_STYLES=`
    #ourhome-v11 .oh-asset-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
    #ourhome-v11 .oh-asset-filters{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0}
    #ourhome-v11 .oh-asset-filters button{background:var(--oh-surface);color:var(--oh-ink);border:1px solid var(--oh-line)}
    #ourhome-v11 .oh-asset-filters button[aria-pressed=true]{background:var(--oh-button);color:var(--oh-button-text);border-color:var(--oh-button)}
    #ourhome-v11 .oh-asset-overview{background:var(--oh-soft)!important;color:var(--oh-ink)!important;border:1px solid var(--oh-line);padding:28px;border-radius:24px;margin:18px 0}
    #ourhome-v11 .oh-asset-net{font-size:clamp(28px,4.8vw,46px);font-weight:700;letter-spacing:-1.4px;margin:10px 0 20px;color:var(--oh-ink)!important;-webkit-text-fill-color:var(--oh-ink)!important;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
    #ourhome-v11 .oh-asset-subtotals{display:flex;flex-wrap:wrap;gap:24px 38px;margin-bottom:18px}#ourhome-v11 .oh-asset-subtotals strong{display:block;font-size:19px;color:var(--oh-ink)!important;-webkit-text-fill-color:var(--oh-ink)!important}
    #ourhome-v11 .oh-asset-columns{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:18px}
    #ourhome-v11 .oh-asset-stack{display:flex;height:17px;border-radius:9px;overflow:hidden;margin:24px 0 18px}#ourhome-v11 .oh-asset-stack span{display:block;height:100%}
    #ourhome-v11 .oh-asset-composition-row{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:12px 0;border-bottom:1px solid var(--oh-line)}#ourhome-v11 .oh-asset-composition-row>span{flex:1;min-width:90px}#ourhome-v11 .oh-asset-composition-row strong{font-size:15px;color:var(--oh-ink)!important}#ourhome-v11 .oh-asset-composition-row i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:8px}
    #ourhome-v11 .oh-asset-account{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:18px 0;border-bottom:1px solid var(--oh-line)}#ourhome-v11 .oh-asset-account-end{text-align:right}#ourhome-v11 .oh-asset-account-end strong{display:block;color:var(--oh-ink)!important}#ourhome-v11 .oh-asset-account button{padding:7px 10px;font-size:12px}
    #ourhome-v11 .oh-asset-columns details{margin-top:20px}#ourhome-v11 .oh-asset-columns summary{cursor:pointer;padding:8px 0;color:var(--oh-ink)}
    @media(max-width:700px){#ourhome-v11 .oh-asset-columns{grid-template-columns:1fr;gap:0}#ourhome-v11 .oh-asset-overview{padding:22px}#ourhome-v11 .oh-asset-filters button{padding:10px 12px}}
  `;

  function fundingSummary(accounts,allocations,owner='all') {
    const selected=accounts.filter(a=>a.kind==='asset'&&(owner==='all'||ownerOf(a)===owner));
    const eligible=selected.filter(a=>['cash','deposit'].includes(typeOf(a)));
    const list=eligible.map(a=>{const reserved=Math.round(sum(allocations.filter(r=>r.account_id===a.id))*100)/100;return {account:a,reserved,available:Math.max(0,Math.round((Number(a.amount)-reserved)*100)/100),over:Math.max(0,Math.round((reserved-Number(a.amount))*100)/100)};});
    const cash=list.filter(r=>typeOf(r.account)==='cash');
    return {list,cash:sum(cash.map(r=>({amount:r.account.amount}))),reserved:cash.reduce((s,r)=>s+r.reserved,0),available:cash.reduce((s,r)=>s+r.available,0),over:list.reduce((s,r)=>s+r.over,0),depositReserved:list.filter(r=>typeOf(r.account)==='deposit').reduce((s,r)=>s+r.reserved,0)};
  }
  function fundingPanel() {
    const f=fundingSummary(data.accounts,data.goal_allocations||[],assetOwnerFilter);
    const selectedIds=new Set(f.list.map(r=>r.account.id)), entries=(data.goal_allocations||[]).filter(r=>selectedIds.has(r.account_id));
    const goalName=id=>data.saving_goals.find(g=>g.id===id)?.name||'목표';
    return `<section class="card oh-funding-panel"><div class="oh-asset-heading"><h2>현금과 목표자금</h2>${btn('funding-new','＋ 자금 배정')}</div><small>${assetOwnerFilter==='all'?'전체 가구':esc(assetOwnerFilter)} · 현금성 계좌 기준</small><div class="oh-funding-total"><small>투자 검토 가능한 현금</small><strong>${won(f.available)}</strong></div><div class="oh-asset-composition-row"><span>보유현금</span><strong>${won(f.cash)}</strong></div><div class="oh-asset-composition-row"><span>현금에서 확보한 목표자금</span><strong>${won(f.reserved)}</strong></div><p>예적금에서 확보한 금액 ${won(f.depositReserved)}</p>${f.over?'<p role="alert">배정액이 계좌 잔액보다 큽니다. 배정을 확인해 주세요.</p>':''}<details data-asset-detail="funding-help"><summary>ⓘ 계산 기준</summary><p>현금성 계좌의 잔액에서 배정한 금액을 뺍니다. 예적금·주식은 바로 쓸 수 있는 현금에 포함하지 않습니다.</p><p>미등록 카드값이나 예정지출은 차감되지 않습니다. 이 금액은 미배정 현금이며 자동 투자 권고가 아닙니다.</p><p>배정은 실제 이체나 저축 거래를 만들지 않습니다. 목표 진행률과 계좌 확보액은 서로 다른 지표입니다.</p></details>
    <details data-asset-detail="funding-accounts"><summary>계좌별 배정 한도</summary>${f.list.map(r=>`<div class="oh-funding-line"><h3>${userText(r.account.name)}</h3><p>잔액 ${won(r.account.amount)} · 배정 ${won(r.reserved)} · 남음 ${won(r.available)}</p></div>`).join('')||'<p>자산 종류를 현금성 또는 예적금으로 지정해 주세요.</p>'}</details><details data-asset-detail="funding-list"><summary>배정 내역 ${entries.length}건</summary>${entries.map(r=>{const a=data.accounts.find(a=>a.id===r.account_id),g=data.saving_goals.find(g=>g.id===r.goal_id);return `<div class="oh-funding-line"><h3>${userText(goalName(r.goal_id))}${g&&!g.active?' <small>(보관)</small>':''}</h3><p>${userText(a?.name||'계좌')} · ${won(r.amount)}</p>${btn('funding-edit','배정 수정',r.id)}${btn('funding-release','배정 해제',r.id)}</div>`;}).join('')||'<p>배정 내역이 없습니다.</p>'}</details></section>`;
  }
  function fundingEditor(id='') {
    const entry=(data.goal_allocations||[]).find(r=>r.id===id);
    const accounts=data.accounts.filter(a=>a.kind==='asset'&&['cash','deposit'].includes(typeOf(a)));
    const goals=data.saving_goals.filter(g=>g.active||g.id===entry?.goal_id);
    if(!accounts.length)throw Error('먼저 현금성 또는 예적금 계좌를 등록해 주세요.');
    if(!goals.length)throw Error('먼저 목표 저축에서 목표를 만들어 주세요.');
    const d=$('#editor');
    d.innerHTML=`<h2>${entry?'배정 수정':'목표자금 배정'}</h2><form data-form="funding">${select('funding_account_id','자금을 보관하는 계좌',[['','계좌 선택'],...accounts.map(a=>[a.id,a.name+' · '+ownerOf(a)])],entry?.account_id||'')}${select('funding_goal_id','확보할 목표',[['','목표 선택'],...goals.map(g=>[g.id,g.name+(g.active?'':' (보관)')])],entry?.goal_id||'')}${field('amount','이 목표에 배정할 총액 (원)',entry?.amount??'','number','required')}<p id="funding-capacity" role="status"></p><p>추가 금액이 아닌, 이 계좌에서 이 목표에 확보할 최종 총액을 입력하세요.</p><button>저장</button>${btn('close','취소')}</form>`;
    const form=d.querySelector('form');for(const name of ['funding_account_id','funding_goal_id']){form.elements[name].required=true;if(entry)form.elements[name].disabled=true;}
    form.dataset.accountId=entry?.account_id||'';form.dataset.goalId=entry?.goal_id||'';
    d.showModal();fundingCapacity(form);
  }
  function fundingCapacity(form) {
    const aid=form.dataset.accountId||form.elements.funding_account_id.value,gid=form.dataset.goalId||form.elements.funding_goal_id.value;
    const account=data.accounts.find(a=>a.id===aid),target=form.querySelector('#funding-capacity');
    if(!account){target.textContent='계좌와 목표를 선택해 주세요.';return;}
    const other=sum((data.goal_allocations||[]).filter(r=>r.account_id===aid&&r.goal_id!==gid));
    const existing=(data.goal_allocations||[]).find(r=>r.account_id===aid&&r.goal_id===gid);
    form.dataset.expectedAmount=String(existing?.amount??0);
    target.textContent=`이 목표에 배정 가능한 최대 금액 ${won(Math.max(0,Number(account.amount)-other))} · 현재 배정 ${won(existing?.amount||0)}`;
    if(!form.dataset.accountId)form.elements.amount.value=existing?formatMoney(existing.amount):'';
  }
  async function submitFunding(form,f) {
    const accountId=form.dataset.accountId||f.funding_account_id,goalId=form.dataset.goalId||f.funding_goal_id,amount=number(f.amount);
    if(!accountId||!goalId)throw Error('계좌와 목표를 선택해 주세요.');
    if(amount<=0)throw Error('배정액은 0보다 커야 합니다. 해제는 배정 해제 버튼을 사용하세요.');
    const existing=(data.goal_allocations||[]).find(r=>r.account_id===accountId&&r.goal_id===goalId);
    if(existing&&!confirm('현재 배정 총액을 입력한 금액으로 바꿀까요?'))return;
    await checked(db.rpc('set_goal_allocation',{p_account_id:accountId,p_goal_id:goalId,p_amount:amount,p_expected_amount:number(form.dataset.expectedAmount??'0')}));
    $('#editor').close();await refresh(false);dashboard();notice('목표자금을 배정했습니다.');
  }
  async function releaseFunding(id) {
    const r=(data.goal_allocations||[]).find(r=>r.id===id);if(!r)return;
    if(!confirm('이 배정을 해제할까요? 계좌 잔액과 거래내역은 바뀌지 않습니다.'))return;
    await checked(db.rpc('set_goal_allocation',{p_account_id:r.account_id,p_goal_id:r.goal_id,p_amount:0,p_expected_amount:r.amount}));
    await refresh(false);dashboard();notice('자금 배정을 해제했습니다.');
  }
  const FUNDING_STYLES=`#ourhome-v11 .oh-funding-total{padding:18px 0}#ourhome-v11 .oh-funding-total strong{display:block;font-size:30px;color:var(--oh-ink)!important;-webkit-text-fill-color:var(--oh-ink)!important;overflow-wrap:anywhere}#ourhome-v11 .oh-funding-line{padding:14px 0;border-bottom:1px solid var(--oh-line)}#ourhome-v11 .oh-funding-line button{font-size:12px;padding:8px 10px}`;

  function settlementMonth(date=new Date()) {
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).formatToParts(date);
    return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;
  }
  function snapshotSummary(snapshot,owner='all') {
    if(!snapshot)return null;
    return assetSummary(Array.isArray(snapshot.accounts)?snapshot.accounts:[],owner);
  }
  function snapshotComparison(snapshots,selected,owner='all') {
    const record=snapshots.find(r=>r.snapshot_month===selected+'-01');
    const prior=snapshots.find(r=>r.snapshot_month===previousMonth(selected)+'-01');
    const current=snapshotSummary(record,owner),before=snapshotSummary(prior,owner);
    return {record,prior,current,before,delta:current&&before?{assets:current.assets-before.assets,debt:current.debt-before.debt,net:current.net-before.net}:null};
  }
  function snapshotSeries(snapshots,selected,owner='all') {
    return Array.from({length:12},(_,i)=>{const key=previousMonth(selected,i-11),record=snapshots.find(r=>r.snapshot_month===key+'-01');return {month:key,record,summary:snapshotSummary(record,owner)};});
  }
  function signedWon(value){return (value>0?'+':'')+won(value);}
  function snapshotChart(series) {
    const width=Math.max(280,Math.min(960,Number(root?.clientWidth||700)-76)),height=250,left=68,right=18,top=22,bottom=42;
    const values=series.filter(p=>p.summary).map(p=>p.summary.net);
    if(!values.length)return '<p>결산을 저장하면 순자산 그래프가 표시됩니다.</p>';
    const lo=Math.min(0,...values),hi=Math.max(0,...values),pad=Math.max((hi-lo)*.12,10000),min=lo-pad,max=hi+pad;
    const x=i=>left+i*(width-left-right)/11,y=v=>top+(max-v)/(max-min)*(height-top-bottom);
    const f=v=>Math.abs(v)>=100000000?(v/100000000).toFixed(1)+'억':Math.abs(v)>=10000?(v/10000).toFixed(0)+'만':Math.round(v).toLocaleString('ko-KR');
    let lines='',points='',ticks='';
    series.forEach((p,i)=>{if(!p.summary)return;
      if(i>0&&series[i-1].summary) lines+=`<line x1="${x(i-1)}" y1="${y(series[i-1].summary.net)}" x2="${x(i)}" y2="${y(p.summary.net)}" class="oh-snapshot-line"/>`;
      points+=`<circle cx="${x(i)}" cy="${y(p.summary.net)}" r="4.5" class="oh-snapshot-point"><title>${p.month} · ${esc(won(p.summary.net))}</title></circle>`;
    });
    const step=width<460?3:2;
    series.forEach((p,i)=>{if(i%step===0||i===11)ticks+=`<text x="${x(i)}" y="${height-17}" text-anchor="middle">${p.month.slice(2)}</text>`;});
    const grid=[0,1,2,3].map(i=>{const v=min+(max-min)*i/3;return `<line x1="${left}" y1="${y(v)}" x2="${width-right}" y2="${y(v)}" class="oh-snapshot-grid"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end">${esc(f(v))}</text>`;}).join('');
    return `<svg class="oh-snapshot-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="최근 12개월 순자산 추이"><title>최근 12개월 순자산 추이</title><desc>저장한 월의 금액만 표시합니다. 기록이 없는 월은 선을 연결하지 않습니다.</desc><text x="${left}" y="13">단위: 원</text>${grid}<line x1="${left}" x2="${width-right}" y1="${y(0)}" y2="${y(0)}" class="oh-snapshot-zero"/>${lines}${points}${ticks}</svg>`;
  }
  function assetHistoryPanel() {
    const snapshots=data.asset_snapshots||[],c=snapshotComparison(snapshots,month,assetOwnerFilter),series=snapshotSeries(snapshots,month,assetOwnerFilter);
    const currentMonth=settlementMonth(),recent=series.filter(p=>p.record).reverse();
    return `<section class="card oh-snapshot-panel"><div class="oh-asset-heading"><div><small>MONTHLY RECORD</small><h2>월별 자산 결산</h2></div>${month===currentMonth?btn('snapshot-save',c.record?'이번 달 결산 다시 저장':'이번 달 결산 저장'):btn('snapshot-current','이번 달로 이동')}</div><p>${esc(month)} · ${assetOwnerFilter==='all'?'전체 가구':esc(assetOwnerFilter)} · 저장 시점의 계좌 금액</p>
    ${c.current?`<div class="oh-snapshot-stats"><div><small>결산 순자산</small><strong>${won(c.current.net)}</strong></div><div><small>결산 자산</small><strong>${won(c.current.assets)}</strong></div><div><small>결산 부채</small><strong>${won(c.current.debt)}</strong></div></div><p>저장일시 ${esc(new Date(c.record.saved_at).toLocaleString(appearance.language==='ja'?'ja-JP':'ko-KR',{timeZone:'Asia/Seoul'}))} (KST)</p>`:'<p>이 월에 저장한 결산이 없습니다. 현재 잔액으로 과거 기록을 만들지 않습니다.</p>'}
    ${c.delta?`<div class="oh-snapshot-changes"><p>전월 대비 순자산 <strong>${signedWon(c.delta.net)}</strong></p><p>자산 증감 ${signedWon(c.delta.assets)} · 부채 증감 ${signedWon(c.delta.debt)}</p></div>`:c.current?'<p>전월 기록이 없어 전월 대비 증감을 계산하지 않습니다.</p>':''}
    <div data-snapshot-chart>${snapshotChart(series)}</div><p><small>입출금과 평가변동이 함께 반영된 잔액 변화입니다. 투자 수익률이 아닙니다.</small></p>
    <details data-asset-detail="snapshot-table"><summary>월별 결산 표</summary><div class="oh-snapshot-table-wrap"><table><thead><tr><th>월</th><th>자산</th><th>부채</th><th>순자산</th></tr></thead><tbody>${recent.map(p=>`<tr><td>${p.month}</td><td>${won(p.summary.assets)}</td><td>${won(p.summary.debt)}</td><td>${won(p.summary.net)}</td></tr>`).join('')||'<tr><td colspan="4">저장한 결산이 없습니다.</td></tr>'}</tbody></table></div></details>
    ${c.record?`<details data-asset-detail="snapshot-accounts"><summary>저장 당시 계좌 보기</summary>${c.current.selected.map(a=>`<div class="oh-funding-line"><h3>${userText(a.name)}</h3><p>${esc(ownerOf(a))} · ${labels[a.kind]} · ${won(a.amount)}</p></div>`).join('')||'<p>이 소유자의 저장된 계좌가 없습니다.</p>'}</details>`:''}
    <details data-asset-detail="snapshot-help"><summary>ⓘ 결산 안내</summary><p>한국·일본 시간 기준 이번 달만 저장할 수 있습니다. 저장한 뒤 계좌 금액이나 소유자를 바꿔도 이전 결산은 유지됩니다.</p><p>같은 달에는 확인 후 최신 잔액으로 다시 저장할 수 있습니다. 지난달 결산은 덮어쓰지 않습니다.</p><p>계좌 금액은 자동 조회되지 않습니다. 결산 전에 현재 잔액을 확인하세요. 이번 달 중간에 저장한 기록은 월말 확정액이 아닙니다.</p></details></section>`;
  }
  async function saveMonthlySnapshot() {
    const selected=month,current=settlementMonth();
    if(selected!==current)throw Error('이번 달만 결산을 저장할 수 있습니다. 조회 월을 확인해 주세요.');
    const record=(data.asset_snapshots||[]).find(r=>r.snapshot_month===selected+'-01'),revision=record?.revision??0;
    const message=record?'이번 달 결산을 서버의 최신 계좌 금액으로 다시 저장할까요? 기존 이번 달 결산이 바뀝니다.':'서버에 등록된 현재 자산·부채를 이번 달 결산으로 저장할까요? 실제 계좌 잔액을 먼저 확인해 주세요.';
    if(!confirm(message))return;
    await checked(db.rpc('save_asset_snapshot',{p_household_id:house.id,p_month:selected+'-01',p_expected_revision:revision}));
    await refresh(false);dashboard();notice('이번 달 자산 결산을 저장했습니다.');
  }
  function resizeSnapshotChart() {
    const chart=$('[data-snapshot-chart]');if(chart)chart.innerHTML=snapshotChart(snapshotSeries(data.asset_snapshots||[],month,assetOwnerFilter));
  }
  const SNAPSHOT_STYLES=`#ourhome-v11 .oh-snapshot-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:18px 0}#ourhome-v11 .oh-snapshot-stats strong{display:block;font-size:22px;overflow-wrap:anywhere;color:var(--oh-ink)!important;-webkit-text-fill-color:var(--oh-ink)!important}#ourhome-v11 .oh-snapshot-changes{padding:10px 16px;background:var(--oh-soft);border-radius:12px}#ourhome-v11 .oh-snapshot-chart{width:100%;display:block;height:auto}#ourhome-v11 .oh-snapshot-chart text{font-size:11px;fill:var(--oh-muted)}#ourhome-v11 .oh-snapshot-grid{stroke:var(--oh-line);stroke-width:1}#ourhome-v11 .oh-snapshot-zero{stroke:var(--oh-muted);stroke-width:1}#ourhome-v11 .oh-snapshot-line{stroke:var(--oh-ink);stroke-width:2.5}#ourhome-v11 .oh-snapshot-point{fill:var(--oh-ink)}#ourhome-v11 .oh-snapshot-panel details{margin-top:16px}#ourhome-v11 .oh-snapshot-panel summary{cursor:pointer;padding:8px 0}#ourhome-v11 .oh-snapshot-table-wrap{overflow-x:auto}#ourhome-v11 .oh-snapshot-panel table{border-collapse:collapse;min-width:490px;width:100%;font-size:13px}#ourhome-v11 .oh-snapshot-panel td,#ourhome-v11 .oh-snapshot-panel th{padding:12px 6px;border-bottom:1px solid var(--oh-line);text-align:right}#ourhome-v11 .oh-snapshot-panel td:first-child,#ourhome-v11 .oh-snapshot-panel th:first-child{text-align:left}@media(max-width:600px){#ourhome-v11 .oh-snapshot-stats{grid-template-columns:1fr}#ourhome-v11 .oh-snapshot-stats>div{display:flex;justify-content:space-between;align-items:center;gap:10px}#ourhome-v11 .oh-snapshot-stats strong{font-size:20px}}`;

  const portfolioTypes=assetTypes.filter(([id])=>id!=='unclassified');
  const portfolioScopeLabel=scope=>scope==='all'?'전체 가구':scope;
  function portfolioTarget(scope=assetOwnerFilter){return (data.portfolio_targets||[]).find(r=>r.owner_scope===scope);}
  function validatePortfolioTarget(weights,tolerance) {
    if(!weights||Object.keys(weights).length!==portfolioTypes.length)throw Error('목표 비중을 확인해 주세요.');
    let total=0;
    for(const [id] of portfolioTypes){const n=weights[id];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>100||Math.abs(n*100-Math.round(n*100))>1e-7)throw Error('비중은 0~100 사이 소수 둘째 자리까지 입력하세요.');total+=Math.round(n*100);}
    if(total!==10000)throw Error('목표 비중의 합계는 100%여야 합니다.');
    if(!Number.isFinite(tolerance)||tolerance<0||tolerance>100||Math.abs(tolerance*100-Math.round(tolerance*100))>1e-7)throw Error('허용 차이는 0~100 사이 소수 둘째 자리까지 입력하세요.');
    return {weights,tolerance};
  }
  function portfolioSummary(accounts,target,scope='all') {
    const s=assetSummary(accounts,scope),unknown=s.assetRows.filter(a=>typeOf(a)==='unclassified'),unclassified=sum(unknown);
    const largestAccount=s.assetRows.reduce((best,a)=>!best||Number(a.amount)>Number(best.amount)?a:best,null);
    const largestGroup=s.groups.reduce((best,g)=>!best||g.amount>best.amount?g:best,null);
    const rows=portfolioTypes.map(([id,label])=>{const amount=sum(s.assetRows.filter(a=>typeOf(a)===id)),current=s.assets>0?amount/s.assets*100:null,goal=target?Number(target.weights[id]):null,diff=current!==null&&goal!==null?current-goal:null;
      return {id,label,amount,current,goal,diff,status:diff===null?'未設定':diff>Number(target.tolerance)+1e-8?'over':diff<-Number(target.tolerance)-1e-8?'under':'within'};});
    return {s,unclassified,unknownCount:unknown.length,largestAccount,largestGroup,rows,debtRatio:s.assets>0?s.debt/s.assets*100:null};
  }
  function portfolioPlan(accounts,target,scope,newAmount) {
    if(!target)throw Error('먼저 이 범위의 목표 비중을 설정하세요.');
    validatePortfolioTarget(target.weights,Number(target.tolerance));
    const p=portfolioSummary(accounts,target,scope);
    if(p.unclassified>0)throw Error('미분류 자산의 종류를 지정한 뒤 계산하세요.');
    const cents=Math.round(newAmount*100);
    if(!Number.isFinite(newAmount)||newAmount<=0||!Number.isSafeInteger(cents)||Math.abs(newAmount*100-cents)>1e-6)throw Error('추가 자금은 0보다 큰 금액으로 소수 둘째 자리까지 입력하세요.');
    const currentCents=p.rows.map(r=>Math.round(r.amount*100));
    const totalCents=currentCents.reduce((s,n)=>s+n,0)+cents;
    if(!Number.isSafeInteger(totalCents)||currentCents.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('계산 가능한 금액 범위를 초과했습니다.');
    // 외부 추가 자금만 사용합니다. 기존 현금·목표 배정액·보유자산은 매도하거나 이동하지 않습니다.
    const deficits=p.rows.map((r,i)=>Math.max(0,totalCents*target.weights[r.id]/100-currentCents[i]));
    const totalDeficit=deficits.reduce((s,n)=>s+n,0);
    const exact=deficits.map(d=>cents*d/totalDeficit),additions=exact.map(Math.floor);
    let remainder=cents-additions.reduce((s,n)=>s+n,0);
    const order=exact.map((n,i)=>({i,f:n-additions[i]})).sort((a,b)=>b.f-a.f||a.i-b.i);
    for(let i=0;i<remainder;i++)additions[order[i%order.length].i]++;
    return {newAmount:cents/100,before:p.s.assets,after:totalCents/100,rows:p.rows.map((r,i)=>({...r,addition:additions[i]/100,afterAmount:(currentCents[i]+additions[i])/100,afterPercent:(currentCents[i]+additions[i])/totalCents*100}))};
  }
  function portfolioView() {
    const target=portfolioTarget(),p=portfolioSummary(data.accounts||[],target,assetOwnerFilter),f=fundingSummary(data.accounts||[],data.goal_allocations||[],assetOwnerFilter);
    const pct=n=>n===null?'—':n.toFixed(1)+'%',status=r=>r.diff===null?'비교 전':r.status==='over'?'목표 초과':r.status==='under'?'목표 미달':'허용 범위';
    return `<section class="oh-asset-heading"><div><small>OUR HOME · PORTFOLIO</small><h2>우리집 포트폴리오</h2></div>${btn('portfolio-target','목표 비중 설정')}</section><div class="oh-asset-filters" aria-label="소유자 필터">${['all',...assetOwners].map(o=>`<button type="button" data-action="asset-filter" data-id="${o}" aria-pressed="${assetOwnerFilter===o}">${o==='all'?'합계':o}</button>`).join('')}</div>
    <p>${esc(portfolioScopeLabel(assetOwnerFilter))} · 현재 등록 금액 기준 · 월 필터와 별개</p>
    <section class="oh-portfolio-metrics"><article><small>가장 큰 자산 종류</small><strong>${p.s.assets>0?esc(p.largestGroup.label):'—'}</strong><span>${p.s.assets>0?pct(p.largestGroup.amount/p.s.assets*100):'—'}</span></article><article><small>가장 큰 계좌·자산</small><strong>${p.s.assets>0?userText(p.largestAccount.name):'—'}</strong><span>${p.s.assets>0?pct(Number(p.largestAccount.amount)/p.s.assets*100):'—'}</span></article><article><small>총자산 대비 부채</small><strong>${pct(p.debtRatio)}</strong><span>${won(p.s.debt)}</span></article></section>
    <section class="card oh-portfolio-panel"><div class="oh-asset-heading"><h2>목표와 현재 비중</h2>${btn('portfolio-plan','추가 자금 배분 계산')}</div>
    <p>부채를 제외한 총자산 기준입니다. 목표자금도 해당 계좌의 자산에 한 번만 포함됩니다.</p>
    ${target?`<p>허용 차이 ±${esc(target.tolerance)}%p · 이 범위의 목표는 부부가 함께 사용합니다.</p>`:'<p>목표 비중이 없습니다. 직접 정한 비중의 합계가 100%가 되도록 설정하세요.</p>'}
    ${p.unclassified>0?`<p role="status">미분류 자산 ${won(p.unclassified)} · 분류를 마치면 추가 자금 배분을 계산할 수 있습니다.</p>`:''}
    ${!p.s.assets?'<p>등록된 자산 금액이 없어 현재 비중을 계산하지 않습니다.</p>':''}
    <div class="oh-portfolio-table"><table><thead><tr><th>자산 종류</th><th>현재 금액</th><th>현재</th><th>목표</th><th>차이</th><th>상태</th></tr></thead><tbody>${p.rows.map(r=>`<tr><th>${r.label}</th><td>${won(r.amount)}</td><td>${pct(r.current)}</td><td>${pct(r.goal)}</td><td>${r.diff===null?'—':(r.diff>0?'+':'')+r.diff.toFixed(1)+'%p'}</td><td><span class="oh-portfolio-badge">${status(r)}</span></td></tr>`).join('')}${p.unclassified>0?`<tr><th>미분류</th><td>${won(p.unclassified)}</td><td>${pct(p.unclassified/p.s.assets*100)}</td><td>—</td><td>—</td><td>분류 필요</td></tr>`:''}</tbody></table></div>
    <p><small>목표 초과·미달은 입력한 기준과의 차이입니다. 계좌 안의 종목 구성이나 연금 안의 투자 비중은 분석하지 않습니다.</small></p></section>
    <section class="card"><h2>목표자금 확인</h2><div class="oh-asset-composition-row"><span>미배정 현금</span><strong>${won(f.available)}</strong></div><div class="oh-asset-composition-row"><span>현금·예적금에서 확보한 목표자금</span><strong>${won(f.reserved+f.depositReserved)}</strong></div>${f.over?'<p role="alert">배정액이 계좌 잔액보다 큽니다. 배정을 확인해 주세요.</p>':''}<p>목표자금은 그대로 유지합니다. 추가 자금 계산에는 아직 계좌 잔액에 반영하지 않은 새 돈만 입력하세요.</p>${btn('tab','자산·목표자금 보기','accounts')}</section>
    <section class="card"><details data-asset-detail="portfolio-help"><summary>ⓘ 포트폴리오 계산 안내</summary><p>전체 가구와 소유자별 목표는 각각 설정합니다. 소유자 변경 시 해당 범위의 현재 비중도 달라집니다.</p><p>허용 차이는 목표에서 벗어나도 허용할 비중 차이입니다. 예를 들어 목표 30%, 허용 차이 5%p이면 25~35%가 허용 범위입니다. 5%p는 초기 입력값이며 권장 투자 기준이 아닙니다.</p><p>자산 종류와 계좌 규모를 비교하는 기능입니다. 같은 계좌 안의 종목 집중도, 레버리지 상품 비중, 투자 수익률은 계산하지 않습니다.</p><p>추가 자금은 투입 후 목표금액의 부족분에 비례해 나눕니다. 기존 자산을 매도하지 않으므로 목표 비중에 완전히 도달하지 않을 수 있습니다. 세금·수수료·매수 단위는 반영하지 않습니다.</p><p>계산은 실제 송금·매매·거래 기록을 만들지 않습니다.</p><a href="https://www.investor.gov/additional-resources/general-resources/publications-research/info-sheets/beginners-guide-asset" target="_blank" rel="noopener noreferrer">자산 배분과 리밸런싱 참고자료 (Investor.gov)</a></details></section>`;
  }
  function portfolioTargetEditor() {
    const scope=assetOwnerFilter,target=portfolioTarget(scope),d=$('#editor');
    d.innerHTML=`<h2>목표 비중 설정</h2><p>${esc(portfolioScopeLabel(scope))} · 이 범위의 목표는 부부가 함께 사용합니다.</p><form data-form="portfolio-target">${portfolioTypes.map(([id,label])=>field('weight_'+id,label+' (%)',target?.weights[id]??'','number','required min="0" max="100" step="0.01"')).join('')}${field('tolerance','허용 차이 (%p)',target?.tolerance??5,'number','required min="0" max="100" step="0.01"')}<p id="portfolio-weight-total" role="status"></p><p>비중 합계는 100%여야 합니다. 사용하지 않는 자산 종류는 0을 입력하세요.</p><p>허용 차이 5%p는 초기 입력값이며 권장 투자 기준이 아닙니다.</p><button>저장</button>${btn('close','취소')}</form>`;
    const form=d.querySelector('form');form.dataset.scope=scope;form.dataset.expectedRevision=String(target?.revision??0);d.showModal();portfolioWeightTotal(form);
  }
  function portfolioWeightTotal(form) {const total=portfolioTypes.reduce((s,[id])=>s+(Number(form.elements['weight_'+id].value)||0),0);form.querySelector('#portfolio-weight-total').textContent=translateText('비중 합계')+' '+total.toFixed(2)+'%';}
  async function submitPortfolioTarget(form,fields) {
    const weights=Object.fromEntries(portfolioTypes.map(([id])=>[id,number(fields['weight_'+id])]));const tolerance=number(fields.tolerance);
    validatePortfolioTarget(weights,tolerance);
    const scope=form.dataset.scope;if(scope!=='all'&&!assetOwners.includes(scope))throw Error('소유자를 선택해 주세요.');
    if(!confirm('이 범위의 목표 비중을 저장할까요? 배우자에게도 같은 목표가 표시됩니다.'))return;
    await checked(db.rpc('set_portfolio_target',{p_household_id:house.id,p_owner_scope:scope,p_weights:weights,p_tolerance:tolerance,p_expected_revision:Number(form.dataset.expectedRevision)}));
    $('#editor').close();await refresh(false);dashboard();notice('목표 비중을 저장했습니다.');
  }
  function portfolioPlanEditor() {
    const scope=assetOwnerFilter;if(!portfolioTarget(scope))throw Error('먼저 이 범위의 목표 비중을 설정하세요.');
    const d=$('#editor');d.innerHTML=`<h2>추가 자금 배분 계산</h2><p>${esc(portfolioScopeLabel(scope))}</p><form data-form="portfolio-plan">${field('amount','새로 들어올 금액 (원)','','number','required')}<p>아직 계좌 잔액에 반영하지 않은 외부 추가 자금만 입력하세요. 기존 현금을 다시 입력하면 중복 계산됩니다.</p><button>계산</button>${btn('close','닫기')}</form><div id="portfolio-plan-result" aria-live="polite"></div>`;d.querySelector('form').dataset.scope=scope;d.showModal();
  }
  function submitPortfolioPlan(form,fields) {
    const scope=form.dataset.scope,target=portfolioTarget(scope),plan=portfolioPlan(data.accounts||[],target,scope,number(fields.amount));
    const result=$('#portfolio-plan-result');
    result.innerHTML=`<h3>추가 자금 배분안</h3><p>추가 자금 ${won(plan.newAmount)} · 투입 후 총자산 ${won(plan.after)}</p><div class="oh-portfolio-table"><table><thead><tr><th>자산 종류</th><th>추가 배분</th><th>투입 후 비중</th><th>목표</th></tr></thead><tbody>${plan.rows.map(r=>`<tr><th>${r.label}</th><td>${won(r.addition)}</td><td>${r.afterPercent.toFixed(1)}%</td><td>${r.goal.toFixed(1)}%</td></tr>`).join('')}</tbody></table></div><p>화면에 불러온 잔액과 목표로 계산한 결과입니다. 잔액이나 목표가 바뀌면 다시 계산하세요.</p><p>부족분에 비례해 배분한 금액입니다. 기존 자산 매도 없이 목표에 완전히 도달하지 않을 수 있습니다.</p><p>계산은 실제 송금·매매·거래 기록을 만들지 않습니다.</p>`;
  }
  const PORTFOLIO_STYLES=`#ourhome-v11 .oh-portfolio-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:20px 0}#ourhome-v11 .oh-portfolio-metrics article{background:var(--oh-soft);border:1px solid var(--oh-line);border-radius:18px;padding:20px}#ourhome-v11 .oh-portfolio-metrics strong{display:block;font-size:24px;margin:12px 0;overflow-wrap:anywhere;color:var(--oh-ink)!important;-webkit-text-fill-color:var(--oh-ink)!important}#ourhome-v11 .oh-portfolio-table{overflow-x:auto}#ourhome-v11 .oh-portfolio-table table{width:100%;min-width:540px;border-collapse:collapse;font-size:13px}#ourhome-v11 .oh-portfolio-table th,#ourhome-v11 .oh-portfolio-table td{padding:14px 8px;border-bottom:1px solid var(--oh-line);text-align:right;font-variant-numeric:tabular-nums}#ourhome-v11 .oh-portfolio-table th:first-child{text-align:left}#ourhome-v11 .oh-portfolio-badge{display:inline-block;background:var(--oh-soft);color:var(--oh-ink);padding:5px 8px;border-radius:7px;white-space:nowrap}#ourhome-v11 .oh-portfolio-panel strong{color:var(--oh-ink)!important}#ourhome-v11 #portfolio-plan-result:empty{display:none}@media(max-width:620px){#ourhome-v11 .oh-portfolio-metrics{grid-template-columns:1fr}#ourhome-v11 .oh-portfolio-metrics article{padding:16px}#ourhome-v11 .oh-portfolio-metrics strong{font-size:22px;margin:8px 0}}`;

  const StrategyEngine=(()=>{
'use strict';
const { evaluateLedger } = (()=>{
'use strict';

// Development foundation only. One USD strategy per ledger, from inception.
// Decimal strings avoid binary floating-point errors. No strategy/order rules.
const SCALE = 100000000n;
const TYPES = new Set(['deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'fee', 'tax']);

function decimal(value, label, allowZero = true) {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,8})?$/.test(value)) {
    throw new Error(`${label}: 소수 8자리 이내의 숫자 문자열이 필요합니다.`);
  }
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0'));
  if (!allowZero && result === 0n) throw new Error(`${label}: 0보다 커야 합니다.`);
  return result;
}

function format(value) {
  const sign = value < 0n ? '-' : '';
  const n = value < 0n ? -value : value;
  const fraction = (n % SCALE).toString().padStart(8, '0').replace(/0+$/, '');
  return sign + (n / SCALE) + (fraction ? '.' + fraction : '');
}

function divideRounded(numerator, denominator) {
  if (denominator <= 0n || numerator < 0n) throw new Error('잘못된 나눗셈입니다.');
  return (numerator + denominator / 2n) / denominator;
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function evaluateLedger(events, quote = null) {
  if (!Array.isArray(events)) throw new Error('거래 목록이 필요합니다.');
  const seen = new Set();
  const positions = new Set();
  const ordered = events.map(event => {
    if (!event || typeof event.id !== 'string' || !event.id.trim() || seen.has(event.id)) {
      throw new Error('거래 ID가 없거나 중복되었습니다.');
    }
    seen.add(event.id);
    if (!TYPES.has(event.type)) throw new Error('지원하지 않는 거래 종류입니다.');
    if (event.currency !== 'USD') throw new Error('이 원장은 USD만 지원합니다.');
    if (!validDate(event.date) || !Number.isSafeInteger(event.sequence) || event.sequence < 1) {
      throw new Error('거래 날짜와 하루 안의 체결 순서를 확인하세요.');
    }
    const position = `${event.date}:${event.sequence}`;
    if (positions.has(position)) throw new Error('같은 날짜의 체결 순서가 중복되었습니다.');
    positions.add(position);
    return { ...event };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence);

  let cash = 0n, quantity = 0n, cost = 0n, funding = 0n, ruleCost = 0n;
  let realized = 0n, distributions = 0n, otherCosts = 0n, fees = 0n, taxes = 0n;
  const history = [];
  for (const event of ordered) {
    const charge = decimal(event.fee ?? '0', '수수료');
    let eventRealized = 0n;
    if (event.type === 'buy' || event.type === 'sell') {
      const units = decimal(event.quantity, '수량', false);
      const price = decimal(event.price, '가격', false);
      const gross = divideRounded(units * price, SCALE);
      if (!gross) throw new Error('체결금액이 지원 정밀도보다 작습니다.');
      if (event.type === 'buy') {
        cash -= gross + charge;
        quantity += units;
        cost += gross + charge;
        ruleCost += gross;
      } else {
        if (units > quantity) throw new Error('보유 수량보다 많이 매도할 수 없습니다.');
        const allocatedCost = units === quantity ? cost : divideRounded(cost * units, quantity);
        const allocatedRuleCost = units === quantity ? ruleCost : divideRounded(ruleCost * units, quantity);
        cash += gross - charge;
        quantity -= units;
        cost -= allocatedCost;
        ruleCost -= allocatedRuleCost;
        eventRealized = gross - charge - allocatedCost;
        realized += eventRealized;
      }
      fees += charge;
    } else {
      // A standalone fee/tax is already an expense; never add another fee to it.
      if (charge !== 0n) throw new Error('비매매 수수료는 별도 수수료 거래로 기록하세요.');
      const amount = decimal(event.amount, '금액', false);
      if (event.type === 'deposit') { cash += amount; funding += amount; }
      if (event.type === 'withdrawal') { cash -= amount; funding -= amount; }
      if (event.type === 'dividend') { cash += amount; distributions += amount; }
      if (event.type === 'fee' || event.type === 'tax') {
        cash -= amount; otherCosts += amount;
        if (event.type === 'fee') fees += amount;
        else taxes += amount;
      }
    }
    if (cash < 0n) throw new Error(`${event.id}: 잔여 현금이 부족합니다.`);
    history.push({ id: event.id, date: event.date, cycleId: event.cycleId ?? null,
      mode: event.mode ?? null, cash: format(cash), quantity: format(quantity),
      costBasis: format(cost), tradeRealized: format(eventRealized),
      ruleAverage: quantity ? format(divideRounded(ruleCost * SCALE, quantity)) : null,
      cumulativeRealized: format(realized + distributions - otherCosts) });
  }

  let marketValue = quantity === 0n ? 0n : null;
  if (quote !== null) {
    if (!quote || !validDate(quote.date)) throw new Error('평가가격의 기준 날짜가 필요합니다.');
    if (ordered.length && quote.date < ordered.at(-1).date) throw new Error('마지막 거래보다 오래된 평가가격입니다.');
    const price = decimal(quote.price, '평가가격', false);
    marketValue = divideRounded(quantity * price, SCALE);
  }
  const netRealized = realized + distributions - otherCosts;
  const equity = marketValue === null ? null : cash + marketValue;
  const unrealized = marketValue === null ? null : marketValue - cost;
  const total = equity === null ? null : equity - funding;
  if (total !== null && total !== netRealized + unrealized) throw new Error('손익 대사 오류입니다.');
  return {
    currency: 'USD', accountingMethod: 'weighted-average-inclusive-fees',
    cash: format(cash), quantity: format(quantity), costBasis: format(cost),
    averageCost: quantity ? format(divideRounded(cost * SCALE, quantity)) : null,
    ruleAverage: quantity ? format(divideRounded(ruleCost * SCALE, quantity)) : null,
    netFunding: format(funding), tradeRealized: format(realized),
    realizedPnl: format(netRealized), distributions: format(distributions),
    feesPaid: format(fees), taxesPaid: format(taxes),
    marketValue: marketValue === null ? null : format(marketValue),
    equity: equity === null ? null : format(equity),
    unrealizedPnl: unrealized === null ? null : format(unrealized),
    totalPnl: total === null ? null : format(total),
    quoteDate: quote?.date ?? null, history
  };
}

return { evaluateLedger };

})();

const cashTypes = new Set(['deposit','withdrawal','buy','sell','dividend','fee','tax']);
const kinds = ['infinite-v4','vr5-basic'];
const owners = ['남편','아내','공동','미지정'];
const dateOK = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
const addDays = (a,n) => new Date(Date.parse(a)+86400000*n).toISOString().slice(0,10);
function numeric(v,label,positive=false) {
  if (typeof v!=='string' || !/^\d{1,12}(\.\d{1,8})?$/.test(v) || !Number.isFinite(Number(v)) || (positive && Number(v)<=0)) throw Error(label+' 값을 확인하세요.');
  return Number(v);
}
const centsDown = n => Math.floor((n+1e-9)*100)/100;
const centsNear = n => Math.round((n+1e-9)*100)/100;
const gcd = (a,b) => b ? gcd(b,a%b) : a;
function rational(n=0n,d=1n) {const g=gcd(n,d);return {n:n/g,d:d/g};}
const plus = (a,b) => rational(a.n*b.d+b.n*a.d,a.d*b.d);
const times = (a,n,d=1) => rational(a.n*BigInt(n),a.d*BigInt(d));
const tNumber = t => Number(t.n*1000000000000n/t.d)/1e12;
const tOver = (t,n) => t.n>BigInt(n)*t.d;
function configOK(c) {
  if (!c || typeof c.name!=='string' || !c.name.trim() || c.name.length>80 || !owners.includes(c.owner) || !kinds.includes(c.kind)) throw Error('전략 이름·소유자·종류를 확인하세요.');
  if (c.kind==='infinite-v4' && (!['TQQQ','SOXL'].includes(c.symbol) || ![20,40].includes(c.splits))) throw Error('무한매수법은 TQQQ/SOXL의 20·40분할을 지원합니다.');
  if (c.kind==='vr5-basic') {
    if(c.symbol!=='TQQQ' || !['accumulate','hold','withdraw'].includes(c.style) || !Number.isInteger(c.g) || c.g<1 || c.g>1000) throw Error('VR 종목·방식·G를 확인하세요.');
    numeric(c.initialV,'최초 V',true);
  }
  return c;
}
function validateRecords(records) {
  if (!Array.isArray(records) || records.length>10000) throw Error('기록은 최대 10,000개입니다.');
  const ids=new Set(),positions=new Set();
  return records.map(r=>{
    if(!r || typeof r.id!=='string' || !r.id || r.id.length>80 || ids.has(r.id) || !dateOK(r.date) || !Number.isInteger(r.sequence) || r.sequence<1 || r.sequence>100000 || ![...cashTypes,'settle','cycle'].includes(r.type)) throw Error('기록의 ID·날짜·순서·종류를 확인하세요.');
    const pos=r.date+':'+r.sequence;if(positions.has(pos))throw Error('같은 날짜의 순서가 중복되었습니다.');
    if(typeof r.memo!=='undefined' && (typeof r.memo!=='string'||r.memo.length>300))throw Error('메모는 300자 이내입니다.');
    ids.add(r.id);positions.add(pos);return {...r};
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.sequence-b.sequence);
}
function evaluateStrategy(config,records,quote=null,accounted=null) {
  const c=configOK(config),ordered=validateRecords(records),events=ordered.filter(r=>cashTypes.has(r.type));
  // Validate the entire cash ledger first. Checkpoints never mint cash or erase losses.
  const ledger=accounted?.full||evaluateLedger(events,quote);
  const histories=new Map(ledger.history.map(h=>[h.id,h]));
  let balance={cash:'0',quantity:'0',ruleAverage:null}, t=rational(),mode='normal',firstReverse=false,cycle=null;
  let pending=[],settledDate=null,dayStart=null,cycleNo=1;
  const settlements=[],cycles=[];
  for(const r of ordered) {
    if(cashTypes.has(r.type)) {
      if(c.kind==='infinite-v4') {
        if(settledDate && r.date<=settledDate)throw Error('하루 확정 뒤의 거래는 다음 날짜에 기록하세요. 같은 날 거래는 확정 기록 앞에 배치하세요.');
        if((r.type==='deposit'||r.type==='withdrawal') && (Number(balance.quantity)>0 || pending.some(x=>['buy','sell'].includes(x.type))))throw Error('무한매수법 진행 중에는 외부 입출금을 넣을 수 없습니다.');
        if(pending.length && pending[0].date!==r.date)throw Error('이전 날짜의 하루 결과를 먼저 확정하세요.');
        if(['buy','sell'].includes(r.type)) {
          if(!pending.length)dayStart={...balance};
          pending.push(r);
        }
      } else if(cycle) {
        if(r.date>=cycle.endDate)throw Error('2주가 지났습니다. 다음 사이클을 먼저 시작하세요.');
        if(r.type==='deposit'||r.type==='withdrawal')throw Error('VR 시작 후 적립·인출은 사이클 전환에서 기록하세요.');
        if(r.type==='buy')cycle.spent+=Number(r.quantity)*Number(r.price)+Number(r.fee||0);
      }
      balance=histories.get(r.id);
      continue;
    }
    if(r.type==='settle') {
      if(c.kind!=='infinite-v4')throw Error('VR에는 무한매수법 하루 확정을 넣을 수 없습니다.');
      if(settledDate && r.date<=settledDate)throw Error('하루 확정 날짜가 중복되거나 역순입니다.');
      if(pending.some(x=>x.date!==r.date))throw Error('거래 날짜와 하루 확정 날짜가 다릅니다.');
      const close=numeric(r.close,'확정 종가',true);
      if(!['0','0.5','1'].includes(r.buyFraction)||!['none','quarter','target','reverse'].includes(r.sellKind))throw Error('하루 매수·매도 결과를 선택하세요.');
      const buys=pending.filter(x=>x.type==='buy'),sells=pending.filter(x=>x.type==='sell');
      if(Boolean(buys.length)!==(r.buyFraction!=='0')||Boolean(sells.length)!==(r.sellKind!=='none'))throw Error('실제 체결 기록과 하루 매수·매도 결과가 다릅니다.');
      if(buys.concat(sells).some(x=>!Number.isInteger(Number(x.quantity))))throw Error('주문 규칙은 정수 주식만 지원합니다.');
      const beforeMode=mode,before=tNumber(t),beforeQ=Number(dayStart?.quantity??balance.quantity),sold=sells.reduce((s,x)=>s+Number(x.quantity),0);
      if(mode==='normal') {
        if(r.sellKind==='reverse')throw Error('일반모드에서는 리버스 매도를 선택할 수 없습니다.');
        if(r.sellKind==='quarter') {
          if(buys.length)throw Error('쿼터매도와 LOC 매수가 함께 체결된 날은 원본의 일반 처리 범위를 벗어납니다. 체결 내역을 확인하세요.');
          if(sold!==Math.floor(beforeQ/4))throw Error('쿼터매도 수량이 보유수량의 1/4 내림과 다릅니다. 부분 체결일은 아직 확정하지 마세요.');
          t=times(t,3,4);
        }
        if(r.sellKind==='target') {
          if(Number(balance.quantity)>0 && !buys.length)throw Error('목표가 매도 후 잔여 보유가 있는 예외입니다. 원본 세칙 확인 전 자동 T 확정을 지원하지 않습니다.');
          if(buys.length && sold!==beforeQ-Math.floor(beforeQ/4))throw Error('목표가 매도 후 재매수는 나머지 3/4 매도 체결을 확인해야 합니다.');
          t=times(t,1,4);
        }
        if(r.buyFraction==='0.5' && ! (t.n*2n<BigInt(c.splits)*t.d))throw Error('후반전은 절반 매수로 확정할 수 없습니다. 부분 체결 여부를 확인하세요.');
        t=plus(t,r.buyFraction==='1'?rational(1n):r.buyFraction==='0.5'?rational(1n,2n):rational());
        if(tOver(t,c.splits-1)){mode='reverse';firstReverse=true;}
      } else {
        if(!['none','reverse'].includes(r.sellKind) || r.buyFraction==='0.5' || (buys.length&&sells.length))throw Error('리버스 하루 결과는 쿼터매수 또는 분할매도입니다.');
        if(firstReverse && buys.length)throw Error('리버스 첫날은 매수 없이 MOC 매도만 합니다.');
        if(firstReverse && !sells.length)throw Error('리버스 첫날 MOC 매도 체결을 기록한 뒤 확정하세요.');
        if(sells.length) {
          const divisor=c.splits===20?10:20;
          if(sold!==Math.floor(beforeQ/divisor)||!sold)throw Error('리버스 매도 수량을 확인하세요. 부분 체결일은 아직 확정하지 마세요.');
          t=times(t,divisor-1,divisor);firstReverse=false;
        }
        if(buys.length)t=plus(times(t,3,4),rational(BigInt(c.splits),4n));
        const avg=r.brokerAverage?numeric(r.brokerAverage,'증권사 평단',true):Number(balance.ruleAverage);
        if(Number(balance.quantity)>0 && close>avg*(c.symbol==='TQQQ'?.85:.8)){mode='normal';firstReverse=false;}
      }
      if(Number(balance.quantity)===0 && (buys.length||sells.length)){t=rational();mode='normal';firstReverse=false;cycleNo++;}
      settlements.push({date:r.date,beforeT:before,t:tNumber(t),mode,beforeMode,cycleNo,cash:balance.cash});
      settledDate=r.date;pending=[];dayStart=null;
    }
    if(r.type==='cycle') {
      if(c.kind!=='vr5-basic')throw Error('무한매수법에는 VR 사이클을 넣을 수 없습니다.');
      if(cycle && r.date!==cycle.endDate)throw Error('다음 VR 사이클은 이전 시작일의 14일 뒤입니다. 누락된 사이클을 순서대로 기록하세요.');
      if(!Number.isInteger(r.g)||r.g<1||r.g>1000)throw Error('G는 1~1000 정수입니다.');
      const add=numeric(r.contribution,'적립금'),take=numeric(r.withdrawal,'인출금');
      if(add&&take)throw Error('같은 사이클의 적립과 인출 중 하나만 입력하세요.');
      if((c.style==='hold'&&(add||take))||(c.style==='accumulate'&&take)||(c.style==='withdraw'&&add))throw Error('전략의 적립·거치·인출 방식과 금액이 다릅니다.');
      const pool=Number(balance.cash),v=cycle?cycle.v+pool/r.g+add-take:Number(c.initialV);
      if(!cycle && (add||take))throw Error('최초 사이클은 시작 자금과 초기 매수를 먼저 기록하고 적립·인출은 0으로 시작하세요.');
      if(v<=0||pool+add<take||!Number.isFinite(v))throw Error('인출 후 V 또는 잔금이 부족합니다.');
      if(Number(balance.quantity)===0)throw Error('VR 최초 매수 또는 보유수량을 먼저 기록하세요.');
      // Cash flows are ledger events generated atomically by the caller before replay.
      // Cycle contribution/withdrawal affects cash via these synthetic entries, once only.
      const rate={accumulate:.75,hold:.5,withdraw:.25}[c.style];
      cycle={id:r.id,date:r.date,endDate:addDays(r.date,14),v,g:r.g,poolBefore:pool,poolStart:pool+add-take,limit:(pool+add-take)*rate,spent:0,contribution:add,withdrawal:take};
      cycles.push(cycle);
      balance={...balance,cash:String(pool+add-take)};
    }
  }
  return {ledger,t:tNumber(t),tExact:{numerator:t.n.toString(),denominator:t.d.toString()},mode,firstReverse,cycleNo,settlements,cycles,cycle,pending:pending.filter(x=>['buy','sell'].includes(x.type)).length>0,settledDate};
}

// Expand cycle cash flows for accounting; retain command order for strategy replay.
// Internal cash flow IDs cannot collide with client-record IDs.
function evaluateBook(book) {
  if(!book || !book.config)throw Error('전략 설정이 필요합니다.');
  const original=validateRecords(book.records),expanded=[];
  if(book.quote && original.length && book.quote.date<original.at(-1).date)throw Error('평가가격은 마지막 기록 날짜 이후여야 합니다.');
  for(const r of original) {
    if(r.id.startsWith('flow:') || Object.hasOwn(r,'internal'))throw Error('예약된 기록 필드입니다.');
    if(['buy','sell'].includes(r.type)) {
      numeric(r.quantity,'체결 수량',true);numeric(r.price,'체결 가격',true);numeric(r.fee||'0','수수료');
    } else if(cashTypes.has(r.type))numeric(r.amount,'금액',true);
    if(r.type==='cycle') {
      numeric(r.contribution,'적립금');numeric(r.withdrawal,'인출금');
      const amount=Number(r.contribution)?r.contribution:r.withdrawal;
      expanded.push({...r});
      if(Number(amount))expanded.push({id:'flow:'+r.id,date:r.date,sequence:r.sequence,type:Number(r.contribution)?'deposit':'withdrawal',amount,currency:'USD',internal:true});
    } else expanded.push({...r});
  }
  // Use spaced ordering for generated cash entries without conflicting source sequences.
  expanded.forEach((r,i)=>r.sequence=i+1);
  const cashEvents=expanded.filter(r=>cashTypes.has(r.type));
  const full=evaluateLedger(cashEvents,book.quote||null);
  // Replay core with no command flows, providing flow-adjusted ledger history.
  const result=evaluateWithFlows(book.config,expanded,full,book.quote||null);
  result.ledger=full;return result;
}
function evaluateWithFlows(c,expanded,full,quote) {
  // A local adapter lets the common replay use the exact ledger containing cycle flows.
  // Generated flow records bypass the external-deposit restriction; their cash was applied at the command.
  const source=expanded.filter(r=>!r.internal);
  return evaluateStrategy(c,source,quote,{full});
}

function ladder(budget,base,limit=80) {
  const rows=[];budget=centsDown(budget);base=centsDown(base);
  if(base<=0||budget<=0)return rows;
  let n=Math.floor((budget+1e-9)/base);
  if(n)rows.push({side:'buy',type:'LOC',price:base,quantity:n});
  for(let i=0;i<limit-1;i++) {
    n++;const p=centsDown(budget/n);if(p<=0)break;
    const last=rows.at(-1);if(last?.price===p)last.quantity++;else rows.push({side:'buy',type:'LOC',price:p,quantity:1});
  }
  return rows;
}
function orderPlan(book,input={}) {
  const state=evaluateBook(book),c=book.config,l=state.ledger;
  const on=input.date;if(!dateOK(on))throw Error('주문 기준 날짜를 입력하세요.');
  const last=validateRecords(book.records).at(-1);
  if(last && on<last.date)throw Error('마지막 기록보다 이전 날짜로 주문표를 만들 수 없습니다.');
  const cash=Number(l.cash),q=Number(l.quantity),avg=input.brokerAverage?numeric(input.brokerAverage,'증권사 평단',true):Number(l.ruleAverage);
  if(!Number.isSafeInteger(Math.round(cash*100)))throw Error('주문표 계산 가능한 금액 범위를 초과했습니다.');
  const reserve=numeric(input.reserve||'0','수수료 여유액');
  if(!Number.isSafeInteger(q))throw Error('주문표는 정수 주식만 지원합니다.');
  let rows=[],budget=0,notes=[],star=null,phase=state.mode;
  if(c.kind==='vr5-basic') {
    const cy=state.cycle;if(!cy)throw Error('먼저 VR 최초 사이클을 시작하세요.');
    if(q===0)throw Error('VR 보유수량이 0주인 경우의 재시작 세칙을 확인해야 합니다.');
    if(on>=cy.endDate)throw Error('다음 VR 사이클을 먼저 시작하세요.');
    const lower=cy.v*.85,upper=cy.v*1.15;
    budget=centsDown(Math.max(0,Math.min(cash,cy.limit-cy.spent)-reserve));
    let spent=0;
    for(let i=0;i<80;i++) {
      const price=centsDown(lower/(q+i));if(!Number.isFinite(price)||price<=0||spent+price>budget+1e-8)break;
      rows.push({side:'buy',type:'LOC',price,quantity:1});spent+=price;
    }
    for(let i=0;i<Math.min(q,80);i++)rows.push({side:'sell',type:'LOC',price:Math.ceil((upper/(q-i)-1e-9)*100)/100,quantity:1});
    notes.push('매수 가격은 하단/매수 전 수량을 센트 내림, 매도 가격은 상단/매도 전 수량을 센트 올림합니다.','사이클 한도는 매수 수수료를 포함해 사용하며 매도대금으로 재충전하지 않습니다.','매수·매도 각각 최대 80단계이며 일부 주문표만 표시될 수 있습니다.');
    return {state,rows,budget,lower,upper,notes,phase:'VR5.0',limited:true};
  }
  if(state.pending)throw Error('체결 내역의 하루 결과를 먼저 확정하세요.');
  if(state.settledDate && on<=state.settledDate)throw Error('확정한 종가 다음 거래일의 주문 날짜를 입력하세요.');
  if(q===0) {
    const base=numeric(input.initialLimit,'첫 매수 LOC 가격',true);
    budget=centsDown(Math.max(0,cash/c.splits-reserve));rows=ladder(budget,base);
    notes.push('첫 매수 LOC 가격은 증권사 주문 가능 범위를 확인해 직접 입력합니다.');
  } else if(state.mode==='normal') {
    const max=c.symbol==='TQQQ'?15:20;
    star=centsNear(avg*(1+(max-2*max*state.t/c.splits)/100));
    budget=centsDown(Math.max(0,cash/(c.splits-state.t)-reserve));
    if(state.t<c.splits/2) {
      phase='전반';
      // Whole-budget ladder subject to the half-budget cap above the average.
      const high=centsDown(star-.01),low=centsDown(avg),half=centsDown(budget/2);
      if(high>low && high>0 && half>=high)rows.push({side:'buy',type:'LOC',price:high,quantity:Math.floor(half/high)});
      const highQty=rows.reduce((s,r)=>s+r.quantity,0),lowQty=Math.max(0,Math.floor(budget/low)-highQty);
      if(low>0 && lowQty)rows.push({side:'buy',type:'LOC',price:low,quantity:lowQty});
      let n=highQty+lowQty;
      if(low>0)for(let i=0;i<78;i++){n++;const p=centsDown(budget/n);if(p<=0)break;rows.push({side:'buy',type:'LOC',price:Math.min(p,low),quantity:1});}
      notes.push('전반 주문표는 평단 위에서 절반 예산, 평단 이하에서 전체 예산을 넘지 않도록 정수 수량을 배분합니다.');
    } else {phase='후반';rows=ladder(budget,star-.01);}
    const quarter=Math.floor(q/4);
    if(quarter)rows.push({side:'sell',type:'LOC',price:star,quantity:quarter});
    rows.push({side:'sell',type:'LIMIT',price:centsNear(avg*(1+max/100)),quantity:q-quarter});
  } else {
    const divisor=c.splits===20?10:20,qty=Math.floor(q/divisor);
    if(!qty)throw Error('리버스 매도 수량이 0주입니다. 소량 보유 세칙 확인이 필요합니다.');
    if(state.firstReverse)rows.push({side:'sell',type:'MOC',price:null,quantity:qty});
    else {
      const closes=input.closes;
      if(!Array.isArray(closes)||closes.length!==5)throw Error('직전 5거래일 종가 5개가 필요합니다.');
      const sorted=closes.slice().sort((a,b)=>a.date.localeCompare(b.date));
      if(new Set(sorted.map(r=>r.date)).size!==5 || sorted.some(r=>!dateOK(r.date)||r.date>=on))throw Error('종가는 서로 다른 이전 거래일 5개를 입력하세요.');
      star=centsNear(sorted.reduce((s,r)=>s+numeric(r.price,'종가',true),0)/5);
      budget=centsDown(Math.max(0,cash/4-reserve));
      if(cash/4<star-.01)rows.push({side:'sell',type:'MOC',price:null,quantity:qty});
      else {rows=ladder(budget,star-.01);rows.push({side:'sell',type:'LOC',price:star,quantity:qty});}
      notes.push('입력한 날짜가 실제 직전 5거래일인지 확인하세요. 미국 휴장일은 자동 조회하지 않습니다.');
    }
  }
  if(rows.some(r=>r.price!==null && (!Number.isFinite(r.price)||r.price<=0)))throw Error('계산된 주문 가격이 0 이하입니다. 입력값을 확인하세요.');
  notes.push('LOC는 조건 충족 시 실제 종가에 체결됩니다. 표의 모든 주문이 각 지정 가격에 체결된다고 계산하지 않습니다.','표는 최대 약 80단계입니다. 깊은 하락에서는 추가 주문표가 필요할 수 있습니다.');
  return {state,rows,budget,star,phase,notes,limited:true};
}
return {evaluateBook,orderPlan,configOK,validateRecords,addDays};

})();
  let strategyId='',strategyPage=0,strategyArchived=false,strategyHistoryLimit=10;
  const strategyToday=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;};
  const strategyTypes={deposit:'입금',withdrawal:'출금',buy:'매수',sell:'매도',dividend:'배당',fee:'수수료',tax:'납부 세금',settle:'하루 확정',cycle:'VR 사이클'};
  const strategyUSD=n=>n===null||n===undefined?'—':'$'+Number(n).toLocaleString(appearance.language==='ja'?'ja-JP':'ko-KR',{maximumFractionDigits:2,minimumFractionDigits:2});
  const strategyRow=id=>(data.strategy_books||[]).find(r=>r.id===id);
  const strategyClone=x=>JSON.parse(JSON.stringify(x));
  const strategyDateField=(name,label,value=strategyToday())=>field(name,label,value,'date','required');
  const strategyDecimal=(name,label,value='',required=true)=>field(name,label,value,'text',`inputmode="decimal" autocomplete="off" maxlength="22" ${required?'required':''}`);
  function strategyRows(){return(data.strategy_books||[]).filter(r=>Boolean(r.document.config.archived)===strategyArchived&&(assetOwnerFilter==='all'||r.document.config.owner===assetOwnerFilter));}
  function strategyMarket() {
    const locale=appearance.language==='ja'?'ja':'kr';
    const config={symbols:[['TQQQ','NASDAQ:TQQQ|1D'],['SOXL','AMEX:SOXL|1D']],chartOnly:false,width:'100%',height:430,locale,colorTheme:'light',autosize:false,showVolume:false,showMA:false,hideDateRanges:false,hideMarketStatus:false,hideSymbolLogo:false,scalePosition:'right',scaleMode:'Normal',fontFamily:'Arial, sans-serif',fontSize:'12',noTimeScale:false,valuesTracking:'1',changeMode:'price-and-percent',chartType:'area',lineWidth:2,lineType:0,dateRanges:['1d|1','1m|30','3m|60','12m|1D','all|1W']};
    // Isolated public market widget: no account balances, tokens, or records enter this frame.
    const source='https://www.tradingview-widget.com/embed-widget/symbol-overview/?locale='+locale+'#'+encodeURIComponent(JSON.stringify(config));
    const d=$('#editor');d.innerHTML=`<h2>TQQQ · SOXL <span>시세·차트</span></h2><p>출처: TradingView · USD</p><p>제공처에 따라 지연될 수 있습니다. 차트의 거래 시간과 시장 상태를 확인하세요.</p><iframe class="oh-strategy-market" title="TQQQ / SOXL TradingView" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" src="${esc(source)}"></iframe><p><a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">Track all markets on TradingView</a></p><p>화면이 표시되지 않으면 아래 종목 페이지에서 확인하세요.</p><div class="oh-strategy-tools"><a href="https://www.tradingview.com/symbols/NASDAQ-TQQQ/" target="_blank" rel="noopener noreferrer">TQQQ ↗</a><a href="https://www.tradingview.com/symbols/AMEX-SOXL/" target="_blank" rel="noopener noreferrer">SOXL ↗</a>${btn('close','닫기')}</div><p>이 화면의 가격은 확인용입니다. 평가가격·확정 종가·체결 기록에 자동으로 저장되지 않습니다.</p>`;d.showModal();
  }
  function strategyChart(points,label) {
    if(points.length<2)return '<p>기록이 두 개 이상 쌓이면 추이를 표시합니다.</p>';
    points=points.slice(-30);const values=points.map(p=>p.value),lo=Math.min(0,...values),hi=Math.max(0,...values),range=hi-lo||1;
    const xy=points.map((p,i)=>`${30+i*540/(points.length-1)},${145-(p.value-lo)/range*115}`).join(' ');
    return `<figure class="oh-strategy-chart"><figcaption>${esc(label)}</figcaption><svg viewBox="0 0 600 185" role="img" aria-label="${esc(translateText(label))}"><line x1="30" y1="${145-(0-lo)/range*115}" x2="570" y2="${145-(0-lo)/range*115}" stroke="currentColor" opacity=".2"/><polyline points="${xy}" fill="none" stroke="var(--oh-button,#176950)" stroke-width="3"/><text x="30" y="18" fill="currentColor" font-size="12">${esc(strategyUSD(hi))}</text><text x="30" y="177" fill="currentColor" font-size="12">${esc(points[0].date)}</text><text x="570" y="177" text-anchor="end" fill="currentColor" font-size="12">${esc(points.at(-1).date)}</text></svg><p>${esc(strategyUSD(points.at(-1).value))}</p></figure>`;
  }
  function strategyView() {
    const books=strategyRows();if(!books.some(r=>r.id===strategyId)){strategyId=books[0]?.id||'';strategyPage=0;}
    let total=0,cash=0,missing=0,failed=0;const summaries=new Map();
    for(const r of books){try{const s=StrategyEngine.evaluateBook(r.document);summaries.set(r.id,s);cash+=Number(s.ledger.cash);if(s.ledger.equity===null)missing++;else total+=Number(s.ledger.equity);}catch(e){summaries.set(r.id,{error:e.message});missing++;failed++;}}
    const r=strategyRow(strategyId),s=summaries.get(strategyId),c=r?.document.config;
    return `<section class="oh-asset-heading"><div><small>OUR HOME · STRATEGIES</small><h2>전략 투자</h2></div><div>${btn('strategy-new','전략 만들기')}${btn('strategy-import','전략 가져오기')}</div></section>
    <section class="card"><div class="oh-asset-heading"><div><h3>TQQQ · SOXL <span>주가 확인</span></h3><p>TradingView · USD · 지연 가능</p></div>${btn('strategy-market','시세·차트 열기')}</div><p><a href="http://127.0.0.1:8766/" target="_blank" rel="noopener noreferrer">토스 PC 시세 열기 ↗</a></p><p>이 PC에서 연결 프로그램을 실행한 뒤 이용하세요. 토스 현재가는 5초 간격으로 조회합니다.</p></section>
    <div class="oh-asset-filters">${['all',...assetOwners].map(o=>`<button type="button" data-action="asset-filter" data-id="${esc(o)}" aria-pressed="${assetOwnerFilter===o}">${o==='all'?'합계':o}</button>`).join('')}</div>
    <p>USD 보조 원장입니다. 기존 자산 계좌 금액에 다시 합산하지 않습니다.</p>
    <div class="oh-strategy-metrics"><article><small>등록 전략 평가액 합계</small><strong>${missing?'—':strategyUSD(total)}</strong><span>${missing?'평가가격 또는 기록 확인 필요':'입력한 평가가격 기준'}</span></article><article><small>등록 전략 현금 합계</small><strong>${failed?'—':strategyUSD(cash)}</strong><span>생활비·비상금과 구분하세요.</span></article></div>
    <div class="oh-strategy-tools">${btn('strategy-archived',strategyArchived?'진행 전략 보기':'보관 전략 보기')}<span>${books.length}</span></div>
    <div class="oh-strategy-pills">${books.map(x=>`<button type="button" data-action="strategy-select" data-id="${esc(x.id)}" aria-pressed="${x.id===strategyId}">${userText(x.document.config.name)} <small>${esc(x.document.config.symbol)}</small></button>`).join('')}</div>
    ${!r?'<section class="card"><h3>첫 전략을 기록해 보세요.</h3><p>전략을 만든 뒤 최초 입금부터 실제 체결을 순서대로 입력하세요.</p><p>기존 보유분을 시작할 때는 과거 거래를 기록해야 전체 손익이 맞습니다.</p></section>':s?.error?`<section class="card"><p role="alert">${esc(s.error)}</p>${btn('strategy-records','기록 확인',r.id)}${btn('strategy-export','전략 백업',r.id)}</section>`:strategyDetail(r,s)}
    <section class="card"><details data-asset-detail="strategy-help"><summary>계산과 기록 안내</summary><p>무한매수법 V4.0은 20·40분할, VR5.0은 기본공식을 지원합니다.</p><p>주문표는 확인용 계산입니다. 증권사에 주문을 전송하지 않습니다.</p><p>V와 밴드는 매매 기준이며 수익이나 손실 한도가 아닙니다.</p><p>손익 평단은 매수 수수료를 포함하고, 주문 규칙 평단은 수수료를 제외합니다. 증권사 평단과 대조하세요.</p><p>두 전략을 함께 운용해도 같은 종목의 위험은 겹칩니다. 위 합계는 등록한 전략만 포함합니다.</p><p>시세·차트는 외부 제공 화면입니다. 손익에는 직접 저장한 평가가격을 사용합니다. 원화 환산·세금 추정·주식분할 자동 처리는 지원하지 않습니다.</p></details></section>`;
  }
  function strategyDetail(row,s) {
    const d=row.document,c=d.config,l=s.ledger,cy=s.cycle,account=(data.accounts||[]).find(a=>a.id===c.accountId);
    const metrics=[['현금 Pool',l.cash],['주식 평가액',l.marketValue],['누적 실현손익',l.realizedPnl],['평가손익',l.unrealizedPnl],['누적 순입금',l.netFunding],['총손익',l.totalPnl]];
    return `<section class="card"><div class="oh-asset-heading"><div><h2>${userText(c.name)}</h2><p>${esc(c.symbol)} · ${esc(c.owner)} · ${c.kind==='infinite-v4'?'V4.0 · '+c.splits:'VR5.0 · '+translateText('기본공식')}</p></div>${btn('strategy-config','전략 정보',row.id)}</div>
    <p><span>연결 계좌</span>: ${account?userText(account.name):'—'} · <span>잔액은 자동 변경하지 않습니다.</span></p>
    <div class="oh-strategy-metrics">${metrics.map(([label,value])=>`<article><small>${label}</small><strong>${strategyUSD(value)}</strong></article>`).join('')}</div>
    <p><span>보유수량</span>: ${esc(l.quantity)} · <span>손익 평단</span>: ${strategyUSD(l.averageCost)} · <span>규칙 평단</span>: ${strategyUSD(l.ruleAverage)}</p>
    <p><span>평가가격 기준일</span>: ${esc(l.quoteDate||'—')} · <span>직접 입력한 가격입니다.</span></p>
    <div class="oh-strategy-workflow"><h3>이렇게 사용하세요</h3><ol><li><strong>주문 전</strong><p>현재 기록으로 매수·매도 가격과 수량을 계산하고 증권사에서 주문하세요.</p>${btn('strategy-plan','주문 가격·수량 보기',row.id)}</li><li><strong>체결 후</strong><p>증권사에서 실제로 체결된 수량·가격·수수료를 기록하세요.</p>${btn('strategy-event','체결·입출금 기록',row.id)}</li><li><strong>${c.kind==='infinite-v4'?'장 마감 후':'2주마다'}</strong><p>${c.kind==='infinite-v4'?'그날 체결을 모두 기록한 뒤 T값과 다음 매매 단계를 갱신합니다.':'새 사이클의 V·밴드·매수 한도를 갱신합니다. 매일 확정할 필요는 없습니다.'}</p>${btn(c.kind==='infinite-v4'?'strategy-settle':'strategy-cycle',c.kind==='infinite-v4'?'오늘 체결 마감 · T값 갱신':'2주 사이클 시작·갱신',row.id)}</li></ol><p>처음에는 입금부터 기록하세요. 주문표를 보는 것만으로 잔금이나 보유수량이 바뀌지 않습니다.</p></div>
    <div class="oh-strategy-tools">${btn('strategy-quote','손익 계산용 평가가격 입력',row.id)}</div>
    ${c.kind==='infinite-v4'?`<div class="oh-strategy-state"><strong>${s.mode==='reverse'?'리버스모드':'일반모드'}</strong><p>T ${s.t.toLocaleString('en-US',{maximumFractionDigits:10})} · <span>사이클</span> ${s.cycleNo}</p><p>${s.pending?'미확정 체결이 있습니다. 장 마감 후 T값을 갱신하세요.':'체결 마감으로 T값을 갱신한 뒤 다음 거래일 주문표를 계산합니다.'}</p>${s.firstReverse?'<p>리버스 첫날은 MOC 매도만 진행합니다.</p>':''}</div>`:cy?`<div class="oh-strategy-state"><strong>V ${strategyUSD(cy.v)} · G ${cy.g}</strong><p>${esc(cy.date)} → ${esc(cy.endDate)}</p><p><span>밴드</span>: ${strategyUSD(cy.v*.85)} ~ ${strategyUSD(cy.v*1.15)}</p><p><span>사이클 매수 한도</span>: ${strategyUSD(cy.limit)} · <span>남은 한도</span>: ${strategyUSD(Math.max(0,cy.limit-cy.spent))}</p>${cy.spent>cy.limit?'<p role="alert">실제 매수액이 사이클 한도를 초과했습니다.</p>':''}</div>`:'<p>초기 입금과 매수를 기록한 뒤 최초 사이클을 시작하세요.</p>'}
    ${strategyChart(l.history.map(h=>({date:h.date,value:Number(h.cumulativeRealized)})),'누적 실현손익 추이')}
    ${c.kind==='vr5-basic'?strategyChart(s.cycles.map(x=>({date:x.date,value:x.v})),'V 기준값 추이'):''}
    ${strategyChangeHistory(row)}
    <div>${btn('strategy-records','전체 기록',row.id)}${btn('strategy-export','전략 백업',row.id)}${btn('strategy-archive',c.archived?'보관 해제':'전략 보관',row.id)}</div></section>`;
  }
  function strategyChangeHistory(row) {
    const all=(data.strategy_book_changes||[]).filter(x=>x.book_id===row.id).sort((a,b)=>b.revision-a.revision),changes=all.slice(0,strategyHistoryLimit);
    return `<details data-asset-detail="strategy-history"><summary>최근 전략 변경이력</summary>${changes.map(x=>`<article class="oh-strategy-record"><p>${esc(new Date(x.created_at).toLocaleString(appearance.language==='ja'?'ja-JP':'ko-KR'))} · ${userText((data.household_members||[]).find(m=>m.user_id===x.actor_id)?.display_name||'구성원')} · #${x.revision}</p><p><span>변경된 기록</span>: ${x.changed_records.length}</p>${x.changed_records.map((r,i)=>!r.after&&r.before?`<p>${esc(r.before.date)} · ${esc(strategyTypes[r.before.type]||'기록')} ${btn('strategy-restore-record','삭제 기록 복구',JSON.stringify({changeId:x.id,index:i}))}</p>`:'').join('')}</article>`).join('')||'<p>변경이력이 없습니다.</p>'}${all.length>changes.length?btn('strategy-more-history','이전 변경이력 보기',row.id):''}</details>`;
  }
  function strategyForm(title,kind,row,body,id='') {
    const d=$('#editor');d.innerHTML=`<h2>${title}</h2><form data-form="${kind}" data-id="${esc(id)}">${body}<div class="oh-strategy-tools"><button>${kind==='strategy-plan'?'계산':'저장'}</button>${btn('close','취소')}</div></form><div id="strategy-result" aria-live="polite"></div>`;
    const form=d.querySelector('form');form.strategyBase=row?strategyClone(row):null;d.showModal();return form;
  }
  function strategyNew(row=null) {
    const c=row?.document.config||{name:'',kind:'infinite-v4',symbol:'TQQQ',owner:'공동',splits:40,style:'accumulate',g:10,initialV:''};
    const locked=Boolean(row?.document.records.length);
    const form=strategyForm('전략 정보','strategy-config',row,field('name','전략 이름',c.name,'text','required maxlength="80"')+select('owner','소유자',assetOwners.map(x=>[x,x]),c.owner)+select('accountId','연결 계좌',[['','연결 안 함'],...(data.accounts||[]).filter(a=>a.kind==='asset').map(a=>[a.id,a.name])],c.accountId||'')+
      `<fieldset ${locked?'disabled':''}>${select('kind','전략 종류',[['infinite-v4','무한매수법 V4.0'],['vr5-basic','VR5.0 기본공식']],c.kind)}${select('symbol','종목',[['TQQQ','TQQQ'],['SOXL','SOXL']],c.symbol)}<div data-strategy-kind="infinite-v4">${select('splits','분할수',[[20,'20'],[40,'40']],c.splits)}</div><div data-strategy-kind="vr5-basic">${select('style','운용 방식',[['accumulate','적립식'],['hold','거치식'],['withdraw','인출식']],c.style)}${field('g','시작 G',c.g,'number','required min="1" max="1000" step="1"')}${strategyDecimal('initialV','최초 V (USD)',c.initialV)}</div></fieldset><p>거래 기록이 생기면 공식과 초기 설정은 고정됩니다.</p>`);
    strategyToggle(form);
  }
  function strategyToggle(form,changedName='') {
    if(form.dataset.form==='strategy-config') {
      const k=form.elements.kind.value;
      for(const box of form.querySelectorAll('[data-strategy-kind]')){box.hidden=box.dataset.strategyKind!==k;for(const el of box.querySelectorAll('input,select'))el.disabled=box.hidden;}
      if(k==='vr5-basic')form.elements.symbol.value='TQQQ';
      if(changedName==='style'&&!form.strategyBase?.document.records.length)form.elements.g.value=form.elements.style.value==='withdraw'?'20':'10';
    }
    if(form.dataset.form==='strategy-event') {
      const trade=['buy','sell'].includes(form.elements.type.value);
      for(const box of form.querySelectorAll('[data-trade]')){box.hidden=(box.dataset.trade==='yes')!==trade;for(const el of box.querySelectorAll('input'))el.disabled=box.hidden;}
    }
  }
  function strategyEvent(row,id='') {
    const r=row.document.records.find(x=>x.id===id)||{},date=r.date||strategyToday();
    const seq=r.sequence||Math.max(0,...row.document.records.filter(x=>x.date===date).map(x=>x.sequence))+1;
    const f=strategyForm('체결·입출금 기록','strategy-event',row,strategyDateField('date','거래 날짜',date)+field('sequence','같은 날 순서',seq,'number','required min="1" max="100000" step="1"')+select('type','기록 종류',Object.entries(strategyTypes).filter(([k])=>!['settle','cycle'].includes(k)),r.type||'buy')+
      `<div data-trade="yes">${strategyDecimal('quantity','체결 수량',r.quantity)}${strategyDecimal('price','체결 가격 (USD)',r.price)}${strategyDecimal('fee','수수료 (USD)',r.fee||'0')}</div><div data-trade="no">${strategyDecimal('amount','금액 (USD)',r.amount)}</div>${field('memo','메모',r.memo||'','text','maxlength="300"')}<p>거래 날짜는 미국 거래일을 입력합니다.</p><p>실제 체결 가격과 수수료를 입력하세요. 주문표 가격은 체결 가격이 아닙니다.</p><p>새 기록이 평가일보다 늦으면 평가가격을 다시 입력해야 합니다.</p>`,id);strategyToggle(f);
  }
  function strategySettle(row,id='') {
    const r=row.document.records.find(x=>x.id===id)||{},s=StrategyEngine.evaluateBook(row.document),last=row.document.records.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.sequence-b.sequence).at(-1);
    const date=r.date||(s.pending?last?.date:strategyToday())||strategyToday(),seq=r.sequence||Math.max(0,...row.document.records.filter(x=>x.date===date).map(x=>x.sequence))+1;
    strategyForm('오늘 체결 마감 · T값 갱신','strategy-settle',row,'<p>미국 장 마감 후 사용하는 기능입니다. 이미 입력한 체결을 기준으로 T값·일반/리버스모드·사이클을 갱신합니다.</p><p>예: 일반모드에서 하루 전체 예산을 매수하면 T가 1 증가합니다. 체결 건수만큼 증가하지 않습니다.</p><p>아래 선택은 체결 기록을 대신하지 않습니다. 실제 매수·매도 기록을 먼저 입력하세요.</p>'+strategyDateField('date','미국 거래일',date)+field('sequence','같은 날 순서',seq,'number','required min="1" max="100000"')+select('buyFraction','하루 매수 결과',[['0','매수 없음'],['0.5','절반 예산 매수'],['1',s.mode==='reverse'?'쿼터매수':'전체 예산 매수']],r.buyFraction||'0')+select('sellKind','하루 매도 결과',[['none','매도 없음'],['quarter','쿼터매도'],['target','목표가 매도·전량 매도'],['reverse','리버스 분할매도']],r.sellKind||'none')+strategyDecimal('close','확정 종가 (USD)',r.close)+strategyDecimal('brokerAverage','증권사 평단 (선택)',r.brokerAverage||'',false)+`<p>같은 날 모든 체결을 입력한 뒤 한 번만 확정하세요. 부분 체결로 결과를 판단할 수 없으면 확정을 보류하세요.</p><p>목표가 매도 후 LOC 재매수도 같은 날 결과에 포함하세요.</p>`,id);
  }
  function strategyCycle(row,id='') {
    const r=row.document.records.find(x=>x.id===id)||{},s=StrategyEngine.evaluateBook(row.document),date=r.date||s.cycle?.endDate||strategyToday();
    const seq=r.sequence||Math.max(0,...row.document.records.filter(x=>x.date===date).map(x=>x.sequence))+1;
    strategyForm('사이클 시작','strategy-cycle',row,strategyDateField('date','사이클 시작일',date)+field('sequence','같은 날 순서',seq,'number','required min="1" max="100000"')+field('g','이번 사이클 G',r.g||s.cycle?.g||row.document.config.g,'number','required min="1" max="1000" step="1"')+strategyDecimal('contribution','적립금 (USD)',r.contribution||'0')+strategyDecimal('withdrawal','인출금 (USD)',r.withdrawal||'0')+'<p>적립·인출은 여기에서 한 번만 입력하세요. 현금과 V에 함께 반영됩니다.</p><p>최초 사이클은 입금·초기 매수를 먼저 기록하고 적립·인출 0으로 시작합니다.</p>',id);
  }
  function strategyRecords(row) {
    const sorted=row.document.records.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.sequence-a.sequence),pages=Math.max(1,Math.ceil(sorted.length/30));strategyPage=Math.min(strategyPage,pages-1);
    const d=$('#editor');d.innerHTML=`<h2>전체 기록</h2><p>${strategyPage+1} / ${pages}</p><div class="oh-strategy-tools">${strategyPage?btn('strategy-prev','이전 기록',row.id):''}${strategyPage+1<pages?btn('strategy-next','다음 기록',row.id):''}${btn('close','닫기')}</div>${sorted.slice(strategyPage*30,(strategyPage+1)*30).map(x=>`<article class="oh-strategy-record"><strong>${esc(x.date)} · ${x.sequence} · ${strategyTypes[x.type]}</strong><p>${['buy','sell'].includes(x.type)?esc(x.quantity)+' × '+strategyUSD(x.price):x.type==='cycle'?'G '+x.g+' · +'+strategyUSD(x.contribution)+' / −'+strategyUSD(x.withdrawal):x.type==='settle'?strategyUSD(x.close):strategyUSD(x.amount)}</p><p>${userText(x.memo||'')}</p>${btn('strategy-edit','수정',x.id)}${btn('strategy-remove','기록 삭제',x.id)}</article>`).join('')||'<p>기록이 없습니다.</p>'}`;d.strategyBase=strategyClone(row);d.showModal();
  }
  function strategyPlan(row) {
    const s=StrategyEngine.evaluateBook(row.document),c=row.document.config;
    const dates=row.document.records.filter(x=>x.type==='settle').slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).reverse().map(x=>x.date+' '+x.close).join('\n');
    const f=strategyForm('주문 가격·수량 보기','strategy-plan',row,'<p>증권사에 입력할 주문 가격·수량·방식을 미리 계산합니다. 계산만으로 주문되거나 체결 기록이 생기지는 않습니다.</p><p>무한매수는 직전 거래일의 체결 마감을, VR은 현재 2주 사이클을 먼저 확인하세요.</p>'+strategyDateField('date','주문 기준 날짜',strategyToday())+strategyDecimal('reserve','수수료 여유액 (USD)','0')+(c.kind==='infinite-v4'?strategyDecimal('brokerAverage','규칙 평단 (선택)',s.ledger.ruleAverage||'',false)+(Number(s.ledger.quantity)===0?strategyDecimal('initialLimit','첫 매수 LOC 가격 (USD)'):s.mode==='reverse'&&!s.firstReverse?`<label>직전 5거래일 종가<textarea name="closes" rows="6" required placeholder="2026-09-21 50.25">${esc(dates)}</textarea></label><p>한 줄에 날짜와 종가를 입력하세요. 실제 직전 미국 거래일 5개인지 확인하세요.</p>`:''):'')+'<p>수수료 여유액을 제외한 예산으로 계산합니다.</p>');
  }
  async function strategySave(base,doc) {
    StrategyEngine.evaluateBook(doc);
    const id=base?.id||crypto.randomUUID(),hid=house.id,sessionGeneration=generation;
    await checked(db.rpc('save_strategy_book',{p_household_id:hid,p_id:id,p_document:doc,p_expected_revision:base?.revision||0}));
    if(generation!==sessionGeneration||house?.id!==hid)return;
    strategyId=id;$('#editor').close();await refresh(false);dashboard();notice('전략 기록을 저장했습니다.');
  }
  async function submitStrategy(form,f) {
    const kind=form.dataset.form,base=form.strategyBase,doc=base?strategyClone(base.document):{config:{},records:[],quote:null};
    if(kind==='strategy-plan') {
      const input={...f,closes:f.closes?.trim().split(/\r?\n/).filter(Boolean).map(line=>{const [date,price,...rest]=line.trim().split(/[\s,]+/);if(rest.length)throw Error('종가 입력 형식을 확인하세요.');return {date,price};})};
      const plan=StrategyEngine.orderPlan(doc,input);form.strategyPlan=plan;
      $('#strategy-result').innerHTML=`<h3>${esc(plan.phase)}</h3><p><span>매수 예산</span>: ${strategyUSD(plan.budget)}</p><div class="oh-portfolio-table"><table><thead><tr><th>종류</th><th>주문 방식</th><th>가격 (USD)</th><th>수량</th></tr></thead><tbody>${plan.rows.map(x=>`<tr><th>${x.side==='buy'?'매수':'매도'}</th><td>${esc(x.type)}</td><td>${x.price===null?'종가 시장가':strategyUSD(x.price)}</td><td>${x.quantity}</td></tr>`).join('')}</tbody></table></div>${!plan.rows.length?'<p>예산 안에서 주문 가능한 수량이 없습니다.</p>':''}${plan.notes.map(n=>`<p>${esc(n)}</p>`).join('')}${btn('strategy-plan-export','주문표 CSV')}`;return;
    }
    if(kind==='strategy-import') {
      const file=form.elements.file.files[0];if(!file||file.size>2097152)throw Error('2MB 이하의 전략 백업 파일을 선택하세요.');
      const parsed=JSON.parse(await file.text());if(parsed.format!=='ourhome-strategy'||!parsed.document)throw Error('전략 백업 파일을 선택하세요.');
      const imported=parsed.document;imported.config.accountId='';imported.config.archived=false;imported.config.name=(imported.config.name+' (복원)').slice(0,80);await strategySave(null,imported);return;
    }
    if(kind==='strategy-config') {
      const old=doc.config,locked=doc.records.length>0;
      doc.config={...old,name:f.name.trim(),owner:f.owner,accountId:f.accountId||''};
      if(!locked)Object.assign(doc.config,{kind:f.kind,symbol:f.symbol,splits:Number(f.splits||40),style:f.style||'accumulate',g:Number(f.g||10),initialV:f.initialV||'1'});
    } else if(kind==='strategy-quote')doc.quote={date:f.date,price:f.price};
    else {
      const id=form.dataset.id||crypto.randomUUID(),r={id,date:f.date,sequence:Number(f.sequence)};
      if(kind==='strategy-event')Object.assign(r,{type:f.type,currency:'USD',memo:f.memo||''},['buy','sell'].includes(f.type)?{quantity:f.quantity,price:f.price,fee:f.fee}:{amount:f.amount});
      if(kind==='strategy-settle')Object.assign(r,{type:'settle',buyFraction:f.buyFraction,sellKind:f.sellKind,close:f.close,brokerAverage:f.brokerAverage||''});
      if(kind==='strategy-cycle')Object.assign(r,{type:'cycle',g:Number(f.g),contribution:f.contribution,withdrawal:f.withdrawal});
      const i=doc.records.findIndex(x=>x.id===id);if(i<0)doc.records.push(r);else doc.records[i]=r;
      if(doc.quote&&r.date>doc.quote.date)doc.quote=null;
    }
    await strategySave(base,doc);
  }
  async function strategyAction(name,id) {
    const row=strategyRow(id||strategyId);
    if(name==='strategy-new')return strategyNew();
    if(name==='strategy-market')return strategyMarket();
    if(name==='strategy-select'){strategyId=id;strategyPage=0;dashboard();return;}
    if(name==='strategy-archived'){strategyArchived=!strategyArchived;strategyId='';dashboard();return;}
    if(name==='strategy-more-history'){strategyHistoryLimit+=20;dashboard();return;}
    if(name==='strategy-import')return strategyForm('새 전략으로 가져오기','strategy-import',null,'<label>전략 백업 파일<input type="file" name="file" accept=".json,application/json" required></label><p>기존 전략을 덮어쓰지 않고 새 전략으로 복원합니다. 중복된 전략은 보관하세요.</p>');
    if(name==='strategy-plan-export') {const p=$('#editor form')?.strategyPlan;if(!p)throw Error('주문표를 다시 계산하세요.');download('strategy-orders-'+today()+'.csv','\ufeff'+[['side','order_type','limit_USD','quantity'],...p.rows.map(r=>[r.side,r.type,r.price??'',r.quantity])].map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv');return;}
    if(name==='strategy-restore-record') {
      const key=JSON.parse(id),change=(data.strategy_book_changes||[]).find(x=>String(x.id)===String(key.changeId)),item=change?.changed_records[key.index];
      const base=change&&strategyRow(change.book_id);if(!base||item?.after||!item?.before)throw Error('복구할 삭제 기록을 찾을 수 없습니다.');
      const doc=strategyClone(base.document);if(doc.records.some(r=>r.id===item.before.id))throw Error('이미 같은 기록이 있습니다.');
      doc.records.push(strategyClone(item.before));if(doc.quote&&item.before.date>doc.quote.date)doc.quote=null;await strategySave(base,doc);return;
    }
    if(name==='strategy-edit'||name==='strategy-remove') {
      const base=$('#editor').strategyBase;if(!base)throw Error('기록을 다시 열어 주세요.');const r=base.document.records.find(x=>x.id===id);if(!r)throw Error('기록을 찾을 수 없습니다.');
      if(name==='strategy-edit'){if(r.type==='settle')strategySettle(base,id);else if(r.type==='cycle')strategyCycle(base,id);else strategyEvent(base,id);return;}
      if(!confirm('이 기록을 삭제하고 이후 계산을 다시 할까요?'))return;
      const doc=strategyClone(base.document);doc.records=doc.records.filter(x=>x.id!==id);await strategySave(base,doc);return;
    }
    if(!row)throw Error('전략을 선택해 주세요.');
    if(name==='strategy-config')return strategyNew(row);
    if(name==='strategy-event')return strategyEvent(row);
    if(name==='strategy-settle')return strategySettle(row);
    if(name==='strategy-cycle')return strategyCycle(row);
    if(name==='strategy-quote')return strategyForm('평가가격 입력','strategy-quote',row,strategyDateField('date','평가가격 기준일',row.document.quote?.date||strategyToday())+strategyDecimal('price','평가가격 (USD)',row.document.quote?.price||''));
    if(name==='strategy-plan')return strategyPlan(row);
    if(name==='strategy-export'){download('strategy-'+today()+'.json',JSON.stringify({format:'ourhome-strategy',version:1,document:row.document},null,2),'application/json');return;}
    if(name==='strategy-archive'){const doc=strategyClone(row.document);doc.config.archived=!doc.config.archived;await strategySave(row,doc);return;}
    if(name==='strategy-prev')strategyPage--;
    if(name==='strategy-next')strategyPage++;
    return strategyRecords(row);
  }
  const STRATEGY_STYLES=`#ourhome-v11 .oh-strategy-market{display:block;border:0;width:100%;height:460px;background:white;border-radius:10px}#ourhome-v11 .oh-strategy-tools a{padding:12px}#ourhome-v11 .oh-strategy-workflow{border:1px solid var(--oh-line);border-radius:14px;padding:16px;margin:16px 0}#ourhome-v11 .oh-strategy-workflow ol{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;padding-left:24px}#ourhome-v11 .oh-strategy-workflow li{padding:4px}#ourhome-v11 .oh-strategy-workflow p{line-height:1.65}#ourhome-v11 .oh-strategy-pills button small{color:inherit!important}@media(max-width:700px){#ourhome-v11 .oh-strategy-workflow ol{grid-template-columns:1fr}}#ourhome-v11 .oh-strategy-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}#ourhome-v11 .oh-strategy-metrics article{padding:16px;background:var(--oh-soft);border:1px solid var(--oh-line);border-radius:14px;min-width:0}#ourhome-v11 .oh-strategy-metrics strong{display:block;font-size:22px;margin:8px 0;color:var(--oh-ink)!important;overflow-wrap:anywhere}#ourhome-v11 .oh-strategy-tools{display:flex;flex-wrap:wrap;gap:4px;align-items:center}#ourhome-v11 .oh-strategy-pills{display:flex;overflow-x:auto;padding:8px 2px}#ourhome-v11 .oh-strategy-pills button{white-space:nowrap}#ourhome-v11 .oh-strategy-pills [aria-pressed=true]{outline:3px solid var(--oh-line)}#ourhome-v11 .oh-strategy-state{padding:18px;border:1px solid var(--oh-line);border-radius:14px;margin:16px 0}#ourhome-v11 .oh-strategy-chart{margin:18px 0;padding:12px;border:1px solid var(--oh-line);border-radius:14px}#ourhome-v11 .oh-strategy-chart svg{display:block;width:100%;height:auto}#ourhome-v11 .oh-strategy-record{padding:14px 0;border-bottom:1px solid var(--oh-line)}#ourhome-v11 textarea{display:block;width:100%;font:inherit;padding:10px;background:var(--oh-card,#fff);color:var(--oh-ink);border:1px solid var(--oh-line);border-radius:8px;margin-top:8px}#ourhome-v11 fieldset{border:1px solid var(--oh-line);border-radius:10px;min-width:0}#ourhome-v11 [data-strategy-kind][hidden],#ourhome-v11 [data-trade][hidden]{display:none!important}@media(max-width:620px){#ourhome-v11 .oh-strategy-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}#ourhome-v11 .oh-strategy-metrics strong{font-size:18px}#ourhome-v11 .oh-strategy-tools button{flex:1 1 42%;margin:2px}}`;

  async function start() {
    document.documentElement.lang='ko';
    root=document.createElement('main'); root.id='ourhome-v11'; document.body.replaceChildren(root);
    const style=document.createElement('style'); style.textContent=`body{margin:0;background:#f3f6f5;color:#18342e;font-family:system-ui,sans-serif}#ourhome-v11{max-width:1000px;margin:auto;padding:24px 18px 60px}#ourhome-v11 *{box-sizing:border-box}#ourhome-v11 header,.toolbar,.row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}#ourhome-v11 h1{font-size:26px;margin:8px 0}#ourhome-v11 h2{font-size:21px}#ourhome-v11 h3{margin:9px 0}#ourhome-v11 small{color:#536c64}#ourhome-v11 .card{background:white;padding:22px;border:1px solid #dce6df;border-radius:18px;margin:14px 0}#ourhome-v11 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}#ourhome-v11 button{background:#176950;color:white;border:0;border-radius:10px;padding:12px 16px;margin:4px;cursor:pointer;font:inherit}#ourhome-v11 button[aria-current=page]{background:#133d30;outline:3px solid #b8dacb}#ourhome-v11 label{display:block;margin:12px 0}#ourhome-v11 input,#ourhome-v11 select{display:block;width:100%;font:inherit;padding:12px;border:1px solid #bccfc5;border-radius:9px;margin-top:6px;background:white;color:#18342e}#ourhome-v11 nav{display:flex;gap:4px;flex-wrap:wrap;margin:18px 0}#ourhome-v11 progress{width:100%;accent-color:#176950}#ourhome-v11 dialog{border:0;border-radius:18px;padding:24px;width:min(94vw,520px);max-height:90vh;overflow:auto}#ourhome-v11 dialog::backdrop{background:#16392e88}#ourhome-v11 .auth{max-width:440px;margin:40px auto}#notice{white-space:pre-wrap;color:#8a3a16}#ourhome-v11 p{overflow-wrap:anywhere}#ourhome-v11 [aria-busy=true]{opacity:.7}`; document.head.append(style); const theme=document.createElement('style'); theme.textContent=THEME; document.head.append(theme); const assetStyle=document.createElement('style');assetStyle.textContent=ASSET_STYLES+FUNDING_STYLES+SNAPSHOT_STYLES+PORTFOLIO_STYLES+STRATEGY_STYLES;document.head.append(assetStyle);
    applyAppearance();observeLanguage();
    draw('<p>연결 중입니다…</p>');
    db=typeof supabaseClient!=='undefined'?supabaseClient:window.supabaseClient;
    if(!db?.auth) { notice('Supabase 연결 설정이 없습니다. index.html에서 Supabase JS v2, supabase-config.js, app.js 순서로 로드해 주세요.'); return; }
    root.addEventListener('click',e=>{ const b=e.target.closest('[data-action]'); if(b) run(()=>action(b.dataset.action,b.dataset.id)); });
    root.addEventListener('input', e=>{ if(e.target.id==='search') { searchText=e.target.value; renderSearchResults(); } });
    root.addEventListener('change', e=>{ if(e.target.id==='filter-type') { filterType=e.target.value; renderSearchResults(); } if(e.target.id==='filter-owner') { filterOwner=e.target.value; renderSearchResults(); } });
    root.addEventListener('input',moneyInput);
    root.addEventListener('change',e=>{const f=e.target.closest('form');if(f?.dataset.form?.startsWith('strategy-'))strategyToggle(f,e.target.name);});
    root.addEventListener('input',e=>{const f=e.target.closest('form');if(f?.dataset.form==='strategy-plan'){f.strategyPlan=null;$('#strategy-result').innerHTML='';}});
    root.addEventListener('input',e=>{const form=e.target.closest('form');if(form?.dataset.form==='portfolio-target')portfolioWeightTotal(form);if(form?.dataset.form==='portfolio-plan')$('#portfolio-plan-result').innerHTML='';});
    root.addEventListener('input',e=>{if(['theme-background','theme-button'].includes(e.target.id)&&validColor(e.target.value)){appearance[e.target.id==='theme-background'?'background':'button']=e.target.value;appearance.preset='custom';applyAppearance();for(const x of root.querySelectorAll('[data-theme-hex]'))x.textContent=appearance[x.dataset.themeHex];for(const b of root.querySelectorAll('.theme-options button'))b.setAttribute('aria-pressed','false');}});
    root.addEventListener('change',e=>{if(['theme-background','theme-button'].includes(e.target.id))saveAppearance();});

    root.addEventListener('change', e=>{ const form=e.target.closest('form[data-form="transaction"]');if(!form)return;if(e.target.name==='original_currency')toggleFx(form);if(e.target.name==='fx_mode'){toggleFx(form,false);calculateFx(form);} });
    root.addEventListener('change',changeCategory);
    let snapshotResizeTimer;window.addEventListener('resize',()=>{clearTimeout(snapshotResizeTimer);snapshotResizeTimer=setTimeout(resizeSnapshotChart,120);});
    root.addEventListener('change',e=>{const form=e.target.closest('form[data-form="funding"]');if(form&&['funding_account_id','funding_goal_id'].includes(e.target.name))fundingCapacity(form);});
    root.addEventListener('change',e=>{const f=e.target.closest('form[data-form="account"]');if(f&&e.target.name==='kind')accountKindChanged(f);});
    root.addEventListener('submit',e=>{ e.preventDefault(); run(()=>submit(e.target,e.submitter?.value)); });
    root.addEventListener('change',e=>{ if(e.target.id==='month' && /^\d{4}-\d{2}$/.test(e.target.value)) {month=e.target.value;dashboard();} if(e.target.id==='import-file'&&e.target.files[0]) {const file=e.target.files[0]; run(async()=>importData(JSON.parse(await file.text())));e.target.value='';} });
    db.auth.onAuthStateChange((event,session)=>{ if(event==='SIGNED_OUT') { generation++; user=null;house=null;data={};login(); } else if(event==='SIGNED_IN' && session?.user.id!==user?.id) setTimeout(()=>run(()=>loadSession(session)),0); });
    await run(async()=>{ const s=await checked(db.auth.getSession()); await loadSession(s.session); });
    setInterval(()=>{if(house&&!busy&&!document.hidden) refresh().catch(e=>notice(`동기화 실패: ${e.message}. 연결 후 다시 시도합니다.`));},5000);
    if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
