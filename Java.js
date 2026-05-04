/* ════ DATA ════ */
const DOCTORS=[
  {id:1,name:'Development Team',         spec:'Technical Consultation',color:'#f5a623'},
  {id:2,name:'Sales',            spec:'Product Demo',          color:'#00c9a7'},
  {id:3,name:'Support',          spec:'Technical Support',     color:'#00a8c8'},
  {id:4,name:'Sonja Nell',          spec:'Marketing',      color:'#e8821a'},
  {id:5,name:'Melissa Nell',          spec:'Sales & Developer',      color:'#e8821a'},
];

const SLOTS=['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','13:00','13:30','14:00','14:30','15:00','15:30'];
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS=['Su','Mo','Tu','We','Th','Fr','Sa'];

let S={
  user:null,userType:'client',
  profiles:[],
  selDepartment:null,selDate:null,selSlot:null,
  calY:new Date().getFullYear(),calM:new Date().getMonth(),
  cancelId:null,
  adminScheduleDoc:1,
  adminScheduleDate:'',
  appointments:[], // loaded from Supabase on login
};

/* ════ PWA ════ */
let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;});
function triggerPWAInstall(){
  if(deferredInstallPrompt){deferredInstallPrompt.prompt();}
  else{
    toast('To install: tap your browser menu → "Add to Home Screen"','info');
  }
}

/* ════ SCREEN NAV ════ */
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>{s.classList.remove('active');s.style.display='none';});
  const el=document.getElementById('screen-'+id);
  el.classList.add('active');
  el.style.display='flex';
  if(id==='app') el.style.flexDirection='column';
}

/* ════ MODALS ════ */
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}

/* ════ FORGOT PASSWORD ════ */
function doForgotPassword(){
  document.getElementById('forgot-pw-form').classList.remove('hidden');
  document.getElementById('forgot-pw-sent').classList.add('hidden');
  document.getElementById('forgot-pw-email').value='';
  openModal('forgot-pw-modal');
}
// doForgotPasswordSubmit() → handled by supabase.js

// googleLogin()    → handled by supabase.js
// doLogin()        → handled by supabase.js
// doRegister()     → handled by supabase.js
// logout()         → handled by supabase.js
// confirmBooking() → handled by supabase.js
// doManualBooking()→ handled by supabase.js
// adminCancelAppt()→ handled by supabase.js

/* ════ AUTH ════ */
function switchAuthTab(t){
  document.getElementById('atab-login').classList.toggle('active',t==='login');
  document.getElementById('atab-reg').classList.toggle('active',t==='register');
  document.getElementById('auth-login-form').classList.toggle('hidden',t!=='login');
  document.getElementById('auth-reg-form').classList.toggle('hidden',t!=='register');
}

// doAdminLogin() → handled by supabase.js (fetches data + starts real-time)
function loginClient(user){
  S.user=user;S.userType='client';
  document.getElementById('client-nav').classList.remove('hidden');
  document.getElementById('admin-nav').classList.add('hidden');
  document.getElementById('top-avatar').textContent=user.name.charAt(0).toUpperCase();
  document.getElementById('drawer-client').style.display='block';
  document.getElementById('drawer-admin').style.display='none';
  prefillClientForms(user);
  showScreen('app');
  renderCalendar();
  renderDepartments();
  renderDashboard();
  showTab('dashboard');
}
function prefillClientForms(u){
  const parts=u.name.split(' ');
  const fields={
    'pf-first':parts[0]||'','pf-last':parts.slice(1).join(' ')||'',
    'pf-email':u.email||'','pf-phone':u.phone||'','pf-id':u.company||'',
    'bk-name':u.name,'bk-phone':u.phone||'','bk-id':u.company||'',
  };
  for(const[id,val]of Object.entries(fields)){const el=document.getElementById(id);if(el)el.value=val;}
  document.getElementById('prof-name-disp').textContent=u.name;
  document.getElementById('prof-email-disp').textContent=u.email;
  document.getElementById('prof-pic-el').textContent=u.name.charAt(0).toUpperCase();
}
// logout() → handled by supabase.js

