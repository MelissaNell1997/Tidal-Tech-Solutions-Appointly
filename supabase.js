/* ═══════════════════════════════════════════════════════════════
   supabase.js — Tidal Tech Solutions · Appointly
   Sign-in, bookings, profiles and emails (Supabase backend)
   ═══════════════════════════════════════════════════════════════ */

// ── 1. YOUR KEYS (the anon key is public by design; never put the service key here) ──
const SUPABASE_URL  = 'https://gitptdhmojjoiednwglw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpdHB0ZGhtb2pqb2llZG53Z2x3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNzQ1OTYsImV4cCI6MjA5Mjk1MDU5Nn0.PO-ODy7AkmtgWZYRi9NDJqcqoIuOJa6cjHPawUIuhSc';
const SEND_EMAIL_FN = `${SUPABASE_URL}/functions/v1/send-email`;
const SITE_URL      = window.location.origin + window.location.pathname.replace(/index\.html$/,'');
const ADMIN_EMAIL   = 'melissanell1234@gmail.com';   // the staff login; must match your RLS policies

const _supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

/* ═══════════════ SESSION HANDLING ═══════════════ */
let _entering = false;

_supa.auth.onAuthStateChange((event, session) => {
  // Supabase recommends not awaiting other calls inside this callback, so defer.
  setTimeout(() => {
    if (event === 'PASSWORD_RECOVERY') { openModal('new-pw-modal'); return; }
    if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session) handleSession(session);
    if (event === 'SIGNED_OUT') resetToLanding();
  }, 0);
});

async function handleSession(session){
  const u = session.user;
  if (_entering || (S.user && S.user.id === u.id)) return;   // already inside
  _entering = true;
  document.getElementById('toasts').innerHTML='';
  loading(true, 'Signing you in…');
  try {
    if ((u.email||'').toLowerCase() === ADMIN_EMAIL) {
      S.user = { id:u.id, name:'Melissa', email:u.email };
      S.profile = await _getProfile(u.id);
      await Promise.all([loadBookings(), loadProfiles()]);
      closeModal('admin-login-modal');
      enterAdminApp();
      _startRealtime(); _startAdminPolling(); _startActivityListeners(); _resetInactivityTimer();
      toast('Welcome back, Melissa 👋', 'success');
    } else {
      const p = await _ensureProfile(u);
      S.profile = p;
      S.user = { id:u.id, name:p.full_name || u.email, email:u.email, phone:p.phone || '', company:p.company || '' };
      await Promise.all([loadBookings(), refreshTaken()]);
      enterClientApp();
      _startRealtime();
    }
    if (location.hash.includes('access_token') || location.search.includes('code=')) history.replaceState(null, '', location.pathname);
  } catch (e) {
    console.error(e);
    toast('We could not load your account: ' + friendlyError(e), 'error');
  } finally {
    loading(false); _entering = false;
  }
}

