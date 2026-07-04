/* ── DATA ACCESS LAYER ──
   DEMO_MODE=true  → localStorage puro
   DEMO_MODE=false → Supabase con cache localStorage:
     • hydrateAll() al login: scarica tutto da Supabase in localStorage
     • lsSet() fa da write-through: ogni modifica viene spinta su Supabase
   Le pagine continuano a usare ls()/lsSet() senza modifiche.
*/

let _sb = null;
let _hydrating = false;

function _initSb() {
  if (_sb || DEMO_MODE) return;
  if (typeof supabase !== 'undefined') _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/* ── MAPPERS collezione ↔ tabella ──────────────────── */
const _num = s => (s ? new Date(s).toISOString() : null);

const SYNC = {
  [LS.bookings]: {
    table: 'bookings',
    toDb: b => ({
      id:b.id, room:b.room, title:b.title, referente:b.referente, organizzatore:b.organizzatore,
      partecipanti:b.partecipanti||[], allestimento:b.allestimento||[],
      start_at:_num(b.start), end_at:_num(b.end), note:b.note, type:b.type||'booking',
      creative_support:!!b.creativeSupport, creative_desc:b.creativeDesc||null, attachments:b.attachments||[],
    }),
    fromDb: r => ({
      id:r.id, type:r.type||'booking', room:r.room, title:r.title, referente:r.referente, organizzatore:r.organizzatore,
      partecipanti:r.partecipanti||[], allestimento:r.allestimento||[],
      start:r.start_at, end:r.end_at, note:r.note,
      creativeSupport:r.creative_support, creativeDesc:r.creative_desc, attachments:r.attachments||[],
    }),
  },
  [LS.maint]: {
    table: 'maintenance',
    toDb: m => ({ id:m.id, room:m.room, title:m.title, description:m.desc||null, start_at:_num(m.start), end_at:_num(m.end), type:m.type||'maint' }),
    fromDb: r => ({ id:r.id, room:r.room, title:r.title, desc:r.description, start:r.start_at, end:r.end_at, type:r.type }),
  },
  [LS.tickets]: {
    table: 'tickets', hasActions: true,
    toDb: t => ({
      id:t.id, room:t.room, priority:t.priority, title:t.title, description:t.desc||null, category:t.category,
      status:t.status||'open', segnalatore:t.segnalatore, sla_respected:t.slaRespected,
      from_rapporto:!!t.fromRapporto, note_residue:t.noteResidue||null,
      created_at:_num(t.createdAt), updated_at:_num(t.updatedAt), resolved_at:_num(t.resolvedAt),
    }),
    fromDb: r => ({
      id:r.id, room:r.room, priority:r.priority, title:r.title, desc:r.description, category:r.category,
      status:r.status, segnalatore:r.segnalatore, slaRespected:r.sla_respected,
      fromRapporto:r.from_rapporto, noteResidue:r.note_residue,
      createdAt:r.created_at, updatedAt:r.updated_at, resolvedAt:r.resolved_at,
      actions:(r.ticket_actions||[]).map(a=>({id:a.id, ts:a.ts, user:a.user_name, text:a.text})),
    }),
  },
  [LS.meetings]: {
    table: 'meetings',
    toDb: m => ({ id:m.id, date:m.date, partecipanti:m.partecipanti||null, argomenti:m.argomenti||null, tasks:m.tasks||[] }),
    fromDb: r => ({ id:r.id, date:r.date, partecipanti:r.partecipanti, argomenti:r.argomenti, tasks:r.tasks||[] }),
  },
  [LS.reqspec]: {
    table: 'reqspec',
    toDb: q => ({
      id:q.id, num:q.num, tipo:q.tipo, title:q.title, richiedente:q.richiedente, priorita:q.priorita,
      assegnatario:q.assegnatario, descr:q.desc||null, stato:q.stato||'nuova', created_at:_num(q.createdAt),
    }),
    fromDb: r => ({
      id:r.id, num:r.num, tipo:r.tipo, title:r.title, richiedente:r.richiedente, priorita:r.priorita,
      assegnatario:r.assegnatario, desc:r.descr, stato:r.stato, createdAt:r.created_at,
    }),
  },
};

/* ── HYDRATE: Supabase → localStorage (al login) ────── */
async function _fetchCollection(key) {
  const cfg = SYNC[key];
  const sel = cfg.hasActions ? '*, ticket_actions(*)' : '*';
  const { data, error } = await _sb.from(cfg.table).select(sel);
  if (error) throw error;
  return (data || []).map(cfg.fromDb);
}

async function hydrateAll() {
  if (DEMO_MODE) return;
  _initSb();
  _hydrating = true;
  try {
    for (const key of Object.keys(SYNC)) {
      try {
        const remote = await _fetchCollection(key);
        const local = ls(key) || [];
        if (remote.length === 0 && local.length > 0) {
          await _pushCollection(key);              // primo avvio: migra i dati locali su Supabase
        } else {
          localStorage.setItem(key, JSON.stringify(remote)); // scrivo diretto per non ritriggerare il write-through
        }
      } catch (e) { console.error('hydrate', key, e); }
    }
    // impostazioni (destinatari, ruoli, numerazione) — riga singola condivisa
    try {
      const { data } = await _sb.from('app_settings').select('data').eq('id', 'global').maybeSingle();
      if (data && data.data) localStorage.setItem(LS.settings, JSON.stringify(data.data));
    } catch (e) { console.error('hydrate settings', e); }
  } finally { _hydrating = false; }
}

/* ── WRITE-THROUGH: localStorage → Supabase ─────────── */
async function _pushCollection(key) {
  const cfg = SYNC[key];
  if (!cfg || !_sb) return;
  const rows = ls(key) || [];
  try {
    if (rows.length) {
      const { error } = await _sb.from(cfg.table).upsert(rows.map(cfg.toDb));
      if (error) throw error;
    }
    // riconcilia le eliminazioni
    const { data: existing } = await _sb.from(cfg.table).select('id');
    const keep = new Set(rows.map(r => r.id));
    const del = (existing || []).filter(e => !keep.has(e.id)).map(e => e.id);
    if (del.length) await _sb.from(cfg.table).delete().in('id', del);

    // azioni ticket (tabella separata)
    if (cfg.hasActions) {
      const acts = rows.flatMap(t => (t.actions || []).map(a => ({
        id: a.id || genId(), ticket_id: t.id, ts: _num(a.ts) || new Date().toISOString(), user_name: a.user, text: a.text,
      })));
      if (acts.length) await _sb.from('ticket_actions').upsert(acts);
      const { data: exA } = await _sb.from('ticket_actions').select('id');
      const keepA = new Set(acts.map(a => a.id));
      const delA = (exA || []).filter(e => !keepA.has(e.id)).map(e => e.id);
      if (delA.length) await _sb.from('ticket_actions').delete().in('id', delA);
    }
  } catch (e) { console.error('push', key, e); toast('Errore sync con il database', 'error'); }
}

// chiamato da lsSet() in app.js dopo ogni scrittura
function _syncKey(key) {
  if (DEMO_MODE || _hydrating || !SYNC[key]) return;
  _initSb();
  _pushCollection(key);
}

/* ── DB API (usata da alcune pagine) ────────────────── */
const db = {
  hydrateAll,

  async signIn(email, password) {
    if (DEMO_MODE) {
      const roster = (typeof getUsers === 'function' ? getUsers() : []) || [];
      let u = roster.find(x => x.email === email && x.password === password);
      if (!u) u = DEMO_USERS.find(x => x.email === email && x.password === password);
      if (!u) throw new Error('Credenziali non valide');
      const sess = { id: u.id, email: u.email, name: u.name, role: u.role, avatar: u.avatar };
      lsSet(LS.user, sess);
      return sess;
    }
    _initSb();
    const { data, error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email o password non corretti.' : error.message);
    const { data: profile } = await _sb.from('profiles').select('name,role,avatar').eq('id', data.user.id).single();
    const sess = {
      id: data.user.id, email: data.user.email,
      name: profile?.name || email.split('@')[0],
      role: profile?.role || 'operator',
      avatar: profile?.avatar || email.slice(0, 2).toUpperCase(),
      sb: true, // sessione autenticata su Supabase
    };
    localStorage.setItem(LS.user, JSON.stringify(sess));
    return sess;
  },

  async signOut() {
    localStorage.removeItem(LS.user);
    if (!DEMO_MODE && _sb) { try { await _sb.auth.signOut(); } catch {} }
    window.location.href = 'index.html';
  },

  // usate da rapporto.html
  async getTickets() {
    if (DEMO_MODE) return ls(LS.tickets) || [];
    _initSb();
    try { return await _fetchCollection(LS.tickets); }
    catch (e) { console.error(e); return ls(LS.tickets) || []; }
  },
  async saveTicket(ticket) {
    const list = ls(LS.tickets) || [];
    const idx = list.findIndex(t => t.id === ticket.id);
    if (idx >= 0) list[idx] = ticket; else list.unshift(ticket);
    lsSet(LS.tickets, list); // write-through automatico
    return ticket;
  },

  // usate da checks.html
  async getCheckState(room, date) {
    if (DEMO_MODE) {
      const key = `${LS.checks}_${room}_${date}`;
      return ls(key) || {};
    }
    _initSb();
    try {
      const { data } = await _sb.from('checks').select('*').eq('room', room).eq('date', date);
      const state = {};
      (data || []).forEach(r => { state[r.check_id] = { state:r.state, ts:r.ts, failTs:r.fail_ts, note:r.note, fixApplied:r.fix_applied, open:false }; });
      return state;
    } catch (e) { console.error(e); return {}; }
  },
  async saveCheckState(room, date, checkId, d) {
    if (DEMO_MODE) {
      const key = `${LS.checks}_${room}_${date}`;
      const state = ls(key) || {}; state[checkId] = d; lsSet(key, state); return;
    }
    _initSb();
    try {
      await _sb.from('checks').upsert({
        room, date, check_id: checkId, state: d.state, ts: _num(d.ts), fail_ts: _num(d.failTs),
        note: d.note, fix_applied: d.fixApplied,
      }, { onConflict: 'room,date,check_id' });
    } catch (e) { console.error(e); toast('Errore salvataggio check', 'error'); }
  },

  /* ── REPOSITORY DOCUMENTI (Supabase Storage) ── */
  async listDocs(folder) {
    _initSb();
    const { data, error } = await _sb.storage.from('documenti')
      .list(folder, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } });
    if (error) throw error;
    return (data || []).filter(f => f.id); // esclude i placeholder cartella
  },
  async uploadDoc(path, file) {
    _initSb();
    const { error } = await _sb.storage.from('documenti').upload(path, file, { upsert: false });
    if (error) throw error;
  },
  async signedUrl(path, expires = 300) {
    _initSb();
    const { data, error } = await _sb.storage.from('documenti').createSignedUrl(path, expires);
    if (error) throw error;
    return data.signedUrl;
  },
  async deleteDoc(path) {
    _initSb();
    const { error } = await _sb.storage.from('documenti').remove([path]);
    if (error) throw error;
  },

  /* ── EMAIL — accoda su email_queue (il worker GitHub Actions la spedisce via SMTP Aruba) ── */
  async sendEmail(to, subject, html, attachments) {
    if (DEMO_MODE) return { ok: true };
    const toArr = (Array.isArray(to) ? to : [to]).filter(Boolean);
    if (!toArr.length) return { ok: true, skipped: true };  // nessun destinatario → non accodare
    _initSb();
    const row = { to_addr: toArr, subject, html };
    if (attachments && attachments.length) row.attachments = attachments;
    const { error } = await _sb.from('email_queue').insert(row);
    if (error) throw new Error(error.message);
    return { ok: true, queued: true };
  },

  // invia una notifica ai destinatari configurati per un dato evento (best-effort)
  async notify(eventKey, subject, html) {
    if (DEMO_MODE) return;
    try {
      const s = (typeof getSettings === 'function') ? getSettings() : null;
      const recips = (s?.emailRecipients || [])
        .filter(r => r.email && (r.events || []).includes(eventKey))
        .map(r => r.email);
      const to = [...new Set(recips)];
      if (!to.length) return;
      await this.sendEmail(to, subject, html);
    } catch (e) { console.error('notify', eventKey, e); }
  },

  /* ── GESTIONE UTENTI (Edge Function, solo admin) ── */
  async adminUsers(action, payload = {}) {
    _initSb();
    const { data, error } = await _sb.functions.invoke('manage-user', { body: { action, ...payload } });
    if (error) {
      let msg = error.message || 'Errore funzione';
      try { const ctx = await error.context.json(); if (ctx.error) msg = ctx.error; } catch {}
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  },

  /* ── IMPOSTAZIONI (riga singola su app_settings) ── */
  async getAppSettings() {
    if (DEMO_MODE) return null;
    _initSb();
    const { data, error } = await _sb.from('app_settings').select('data').eq('id', 'global').maybeSingle();
    if (error) { console.error('getAppSettings', error); return null; }
    return data?.data || null;
  },
  async saveAppSettings(settings) {
    if (DEMO_MODE) return;
    _initSb();
    const { error } = await _sb.from('app_settings')
      .upsert({ id: 'global', data: settings, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  },

  /* ── RAPPORTI DI INTERVENTO (workflow a 3 livelli) ── */
  async getRapporti() {
    if (DEMO_MODE) return ls('dlt_rapporti') || [];
    _initSb();
    const { data, error } = await _sb.from('rapporti').select('*').order('created_at', { ascending: false });
    if (error) { console.error('getRapporti', error); return []; }
    return (data || []).map(r => ({
      id: r.id, num: r.num, room: r.room, area: r.area, componente: r.componente,
      descrizione: r.descrizione, priority: r.priority, tecnico: r.tecnico,
      status: r.status, stages: r.stages || {}, openedAt: r.opened_at, closedAt: r.closed_at, pdfPath: r.pdf_path,
    }));
  },
  async saveRapporto(r) {
    if (DEMO_MODE) {
      const list = ls('dlt_rapporti') || [];
      const i = list.findIndex(x => x.id === r.id);
      if (i >= 0) list[i] = r; else list.unshift(r);
      lsSet('dlt_rapporti', list);
      return r;
    }
    _initSb();
    const row = {
      id: r.id, num: r.num, room: r.room, area: r.area, componente: r.componente,
      descrizione: r.descrizione, priority: r.priority, tecnico: r.tecnico, status: r.status,
      stages: r.stages, opened_at: r.openedAt, closed_at: r.closedAt, pdf_path: r.pdfPath,
    };
    const { error } = await _sb.from('rapporti').upsert(row);
    if (error) throw new Error(error.message);
    return r;
  },

  /* ── INBOX (email archiviate dal worker) ── */
  async getInbox(limit = 50) {
    if (DEMO_MODE) return ls('dlt_inbox') || [];
    _initSb();
    const { data, error } = await _sb.from('inbox')
      .select('*').order('received_at', { ascending: false }).limit(limit);
    if (error) { console.error('getInbox', error); return []; }
    return data || [];
  },
  async setInboxStatus(id, status) {
    if (DEMO_MODE) return;
    _initSb();
    const { error } = await _sb.from('inbox').update({ status }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async getChecksKO(date) {
    if (DEMO_MODE) return [];
    _initSb();
    const { data, error } = await _sb.from('checks').select('*').eq('date', date).eq('state', 'ko');
    if (error) { console.error('getChecksKO', error); return []; }
    return data || [];
  },
  async setDocApproval(path, approved) {
    if (DEMO_MODE) return;
    _initSb();
    const { data } = await _sb.from('app_settings').select('data').eq('id', 'global').maybeSingle();
    const d = (data && data.data) || {};
    d.docApprovals = d.docApprovals || {};
    d.docApprovals[path] = !!approved;
    const { error } = await _sb.from('app_settings').upsert({ id: 'global', data: d, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  },

  /* ── ASSISTENTE AI (Edge Function ai-assistant → API Claude) ── */
  async aiChat(messages, context) {
    _initSb();
    const { data, error } = await _sb.functions.invoke('ai-assistant', { body: { messages, context } });
    if (error) {
      let msg = error.message || 'Errore assistente';
      try { const ctx = await error.context.json(); if (ctx.error) msg = ctx.error; } catch {}
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;  // { reply }
  },
};
