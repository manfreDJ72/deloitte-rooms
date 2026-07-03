#!/usr/bin/env python3
# ================================================================
# Email worker — Deloitte Room Management
# Gira su GitHub Actions (cron). Fa due cose:
#   1) OUTBOUND: svuota la coda email (tabella email_queue) via SMTP Aruba
#   2) INBOUND:  legge la casella via IMAP, interpreta le prenotazioni,
#                le crea su Supabase e risponde con la conferma
# Nessun servizio esterno: solo IMAP/SMTP Aruba + REST Supabase.
# ================================================================
import os, re, ssl, json, time, smtplib, imaplib, email, urllib.request, urllib.error
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import dateparser  # gestisce le date in italiano

# ── CONFIG (da variabili d'ambiente, con default per test locale) ──
SB_URL   = os.environ.get('SB_URL', 'https://vepplgeiykrsgkfrbswi.supabase.co')
SB_ANON  = os.environ.get('SB_ANON', 'sb_publishable_ptO60rE97Qv7IpWCEY1bww_FGnd8wG9')
SB_USER  = os.environ.get('SB_USER', 'marco.manfredini@area62.it')
SB_PASS  = os.environ.get('SB_PASS', '151DJmanfre')
MAIL_USER = os.environ.get('MAIL_USER', 'deloitte.room@area62.it')
MAIL_PASS = os.environ.get('MAIL_PASS', '151!DJmanfre')
IMAP_HOST = os.environ.get('IMAP_HOST', 'imaps.aruba.it')
SMTP_HOST = os.environ.get('SMTP_HOST', 'smtps.aruba.it')

ROOM_LABELS = {
    'solaria-roma': 'Solaria – Roma', 'solaria-milano': 'Solaria – Milano',
    'armonia-roma': 'Armonia – Roma',
}

