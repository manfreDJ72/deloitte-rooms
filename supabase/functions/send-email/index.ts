// ================================================================
// Edge Function: send-email
// Invia email dalla casella Area62 via SMTP Aruba (denomailer).
// Credenziali SMTP nei secrets Supabase (mai nel codice).
// Chiamabile solo da utenti autenticati.
// ================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // solo utenti autenticati
    const authHeader = req.headers.get('Authorization') ?? '';
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Non autenticato' }, 401);

    const { to, subject, html, text } = await req.json();
    if (!to || !subject) return json({ error: 'Destinatario e oggetto obbligatori' }, 400);

    const SMTP_USER = Deno.env.get('SMTP_USER');
    const SMTP_PASS = Deno.env.get('SMTP_PASS');
    if (!SMTP_USER || !SMTP_PASS) return json({ error: 'SMTP_USER / SMTP_PASS non configurati nei secrets' }, 500);
    const host = Deno.env.get('SMTP_HOST') || 'smtps.aruba.it';
    const port = Number(Deno.env.get('SMTP_PORT') || '465');
    const from = Deno.env.get('EMAIL_FROM') || `Deloitte Room Management <${SMTP_USER}>`;

    const client = new SMTPClient({
      connection: { hostname: host, port, tls: true, auth: { username: SMTP_USER, password: SMTP_PASS } },
    });
    try {
      await client.send({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        content: text || 'text',
        html: html || undefined,
      });
    } finally {
      try { await client.close(); } catch (_) { /* ignore */ }
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
