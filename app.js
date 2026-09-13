const APP_VERSION="1.0.0";
const DB_VERSION=1;
const KEY="ourhome-budget-v1";

const defaultData = {
  meta:{appVersion:APP_VERSION,dbVersion:DB_VERSION,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},
  settings:{
    householdName:"우리집",
    members:["남편","아내"],
    annualSavingGoal:30000000,
    monthlyInvestmentGoal:1500000,
    currency:"KRW"
  },
  categories:{
    expense:["식비","생활비","교통","주거","통신","보험","의료","여가","여행","용돈","가족행사","기타"],
    income:["급여","상여","부수입","환급","기타"],
    investment:["ISA","CMA","적금","연금","국내주식","해외주식","기타"]
  },
  transactions:[],
  budgets:[
    {id:crypto.randomUUID(),category:"식비",monthlyLimit:600000},
    {id:crypto.randomUUID(),category:"생활비",monthlyLimit:300000},
    {id:crypto.randomUUID(),category:"교통",monthlyLimit:200000},
    {id:crypto.randomUUID(),category:"여가",monthlyLimit:200000}
  ],
  accounts:[],
  trash:[],
  audit:[]
};

let db = loadDB();
let state = {tab:"home", month:new Date().toISOString().slice(0,7)};

function clone(x){return JSON.parse(JSON.stringify(x))}
function loadDB(){
  try{
    const raw=localStorage.getItem(KEY);
    if(!raw) return clone(defaultData);
    const parsed=JSON.parse(raw);
    return {...clone(defaultData),...parsed,settings:{...defaultData.settings,...parsed.settings},categories:{...defaultData.categories,...parsed.categories}};
  }catch(e){return clone(defaultData)}
}
function saveDB(action="save"){
  db.meta.updatedAt=new Date().toISOString();
  db.meta.appVersion=APP_VERSION; db.meta.dbVersion=DB_VERSION;
  localStorage.setItem(KEY,JSON.stringify(db));
}
function won(n){return new Intl.NumberFormat("ko-KR").format(Math.round(Number(n)||0))+"원"}
function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function uid(){return crypto.randomUUID()}
function monthTxns(month=state.month){return db.transactions.filter(t=>t.date?.slice(0,7)===month)}
function ytdTxns(year=state.month.slice(0,4)){return db.transactions.filter(t=>t.date?.slice(0,4)===year)}
function sum(list,type){return list.filter(x=>x.type===type).reduce((a,b)=>a+Number(b.amount||0),0)}
function currentMonthLabel(){
  const [y,m]=state.month.split("-");
  return `${y}년 ${Number(m)}월`;
}
function typeLabel(t){return ({expense:"지출",income:"수입",investment:"저축·투자"})[t]||t}
function audit(action,payload){db.audit.unshift({id:uid(),at:new Date().toISOString(),action,payload});db.audit=db.audit.slice(0,500)}

function setTab(tab){
  state.tab=tab;
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  render();
}
document.querySelectorAll(".nav-btn").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.tab)));

function shiftMonth(delta){
  let [y,m]=state.month.split("-").map(Number); m+=delta;
  if(m<1){m=12;y--} if(m>12){m=1;y++}
  state.month=`${y}-${String(m).padStart(2,"0")}`; render();
}

