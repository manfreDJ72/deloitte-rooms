// ============================================================
// Sto Bene — Serverless function per invio email via Resend
// Deploy: Vercel (Root Directory = stobene/)
// Endpoint: POST /api/send
//   body: { to, message, senderName?, subject? }
// Env vars richieste:
//   RESEND_API_KEY       — API key da https://resend.com/api-keys
//   RESEND_FROM          — Mittente verificato (es. "Sto Bene <ciao@tuodominio.it>")
//                          Se non impostata usa il sandbox onboarding@resend.dev
//                          (funziona solo verso l'email del tuo account Resend)
//   ALLOWED_RECIPIENT    — (opzionale) email destinatario/i ammesso/i,
//                          separati da virgola. Se vuota accetta chiunque.
// ============================================================

export default async function handler(req, res) {
  // CORS di cortesia (Vercel serve sotto lo stesso host, ma non fa male)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string'
    ? safeParse(req.body)
    : (req.body || {});
  const to = (body.to || '').trim().toLowerCase();
  const message = (body.message || '').trim();
  const senderName = (body.senderName || '').trim();
  const subject = (body.subject || `Sto bene${senderName ? ` — ${senderName}` : ''}`).trim();

  if (!to || !message) {
    return res.status(400).json({ error: 'Missing "to" or "message"' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return res.status(400).json({ error: 'Invalid recipient email' });
  }

  // Allowlist (protegge da abuso della function pubblica)
  const allowRaw = process.env.ALLOWED_RECIPIENT || '';
  const allow = allowRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.includes(to)) {
    return res.status(403).json({ error: 'Recipient not in allowlist' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Sto Bene <onboarding@resend.dev>';
  if (!apiKey) {
    return res.status(500).json({ error: 'Server not configured: missing RESEND_API_KEY' });
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text: message,
        // A pretty HTML version
        html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:18px;line-height:1.5;color:#052e16">
                 <p style="margin:0 0 12px">${escapeHtml(message)}</p>
                 <p style="margin:24px 0 0;color:#78716c;font-size:13px">
                   Inviato da <strong>Sto Bene</strong>${senderName ? ` — ${escapeHtml(senderName)}` : ''}
                 </p>
               </div>`,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('Resend error', r.status, data);
      return res.status(502).json({ error: data.message || `Resend HTTP ${r.status}` });
    }
    return res.status(200).json({ id: data.id, ok: true });
  } catch (e) {
    console.error('send failed', e);
    return res.status(500).json({ error: 'Send failed', detail: String(e.message || e) });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
