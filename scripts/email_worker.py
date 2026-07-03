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
def send_mail(to_addrs, subject, html):
    if isinstance(to_addrs, str): to_addrs = [to_addrs]
    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = f'Deloitte Room Management <{MAIL_USER}>'
    msg['To'] = ', '.join(to_addrs)
    msg.attach(MIMEText(html, 'html'))
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL(SMTP_HOST, 465, context=ctx, timeout=40) as s:
        s.login(MAIL_USER, MAIL_PASS)
        s.sendmail(MAIL_USER, to_addrs, msg.as_string())

# ── PARSER PRENOTAZIONE ──
def parse_booking(subject, body):
    text = (subject or '') + '\n' + (body or '')
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
    for m in re.finditer(r'(\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4}|\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})', low):
        d = dateparser.parse(m.group(1), languages=['it'], settings={'PREFER_DATES_FROM': 'future'})
        if d: break
    # scarta date implausibili (anno fuori range → falso positivo)
    if d:
        yr = time.gmtime().tm_year
        if d.year < yr or d.year > yr + 2:
            d = None
    ref = None
    rm = re.search(r'referente[:\s]+([A-Za-zÀ-ÿ\'\. ]+)', text, re.I)
    if rm: ref = rm.group(1).strip().split('.')[0].strip()
    ev = None
    em = re.search(r'evento[:\s]+([A-Za-zÀ-ÿ0-9\'\. ]+)', text, re.I)
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
            conf = f"""<div style="font-family:sans-serif">
              <h2 style="color:#86BC25">✓ Prenotazione registrata</h2>
              <p>Abbiamo registrato la tua richiesta:</p>
              <table style="font-size:14px">
                <tr><td><b>Sala:</b></td><td>{label}</td></tr>
                <tr><td><b>Data:</b></td><td>{p['date']}</td></tr>
                <tr><td><b>Orario:</b></td><td>{p['start'] or '09:00'} – {p['end'] or '10:00'}</td></tr>
                <tr><td><b>Referente:</b></td><td>{p['referente'] or '—'}</td></tr>
                <tr><td><b>Evento:</b></td><td>{p['title']}</td></tr>
              </table>
              <p style="color:#888;font-size:12px">Area62 · Deloitte Room Management</p></div>"""
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
        try:
            send_mail(to, row['subject'], row.get('html') or row.get('subject'))
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