function homeView(){
  const tx=monthTxns(), income=sum(tx,"income"), expense=sum(tx,"expense"), invest=sum(tx,"investment");
  const remain=income-expense-invest;
  const ytd=ytdTxns(), yInvest=sum(ytd,"investment");
  const goal=Number(db.settings.annualSavingGoal||0);
  const pct=goal?Math.min(100,(yInvest/goal)*100):0;
  const assets=db.accounts.filter(a=>a.kind==="asset").reduce((s,a)=>s+Number(a.amount),0);
  const liabilities=db.accounts.filter(a=>a.kind==="liability").reduce((s,a)=>s+Number(a.amount),0);
  const recent=[...tx].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)).slice(0,6);
  return `
    <div class="month-nav">
      <button onclick="shiftMonth(-1)">‹</button><strong>${currentMonthLabel()}</strong><button onclick="shiftMonth(1)">›</button>
    </div>
    <section class="card hero">
      <div class="muted">현재 순자산</div>
      <div class="big">${won(assets-liabilities)}</div>
      <div class="muted">자산 ${won(assets)} · 부채 ${won(liabilities)}</div>
      <div class="progress-wrap">
        <div class="progress-meta"><span>${state.month.slice(0,4)}년 저축·투자 목표</span><span>${pct.toFixed(1)}%</span></div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="progress-meta"><span>${won(yInvest)}</span><span>${won(goal)}</span></div>
      </div>
    </section>
    <div class="section-title"><h2>이번 달</h2><p>공동 가계 요약</p></div>
    <section class="grid grid-2">
      <div class="card metric"><div class="label">수입</div><div class="value good">${won(income)}</div></div>
      <div class="card metric"><div class="label">생활지출</div><div class="value bad">${won(expense)}</div></div>
      <div class="card metric"><div class="label">저축·투자</div><div class="value">${won(invest)}</div><div class="sub">월 목표 ${won(db.settings.monthlyInvestmentGoal)}</div></div>
      <div class="card metric"><div class="label">잔여현금</div><div class="value ${remain<0?"bad":""}">${won(remain)}</div></div>
    </section>
    <div class="section-title"><h2>최근 거래</h2><p>${recent.length}건</p></div>
    <section class="card">
      ${recent.length?recent.map(txnRow).join(""):`<div class="empty">아직 거래가 없습니다.<br>오른쪽 아래 + 버튼으로 첫 거래를 입력하세요.</div>`}
    </section>
    <button class="fab" onclick="openTxn()">＋</button>
  `;
}

function txnRow(t){
  const sign=t.type==="income"?"+":"−";
  return `<div class="row">
    <div class="row-main" onclick="editTxn('${t.id}')">
      <div class="row-title">${esc(t.category)} <span class="chip">${esc(t.owner||"공동")}</span></div>
      <div class="row-sub">${esc(t.date)} · ${esc(t.payment||"결제수단 미입력")}${t.memo?` · ${esc(t.memo)}`:""}</div>
    </div>
    <div class="row-amount ${t.type}">${sign}${won(t.amount)}</div>
  </div>`;
}

function ledgerView(){
  const list=[...monthTxns()].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  return `
    <div class="month-nav">
      <button onclick="shiftMonth(-1)">‹</button><strong>${currentMonthLabel()} 거래내역</strong><button onclick="shiftMonth(1)">›</button>
    </div>
    <section class="card">
      ${list.length?list.map(t=>`<div class="row">
        <div class="row-main">
          <div class="row-title" onclick="editTxn('${t.id}')">${esc(t.category)} <span class="chip">${typeLabel(t.type)}</span></div>
          <div class="row-sub">${esc(t.date)} · ${esc(t.owner||"공동")} · ${esc(t.payment||"미입력")}${t.memo?` · ${esc(t.memo)}`:""}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="row-amount ${t.type}">${t.type==="income"?"+":"−"}${won(t.amount)}</div>
          <button class="icon-btn" onclick="softDeleteTxn('${t.id}')">🗑</button>
        </div>
      </div>`).join(""):`<div class="empty">이 달의 거래가 없습니다.</div>`}
    </section>
    <button class="fab" onclick="openTxn()">＋</button>
  `;
}

