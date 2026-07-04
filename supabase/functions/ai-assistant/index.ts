// ================================================================
// Edge Function: ai-assistant  ("la stanza di Claude") — TOOL USE
// Claude ha strumenti per consultare in tempo reale tutte le sezioni
// del portale e leggere i documenti (contratto incluso), e per salvare
// bozze di preventivo. Le query interne usano la service_role (mai
// esposta al client); l'accesso è gated dal JWT del chiamante (admin).
// ================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const SYSTEM = `Sei l'assistente operativo di Area62 per le sale immersive Deloitte "Solaria" (Roma e Milano) e "Armonia" (Roma).
Hai STRUMENTI per consultare in tempo reale TUTTE le sezioni del portale (prenotazioni, ticket/anomalie, check mattutini, mail in arrivo, richieste speciali) e per LEGGERE i documenti del repository (contratto e allegati inclusi). Usa gli strumenti ogni volta che servono dati reali: NON dire che puoi analizzare solo ciò che ti viene incollato — puoi interrogare tu stesso il sistema.
Per valutare se una richiesta è coperta dal contratto, consulta i documenti nella categoria "contratti" (contratto principale + allegati: perimetro, periodo di validità, listino prezzi, contenuti creativi). Con list_documents trovi i path, con read_document ne leggi il testo.
Se una richiesta (es. lavoro creativo o gestione app) è FUORI dal perimetro o dal periodo del contratto: dillo chiaramente e — nello STESSO turno — chiama IMMEDIATAMENTE lo strumento save_preventivo (con title e body_html) per creare la bozza. NON limitarti a dire "creo/preparo il preventivo": devi proprio invocare lo strumento, altrimenti la bozza non viene salvata. Tieni l'analisi sintetica per lasciare spazio all'azione.
Rispondi in italiano, conciso e operativo, e basati sui dati reali ottenuti dagli strumenti.`;

const tools = [
  { name: 'get_bookings', description: 'Elenca le prenotazioni sala. Filtri opzionali: from/to (data ISO), room (es. solaria-milano).',
    input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, room: { type: 'string' } } } },
  { name: 'get_tickets', description: 'Elenca le anomalie/ticket. Filtro opzionale status: open | in-progress | resolved.',
    input_schema: { type: 'object', properties: { status: { type: 'string' } } } },
  { name: 'get_checks', description: 'Stato dei check mattutini. Filtri opzionali: date (YYYY-MM-DD), room.',
    input_schema: { type: 'object', properties: { date: { type: 'string' }, room: { type: 'string' } } } },
  { name: 'get_inbox', description: 'Email in arrivo archiviate. Filtro opzionale status: new | handled.',
    input_schema: { type: 'object', properties: { status: { type: 'string' } } } },
  { name: 'get_requests', description: 'Richieste speciali software/hardware dei clienti.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'list_documents', description: 'Elenca i documenti del repository. Filtro opzionale category: contratti | rapporti | preventivi | materiali | altro.',
    input_schema: { type: 'object', properties: { category: { type: 'string' } } } },
  { name: 'read_document', description: 'Legge il testo di un documento dato il suo path (come da list_documents).',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'save_preventivo', description: 'Salva una BOZZA di preventivo nel repository (categoria preventivi) come Non approvato. body_html = SOLO il contenuto interno del preventivo in HTML semplice (paragrafi <p>, elenchi <ul><li>, tabelle <table>): NON includere <html>, <head>, <body> né il titolo (già in intestazione).',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, body_html: { type: 'string' }, richiedente: { type: 'string' } }, required: ['title', 'body_html'] } },
];

const CATS = ['contratti', 'rapporti', 'preventivi', 'materiali', 'altro'];
const slug = (s: string) => (s || 'preventivo').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);

function preventivoHtml(title: string, bodyHtml: string, richiedente?: string) {
  const oggi = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:#fff;">
  <div style="max-width:720px;margin:0 auto;">
    <div style="background:#0d0d0d;padding:16px 26px;display:flex;justify-content:space-between;align-items:center;">
      <span style="color:#86BC25;font-weight:800;font-size:22px;letter-spacing:1px;">AREA62</span>
      <span style="color:#e8e8e8;font-size:12px;">Deloitte · Preventivo</span>
    </div>
    <div style="height:5px;background:#86BC25;"></div>
    <div style="padding:26px;">
      <div style="display:inline-block;background:#fff3cd;color:#8a6d00;border:1px solid #ffe08a;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:700;margin-bottom:14px;">BOZZA · NON APPROVATO</div>
      <h1 style="font-size:20px;margin:0 0 4px;">${title}</h1>
      <div style="color:#888;font-size:13px;margin-bottom:18px;">${oggi}${richiedente ? ' · Richiedente: ' + richiedente : ''} · Area62 S.r.l.</div>
      <div style="font-size:14px;line-height:1.6;">${bodyHtml}</div>
      <div style="margin-top:28px;padding-top:14px;border-top:1px solid #e2e2e2;font-size:12px;color:#888;">
        Bozza generata dall'assistente Area62 · Da rivedere e approvare prima dell'invio al cliente.
      </div>
    </div>
    <div style="padding:14px 26px;background:#0d0d0d;color:#9a9a9a;font-size:11px;">Area62 Srl · Gestione sale immersive Solaria &amp; Armonia · Deloitte · https://rooms.area62.it</div>
  </div>
</body></html>`;
}

