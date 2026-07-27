// ============================================================
// Sto Bene — Client (auth Supabase + chiamate edge functions)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CFG = window.STOBENE_CONFIG || {};
if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
  document.body.innerHTML = `
    <div style="padding:32px;font-family:sans-serif;max-width:520px;margin:40px auto">
      <h1 style="color:#dc2626">Configurazione mancante</h1>
      <p>Serve impostare <code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code>
      in <code>config.js</code>. Vedi <code>config.example.js</code>.</p>
    </div>`;
  throw new Error('Missing Supabase config');
}

const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

const NOTIF_TAG = 'stobene-daily-reminder';
const NOTIF_DAYS_AHEAD = 30;

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let currentProfile = null;

// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}
function fmtTime(d) { return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }
function fmtDateShort(d) {
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (isSameDay(d, today))     return `oggi alle ${fmtTime(d)}`;
  if (isSameDay(d, yesterday)) return `ieri alle ${fmtTime(d)}`;
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) + ` alle ${fmtTime(d)}`;
}
function nextOccurrence(hour, minute, from = new Date()) {
  const d = new Date(from);
  d.setHours(hour, minute, 0, 0);
  if (d <= from) d.setDate(d.getDate() + 1);
  return d;
}
function normalizePhone(v) { return (v || '').replace(/[^\d+]/g, ''); }
function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; }
function showScreen(id) {
  ['screen-loading','screen-auth','screen-setup','screen-main','screen-history']
    .forEach((s) => $('#' + s)?.classList.toggle('hidden', s !== id));
}
function showError(el, text) {
  el.textContent = text; el.classList.remove('hidden');
}
function clearMsg(...els) {
  els.forEach((e) => { e.textContent = ''; e.classList.add('hidden'); });
}

// ------------------------------------------------------------
// AUTH
// ------------------------------------------------------------
function bindAuth() {
  const tabs = $$('.tab');
  const submit = $('#auth-submit');
  const passLabel = () => $$('.field')[1].querySelector('span');
  let mode = 'login';

  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    mode = t.dataset.tab;
    submit.textContent = mode === 'login' ? 'Entra' : 'Crea account';
    $('#auth-password').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
    clearMsg($('#auth-error'), $('#auth-info'));
  }));

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg($('#auth-error'), $('#auth-info'));
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;

    submit.disabled = true;
    const oldText = submit.textContent;
    submit.textContent = mode === 'login' ? 'Accesso…' : 'Creazione…';

    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await bootLoggedIn();
      } else {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        // Se conferma email è attiva, l'utente riceve link e non è ancora loggato
        if (!data.session) {
          $('#auth-info').textContent = 'Ti abbiamo mandato una email di conferma. Aprila e clicca sul link, poi torna qui per entrare.';
          $('#auth-info').classList.remove('hidden');
        } else {
          await bootLoggedIn();
        }
      }
    } catch (err) {
      showError($('#auth-error'), traduciErroreAuth(err));
    } finally {
      submit.disabled = false;
      submit.textContent = oldText;
    }
  });
}
function traduciErroreAuth(err) {
  const m = String(err?.message || err);
  if (/invalid login credentials/i.test(m))  return 'Email o password non corretti.';
  if (/user already registered/i.test(m))    return 'Account già esistente — usa "Entra".';
  if (/password.*weak/i.test(m))             return 'Password troppo debole (almeno 6 caratteri).';
  if (/email.*invalid/i.test(m))             return 'Email non valida.';
  return 'Errore: ' + m;
}