function budgetView(){
  const tx=monthTxns().filter(t=>t.type==="expense");
  const rows=db.budgets.map(b=>{
    const used=tx.filter(t=>t.category===b.category).reduce((s,t)=>s+Number(t.amount),0);
    const p=b.monthlyLimit?Math.min(100,used/b.monthlyLimit*100):0;
    return `<div class="row">
      <div class="row-main" style="flex:1">
        <div class="row-title">${esc(b.category)}</div>
        <div class="row-sub">${won(used)} / ${won(b.monthlyLimit)}</div>
        <div class="progress" style="margin-top:7px;background:#e5e7eb"><div style="width:${p}%;background:#111827"></div></div>
      </div>
      <button class="secondary-btn" onclick="editBudget('${b.id}')">수정</button>
    </div>`;
  });
  return `
    <div class="section-title"><h2>${currentMonthLabel()} 예산</h2><p>카테고리별</p></div>
    <section class="card">${rows.length?rows.join(""):`<div class="empty">예산이 없습니다.</div>`}</section>
    <div class="btn-row" style="margin-top:10px"><button class="primary-btn" onclick="addBudget()">예산 추가</button></div>
  `;
}

function assetsView(){
  const assets=db.accounts.filter(a=>a.kind==="asset"), debts=db.accounts.filter(a=>a.kind==="liability");
  const sa=assets.reduce((s,a)=>s+Number(a.amount),0), sd=debts.reduce((s,a)=>s+Number(a.amount),0);
  const list=(arr,kind)=>arr.length?arr.map(a=>`<div class="row">
    <div class="row-main" onclick="editAccount('${a.id}')"><div class="row-title">${esc(a.name)}</div><div class="row-sub">${esc(a.category||"미분류")}</div></div>
    <div style="display:flex;align-items:center;gap:6px"><div class="row-amount ${kind==="liability"?"expense":""}">${won(a.amount)}</div><button class="icon-btn" onclick="deleteAccount('${a.id}')">🗑</button></div>
  </div>`).join(""):`<div class="empty">등록된 항목이 없습니다.</div>`;
  return `
    <section class="grid grid-3">
      <div class="card metric"><div class="label">총자산</div><div class="value">${won(sa)}</div></div>
      <div class="card metric"><div class="label">총부채</div><div class="value bad">${won(sd)}</div></div>
      <div class="card metric"><div class="label">순자산</div><div class="value good">${won(sa-sd)}</div></div>
    </section>
    <div class="section-title"><h2>자산</h2></div><section class="card">${list(assets,"asset")}</section>
    <div class="section-title"><h2>부채</h2></div><section class="card">${list(debts,"liability")}</section>
    <div class="btn-row" style="margin-top:10px"><button class="primary-btn" onclick="openAccount()">자산/부채 추가</button></div>
  `;
}

function settingsView(){
  return `
    <div class="section-title"><h2>가구 설정</h2><p>v${APP_VERSION} · DB ${DB_VERSION}</p></div>
    <section class="card">
      <label>가구 이름<input id="householdName" value="${esc(db.settings.householdName)}" /></label><br>
      <label>연간 저축·투자 목표<input id="annualGoal" type="number" value="${Number(db.settings.annualSavingGoal)}" /></label><br>
      <label>월 저축·투자 목표<input id="monthlyGoal" type="number" value="${Number(db.settings.monthlyInvestmentGoal)}" /></label><br>
      <button class="primary-btn" onclick="saveSettings()">설정 저장</button>
    </section>
    <div class="section-title"><h2>백업 및 복구</h2><p>데이터 보호</p></div>
    <section class="card">
      <div class="notice">JSON은 앱 전체 복구용, CSV는 거래내역 확인용입니다. 서버 공동작업 기능을 붙이기 전까지 데이터는 이 기기의 브라우저에 저장됩니다.</div>
      <div class="btn-row" style="margin-top:12px">
        <button class="primary-btn" onclick="exportJSON()">전체 JSON 백업</button>
        <button class="secondary-btn" onclick="exportCSV()">거래 CSV</button>
        <button class="secondary-btn" onclick="document.getElementById('restoreInput').click()">JSON 복구</button>
      </div>
    </section>
    <div class="section-title"><h2>휴지통</h2><p>${db.trash.length}건</p></div>
    <section class="card">
      ${db.trash.length?db.trash.map(t=>`<div class="row"><div class="row-main"><div class="row-title">${esc(t.category)} · ${won(t.amount)}</div><div class="row-sub">${esc(t.date)} · 삭제됨</div></div><button class="secondary-btn" onclick="restoreTxn('${t.id}')">복구</button></div>`).join(""):`<div class="empty">휴지통이 비어 있습니다.</div>`}
    </section>
    <div class="section-title"><h2>변경 이력</h2><p>최근 ${Math.min(db.audit.length,10)}건</p></div>
    <section class="card">
      ${db.audit.slice(0,10).map(a=>`<div class="row"><div class="row-main"><div class="row-title">${esc(a.action)}</div><div class="row-sub">${new Date(a.at).toLocaleString("ko-KR")}</div></div></div>`).join("")||`<div class="empty">이력이 없습니다.</div>`}
    </section>
  `;
}

