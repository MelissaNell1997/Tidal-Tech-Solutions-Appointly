/* ═══════════════════════════════════════════════════════════════
   Java.js — Tidal Tech Solutions · Appointly
   Screens, booking flow and admin views. Data calls live in supabase.js
   ═══════════════════════════════════════════════════════════════ */

/* ════ SETTINGS — edit these to change the portal ════ */
const BUSINESS = {
  name     : 'Tidal Tech Solutions',
  phone    : '+27 81 518 9577',
  whatsapp : '27815189577',
  location : 'Durban, KwaZulu-Natal, South Africa',
  meetingMinutes : 30,
  bookAheadDays  : 90,
};

// Who clients can book with. Keep the ids the same once bookings exist.
const DOCTORS = [
  { id:1, name:'Development Team', spec:'Technical consultation', color:'#ffc233' },
  { id:2, name:'Sales',            spec:'Product demo',           color:'#8af59a' },
  { id:3, name:'Support',          spec:'Technical support',      color:'#22d3ee' },
  { id:4, name:'Sonja Nell',       spec:'Marketing',              color:'#ff8a1f' },
  { id:5, name:'Melissa Nell',     spec:'Sales & development',    color:'#ff5a3c' },
];

const SLOTS = ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','13:00','13:30','14:00','14:30','15:00','15:30'];

// South African public holidays (closed). Add next year's dates when known.
const HOLIDAYS = [
  '2026-01-01','2026-04-03','2026-04-06','2026-04-27','2026-05-01','2026-06-16','2026-08-10','2026-09-24','2026-12-16','2026-12-25',
  '2027-01-01','2027-03-22','2027-03-26','2027-03-29','2027-04-27','2027-06-16','2027-08-09','2027-09-24','2027-12-16','2027-12-27',
];

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

/* ════ STATE ════ */
let S = {
  user:null, userType:'client', profile:null,
  profiles:[], appointments:[], taken:[],
  selDepartment:null, selDate:null, selSlot:null,
  calY:new Date().getFullYear(), calM:new Date().getMonth(),
  apptFilter:'upcoming', bookRange:'upcoming',
  rescheduleId:null, rschSlot:null,
  adminScheduleDoc:DOCTORS[0].id,
};

/* ════ SMALL HELPERS ════ */
function esc(v){
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function dateStr(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function todayStr(){ return dateStr(new Date()); }
function parseDate(ds){ const [y,m,d]=String(ds).slice(0,10).split('-').map(Number); return new Date(y,m-1,d); }
function fmtDate(ds){ const d=parseDate(ds); return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
function fmtShort(ds){ const d=parseDate(ds); return `${WEEKDAYS[d.getDay()].slice(0,3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0,3)}`; }
function addDays(ds,n){ const d=parseDate(ds); d.setDate(d.getDate()+n); return dateStr(d); }
function maxBookDate(){ return addDays(todayStr(), BUSINESS.bookAheadDays); }
function isClosedDay(ds){ const d=parseDate(ds).getDay(); return d===0 || d===6 || HOLIDAYS.includes(ds); }
function slotMinutes(t){ const [h,m]=t.split(':').map(Number); return h*60+m; }
function nowMinutes(){ const n=new Date(); return n.getHours()*60+n.getMinutes(); }
function isSlotPast(ds,slot){
  const t=todayStr();
  if (ds < t) return true;
  if (ds > t) return false;
  return slotMinutes(slot) <= nowMinutes() + 15;   // need at least 15 min notice
}
function deptById(id){ return DOCTORS.find(d => d.id === Number(id)) || { id, name:'Team', spec:'', color:'#888' }; }
function initials(name){ return String(name||'?').trim().split(/\s+/).map(p=>p[0]).slice(0,2).join('').toUpperCase() || '?'; }
function normPhone(p){
  let d=String(p||'').replace(/\D/g,'');
  if (d.startsWith('0')) d='27'+d.slice(1);
  return d;
}
function validPhone(p){ const d=normPhone(p); return d.length>=11 && d.length<=13; }
function validEmail(e){ return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e||'').trim()); }
function waLink(phone,text){ return `https://wa.me/${normPhone(phone)}?text=${encodeURIComponent(text)}`; }
function isUpcoming(a){ return a.status!=='cancelled' && !isSlotPastStrict(a.date,a.slot); }
function isSlotPastStrict(ds,slot){ const t=todayStr(); if(ds<t) return true; if(ds>t) return false; return slotMinutes(slot)+BUSINESS.meetingMinutes <= nowMinutes(); }
function sortAsc(list){ return [...list].sort((a,b)=> a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot)); }
function store(k,v){ try{ v===undefined ? localStorage.getItem(k) : localStorage.setItem(k,v); }catch(e){} }
function recall(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }

