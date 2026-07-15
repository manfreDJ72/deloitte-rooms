// ============================================================
// Sto Bene — semplice PWA di check-in giornaliero
// ============================================================

const STORAGE_KEY = 'stobene.settings.v1';
const HISTORY_KEY = 'stobene.history.v1';
const NOTIF_TAG   = 'stobene-daily-reminder';
const NOTIF_DAYS_AHEAD = 30;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ------------------------------------------------------------
// Persistenza impostazioni
// ------------------------------------------------------------
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  catch { return null; }
}
function saveSettings(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}
function pushHistory(entry) {
  const h = loadHistory();
  h.unshift(entry);
  // manteniamo massimo 100 voci
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 100)));
}

// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}
function fmtTime(d) {
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}
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
function normalizePhone(v) {
  // rimuove spazi/trattini, tiene leading + e cifre
  return (v || '').replace(/[^\d+]/g, '');
}
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

// ------------------------------------------------------------
// SETUP screen
// ------------------------------------------------------------
function bindSetup() {
  const form = $('#setup-form');
  const method = () => document.querySelector('input[name="method"]:checked').value;

  function updateMethodFields() {
    const m = method();
    $('#field-phone').classList.toggle('hidden', m === 'email');
    $('#field-email').classList.toggle('hidden', m !== 'email');
    $('#f-phone').required = (m !== 'email');
    $('#f-email').required = (m === 'email');
  }
  $$('input[name="method"]').forEach(r => r.addEventListener('change', updateMethodFields));
  updateMethodFields();

  // Auto-riempimento messaggio quando cambia il nome del contatto
  $('#f-contact-name').addEventListener('input', (e) => {
    const msg = $('#f-message');
    const cn = e.target.value.trim();
    if (!msg.dataset.userEdited) {
      msg.value = cn ? `Ciao ${cn}, sto bene! ❤️` : 'Sto bene! ❤️';
    }
  });
  $('#f-message').addEventListener('input', (e) => {
    e.target.dataset.userEdited = '1';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = method();
    const settings = {
      name: $('#f-name').value.trim(),
      contactName: $('#f-contact-name').value.trim(),
      method: m,
      phone: normalizePhone($('#f-phone').value),
      email: $('#f-email').value.trim(),
      message: $('#f-message').value.trim() || `Ciao ${$('#f-contact-name').value.trim()}, sto bene! ❤️`,
      reminderTime: $('#f-time').value || '10:00',
      createdAt: new Date().toISOString(),
    };
    saveSettings(settings);
    await requestNotificationPermission();
    await scheduleDailyNotifications(settings);
    showMain(settings);
  });
}

function fillSetupFromSettings(s) {
  $('#f-name').value = s.name || '';
  $('#f-contact-name').value = s.contactName || '';
  document.querySelector(`input[name="method"][value="${s.method}"]`).checked = true;
  $('#f-phone').value = s.phone || '';
  $('#f-email').value = s.email || '';
  $('#f-message').value = s.message || '';
  $('#f-message').dataset.userEdited = '1';
  $('#f-time').value = s.reminderTime || '10:00';
  // rerun visibility
  const evt = new Event('change');
  document.querySelector('input[name="method"]:checked').dispatchEvent(evt);
}

// ------------------------------------------------------------
// MAIN screen
// ------------------------------------------------------------
function showMain(settings) {
  $('#screen-setup').classList.add('hidden');
  $('#screen-main').classList.remove('hidden');

  $('#greet-name').textContent = settings.name;

  updateLastCheckLabel();
  updateNextReminderLabel(settings);
  updateHints();

  const btn = $('#big-button');
  const alreadyToday = wasCheckedToday();
  applyButtonState(alreadyToday);

  btn.onclick = () => onBigButton(settings);
  $('#btn-settings').onclick = () => {
    fillSetupFromSettings(settings);
    $('#screen-main').classList.add('hidden');
    $('#screen-setup').classList.remove('hidden');
  };
  $('#btn-perm').onclick = async () => {
    await requestNotificationPermission();
    await scheduleDailyNotifications(settings);
    updateHints();
  };
  $('#btn-install').onclick = triggerInstall;
}

