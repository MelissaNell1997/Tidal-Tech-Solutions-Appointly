/* ═══════════════════════════════════════════════════════════════
   supabase.js  —  Tidal Tech Solutions · Appointly
   ═══════════════════════════════════════════════════════════════ */

// ── 1. YOUR KEYS ────────────────────────────────────────────────
const SUPABASE_URL      = 'https://gitptdhmojjoiednwglw.supabase.co';
const SUPABASE_ANON     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpdHB0ZGhtb2pqb2llZG53Z2x3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNzQ1OTYsImV4cCI6MjA5Mjk1MDU5Nn0.PO-ODy7AkmtgWZYRi9NDJqcqoIuOJa6cjHPawUIuhSc';
const RECAPTCHA_KEY     = '6LdDxtgsAAAAAMbD4ywQDLqliV5iikCqKyqUphfA';
const SEND_EMAIL_FN     = `${SUPABASE_URL}/functions/v1/send-email`;
const SITE_URL          = window.location.origin + window.location.pathname;
const VERIFY_CAPTCHA_FN = `${SUPABASE_URL}/functions/v1/verify-recaptcha`;
// ────────────────────────────────────────────────────────────────

const _supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);



/* ═══════════════════════════════════════════════════════════════
   REAL-TIME SUBSCRIPTION — keeps admin portal live
   ═══════════════════════════════════════════════════════════════ */
let _realtimeChannel = null;

function _startRealtimeBookings() {
  if (_realtimeChannel) return; // already subscribed
  _realtimeChannel = _supa
    .channel('public:bookings')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' },
      async function(payload) {
        // Re-fetch all bookings to keep state consistent
        await loadBookings();
        // Refresh whichever admin view is currently active
        if (S.userType === 'admin') {
          renderAdminHome();
          renderAdminScheduleForDate();
          renderAdminBookings();
          renderAdminClients();
        }
        if (S.userType === 'client') {
          renderDashboard();
          renderMyAppointments();
          renderSlots();
        }
        // Show a live indicator for the admin
        if (S.userType === 'admin' && payload.eventType === 'INSERT') {
          const b = payload.new;
          toast('🔔 New booking: ' + (b.name || '') + ' — ' + (b.department_name || '') + ' at ' + (b.slot || ''), 'info');
        }
      }
    )
    .subscribe();
}