/* ════ TOASTS, BUSY BUTTONS, LOADING ════ */
function toast(msg,type='info'){
  const t=document.createElement('div');
  t.className=`toast ${type}`;
  const icon = type==='success'?'✓':type==='error'?'✕':type==='warn'?'!':'i';
  t.innerHTML=`<span class="ti">${icon}</span><span>${esc(msg)}</span>`;
  const box=document.getElementById('toasts');
  box.appendChild(t);
  while (box.children.length>3) box.firstChild.remove();
  setTimeout(()=>t.remove(), type==='error'?7000:4500);
}
function busy(id,on){ const b=document.getElementById(id); if(!b) return; b.classList.toggle('busy',!!on); b.disabled=!!on; }
function loading(on,msg){
  const o=document.getElementById('loading-overlay');
  if (msg) o.querySelector('.loading-msg').textContent=msg;
  o.classList.toggle('open',!!on);
}
function friendlyError(err){
  const m=String((err && (err.message||err.error_description)) || err || '');
  if (/invalid login credentials/i.test(m)) return 'That email and password don\'t match. Try again or reset your password.';
  if (/email not confirmed/i.test(m)) return 'Please confirm your email first. Check your inbox (and spam) for our link.';
  if (/already registered|already been registered/i.test(m)) return 'This email already has an account. Sign in instead.';
  if (/password should be at least/i.test(m)) return 'Your password needs at least 8 characters.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Please wait a minute and try again.';
  if (/failed to fetch|network/i.test(m)) return 'No connection. Check your internet and try again.';
  return m || 'Something went wrong. Please try again.';
}

/* ════ PWA INSTALL ════ */
let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstallPrompt=e; maybeShowPWA(); });
function maybeShowPWA(){
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const el=document.getElementById('pwa-banner');
  if (el) el.classList.toggle('hidden', !!standalone || recall('pwaDismissed')==='1');
}
function triggerPWAInstall(){
  if (deferredInstallPrompt){ deferredInstallPrompt.prompt(); deferredInstallPrompt.userChoice.finally(()=>{ deferredInstallPrompt=null; dismissPWA(); }); }
  else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) toast('On iPhone: tap the Share button, then "Add to Home Screen".','info');
  else toast('Open your browser menu and choose "Add to Home screen".','info');
}
function dismissPWA(){ store('pwaDismissed','1'); document.getElementById('pwa-banner').classList.add('hidden'); }

/* ════ SCREENS, MODALS, TABS ════ */
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+id).classList.add('active');
  window.scrollTo(0,0);
}
function openModal(id){
  const m=document.getElementById(id); m.classList.add('open');
  const f=m.querySelector('input:not([type=checkbox]):not([readonly]),select,textarea'); if (f && window.innerWidth>760) setTimeout(()=>f.focus(),50);
}
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key==='Escape') document.querySelectorAll('.modal-overlay.open').forEach(m=>{ if(m.id!=='new-pw-modal') m.classList.remove('open'); }); });
document.addEventListener('click', e => { if (e.target.classList && e.target.classList.contains('modal-overlay') && e.target.id!=='new-pw-modal' && e.target.id!=='success-modal') e.target.classList.remove('open'); });

function confirmDialog(title,text,yesLabel){
  return new Promise(resolve=>{
    document.getElementById('confirm-title').textContent=title;
    document.getElementById('confirm-text').textContent=text||'';
    const yes=document.getElementById('confirm-yes'), no=document.getElementById('confirm-no');
    yes.textContent=yesLabel||'Yes';
    const done=v=>{ closeModal('confirm-modal'); yes.onclick=no.onclick=null; resolve(v); };
    yes.onclick=()=>done(true); no.onclick=()=>done(false);
    openModal('confirm-modal');
  });
}

function showTab(id){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  const panel=document.getElementById('tab-'+id); if(!panel) return;
  panel.classList.add('active');
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active', b.dataset.tab===id));
  window.scrollTo({top:0,behavior:'smooth'});
  if (id==='dashboard') renderDashboard();
  if (id==='book'){ refreshTaken().then(()=>{ renderDepartments(); renderCalendar(); renderSlots(); }); renderDepartments(); renderCalendar(); renderSlots(); }
  if (id==='my-appts') renderMyAppointments();
  if (id==='profile') prefillClientForms();
  if (id==='admin-home') renderAdminHome();
  if (id==='admin-schedule'){ if(!document.getElementById('adm-date-picker').value) setAdminDateToday(); else renderAdminScheduleForDate(); }
  if (id==='admin-bookings') renderAdminBookings();
  if (id==='admin-clients') renderAdminClients();
}

/* ════ AUTH SCREEN ════ */
function openAuth(tab){ switchAuthTab(tab); showScreen('auth'); }
function switchAuthTab(t){
  const login=t==='login';
  document.getElementById('atab-login').classList.toggle('active',login);
  document.getElementById('atab-reg').classList.toggle('active',!login);
  document.getElementById('auth-login-form').classList.toggle('hidden',!login);
  document.getElementById('auth-reg-form').classList.toggle('hidden',login);
  document.getElementById('auth-title').textContent = login ? 'Welcome back' : 'Create your account';
  document.getElementById('auth-sub').textContent   = login ? 'Sign in to book or manage your meetings.' : 'It takes 30 seconds. Then pick a time.';
}
function togglePw(id,btn){
  const el=document.getElementById(id); const show=el.type==='password';
  el.type=show?'text':'password'; btn.textContent=show?'Hide':'Show';
}
function doForgotPassword(){
  document.getElementById('forgot-pw-form').classList.remove('hidden');
  document.getElementById('forgot-pw-sent').classList.add('hidden');
  document.getElementById('forgot-pw-email').value=document.getElementById('li-email').value||'';
  openModal('forgot-pw-modal');
}