function applyButtonState(done) {
  const btn = $('#big-button');
  btn.classList.toggle('done', !!done);
  btn.classList.toggle('pulse', !done);
  document.body.classList.toggle('done', !!done);
  // theme-color della status bar mobile
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', done ? '#16a34a' : '#f97316');
}

function wasCheckedToday() {
  const h = loadHistory();
  if (!h.length) return false;
  return isSameDay(new Date(h[0].at), new Date());
}
function updateLastCheckLabel() {
  const el = $('#last-check');
  const h = loadHistory();
  const today = new Date();
  if (!h.length) {
    el.textContent = 'Non hai ancora fatto il check-in oggi.';
    el.classList.remove('done');
    return;
  }
  const last = new Date(h[0].at);
  if (isSameDay(last, today)) {
    el.textContent = `✓ Fatto oggi alle ${fmtTime(last)}`;
    el.classList.add('done');
  } else {
    el.textContent = 'Ultimo check-in: ' + fmtDateShort(last);
    el.classList.remove('done');
  }
}
function updateNextReminderLabel(settings) {
  const [h, m] = (settings.reminderTime || '10:00').split(':').map(Number);
  const next = nextOccurrence(h, m);
  const dLabel = isSameDay(next, new Date()) ? 'oggi' : 'domani';
  $('#next-reminder').textContent = `${dLabel} alle ${fmtTime(next)}`;
}
function updateHints() {
  const permHint = $('#perm-hint');
  const iosHint  = $('#ios-hint');
  const installHint = $('#install-hint');

  const notifSupported = 'Notification' in window;
  const perm = notifSupported ? Notification.permission : 'unsupported';
  permHint.classList.toggle('hidden', !notifSupported || perm === 'granted');

  const triggersSupported = supportsNotificationTriggers();
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                     || window.navigator.standalone === true;
  // Se non supporta trigger e (iOS OR non installata) → suggerisci sveglia
  const showIosHint = !triggersSupported && (isIOS() || !isStandalone);
  iosHint.classList.toggle('hidden', !showIosHint);
  if (showIosHint) {
    const s = loadSettings();
    $('#ios-time').textContent = s ? s.reminderTime : '10:00';
  }

  installHint.classList.toggle('hidden', !window.__stoBeneInstallPrompt || isStandalone);
}

// ------------------------------------------------------------
// Bottone principale: invia messaggio
// ------------------------------------------------------------
async function onBigButton(settings) {
  const btn = $('#big-button');
  const now = new Date();
  const msg = settings.message || `Ciao ${settings.contactName}, sto bene! ❤️`;

  // Registra localmente
  pushHistory({ at: now.toISOString() });

  // Feedback tattile
  if (navigator.vibrate) navigator.vibrate([25, 40, 80]);

  // Animazione: onda + transizione arancione → verde
  btn.classList.remove('tapping'); void btn.offsetWidth; // reset animation
  btn.classList.add('tapping');
  requestAnimationFrame(() => applyButtonState(true));

  updateLastCheckLabel();

  // Delay minimo così l'animazione ha tempo di completarsi
  const minDelay = new Promise((r) => setTimeout(r, 700));
  const send = openChannel(settings, msg).catch((e) => ({ error: e }));

  const [result] = await Promise.all([send, minDelay]);
  const isError = result && result.error;
  showOverlay(isError ? '⚠️ Invio fallito — riprova' : 'Messaggio inviato');
  if (isError) console.warn('openChannel error', result.error);

  setTimeout(() => btn.classList.remove('tapping'), 100);
}

