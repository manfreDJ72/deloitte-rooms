// ================================================================
// Edge Function: ai-assistant  ("la stanza di Claude")
// Assistente operativo del portale. Riceve i messaggi della chat e uno
// snapshot di contesto (prenotazioni, ticket, check, inbox), interroga
// l'API Claude e restituisce la risposta.
// La ANTHROPIC_API_KEY è un secret Supabase: NON è mai esposta al client.
// ================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

const SYSTEM_BASE = `Sei l'assistente operativo di Area62 per la gestione delle sale immersive Deloitte "Solaria" (Roma e Milano) e "Armonia" (Roma).
Il tuo compito è tenere sotto controllo prenotazioni, check mattutini, anomalie (ticket) e mail in arrivo alla casella deloitte.room@area62.it.
Segnala con chiarezza cosa non funziona o cosa manca, indica le priorità, e proponi azioni concrete (a chi scrivere, cosa preparare, cosa verificare prima di ogni evento — incluso il materiale creativo richiesto nella prenotazione).
Rispondi in italiano, in modo conciso e operativo, usando elenchi puntati quando aiuta.
Basati SOLO sui dati presenti nel CONTESTO qui sotto: se un'informazione non c'è, dillo esplicitamente invece di inventarla.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');

    // 1) Solo utenti autenticati (evita abusi/costi sulla API key)
    const authHeader = req.headers.get('Authorization') ?? '';
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await caller.auth.getUser();
    if (uErr || !user) return json({ error: 'Non autenticato' }, 401);

    if (!apiKey) {
      return json({ error: 'ANTHROPIC_API_KEY non configurata nei secret Supabase.', code: 'no_key' }, 200);
    }

    const body = await req.json().catch(() => ({}));
    const clientMsgs = Array.isArray(body.messages) ? body.messages : [];
    const context = body.context ?? {};

    // 2) Modello dai Settings (fallback: haiku)
    let model = 'claude-haiku-4-5';
    try {
      const { data: s } = await caller.from('app_settings').select('data').eq('id', 'global').maybeSingle();
      if (s?.data?.ai?.model) model = String(s.data.ai.model);
    } catch (_) { /* usa il default */ }

    // 3) Prepara messaggi (solo role/content validi) e prompt di sistema col contesto
    const messages = clientMsgs
      .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
      .slice(-20)
      .map((m: any) => ({ role: m.role, content: m.content }));
    if (!messages.length) return json({ error: 'Nessun messaggio.' }, 400);

    const system = `${SYSTEM_BASE}\n\n=== CONTESTO (dati attuali del portale) ===\n${JSON.stringify(context).slice(0, 24000)}`;

    // 4) Chiama l'API Claude
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens: 1024, system, messages }),
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      return json({ error: `Errore API Claude (${resp.status}): ${errTxt.slice(0, 400)}` }, 200);
    }
    const data = await resp.json();
    const reply = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim()
      || '(nessuna risposta)';
    return json({ reply, model });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