/* ════ ENTER THE APP ════ */
function enterClientApp(){
  S.userType='client';
  document.getElementById('client-nav').classList.remove('hidden');
  document.getElementById('admin-nav').classList.add('hidden');
  document.getElementById('bottom-nav-client').classList.remove('hidden');
  document.getElementById('bottom-nav-admin').classList.add('hidden');
  document.getElementById('role-pill').classList.add('hidden');
  setAvatar();
  prefillClientForms();
  showScreen('app');
  maybeShowPWA();
  showTab('dashboard');
}
function enterAdminApp(){
  S.userType='admin';
  document.getElementById('client-nav').classList.add('hidden');
  document.getElementById('admin-nav').classList.remove('hidden');
  document.getElementById('bottom-nav-client').classList.add('hidden');
  document.getElementById('bottom-nav-admin').classList.remove('hidden');
  document.getElementById('role-pill').classList.remove('hidden');
  setAvatar();
  showScreen('app');
  showTab('admin-home');
}
function setAvatar(){
  const el=document.getElementById('top-avatar');
  const url=S.profile && S.profile.avatar_url;
  el.innerHTML = url ? `<img src="${esc(url)}" alt=""/>` : esc(initials(S.user && S.user.name));
  el.onclick = () => S.userType==='client' ? showTab('profile') : null;
}

/* ════ CLIENT: HOME ════ */
function myAppointments(){ return S.appointments.filter(a => S.userType==='admin' || a.email===S.user.email || (S.user.id && a.user_id===S.user.id)); }

function renderDashboard(){
  if (!S.user || S.userType!=='client') return;
  document.getElementById('dash-name').textContent = (S.user.name||'there').split(' ')[0];
  const upcoming = sortAsc(myAppointments().filter(isUpcoming));
  const next = upcoming[0];
  const nextBox=document.getElementById('next-appt');
  if (next){
    const d=deptById(next.departmentId);
    nextBox.innerHTML = `<div class="next-card">
      <div><div class="lbl">Your next meeting</div>
      <div class="when">${esc(fmtDate(next.date))} at ${esc(next.slot)}</div>
      <div class="meta">With ${esc(d.name)} · ${esc(next.reason||d.spec)}</div></div>
      <div class="acts">
        <a class="btn btn-line btn-sm" href="${esc(buildGoogleCalendarUrl(next))}" target="_blank" rel="noopener">Add to calendar</a>
        <button class="btn btn-line btn-sm" onclick="openRescheduleCancel('${esc(next.id)}')">Move</button>
      </div></div>`;
  } else nextBox.innerHTML='';
  const list=document.getElementById('dash-appt-list');
  const rest=upcoming.slice(1,4);
  if (!upcoming.length) list.innerHTML = emptyState('📅','No upcoming meetings yet.','Book a meeting',"showTab('book')");
  else if (!rest.length) list.innerHTML = `<p class="hint">Nothing else booked. <button class="link-btn" style="display:inline;margin:0" onclick="showTab('book')">Book another →</button></p>`;
  else list.innerHTML = rest.map(a=>apptCardHTML(a,true)).join('');
}
function emptyState(icon,text,btnLabel,action){
  return `<div class="empty-state"><div class="esi">${icon}</div><p>${esc(text)}</p>${btnLabel?`<button class="btn btn-sun btn-sm" style="margin-top:12px" onclick="${action}">${esc(btnLabel)}</button>`:''}</div>`;
}

/* ════ CLIENT: BOOKING FLOW ════ */
function takenFor(deptId,ds,excludeId){
  if (S.userType==='admin') return S.appointments.filter(a=>a.departmentId===deptId && a.date===ds && a.status!=='cancelled' && String(a.id)!==String(excludeId)).map(a=>a.slot);
  const mine = S.appointments.find(a=>String(a.id)===String(excludeId));
  return S.taken.filter(t=>Number(t.department_id)===deptId && String(t.date).slice(0,10)===ds)
    .map(t=>t.slot)
    .filter(s => !(mine && mine.departmentId===deptId && mine.date===ds && mine.slot===s));
}
function freeSlots(deptId,ds,excludeId){
  if (isClosedDay(ds)) return [];
  const taken=takenFor(deptId,ds,excludeId);
  return SLOTS.filter(s=>!taken.includes(s) && !isSlotPast(ds,s));
}

function renderDepartments(){
  const t=todayStr();
  document.getElementById('doc-list').innerHTML = DOCTORS.map(d=>{
    const sel=S.selDepartment && S.selDepartment.id===d.id;
    return `<button type="button" class="doc-card ${sel?'selected':''}" onclick="selectDepartment(${d.id})" aria-pressed="${sel}">
      <span class="doc-avatar" style="background:${d.color}">${esc(initials(d.name))}</span>
      <span class="doc-info"><h4>${esc(d.name)}</h4><p>${esc(d.spec)}</p></span>
      <span class="tick">✓</span></button>`;
  }).join('');
}
function selectDepartment(id){
  S.selDepartment=deptById(id);
  if (S.selSlot && S.selDate && takenFor(id,S.selDate).includes(S.selSlot)) S.selSlot=null;
  renderDepartments(); renderCalendar(); renderSlots();
  if (window.innerWidth<=900) document.getElementById('card-step2').scrollIntoView({behavior:'smooth',block:'start'});
}

