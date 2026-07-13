/* ── AUTO-UPDATE (aggira la cache di GitHub Pages) ── */
const APP_BUILD = 44;
(function checkForUpdate() {
  fetch('version.txt?t=' + Date.now(), { cache: 'no-store' })
    .then(r => r.ok ? r.text() : null)
    .then(v => {
      if (!v) return;
      const remote = parseInt(v.trim(), 10);
      if (!remote || remote === APP_BUILD) return;
      const params = new URLSearchParams(location.search);
      if (params.get('b') === String(remote)) return; // già ricaricato per questa build
      params.set('b', remote);
      location.replace(location.pathname + '?' + params.toString());
    })
    .catch(() => {});
})();

/* ── GUARDIA TRANSIZIONE: in produzione serve una sessione Supabase vera ── */
(function enforceSupabaseSession() {
  if (typeof DEMO_MODE === 'undefined' || DEMO_MODE) return;
  try {
    const u = JSON.parse(localStorage.getItem(LS.user));
    const onLogin = location.pathname.endsWith('index.html') || location.pathname.endsWith('/');
    if (u && !u.sb && !onLogin) {
      localStorage.removeItem(LS.user);
      location.replace('index.html');
    }
  } catch {}
})();

/* ── GLOBAL UTILS ── */

function ls(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function lsSet(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
  // write-through su Supabase quando non siamo in demo (definito in db.js)
  if (typeof _syncKey === 'function') _syncKey(key);
}

function toast(msg, type = 'info') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = `toast ${type}`;
  requestAnimationFrame(() => {
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 3000);
  });
}

function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

function formatDate(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatTime(d) {
  const dt = new Date(d);
  return dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}
function formatDateTime(d) { return `${formatDate(d)} ${formatTime(d)}`; }

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ── TEMPLATE EMAIL (coerente col portale: header nero + verde AREA62) ──
function emailTemplate(heading, innerHtml, accent = '#86BC25') {
  return `<div style="background:#f2f2f2;padding:24px 0;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e6e6;">
      <div style="background:#0d0d0d;padding:18px 28px;">
        <span style="color:#86BC25;font-weight:800;font-size:20px;letter-spacing:1px;">AREA62</span>
        <span style="color:#bdbdbd;font-size:12px;"> &nbsp;·&nbsp; Deloitte Room Management</span>
      </div>
      <div style="height:4px;background:${accent};"></div>
      <div style="padding:28px;color:#1a1a1a;font-size:14px;line-height:1.6;">
        <h2 style="margin:0 0 16px;color:#111111;font-size:18px;">${heading}</h2>
        ${innerHtml}
      </div>
      <div style="padding:16px 28px;background:#0d0d0d;color:#8a8a8a;font-size:11px;">
        Area62 Srl · Gestione sale immersive Solaria &amp; Armonia · Deloitte
      </div>
    </div>
  </div>`;
}

// ── MAPPA check → ticket (idempotenza tra checks.html e rapporto.html) ──
// Evita di aprire più ticket per la stessa voce di check nella stessa sessione.
const CHECK_TICKET_MAP = 'dlt_check_ticket_map';
function _ctKey(room, date, session, checkId) { return `${room}#${date}#${session || 1}#${checkId}`; }
function getCheckTicket(room, date, session, checkId) {
  const m = ls(CHECK_TICKET_MAP) || {};
  return m[_ctKey(room, date, session, checkId)] || null;
}
function setCheckTicket(room, date, session, checkId, ticketId) {
  const m = ls(CHECK_TICKET_MAP) || {};
  m[_ctKey(room, date, session, checkId)] = ticketId;
  localStorage.setItem(CHECK_TICKET_MAP, JSON.stringify(m)); // chiave non sincronizzata: nessun push
}

function currentUser() { return ls(LS.user); }

function requireAuth() {
  const u = currentUser();
  if (!u) { window.location.href = 'index.html'; return null; }
  return u;
}

// ── SLA HOURS CALCULATOR ──
function slaHoursLeft(createdAt, targetHours) {
  const now = Date.now();
  const start = new Date(createdAt).getTime();
  const deadline = start + targetHours * 3600000;
  const leftMs = deadline - now;
  const leftH = leftMs / 3600000;
  const pct = Math.max(0, Math.min(100, (leftMs / (targetHours * 3600000)) * 100));
  return { leftH, pct, status: leftH > targetHours * .3 ? 'ok' : leftH > 0 ? 'warn' : 'ko' };
}

function slaLabel(createdAt, targetHours) {
  const { leftH, status } = slaHoursLeft(createdAt, targetHours);
  if (status === 'ko') return { text: 'SCADUTO', cls: 'sla-ko' };
  if (leftH < 1) return { text: `${Math.round(leftH * 60)}min`, cls: 'sla-warn' };
  return { text: `${Math.round(leftH)}h`, cls: `sla-${status}` };
}

// ── RENDER USER IN HEADER ──
function renderUser() {
  const u = currentUser();
  if (!u) return;
  const el = document.getElementById('user-name');
  const av = document.getElementById('user-avatar');
  if (el) el.textContent = u.name;
  if (av) av.textContent = u.avatar;
  // Voce Settings visibile solo agli amministratori
  if (u.role !== 'admin') {
    document.querySelectorAll('.nav-settings').forEach(a => a.style.display = 'none');
  }
  // Voce Assistente in base al permesso (l'admin la vede sempre)
  if (typeof can === 'function' && !can('assistente', 'vedi')) {
    document.querySelectorAll('.nav-assistente').forEach(a => a.style.display = 'none');
  }
}

// ── LOGOUT ──
function logout() {
  localStorage.removeItem(LS.user);
  window.location.href = 'index.html';
}

// ── ACTIVE NAV LINK ──
function markActiveNav() {
  const page = window.location.pathname.split('/').pop();
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === page);
  });
}