# ── SUPABASE (REST autenticato) ──
def sb_login():
    body = json.dumps({'email': SB_USER, 'password': SB_PASS}).encode()
    req = urllib.request.Request(f'{SB_URL}/auth/v1/token?grant_type=password', data=body,
        headers={'apikey': SB_ANON, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)['access_token']

def sb(method, path, token, payload=None, prefer=None):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {'apikey': SB_ANON, 'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
    if prefer: headers['Prefer'] = prefer
    req = urllib.request.Request(f'{SB_URL}/rest/v1/{path}', data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

# ── SMTP ──
def send_mail(to_addrs, subject, html, attachments=None):
    if isinstance(to_addrs, str): to_addrs = [to_addrs]
    msg = MIMEMultipart('mixed')
    msg['Subject'] = subject
    msg['From'] = f'Deloitte Room Management <{MAIL_USER}>'
    msg['To'] = ', '.join(to_addrs)
    alt = MIMEMultipart('alternative')
    alt.attach(MIMEText(html, 'html'))
    msg.attach(alt)
    # allegati: [{filename, content (base64), mimetype}]
    for a in (attachments or []):
        try:
            import base64
            from email.mime.base import MIMEBase
            from email import encoders
            part = MIMEBase(*(a.get('mimetype', 'application/octet-stream').split('/', 1)))
            part.set_payload(base64.b64decode(a['content']))
            encoders.encode_base64(part)
            part.add_header('Content-Disposition', 'attachment', filename=a.get('filename', 'allegato'))
            msg.attach(part)
        except Exception as e:
            print('allegato saltato:', e)
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL(SMTP_HOST, 465, context=ctx, timeout=40) as s:
        s.login(MAIL_USER, MAIL_PASS)
        s.sendmail(MAIL_USER, to_addrs, msg.as_string())

# ── TEMPLATE EMAIL (coerente col portale) ──
def email_template(heading, inner, accent='#86BC25'):
    return f"""<div style="background:#f2f2f2;padding:24px 0;font-family:Arial,Helvetica,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e6e6;">
        <div style="background:#0d0d0d;padding:18px 28px;">
          <span style="color:#86BC25;font-weight:800;font-size:20px;letter-spacing:1px;">AREA62</span>
          <span style="color:#bdbdbd;font-size:12px;"> &nbsp;·&nbsp; Deloitte Room Management</span>
        </div>
        <div style="height:4px;background:{accent};"></div>
        <div style="padding:28px;color:#1a1a1a;font-size:14px;line-height:1.6;">
          <h2 style="margin:0 0 16px;color:#111111;font-size:18px;">{heading}</h2>
          {inner}
        </div>
        <div style="padding:16px 28px;background:#0d0d0d;color:#8a8a8a;font-size:11px;">
          Area62 Srl · Gestione sale immersive Solaria &amp; Armonia · Deloitte
        </div>
      </div>
    </div>"""

# ── PARSER PRENOTAZIONE ──
def parse_booking(subject, body):
    body = body or ''
    # taglia il contenuto citato/inoltrato (non leggere date/testi di altre email)
    cut = re.search(r'(?im)(inizio messaggio inoltrato|-----\s*original message|^\s*da:\s.*<.*@|^\s*>)', body)
    if cut: body = body[:cut.start()]
    text = (subject or '') + '\n' + body
    low = text.lower()
    room = None
    city = 'milano' if 'milano' in low else 'roma'
    if 'armonia' in low: room = 'armonia-roma'
    elif 'solaria' in low: room = f'solaria-{city}'
    tmatch = re.search(r'dalle?\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:alle?|-|/|â€“|–)\s*(\d{1,2})(?:[:.](\d{2}))?', low)
    start_h = end_h = None
    if tmatch:
        start_h = f"{int(tmatch.group(1)):02d}:{tmatch.group(2) or '00'}"
        end_h   = f"{int(tmatch.group(3)):02d}:{tmatch.group(4) or '00'}"
    d = None
    mesi = 'gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre'
    # accetta: "17 luglio [2026]", "17/07[/2026]", "17-07", "17.07[.2026]" (punto/barra/trattino, anno opzionale)
    for m in re.finditer(rf'(\d{{1,2}}\s+(?:{mesi})(?:\s+\d{{4}})?|\d{{1,2}}[/.\-]\d{{1,2}}(?:[/.\-]\d{{2,4}})?)', low):
        cand = m.group(1).replace('.', '/')  # normalizza il punto (17.07 → 17/07)
        d = dateparser.parse(cand, languages=['it'], settings={'PREFER_DATES_FROM': 'future', 'DATE_ORDER': 'DMY'})
        if d: break
    # scarta date implausibili (anno fuori range → falso positivo)
    if d:
        yr = time.gmtime().tm_year
        if d.year < yr or d.year > yr + 2:
            d = None
    ref = None
    rm = re.search(r'referente[:\-]\s*([A-Za-zÀ-ÿ\'\. ]+)', text, re.I)
    if rm: ref = rm.group(1).strip().split('.')[0].strip()
    ev = None
    em = re.search(r'evento[:\-]\s*([A-Za-zÀ-ÿ0-9\'\. ]+)', text, re.I)
    if em: ev = em.group(1).strip().split('.')[0].strip()
    return {'room': room, 'date': d.strftime('%Y-%m-%d') if d else None,
            'start': start_h, 'end': end_h, 'referente': ref,
            'title': ev or (subject or 'Prenotazione via email')}

def email_text(m):
    if m.is_multipart():
        for p in m.walk():
            if p.get_content_type() == 'text/plain':
                return p.get_payload(decode=True).decode(errors='ignore')
    return (m.get_payload(decode=True) or b'').decode(errors='ignore')

def sender_addr(m):
    return email.utils.parseaddr(m.get('From'))[1]

def gen_id():
    return 'em' + hex(int(time.time()*1000))[2:] + os.urandom(2).hex()

# ── INBOUND: leggi casella, crea prenotazioni, conferma ──
def process_inbound(token):
    M = imaplib.IMAP4_SSL(IMAP_HOST, 993)
    M.login(MAIL_USER, MAIL_PASS)
    M.select('INBOX')
    typ, data = M.search(None, 'UNSEEN')
    ids = data[0].split()
    created = 0
    for i in ids:
        typ, d = M.fetch(i, '(RFC822)')
        m = email.message_from_bytes(d[0][1])
        subj = email.header.make_header(email.header.decode_header(m.get('Subject') or '')).__str__()
        frm = sender_addr(m)
        bodytxt = email_text(m)
        p = parse_booking(subj, bodytxt)
        M.store(i, '+FLAGS', '\\Seen')  # segna letto in ogni caso
        # crea la prenotazione SOLO se: c'è intenzione ("prenot..."), una sala e una data valida
        intent = 'prenot' in (subj + ' ' + bodytxt).lower()
        if not (intent and p['room'] and p['date']):
            continue
        start_iso = f"{p['date']}T{p['start'] or '09:00'}:00"
        end_iso   = f"{p['date']}T{p['end'] or '10:00'}:00"
        booking = {
            'id': gen_id(), 'room': p['room'], 'title': p['title'],
            'referente': p['referente'], 'organizzatore': frm,
            'partecipanti': [], 'allestimento': [],
            'start_at': start_iso, 'end_at': end_iso,
            'note': f'Prenotazione ricevuta via email da {frm}', 'type': 'booking',
        }
        st, res = sb('POST', 'bookings', token, booking, prefer='return=minimal')
        if st in (200, 201):
            created += 1
            label = ROOM_LABELS.get(p['room'], p['room'])
            inner = f"""<p>Abbiamo registrato la tua richiesta di prenotazione:</p>
              <table style="font-size:14px;border-collapse:collapse;margin:12px 0;">
                <tr><td style="padding:3px 14px 3px 0;color:#666;">Sala</td><td><b>{label}</b></td></tr>
                <tr><td style="padding:3px 14px 3px 0;color:#666;">Data</td><td>{p['date']}</td></tr>
                <tr><td style="padding:3px 14px 3px 0;color:#666;">Orario</td><td>{p['start'] or '09:00'} – {p['end'] or '10:00'}</td></tr>
                <tr><td style="padding:3px 14px 3px 0;color:#666;">Referente</td><td>{p['referente'] or '—'}</td></tr>
                <tr><td style="padding:3px 14px 3px 0;color:#666;">Evento</td><td>{p['title']}</td></tr>
              </table>"""
            conf = email_template('✓ Prenotazione registrata', inner)
            try: send_mail(frm, f"Conferma prenotazione — {label} {p['date']}", conf)
            except Exception as e: print('conferma non inviata:', e)
            print(f'  ✓ prenotazione creata da {frm}: {label} {p["date"]} {p["start"]}-{p["end"]}')
        else:
            print(f'  ✗ errore creazione prenotazione: {st} {res}')
    M.logout()
    return created

# ── OUTBOUND: svuota la coda email ──
def process_outbound(token):
    st, rows = sb('GET', "email_queue?status=eq.pending&order=created_at.asc&limit=50", token)
    if st == 404 or not isinstance(rows, list):
        return 0  # tabella non ancora creata
    sent = 0
    for row in rows:
        to = row.get('to_addr')
        if isinstance(to, str):
            try: to = json.loads(to)
            except Exception: to = [to]
        atts = row.get('attachments')
        if isinstance(atts, str):
            try: atts = json.loads(atts)
            except Exception: atts = None
        try:
            send_mail(to, row['subject'], row.get('html') or row.get('subject'), atts)
            sb('PATCH', f"email_queue?id=eq.{row['id']}", token,
               {'status': 'sent', 'sent_at': 'now()'}, prefer='return=minimal')
            sent += 1
        except Exception as e:
            sb('PATCH', f"email_queue?id=eq.{row['id']}", token,
               {'status': 'error', 'error': str(e)[:300]}, prefer='return=minimal')
    return sent

def main():
    token = sb_login()
    out = process_outbound(token)
    inb = process_inbound(token)
    print(f'== worker done == email inviate dalla coda: {out} · prenotazioni create: {inb}')

if __name__ == '__main__':
    main()