function renderCalendar(){
  const t=todayStr(), max=maxBookDate();
  document.getElementById('cal-label').textContent=MONTHS[S.calM]+' '+S.calY;
  const now=new Date();
  document.getElementById('cal-prev').disabled = (S.calY<now.getFullYear()) || (S.calY===now.getFullYear() && S.calM<=now.getMonth());
  const first=new Date(S.calY,S.calM,1).getDay();
  const total=new Date(S.calY,S.calM+1,0).getDate();
  let html=DAYS.map(d=>`<div class="cal-dn">${d}</div>`).join('');
  for (let i=0;i<first;i++) html+='<div class="cal-d empty"></div>';
  for (let d=1; d<=total; d++){
    const ds=dateStr(new Date(S.calY,S.calM,d));
    const closed = ds<t || ds>max || isClosedDay(ds);
    const full = !closed && S.selDepartment && freeSlots(S.selDepartment.id,ds).length===0;
    const cls = ['cal-d', closed?'dim':'', full?'full':'', ds===t?'today':'', ds===S.selDate?'sel':''].join(' ');
    const label = closed ? 'closed' : full ? 'fully booked' : 'available';
    html += closed || full
      ? `<div class="${cls}" aria-label="${d} ${label}">${d}</div>`
      : `<button type="button" class="${cls}" onclick="selectDate('${ds}')" aria-label="${fmtDate(ds)}">${d}</button>`;
  }
  document.getElementById('cal-grid').innerHTML=html;
}
function changeMonth(dir){
  S.calM+=dir;
  if (S.calM<0){S.calM=11;S.calY--;}
  if (S.calM>11){S.calM=0;S.calY++;}
  renderCalendar();
}
function selectDate(ds){
  S.selDate=ds; S.selSlot=null; renderCalendar(); renderSlots();
  if (window.innerWidth<=900) document.getElementById('card-step3').scrollIntoView({behavior:'smooth',block:'start'});
}

function slotButtonsHTML(deptId,ds,selected,onclickFn,excludeId){
  const taken=takenFor(deptId,ds,excludeId);
  let html='', lastGroup='';
  SLOTS.forEach(t=>{
    const group = slotMinutes(t)<720 ? 'Morning' : 'Afternoon';
    if (group!==lastGroup){ html+=`<div class="slot-group">${group}</div>`; lastGroup=group; }
    const isTaken=taken.includes(t), past=isSlotPast(ds,t);
    if (isTaken || past) html+=`<button type="button" class="slot-btn ${isTaken?'taken':'past-time'}" disabled>${t}<small>${isTaken?'Booked':'Passed'}</small></button>`;
    else html+=`<button type="button" class="slot-btn ${t===selected?'sel':'free'}" onclick="${onclickFn}('${t}')">${t}</button>`;
  });
  return html;
}
function renderSlots(){
  const hint=document.getElementById('slot-hint'), grid=document.getElementById('slots-grid');
  if (!S.selDepartment || !S.selDate){
    hint.textContent = !S.selDepartment ? 'Choose who you\'d like to meet first.' : 'Now choose a day.';
    grid.innerHTML=''; updateBookSummary(); return;
  }
  const free=freeSlots(S.selDepartment.id,S.selDate);
  hint.textContent = free.length ? `${fmtDate(S.selDate)} with ${S.selDepartment.name}` : `No times left on ${fmtDate(S.selDate)}. Please pick another day.`;
  grid.innerHTML = slotButtonsHTML(S.selDepartment.id,S.selDate,S.selSlot,'selectSlot');
  updateBookSummary();
}
function selectSlot(t){
  S.selSlot=t; renderSlots();
  if (window.innerWidth<=900) document.getElementById('card-step4').scrollIntoView({behavior:'smooth',block:'start'});
}
function updateBookSummary(){
  const el=document.getElementById('book-summary'), btn=document.getElementById('btn-book'), hint=document.getElementById('book-hint');
  const ready = S.selDepartment && S.selDate && S.selSlot;
  if (ready){
    el.classList.remove('empty');
    el.innerHTML=`<b>With</b> ${esc(S.selDepartment.name)}<br><b>Day</b> ${esc(fmtDate(S.selDate))}<br><b>Time</b> ${esc(S.selSlot)} (${BUSINESS.meetingMinutes} min)`;
  } else {
    el.classList.add('empty');
    el.textContent = S.selDepartment ? (S.selDate ? 'Now pick a time.' : 'Now choose a day.') : 'Your choices will show here.';
  }
  btn.disabled=!ready;
  hint.classList.toggle('hidden',!!ready);
  const steps=document.querySelectorAll('#stepper li');
  const done=[!!S.selDepartment,!!S.selDate,!!S.selSlot,false];
  const cur = !S.selDepartment?0:!S.selDate?1:!S.selSlot?2:3;
  steps.forEach((li,i)=>{ li.classList.toggle('done',done[i]); li.classList.toggle('on',i===cur); });
}
function resetBookingSelection(){ S.selSlot=null; S.selDate=null; document.getElementById('bk-reason').value=''; }