function resetToLanding(){
  _stopRealtime(); _stopAdminPolling(); _stopActivityListeners();
  S.user=null; S.userType='client'; S.profile=null;
  S.appointments=[]; S.profiles=[]; S.taken=[];
  S.selDepartment=null; S.selDate=null; S.selSlot=null;
  document.querySelectorAll('.modal-overlay.open').forEach(m=>m.classList.remove('open'));
  ['li-pass','rg-pass','adm-pass'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  showScreen('landing');
}

/* ═══════════════ PROFILES ═══════════════ */
async function _getProfile(id){
  const { data } = await _supa.from('profiles').select('*').eq('id', id).maybeSingle();
  return data || null;
}
// Create the profile on first sign-in; never overwrite details the client has edited since.
async function _ensureProfile(user){
  const existing = await _getProfile(user.id);
  const meta = user.user_metadata || {};
  if (existing) {
    if (!existing.avatar_url && meta.avatar_url) {
      await _supa.from('profiles').update({ avatar_url:meta.avatar_url, updated_at:new Date().toISOString() }).eq('id', user.id);
      existing.avatar_url = meta.avatar_url;
    }
    return existing;
  }
  const profile = {
    id: user.id, email: user.email,
    full_name : meta.full_name || meta.name || user.email,
    phone     : meta.phone || '',
    company   : meta.company || '',
    avatar_url: meta.avatar_url || '',
    provider  : (user.app_metadata && user.app_metadata.provider) || 'email',
    updated_at: new Date().toISOString(),
  };
  const { error } = await _supa.from('profiles').upsert(profile, { onConflict:'id' });
  if (error) console.error('Profile create error:', error.message);
  return profile;
}

async function loadProfiles(){
  const { data, error } = await _supa.from('profiles').select('*').order('full_name', { ascending:true });
  if (error) { console.error('loadProfiles:', error.message); return; }
  S.profiles = data || [];
}

/* ═══════════════ BOOKINGS ═══════════════ */
function _mapBooking(b){
  return {
    id:b.id, departmentId:Number(b.department_id), departmentName:b.department_name,
    date:String(b.date).slice(0,10), slot:String(b.slot).slice(0,5),
    name:b.name||'', phone:b.phone||'', email:b.email||'', company:b.company||'',
    reason:b.reason||'', source:b.source||'online', status:b.status||'confirmed', user_id:b.user_id||null,
  };
}
async function loadBookings(){
  const { data, error } = await _supa.from('bookings').select('*').order('date', { ascending:true });
  if (error) { console.error('loadBookings:', error); toast('Could not load bookings. Please refresh.', 'error'); return; }
  S.appointments = (data || []).map(_mapBooking);
}

// Which slots are taken by anyone (no names or phone numbers). Uses the
// get_taken_slots database function from setup.sql when it exists.
async function refreshTaken(){
  if (S.userType === 'admin') return;
  const from = todayStr();
  const rpc = await _supa.rpc('get_taken_slots', { from_date: from });
  if (!rpc.error && rpc.data) { S.taken = (Array.isArray(rpc.data) ? rpc.data : []).map(t=>({ department_id:t.department_id, date:String(t.date).slice(0,10), slot:String(t.slot).slice(0,5) })); return; }
  const { data, error } = await _supa.from('bookings').select('department_id,date,slot,status').gte('date', from).neq('status','cancelled');
  if (!error) S.taken = (data || []).map(t=>({ department_id:t.department_id, date:String(t.date).slice(0,10), slot:String(t.slot).slice(0,5) }));
}

function _isDuplicate(error){ return error && (error.code === '23505' || /duplicate key/i.test(error.message||'')); }

/* ── Client: make a booking ── */
async function confirmBooking(){
  if (!S.selDepartment || !S.selDate || !S.selSlot) { toast('Choose who, a day and a time first.', 'warn'); return; }
  const name  = document.getElementById('bk-name').value.trim();
  const phone = document.getElementById('bk-phone').value.trim();
  if (!name)  { toast('Please add your full name.', 'error'); document.getElementById('bk-name').focus(); return; }
  if (!validPhone(phone)) { toast('Please add a valid phone number, e.g. 082 123 4567.', 'error'); document.getElementById('bk-phone').focus(); return; }

  busy('btn-book', true);
  try {
    await refreshTaken();
    if (!freeSlots(S.selDepartment.id, S.selDate).includes(S.selSlot)) {
      toast('Sorry, that time was just taken. Please pick another.', 'warn');
      S.selSlot = null; renderCalendar(); renderSlots(); return;
    }
    const booking = {
      department_id: S.selDepartment.id, department_name: S.selDepartment.name,
      date: S.selDate, slot: S.selSlot, name, phone, email: S.user.email,
      company: document.getElementById('bk-id').value.trim(),
      reason : document.getElementById('bk-reason').value.trim(),
      source : 'online', status: 'confirmed', user_id: S.user.id,
    };
    const { data, error } = await _supa.from('bookings').insert(booking).select().single();
    if (_isDuplicate(error)) { toast('Sorry, that time was just taken. Please pick another.', 'warn'); S.selSlot=null; await refreshTaken(); renderSlots(); return; }
    if (error) { toast('Booking failed: ' + friendlyError(error), 'error'); return; }

    const appt = _mapBooking(data);
    S.appointments.push(appt);
    S.taken.push({ department_id:appt.departmentId, date:appt.date, slot:appt.slot });

    // Save phone/company to the profile if they were empty, so next time is quicker.
    if ((!S.user.phone && phone) || (!S.user.company && booking.company)) {
      S.user.phone = S.user.phone || phone; S.user.company = S.user.company || booking.company;
      _supa.from('profiles').update({ phone:S.user.phone, company:S.user.company, updated_at:new Date().toISOString() }).eq('id', S.user.id);
    }

    let note = '';
    if (document.getElementById('notif-email').checked) {
      const sent = await sendBookingEmail(appt, 'booking');
      note = sent ? `A confirmation email is on its way to ${S.user.email}.` : '';
    }
    showSuccess(appt, note);
    resetBookingSelection(); renderCalendar(); renderSlots(); renderDashboard();
  } finally { busy('btn-book', false); }
}

/* ── Client: cancel ── */
async function clientCancel(id){
  const a = S.appointments.find(x=>String(x.id)===String(id)); if (!a) return;
  const ok = await confirmDialog('Cancel this meeting?', `${fmtDate(a.date)} at ${a.slot} with ${deptById(a.departmentId).name}.`, 'Yes, cancel it');
  if (!ok) return;
  loading(true, 'Cancelling…');
  const { error } = await _supa.from('bookings').update({ status:'cancelled' }).eq('id', a.id);
  loading(false);
  if (error) { toast('Could not cancel: ' + friendlyError(error), 'error'); return; }
  a.status = 'cancelled';
  S.taken = S.taken.filter(t=>!(Number(t.department_id)===a.departmentId && t.date===a.date && t.slot===a.slot));
  sendBookingEmail(a, 'cancel');
  toast('Your meeting has been cancelled.', 'success');
  renderMyAppointments(); renderDashboard();
}

/* ── Client or admin: move a booking ── */
async function doReschedule(){
  const a = S.appointments.find(x=>String(x.id)===String(S.rescheduleId));
  const ds = document.getElementById('rsch-date').value, slot = S.rschSlot;
  if (!a || !ds || !slot) { toast('Pick a new day and time.', 'warn'); return; }
  busy('btn-rsch', true);
  try {
    await refreshTaken();
    if (!freeSlots(a.departmentId, ds, a.id).includes(slot)) { toast('That time was just taken. Please pick another.', 'warn'); S.rschSlot=null; renderRescheduleSlots(); return; }
    const { error } = await _supa.from('bookings').update({ date:ds, slot, status:'confirmed' }).eq('id', a.id);
    if (_isDuplicate(error)) { toast('That time was just taken. Please pick another.', 'warn'); S.rschSlot=null; await refreshTaken(); renderRescheduleSlots(); return; }
    if (error) { toast('Could not move it: ' + friendlyError(error), 'error'); return; }
    S.taken = S.taken.filter(t=>!(Number(t.department_id)===a.departmentId && t.date===a.date && t.slot===a.slot));
    a.date = ds; a.slot = slot; a.status = 'confirmed';
    S.taken.push({ department_id:a.departmentId, date:ds, slot });
    closeModal('reschedule-modal');
    sendBookingEmail(a, 'reschedule');
    toast(`Moved to ${fmtDate(ds)} at ${slot} ✓`, 'success');
    renderMyAppointments(); renderDashboard();
  } finally { busy('btn-rsch', false); }
}

/* ── Admin: cancel ── */
async function adminCancelAppt(id){
  const a = S.appointments.find(x=>String(x.id)===String(id)); if (!a) return;
  const ok = await confirmDialog(`Cancel ${a.name}'s meeting?`, `${fmtDate(a.date)} at ${a.slot} with ${deptById(a.departmentId).name}.${a.email?' They will get a cancellation email.':''}`, 'Yes, cancel it');
  if (!ok) return;
  const { error } = await _supa.from('bookings').update({ status:'cancelled' }).eq('id', a.id);
  if (error) { toast('Cancel failed: ' + friendlyError(error), 'error'); return; }
  a.status = 'cancelled';
  if (a.email) sendBookingEmail(a, 'cancel');
  toast(`${a.name}'s meeting was cancelled.`, 'success');
  _renderAdminAll();
}

/* ── Admin: add a booking (phone, walk-in, WhatsApp) ── */
async function doManualBooking(){
  const name  = document.getElementById('mb-name').value.trim();
  const phone = document.getElementById('mb-phone').value.trim();
  const email = document.getElementById('mb-email').value.trim();
  const deptId= parseInt(document.getElementById('mb-member').value);
  const ds    = document.getElementById('mb-date').value;
  const slot  = document.getElementById('mb-slot').value;
  if (!name) { toast('Add the client\'s name.', 'error'); return; }
  if (!validPhone(phone)) { toast('Add a valid phone number.', 'error'); return; }
  if (email && !validEmail(email)) { toast('That email address doesn\'t look right.', 'error'); return; }
  if (!ds || isClosedDay(ds)) { toast('Choose a weekday that isn\'t a public holiday.', 'error'); return; }
  if (!slot) { toast('No free time on that day. Choose another day.', 'error'); return; }
  if (takenFor(deptId, ds).includes(slot)) { toast('That time is already booked.', 'error'); return; }

  busy('btn-manual', true);
  try {
    const dept = deptById(deptId);
    const booking = {
      department_id:deptId, department_name:dept.name, date:ds, slot, name, phone, email,
      company: document.getElementById('mb-company').value.trim(),
      reason : document.getElementById('mb-reason').value.trim(),
      source : document.getElementById('mb-source').value, status:'confirmed',
    };
    const { data, error } = await _supa.from('bookings').insert(booking).select().single();
    if (_isDuplicate(error)) { toast('That time was just booked by someone else.', 'warn'); await loadBookings(); renderManualSlots(); return; }
    if (error) { toast('Could not save: ' + friendlyError(error), 'error'); return; }
    const appt = _mapBooking(data);
    S.appointments.push(appt);
    if (email && document.getElementById('mb-send-email').checked) sendBookingEmail(appt, 'booking');
    closeModal('manual-book-modal');
    toast(`Booked ${name} with ${dept.name} on ${fmtShort(ds)} at ${slot} ✓`, 'success');
    _renderAdminAll();
  } finally { busy('btn-manual', false); }
}

/* ═══════════════ PROFILE ═══════════════ */
async function saveProfile(){
  const first = document.getElementById('pf-first').value.trim();
  const last  = document.getElementById('pf-last').value.trim();
  const phone = document.getElementById('pf-phone').value.trim();
  const company = document.getElementById('pf-id').value.trim();
  if (!first) { toast('Please add your first name.', 'error'); return; }
  if (phone && !validPhone(phone)) { toast('That phone number doesn\'t look right.', 'error'); return; }
  busy('btn-profile', true);
  const full_name = (first + ' ' + last).trim();
  const { error } = await _supa.from('profiles').update({ full_name, phone, company, updated_at:new Date().toISOString() }).eq('id', S.user.id);
  await _supa.auth.updateUser({ data:{ full_name, phone, company } });
  busy('btn-profile', false);
  if (error) { toast('Could not save: ' + friendlyError(error), 'error'); return; }
  Object.assign(S.user, { name:full_name, phone, company });
  if (S.profile) Object.assign(S.profile, { full_name, phone, company });
  prefillClientForms(); setAvatar(); renderDashboard();
  toast('Profile saved ✓', 'success');
}

async function handlePicUpload(e){
  const file = e.target.files[0]; e.target.value='';
  if (!file) return;
  if (!/^image\//.test(file.type)) { toast('Please choose a photo.', 'error'); return; }
  if (file.size > 5*1024*1024) { toast('That photo is too big. Please use one under 5 MB.', 'error'); return; }
  loading(true, 'Uploading photo…');
  try {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${S.user.id}.${ext}`;
    const up = await _supa.storage.from('avatars').upload(path, file, { upsert:true, contentType:file.type });
    if (up.error) { toast('Could not upload your photo. Please try again later.', 'error'); return; }
    const url = _supa.storage.from('avatars').getPublicUrl(path).data.publicUrl + '?t=' + Date.now();
    await _supa.from('profiles').update({ avatar_url:url, updated_at:new Date().toISOString() }).eq('id', S.user.id);
    S.profile = Object.assign(S.profile || {}, { avatar_url:url });
    prefillClientForms(); setAvatar();
    toast('Photo updated ✓', 'success');
  } finally { loading(false); }
}

/* ═══════════════ SIGN IN / REGISTER ═══════════════ */
async function doRegister(){
  const first = document.getElementById('rg-first').value.trim();
  const last  = document.getElementById('rg-last').value.trim();
  const email = document.getElementById('rg-email').value.trim();
  const phone = document.getElementById('rg-phone').value.trim();
  const company = document.getElementById('rg-company').value.trim();
  const password = document.getElementById('rg-pass').value;
  if (!first) { toast('Please add your first name.', 'error'); return; }
  if (!validEmail(email)) { toast('Please add a valid email address.', 'error'); return; }
  if (!validPhone(phone)) { toast('Please add a valid phone number, e.g. 082 123 4567.', 'error'); return; }
  if (password.length < 8) { toast('Your password needs at least 8 characters.', 'error'); return; }

  busy('btn-register', true);
  const { data, error } = await _supa.auth.signUp({
    email, password,
    options:{ emailRedirectTo:SITE_URL, data:{ full_name:(first+' '+last).trim(), phone, company } },
  });
  busy('btn-register', false);
  if (error) { toast(friendlyError(error), 'error'); return; }
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    toast('This email already has an account. Sign in instead.', 'warn'); switchAuthTab('login');
    document.getElementById('li-email').value = email; return;
  }
  if (!data.session) {
    switchAuthTab('login');
    document.getElementById('li-email').value = email;
    toast('Almost done! Open the email we sent you and tap the link to confirm, then sign in.', 'success');
  }
}

async function doLogin(){
  const email = document.getElementById('li-email').value.trim();
  const password = document.getElementById('li-pass').value;
  if (!email || !password) { toast('Enter your email and password.', 'error'); return; }
  busy('btn-login', true);
  const { error } = await _supa.auth.signInWithPassword({ email, password });
  busy('btn-login', false);
  if (error) toast(friendlyError(error), 'error');
}

async function googleLogin(){
  const { error } = await _supa.auth.signInWithOAuth({ provider:'google', options:{ redirectTo:SITE_URL } });
  if (error) toast(friendlyError(error), 'error');
}

async function doAdminLogin(){
  const email = document.getElementById('adm-email').value.trim();
  const password = document.getElementById('adm-pass').value;
  if (!email || !password) { toast('Enter your email and password.', 'error'); return; }
  busy('btn-admin-login', true);
  const { error } = await _supa.auth.signInWithPassword({ email, password });
  busy('btn-admin-login', false);
  if (error) { toast(friendlyError(error), 'error'); return; }
  closeModal('admin-login-modal');
}

async function doForgotPasswordSubmit(){
  const email = document.getElementById('forgot-pw-email').value.trim();
  if (!validEmail(email)) { toast('Please enter a valid email address.', 'error'); return; }
  busy('btn-forgot', true);
  const { error } = await _supa.auth.resetPasswordForEmail(email, { redirectTo:SITE_URL });
  busy('btn-forgot', false);
  if (error) { toast(friendlyError(error), 'error'); return; }
  document.getElementById('forgot-pw-sent-email').textContent = email;
  document.getElementById('forgot-pw-form').classList.add('hidden');
  document.getElementById('forgot-pw-sent').classList.remove('hidden');
}

async function doSetNewPassword(){
  const password = document.getElementById('new-pw').value;
  if (password.length < 8) { toast('Use at least 8 characters.', 'error'); return; }
  busy('btn-new-pw', true);
  const { error } = await _supa.auth.updateUser({ password });
  busy('btn-new-pw', false);
  if (error) { toast(friendlyError(error), 'error'); return; }
  closeModal('new-pw-modal');
  toast('Password changed ✓ You\'re signed in.', 'success');
}

async function logout(){
  try { await _supa.auth.signOut(); } catch(e) { console.error(e); }
  resetToLanding();
}

/* ═══════════════ EMAILS (Supabase edge function "send-email") ═══════════════ */
function _buildEmailHTML(appt, type){
  const dept = deptById(appt.departmentId);
  const heading = type==='cancel' ? 'Your meeting is cancelled' : type==='reschedule' ? 'Your meeting has moved' : 'Your meeting is confirmed';
  return `<p>Hi ${esc((appt.name||'').split(' ')[0])},</p><p>${heading}.</p><p><b>With:</b> ${esc(dept.name)}<br><b>Day:</b> ${esc(fmtDate(appt.date))}<br><b>Time:</b> ${esc(appt.slot)}</p><p>Questions? Call or WhatsApp ${esc(BUSINESS.phone)}.</p><p>Kind regards,<br>${esc(BUSINESS.name)}</p>`;
}
async function sendBookingEmail(appt, type){
  if (!appt.email) return false;
  try {
    const { data } = await _supa.auth.getSession();
    const token = data.session ? data.session.access_token : SUPABASE_ANON;
    const subjects = { booking:'Meeting confirmed', cancel:'Meeting cancelled', reschedule:'Meeting moved' };
    const res = await fetch(SEND_EMAIL_FN, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${token}`, 'apikey':SUPABASE_ANON },
      // booking_id + type are used by the new secure function; to/subject/html keep the old one working.
      body: JSON.stringify({ booking_id:appt.id, type, to:appt.email, subject:`${subjects[type]||subjects.booking} — ${BUSINESS.name}`, html:_buildEmailHTML(appt, type) }),
    });
    if (!res.ok) { console.warn('[Email] failed:', await res.text()); return false; }
    return true;
  } catch(e) { console.warn('[Email] not sent:', e.message); return false; }
}