function _stopRealtimeBookings() {
  if (_realtimeChannel) {
    _supa.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   REAL-TIME SUBSCRIPTION — profiles (clients tab)
   ═══════════════════════════════════════════════════════════════ */
let _realtimeProfilesChannel = null;

function _startRealtimeProfiles() {
  if (_realtimeProfilesChannel) return;
  _realtimeProfilesChannel = _supa
    .channel('public:profiles')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' },
      async function() {
        await loadProfiles();
        if (S.userType === 'admin') {
          renderAdminClients();
          const el = document.getElementById('adm-stat-clients');
          if (el) el.textContent = S.profiles ? S.profiles.length : 0;
        }
      }
    )
    .subscribe();
}

function _stopRealtimeProfiles() {
  if (_realtimeProfilesChannel) {
    _supa.removeChannel(_realtimeProfilesChannel);
    _realtimeProfilesChannel = null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   INACTIVITY TIMER — auto-logout after 30 minutes of no activity
   ═══════════════════════════════════════════════════════════════ */
const INACTIVITY_LIMIT = 30 * 60 * 1000;
const WARNING_BEFORE   = 60 * 1000;
let _inactivityTimer;
let _warningTimer;

function _resetInactivityTimer() {
  if (!S.user) return;
  clearTimeout(_inactivityTimer);
  clearTimeout(_warningTimer);
  _warningTimer = setTimeout(() => {
    if (!S.user) return;
    toast('⚠ You will be logged out in 1 minute due to inactivity.', 'warn');
  }, INACTIVITY_LIMIT - WARNING_BEFORE);
  _inactivityTimer = setTimeout(async () => {
    if (!S.user) return;
    toast('You have been logged out due to 30 minutes of inactivity.', 'warn');
    await logout();
  }, INACTIVITY_LIMIT);
}

function _startActivityListeners() {
  ['mousemove','mousedown','keydown','touchstart','scroll','click'].forEach(evt => {
    document.addEventListener(evt, _resetInactivityTimer, { passive: true });
  });
}

function _stopActivityListeners() {
  ['mousemove','mousedown','keydown','touchstart','scroll','click'].forEach(evt => {
    document.removeEventListener(evt, _resetInactivityTimer);
  });
  clearTimeout(_inactivityTimer);
  clearTimeout(_warningTimer);
}

/* ═══════════════════════════════════════════════════════════════
   HELPER — upsert profile row (Google OAuth + email/password)
   ═══════════════════════════════════════════════════════════════ */
async function _upsertProfile(user, extra) {
  extra = extra || {};
  const profile = {
    id         : user.id,
    email      : user.email,
    full_name  : user.user_metadata && user.user_metadata.full_name  ? user.user_metadata.full_name  : (extra.full_name  || user.email),
    phone      : user.user_metadata && user.user_metadata.phone      ? user.user_metadata.phone      : (extra.phone      || ''),
    company    : user.user_metadata && user.user_metadata.company    ? user.user_metadata.company    : (extra.company    || ''),
    avatar_url : user.user_metadata && user.user_metadata.avatar_url ? user.user_metadata.avatar_url : '',
    provider   : user.app_metadata  && user.app_metadata.provider    ? user.app_metadata.provider    : 'email',
    updated_at : new Date().toISOString(),
  };
  const { error } = await _supa.from('profiles').upsert(profile, { onConflict: 'id' });
  if (error) console.error('Profile upsert error:', error.message);
  return profile;
}

/* ═══════════════════════════════════════════════════════════════
   AUTH STATE LISTENER
   ═══════════════════════════════════════════════════════════════ */
_supa.auth.onAuthStateChange(async function(event, session) {
  if (event === 'SIGNED_IN' && session) {
    const u = session.user;
    // If admin is already logged in, don't override with client view
    if (S.userType === 'admin') return;
    const profile = await _upsertProfile(u);
    await loadBookings();
    loginClient({
      name    : profile.full_name || profile.email,
      email   : profile.email,
      phone   : profile.phone,
      company : profile.company,
    });
    _startActivityListeners();
    _resetInactivityTimer();
    _startRealtimeBookings();
    if (window.location.hash.indexOf('access_token') !== -1) {
      history.replaceState(null, '', window.location.pathname);
    }
  }
  if (event === 'SIGNED_OUT') {
    _stopActivityListeners();
    _stopRealtimeBookings();
    _stopRealtimeProfiles();
    S.user     = null;
    S.userType = 'client';
    showScreen('landing');
  }
});

/* ═══════════════════════════════════════════════════════════════
   PAGE LOAD — restore existing session
   ═══════════════════════════════════════════════════════════════ */
window.addEventListener('load', async function() {
  const result = await _supa.auth.getSession();
  const session = result.data.session;
  if (session) {
    const u = session.user;
    // Restore admin session if this is the admin email
    if (u.email === ADMIN_EMAIL) {
      await loadBookings();
      await loadProfiles();
      S.user     = { name: 'Melissa', email: ADMIN_EMAIL };
      S.userType = 'admin';
      document.getElementById('client-nav').classList.add('hidden');
      document.getElementById('admin-nav').classList.remove('hidden');
      document.getElementById('top-avatar').textContent = 'M';
      document.getElementById('drawer-client').style.display = 'none';
      document.getElementById('drawer-admin').style.display  = 'block';
      showScreen('app');
      renderAdminHome();
      showTab('admin-home');
      _startRealtimeBookings();
      _startRealtimeProfiles();
      _startActivityListeners();
      _resetInactivityTimer();
      return;
    }
    const profile = await _upsertProfile(u);
    await loadBookings();
    loginClient({
      name    : profile.full_name || profile.email,
      email   : profile.email,
      phone   : profile.phone,
      company : profile.company,
    });
    _startActivityListeners();
    _resetInactivityTimer();
    _startRealtimeBookings();
    if (window.location.hash.indexOf('access_token') !== -1) {
      history.replaceState(null, '', window.location.pathname);
    }
  }
});

window.addEventListener('focus', async function() {
  if (S.userType === 'admin') {
    await loadBookings();
    renderAdminHome();
    renderAdminScheduleForDate();
    renderAdminBookings();
    renderAdminClients();
  }
});

/* ═══════════════════════════════════════════════════════════════
   reCAPTCHA HELPER
   ═══════════════════════════════════════════════════════════════ */
function getRecaptchaToken() {
  if (typeof grecaptcha === 'undefined') return 'bypass';
  const response = grecaptcha.getResponse();
  return response || null;
}

async function verifyRecaptcha(token) {
  if (token === 'bypass') return true;
  if (!token) return false;
  try {
    const res = await fetch(VERIFY_CAPTCHA_FN, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify({ token: token, secret: '6LdDxtgsAAAAANqBdzVHhDfR6iyp9ZCP0T3KGnoB' }),
    });
    const data = await res.json();
    return data.success === true;
  } catch(e) {
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════
   REGISTER
   ═══════════════════════════════════════════════════════════════ */
async function doRegister() {
  const first    = document.getElementById('rg-first').value.trim();
  const last     = document.getElementById('rg-last').value.trim();
  const email    = document.getElementById('rg-email').value.trim();
  const phone    = document.getElementById('rg-phone').value.trim();
  const company  = document.getElementById('rg-company').value.trim();
  const password = document.getElementById('rg-pass').value;

  if (!first || !email || !phone || !password) {
    toast('Please fill in all required fields', 'error');
    return;
  }

  const token = getRecaptchaToken();
  if (!token) { toast('Please complete the reCAPTCHA checkbox', 'error'); return; }
  const captchaOk = await verifyRecaptcha(token);
  if (!captchaOk) { toast('Security check failed. Please try again.', 'error'); return; }
  grecaptcha.reset();

  const result = await _supa.auth.signUp({
    email    : email,
    password : password,
    options  : { data: { full_name: first + ' ' + last, phone: phone, company: company } },
  });

  if (result.error) { toast(result.error.message, 'error'); return; }

  if (result.data.user) {
    await _upsertProfile(result.data.user, { full_name: first + ' ' + last, phone: phone, company: company });
  }

  toast('Account created! Check your email to confirm ✓', 'success');
}

/* ═══════════════════════════════════════════════════════════════
   SIGN IN (email + password)
   ═══════════════════════════════════════════════════════════════ */
async function doLogin() {
  const email    = document.getElementById('li-email').value.trim();
  const password = document.getElementById('li-pass').value;

  if (!email || !password) { toast('Please enter your email and password', 'error'); return; }

  // Login uses Supabase rate limiting — no captcha needed here

  const result = await _supa.auth.signInWithPassword({ email: email, password: password });
  if (result.error) { toast(result.error.message, 'error'); return; }
  // onAuthStateChange handles profile upsert + loadBookings + loginClient
}

/* ═══════════════════════════════════════════════════════════════
   GOOGLE OAUTH
   ═══════════════════════════════════════════════════════════════ */
async function googleLogin() {
  const result = await _supa.auth.signInWithOAuth({
    provider : 'google',
    options  : { redirectTo: SITE_URL },
  });
  if (result.error) toast(result.error.message, 'error');
}

/* ═══════════════════════════════════════════════════════════════
   FORGOT PASSWORD
   ═══════════════════════════════════════════════════════════════ */
async function doForgotPasswordSubmit() {
  const email = document.getElementById('forgot-pw-email').value.trim();
  if (!email) { toast('Please enter your email address', 'error'); return; }

  const result = await _supa.auth.resetPasswordForEmail(email, {
    redirectTo: SITE_URL + '?reset=true',
  });

  if (result.error) { toast(result.error.message, 'error'); return; }

  document.getElementById('forgot-pw-sent-email').textContent = email;
  document.getElementById('forgot-pw-form').classList.add('hidden');
  document.getElementById('forgot-pw-sent').classList.remove('hidden');
}

/* ═══════════════════════════════════════════════════════════════
   LOGOUT
   ═══════════════════════════════════════════════════════════════ */
async function logout() {
  _stopActivityListeners();
  _stopRealtimeBookings();
  _stopRealtimeProfiles();
  await _supa.auth.signOut();
  S.user          = null;
  S.userType      = 'client';
  S.selDepartment = null;
  S.selDate       = null;
  S.selSlot       = null;
  S.profiles      = [];
  showScreen('landing');
}


/* ═══════════════════════════════════════════════════════════════
   PROFILE PHOTO — upload to Supabase Storage (bucket: avatars)
   ═══════════════════════════════════════════════════════════════ */
async function uploadProfilePhoto(file) {
  const userResult = await _supa.auth.getUser();
  const user = userResult.data.user;
  if (!user) { toast('Please sign in first', 'error'); return null; }
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `${user.id}.${ext}`;
  const { error: upErr } = await _supa.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) {
    console.warn('Storage upload error:', upErr.message);
    toast('Could not save photo to server — showing locally only', 'warn');
    return null;
  }
  const { data } = _supa.storage.from('avatars').getPublicUrl(path);
  const publicUrl = data.publicUrl + '?t=' + Date.now();
  await _supa.from('profiles')
    .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
    .eq('id', user.id);
  if (S.user) S.user.avatar_url = publicUrl;
  return publicUrl;
}

async function handlePicUploadSupabase(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const src = ev.target.result;
    const circle = `<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    document.getElementById('prof-pic-el').innerHTML = circle;
    document.getElementById('top-avatar').innerHTML  = circle;
  };
  reader.readAsDataURL(file);
  const url = await uploadProfilePhoto(file);
  if (url) {
    const circle = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    document.getElementById('prof-pic-el').innerHTML = circle;
    document.getElementById('top-avatar').innerHTML  = circle;
    toast('Profile photo saved ✓', 'success');
  }
}

/* ═══════════════════════════════════════════════════════════════
   EMAIL — send via Resend edge function
   ═══════════════════════════════════════════════════════════════ */
function _buildEmailHTML(appt, type) {
  const date = fmtDate(appt.date);
  const dept = appt.departmentName || appt.department_name || '';
  let heading, body;
  if (type === 'cancel') {
    heading = 'Appointment Cancelled';
    body = `<p>Dear ${appt.name},</p>
      <p>Your appointment on <strong>${date}</strong> at <strong>${appt.slot}</strong>
      with <strong>${dept}</strong> has been <strong style="color:#cc0000">cancelled</strong>.</p>
      <p>To rebook please visit our portal or call <strong>+27 81 518 9577</strong>.</p>`;
  } else if (type === 'reschedule') {
    heading = 'Appointment Rescheduled';
    body = `<p>Dear ${appt.name},</p>
      <p>Your appointment has been <strong>rescheduled</strong> to
      <strong>${date}</strong> at <strong>${appt.slot}</strong>
      with <strong>${dept}</strong>.</p>`;
  } else {
    heading = 'Appointment Confirmed ✓';
    body = `<p>Dear ${appt.name},</p>
      <p>Your appointment is <strong style="color:#1a7a4a">confirmed</strong>.</p>
      <table style="border-collapse:collapse;margin:12px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#555;font-size:14px">Department</td><td style="padding:4px 0;font-weight:500">${dept}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#555;font-size:14px">Date</td><td style="padding:4px 0;font-weight:500">${date}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#555;font-size:14px">Time</td><td style="padding:4px 0;font-weight:500">${appt.slot}</td></tr>
      </table>
      <p style="font-size:13px;color:#666">Questions? Call <strong>+27 81 518 9577</strong> or reply to this email.</p>`;
  }
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden">
        <tr><td style="background:#0d2137;padding:24px 32px;text-align:center">
          <h1 style="margin:0;color:#fff;font-size:22px">Tidal Tech Solutions</h1>
          <p style="margin:4px 0 0;color:#e8821a;font-size:14px">Powered by Appointly</p>
        </td></tr>
        <tr><td style="padding:28px 32px">
          <h2 style="margin:0 0 16px;color:#0d2137;font-size:18px">${heading}</h2>
          ${body}
          <p style="margin-top:24px;color:#333">Kind regards,<br><strong>Tidal Tech Solutions</strong></p>
        </td></tr>
        <tr><td style="background:#f0f0f0;padding:14px 32px;text-align:center">
          <p style="margin:0;font-size:12px;color:#999">Durban, KwaZulu-Natal · tidaltech.co.za · +27 81 518 9577</p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

async function _sendBookingEmail(appt, type) {
  const to = appt.email || (S.user && S.user.email);
  if (!to) { console.log('[Email] No recipient address found'); return; }
  const subjects = {
    booking    : 'Appointment Confirmed — Tidal Tech Solutions',
    cancel     : 'Appointment Cancelled — Tidal Tech Solutions',
    reschedule : 'Appointment Rescheduled — Tidal Tech Solutions',
  };
  try {
    const res = await fetch(SEND_EMAIL_FN, {
      method  : 'POST',
      headers : {
        'Content-Type'  : 'application/json',
        'Authorization' : `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({
        to      : to,
        subject : subjects[type] || subjects.booking,
        html    : _buildEmailHTML(appt, type),
      }),
    });
    if (!res.ok) console.warn('[Email] Send failed:', await res.text());
  } catch(e) {
    console.log('[Email] Edge function not deployed yet — would send to:', to);
  }
}