/* ════ CLIENT: MY BOOKINGS ════ */
function setApptFilter(f){
  S.apptFilter=f;
  document.querySelectorAll('#tab-my-appts [data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===f));
  renderMyAppointments();
}
function renderMyAppointments(){
  const list=document.getElementById('my-appt-list');
  const mine=myAppointments();
  let items;
  if (S.apptFilter==='upcoming') items=sortAsc(mine.filter(isUpcoming));
  else if (S.apptFilter==='past') items=sortAsc(mine.filter(a=>a.status!=='cancelled' && !isUpcoming(a))).reverse();
  else items=sortAsc(mine.filter(a=>a.status==='cancelled')).reverse();
  if (!items.length){
    list.innerHTML = S.apptFilter==='upcoming' ? emptyState('📅','You have no upcoming meetings.','Book a meeting',"showTab('book')") : emptyState('🗂️','Nothing here yet.');
    return;
  }
  list.innerHTML=items.map(a=>apptCardHTML(a,true)).join('');
}
function apptCardHTML(a,showActions){
  const d=parseDate(a.date), dept=deptById(a.departmentId);
  const cancelled=a.status==='cancelled', past=!cancelled && !isUpcoming(a);
  const chip = cancelled ? '<span class="chip chip-red">Cancelled</span>' : past ? '<span class="chip chip-grey">Done</span>' : '<span class="chip chip-green">Confirmed</span>';
  const acts = showActions && !cancelled && !past ? `
      <a class="btn btn-line btn-xs" href="${esc(buildGoogleCalendarUrl(a))}" target="_blank" rel="noopener">📅 Calendar</a>
      <button class="btn btn-line btn-xs" onclick="openRescheduleCancel('${esc(a.id)}')">Move</button>
      <button class="btn btn-line btn-xs" onclick="clientCancel('${esc(a.id)}')">Cancel</button>` : '';
  return `<div class="appt-card ${cancelled?'cancelled':past?'past':''}">
    <div class="appt-date-box"><div class="awk">${WEEKDAYS[d.getDay()].slice(0,3)}</div><div class="aday">${d.getDate()}</div><div class="amon">${MONTHS[d.getMonth()].slice(0,3)}</div></div>
    <div class="appt-info"><h4>${esc(a.slot)} · ${esc(dept.name)}</h4><p>${esc(a.reason||dept.spec)}</p></div>
    <div class="appt-acts">${chip}${acts}</div>
  </div>`;
}

/* ════ RESCHEDULE ════ */
function openRescheduleCancel(id){
  const a=S.appointments.find(x=>String(x.id)===String(id)); if(!a) return;
  S.rescheduleId=a.id; S.rschSlot=null;
  document.getElementById('rsch-current').innerHTML=`Currently: <b>${esc(fmtDate(a.date))} at ${esc(a.slot)}</b> with ${esc(deptById(a.departmentId).name)}.`;
  const el=document.getElementById('rsch-date');
  el.min=todayStr(); el.max=maxBookDate();
  el.value = isSlotPast(a.date,'15:30') ? nextOpenDay(todayStr()) : a.date;
  renderRescheduleSlots();
  openModal('reschedule-modal');
  refreshTaken().then(renderRescheduleSlots);
}
function nextOpenDay(ds){ let d=ds; for(let i=0;i<14;i++){ if(!isClosedDay(d) && !isSlotPast(d,'15:30')) return d; d=addDays(d,1);} return ds; }
function renderRescheduleSlots(){
  const a=S.appointments.find(x=>String(x.id)===String(S.rescheduleId)); if(!a) return;
  const ds=document.getElementById('rsch-date').value, box=document.getElementById('rsch-slots');
  document.getElementById('btn-rsch').disabled=true;
  if (!ds){ box.innerHTML='<p class="hint">Pick a day.</p>'; return; }
  if (isClosedDay(ds)){ box.innerHTML='<p class="hint" style="grid-column:1/-1">We\'re closed that day. Please choose a weekday.</p>'; S.rschSlot=null; return; }
  box.innerHTML=slotButtonsHTML(a.departmentId,ds,S.rschSlot,'pickRescheduleSlot',a.id);
  document.getElementById('btn-rsch').disabled=!S.rschSlot;
}
function pickRescheduleSlot(t){ S.rschSlot=t; renderRescheduleSlots(); }

/* ════ PROFILE ════ */
function prefillClientForms(){
  const u=S.user; if(!u) return;
  const parts=(u.name||'').split(' ');
  const set=(id,v)=>{ const el=document.getElementById(id); if(el && !el.matches(':focus')) el.value=v||''; };
  set('pf-first',parts[0]); set('pf-last',parts.slice(1).join(' '));
  set('pf-email',u.email); set('pf-phone',u.phone); set('pf-id',u.company);
  set('bk-name',u.name); set('bk-phone',u.phone); set('bk-id',u.company);
  document.getElementById('prof-name-disp').textContent=u.name||'';
  document.getElementById('prof-email-disp').textContent=u.email||'';
  const pic=document.getElementById('prof-pic-el');
  const url=S.profile && S.profile.avatar_url;
  pic.innerHTML = url ? `<img src="${esc(url)}" alt=""/>` : esc(initials(u.name));
}

/* ════ ADMIN: TODAY ════ */
function renderAdminHome(){
  const t=todayStr();
  document.getElementById('adm-today-label').textContent=fmtDate(t);
  const todays=S.appointments.filter(a=>a.date===t);
  const live=sortAsc(todays.filter(a=>a.status!=='cancelled'));
  document.getElementById('adm-stat-today').textContent=live.length;
  document.getElementById('adm-stat-all').textContent=S.appointments.filter(isUpcoming).length;
  document.getElementById('adm-stat-cancel').textContent=todays.filter(a=>a.status==='cancelled').length;
  document.getElementById('adm-stat-clients').textContent=allClients().length;

  const list=document.getElementById('adm-today-list');
  list.innerHTML = live.length ? live.map(a=>{
    const past=isSlotPastStrict(a.date,a.slot);
    return `<div class="today-row ${past?'past':''}">
      <div class="t">${esc(a.slot)}</div>
      <div class="who"><b>${esc(a.name)}</b><span>${esc(deptById(a.departmentId).name)}${a.company?' · '+esc(a.company):''}${a.reason?' · '+esc(a.reason):''}</span></div>
      ${rowActions(a,past)}
    </div>`;
  }).join('') : (isClosedDay(t) ? '<p class="hint">Closed today (weekend or public holiday).</p>' : '<p class="hint">No meetings booked today.</p>');

  // Show today's free slots, or the next working day once today is over.
  const dayOver = isClosedDay(t) || SLOTS.every(s=>isSlotPast(t,s));
  const ad = dayOver ? nextOpenDay(addDays(t,1)) : t;
  document.getElementById('avail-title').textContent = dayOver ? `Free slots · ${fmtDate(ad)}` : 'Free slots today';
  document.getElementById('avail-bar').innerHTML = DOCTORS.map(d=>{
    const taken=takenFor(d.id,ad);
    const free=freeSlots(d.id,ad);
    const pct=Math.round(taken.length/SLOTS.length*100);
    return `<div class="avail-card" onclick="S.adminScheduleDoc=${d.id};document.getElementById('adm-date-picker').value='${ad}';showTab('admin-schedule')">
      <h4>${esc(d.name)}</h4><p>${free.length} free · ${taken.length} booked</p>
      <div class="meter"><i style="width:${pct}%"></i></div>
      <div class="avail-mini-slots">${SLOTS.filter(s=>!isSlotPast(ad,s)).map(s=>`<span class="avail-slot ${taken.includes(s)?'taken':''}">${s}</span>`).join('')}</div>
    </div>`;
  }).join('');
}
function rowActions(a,past){
  const dept=deptById(a.departmentId);
  const msg=`Hi ${(a.name||'').split(' ')[0]}, this is ${BUSINESS.name}. Just confirming your meeting with ${dept.name} on ${fmtDate(a.date)} at ${a.slot}. Reply here if you need to change it. See you then!`;
  const wa = a.phone ? `<a class="btn btn-wa btn-xs" href="${esc(waLink(a.phone,msg))}" target="_blank" rel="noopener" title="Send a WhatsApp reminder">WhatsApp</a>` : '';
  const call = a.phone ? `<a class="btn btn-line btn-xs" href="tel:${esc(a.phone)}">Call</a>` : '';
  const cancel = a.status!=='cancelled' && !past ? `<button class="btn btn-line btn-xs" onclick="adminCancelAppt('${esc(a.id)}')">Cancel</button>` : '';
  return `<div class="acts appt-acts">${wa}${call}${cancel}</div>`;
}
function sourceChip(s){
  const map={online:['chip-navy','Online'],phone:['chip-gold','Phone'],'walk-in':['chip-gold','Walk-in'],whatsapp:['chip-green','WhatsApp']};
  const [c,l]=map[s]||map.online; return `<span class="chip ${c}">${l}</span>`;
}
function statusChip(a){
  if (a.status==='cancelled') return '<span class="chip chip-red">Cancelled</span>';
  if (!isUpcoming(a)) return '<span class="chip chip-grey">Done</span>';
  return '<span class="chip chip-green">Confirmed</span>';
}

/* ════ ADMIN: SCHEDULE ════ */
function setAdminDateToday(){ document.getElementById('adm-date-picker').value=todayStr(); renderAdminScheduleForDate(); }
function shiftAdminDate(n){ const el=document.getElementById('adm-date-picker'); el.value=addDays(el.value||todayStr(),n); renderAdminScheduleForDate(); }
function selectAdminScheduleDoc(id){ S.adminScheduleDoc=id; renderAdminScheduleForDate(); }
function renderAdminScheduleForDate(){
  const ds=document.getElementById('adm-date-picker').value||todayStr();
  document.getElementById('adm-doc-tabs').innerHTML = DOCTORS.map(d=>{
    const cnt=S.appointments.filter(a=>a.departmentId===d.id && a.date===ds && a.status!=='cancelled').length;
    return `<button class="adt ${d.id===S.adminScheduleDoc?'active':''}" onclick="selectAdminScheduleDoc(${d.id})">${esc(d.name)}<span class="day-count-badge">${cnt}</span></button>`;
  }).join('');
  const body=document.getElementById('adm-schedule-body');
  if (isClosedDay(ds)){ body.innerHTML=`<tr class="free-row"><td colspan="8" class="center">${esc(fmtDate(ds))} is a weekend or public holiday.</td></tr>`; return; }
  const rows=S.appointments.filter(a=>a.departmentId===S.adminScheduleDoc && a.date===ds);
  body.innerHTML = SLOTS.map(t=>{
    const here=rows.filter(a=>a.slot===t);
    const live=here.find(a=>a.status!=='cancelled');
    const past=isSlotPast(ds,t);
    if (live) return bookingRow(live,t,past);
    const cancelled=here.find(a=>a.status==='cancelled');
    if (cancelled) return bookingRow(cancelled,t,past);
    return `<tr class="free-row ${past?'row-past':''}"><td><b>${t}</b></td><td colspan="6">${past?'—':'Free'}</td><td>${past?'':`<div class="acts"><button class="btn btn-line btn-xs" onclick="openManualBooking(${S.adminScheduleDoc},'${ds}','${t}')">+ Book</button></div>`}</td></tr>`;
  }).join('');
}
function bookingRow(a,t,past){
  return `<tr class="${a.status==='cancelled'?'row-cancelled':past?'row-past':''}">
    <td><b>${esc(t)}</b></td><td>${esc(a.name)}</td><td>${esc(a.phone||'—')}</td><td>${esc(a.company||'—')}</td>
    <td>${esc(a.reason||'—')}</td><td>${sourceChip(a.source)}</td><td>${statusChip(a)}</td><td>${rowActions(a,past)}</td></tr>`;
}

/* ════ ADMIN: BOOKINGS ════ */
function setBookRange(r){
  S.bookRange=r;
  document.querySelectorAll('#tab-admin-bookings [data-range]').forEach(b=>b.classList.toggle('active',b.dataset.range===r));
  renderAdminBookings();
}
function renderAdminBookings(){
  const q=(document.getElementById('adm-book-search').value||'').toLowerCase().trim();
  const day=document.getElementById('adm-book-date').value;
  const t=todayStr();
  let list=S.appointments.slice();
  if (day) list=list.filter(a=>a.date===day);
  else if (S.bookRange==='upcoming') list=list.filter(a=>a.date>=t);
  if (q) list=list.filter(a=>[a.name,a.phone,a.company,a.email,a.reason].join(' ').toLowerCase().includes(q));
  list = (S.bookRange==='all' && !day) ? sortAsc(list).reverse() : sortAsc(list);
  document.getElementById('adm-bookings-body').innerHTML = list.map(a=>{
    const past=isSlotPastStrict(a.date,a.slot);
    return `<tr class="${a.status==='cancelled'?'row-cancelled':past?'row-past':''}">
      <td>${esc(fmtShort(a.date))}</td><td><b>${esc(a.slot)}</b></td><td>${esc(deptById(a.departmentId).name)}</td>
      <td>${esc(a.name)}</td><td>${esc(a.phone||'—')}</td><td>${esc(a.company||'—')}</td>
      <td>${sourceChip(a.source)}</td><td>${statusChip(a)}</td><td>${rowActions(a,past)}</td></tr>`;
  }).join('') || `<tr class="free-row"><td colspan="9" class="center">No bookings found.</td></tr>`;
}

/* ════ ADMIN: CLIENTS ════ */
function allClients(){
  const map=new Map();
  (S.profiles||[]).forEach(p=>{ if(p.email===ADMIN_EMAIL) return; map.set((p.email||p.id).toLowerCase(),{name:p.full_name||p.email,phone:p.phone,email:p.email,company:p.company,count:0}); });
  S.appointments.forEach(a=>{
    const key=(a.email||a.phone||a.name||'').toLowerCase(); if(!key) return;
    if (!map.has(key)) map.set(key,{name:a.name,phone:a.phone,email:a.email,company:a.company,count:0});
    const c=map.get(key); if(a.status!=='cancelled') c.count++;
    if(!c.phone) c.phone=a.phone; if(!c.company) c.company=a.company;
  });
  return [...map.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name)));
}
function renderAdminClients(){
  const q=(document.getElementById('adm-client-search').value||'').toLowerCase().trim();
  let list=allClients();
  if (q) list=list.filter(c=>[c.name,c.phone,c.email,c.company].join(' ').toLowerCase().includes(q));
  document.getElementById('adm-clients-body').innerHTML = list.map(c=>`<tr>
    <td><b>${esc(c.name)}</b></td><td>${esc(c.phone||'—')}</td>
    <td>${c.email?`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`:'—'}</td>
    <td>${esc(c.company||'—')}</td><td>${c.count}</td>
    <td><div class="acts">${c.phone?`<a class="btn btn-wa btn-xs" href="${esc(waLink(c.phone,'Hi '+String(c.name||'').split(' ')[0]+', '))}" target="_blank" rel="noopener">WhatsApp</a>`:''}</div></td></tr>`).join('')
    || `<tr class="free-row"><td colspan="6" class="center">No clients yet.</td></tr>`;
}