function render(){
  const views={home:homeView,ledger:ledgerView,budget:budgetView,assets:assetsView,settings:settingsView};
  document.getElementById("view").innerHTML=views[state.tab]();
}
window.shiftMonth=shiftMonth;

const txnDialog=document.getElementById("txnDialog");
const txnForm=document.getElementById("txnForm");
function fillCategories(type){
  const sel=document.getElementById("txnCategory");
  sel.innerHTML=(db.categories[type]||[]).map(c=>`<option>${esc(c)}</option>`).join("");
}
document.getElementById("txnType").addEventListener("change",e=>fillCategories(e.target.value));

function openTxn(){
  txnForm.reset(); document.getElementById("txnId").value="";
  document.getElementById("txnDate").value=new Date().toISOString().slice(0,10);
  document.getElementById("txnType").value="expense";fillCategories("expense");
  document.getElementById("txnOwner").value="공동";
  txnDialog.showModal();
}
function editTxn(id){
  const t=db.transactions.find(x=>x.id===id); if(!t)return;
  document.getElementById("txnId").value=t.id;document.getElementById("txnDate").value=t.date;
  document.getElementById("txnType").value=t.type;fillCategories(t.type);document.getElementById("txnCategory").value=t.category;
  document.getElementById("txnAmount").value=t.amount;document.getElementById("txnOwner").value=t.owner||"공동";
  document.getElementById("txnPayment").value=t.payment||"";document.getElementById("txnMemo").value=t.memo||"";
  txnDialog.showModal();
}
txnForm.addEventListener("submit",e=>{
  if(e.submitter?.value==="cancel")return;
  e.preventDefault();
  const id=document.getElementById("txnId").value||uid();
  const old=db.transactions.find(x=>x.id===id);
  const t={id,date:document.getElementById("txnDate").value,type:document.getElementById("txnType").value,
    amount:Number(document.getElementById("txnAmount").value),category:document.getElementById("txnCategory").value,
    owner:document.getElementById("txnOwner").value,payment:document.getElementById("txnPayment").value.trim(),
    memo:document.getElementById("txnMemo").value.trim(),createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),enteredBy:"현재 사용자"};
  if(old){Object.assign(old,t);audit("거래 수정",{id})}else{db.transactions.push(t);audit("거래 추가",{id})}
  saveDB();txnDialog.close();render();
});
function softDeleteTxn(id){
  const i=db.transactions.findIndex(x=>x.id===id); if(i<0)return;
  const [t]=db.transactions.splice(i,1); t.deletedAt=new Date().toISOString(); db.trash.unshift(t); audit("거래 삭제",{id});saveDB();render();
}
function restoreTxn(id){
  const i=db.trash.findIndex(x=>x.id===id);if(i<0)return;
  const [t]=db.trash.splice(i,1);delete t.deletedAt;db.transactions.push(t);audit("거래 복구",{id});saveDB();render();
}