// ── SEED DEMO DATA if empty ──
function seedDemoData() {
  if (!ls(LS.bookings)) {
    const today = new Date();
    const bookings = [
      {
        id: genId(), room: 'solaria-roma', title: 'Workshop Design Thinking',
        referente: 'Marco Rossi', organizzatore: 'Laura Bianchi',
        partecipanti: ['Marco Rossi', 'Laura Bianchi', 'Giulia Verdi', 'Antonio Conti'],
        allestimento: ['Microfoni wireless', 'Connessione video', 'Acqua e caffè'],
        start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0).toISOString(),
        end:   new Date(today.getFullYear(), today.getMonth(), today.getDate(), 13, 0).toISOString(),
        note: '', type: 'booking',
      },
      {
        id: genId(), room: 'armonia-roma', title: 'Demo Cliente XYZ',
        referente: 'Federica Marino', organizzatore: 'Presidio Roma',
        partecipanti: ['Federica Marino', 'Cliente XYZ Team'],
        allestimento: ['Setup Armonia AI', 'Scenario Bosco', 'Presentazione'],
        start: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 14, 30).toISOString(),
        end:   new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 17, 0).toISOString(),
        note: '', type: 'booking',
      },
    ];
    lsSet(LS.bookings, bookings);
  }

  if (!ls(LS.maint)) {
    const today = new Date();
    const maint = [
      {
        id: genId(), room: 'solaria-roma', title: 'Manutenzione Ordinaria Q3',
        desc: '4° visita annuale - verifica LED Wall, sistema audio, cablaggio',
        start: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7, 9, 0).toISOString(),
        end:   new Date(today.getFullYear(), today.getMonth(), today.getDate() + 8, 18, 0).toISOString(),
        type: 'maint',
      },
      {
        id: genId(), room: 'armonia-roma', title: 'Aggiornamento Software Armonia',
        desc: 'Aggiornamento firmware Unreal + patch webapp',
        start: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14, 9, 0).toISOString(),
        end:   new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14, 18, 0).toISOString(),
        type: 'maint_prog',
      },
    ];
    lsSet(LS.maint, maint);
  }

  if (!ls(LS.tickets)) {
    const tickets = [
      {
        id: 'TCK-001', room: 'armonia-roma', priority: 'P1',
        title: 'LED Wall spento - Armonia non risponde',
        desc: 'Il LED Wall centrale non si accende. Armonia AI non risponde ai comandi vocali.',
        category: 'hardware', status: 'open',
        segnalatore: 'Presidio Roma',
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
        actions: [],
      },
      {
        id: 'TCK-002', room: 'solaria-roma', priority: 'P2',
        title: 'Condivisione schermo non funzionante',
        desc: 'Da PC Windows non è possibile condividere lo schermo sul LED Wall. Da Mac funziona.',
        category: 'software', status: 'in-progress',
        segnalatore: 'Presidio Roma',
        createdAt: new Date(Date.now() - 7200000).toISOString(),
        updatedAt: new Date(Date.now() - 1800000).toISOString(),
        actions: [
          { ts: new Date(Date.now() - 5400000).toISOString(), user: 'Admin Area62', text: 'Presa in carico. Avviata diagnosi remota.' },
        ],
      },
    ];
    lsSet(LS.tickets, tickets);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderUser();
  markActiveNav();
  if (DEMO_MODE) seedDemoData();  // in produzione i dati arrivano da Supabase

  // Close modals on overlay click
  document.querySelectorAll('.overlay').forEach(ov => {
    ov.addEventListener('click', e => {
      if (e.target === ov) ov.classList.remove('open');
    });
  });

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', logout);
});