/* ════ ADMIN: ADD A BOOKING ════ */
function openManualBooking(deptId,ds,slot){
  ['mb-name','mb-phone','mb-email','mb-company','mb-reason'].forEach(id=>document.getElementById(id).value='');
  const mem=document.getElementById('mb-member');
  mem.innerHTML=DOCTORS.map(d=>`<option value="${d.id}">${esc(d.name)} — ${esc(d.spec)}</option>`).join('');
  mem.value=String(deptId||S.adminScheduleDoc||DOCTORS[0].id);
  const dateEl=document.getElementById('mb-date');
  dateEl.min=todayStr();
  dateEl.value=ds || nextOpenDay(todayStr());
  dateEl.onchange=()=>renderManualSlots();
  mem.onchange=()=>renderManualSlots();
  document.getElementById('client-names').innerHTML=allClients().map(c=>`<option value="${esc(c.name)}">`).join('');
  document.getElementById('mb-name').onchange=()=>{
    const c=allClients().find(x=>x.name===document.getElementById('mb-name').value);
    if (c){ if(c.phone) document.getElementById('mb-phone').value=c.phone; if(c.email) document.getElementById('mb-email').value=c.email; if(c.company) document.getElementById('mb-company').value=c.company; }
  };
  renderManualSlots(slot);
  openModal('manual-book-modal');
}
function renderManualSlots(pick){
  const ds=document.getElementById('mb-date').value, id=parseInt(document.getElementById('mb-member').value);
  const sel=document.getElementById('mb-slot');
  if (!ds){ sel.innerHTML='<option value="">Pick a day first</option>'; return; }
  if (isClosedDay(ds)){ sel.innerHTML='<option value="">Closed that day</option>'; return; }
  const taken=takenFor(id,ds);
  sel.innerHTML=SLOTS.map(t=>{
    const off=taken.includes(t)||isSlotPast(ds,t);
    return `<option value="${t}" ${off?'disabled':''}>${t}${taken.includes(t)?' — booked':isSlotPast(ds,t)?' — passed':''}</option>`;
  }).join('');
  const target = pick && !sel.querySelector(`option[value="${pick}"]`).disabled ? pick : (sel.querySelector('option:not([disabled])')||{}).value;
  if (target) sel.value=target; else sel.innerHTML='<option value="">No free times</option>';
}

