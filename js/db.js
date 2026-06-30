/* ── DATA ACCESS LAYER ──
   DEMO_MODE=true  → localStorage (istantaneo)
   DEMO_MODE=false → Supabase (async reale)
*/

let _sb = null;

function _initSb() {
  if (_sb || DEMO_MODE) return;
  if (typeof supabase !== 'undefined') {
    _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
}

const db = {

  /* ── AUTH ─────────────────────────────────── */

  async signIn(email, password) {
    if (DEMO_MODE) {
      const u = DEMO_USERS.find(u => u.email === email && u.password === password);
      if (!u) throw new Error('Credenziali non valide');
      const sess = { id: u.id, email: u.email, name: u.name, role: u.role, avatar: u.avatar };
      lsSet(LS.user, sess);
      return sess;
    }
    _initSb();
    const { data, error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    const { data: profile } = await _sb
      .from('profiles')
      .select('name,role,avatar')
      .eq('id', data.user.id)
      .single();
    const sess = {
      id: data.user.id,
      email: data.user.email,
      name: profile?.name || email,
      role: profile?.role || 'user',
      avatar: profile?.avatar || '?',
    };
    lsSet(LS.user, sess);
    return sess;
  },

  async signOut() {
    lsSet(LS.user, null);
    if (!DEMO_MODE && _sb) await _sb.auth.signOut();
    window.location.href = 'index.html';
  },

  /* ── BOOKINGS ──────────────────────────────── */

  async getBookings() {
    if (DEMO_MODE) return ls(LS.bookings) || [];
    _initSb();
    const { data, error } = await _sb.from('bookings').select('*').order('start_at');
    if (error) { console.error('db.getBookings', error); return ls(LS.bookings) || []; }
    return data.map(_bFromDb);
  },

  async saveBooking(booking) {
    if (DEMO_MODE) {
      const list = ls(LS.bookings) || [];
      const idx = list.findIndex(b => b.id === booking.id);
      if (idx >= 0) list[idx] = booking; else list.push(booking);
      lsSet(LS.bookings, list);
      return booking;
    }
    _initSb();
    const { data, error } = await _sb.from('bookings').upsert(_bToDb(booking)).select().single();
    if (error) throw error;
    return _bFromDb(data);
  },

  async deleteBooking(id) {
    if (DEMO_MODE) {
      lsSet(LS.bookings, (ls(LS.bookings) || []).filter(b => b.id !== id));
      return;
    }
    _initSb();
    await _sb.from('bookings').delete().eq('id', id);
  },

  /* ── TICKETS ───────────────────────────────── */

  async getTickets() {
    if (DEMO_MODE) return ls(LS.tickets) || [];
    _initSb();
    const { data, error } = await _sb
      .from('tickets')
      .select('*, ticket_actions(*)')
      .order('created_at', { ascending: false });
    if (error) { console.error('db.getTickets', error); return ls(LS.tickets) || []; }
    return data.map(_tFromDb);
  },

  async saveTicket(ticket) {
    if (DEMO_MODE) {
      const list = ls(LS.tickets) || [];
      const idx = list.findIndex(t => t.id === ticket.id);
      if (idx >= 0) list[idx] = ticket; else list.unshift(ticket);
      lsSet(LS.tickets, list);
      return ticket;
    }
    _initSb();
    const { actions, ...row } = _tToDb(ticket);
    const { error } = await _sb.from('tickets').upsert(row);
    if (error) throw error;
    if (ticket.actions?.length) {
      const acts = ticket.actions.map(a => ({
        id: a.id || genId(),
        ticket_id: ticket.id,
        ts: a.ts,
        user_name: a.user,
        text: a.text,
      }));
      await _sb.from('ticket_actions').upsert(acts, { ignoreDuplicates: true });
    }
    return ticket;
  },

  /* ── CHECK STATE ───────────────────────────── */

  async getCheckState(room, date) {
    const key = `${LS.checks}_${room}_${date}`;
    if (DEMO_MODE) return ls(key) || {};
    _initSb();
    const { data } = await _sb.from('checks').select('*').eq('room', room).eq('date', date);
    if (!data?.length) return {};
    const state = {};
    data.forEach(r => {
      state[r.check_id] = {
        state: r.state, ts: r.ts, failTs: r.fail_ts,
        note: r.note, fixApplied: r.fix_applied, open: false,
      };
    });
    return state;
  },

  async saveCheckState(room, date, checkId, checkData) {
    const key = `${LS.checks}_${room}_${date}`;
    if (DEMO_MODE) {
      const state = ls(key) || {};
      state[checkId] = checkData;
      lsSet(key, state);
      return;
    }
    _initSb();
    await _sb.from('checks').upsert({
      room, date, check_id: checkId,
      state: checkData.state,
      ts: checkData.ts,
      fail_ts: checkData.failTs,
      note: checkData.note,
      fix_applied: checkData.fixApplied,
    }, { onConflict: 'room,date,check_id' });
  },

  /* ── MAINTENANCE ───────────────────────────── */

  async getMaintenance() {
    if (DEMO_MODE) return ls(LS.maint) || [];
    _initSb();
    const { data } = await _sb.from('maintenance').select('*').order('start_at');
    return (data || []).map(r => ({
      id: r.id, room: r.room, title: r.title, desc: r.desc,
      start: r.start_at, end: r.end_at, type: r.type,
    }));
  },

};

/* ── MAPPERS ─────────────────────────────────── */

function _bToDb(b) {
  return {
    id: b.id, room: b.room, title: b.title,
    referente: b.referente, organizzatore: b.organizzatore,
    partecipanti: b.partecipanti, allestimento: b.allestimento,
    start_at: b.start, end_at: b.end, note: b.note, type: b.type,
  };
}
function _bFromDb(r) {
  return {
    id: r.id, room: r.room, title: r.title,
    referente: r.referente, organizzatore: r.organizzatore,
    partecipanti: r.partecipanti || [],
    allestimento: r.allestimento || [],
    start: r.start_at, end: r.end_at, note: r.note, type: r.type,
  };
}
function _tToDb(t) {
  return {
    id: t.id, room: t.room, priority: t.priority, title: t.title,
    description: t.desc, category: t.category, status: t.status,
    segnalatore: t.segnalatore,
    created_at: t.createdAt, updated_at: t.updatedAt,
    resolved_at: t.resolvedAt, sla_respected: t.slaRespected,
    from_rapporto: t.fromRapporto, note_residue: t.noteResidue,
    actions: t.actions,
  };
}
function _tFromDb(r) {
  return {
    id: r.id, room: r.room, priority: r.priority, title: r.title,
    desc: r.description, category: r.category, status: r.status,
    segnalatore: r.segnalatore,
    createdAt: r.created_at, updatedAt: r.updated_at,
    resolvedAt: r.resolved_at, slaRespected: r.sla_respected,
    fromRapporto: r.from_rapporto, noteResidue: r.note_residue,
    actions: (r.ticket_actions || []).map(a => ({
      id: a.id, ts: a.ts, user: a.user_name, text: a.text,
    })),
  };
}