/* ═══════════════ LIVE UPDATES ═══════════════ */
let _channel = null, _poll = null, _takenPoll = null;

function _renderAdminAll(){
  if (S.userType !== 'admin') return;
  const active = document.querySelector('.tab-panel.active');
  const id = active ? active.id.replace('tab-','') : 'admin-home';
  renderAdminHome();
  if (id==='admin-schedule') renderAdminScheduleForDate();
  if (id==='admin-bookings') renderAdminBookings();
  if (id==='admin-clients') renderAdminClients();
}
function _renderClientAll(){
  if (S.userType !== 'client') return;
  const active = document.querySelector('.tab-panel.active');
  const id = active ? active.id.replace('tab-','') : 'dashboard';
  if (id==='dashboard') renderDashboard();
  if (id==='my-appts') renderMyAppointments();
  if (id==='book') { renderCalendar(); renderSlots(); }
}

function _startRealtime(){
  if (_channel) return;
  _channel = _supa.channel('bookings-live')
    .on('postgres_changes', { event:'*', schema:'public', table:'bookings' }, async payload => {
      await loadBookings();
      if (S.userType === 'admin') {
        if (S.profiles) await loadProfiles();
        _renderAdminAll();
        const b = payload.new || {};
        if (payload.eventType === 'INSERT' && b.source === 'online') toast(`🔔 New booking: ${b.name} · ${fmtShort(String(b.date))} ${String(b.slot).slice(0,5)}`, 'info');
        if (payload.eventType === 'UPDATE' && b.status === 'cancelled') toast(`Cancelled: ${b.name} · ${fmtShort(String(b.date))} ${String(b.slot).slice(0,5)}`, 'warn');
      } else { await refreshTaken(); _renderClientAll(); }
    })
    .subscribe();
  // Keep a client's view of free times fresh while they book.
  _takenPoll = setInterval(async () => {
    if (S.userType==='client' && document.getElementById('tab-book').classList.contains('active') && !document.hidden) { await refreshTaken(); renderCalendar(); renderSlots(); }
  }, 30000);
}
function _stopRealtime(){
  if (_channel) { _supa.removeChannel(_channel); _channel = null; }
  clearInterval(_takenPoll); _takenPoll = null;
}
function _startAdminPolling(){
  if (_poll) return;
  _poll = setInterval(async () => { if (S.userType==='admin' && !document.hidden) { await loadBookings(); _renderAdminAll(); } }, 20000);
}
function _stopAdminPolling(){ clearInterval(_poll); _poll = null; }