/* ════ TABS ════ */
function showTab(id){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('tab-'+id).classList.add('active');
  document.querySelectorAll('.tnav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));
  // sync mobile drawer active state
  document.querySelectorAll('.mobile-drawer a').forEach(a=>{
    const match=a.getAttribute('onclick')&&a.getAttribute('onclick').includes("'"+id+"'");
    a.classList.toggle('active',!!match);
  });
  if(id==='my-appts') renderMyAppointments();
  if(id==='dashboard') renderDashboard();
  if(id==='admin-home') renderAdminHome();
  if(id==='admin-schedule'){setAdminDateToday();renderAdminScheduleForDate();}
  if(id==='admin-clients') renderAdminClients();
  if(id==='admin-bookings') renderAdminBookings();
}

/* ════ NOTIFICATION TOGGLE ════ */
function toggleNotifOpt(type){
  const el=document.getElementById('notif-'+type+'-opt');
  el.classList.toggle('sel');
}

/* ════ DASHBOARD ════ */
function renderDashboard(){
  if(!S.user||S.userType!=='client')return;
  const now=new Date();
  const mine=S.appointments.filter(a=>a.email===S.user.email);
  const upcoming=mine.filter(a=>{
    const dt=new Date(`${a.date}T${a.slot}:00`);
    return dt>=now && a.status!=='cancelled';
  });
  const past=mine.filter(a=>{
    const dt=new Date(`${a.date}T${a.slot}:00`);
    return dt<now && a.status!=='cancelled';
  });
  const cancelled=mine.filter(a=>a.status==='cancelled');
  document.getElementById('dash-name').textContent=S.user.name.split(' ')[0];
  document.getElementById('stat-up').textContent=upcoming.length;
  document.getElementById('stat-past').textContent=past.length;
  document.getElementById('stat-docs').textContent=[...new Set(mine.map(a=>a.departmentId))].length;
  const cont=document.getElementById('dash-appt-list');
  const list=[...upcoming,...cancelled]
    .sort((a,b)=> a.date===b.date ? a.slot.localeCompare(b.slot) : a.date.localeCompare(b.date));
  if(!list.length){cont.innerHTML=`<div class="empty-state"><div class="esi">📅</div><p>No upcoming appointments. <a style="color:var(--teal);cursor:pointer" onclick="showTab('book')">Book now →</a></p></div>`;return;}
  cont.innerHTML=list.slice(0,3).map(a=>apptCardHTML(a,false)).join('');
}

/* ════ DOCTORS ════ */
function renderDepartments(){
  const today=dateStr(new Date());
  document.getElementById('doc-list').innerHTML=DOCTORS.map(d=>{
    const cnt=S.appointments.filter(a=>a.departmentId===d.id&&a.date===today&&a.status!=='cancelled').length;
    const full=cnt>=SLOTS.length;
    return`<div class="doc-card ${full?'fully-booked':''} ${S.selDepartment?.id===d.id?'selected':''}" onclick="${full?'':('selectDepartment('+d.id+')')}" data-did="${d.id}">
      <div class="doc-avatar" style="background:${d.color}">${d.name.charAt(4)}</div>
      <div class="doc-info"><h4>${d.name}</h4><p>${d.spec}</p></div>
      <span class="chip ${full?'chip-red':'chip-green'}">${full?'Fully Booked':'Available'}</span>
    </div>`;
  }).join('');
}
function selectDepartment(id){
  S.selDepartment=DOCTORS.find(d=>d.id===id);
  document.querySelectorAll('.doc-card').forEach(c=>c.classList.toggle('selected',parseInt(c.dataset.did)===id));
  renderSlots();
}

/* ════ CALENDAR ════ */
function renderCalendar(){
  document.getElementById('cal-label').textContent=MONTHS[S.calM]+' '+S.calY;
  const first=new Date(S.calY,S.calM,1).getDay();
  const total=new Date(S.calY,S.calM+1,0).getDate();
  const today=new Date();today.setHours(0,0,0,0);
  let html=DAYS.map(d=>`<div class="cal-dn">${d}</div>`).join('');
  for(let i=0;i<first;i++) html+='<div class="cal-d empty"></div>';
  for(let d=1;d<=total;d++){
    const dt=new Date(S.calY,S.calM,d);
    const ds=dateStr(dt);
    const isPast=dt<today,isWE=dt.getDay()===0||dt.getDay()===6,isTod=dt.getTime()===today.getTime(),isSel=ds===S.selDate;
    const dim=isPast||isWE;
    html+=`<div class="cal-d ${dim?'dim':''} ${isTod&&!isSel?'today':''} ${isSel?'sel':''}" ${!dim?`onclick="selectDate('${ds}')"`:''} >${d}</div>`;
  }
  document.getElementById('cal-grid').innerHTML=html;
}
function changeMonth(dir){
  S.calM+=dir;
  if(S.calM<0){S.calM=11;S.calY--;}
  if(S.calM>11){S.calM=0;S.calY++;}
  renderCalendar();
}
function selectDate(ds){S.selDate=ds;renderCalendar();renderSlots();}

function parseSlotDate(dateStr, slot){
  const [y,m,d]=dateStr.split('-').map(n=>parseInt(n,10));
  const [h,min]=slot.split(':').map(n=>parseInt(n,10));
  return new Date(y,m-1,d,h,min,0,0);
}
function isSlotExpired(dateStr, slot){
  if(!dateStr||!slot) return false;
  const now=new Date();
  const slotDate=parseSlotDate(dateStr, slot);
  return slotDate <= now;
}

/* ════ SLOTS ════ */
function renderSlots(){
  const hint=document.getElementById('slot-hint');
  const grid=document.getElementById('slots-grid');
  if(!S.selDepartment||!S.selDate){hint.textContent='Select a department and date first.';grid.innerHTML='';updateBookSummary();return;}
  hint.textContent=`${S.selDepartment.name} — ${fmtDate(S.selDate)}`;
  const taken=S.appointments.filter(a=>a.departmentId===S.selDepartment.id&&a.date===S.selDate&&a.status!=='cancelled').map(a=>a.slot);
  if(S.selSlot && isSlotExpired(S.selDate, S.selSlot)) S.selSlot=null;
  grid.innerHTML=SLOTS.map(t=>{
    const isTaken=taken.includes(t);
    const isExpired=isSlotExpired(S.selDate,t);
    const isSel=t===S.selSlot;
    const statusClass=isTaken ? 'taken' : isExpired ? 'expired' : isSel ? 'sel' : 'free';
    const extraText=isTaken ? '<br><small>Booked</small>' : isExpired ? '<br><small>Passed</small>' : '';
    return `<div class="slot-btn ${statusClass}" onclick="${isTaken||isExpired?'':(`selectSlot('${t}')`)}">${t}${extraText}</div>`;
  }).join('');
  updateBookSummary();
}
function selectSlot(t){S.selSlot=t;renderSlots();}
setInterval(() => {
  if (S.selDepartment && S.selDate) renderSlots();
}, 60000);
function updateBookSummary(){
  const el=document.getElementById('book-summary');
  if(S.selDepartment&&S.selDate&&S.selSlot){
    el.style.display='block';
    el.innerHTML=`<strong>Department:</strong> ${S.selDepartment.name}<br><strong>Date:</strong> ${fmtDate(S.selDate)}<br><strong>Time:</strong> ${S.selSlot}<br><strong>Specialty:</strong> ${S.selDepartment.spec}`;
  } else el.style.display='none';
}

// confirmBooking() → handled by supabase.js

/* ════ EMAIL PREVIEW ════ */
function showEmailPreview(appt,type){
  const isCancel=type==='cancel',isReschedule=type==='reschedule';
  const ma=appt.maProvider?`${appt.maProvider} — ${appt.maPlan} (${appt.maNum})`:'Self-pay';
  let subject,bodyHtml;
  if(isCancel){
    subject='Appointment Cancellation Confirmation';
    bodyHtml=`<p>Dear ${appt.name},</p>
    <p>Your appointment on <strong>${fmtDate(appt.date)}</strong> at <strong>${appt.slot}</strong> with <strong>${appt.departmentName}</strong> has been <strong>cancelled</strong>.</p>
    <p>To rebook, please visit our client portal or call <strong>+27 31 000 0000</strong>.</p>`;
  } else if(isReschedule){
    subject='Appointment Rescheduled';
    bodyHtml=`<p>Dear ${appt.name},</p>
    <p>Your appointment has been <strong>rescheduled</strong> to <strong>${fmtDate(appt.date)}</strong> at <strong>${appt.slot}</strong> with <strong>${appt.departmentName}</strong>.</p>`;
  } else {
    subject='Appointment Confirmation — Tidal Tech Solutions';
    bodyHtml=`<p>Dear ${appt.name},</p>
    <p>Your appointment has been <strong>confirmed</strong>.</p>
    <p><strong>Department:</strong> ${appt.departmentName}<br>
    <strong>Date:</strong> ${fmtDate(appt.date)}<br>
    <strong>Time:</strong> ${appt.slot}</p>`;
  }
  document.getElementById('email-preview-body').innerHTML=`
    <div class="email-from"><strong>From:</strong> noreply@tidaltech.co.za &nbsp;·&nbsp; <strong>To:</strong> ${appt.email||appt.name} &nbsp;·&nbsp; <strong>Subject:</strong> ${subject}</div>
    ${bodyHtml}
    <p style="margin-top:12px">Kind regards,<br><strong>Tidal Tech Solutions</strong></p>`;
  openModal('email-modal');
}

/* ════ MY APPOINTMENTS ════ */
function renderMyAppointments(){
  const list=document.getElementById('my-appt-list');
  const mine=S.appointments.filter(a=>a.email===S.user?.email)
    .sort((a,b)=> a.date===b.date ? a.slot.localeCompare(b.slot) : a.date.localeCompare(b.date));
  if(!mine.length){list.innerHTML=`<div class="empty-state"><div class="esi">📋</div><p>No appointments yet. <a style="color:var(--teal);cursor:pointer" onclick="showTab('book')">Book one →</a></p></div>`;return;}
  list.innerHTML=mine.map(a=>apptCardHTML(a,true)).join('');
}
function apptCardHTML(a,showActions){
  const d=new Date(`${a.date}T${a.slot}:00`);
  const today=new Date();today.setHours(0,0,0,0);
  const isPast=d<today,isCancelled=a.status==='cancelled';
  const ma=a.maProvider?`${a.maProvider} · ${a.maPlan}`:'Self-pay';
  return`<div class="appt-card ${isCancelled?'cancelled':isPast?'past':''}">
    <div class="appt-date-box"><div class="aday">${d.getDate()}</div><div class="amon">${MONTHS[d.getMonth()].slice(0,3)}</div></div>
    <div class="appt-info">
      <h4>${a.departmentName} &mdash; ${a.slot}</h4>
      <p>${a.reason||'General visit'} &nbsp;|&nbsp; ${a.phone}</p>
    </div>
    <div class="appt-acts">
      <span class="chip ${isPast?'chip-gold':isCancelled?'chip-red':'chip-green'}">${isCancelled?'Cancelled':isPast?'Completed':'Confirmed'}</span>
      ${showActions&&!isPast&&!isCancelled?`<button class="btn btn-warn btn-sm" onclick="openRescheduleCancel('${a.id}')">Reschedule / Cancel</button>`:''}
    </div>
  </div>`;
}

/* ════ RESCHEDULE / CANCEL ════ */
function openRescheduleCancel(id){
  S.cancelId=id;
  // Pre-fill current date in reschedule picker
  const appt=S.appointments.find(a=>String(a.id)===String(id));
  if(appt){
    const dateEl=document.getElementById('rsch-date');
    if(dateEl) dateEl.value=appt.date;
    // Set min date to today
    const today=dateStr(new Date());
    if(dateEl) dateEl.min=today;
  }
  openModal('reschedule-modal');
}

async function doCancel(){
  const appt=S.appointments.find(a=>String(a.id)===String(S.cancelId));
  if(!appt){toast('Appointment not found','error');return;}

  // Update in Supabase
  if(typeof _supa!=='undefined'){
    const {error}=await _supa.from('bookings').update({status:'cancelled'}).eq('id',appt.id);
    if(error){ toast('Could not cancel: '+error.message,'error'); return; }
  }

  appt.status='cancelled';
  closeModal('reschedule-modal');

  // Send email notification
  if(typeof _sendBookingEmail==='function') await _sendBookingEmail(appt,'cancel');
  else showEmailPreview(appt,'cancel');

  toast('Appointment cancelled. A confirmation email has been sent.','info');
  renderMyAppointments();
  renderDashboard();
}

async function doReschedule(){
  const appt=S.appointments.find(a=>String(a.id)===String(S.cancelId));
  const newDate=document.getElementById('rsch-date').value;
  const newSlot=document.getElementById('rsch-slot').value;
  if(!newDate||!newSlot){toast('Please select a new date and time','error');return;}
  if(!appt) return;

  // Check slot not already taken
  const taken=S.appointments.filter(a=>
    a.departmentId===appt.departmentId &&
    a.date===newDate &&
    a.slot===newSlot &&
    a.status!=='cancelled' &&
    a.id!==appt.id
  );
  if(taken.length){toast('That time slot is already taken. Please choose another.','error');return;}

  // Update in Supabase
  if(typeof _supa!=='undefined'){
    const {error}=await _supa.from('bookings').update({date:newDate,slot:newSlot,status:'confirmed'}).eq('id',appt.id);
    if(error){ toast('Could not reschedule: '+error.message,'error'); return; }
  }

  appt.date=newDate;
  appt.slot=newSlot;
  appt.status='confirmed';
  closeModal('reschedule-modal');

  // Send email notification
  if(typeof _sendBookingEmail==='function') await _sendBookingEmail(appt,'reschedule');
  else showEmailPreview(appt,'reschedule');

  toast('Appointment rescheduled ✓ A confirmation email has been sent.','success');
  renderMyAppointments();
  renderDashboard();
}

/* ════ PROFILE ════ */
function saveProfile(){
  const first=document.getElementById('pf-first').value.trim();
  const last=document.getElementById('pf-last').value.trim();
  if(!first){toast('First name required','error');return;}
  S.user.name=first+' '+last;
  S.user.email=document.getElementById('pf-email').value.trim();
  S.user.phone=document.getElementById('pf-phone').value.trim();
  document.getElementById('prof-name-disp').textContent=S.user.name;
  document.getElementById('prof-email-disp').textContent=S.user.email;
  document.getElementById('top-avatar').textContent=first.charAt(0).toUpperCase();
  document.getElementById('prof-pic-el').textContent=first.charAt(0).toUpperCase();
  document.getElementById('dash-name').textContent=first;
  toast('Profile saved ✓','success');
}
function handlePicUpload(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    const src=ev.target.result;
    document.getElementById('prof-pic-el').innerHTML=`<img src="${src}"/>`;
    document.getElementById('top-avatar').innerHTML=`<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    toast('Profile photo updated!','success');
  };
  reader.readAsDataURL(file);
}

/* ════ ADMIN HOME ════ */
function renderAdminHome(){
  const today=dateStr(new Date());
  const todayAppts=S.appointments.filter(a=>a.date===today);
  const todayCancel=todayAppts.filter(a=>a.status==='cancelled').length;
  document.getElementById('adm-stat-today').textContent=todayAppts.length;
  document.getElementById('adm-stat-all').textContent=S.appointments.length;
  document.getElementById('adm-stat-cancel').textContent=todayCancel;
  document.getElementById('adm-stat-clients').textContent = S.profiles && S.profiles.length ? S.profiles.length : [...new Set(S.appointments.filter(a=>a.email).map(a=>a.email))].length;
  // Availability bar
  const bar=document.getElementById('avail-bar');
  bar.innerHTML=DOCTORS.map(d=>{
    const taken=S.appointments.filter(a=>a.departmentId===d.id&&a.date===today&&a.status!=='cancelled').map(a=>a.slot);
    const free=SLOTS.filter(s=>!taken.includes(s)).length;
    const slotsHtml=SLOTS.slice(0,6).map(s=>{
      const expired=isSlotExpired(today, s);
      const cls=taken.includes(s) ? 'taken' : expired ? 'expired' : '';
      return `<span class="avail-slot ${cls}">${s}</span>`;
    }).join('')+'…';
    return`<div class="avail-card" onclick="showTab('admin-schedule')">
      <h4>${d.name}</h4>
      <p>${d.spec} &nbsp;·&nbsp; <strong>${free}/${SLOTS.length}</strong> slots free</p>
      <div class="avail-mini-slots">${slotsHtml}</div>
    </div>`;
  }).join('');
}

/* ════ ADMIN SCHEDULE ════ */
function setAdminDateToday(){
  document.getElementById('adm-date-picker').value=dateStr(new Date());
  S.adminScheduleDate=dateStr(new Date());
  S.adminScheduleDoc=DOCTORS[0].id;
  renderAdminScheduleForDate();
}
function renderAdminScheduleForDate(){
  const dateVal=document.getElementById('adm-date-picker').value||dateStr(new Date());
  S.adminScheduleDate=dateVal;
  // Doc tabs
  document.getElementById('adm-doc-tabs').innerHTML=DOCTORS.map(d=>{
    const cnt=S.appointments.filter(a=>a.departmentId===d.id&&a.date===dateVal&&a.status!=='cancelled').length;
    return`<button class="adt ${d.id===S.adminScheduleDoc?'active':''}" onclick="selectAdminScheduleDoc(${d.id})">
      ${d.name}<span class="day-count-badge">${cnt}</span>
    </button>`;
  }).join('');
  renderAdminScheduleTable(dateVal,S.adminScheduleDoc);
}
function selectAdminScheduleDoc(id){
  S.adminScheduleDoc=id;
  renderAdminScheduleForDate();
}
function renderAdminScheduleTable(dateVal,docId){
  const takenMap={};
  S.appointments.filter(a=>a.departmentId===docId&&a.date===dateVal).forEach(a=>takenMap[a.slot]=a);
  let n=0;
  document.getElementById('adm-schedule-body').innerHTML=SLOTS.map(t=>{
    const a=takenMap[t];
    if(a){
      n++;
      const company=a.company||'—';
      const srcBadge=a.source==='phone'
        ?'<span class="chip chip-gold">&#128222; Phone</span>'
        :'<span class="chip chip-navy">&#127760; Online</span>';
      const statusBadge=a.status==='cancelled'
        ?'<span class="chip chip-red">Cancelled</span>'
        :'<span class="chip chip-green">Confirmed</span>';
      const cancelBtn=a.status!=='cancelled'
        ?`<button class="btn btn-danger btn-sm" onclick="adminCancelAppt('${a.id}')">Cancel</button>`
        :'';
      return`<tr>
        <td><span class="row-num">${n}</span></td>
        <td><strong>${t}</strong></td>
        <td>${a.name}</td>
        <td>${a.phone}</td>
        <td>${company}</td>
        <td>${srcBadge}</td>
        <td>${statusBadge}</td>
        <td>${cancelBtn}</td>
      </tr>`;
    }
    return`<tr><td></td><td>${t}</td><td colspan="6" style="color:var(--muted2);font-size:.78rem">— Available —</td></tr>`;
  }).join('');
}

/* ════ ADMIN BOOKINGS ════ */
function renderAdminBookings(){
  const filterDate=document.getElementById('adm-book-date').value;
  let list=filterDate?S.appointments.filter(a=>a.date===filterDate):S.appointments;
  list=[...list].sort((a,b)=>{
    if(a.date!==b.date) return a.date.localeCompare(b.date);
    return a.slot.localeCompare(b.slot);
  });
  const now=new Date();
  document.getElementById('adm-bookings-body').innerHTML=list.map((a,i)=>{
    const company=a.company||'—';
    const srcBadge=a.source==='phone'
      ?'<span class="chip chip-gold">&#128222; Phone</span>'
      :'<span class="chip chip-navy">&#127760; Online</span>';
    const statusBadge=a.status==='cancelled'
      ?'<span class="chip chip-red">Cancelled</span>'
      :'<span class="chip chip-green">Confirmed</span>';
    const cancelBtn=a.status!=='cancelled'
      ?`<button class="btn btn-danger btn-sm" onclick="adminCancelAppt('${a.id}')">Cancel</button>`
      :'';
    const rowClass = a.status==='cancelled' ? 'cancelled' : (new Date(`${a.date}T${a.slot}:00`) < now ? 'past' : '');
    return`<tr class="${rowClass}">
      <td><span class="row-num">${i+1}</span></td>
      <td>${fmtDate(a.date)}</td>
      <td>${a.slot}</td>
      <td>${a.departmentName}</td>
      <td>${a.name}</td>
      <td>${a.phone}</td>
      <td>${company}</td>
      <td>${srcBadge}</td>
      <td>${statusBadge}</td>
      <td>${cancelBtn}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:20px">No bookings found</td></tr>';
}

/* ════ ADMIN CLIENTS ════ */
function renderAdminClients(){
  // Merge registered profiles (from Supabase auth) with booking data
  const profiles = S.profiles || [];
  // Also collect any clients that appear only in bookings (e.g. phone bookings with no account)
  const bookingEmails = [...new Set(S.appointments.filter(a=>a.email).map(a=>a.email))];
  const profileEmails = profiles.map(p=>p.email);
  // Emails in bookings but not in profiles (phone-in clients)
  const extraEmails = bookingEmails.filter(em=>em && !profileEmails.includes(em));

  let rows = '';

  // Registered clients from profiles table
  profiles.forEach(p=>{
    const appts = S.appointments.filter(a=>a.email===p.email);
    const sources = [...new Set(appts.map(x=>x.source))];
    const srcBadges = appts.length
      ? sources.map(s=>s==='phone'
          ?'<span class="chip chip-gold">&#128222; Phone</span>'
          :'<span class="chip chip-navy">&#127760; Online</span>').join(' ')
      : '<span class="chip chip-navy">&#127760; Registered</span>';
    rows += `<tr>
      <td><strong>${p.full_name||p.email}</strong></td>
      <td>${p.phone||'—'}</td>
      <td>${p.email||'—'}</td>
      <td>${p.company||'—'}</td>
      <td>${srcBadges}</td>
      <td>${appts.length}</td>
    </tr>`;
  });

  // Phone-in clients not in profiles
  extraEmails.forEach(em=>{
    const appts = S.appointments.filter(a=>a.email===em);
    const a = appts[0];
    const sources = [...new Set(appts.map(x=>x.source))];
    const srcBadges = sources.map(s=>s==='phone'
      ?'<span class="chip chip-gold">&#128222; Phone</span>'
      :'<span class="chip chip-navy">&#127760; Online</span>').join(' ');
    rows += `<tr>
      <td><strong>${a.name}</strong></td>
      <td>${a.phone||'—'}</td>
      <td>${em||'—'}</td>
      <td>${a.company||'—'}</td>
      <td>${srcBadges}</td>
      <td>${appts.length}</td>
    </tr>`;
  });

  document.getElementById('adm-clients-body').innerHTML =
    rows || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">No clients yet</td></tr>';
}

// adminCancelAppt() → handled by supabase.js

/* ════ ADMIN MANUAL BOOKING ════ */
function initManualBookModal(){
  const today=dateStr(new Date());
  document.getElementById('mb-date').value=today;
}
// doManualBooking() → handled by supabase.js

/* ════ HAMBURGER / DRAWER ════ */
function toggleDrawer(){
  const btn=document.getElementById('hamburger-btn');
  const drawer=document.getElementById('mobile-drawer');
  btn.classList.toggle('open');
  drawer.classList.toggle('open');
}
function drawerNav(tab){
  // close drawer
  document.getElementById('hamburger-btn').classList.remove('open');
  document.getElementById('mobile-drawer').classList.remove('open');
  // update active drawer links
  document.querySelectorAll('.mobile-drawer a').forEach(a=>a.classList.remove('active'));
  showTab(tab);
}
// Close drawer when clicking outside
document.addEventListener('click',function(e){
  const drawer=document.getElementById('mobile-drawer');
  const btn=document.getElementById('hamburger-btn');
  if(drawer&&btn&&!drawer.contains(e.target)&&!btn.contains(e.target)){
    drawer.classList.remove('open');
    btn.classList.remove('open');
  }
});

/* ════ UTILS ════ */
function dateStr(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function fmtDate(ds){const[y,m,d]=ds.split('-');return`${parseInt(d)} ${MONTHS[parseInt(m)-1]} ${y}`;}
function toast(msg,type='info'){
  const t=document.createElement('div');
  t.className=`toast ${type}`;
  const icon=type==='success'?'✓':type==='error'?'✕':type==='warn'?'⚠':'ℹ';
  t.innerHTML=`<span>${icon}</span> ${msg}`;
  document.getElementById('toasts').appendChild(t);
  setTimeout(()=>t.remove(),4800);
}
function togglePw(id,btn){
  const el=document.getElementById(id);
  const show=el.type==='password';
  el.type=show?'text':'password';
  btn.textContent=show?'\uD83D\uDE48':'\uD83D\uDC41';
}

/* manifest fetch removed */