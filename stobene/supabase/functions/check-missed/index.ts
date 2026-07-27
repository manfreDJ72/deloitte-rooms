// ============================================================
// Sto Bene — Edge Function: check-missed
// ============================================================
// GET/POST /functions/v1/check-missed
// Chiamata periodicamente da pg_cron (o cron esterno).
// Per ogni utente:
//   * calcola "l'ora locale corrente" nel suo timezone
//   * se ora locale >= reminder_time + alert_after_min minuti
//   * e non ci sono checkin oggi (giorno locale)
//   * e non abbiamo già inviato un'allerta oggi
//   → manda una email di allerta al contact_email e registra su missed_alerts
//
// Chi la può chiamare: solo con service_role o con header segreto CRON_SECRET.
// (pg_cron usa service_role.)
//
// Env vars richieste (Supabase → Edge Functions → Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (automatiche)
//   RESEND_API_KEY, RESEND_FROM             (per l'email di allerta)
//   CRON_SECRET                             (per invocazioni esterne opzionali)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-cron-secret, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // Autorizzazione: service_role oppure header CRON_SECRET
  const auth = req.headers.get('Authorization') || '';
  const cronSecret = req.headers.get('x-cron-secret') || '';
  const expectedCronSecret = Deno.env.get('CRON_SECRET') || '';
  const isCron = expectedCronSecret && cronSecret && cronSecret === expectedCronSecret;
  const isServiceRole = auth.startsWith('Bearer ') &&
    auth.slice(7) === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!isCron && !isServiceRole) {
    return json({ error: 'Unauthorized (need service_role or CRON_SECRET)' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(supabaseUrl, serviceKey);

  // Prendi tutti i profili
  const { data: profiles, error: pErr } = await sb
    .from('profiles')
    .select('user_id, name, contact_name, contact_email, reminder_time, reminder_timezone, alert_after_min');

  if (pErr) return json({ error: 'profiles fetch failed', detail: pErr.message }, 500);

  const results: unknown[] = [];
  const nowUtc = new Date();

  for (const p of profiles ?? []) {
    if (!p.contact_email) { results.push({ user_id: p.user_id, skipped: 'no contact_email' }); continue; }

    const tz = p.reminder_timezone || 'Europe/Rome';
    const local = toLocalParts(nowUtc, tz);
    const [h, m] = String(p.reminder_time || '10:00').split(':').map(Number);
    const cutoffMin = h * 60 + m + Number(p.alert_after_min || 60);
    const nowMin    = local.hour * 60 + local.minute;

    if (nowMin < cutoffMin) {
      results.push({ user_id: p.user_id, skipped: 'not yet past cutoff', now_local: `${local.hour}:${local.minute}`, cutoff_min: cutoffMin });
      continue;
    }

    // Il giorno "locale" è YYYY-MM-DD nel tz dell'utente
    const localDay = local.ymd;

    // Ha già un check-in oggi?
    const { data: todayChecks, error: cErr } = await sb.rpc('count_checkins_on_local_day', {
      p_user_id: p.user_id,
      p_local_day: localDay,
    });
    if (cErr) {
      // Fallback senza RPC: filtro via query
      const dayStart = new Date(`${localDay}T00:00:00`);
      const dayEnd   = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
      const { count } = await sb
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', p.user_id)
        .gte('at', dayStart.toISOString())
        .lt('at', dayEnd.toISOString());
      if ((count ?? 0) > 0) {
        results.push({ user_id: p.user_id, skipped: 'has checkin today (fallback)' });
        continue;
      }
    } else if ((todayChecks as number) > 0) {
      results.push({ user_id: p.user_id, skipped: 'has checkin today' });
      continue;
    }

    // Allerta già inviata oggi?
    const { data: existingAlert } = await sb
      .from('missed_alerts')
      .select('id')
      .eq('user_id', p.user_id)
      .eq('for_local_day', localDay)
      .maybeSingle();
    if (existingAlert) {
      results.push({ user_id: p.user_id, skipped: 'alert already sent today' });
      continue;
    }

    // Manda l'allerta
    const emailRes = await sendAlertEmail({
      to: p.contact_email,
      userName: p.name || 'Il tuo caro',
      contactName: p.contact_name || null,
      localDay,
      cutoffHM: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    });

    // Registra
    const { error: iErr } = await sb.from('missed_alerts').insert({
      user_id: p.user_id,
      for_local_day: localDay,
      contact_email: p.contact_email,
      email_message_id: emailRes.id,
      email_error: emailRes.error,
    });

    results.push({
      user_id: p.user_id,
      alerted: emailRes.ok,
      email_id: emailRes.id,
      error: emailRes.error,
      insert_error: iErr?.message,
    });
  }

  return json({ ran_at: nowUtc.toISOString(), processed: results.length, results });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function toLocalParts(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(d).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value; return acc;
  }, {});
  return {
    ymd:    `${parts.year}-${parts.month}-${parts.day}`,
    hour:   Number(parts.hour),
    minute: Number(parts.minute),
  };
}

async function sendAlertEmail(opts: {
  to: string;
  userName: string;
  contactName: string | null;
  localDay: string;
  cutoffHM: string;
}): Promise<{ ok: boolean; id: string | null; error: string | null }> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return { ok: false, id: null, error: 'RESEND_API_KEY missing' };
  const from = Deno.env.get('RESEND_FROM') || 'Sto Bene <onboarding@resend.dev>';

  const subject = `⚠️ ${opts.userName} non ha ancora fatto il check-in oggi`;
  const greeting = opts.contactName ? `Ciao ${opts.contactName},` : 'Ciao,';
  const html = `
    <div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:16px;line-height:1.5;color:#1c1917;max-width:520px">
      <p style="margin:0 0 12px">${greeting}</p>
      <p style="margin:0 0 12px">
        <strong>${escapeHtml(opts.userName)}</strong> non ha ancora premuto il bottone
        <em>Sto Bene</em> oggi (${opts.localDay}).
        L'orario del promemoria era le <strong>${opts.cutoffHM}</strong>.
      </p>
      <p style="margin:0 0 12px">
        Potrebbe essere niente — magari ha dimenticato di aprire l'app.
        Ma se ti sembra strano, prova a chiamare per sicurezza.
      </p>
      <p style="margin:24px 0 0;color:#78716c;font-size:13px">
        Ricevi questa email perché sei il contatto d'emergenza di ${escapeHtml(opts.userName)} su Sto Bene.
      </p>
    </div>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [opts.to], subject, html }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, id: null, error: data.message || `Resend HTTP ${r.status}` };
  return { ok: true, id: data.id ?? null, error: null };
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