// ------------------------------------------------------------
// SETUP form
// ------------------------------------------------------------
function bindSetup() {
  const methodInputs = $$('input[name="method"]');
  function refreshMethodFields() {
    const m = document.querySelector('input[name="method"]:checked').value;
    $('#field-phone').classList.toggle('hidden', m === 'email');
    $('#f-contact-phone').required = (m !== 'email');
  }
  methodInputs.forEach((r) => r.addEventListener('change', refreshMethodFields));

  $('#f-contact-name').addEventListener('input', (e) => {
    const msg = $('#f-message');
    const cn = e.target.value.trim();
    if (!msg.dataset.userEdited) {
      msg.value = cn ? `Ciao ${cn}, sto bene! ❤️` : 'Sto bene! ❤️';
    }
  });
  $('#f-message').addEventListener('input', (e) => { e.target.dataset.userEdited = '1'; });

  $('#setup-back').addEventListener('click', () => showScreen('screen-main'));

  $('#setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg($('#setup-error'));
    const method = document.querySelector('input[name="method"]:checked').value;
    const payload = {
      name: $('#f-name').value.trim(),
      contact_name: $('#f-contact-name').value.trim(),
      contact_email: $('#f-contact-email').value.trim().toLowerCase(),
      contact_phone: normalizePhone($('#f-contact-phone').value),
      method,
      message_template: $('#f-message').value.trim()
        || `Ciao ${$('#f-contact-name').value.trim()}, sto bene! ❤️`,
      reminder_time: $('#f-time').value,
      alert_after_min: Number($('#f-alert-min').value),
      reminder_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome',
    };

    const user = (await sb.auth.getUser()).data.user;
    const { data, error } = await sb.from('profiles')
      .update(payload).eq('user_id', user.id)
      .select().single();
    if (error) { showError($('#setup-error'), 'Salvataggio fallito: ' + error.message); return; }
    currentProfile = data;
    await requestNotificationPermission();
    await scheduleDailyNotifications(currentProfile);
    goToMain();
  });
}
function fillSetupFromProfile(p) {
  $('#f-name').value = p.name || '';
  $('#f-contact-name').value = p.contact_name || '';
  $('#f-contact-email').value = p.contact_email || '';
  $('#f-contact-phone').value = p.contact_phone || '';
  document.querySelector(`input[name="method"][value="${p.method || 'email'}"]`).checked = true;
  $('#f-message').value = p.message_template || '';
  if (p.message_template) $('#f-message').dataset.userEdited = '1';
  $('#f-time').value = p.reminder_time?.slice(0, 5) || '10:00';
  $('#f-alert-min').value = String(p.alert_after_min || 60);
  document.querySelector('input[name="method"]:checked').dispatchEvent(new Event('change'));
}

// ------------------------------------------------------------
// MAIN
// ------------------------------------------------------------
async function goToMain() {
  showScreen('screen-main');
  $('#greet-name').textContent = currentProfile.name || '';
  await refreshMainState();
}

async function refreshMainState() {
  updateNextReminderLabel(currentProfile);
  updateHints();
  const lastToday = await getLastCheckinToday();
  applyButtonState(!!lastToday);
  updateLastCheckLabel(lastToday);
}