function addBudget(){
  const category=prompt("예산 카테고리 이름"); if(!category)return;
  const amount=Number(prompt("월 예산 금액(원)")); if(!amount)return;
  db.budgets.push({id:uid(),category,monthlyLimit:amount});audit("예산 추가",{category,amount});saveDB();render();
}
function editBudget(id){
  const b=db.budgets.find(x=>x.id===id);if(!b)return;
  const amount=Number(prompt(`${b.category} 월 예산`,b.monthlyLimit)); if(!amount)return;
  b.monthlyLimit=amount;audit("예산 수정",{id,amount});saveDB();render();
}

const assetDialog=document.getElementById("assetDialog"), assetForm=document.getElementById("assetForm");
function openAccount(){
  assetForm.reset();document.getElementById("assetId").value="";document.getElementById("assetKind").value="asset";assetDialog.showModal();
}
function editAccount(id){
  const a=db.accounts.find(x=>x.id===id);if(!a)return;
  document.getElementById("assetId").value=a.id;document.getElementById("assetKind").value=a.kind;document.getElementById("assetName").value=a.name;
  document.getElementById("assetAmount").value=a.amount;document.getElementById("assetCategory").value=a.category||"";assetDialog.showModal();
}
assetForm.addEventListener("submit",e=>{
  if(e.submitter?.value==="cancel")return;e.preventDefault();
  const id=document.getElementById("assetId").value||uid();
  const old=db.accounts.find(x=>x.id===id);
  const a={id,kind:document.getElementById("assetKind").value,name:document.getElementById("assetName").value.trim(),
    amount:Number(document.getElementById("assetAmount").value),category:document.getElementById("assetCategory").value.trim(),updatedAt:new Date().toISOString()};
  if(old){Object.assign(old,a);audit("자산/부채 수정",{id})}else{db.accounts.push(a);audit("자산/부채 추가",{id})}
  saveDB();assetDialog.close();render();
});
function deleteAccount(id){db.accounts=db.accounts.filter(x=>x.id!==id);audit("자산/부채 삭제",{id});saveDB();render()}

function saveSettings(){
  db.settings.householdName=document.getElementById("householdName").value.trim()||"우리집";
  db.settings.annualSavingGoal=Number(document.getElementById("annualGoal").value)||0;
  db.settings.monthlyInvestmentGoal=Number(document.getElementById("monthlyGoal").value)||0;
  audit("설정 변경",{});saveDB();render();
}
function download(name,blob){
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)
}
function exportJSON(){
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  download(`ourhome_backup_${APP_VERSION}_${stamp}.json`,new Blob([JSON.stringify(db,null,2)],{type:"application/json"}));
}
function csvCell(v){v=String(v??"").replace(/"/g,'""');return `"${v}"`}
function exportCSV(){
  const head=["날짜","구분","금액","카테고리","주체","결제수단","메모","입력자"];
  const rows=db.transactions.map(t=>[t.date,typeLabel(t.type),t.amount,t.category,t.owner,t.payment,t.memo,t.enteredBy]);
  const csv="\uFEFF"+[head,...rows].map(r=>r.map(csvCell).join(",")).join("\n");
  download(`ourhome_transactions_${new Date().toISOString().slice(0,10)}.csv`,new Blob([csv],{type:"text/csv;charset=utf-8"}));
}
document.getElementById("restoreInput").addEventListener("change",async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const parsed=JSON.parse(await file.text());
    if(!parsed.meta || !Array.isArray(parsed.transactions)) throw new Error("형식 오류");
    if(confirm("현재 데이터를 백업 파일로 덮어쓸까요?")){
      localStorage.setItem(KEY,JSON.stringify(parsed));db=loadDB();audit("JSON 복구",{});saveDB();render();
    }
  }catch(err){alert("복구할 수 없는 파일입니다.")}
  e.target.value="";
});

Object.assign(window,{openTxn,editTxn,softDeleteTxn,restoreTxn,addBudget,editBudget,openAccount,editAccount,deleteAccount,saveSettings,exportJSON,exportCSV});

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}
render();
