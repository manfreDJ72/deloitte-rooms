// ============================================================
// Sto Bene — Edge Function: send-checkin
// ============================================================
// POST /functions/v1/send-checkin
// Chiamata dal client autenticato quando l'utente preme il bottone.
//   1. Verifica il JWT (l'utente deve essere loggato)
//   2. Legge il profile dell'utente
//   3. Registra un nuovo checkin
//   4. Se method == 'email': manda l'email al contatto via Resend
//   5. Ritorna { ok, checkin, email }
//
// Env vars richieste (Supabase → Project Settings → Edge Functions → Secrets):
//   SUPABASE_URL              (fornita automaticamente)
//   SUPABASE_SERVICE_ROLE_KEY (fornita automaticamente)
//   SUPABASE_ANON_KEY         (fornita automaticamente)
//   RESEND_API_KEY            (da https://resend.com/api-keys)
//   RESEND_FROM               (opzionale, default onboarding@resend.dev)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Missing auth' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Client con JWT dell'utente → per verificare identità
  const sbUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !user) return json({ error: 'Unauthorized', detail: userErr?.message }, 401);

  // Client con service role → per bypassare RLS quando serve
  const sbAdmin = createClient(supabaseUrl, serviceKey);

  // Carica profile
  const { data: profile, error: pErr } = await sbAdmin
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (pErr) return json({ error: 'Profile fetch failed', detail: pErr.message }, 500);
  if (!profile) return json({ error: 'Profile not found — completa prima il setup' }, 400);

  const body = await req.json().catch(() => ({}));
  const method = (body.method || profile.method || 'email') as 'email' | 'whatsapp' | 'sms';
  const message = (body.message || profile.message_template || 'Sto bene! ❤️').toString();

  // Prepara la riga checkin (la scriviamo dopo il tentativo email così tracciamo l'esito)
  let emailSent: boolean | null = null;
  let emailId:   string | null  = null;
  let emailErr:  string | null  = null;

  if (method === 'email') {
    const to = (profile.contact_email || '').trim();
    if (!to) return json({ error: 'contact_email non impostato nel profilo' }, 400);

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return json({ error: 'RESEND_API_KEY non configurata' }, 500);
    const from = Deno.env.get('RESEND_FROM') || 'Sto Bene <onboarding@resend.dev>';

    const subject = `Sto bene${profile.name ? ` — ${profile.name}` : ''}`;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          text: message,
          html: renderEmailHtml(message, profile.name),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        emailSent = true;
        emailId   = data.id ?? null;
      } else {
        emailSent = false;
        emailErr  = data.message || `Resend HTTP ${r.status}`;
      }
    } catch (e) {
      emailSent = false;
      emailErr  = String(e?.message || e);
    }
  }

  // Inserisci checkin
  const { data: checkin, error: iErr } = await sbAdmin
    .from('checkins')
    .insert({
      user_id: user.id,
      method_used: method,
      message,
      email_sent: emailSent,
      email_message_id: emailId,
      email_error: emailErr,
    })
    .select()
    .single();

  if (iErr) return json({ error: 'DB insert failed', detail: iErr.message }, 500);

  return json({
    ok: emailSent !== false, // true se non era email, o se email è andata
    checkin,
    email: method === 'email' ? { sent: emailSent, id: emailId, error: emailErr } : null,
  });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function renderEmailHtml(message: string, senderName?: string | null) {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:18px;line-height:1.5;color:#052e16">
    <p style="margin:0 0 12px">${esc(message)}</p>
    <p style="margin:24px 0 0;color:#78716c;font-size:13px">
      Inviato tramite <strong>Sto Bene</strong>${senderName ? ` — ${esc(senderName)}` : ''}
    </p>
  </div>`;
}