window.addEventListener('focus', async () => {
  if (!S.user) return;
  await loadBookings();
  if (S.userType==='admin') _renderAdminAll(); else { await refreshTaken(); _renderClientAll(); }
});

/* ═══════════════ STAFF AUTO-LOGOUT AFTER 30 MIN IDLE ═══════════════ */
const INACTIVITY_LIMIT = 30*60*1000, WARNING_BEFORE = 60*1000;
let _idleTimer, _warnTimer;
function _resetInactivityTimer(){
  if (S.userType !== 'admin') return;
  clearTimeout(_idleTimer); clearTimeout(_warnTimer);
  _warnTimer = setTimeout(()=>toast('You\'ll be logged out in 1 minute because you\'ve been inactive.', 'warn'), INACTIVITY_LIMIT-WARNING_BEFORE);
  _idleTimer = setTimeout(async ()=>{ toast('Logged out after 30 minutes of inactivity.', 'warn'); await logout(); }, INACTIVITY_LIMIT);
}
function _startActivityListeners(){ ['mousedown','keydown','touchstart','scroll'].forEach(ev=>document.addEventListener(ev, _resetInactivityTimer, { passive:true })); }
function _stopActivityListeners(){ ['mousedown','keydown','touchstart','scroll'].forEach(ev=>document.removeEventListener(ev, _resetInactivityTimer)); clearTimeout(_idleTimer); clearTimeout(_warnTimer); }