/* ═══════════════════════════════════════════════════════════════
   SAVE BOOKING (client portal)
   ═══════════════════════════════════════════════════════════════ */
async function confirmBooking() {
  if (!S.selDepartment) { toast('Please select a department', 'error'); return; }
  if (!S.selDate)       { toast('Please select a date', 'error'); return; }
  if (!S.selSlot)       { toast('Please select a time slot', 'error'); return; }

  const name  = document.getElementById('bk-name').value.trim();
  const phone = document.getElementById('bk-phone').value.trim();
  if (!name || !phone) { toast('Please fill in your name and phone number', 'error'); return; }

  const booking = {
    department_id   : S.selDepartment.id,
    department_name : S.selDepartment.name,
    date            : S.selDate,
    slot            : S.selSlot,
    name            : name,
    phone           : phone,
    email           : S.user.email,
    company         : document.getElementById('bk-id').value,
    reason          : document.getElementById('bk-reason').value,
    source          : 'online',
    status          : 'confirmed',
  };

  const userResult = await _supa.auth.getUser();
  if (userResult.data.user) booking.user_id = userResult.data.user.id;

  const result = await _supa.from('bookings').insert(booking).select().single();
  if (result.error) { toast('Booking failed: ' + result.error.message, 'error'); return; }

  S.appointments.push(Object.assign({}, booking, { id: result.data.id }));

  const emailOn = document.getElementById('notif-email').checked;
  const waOn    = document.getElementById('notif-wa').checked;
  if (emailOn) {
    _sendBookingEmail(Object.assign({}, booking, { departmentName: S.selDepartment.name }), 'booking');
    showEmailPreview(Object.assign({}, booking, { departmentName: S.selDepartment.name }), 'booking');
  }
  if (waOn) toast('💬 WhatsApp confirmation sent to ' + phone, 'info');
  toast('Appointment confirmed! ✓', 'success');

  S.selSlot = null;
  renderSlots();
  renderDashboard();
  renderDepartments();
  setTimeout(function() { showTab('my-appts'); }, 1600);
}