async function openChannel(settings, message) {
  const encoded = encodeURIComponent(message);

  if (settings.method === 'whatsapp') {
    const num = normalizePhone(settings.phone).replace(/^\+/, '');
    window.location.href = `https://wa.me/${num}?text=${encoded}`;
    return { ok: true, via: 'whatsapp' };
  }

  if (settings.method === 'sms') {
    const num = normalizePhone(settings.phone);
    window.location.href = `sms:${num}${isIOS() ? '&' : '?'}body=${encoded}`;
    return { ok: true, via: 'sms' };
  }

  // EMAIL: invia lato server via /api/send (Vercel + Resend);
  // se la function non risponde (es. deploy solo statico), fallback a mailto:
  const subject = `Sto bene${settings.name ? ` — ${settings.name}` : ''}`;
  try {
    const r = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: settings.email,
        message,
        senderName: settings.name,
        subject,
      }),
    });
    if (r.ok) {
      return { ok: true, via: 'api' };
    }
    const err = await r.json().catch(() => ({}));
    // Errori 4xx (dati sbagliati / recipient non ammesso) → non ha senso fare mailto fallback
    if (r.status >= 400 && r.status < 500) {
      throw new Error(err.error || `HTTP ${r.status}`);
    }
    throw new Error(err.error || `HTTP ${r.status}`);
  } catch (e) {
    console.warn('API send failed, fallback a mailto:', e);
    const to = encodeURIComponent(settings.email);
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encoded}`;
    return { ok: true, via: 'mailto', warning: String(e.message || e) };
  }
}

function showOverlay(text) {
  const o = $('#overlay');
  const label = o.querySelector('.overlay-card p');
  if (label && text) label.textContent = text;
  o.classList.remove('hidden');
  setTimeout(() => o.classList.add('hidden'), 1500);
}

// ------------------------------------------------------------
// Notifiche
// ------------------------------------------------------------
async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied')  return 'denied';
  try {
    const p = await Notification.requestPermission();
    return p;
  } catch { return 'denied'; }
}

function supportsNotificationTriggers() {
  return 'Notification' in window
      && 'TimestampTrigger' in window
      && 'serviceWorker' in navigator;
}

async function scheduleDailyNotifications(settings) {
  if (!supportsNotificationTriggers()) return;
  if (Notification.permission !== 'granted') return;

  const reg = await navigator.serviceWorker.ready;
  // cancella precedenti (dello stesso tag)
  try {
    const existing = await reg.getNotifications({ includeTriggered: true, tag: NOTIF_TAG });
    existing.forEach(n => n.close());
  } catch { /* browsers vecchi ignorano l'opzione */ }

  const [h, m] = settings.reminderTime.split(':').map(Number);
  const now = new Date();
  const first = nextOccurrence(h, m, now);
  const body = 'Un tap sul bottone per dire che stai bene ❤️';

  for (let i = 0; i < NOTIF_DAYS_AHEAD; i++) {
    const when = new Date(first);
    when.setDate(first.getDate() + i);
    try {
      await reg.showNotification('Sto Bene — è il momento del check-in', {
        tag: `${NOTIF_TAG}-${i}`,
        body,
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        // eslint-disable-next-line no-undef
        showTrigger: new TimestampTrigger(when.getTime()),
        data: { url: location.href },
      });
    } catch (e) {
      console.warn('Impossibile schedulare notifica', when, e);
      break;
    }
  }
}

// ------------------------------------------------------------
// PWA install prompt
// ------------------------------------------------------------
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__stoBeneInstallPrompt = e;
  updateHints();
});
async function triggerInstall() {
  const p = window.__stoBeneInstallPrompt;
  if (!p) return;
  p.prompt();
  await p.userChoice;
  window.__stoBeneInstallPrompt = null;
  updateHints();
}

// ------------------------------------------------------------
// Service Worker
// ------------------------------------------------------------
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('sw.js');
  } catch (e) {
    console.warn('SW registration failed', e);
  }
}

// ------------------------------------------------------------
// Bootstrap
// ------------------------------------------------------------
async function boot() {
  bindSetup();
  await registerSW();

  const s = loadSettings();
  if (s) {
    showMain(s);
    // Rischedula ogni apertura app (garantisce sempre 30 giorni avanti)
    scheduleDailyNotifications(s);
  } else {
    $('#screen-setup').classList.remove('hidden');
  }
}

document.addEventListener('DOMContentLoaded', boot);