/* ════ CALENDAR LINKS ════ */
function apptStartEnd(a){
  const [y,mo,d]=a.date.split('-').map(Number), [h,mi]=a.slot.split(':').map(Number);
  const start=new Date(y,mo-1,d,h,mi,0), end=new Date(start.getTime()+BUSINESS.meetingMinutes*60000);
  return {start,end};
}
function calStamp(dt){ const p=n=>String(n).padStart(2,'0'); return `${dt.getFullYear()}${p(dt.getMonth()+1)}${p(dt.getDate())}T${p(dt.getHours())}${p(dt.getMinutes())}00`; }
function buildGoogleCalendarUrl(a){
  const {start,end}=apptStartEnd(a), dept=deptById(a.departmentId||a.department_id);
  const details=`Meeting with ${dept.name} (${dept.spec})\n${a.reason?'About: '+a.reason+'\n':''}\n${BUSINESS.location}\n${BUSINESS.phone}`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Meeting with '+BUSINESS.name)}&dates=${calStamp(start)}/${calStamp(end)}&ctz=Africa/Johannesburg&details=${encodeURIComponent(details)}&location=${encodeURIComponent(BUSINESS.location)}`;
}
// Calendar file with a 1-hour reminder. Times are written in UTC (South Africa is UTC+2 all year).
function icsStamp(dt){ return dt.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''); }
function apptStartEndUTC(a){
  const [y,mo,d]=a.date.split('-').map(Number), [h,mi]=a.slot.split(':').map(Number);
  const start=new Date(Date.UTC(y,mo-1,d,h-2,mi,0));   // SAST = UTC+2
  return { start, end:new Date(start.getTime()+BUSINESS.meetingMinutes*60000) };
}
function downloadICS(a){
  const {start,end}=apptStartEndUTC(a), dept=deptById(a.departmentId||a.department_id);
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Tidal Tech Solutions//Appointly//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',
    `UID:${a.id||Date.now()}@appointly.tidaltech`,`DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,`DTEND:${icsStamp(end)}`,
    `SUMMARY:Meeting with ${BUSINESS.name}`,`DESCRIPTION:With ${dept.name}. Questions? Call or WhatsApp ${BUSINESS.phone}`,`LOCATION:${BUSINESS.location.replace(/,/g,'\\,')}`,
    'BEGIN:VALARM','TRIGGER:-PT1H','ACTION:DISPLAY','DESCRIPTION:Your meeting with Tidal Tech Solutions starts in 1 hour','END:VALARM','END:VEVENT','END:VCALENDAR'].join('\r\n');
  const url=URL.createObjectURL(new Blob([ics],{type:'text/calendar;charset=utf-8'}));
  const link=document.createElement('a'); link.href=url; link.download='tidal-tech-meeting.ics';
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),4000);
}
function showSuccess(a,emailNote){
  const dept=deptById(a.departmentId);
  document.getElementById('success-details').innerHTML=`<b>With</b> ${esc(dept.name)}<br><b>Day</b> ${esc(fmtDate(a.date))}<br><b>Time</b> ${esc(a.slot)} (${BUSINESS.meetingMinutes} min)`;
  document.getElementById('success-email-note').textContent=emailNote||'';
  document.getElementById('success-gcal').href=buildGoogleCalendarUrl(a);
  document.getElementById('success-ics').onclick=()=>downloadICS(a);
  openModal('success-modal');
}