/* ═══════════════════════════════════════════════════════════════
   LOAD BOOKINGS FROM SUPABASE
   ═══════════════════════════════════════════════════════════════ */
async function loadBookings() {
  const result = await _supa.from('bookings').select('*').order('date', { ascending: false });
  if (result.error) { console.error('loadBookings:', result.error.message); return; }
  if (!result.data || !result.data.length) { S.appointments = []; return; }
  S.appointments = result.data.map(function(b) {
    return {
      id             : b.id,
      departmentId   : b.department_id,
      departmentName : b.department_name,
      date           : b.date,
      slot           : b.slot,
      name           : b.name,
      phone          : b.phone,
      email          : b.email,
      company        : b.company || '',
      reason         : b.reason || '',
      source         : b.source || 'online',
      status         : b.status || 'confirmed',
      user_id        : b.user_id || null,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════
   LOAD ALL CLIENT PROFILES FROM SUPABASE (admin use)
   ═══════════════════════════════════════════════════════════════ */
async function loadProfiles() {
  const result = await _supa.from('profiles').select('*').order('full_name', { ascending: true });
  if (result.error) { console.error('loadProfiles:', result.error.message); return; }
  S.profiles = result.data || [];
}

/* ═══════════════════════════════════════════════════════════════
   ADMIN LOGIN — signs into Supabase so RLS policy passes
   ═══════════════════════════════════════════════════════════════ */
const ADMIN_EMAIL = 'melissanell1234@gmail.com'; // must match your RLS policy email

async function doAdminLogin() {
  const pass = document.getElementById('adm-pass').value;
  if (!pass) { toast('Please enter your password', 'error'); return; }

  toast('Signing in...', 'info');

  // Sign in to Supabase so the JWT is set and RLS policy passes
  const { data, error } = await _supa.auth.signInWithPassword({
    email    : ADMIN_EMAIL,
    password : pass,
  });

  if (error) { toast('Login failed: ' + error.message, 'error'); return; }

  // Check the email matches the admin
  if (data.user.email !== ADMIN_EMAIL) {
    await _supa.auth.signOut();
    toast('Unauthorised', 'error');
    return;
  }

  toast('Loading admin data...', 'info');

  // Now authenticated — RLS policy will allow full access
  await loadBookings();
  await loadProfiles();

  S.user     = { name: 'Melissa', email: ADMIN_EMAIL };
  S.userType = 'admin';

  closeModal('admin-login-modal');
  document.getElementById('client-nav').classList.add('hidden');
  document.getElementById('admin-nav').classList.remove('hidden');
  document.getElementById('top-avatar').textContent = 'M';
  document.getElementById('drawer-client').style.display = 'none';
  document.getElementById('drawer-admin').style.display  = 'block';
  showScreen('app');
  renderAdminHome();
  showTab('admin-home');

  // Start live real-time subscriptions so admin sees new data instantly
  _startRealtimeBookings();
  _startRealtimeProfiles();
  _startActivityListeners();
  _resetInactivityTimer();

  toast('Welcome back, Melissa 👋', 'success');
}

/* ═══════════════════════════════════════════════════════════════
   SAVE MANUAL BOOKING (admin portal)
   ═══════════════════════════════════════════════════════════════ */
async function doManualBooking() {
  const name    = document.getElementById('mb-name').value.trim();
  const phone   = document.getElementById('mb-phone').value.trim();
  const docId   = parseInt(document.getElementById('mb-member').value);
  const dateVal = document.getElementById('mb-date').value;
  const slot    = document.getElementById('mb-slot').value;

  if (!name || !phone || !docId || !dateVal) {
    toast('Please fill in all required fields', 'error');
    return;
  }

  const doc = DOCTORS.find(function(d) { return d.id === docId; });
  const booking = {
    department_id   : docId,
    department_name : doc.name,
    date            : dateVal,
    slot            : slot,
    name            : name,
    phone           : phone,
    email           : document.getElementById('mb-email').value,
    company         : '',
    reason          : document.getElementById('mb-reason').value,
    source          : 'phone',
    status          : 'confirmed',
  };

  const result = await _supa.from('bookings').insert(booking).select().single();
  if (result.error) { toast('Booking failed: ' + result.error.message, 'error'); return; }

  S.appointments.push(Object.assign({}, booking, { id: result.data.id, departmentId: docId, departmentName: doc.name }));
  closeModal('manual-book-modal');
  toast('Booking saved for ' + name + ' with ' + doc.name + ' on ' + fmtDate(dateVal) + ' at ' + slot + ' ✓', 'success');
  renderAdminHome();
  renderAdminBookings();
}

/* ═══════════════════════════════════════════════════════════════
   ADMIN CANCEL APPOINTMENT
   ═══════════════════════════════════════════════════════════════ */
async function adminCancelAppt(id) {
  if (!confirm('Cancel this appointment? This cannot be undone.')) return;

  const result = await _supa.from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', id);

  if (result.error) { toast('Cancel failed: ' + result.error.message, 'error'); return; }

  const appt = S.appointments.find(function(a) { return a.id === id; });
  if (appt) appt.status = 'cancelled';

  toast('Appointment for ' + (appt ? appt.name : '') + ' has been cancelled.', 'warn');
  renderAdminHome();
  renderAdminScheduleForDate();
  renderAdminBookings();
}