async function getLastCheckinToday() {
  const user = (await sb.auth.getUser()).data.user;
  const start = new Date(); start.setHours(0,0,0,0);
  const { data } = await sb.from('checkins')
    .select('at, method_used, email_sent, email_error')
    .eq('user_id', user.id)
    .gte('at', start.toISOString())
    .order('at', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

function applyButtonState(done) {
  const btn = $('#big-button');
  btn.classList.toggle('done', !!done);
  btn.classList.toggle('pulse', !done);
  document.body.classList.toggle('done', !!done);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', done ? '#16a34a' : '#f97316');
}
function updateLastCheckLabel(lastToday) {
  const el = $('#last-check');
  if (!lastToday) {
    el.textContent = 'Non hai ancora fatto il check-in oggi.';
    el.classList.remove('done');
    return;
  }
  const t = fmtTime(new Date(lastToday.at));
  const suffix = lastToday.email_sent === false ? ' — email FALLITA' : '';
  el.textContent = `✓ Fatto oggi alle ${t}${suffix}`;
  el.classList.add('done');
}
function updateNextReminderLabel(profile) {
  const [h, m] = (profile.reminder_time || '10:00').split(':').map(Number);
  const next = nextOccurrence(h, m);
  const dLabel = isSameDay(next, new Date()) ? 'oggi' : 'domani';
  $('#next-reminder').textContent = `${dLabel} alle ${fmtTime(next)}`;
}
function updateHints() {
  const notifSupported = 'Notification' in window;
  const perm = notifSupported ? Notification.permission : 'unsupported';
  $('#perm-hint').classList.toggle('hidden', !notifSupported || perm === 'granted');

  const triggersSupported = supportsNotificationTriggers();
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                     || window.navigator.standalone === true;
  const showIosHint = !triggersSupported && (isIOS() || !isStandalone);
  $('#ios-hint').classList.toggle('hidden', !showIosHint);
  if (showIosHint && currentProfile) {
    $('#ios-time').textContent = currentProfile.reminder_time?.slice(0, 5) || '10:00';
  }
}

function bindMain() {
  $('#big-button').addEventListener('click', onBigButton);
  $('#btn-settings').addEventListener('click', () => {
    fillSetupFromProfile(currentProfile);
    $('#setup-back').classList.remove('hidden');
    showScreen('screen-setup');
  });
  $('#btn-history').addEventListener('click', showHistory);
  $('#btn-perm').addEventListener('click', async () => {
    await requestNotificationPermission();
    await scheduleDailyNotifications(currentProfile);
    updateHints();
  });
}

// ------------------------------------------------------------
// BOTTONE PRINCIPALE
// ------------------------------------------------------------
async function onBigButton() {
  const btn = $('#big-button');
  const message = currentProfile.message_template || `Ciao ${currentProfile.contact_name || ''}, sto bene! ❤️`;

  if (navigator.vibrate) navigator.vibrate([25, 40, 80]);
  btn.classList.remove('tapping'); void btn.offsetWidth;
  btn.classList.add('tapping');
  requestAnimationFrame(() => applyButtonState(true));

  const minDelay = new Promise((r) => setTimeout(r, 700));
  const send = doCheckin(message).catch((e) => ({ error: e }));

  const [result] = await Promise.all([send, minDelay]);
  const err = result?.error || result?.email?.sent === false;
  showOverlay(err ? '⚠️ Email non inviata — controlla lo storico' : 'Messaggio inviato');
  if (err) console.warn('checkin outcome:', result);

  setTimeout(() => btn.classList.remove('tapping'), 100);
  await refreshMainState();
}

async function doCheckin(message) {
  const method = currentProfile.method;

  // Per WhatsApp/SMS: apri app nativa + registra checkin (senza email)
  if (method === 'whatsapp' || method === 'sms') {
    // Registriamo il checkin server-side (senza inviare email)
    const cRes = await invokeSendCheckin({ method, message });
    // Poi apriamo il canale nativo
    const encoded = encodeURIComponent(message);
    const num = normalizePhone(currentProfile.contact_phone).replace(/^\+/, '');
    setTimeout(() => {
      if (method === 'whatsapp') {
        window.location.href = `https://wa.me/${num}?text=${encoded}`;
      } else {
        window.location.href = `sms:${'+' + num}${isIOS() ? '&' : '?'}body=${encoded}`;
      }
    }, 400);
    return cRes;
  }

  // Email: la function fa DB insert + invio Resend
  return await invokeSendCheckin({ method: 'email', message });
}

async function invokeSendCheckin(body) {
  const { data: sessData } = await sb.auth.getSession();
  const token = sessData?.session?.access_token;
  if (!token) throw new Error('Non sei loggato');

  const url = `${CFG.SUPABASE_URL}/functions/v1/send-checkin`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function showOverlay(text) {
  const o = $('#overlay');
  const label = o.querySelector('.overlay-card p');
  if (label && text) label.textContent = text;
  o.classList.remove('hidden');
  setTimeout(() => o.classList.add('hidden'), 1600);
}

// ------------------------------------------------------------
// STORICO
// ------------------------------------------------------------
async function showHistory() {
  showScreen('screen-history');
  const list = $('#history-list');
  list.innerHTML = '<p class="empty">Caricamento…</p>';
  const user = (await sb.auth.getUser()).data.user;
  const { data, error } = await sb.from('checkins')
    .select('*')
    .eq('user_id', user.id)
    .order('at', { ascending: false })
    .limit(60);
  if (error) { list.innerHTML = `<p class="empty">Errore: ${error.message}</p>`; return; }
  if (!data.length) { list.innerHTML = '<p class="empty">Nessun check-in ancora.</p>'; return; }

  list.innerHTML = data.map((c) => {
    const d = new Date(c.at);
    const dateStr = d.toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'short' });
    const timeStr = fmtTime(d);
    let statusHtml = '';
    if (c.method_used === 'email') {
      if (c.email_sent === true) {
        statusHtml = `<span class="badge ok">✓ Email inviata</span>`;
      } else if (c.email_sent === false) {
        statusHtml = `<span class="badge err">✗ ${escapeHtml(c.email_error || 'Email fallita')}</span>`;
      }
    } else {
      statusHtml = `<span class="badge ok">${c.method_used.toUpperCase()}</span>`;
    }
    return `<div class="history-item">
      <div class="history-item-main">
        <div class="hi-date">${dateStr}</div>
        <div class="hi-time">${timeStr}</div>
      </div>
      <div class="history-item-status">${statusHtml}</div>
    </div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function bindHistory() {
  $('#history-back').addEventListener('click', () => showScreen('screen-main'));
  $('#btn-logout').addEventListener('click', async () => {
    await sb.auth.signOut();
    currentProfile = null;
    showScreen('screen-auth');
  });
}

// ------------------------------------------------------------
// NOTIFICHE locali (reminder giornaliero)
// ------------------------------------------------------------
async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied')  return 'denied';
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}
function supportsNotificationTriggers() {
  return 'Notification' in window && 'TimestampTrigger' in window && 'serviceWorker' in navigator;
}
async function scheduleDailyNotifications(profile) {
  if (!supportsNotificationTriggers()) return;
  if (Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  try {
    const existing = await reg.getNotifications({ includeTriggered: true, tag: NOTIF_TAG });
    existing.forEach((n) => n.close());
  } catch {}
  const [h, m] = String(profile.reminder_time || '10:00').split(':').map(Number);
  const first = nextOccurrence(h, m);
  for (let i = 0; i < NOTIF_DAYS_AHEAD; i++) {
    const when = new Date(first); when.setDate(first.getDate() + i);
    try {
      await reg.showNotification('Sto Bene — è il momento del check-in', {
        tag: `${NOTIF_TAG}-${i}`,
        body: 'Un tap sul bottone per dire che stai bene ❤️',
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        // eslint-disable-next-line no-undef
        showTrigger: new TimestampTrigger(when.getTime()),
        data: { url: location.href },
      });
    } catch (e) { console.warn('trigger fallito', e); break; }
  }
}

// ------------------------------------------------------------
// SERVICE WORKER
// ------------------------------------------------------------
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('sw.js'); }
  catch (e) { console.warn('SW registration failed', e); }
}

// ------------------------------------------------------------
// BOOTSTRAP
// ------------------------------------------------------------
async function bootLoggedIn() {
  const user = (await sb.auth.getUser()).data.user;
  if (!user) { showScreen('screen-auth'); return; }
  // fetch profile
  const { data: profile, error } = await sb.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
  if (error) { alert('Errore caricamento profilo: ' + error.message); return; }
  currentProfile = profile;
  const isConfigured = !!(profile?.name && profile?.contact_email);
  if (!isConfigured) {
    $('#setup-back').classList.add('hidden');
    fillSetupFromProfile(profile || {});
    showScreen('screen-setup');
  } else {
    await goToMain();
    scheduleDailyNotifications(profile);
  }
}

async function boot() {
  bindAuth(); bindSetup(); bindMain(); bindHistory();
  await registerSW();
  const { data: sess } = await sb.auth.getSession();
  if (sess?.session) await bootLoggedIn();
  else showScreen('screen-auth');
}

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') showScreen('screen-auth');
});

document.addEventListener('DOMContentLoaded', boot);