async function runTool(admin: any, name: string, input: any) {
  input = input || {};
  if (name === 'get_bookings') {
    let q = admin.from('bookings').select('id,room,title,referente,organizzatore,start_at,end_at,allestimento,creative_support,creative_desc,type,note').order('start_at');
    if (input.from) q = q.gte('start_at', input.from);
    if (input.to) q = q.lte('start_at', input.to);
    if (input.room) q = q.eq('room', input.room);
    const { data } = await q.limit(100); return data || [];
  }
  if (name === 'get_tickets') {
    let q = admin.from('tickets').select('id,room,priority,title,description,category,status,segnalatore,created_at,resolved_at').order('created_at', { ascending: false });
    if (input.status) q = q.eq('status', input.status);
    const { data } = await q.limit(100); return data || [];
  }
  if (name === 'get_checks') {
    let q = admin.from('checks').select('room,date,check_id,state,note').order('date', { ascending: false });
    if (input.date) q = q.eq('date', input.date);
    if (input.room) q = q.eq('room', input.room);
    const { data } = await q.limit(200); return data || [];
  }
  if (name === 'get_inbox') {
    let q = admin.from('inbox').select('from_addr,subject,intent,status,received_at,body').order('received_at', { ascending: false });
    if (input.status) q = q.eq('status', input.status);
    const { data } = await q.limit(50); return data || [];
  }
  if (name === 'get_requests') {
    const { data } = await admin.from('reqspec').select('*').order('created_at', { ascending: false }).limit(100); return data || [];
  }
  if (name === 'list_documents') {
    const prefixes = input.category ? [String(input.category)] : CATS;
    const out: any[] = [];
    for (const p of prefixes) {
      const { data } = await admin.storage.from('documenti').list(p, { limit: 200 });
      for (const o of (data || [])) if (o.id) out.push({ path: `${p}/${o.name}`, name: o.name, size: o.metadata?.size, category: p });
    }
    return out;
  }
  if (name === 'read_document') {
    if (!input.path) return { error: 'path mancante' };
    const { data, error } = await admin.storage.from('documenti').download(`_text/${input.path}.txt`);
    if (error || !data) return { error: 'Testo non disponibile per questo documento (potrebbe essere un\'immagine o un formato non estratto).' };
    const txt = await data.text();
    return { path: input.path, text: txt.slice(0, 60000) };
  }
  if (name === 'save_preventivo') {
    if (!input.title || !input.body_html) return { error: 'title e body_html obbligatori' };
    let bh = String(input.body_html);
    const bm = bh.match(/<body[^>]*>([\s\S]*?)<\/body>/i);   // se arriva un doc completo, tieni solo il body
    if (bm) bh = bm[1];
    bh = bh.replace(/<\/?(?:html|head|body|!doctype)[^>]*>/gi, '');
    const html = preventivoHtml(String(input.title), bh, input.richiedente);
    const path = `preventivi/${Date.now()}_${slug(String(input.title))}.html`;
    const up = await admin.storage.from('documenti').upload(path, new Blob([html], { type: 'text/html' }), { upsert: false, contentType: 'text/html' });
    if (up.error) return { error: up.error.message };
    const { data: s } = await admin.from('app_settings').select('data').eq('id', 'global').maybeSingle();
    const d = s?.data || {};
    d.docApprovals = d.docApprovals || {};
    d.docApprovals[path] = false;
    await admin.from('app_settings').upsert({ id: 'global', data: d, updated_at: new Date().toISOString() });
    return { ok: true, path, stato: 'Non approvato', nota: 'Bozza salvata in Documenti → Preventivi.' };
  }
  return { error: 'strumento sconosciuto: ' + name };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');

    const authHeader = req.headers.get('Authorization') ?? '';
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await caller.auth.getUser();
    if (uErr || !user) return json({ error: 'Non autenticato' }, 401);
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY non configurata nei secret Supabase.', code: 'no_key' }, 200);

    const admin = createClient(url, serviceKey);
    const body = await req.json().catch(() => ({}));
    const context = body.context ?? {};

    let model = 'claude-haiku-4-5';
    try {
      const { data: s } = await caller.from('app_settings').select('data').eq('id', 'global').maybeSingle();
      if (s?.data?.ai?.model) model = String(s.data.ai.model);
    } catch (_) { /* default */ }

    const msgs: any[] = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
      .slice(-16)
      .map((m: any) => ({ role: m.role, content: m.content }));
    if (!msgs.length) return json({ error: 'Nessun messaggio.' }, 400);

    const system = SYSTEM + `\n\nCONTESTO fornito dal portale (indicativo; approfondisci con gli strumenti):\n${JSON.stringify(context).slice(0, 8000)}`;

    let usedTools = false;
    for (let i = 0; i < 6; i++) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 2600, system, tools, messages: msgs }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        return json({ error: `Errore API Claude (${resp.status}): ${t.slice(0, 400)}` }, 200);
      }
      const data = await resp.json();
      msgs.push({ role: 'assistant', content: data.content });

      if (data.stop_reason === 'tool_use') {
        usedTools = true;
        const results: any[] = [];
        for (const block of (data.content || [])) {
          if (block.type === 'tool_use') {
            let result: any;
            try { result = await runTool(admin, block.name, block.input); }
            catch (e) { result = { error: String((e as Error).message || e) }; }
            results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result).slice(0, 90000) });
          }
        }
        msgs.push({ role: 'user', content: results });
        continue;
      }

      const reply = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim() || '(nessuna risposta)';
      return json({ reply, model, usedTools });
    }
    return json({ reply: 'Elaborazione troppo lunga: riprova con una domanda più specifica.', model, usedTools }, 200);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
