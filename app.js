/* 小票簿 — 公司雜費收據記錄 (PWA)
 * 登入：Firebase Authentication（電郵＋密碼）
 * 資料：Cloud Firestore（即時同步；相片壓縮後存於 Firestore，免費 Spark 方案即可）
 * AI：Firebase AI Logic → Gemini Developer API（免費額度，API key 不會出現在 App 內）
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, getDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { getAI, getGenerativeModel, GoogleAIBackend, VertexAIBackend } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-ai.js';
import { docScan } from './scan.js?v=13';

const CATS=[
  {id:'food',zh:'餐飲食物',code:'6110',acct:'膳食及招待費'},
  {id:'stationery',zh:'文具',code:'6120',acct:'文具及辦公用品'},
  {id:'transport',zh:'交通',code:'6130',acct:'交通及差旅費'},
  {id:'hotel',zh:'住宿',code:'6135',acct:'住宿費'},
  {id:'daily',zh:'日用品／清潔',code:'6140',acct:'清潔及日用品'},
  {id:'shipping',zh:'郵寄快遞',code:'6150',acct:'郵費及速遞費'},
  {id:'other',zh:'其他',code:'6190',acct:'雜項開支'}];
const CAT_COLOR={food:'--c-food',stationery:'--c-stationery',transport:'--c-transport',hotel:'--c-transport',daily:'--c-daily',shipping:'--c-shipping',other:'--c-other'};
const CURS=[['HKD','HK$'],['KRW','₩'],['JPY','JP¥'],['CNY','CN¥'],['TWD','NT$'],['USD','US$'],['EUR','€']];
const DEFAULT_RATES={HKD:1,KRW:0.0056,JPY:0.0508,CNY:1.08,TWD:0.24,USD:7.78,EUR:8.4};

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parseD=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const today=()=>ymd(new Date());
const r2=n=>Math.round((n||0)*100)/100;
const sym=c=>(CURS.find(x=>x[0]===c)||[c,c+' '])[1];
const fmtHKD=n=>'HK$'+(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtCur=(n,c)=>sym(c)+(n||0).toLocaleString('en-US',{maximumFractionDigits:['HKD','USD','EUR','CNY','TWD'].includes(c)?2:0,minimumFractionDigits:c==='HKD'?2:0});
const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const lsSet=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};

let auth=null,db=null,aiRoot=null,me=null,MODELS=['gemini-2.5-flash'],GEMINI_KEY='',CFG_KEY='';
const modelCache={};
let fbApp=null,AI_SOURCE='vertex';
// AI 來源：'vertex' = Firebase Vertex AI（香港可用，需 Blaze 方案）；'key' = Google AI Studio 金鑰（香港不支援）
const aiRootFor=src=>{try{return getAI(fbApp,{backend:src==='vertex'?new VertexAIBackend():new GoogleAIBackend()})}catch(e){console.warn('AI unavailable',e);return null}};
const modelFor=m=>{const k=AI_SOURCE+'|'+m;if(!modelCache[k]){const root=aiRootFor(AI_SOURCE);if(!root)throw new Error('AI not configured');modelCache[k]=getGenerativeModel(root,{model:m,generationConfig:{responseMimeType:'application/json',temperature:0.1}})}return modelCache[k]};
const useKey=()=>AI_SOURCE==='key'&&!!GEMINI_KEY;
const aiStatus=e=>e?.customErrorData?.status||(/\[(\d{3})/.exec(String(e?.message||''))||[])[1]*1||0;
let rows=[],reports=[],loaded=false,unsubs=[];
let settings={rates:{...DEFAULT_RATES},accounts:{},photoQuality:'standard',scan:true};
let tab='receipts',statusF='all',q='',filter=null,openReport=null,newRepOpen=false;
let sRange=null,sDim='cat';
let editing=null,pending=null,formTags=[];

const cat=id=>{const c=CATS.find(c=>c.id===id)||CATS[CATS.length-1];const a=settings.accounts?.[c.id]||{};return {...c,code:a.code||c.code,acct:a.acct||c.acct}};
const rateOf=c=>Number(settings.rates?.[c])||DEFAULT_RATES[c]||1;
const hkdOf=r=>typeof r.hkd==='number'&&!isNaN(r.hkd)?r.hkd:r2((Number(r.amount)||0)*(Number(r.rate)||rateOf(r.currency||'KRW')));
const repName=id=>reports.find(x=>x.id===id)?.name||'';
const imgUrl=r=>r.thumb||'';

function toast(t){const el=$('toast');el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,2400)}

// ---------- data layer ----------
function subscribe(){
  unsubs.forEach(u=>u());unsubs=[];
  const timer=setTimeout(()=>{if(!loaded)$('rcList').innerHTML='<div class="empty"><strong>載入時間較長</strong><span>請檢查網絡，或確認 Firestore 已按 README 設定好。</span></div>'},10000);
  const fail=e=>{console.error(e);clearTimeout(timer);$('rcList').innerHTML='<div class="empty"><strong>未能載入記錄</strong><span>'+(e?.code==='permission-denied'?'你沒有權限，請確認已登入公司帳戶，以及 Firestore 規則已設定。':'請檢查網絡後重新開啟。')+'</span></div>'};
  unsubs.push(onSnapshot(collection(db,'expenses'),snap=>{clearTimeout(timer);loaded=true;rows=snap.docs.map(d=>({id:d.id,tags:[],items:[],...d.data()})).filter(r=>r.date);render()},fail));
  unsubs.push(onSnapshot(collection(db,'reports'),snap=>{reports=snap.docs.map(d=>({id:d.id,...d.data()}));render()},()=>{}));
  // AI 金鑰存於 Firestore（只有已登入的成員可讀），不會出現在公開的程式碼
  unsubs.push(onSnapshot(doc(db,'settings','ai'),s=>{const d=s.exists()?s.data():{};GEMINI_KEY=(d.geminiKey||CFG_KEY||'').trim();AI_SOURCE=d.source==='key'?'key':'vertex';updAiKeyState()},()=>{}));
  unsubs.push(onSnapshot(doc(db,'settings','main'),s=>{const d=s.exists()&&s.data();if(d){settings={rates:{...DEFAULT_RATES,...(d.rates||{})},accounts:d.accounts||{},photoQuality:d.photoQuality||'standard',scan:d.scan!==false};render()}},()=>{}));
}
const errMsg=e=>e?.code==='permission-denied'?'你沒有權限':e?.code==='unavailable'?'網絡中斷，恢復後會自動同步':(e?.message||'請再試');

// ---------- shared row ----------
function rowHtml(r){
  const c=cat(r.category);const u=imgUrl(r);
  const tags=[`<span class="tag"><span class="dot" style="background:var(${CAT_COLOR[c.id]})"></span>${esc(c.zh)}</span>`,...(r.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`)].join('');
  return `<button class="row" data-id="${esc(r.id)}">
    ${u?`<img class="thumb" src="${esc(u)}" alt="" loading="lazy">`:'<span class="thumb"></span>'}
    <span class="rmain"><span class="rtitle">${esc(r.merchantZh||r.merchantOrig||'未命名商戶')}</span>
      ${r.merchantOrig&&r.merchantOrig!==r.merchantZh?`<span class="rorig ko">${esc(r.merchantOrig)}</span>`:''}
      <span class="tags">${tags}</span></span>
    <span class="rright"><span class="hkd">${r.currency==='HKD'?'':'≈'}${fmtHKD(hkdOf(r))}</span>
      ${r.currency!=='HKD'?`<span class="orig">${fmtCur(r.amount,r.currency)}</span>`:''}
      <span class="pill ${r.status==='done'?'done':'pending'}">${r.status==='done'?'已報銷':'待報銷'}</span></span>
  </button>`;
}
function groupedList(list,emptyMsg){
  if(!list.length)return `<div class="empty"><strong>${emptyMsg[0]}</strong><span>${emptyMsg[1]}</span></div>`;
  let html='',cur='';
  const byM={};list.forEach(r=>{const m=(r.date||'').slice(0,7);byM[m]=(byM[m]||0)+hkdOf(r)});
  list.forEach(r=>{const m=(r.date||'').slice(0,7);if(m!==cur){cur=m;const [y,mm]=m.split('-');html+=`<div class="mhead"><span>${y} 年 ${+mm} 月</span><span class="num">${fmtHKD(byM[m])}</span></div>`}html+=rowHtml(r)});
  return html;
}
const sortDesc=l=>l.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||'').localeCompare(a.createdAt||''));

// ---------- tabs ----------
function setTab(t){
  tab=t;if(t!=='reports')openReport=null;
  ['receipts','stats','reports'].forEach(x=>$('v-'+x).hidden=x!==t);
  document.querySelectorAll('.tabbar button').forEach(b=>{if(b.dataset.tab===t)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
  if(location.hash!=='#'+t)try{history.replaceState(null,'','#'+t)}catch(e){}
  render();window.scrollTo(0,0);
}
document.querySelector('.tabbar nav').onclick=e=>{const b=e.target.closest('button');if(b)setTab(b.dataset.tab)};
window.addEventListener('hashchange',()=>{const h=location.hash.slice(1);if(['receipts','stats','reports'].includes(h)&&h!==tab)setTab(h)});
function render(){if($('appView').hidden)return;if(tab==='receipts')renderReceipts();else if(tab==='stats')renderStats();else renderReports()}

// ---------- 收據 ----------
function matchQ(r){if(!q)return true;const s=(r.merchantZh+' '+r.merchantOrig+' '+r.note+' '+(r.tags||[]).join(' ')+' '+cat(r.category).zh).toLowerCase();return s.includes(q.toLowerCase())}
function renderReceipts(){
  let list=rows.filter(matchQ);
  if(statusF!=='all')list=list.filter(r=>statusF==='done'?r.status==='done':r.status!=='done');
  if(filter)list=list.filter(filter.fn);
  $('fBanner').hidden=!filter;if(filter)$('fText').textContent='篩選：'+filter.label;
  $('rcSub').textContent=list.length+' 張收據 · '+fmtHKD(list.reduce((s,r)=>s+hkdOf(r),0));
  {const u=usageText();const n=$('notice');if(loaded&&u.pct>80){n.innerHTML='<span>免費容量已用 '+u.pct.toFixed(0)+'%。請到「報告」匯出備份 ZIP，或聯絡管理員。</span>';n.hidden=false}else n.hidden=true}
  $('rcList').innerHTML=!loaded?'<div class="empty">正在載入記錄…</div>':groupedList(sortDesc(list),rows.length?['沒有符合的收據','試下改搜尋字眼或清除篩選。']:['還沒有收據','按右上角「＋」影相上載，系統會讀取外文收據、翻譯成中文並自動分類。']);
}
$('q').oninput=e=>{q=e.target.value.trim();renderReceipts()};
$('statusF').onclick=e=>{const b=e.target.closest('button');if(!b)return;statusF=b.dataset.s;[...$('statusF').children].forEach(x=>x.setAttribute('aria-pressed',x===b));renderReceipts()};
$('fClear').onclick=()=>{filter=null;renderReceipts()};
document.addEventListener('click',e=>{const b=e.target.closest('.row');if(b&&b.dataset.id)openDetail(b.dataset.id)});

// ---------- 統計 ----------
const fyOf=d=>d.getMonth()>=3?d.getFullYear():d.getFullYear()-1;
function presets(){
  const n=new Date(),y=n.getFullYear(),m=n.getMonth();
  const mStart=(yy,mm)=>ymd(new Date(yy,mm,1)),mEnd=(yy,mm)=>ymd(new Date(yy,mm+1,0));
  const fy=fyOf(n),fs=String(fy).slice(2)+'-'+String(fy+1).slice(2);
  const pm=new Date(y,m-1,1);
  const dates=rows.map(r=>r.date).filter(Boolean).sort();
  return [
    {id:'tm',lbl:(m+1)+'月',from:mStart(y,m),to:mEnd(y,m)},
    {id:'lm',lbl:(pm.getMonth()+1)+'月',from:mStart(pm.getFullYear(),pm.getMonth()),to:mEnd(pm.getFullYear(),pm.getMonth())},
    {id:'fy',lbl:fs+' 財年',from:fy+'-04-01',to:(fy+1)+'-03-31'},
    {id:'ty',lbl:String(y),from:y+'-01-01',to:y+'-12-31'},
    {id:'all',lbl:'全部',from:dates[0]||mStart(y,m),to:dates[dates.length-1]||mEnd(y,m)}];
}
const inRange=r=>r.date>=sRange.from&&r.date<=sRange.to;
function renderStats(){
  const P=presets();
  if(!sRange){const p=P[0];sRange={from:p.from,to:p.to,preset:p.id}}
  else if(sRange.preset){const p=P.find(x=>x.id===sRange.preset);if(p){sRange.from=p.from;sRange.to=p.to}}
  $('sFrom').value=sRange.from;$('sTo').value=sRange.to;
  $('sPresets').innerHTML=P.map(p=>`<button data-p="${p.id}" aria-pressed="${sRange.preset===p.id}">${p.lbl}</button>`).join('');
  const list=rows.filter(inRange);
  const tot=list.reduce((s,r)=>s+hkdOf(r),0);
  const days=Math.max(1,Math.round((parseD(sRange.to)-parseD(sRange.from))/864e5)+1);
  const p=P.find(x=>x.id===sRange.preset);
  $('sLbl').textContent=p?p.lbl+(p.id==='tm'||p.id==='lm'?' '+sRange.from.slice(0,4):''):sRange.from.replace(/-/g,'/')+' – '+sRange.to.replace(/-/g,'/');
  $('sTotal').textContent=fmtHKD(tot);$('sCount').textContent=list.length;$('sAvg').textContent=fmtHKD(tot/days);
  $('sAllN').textContent=list.length+' ›';
  drawChart(list,days);drawBreak(list,tot);
}
$('sPresets').onclick=e=>{const b=e.target.closest('button');if(!b)return;sRange={preset:b.dataset.p};renderStats()};
$('sFrom').onchange=e=>{if(!e.target.value)return;sRange={from:e.target.value,to:sRange.to<e.target.value?e.target.value:sRange.to,preset:null};renderStats()};
$('sTo').onchange=e=>{if(!e.target.value)return;sRange={from:sRange.from>e.target.value?e.target.value:sRange.from,to:e.target.value,preset:null};renderStats()};
$('sDims').onclick=e=>{const b=e.target.closest('button');if(!b)return;sDim=b.dataset.d;[...$('sDims').children].forEach(x=>x.setAttribute('aria-pressed',x===b));renderStats()};

function niceStep(v){if(v<=0)return 1;const p=Math.pow(10,Math.floor(Math.log10(v)));for(const m of [1,2,2.5,5,10])if(m*p>=v)return m*p;return 10*p}
function drawChart(list,days){
  const el=$('chart');const W=Math.max(260,el.clientWidth||600),H=200,L=44,R=8,T=12,B=26;
  const byDay=days<=62;const buckets=[];
  if(byDay){for(let i=0;i<days;i++){const d=parseD(sRange.from);d.setDate(d.getDate()+i);buckets.push({key:ymd(d),lbl:(d.getMonth()+1)+'月'+d.getDate(),v:0})}}
  else{let d=parseD(sRange.from);d=new Date(d.getFullYear(),d.getMonth(),1);const end=parseD(sRange.to);while(d<=end){buckets.push({key:ymd(d).slice(0,7),lbl:d.getFullYear()+'/'+(d.getMonth()+1),v:0});d=new Date(d.getFullYear(),d.getMonth()+1,1)}}
  const idx={};buckets.forEach((b,i)=>idx[b.key]=i);
  list.forEach(r=>{const k=byDay?r.date:r.date.slice(0,7);if(k in idx)buckets[idx[k]].v+=hkdOf(r)});
  $('sGran').textContent=byDay?'按日':'按月';
  const total=buckets.reduce((s,b)=>s+b.v,0),avg=total/buckets.length;
  const max=Math.max(...buckets.map(b=>b.v),avg,1);
  const step=niceStep(max/3),top=Math.ceil(max/step)*step;
  const y=v=>T+(H-T-B)*(1-v/top);
  const bw=(W-L-R)/buckets.length,barW=Math.max(2,Math.min(14,bw*0.6));
  let s=`<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="支出趨勢圖，總額 ${fmtHKD(total)}">`;
  for(let v=0;v<=top+1e-9;v+=step){s+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-dasharray="${v?'3 4':''}"/><text x="${L-6}" y="${y(v)+4}" text-anchor="end">${v>=1000?(v/1000)+'k':Math.round(v)}</text>`}
  const every=Math.ceil(buckets.length/(W<420?4:7));
  buckets.forEach((b,i)=>{
    const cx=L+bw*i+bw/2;
    if(b.v>0){const h=Math.max(2,y(0)-y(b.v)),rr=Math.min(4,barW/2,h);s+=`<path d="M${cx-barW/2},${y(0)} v${-(h-rr)} q0,${-rr} ${rr},${-rr} h${barW-2*rr} q${rr},0 ${rr},${rr} v${h-rr} z" fill="var(--accent)"/>`}
    s+=`<rect x="${L+bw*i}" y="${T}" width="${bw}" height="${H-T-B}" fill="transparent" data-i="${i}"/>`;
    if(i%every===0)s+=`<text x="${cx}" y="${H-8}" text-anchor="middle">${esc(b.lbl)}</text>`;
  });
  if(total>0)s+=`<line x1="${L}" x2="${W-R}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--avg)" stroke-width="2" stroke-dasharray="6 5"/><text x="${W-R}" y="${y(avg)-6}" text-anchor="end" style="fill:var(--avg)">平均 ${fmtHKD(avg)}</text>`;
  s+='</svg><div class="tip" hidden></div>';
  el.innerHTML=s;
  const tip=el.querySelector('.tip'),svg=el.querySelector('svg');
  svg.addEventListener('pointermove',e=>{const t=e.target.closest('rect[data-i]');if(!t){tip.hidden=true;return}const i=+t.dataset.i,b=buckets[i];const sc=svg.getBoundingClientRect().width/W;tip.textContent=b.lbl+'：'+fmtHKD(b.v);tip.style.left=Math.min(el.clientWidth-60,Math.max(60,(L+bw*i+bw/2)*sc))+'px';tip.style.top=(y(b.v)*sc-6)+'px';tip.hidden=false});
  svg.addEventListener('pointerleave',()=>tip.hidden=true);
}
let rzT;window.addEventListener('resize',()=>{clearTimeout(rzT);rzT=setTimeout(()=>{if(tab==='stats')renderStats()},150)});

function dimGroups(list){
  const g={};
  const add=(k,name,color,r)=>{(g[k]=g[k]||{k,name,color,v:0,n:0}).v+=hkdOf(r);g[k].n++};
  list.forEach(r=>{
    if(sDim==='cat'){const c=cat(r.category);add(c.id,c.zh,`var(${CAT_COLOR[c.id]})`,r)}
    else if(sDim==='tag'){const t=r.tags||[];if(!t.length)add('__none','未標記','var(--c-other)',r);else t.forEach(x=>add('t:'+x,x,'var(--accent)',r))}
    else if(sDim==='merchant'){const m=r.merchantZh||r.merchantOrig||'未命名';add('m:'+m,m,'var(--accent)',r)}
    else add('c:'+(r.currency||'KRW'),(r.currency||'KRW')+'（'+sym(r.currency||'KRW')+'）','var(--accent)',r);
  });
  return Object.values(g).sort((a,b)=>b.v-a.v);
}
function drawBreak(list,tot){
  const gs=dimGroups(list);
  if(!gs.length){$('sBreak').innerHTML='<div class="empty" style="padding:20px">這段期間沒有收據</div>';return}
  const shown=gs.slice(0,12);
  $('sBreak').innerHTML=shown.map((g,i)=>`<button class="brow" data-k="${esc(g.k)}">
    <span class="rk">${g.k==='__none'?'—':i+1}</span>
    <span class="nm"><span class="dot" style="background:${g.color}"></span><span>${esc(g.name)}</span><small>· ${g.n}</small></span>
    <span class="amt">${fmtHKD(g.v)}</span>
    <span></span><span class="track"><i style="width:${tot?g.v/tot*100:0}%;background:${g.color}"></i></span><span class="pct">${tot?Math.round(g.v/tot*100):0}%</span>
  </button>`).join('')+(gs.length>12?`<div class="note">另有 ${gs.length-12} 項較少的未列出</div>`:'')+(sDim==='tag'?'<div class="note">一張收據會計入其每個標籤，因此各長條的總和可能超過實際支出。</div>':'');
}
$('sBreak').onclick=e=>{
  const b=e.target.closest('.brow');if(!b)return;const k=b.dataset.k;const range={...sRange};
  const g=dimGroups(rows.filter(inRange)).find(x=>x.k===k);
  const inR=r=>r.date>=range.from&&r.date<=range.to;
  let fn;
  if(sDim==='cat')fn=r=>inR(r)&&cat(r.category).id===k;
  else if(sDim==='tag')fn=k==='__none'?r=>inR(r)&&!(r.tags||[]).length:r=>inR(r)&&(r.tags||[]).includes(k.slice(2));
  else if(sDim==='merchant')fn=r=>inR(r)&&(r.merchantZh||r.merchantOrig||'未命名')===k.slice(2);
  else fn=r=>inR(r)&&(r.currency||'KRW')===k.slice(2);
  filter={fn,label:(g?.name||'')+' · '+range.from.replace(/-/g,'/')+'–'+range.to.replace(/-/g,'/')};
  statusF='all';[...$('statusF').children].forEach(x=>x.setAttribute('aria-pressed',x.dataset.s==='all'));
  setTab('receipts');
};
$('sAll').onclick=()=>{const range={...sRange};filter={fn:r=>r.date>=range.from&&r.date<=range.to,label:range.from.replace(/-/g,'/')+'–'+range.to.replace(/-/g,'/')};setTab('receipts')};
$('sZip').onclick=e=>exportZip(rows.filter(inRange),'公司雜費-'+sRange.from+'至'+sRange.to,sRange.from.replace(/-/g,'/')+' – '+sRange.to.replace(/-/g,'/'),e.currentTarget);
$('sExport').onclick=()=>exportXlsx(rows.filter(inRange),'公司雜費-'+sRange.from+'至'+sRange.to,sRange.from.replace(/-/g,'/')+' – '+sRange.to.replace(/-/g,'/'));

// ---------- 報告 ----------
function renderReports(){
  const V=$('v-reports');
  if(openReport){
    const isNone=openReport==='__none';const rep=reports.find(x=>x.id===openReport);
    if(!isNone&&!rep){openReport=null;return renderReports()}
    const list=sortDesc(rows.filter(r=>isNone?!reports.some(x=>x.id===r.reportId):r.reportId===openReport));
    const tot=list.reduce((s,r)=>s+hkdOf(r),0);
    V.innerHTML=`<div class="bar"><button id="repBack">‹ 報告</button><div class="chips">${isNone?'':'<button id="repRename">改名</button><button id="repDel" class="danger">刪除</button>'}</div></div>
      <div><h1 style="font-size:28px">${esc(isNone?'未歸入報告':rep.name)}</h1><div class="sub num">${list.length} 張收據 · ${fmtHKD(tot)}</div></div>
      <div id="repEdit"></div>
      <div class="chips"><button class="primary" id="repExport">匯出 Excel</button><button id="repZip">匯出備份 ZIP（Excel＋相片）</button></div>
      <div class="list">${groupedList(list,['這個報告還沒有收據','新增收據時，在「報告」揀選這個報告。'])}</div>`;
    $('repBack').onclick=()=>{openReport=null;renderReports()};
    $('repExport').onclick=()=>exportXlsx(list,isNone?'未歸入報告':rep.name,isNone?'未歸入報告':rep.name);
    $('repZip').onclick=e=>exportZip(list,isNone?'未歸入報告':rep.name,isNone?'未歸入報告':rep.name,e.currentTarget);
    if(!isNone){
      $('repRename').onclick=()=>{$('repEdit').innerHTML=`<div class="newrep"><input id="repNameIn" value="${esc(rep.name)}" aria-label="報告名稱"><button class="primary" id="repNameOk">儲存</button></div>`;$('repNameIn').focus();
        $('repNameOk').onclick=async()=>{const v=$('repNameIn').value.trim();if(!v)return;try{await updateDoc(doc(db,'reports',rep.id),{name:v});toast('已改名')}catch(e){toast('改名失敗：'+errMsg(e))}}};
      $('repDel').onclick=()=>{$('repEdit').innerHTML=`<div class="confirm">刪除報告「${esc(rep.name)}」？${list.length?'入面 '+list.length+' 張收據會移到「未歸入報告」，不會被刪除。':''}<button id="rdNo">取消</button><button class="danger" id="rdYes">確定刪除</button></div>`;
        $('rdNo').onclick=()=>$('repEdit').innerHTML='';
        $('rdYes').onclick=async()=>{try{for(let i=0;i<list.length;i+=400){const b=writeBatch(db);list.slice(i,i+400).forEach(r=>b.update(doc(db,'expenses',r.id),{reportId:''}));await b.commit()}await deleteDoc(doc(db,'reports',rep.id));openReport=null;toast('已刪除報告')}catch(e){toast('刪除失敗：'+errMsg(e))}}};
    }
    return;
  }
  const stats=reports.map(rep=>{const l=rows.filter(r=>r.reportId===rep.id);return {rep,n:l.length,v:l.reduce((s,r)=>s+hkdOf(r),0)}})
    .sort((a,b)=>(b.rep.createdAt||'').localeCompare(a.rep.createdAt||''));
  const none=rows.filter(r=>!reports.some(x=>x.id===r.reportId));
  V.innerHTML=`<div class="bar"><div><h1>報告</h1><div class="sub">${reports.length} 份報告</div></div><button class="primary" id="repNew">＋ 新報告</button></div>
    <div id="repNewBox" ${newRepOpen?'':'hidden'}><div class="newrep"><input id="repNewName" placeholder="例：26-27 KRW、公司旅行（首爾）" aria-label="新報告名稱"><button class="primary" id="repNewOk">建立</button></div></div>
    ${stats.map(s=>`<button class="rep" data-r="${esc(s.rep.id)}"><span style="min-width:0"><div class="nm">${esc(s.rep.name)}</div><div class="ct">${s.n}</div></span><span style="display:flex;gap:10px;align-items:center"><span class="tot">${fmtHKD(s.v)}</span><span class="chev">›</span></span></button>`).join('')}
    ${none.length?`<button class="rep" data-r="__none"><span><div class="nm" style="color:var(--muted)">未歸入報告</div><div class="ct">${none.length}</div></span><span style="display:flex;gap:10px;align-items:center"><span class="tot">${fmtHKD(none.reduce((s,r)=>s+hkdOf(r),0))}</span><span class="chev">›</span></span></button>`:''}
    ${!reports.length&&!none.length?'<div class="card empty"><strong>還沒有報告</strong><span>報告可以將收據分組，例如按財年和貨幣（26-27 KRW）或按一次公司旅行。每份報告都可以獨立匯出會計報表。</span></div>':''}`;
  $('repNew').onclick=()=>{newRepOpen=!newRepOpen;$('repNewBox').hidden=!newRepOpen;if(newRepOpen)$('repNewName').focus()};
  const create=async()=>{const v=$('repNewName').value.trim();if(!v){toast('請輸入報告名稱');return}try{await addDoc(collection(db,'reports'),{name:v,createdAt:new Date().toISOString(),createdBy:me.uid});newRepOpen=false;toast('已建立報告')}catch(e){toast('建立失敗：'+errMsg(e))}};
  $('repNewOk').onclick=create;$('repNewName').onkeydown=e=>{if(e.key==='Enter')create()};
  V.querySelectorAll('.rep').forEach(b=>b.onclick=()=>{openReport=b.dataset.r;renderReports();window.scrollTo(0,0)});
}

// ---------- form ----------
$('fCat').innerHTML=CATS.map(c=>`<option value="${c.id}">${c.zh}</option>`).join('');
$('fCur').innerHTML=CURS.map(c=>`<option value="${c[0]}">${c[0]}</option>`).join('');
function updHkd(){const a=parseFloat($('fAmt').value)||0,rt=parseFloat($('fRate').value)||0;$('fHkd').textContent='≈ '+fmtHKD(r2(a*rt))}
$('fCur').onchange=()=>{$('fRate').value=rateOf($('fCur').value);updHkd()};
$('fAmt').oninput=updHkd;$('fRate').oninput=updHkd;
const allTags=()=>[...new Set(rows.flatMap(r=>r.tags||[]).concat(formTags))].sort();
function renderTagPick(){
  $('fTags').innerHTML=allTags().map(t=>`<button type="button" data-t="${esc(t)}" aria-pressed="${formTags.includes(t)}">${esc(t)}</button>`).join('')+`<input id="tagIn" placeholder="＋ 新標籤" aria-label="新增標籤">`;
  $('tagIn').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const v=e.target.value.trim().slice(0,20);if(v&&!formTags.includes(v))formTags.push(v);renderTagPick();$('tagIn').focus()}};
  $('tagIn').onblur=e=>{const v=e.target.value.trim().slice(0,20);if(v&&!formTags.includes(v)){formTags.push(v);renderTagPick()}};
}
$('fTags').onclick=e=>{const b=e.target.closest('button');if(!b)return;const t=b.dataset.t;formTags=formTags.includes(t)?formTags.filter(x=>x!==t):[...formTags,t];renderTagPick()};
function repOptions(sel){$('fRep').innerHTML='<option value="">（未歸入報告）</option>'+reports.slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).map(r=>`<option value="${esc(r.id)}" ${r.id===sel?'selected':''}>${esc(r.name)}</option>`).join('')}

function openForm(r){
  editing=r||null;pending=null;$('file').value='';$('origBtn').hidden=true;$('photoInfo').textContent='';
  $('formTitle').textContent=r?'編輯收據':'新增收據';
  $('fItems').hidden=true;$('fStatusWrap').hidden=!r;
  if(r){
    const u=imgUrl(r);
    if(u){$('prevImg').src=u;$('preview').hidden=false;$('drop').hidden=true;$('aiBox').className='ai';$('aiBox').innerHTML='<strong>已儲存的相片</strong><span>更換相片會重新讀取及翻譯。</span>'}
    else{$('preview').hidden=true;$('drop').hidden=false}
    $('fDate').value=r.date||today();$('fCat').value=cat(r.category).id;$('fMerchZh').value=r.merchantZh;$('fMerchOrig').value=r.merchantOrig;
    $('fCur').value=r.currency;$('fAmt').value=r.amount;$('fRate').value=r.rate||rateOf(r.currency);$('fPay').value=r.payMethod||'信用卡';
    $('fNote').value=r.note;$('fStatus').value=r.status==='done'?'done':'pending';formTags=[...r.tags];repOptions(r.reportId);
    if(r.items?.length){$('fItems').innerHTML=itemsTable(r.items,r.currency);$('fItems').hidden=false}
  }else{
    $('preview').hidden=true;$('drop').hidden=false;
    $('fDate').value=today();$('fCat').value='food';['fMerchZh','fMerchOrig','fAmt','fNote'].forEach(i=>$(i).value='');
    const lc=lsGet('lastCur')||'KRW';$('fCur').value=lc;$('fRate').value=rateOf(lc);$('fPay').value='信用卡';
    formTags=[];
    const lr=lsGet('lastReport')||'';
    repOptions(openReport&&openReport!=='__none'?openReport:(reports.some(x=>x.id===lr)?lr:''));
  }
  updHkd();renderTagPick();
  $('saveBtn').disabled=false;$('saveBtn').textContent='儲存收據';
  $('formScrim').hidden=false;
}
function closeForm(){$('formScrim').hidden=true;if(pending?.url)URL.revokeObjectURL(pending.url);pending=null;editing=null}
$('addBtn').onclick=()=>openForm(null);$('formClose').onclick=closeForm;$('formCancel').onclick=closeForm;
$('formScrim').onclick=e=>{if(e.target===$('formScrim'))closeForm()};
$('rePhoto').onclick=()=>$('file').click();
$('origBtn').onclick=async()=>{
  if(!pending?.orig)return;
  const toScan=!pending.scanned,items=pending.items;
  try{const r=await makePhoto(pending.orig,toScan);await setPhoto(r.blob,pending.orig,r.scanned,r.cropped);if(items)pending.items=items}catch(e){toast('未能處理相片')}
};

const drop=$('drop');
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over')});
drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');const f=e.dataTransfer.files[0];if(f)handleFile(f)});
$('file').onchange=e=>{const f=e.target.files[0];if(f)handleFile(f)};

// 相片壓縮：完整相片（約 1400px，< 450KB，存入 Firestore）＋ 縮圖（160px，放在收據記錄內）
async function shrink(file,max=1400,maxBytes=450000){
  const bmp=await createImageBitmap(file);
  let s=Math.min(1,max/Math.max(bmp.width,bmp.height)),q=0.8,blob;
  for(let i=0;i<6;i++){
    const c=document.createElement('canvas');c.width=Math.round(bmp.width*s);c.height=Math.round(bmp.height*s);
    c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
    blob=await new Promise(r=>c.toBlob(r,'image/jpeg',q));
    if(blob.size<=maxBytes)break;
    if(q>0.55)q-=0.1;else s*=0.8;
  }
  return blob;
}
const toDataUrl=blob=>new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(String(fr.result));fr.onerror=rej;fr.readAsDataURL(blob)});
const toB64=async blob=>(await toDataUrl(blob)).split(',')[1];

const PROMPT=`You are reading a photo of a shop receipt for a Hong Kong company's expense log. Receipts are usually from South Korea, sometimes Japan, mainland China, Taiwan or Hong Kong.
Return ONLY a JSON object with exactly these keys:
{"date":"YYYY-MM-DD or empty string","merchant_orig":"store name exactly as printed","merchant_zh":"store name in Hong Kong Traditional Chinese (translate the meaning; keep well-known brand names such as GS25, CU, 7-Eleven, Olive Young, Daiso, Lawson as they are)","total":number (final amount actually paid, digits only),"currency":"KRW"|"JPY"|"CNY"|"TWD"|"HKD"|"USD"|"EUR","payment":"信用卡"|"現金"|"交通卡"|"其他","category":"food"|"stationery"|"transport"|"hotel"|"daily"|"shipping"|"other","items":[{"orig":"item as printed","zh":"Hong Kong Traditional Chinese translation","qty":number,"amount":number}],"summary_zh":"one short sentence in Hong Kong Traditional Chinese describing what was bought"}
Category guide: food = restaurants, cafes, bakeries, convenience-store food and drinks, snacks; stationery = pens, paper, notebooks, printing, office supplies (알파 문구, 모닝글로리); transport = taxi, train, KTX, subway, bus, car rental, parking, fuel, toll; hotel = hotels, guesthouses, accommodation; daily = cleaning, toiletries, household goods, Daiso general goods; shipping = post office (우체국, 郵便局), couriers (CJ대한통운, 택배, ヤマト); other = anything else.
Currency: Korean text or ₩/원 = KRW; Japanese or 円/¥ in Japan = JPY; simplified Chinese or 元 = CNY.
If mixed, choose the category with the largest amount. At most 20 item lines.`;

// 後備方法：直接用 Google AI Studio 的 Gemini key（config.js 的 GEMINI_API_KEY）
async function geminiDirect(m,b64){
  const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),25000);
  let r;
  try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,{method:'POST',
    headers:{'Content-Type':'application/json','x-goog-api-key':GEMINI_KEY},
    body:JSON.stringify({contents:[{parts:[{text:PROMPT},{inline_data:{mime_type:'image/jpeg',data:b64}}]}],generationConfig:{responseMimeType:'application/json',temperature:0.1}}),signal:ctl.signal});
  }catch(e){const err=new Error(e?.name==='AbortError'?'等候超過 25 秒（'+m+'）':String(e?.message||e));err.customErrorData={status:504};throw err}
  finally{clearTimeout(t)}
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(j?.error?.message||('HTTP '+r.status));e.customErrorData={status:r.status};e.code=j?.error?.status;throw e}
  return (j.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('');
}
// 相片處理：掃描效果（裁切＋去陰影＋灰階）或原相壓縮
async function makePhoto(file,useScan){
  const hd=settings.photoQuality==='hd';
  if(useScan){try{return {...await docScan(file,{maxSide:hd?2400:2000,maxBytes:hd?690000:450000}),scanned:true}}catch(e){console.warn('scan failed',e)}}
  return {blob:hd?await shrink(file,2000,690000):await shrink(file),cropped:false,scanned:false};
}
async function setPhoto(blob,orig,scanned,cropped){
  const thumb=await toDataUrl(await shrink(blob,160,30000));
  const url=URL.createObjectURL(blob);
  if(pending?.url)URL.revokeObjectURL(pending.url);
  pending={...(pending||{}),blob,url,thumb,orig,scanned};
  $('prevImg').src=url;
  $('origBtn').hidden=false;
  $('origBtn').textContent=scanned?'用原相片（唔要掃描效果）':'用掃描效果';
  $('photoInfo').textContent=(scanned?(cropped?'已自動裁切及加強':'已加強（未能自動裁切）'):'原相片')+' · '+Math.round(blob.size/1024)+' KB';
}
async function handleFile(file){
  if(!file.type.startsWith('image/')){toast('請選擇相片檔案');return}
  const useScan=settings.scan!==false;
  $('prevImg').removeAttribute('src');$('preview').hidden=false;$('drop').hidden=true;
  $('aiBox').className='ai';$('aiBox').innerHTML='<strong>處理相片中…</strong>';
  let r;
  try{r=await makePhoto(file,useScan)}catch(e){console.warn(e);toast('未能讀取這張相片，請試另一張');$('preview').hidden=true;$('drop').hidden=false;return}
  await setPhoto(r.blob,file,r.scanned,r.cropped);
  readAi(r.blob);
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// 繁忙（503/500/429）時：同一型號等一陣再試，再唔得就換下一個型號
// 用金鑰查詢 Google 現時提供的 Gemini 型號，優先用較新、穩定的 flash 型號
let discovered=null;
async function discoverModels(){
  if(!useKey())return MODELS;
  if(discovered&&discovered.key===GEMINI_KEY)return discovered.list;
  let list=[];
  try{
    const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',{headers:{'x-goog-api-key':GEMINI_KEY}});
    const j=await r.json();
    const ver=n=>parseFloat((/gemini-(\d+(?:\.\d+)?)/.exec(n)||[])[1]||0);
    list=(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent'))
      .map(m=>String(m.name||'').replace(/^models\//,''))
      .filter(n=>/^gemini-[\d.]+-flash/.test(n)&&!/(image|tts|audio|live|embed|thinking|exp|robotics|computer)/i.test(n)&&!/-\d{3}$/.test(n))
      .sort((a,b)=>(/preview/.test(a)-/preview/.test(b))||(ver(b)-ver(a))||(/lite/.test(a)-/lite/.test(b)))
      .slice(0,4);
  }catch(e){console.warn('list models failed',e)}
  discovered={key:GEMINI_KEY,list:[...new Set([...list,...MODELS])].slice(0,5)};
  return discovered.list;
}
async function callAi(b64,onStatus){
  let lastErr;
  const models=await discoverModels();
  for(const m of models){
    onStatus?.('正在讀取及翻譯…（'+m+'）');
    for(let attempt=0;attempt<2;attempt++){
      try{return useKey()?await geminiDirect(m,b64):(await modelFor(m).generateContent([PROMPT,{inlineData:{data:b64,mimeType:'image/jpeg'}}])).response.text()}
      catch(err){
        lastErr=err;const st=aiStatus(err);
        if(st===404)break;                       // 型號不存在：直接試下一個
        if(![429,500,502,503,504].includes(st))throw err; // 其他錯誤（例如金鑰問題）：不用再試
        if(attempt===0&&st!==504){onStatus?.('AI 伺服器繁忙，自動重試中…（'+m+'）');await sleep(2500)}else break;
      }
    }
  }
  throw lastErr;
}
async function readAi(blob){
  const box=$('aiBox');box.className='ai';
  const setMsg=t=>{if(pending?.blob===blob)box.innerHTML='<strong>'+t+'</strong><span>大約需要幾秒至十幾秒</span>'};
  setMsg('正在讀取及翻譯…');
  try{
    let text=await callAi(await toB64(blob),setMsg);
    if(pending?.blob!==blob)return;
    text=text.replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim();
    applyAi(JSON.parse(text));
  }catch(e){
    if(pending?.blob!==blob)return;
    console.warn(e);
    const st=aiStatus(e),msg=String(e?.message||e||'');
    box.className='ai err';
    const title=/location is not supported/i.test(msg)?'Google 免費 Gemini API 不支援香港地區，請到設定把「AI 來源」改為 Firebase Vertex AI'
      :AI_SOURCE==='vertex'&&(/billing|blaze|pay-as-you-go|Vertex AI API|aiplatform|SERVICE_DISABLED|has not been used/i.test(msg)||st===403)?'Firebase Vertex AI 未啟用：需要升級 Blaze 方案並啟用 API'
      :st===504?'AI 回應太慢（Google 伺服器繁忙）'
      :[500,502,503].includes(st)||/high demand|overloaded|UNAVAILABLE/i.test(msg)?'AI 伺服器而家太繁忙'
      :st===429||/RESOURCE_EXHAUSTED/.test(msg)?'AI 暫時太多人用，或今日免費次數已用完'
      :st===400&&/API key|API_KEY/i.test(msg)?'AI 金鑰無效，請到設定重新貼上'
      :st===403||/PERMISSION_DENIED|API has not been used|disabled/i.test(msg)?'AI 服務未開通或仍在生效中（剛啟用需等幾分鐘）'
      :st===404?'AI 型號不可用'
      :e instanceof SyntaxError?'AI 回覆格式有誤，請再試一次'
      :'讀取失敗';
    box.innerHTML=`<strong>${title}</strong><span>可以按「重試」，或先手動填寫。</span><button type="button" class="primary" id="aiRetry" style="align-self:flex-start;padding:5px 14px;margin-top:4px">重試</button><details><summary style="cursor:pointer;font-size:12px">技術資料</summary><code style="font-size:11px;word-break:break-all">${esc((st?st+' · ':'')+(e?.code?e.code+' · ':'')+msg.slice(0,300))}</code></details>`;
    $('aiRetry').onclick=()=>readAi(blob);
  }
}
function applyAi(o){
  if(o.date&&/^\d{4}-\d{2}-\d{2}$/.test(o.date))$('fDate').value=o.date;
  if(o.merchant_zh)$('fMerchZh').value=o.merchant_zh;
  if(o.merchant_orig)$('fMerchOrig').value=o.merchant_orig;
  if(typeof o.total==='number')$('fAmt').value=o.total;
  if(CURS.some(c=>c[0]===o.currency)){$('fCur').value=o.currency;$('fRate').value=rateOf(o.currency)}
  if(CATS.some(c=>c.id===o.category))$('fCat').value=o.category;
  if(['信用卡','現金','交通卡','其他'].includes(o.payment))$('fPay').value=o.payment;
  if(o.summary_zh)$('fNote').value=o.summary_zh;
  updHkd();
  $('aiBox').innerHTML=`<strong>已讀取並翻譯</strong><span>自動分類：${cat(o.category).zh}。請核對金額、貨幣及日期後儲存。</span>`;
  const items=Array.isArray(o.items)?o.items.slice(0,20):[];
  pending.items=items.map(i=>({orig:String(i.orig||''),zh:String(i.zh||''),qty:Number(i.qty)||1,amount:Number(i.amount)||0}));
  $('fItems').innerHTML=pending.items.length?itemsTable(pending.items,$('fCur').value):'';
  $('fItems').hidden=!pending.items.length;
}
function itemsTable(items,cur){
  return `<table><thead><tr><th>項目（翻譯）</th><th class="r">數量</th><th class="r">金額</th></tr></thead><tbody>${
    items.map(i=>`<tr><td>${esc(i.zh)}<span class="o ko">${esc(i.orig)}</span></td><td class="r num">${i.qty}</td><td class="r num">${fmtCur(i.amount,cur)}</td></tr>`).join('')}</tbody></table>`;
}

$('saveBtn').onclick=async()=>{
  const amount=parseFloat($('fAmt').value),rate=parseFloat($('fRate').value);
  if(!(amount>0)){toast('請填寫金額');$('fAmt').focus();return}
  if(!(rate>0)){toast('請填寫匯率');$('fRate').focus();return}
  if(!$('fDate').value){toast('請填寫日期');return}
  const t=$('tagIn')?.value.trim();if(t&&!formTags.includes(t))formTags.push(t.slice(0,20));
  const btn=$('saveBtn');btn.disabled=true;btn.textContent='儲存中…';
  try{
    const cur=$('fCur').value;
    const data={date:$('fDate').value,merchantZh:$('fMerchZh').value.trim(),merchantOrig:$('fMerchOrig').value.trim(),
      amount,currency:cur,rate,hkd:r2(amount*rate),category:$('fCat').value,payMethod:$('fPay').value,
      reportId:$('fRep').value,tags:formTags.slice(0,10),note:$('fNote').value.trim()};
    if(pending?.items)data.items=pending.items;
    const ref=editing?doc(db,'expenses',editing.id):doc(collection(db,'expenses'));
    if(pending?.blob){
      await setDoc(doc(db,'photos',ref.id),{data:await toDataUrl(pending.blob),by:me.uid,at:new Date().toISOString()});
      data.thumb=pending.thumb;data.hasPhoto=true;data.photoBytes=Math.ceil(pending.blob.size*4/3)+30;
    }
    if(editing){data.status=$('fStatus').value;await updateDoc(ref,data)}
    else await setDoc(ref,{items:[],thumb:'',hasPhoto:false,...data,status:'pending',createdBy:me.uid,createdByEmail:me.email||'',createdAt:new Date().toISOString()});
    lsSet('lastCur',cur);lsSet('lastReport',data.reportId);
    closeForm();$('detScrim').hidden=true;toast('已儲存');
  }catch(e){
    console.error(e);btn.disabled=false;btn.textContent='儲存收據';
    toast('儲存失敗：'+errMsg(e));
  }
};

// ---------- detail ----------
function openDetail(id){
  const r=rows.find(x=>x.id===id);if(!r)return;
  const c=cat(r.category);const u=imgUrl(r);
  $('detTitle').textContent=r.merchantZh||r.merchantOrig||'收據';
  $('detBody').innerHTML=`
    ${r.hasPhoto?`<img class="detailimg" id="dImg" src="${esc(u)}" alt="收據相片">`:''}
    <dl class="kv">
      <dt>日期</dt><dd class="num">${esc(r.date)}</dd>
      <dt>商戶</dt><dd>${esc(r.merchantZh)} ${r.merchantOrig?`<span class="ko" style="color:var(--muted)">${esc(r.merchantOrig)}</span>`:''}</dd>
      <dt>金額</dt><dd class="num"><b>${fmtHKD(hkdOf(r))}</b>${r.currency!=='HKD'?` <span style="color:var(--muted)">${fmtCur(r.amount,r.currency)} × ${r.rate||rateOf(r.currency)}</span>`:''}</dd>
      <dt>會計科目</dt><dd>${esc(c.code)} ${esc(c.acct)}</dd>
      ${r.tags?.length?`<dt>標籤</dt><dd class="tags">${r.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</dd>`:''}
      <dt>報告</dt><dd>${esc(repName(r.reportId)||'未歸入報告')}</dd>
      <dt>付款</dt><dd>${esc(r.payMethod)}</dd>
      ${r.note?`<dt>備註</dt><dd>${esc(r.note)}</dd>`:''}
      ${r.createdByEmail?`<dt>提交者</dt><dd>${esc(r.createdByEmail)}</dd>`:''}
      <dt>狀態</dt><dd><span class="pill ${r.status==='done'?'done':'pending'}">${r.status==='done'?'已報銷':'待報銷'}</span></dd>
    </dl>
    ${r.items?.length?`<div class="items">${itemsTable(r.items,r.currency)}</div>`:''}
    <div class="actions" id="detActs">
      <button class="danger" id="dDel">刪除</button><span class="spacer"></span>
      <button id="dEdit">編輯</button>
      <button class="primary" id="dToggle">${r.status==='done'?'改回待報銷':'標記已報銷'}</button>
    </div>`;
  $('detScrim').hidden=false;
  if(r.hasPhoto)getDoc(doc(db,'photos',id)).then(s=>{const d=s.exists()&&s.data()?.data;if(d&&$('dImg')){$('dImg').src=d;$('dImg').onclick=()=>{const w=window.open();if(w)w.document.write('<img src="'+d+'" style="max-width:100%">')}}}).catch(()=>{});
  $('dEdit').onclick=()=>{$('detScrim').hidden=true;openForm(r)};
  $('dToggle').onclick=async()=>{try{await updateDoc(doc(db,'expenses',id),{status:r.status==='done'?'pending':'done'});$('detScrim').hidden=true;toast('已更新')}catch(e){toast('更新失敗：'+errMsg(e))}};
  $('dDel').onclick=()=>{
    $('detActs').innerHTML='<div class="confirm">確定刪除這張收據？<button id="dNo">取消</button><button class="danger" id="dYes">確定刪除</button></div>';
    $('dNo').onclick=()=>openDetail(id);
    $('dYes').onclick=async()=>{try{await deleteDoc(doc(db,'expenses',id));if(r.hasPhoto)deleteDoc(doc(db,'photos',id)).catch(()=>{});$('detScrim').hidden=true;toast('已刪除')}catch(e){toast('刪除失敗：'+errMsg(e))}};
  };
}
$('detClose').onclick=()=>$('detScrim').hidden=true;
$('detScrim').onclick=e=>{if(e.target===$('detScrim'))$('detScrim').hidden=true};
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(!$('formScrim').hidden)closeForm();else if(!$('detScrim').hidden)$('detScrim').hidden=true;else if(!$('setScrim').hidden)$('setScrim').hidden=true});

// ---------- settings ----------
$('setBtn').onclick=()=>{
  $('pqScan').checked=settings.scan!==false;
  $('pqHd').checked=settings.photoQuality==='hd';$('pqStd').checked=!$('pqHd').checked;
  {const u=usageText();$('usageTxt').textContent=u.text;$('usageBar').style.width=Math.min(100,u.pct).toFixed(1)+'%';$('usageBar').style.background=u.pct>80?'var(--danger)':'var(--accent)';$('lastBk').textContent='上次在這部裝置匯出備份：'+(lsGet('lastBackup')||'未有紀錄')}
  $('rateList').innerHTML=CURS.filter(c=>c[0]!=='HKD').map(c=>`<label for="rt-${c[0]}" class="num">1 ${c[0]} =</label><input id="rt-${c[0]}" class="num" type="number" step="any" min="0" value="${rateOf(c[0])}">`).join('');
  $('acctList').innerHTML=CATS.map(c0=>{const c=cat(c0.id);return `<span><span class="dot" style="background:var(${CAT_COLOR[c.id]})"></span> ${c.zh}</span><input id="ac-${c.id}" class="num" value="${esc(c.code)}" aria-label="${c.zh} 科目編號"><input id="an-${c.id}" value="${esc(c.acct)}" aria-label="${c.zh} 科目名稱">`}).join('');
  $('meEmail').textContent='已登入：'+(me?.email||'');updAiKeyState();$('aiKeyIn').value='';$('newPw').value='';
  $('setScrim').hidden=false;
};
$('setClose').onclick=()=>$('setScrim').hidden=true;
$('setScrim').onclick=e=>{if(e.target===$('setScrim'))$('setScrim').hidden=true};
$('setSave').onclick=async()=>{
  const rates={HKD:1};CURS.forEach(c=>{if(c[0]==='HKD')return;const v=parseFloat($('rt-'+c[0]).value);rates[c[0]]=v>0?v:DEFAULT_RATES[c[0]]});
  const accounts={};CATS.forEach(c=>accounts[c.id]={code:$('ac-'+c.id).value.trim()||c.code,acct:$('an-'+c.id).value.trim()||c.acct});
  const photoQuality=$('pqHd').checked?'hd':'standard',scan=$('pqScan').checked;
  try{await setDoc(doc(db,'settings','main'),{rates,accounts,photoQuality,scan})}catch(e){toast('未能儲存設定：'+errMsg(e));return}
  settings={rates,accounts,photoQuality,scan};render();$('setScrim').hidden=true;toast('已儲存設定');
};
function updAiKeyState(){
  const el=$('aiKeyState');if(el)el.textContent=GEMINI_KEY?'AI Studio 金鑰：已設定（尾數 …'+GEMINI_KEY.slice(-4)+'）':'AI Studio 金鑰：未設定';
  if($('aiSrcVertex')){$('aiSrcVertex').checked=AI_SOURCE==='vertex';$('aiSrcKey').checked=AI_SOURCE==='key'}
}
async function saveAiSource(src){
  try{await setDoc(doc(db,'settings','ai'),{source:src,updatedBy:me.email||'',updatedAt:new Date().toISOString()},{merge:true});toast(src==='vertex'?'AI 來源：Firebase Vertex AI':'AI 來源：AI Studio 金鑰')}
  catch(e){toast('未能儲存：'+errMsg(e));updAiKeyState()}
}
$('aiSrcVertex').onchange=()=>saveAiSource('vertex');
$('aiSrcKey').onchange=()=>saveAiSource('key');
$('aiKeyBtn').onclick=async()=>{
  const k=$('aiKeyIn').value.trim();
  if(k&&(k.length<20||/\s/.test(k))){toast('金鑰好似唔完整，請重新複製整條 key');return}
  try{await setDoc(doc(db,'settings','ai'),{geminiKey:k,updatedBy:me.email||'',updatedAt:new Date().toISOString()},{merge:true});$('aiKeyIn').value='';toast(k?'已儲存 AI 金鑰':'已清除 AI 金鑰')}
  catch(e){toast('未能儲存：'+errMsg(e))}
};
$('pwBtn').onclick=async()=>{const pw=$('newPw').value;if(pw.length<8){toast('密碼最少 8 個字');return}try{await updatePassword(auth.currentUser,pw);$('newPw').value='';toast('已更改密碼')}catch(e){toast(e?.code==='auth/requires-recent-login'?'為安全起見，請先登出再登入，然後再改密碼':'更改失敗：'+(e?.message||''))}};
$('logoutBtn').onclick=async()=>{await signOut(auth);$('setScrim').hidden=true};

// ---------- export ----------
const safeName=t=>String(t||'').replace(/[\\/:*?"<>|\s]+/g,'_').replace(/_+/g,'_').slice(0,60);
function buildExport(list,period){
  list=list.slice().sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.createdAt||'').localeCompare(b.createdAt||''));
  const seq={},vouchers=[];
  const head=['憑單編號','日期','科目編號','會計科目','摘要','商戶（中文）','商戶（原文）','原幣','原幣金額','匯率（1 原幣 = HKD）','港幣金額 (HKD)','付款方式','標籤','報告','收據相片','報銷狀態','提交者','明細項目'];
  const detail=list.map(r=>{const c=cat(r.category);const d=(r.date||'').replace(/-/g,'').slice(2);seq[d]=(seq[d]||0)+1;const v='EXP-'+d+'-'+pad(seq[d]);vouchers.push({v,r});
    const photoName=r.hasPhoto?'相片/'+v+'_'+safeName(r.merchantZh||r.merchantOrig||'收據')+'.jpg':'無';
    return [v,r.date,c.code,c.acct,r.note||((r.merchantZh||r.merchantOrig||'')+' '+c.zh),r.merchantZh,r.merchantOrig,
    r.currency,r.amount,r.rate||rateOf(r.currency),hkdOf(r),r.payMethod,(r.tags||[]).join('、'),repName(r.reportId),
    photoName,r.status==='done'?'已報銷':'待報銷',r.createdByEmail,(r.items||[]).map(it=>it.zh+(it.orig?'（'+it.orig+'）':'')+' ×'+it.qty+' '+it.amount).join('；')]});
  const tHkd=r2(list.reduce((s,r)=>s+hkdOf(r),0));
  detail.push(['合計','','','','','','','','','',tHkd,'','','','','','','']);
  const pend=l=>r2(l.filter(r=>r.status!=='done').reduce((s,r)=>s+hkdOf(r),0));
  const sum=[['公司雜費 — 科目匯總'],['報告／期間',period],['匯出日期',today()],[],['科目編號','會計科目','單據數目','港幣金額 (HKD)','待報銷 (HKD)']];
  CATS.forEach(c0=>{const c=cat(c0.id);const l=list.filter(r=>cat(r.category).id===c.id);if(l.length)sum.push([c.code,c.acct,l.length,r2(l.reduce((s,r)=>s+hkdOf(r),0)),pend(l)])});
  sum.push(['','合計',list.length,tHkd,pend(list)]);
  sum.push([],['貨幣','單據數目','原幣金額','港幣金額 (HKD)']);
  [...new Set(list.map(r=>r.currency))].forEach(cu=>{const l=list.filter(r=>r.currency===cu);sum.push([cu,l.length,l.reduce((s,r)=>s+r.amount,0),r2(l.reduce((s,r)=>s+hkdOf(r),0))])});
  const wb=XLSX.utils.book_new();
  const ws1=XLSX.utils.aoa_to_sheet([head,...detail]);ws1['!cols']=[15,11,9,14,30,20,20,6,12,12,14,10,14,16,30,9,22,50].map(w=>({wch:w}));
  const ws2=XLSX.utils.aoa_to_sheet(sum);ws2['!cols']=[12,18,12,16,14].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws1,'雜費明細');XLSX.utils.book_append_sheet(wb,ws2,'科目匯總');
  return {wb,vouchers};
}
function exportXlsx(list,name,period){
  if(!list.length){toast('沒有收據可以匯出');return}
  if(!window.XLSX){toast('匯出元件未載入，請檢查網絡');return}
  XLSX.writeFile(buildExport(list,period).wb,safeName(name)+'.xlsx');
  toast('已匯出 Excel');
}
// 備份：Excel ＋ 全部收據相片（檔名對應憑單編號），打包成 ZIP
let zipping=false;
async function exportZip(list,name,period,btn){
  if(!list.length){toast('沒有收據可以匯出');return}
  if(!window.XLSX||!window.JSZip){toast('匯出元件未載入，請檢查網絡');return}
  if(zipping)return;zipping=true;
  const label=btn?.textContent;
  try{
    const {wb,vouchers}=buildExport(list,period);
    const zip=new JSZip();
    zip.file(safeName(name)+'.xlsx',XLSX.write(wb,{bookType:'xlsx',type:'array'}));
    const withPhoto=vouchers.filter(x=>x.r.hasPhoto);let done=0,missing=[];
    for(let i=0;i<withPhoto.length;i+=6){
      await Promise.all(withPhoto.slice(i,i+6).map(async({v,r})=>{
        try{const snap=await getDoc(doc(db,'photos',r.id));const d=snap.exists()&&snap.data()?.data;
          if(d){zip.file('相片/'+v+'_'+safeName(r.merchantZh||r.merchantOrig||'收據')+'.jpg',d.split(',')[1],{base64:true})}else missing.push(v)}
        catch(e){missing.push(v)}
        done++;if(btn)btn.textContent='下載相片中… '+done+'/'+withPhoto.length;
      }));
    }
    zip.file('說明.txt','公司雜費備份\r\n報告／期間：'+period+'\r\n匯出日期：'+today()+'\r\n收據數目：'+list.length+'，相片：'+(withPhoto.length-missing.length)+'\r\n相片檔名開頭的編號＝Excel「憑單編號」。\r\n按香港《稅務條例》第 51C 條，業務紀錄須保存最少 7 年。\r\n'+(missing.length?'\r\n以下憑單的相片未能下載：'+missing.join('、')+'\r\n':''));
    if(btn)btn.textContent='打包中…';
    const blob=await zip.generateAsync({type:'blob'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=safeName(name)+'_備份.zip';document.body.appendChild(a);a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},4000);
    lsSet('lastBackup',today());
    toast(missing.length?'已匯出，但有 '+missing.length+' 張相片未能下載':'已匯出備份 ZIP');
  }catch(e){console.error(e);toast('匯出失敗：'+errMsg(e))}
  finally{zipping=false;if(btn)btn.textContent=label}
}

// ---------- 容量 ----------
const FREE_BYTES=1024*1024*1024;
const PHOTO_EST={standard:600000,hd:930000};
function usageBytes(){return rows.reduce((s,r)=>s+(r.hasPhoto?(r.photoBytes||PHOTO_EST.standard):0)+(r.thumb||'').length+1500,0)}
function usageText(){const u=usageBytes(),pct=u/FREE_BYTES*100;return {pct,text:'已用約 '+(u/1048576).toFixed(1)+' MB／1024 MB（'+pct.toFixed(1)+'%）· '+rows.filter(r=>r.hasPhoto).length+' 張相片'}}

// ---------- auth + boot ----------
function showView(v){['setupView','loginView','appView'].forEach(x=>$(x).hidden=x!==v)}
let started=false;
function startApp(user){
  me=user;showView('appView');
  if(!started){started=true;const h=location.hash.slice(1);if(['receipts','stats','reports'].includes(h))tab=h}
  setTab(tab);subscribe();
}
$('loginForm').onsubmit=async e=>{
  e.preventDefault();$('loginErr').hidden=true;$('loginBtn').disabled=true;
  try{await signInWithEmailAndPassword(auth,$('loginEmail').value.trim(),$('loginPw').value)}
  catch(err){$('loginErr').textContent=/invalid|wrong-password|user-not-found/.test(err?.code||'')?'電郵或密碼不正確':err?.code==='auth/too-many-requests'?'嘗試次數太多，請稍後再試':'登入失敗：'+(err?.code||err?.message);$('loginErr').hidden=false}
  finally{$('loginBtn').disabled=false}
};
{
  const cfg=window.APP_CONFIG||{};
  if(!cfg.firebase?.apiKey||/YOUR_/.test(cfg.firebase.apiKey)){showView('setupView')}
  else{
    const app=initializeApp(cfg.firebase);
    auth=getAuth(app);
    try{db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})})}catch(e){db=initializeFirestore(app,{})}
    fbApp=app;
    CFG_KEY=GEMINI_KEY=(cfg.GEMINI_API_KEY||'').trim();
    MODELS=[...new Set([cfg.GEMINI_MODEL||'gemini-2.5-flash','gemini-2.5-flash-lite','gemini-flash-latest'])];
    onAuthStateChanged(auth,u=>{if(u)startApp(u);else{me=null;unsubs.forEach(f=>f());unsubs=[];rows=[];loaded=false;showView('loginView')}});
  }
  if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
}
