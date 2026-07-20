#!/usr/bin/env python3
# ================================================================
# Email worker — Deloitte Room Management
# Gira su GitHub Actions (cron). Fa due cose:
#   1) OUTBOUND: svuota la coda email (tabella email_queue) via SMTP Aruba
#   2) INBOUND:  legge la casella via IMAP, interpreta le prenotazioni,
#                le crea su Supabase e risponde con la conferma
# Nessun servizio esterno: solo IMAP/SMTP Aruba + REST Supabase.
# ================================================================
import os, re, ssl, json, time, datetime, smtplib, imaplib, email, urllib.request, urllib.error, urllib.parse
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
try:
    from zoneinfo import ZoneInfo
except Exception:
    ZoneInfo = None

import dateparser  # gestisce le date in italiano

# ── CONFIG (SOLO da variabili d'ambiente / secret; nessuna password nel codice) ──
SB_URL   = os.environ.get('SB_URL', 'https://vepplgeiykrsgkfrbswi.supabase.co')
SB_ANON  = os.environ.get('SB_ANON', 'sb_publishable_ptO60rE97Qv7IpWCEY1bww_FGnd8wG9')  # publishable (già pubblica lato client)
SB_USER  = os.environ.get('SB_USER', 'automation@area62.it')
SB_PASS  = os.environ.get('SB_PASS', '')      # ← da secret GitHub, mai in chiaro
MAIL_USER = os.environ.get('MAIL_USER', 'deloitte.room@area62.it')
MAIL_PASS = os.environ.get('MAIL_PASS', '')   # ← da secret GitHub, mai in chiaro
IMAP_HOST = os.environ.get('IMAP_HOST', 'imaps.aruba.it')
SMTP_HOST = os.environ.get('SMTP_HOST', 'smtps.aruba.it')
# Relay SMTP dedicato (Brevo) — IP puliti, niente 554. Attivo SOLO se il secret è presente.
BREVO_USER = os.environ.get('BREVO_SMTP_USER', '')
BREVO_KEY  = os.environ.get('BREVO_SMTP_KEY', '')
USE_BREVO  = bool(BREVO_KEY)

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
    except Exception as e:
        return 0, str(e)  # rete/URL/timeout: mai far crashare il worker

# ── SMTP ──
def send_mail(to_addrs, subject, html, attachments=None, in_reply_to=None):
    if isinstance(to_addrs, str): to_addrs = [to_addrs]
    msg = MIMEMultipart('mixed')
    msg['Subject'] = subject
    msg['From'] = f'Deloitte Room Management <{MAIL_USER}>'
    msg['To'] = ', '.join(to_addrs)
    if in_reply_to:
        msg['In-Reply-To'] = in_reply_to
        msg['References'] = in_reply_to
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

    def _send_aruba():
        with smtplib.SMTP_SSL(SMTP_HOST, 465, context=ctx, timeout=40) as s:
            s.login(MAIL_USER, MAIL_PASS)
            s.sendmail(MAIL_USER, to_addrs, msg.as_string())

    # Prova prima Brevo (IP puliti); se fallisce (es. 535 credenziali) RIPIEGA su Aruba,
    # così una config Brevo errata non blocca mai l'invio.
    if USE_BREVO:
        try:
            with smtplib.SMTP('smtp-relay.brevo.com', 587, timeout=40) as s:
                s.starttls(context=ctx)
                s.login(BREVO_USER, BREVO_KEY)
                s.sendmail(MAIL_USER, to_addrs, msg.as_string())
            return
        except Exception as e:
            print('  Brevo non disponibile, fallback su Aruba:', str(e)[:120])
    _send_aruba()

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

# ── ASSISTENTE AI (riusa la Edge Function ai-assistant, key lato Supabase) ──
FUNC_URL = f'{SB_URL}/functions/v1/ai-assistant'

def ai_reply(token, user_text, context):
    """Chiama ai-assistant col JWT del worker. Ritorna il testo della risposta o None."""
    payload = json.dumps({'messages': [{'role': 'user', 'content': user_text}], 'context': context}).encode()
    req = urllib.request.Request(FUNC_URL, data=payload, method='POST',
        headers={'apikey': SB_ANON, 'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode() or '{}')
        if data.get('reply'):
            return data['reply']
        print('  ai_reply: nessuna reply →', str(data)[:150])
    except Exception as e:
        print('  ai_reply errore:', e)
    return None

def get_assistant_config(token):
    cfg = {'autoReply': True, 'digest': True, 'digestHour': 18, 'digestTo': 'marco.manfredini@area62.it'}
    st, rows = sb('GET', "app_settings?id=eq.global&select=data", token)
    try:
        if isinstance(rows, list) and rows:
            a = (rows[0].get('data') or {}).get('assistant') or {}
            for k in cfg:
                if k in a: cfg[k] = a[k]
    except Exception as e:
        print('assistant config fallback:', e)
    return cfg

def should_autoreply(frm, m):
    low = (frm or '').lower()
    if not low or '@' not in low: return False
    if any(k in low for k in ('no-reply', 'noreply', 'no_reply', 'donotreply', 'do-not-reply',
                              'mailer-daemon', 'postmaster', 'bounce', 'notifications@', 'notify@')):
        return False
    if MAIL_USER.lower() in low: return False                       # niente auto-risposte a sé stesso
    if (m.get('Auto-Submitted') or '').lower() not in ('', 'no'): return False
    if (m.get('Precedence') or '').lower() in ('bulk', 'list', 'junk'): return False
    if m.get('List-Unsubscribe'): return False                     # newsletter/liste
    return True

def md_to_html(t):
    out, in_ul = [], False
    for raw in (t or '').split('\n'):
        ln = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', raw.strip())
        h = re.match(r'^(#{1,4})\s+(.*)', ln)
        if h:
            if in_ul: out.append('</ul>'); in_ul = False
            out.append(f'<h3 style="font-size:14px;margin:14px 0 6px;">{h.group(2)}</h3>')
            continue
        m = re.match(r'^(?:[-*•]|\d+[.)])\s+(.*)', ln)
        if m:
            if not in_ul: out.append('<ul style="margin:6px 0;padding-left:20px;">'); in_ul = True
            out.append(f'<li>{m.group(1)}</li>')
        else:
            if in_ul: out.append('</ul>'); in_ul = False
            if ln: out.append(f'<p style="margin:8px 0;">{ln}</p>')
    if in_ul: out.append('</ul>')
    return ''.join(out)

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

def parse_date_header(raw):
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(raw)
        return dt.isoformat() if dt else None
    except Exception:
        return None

def classify_intent(text):
    low = (text or '').lower()
    if 'prenot' in low:
        return 'booking'
    if any(k in low for k in ('richiesta', 'software', 'hardware', 'guasto', 'anomalia', 'intervento')):
        return 'richiesta'
    return 'altro'

# ── INBOUND: leggi casella, ARCHIVIA tutto, crea prenotazioni, conferma ──
def process_inbound(token):
    M = imaplib.IMAP4_SSL(IMAP_HOST, 993)
    M.login(MAIL_USER, MAIL_PASS)
    M.select('INBOX')
    typ, data = M.search(None, 'UNSEEN')
    ids = data[0].split()
    created = 0
    archived = 0
    replied = 0
    # config assistente + contesto per le risposte AI (sale + prenotazioni prossime)
    ACFG = get_assistant_config(token)
    st, ups = sb('GET', f"bookings?start_at=gte.{datetime.datetime.now(datetime.timezone.utc).isoformat()}&order=start_at.asc&limit=30", token)
    REPLY_CTX = {
        'sale': list(ROOM_LABELS.values()),
        'prenotazioni_prossime': [{'sala': ROOM_LABELS.get(b['room'], b['room']), 'quando': b['start_at'], 'titolo': b.get('title')}
                                  for b in (ups if isinstance(ups, list) else [])],
    }
    for i in ids:
        typ, d = M.fetch(i, '(RFC822)')
        m = email.message_from_bytes(d[0][1])
        subj = email.header.make_header(email.header.decode_header(m.get('Subject') or '')).__str__()
        frm = sender_addr(m)
        bodytxt = email_text(m)
        msg_id = (m.get('Message-ID') or '').strip() or f'noid-{gen_id()}'
        recv_at = parse_date_header(m.get('Date'))
        intent = classify_intent(subj + ' ' + bodytxt)
        p = parse_booking(subj, bodytxt)
        M.store(i, '+FLAGS', '\\Seen')  # segna letto in ogni caso

        # 1) crea la prenotazione SOLO se: intenzione ("prenot..."), una sala e una data valida
        linked = None
        if intent == 'booking' and p['room'] and p['date']:
            start_iso = f"{p['date']}T{p['start'] or '09:00'}:00"
            end_iso   = f"{p['date']}T{p['end'] or '10:00'}:00"
            bid = gen_id()
            booking = {
                'id': bid, 'room': p['room'], 'title': p['title'],
                'referente': p['referente'], 'organizzatore': frm,
                'partecipanti': [], 'allestimento': [],
                'start_at': start_iso, 'end_at': end_iso,
                'note': f'Prenotazione ricevuta via email da {frm}', 'type': 'booking',
            }
            st, res = sb('POST', 'bookings', token, booking, prefer='return=minimal')
            if st in (200, 201):
                created += 1
                linked = bid
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

        # 2) ARCHIVIA SEMPRE la mail in inbox (dedup su message_id)
        inbox_row = {
            'id': gen_id(), 'message_id': msg_id, 'from_addr': frm,
            'subject': subj, 'body': (bodytxt or '')[:8000], 'received_at': recv_at,
            'direction': 'in', 'intent': ('booking' if linked else intent),
            'linked_booking_id': linked, 'status': ('handled' if linked else 'new'),
        }
        st, _ = sb('POST', 'inbox?on_conflict=message_id', token, inbox_row,
                   prefer='return=minimal,resolution=ignore-duplicates')
        if st in (200, 201): archived += 1

        # 3) RISPOSTA AUTOMATICA AI se NON è stata creata una prenotazione
        #    (domande, richieste, o prenotazioni incomplete da completare)
        if linked is None and ACFG.get('autoReply') and should_autoreply(frm, m):
            prompt = (
                "Sei l'assistente della casella che gestisce le sale immersive Deloitte 'Solaria' (Roma e Milano) "
                "e 'Armonia' (Roma). Un utente ha scritto questa email. Scrivi SOLO il corpo di una risposta email "
                "in italiano, professionale e breve. Se sembra una richiesta di prenotazione ma mancano dati, chiedi "
                "gentilmente sala, data e orario. Se puoi rispondere con le informazioni nel contesto, fallo; "
                "altrimenti conferma la presa in carico e che un referente ricontatterà a breve. Non inventare nulla, "
                "non scrivere oggetto o intestazioni. NON aggiungere firma finale né saluti di chiusura "
                "(tipo 'Cordiali saluti'): la firma viene aggiunta automaticamente.\n\n"
                f"EMAIL RICEVUTA\nOggetto: {subj}\nDa: {frm}\nTesto:\n{(bodytxt or '')[:3000]}"
            )
            reply = ai_reply(token, prompt, REPLY_CTX)
            if reply:
                sig = ('<br><br><span style="color:#888;font-size:12px;">— Assistente automatico · Area62 · '
                       'Gestione Sale Deloitte<br>Risposta generata automaticamente; per assistenza diretta scrivi a '
                       'marco.manfredini@area62.it</span>')
                html = email_template('Gestione Sale Deloitte', md_to_html(reply) + sig)
                subj_re = subj if subj.lower().startswith('re:') else f'Re: {subj}'
                try:
                    send_mail(frm, subj_re, html, in_reply_to=m.get('Message-ID'))
                    sb('PATCH', f"inbox?id=eq.{inbox_row['id']}", token, {'status': 'handled'}, prefer='return=minimal')
                    replied += 1
                    print(f'  🤖 risposta AI inviata a {frm}')
                except Exception as e:
                    print('  ✗ risposta AI non inviata:', e)
    M.logout()
    print(f'  · archiviate: {archived} · risposte AI: {replied}')
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
            err = str(e)[:300]
            # 554 = IP del runner GitHub in blacklist DNSBL: errore TRANSITORIO.
            # Lascio l'email 'pending' così il prossimo run (ogni ~5 min) ritenta con un
            # altro IP, finché non ne becca uno pulito. Dopo 12h rinuncio (-> 'error').
            keep_pending = '554' in err
            if keep_pending:
                try:
                    ct = datetime.datetime.fromisoformat((row.get('created_at') or '').replace('Z', '+00:00'))
                    if (datetime.datetime.now(datetime.timezone.utc) - ct).total_seconds() > 12 * 3600:
                        keep_pending = False
                except Exception:
                    pass
            patch = {'error': err} if keep_pending else {'status': 'error', 'error': err}
            sb('PATCH', f"email_queue?id=eq.{row['id']}", token, patch, prefer='return=minimal')
    return sent

# ── REMINDER: promemoria pre-evento (verifica materiale pronto) ──
INFO_MAIL = 'marco.manfredini@area62.it'

def get_reminder_config(token):
    cfg = {'enabled': True, 'offsets_h': [24, 2], 'recipients_extra': []}
    st, rows = sb('GET', "app_settings?id=eq.global&select=data", token)
    try:
        if isinstance(rows, list) and rows:
            r = (rows[0].get('data') or {}).get('reminders') or {}
            if 'enabled' in r: cfg['enabled'] = bool(r['enabled'])
            if r.get('offsets_h'): cfg['offsets_h'] = [int(x) for x in r['offsets_h']]
            if r.get('recipients_extra'): cfg['recipients_extra'] = r['recipients_extra']
    except Exception as e:
        print('reminder config fallback:', e)
    return cfg

def _looks_email(s):
    return bool(s) and re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', str(s).strip()) is not None

def process_reminders(token):
    import datetime
    cfg = get_reminder_config(token)
    if not cfg['enabled'] or not cfg['offsets_h']:
        return 0
    now = datetime.datetime.now(datetime.timezone.utc)
    st, bookings = sb('GET', f"bookings?start_at=gte.{now.isoformat()}&order=start_at.asc&limit=200", token)
    if not isinstance(bookings, list):
        return 0
    st, logs = sb('GET', "reminders_log?select=booking_id,offset_h", token)
    sent = set((l['booking_id'], int(l['offset_h'])) for l in logs) if isinstance(logs, list) else set()
    test_to = os.environ.get('REMINDER_TEST_TO')  # override sicuro per i test (non tocca i destinatari reali)
    n = 0
    for b in bookings:
        try:
            start = datetime.datetime.fromisoformat(b['start_at'].replace('Z', '+00:00'))
        except Exception:
            continue
        due = [o for o in cfg['offsets_h']
               if now >= start - datetime.timedelta(hours=o) and (b['id'], o) not in sent]
        if not due:
            continue
        o_send = min(due)  # manda il reminder più imminente e consuma tutti gli offset già scaduti
        if test_to:
            recips = [test_to]
        else:
            recips = [INFO_MAIL]
            for x in (b.get('organizzatore'), b.get('referente')):
                if _looks_email(x): recips.append(str(x).strip())
            recips += [r for r in cfg['recipients_extra'] if _looks_email(r)]
            recips = list(dict.fromkeys(recips))
        label = ROOM_LABELS.get(b.get('room'), b.get('room'))
        start_local = start.strftime('%d/%m/%Y %H:%M')
        allest = b.get('allestimento') or []
        if isinstance(allest, str):
            try: allest = json.loads(allest)
            except Exception: allest = [allest]
        items = ''.join(f'<li>{a}</li>' for a in allest) or '<li style="color:#999;">Nessun allestimento specificato</li>'
        creative = ''
        if b.get('creative_support'):
            creative = (f'<div style="margin:12px 0;padding:12px 14px;background:#fff8e1;border-left:3px solid #f0a030;border-radius:6px;">'
                        f'<b>🎨 Materiale creativo richiesto</b><br>{b.get("creative_desc") or "—"}<br>'
                        f'<span style="color:#666;">Verificare che sia pronto e inviato prima dell\'evento.</span></div>')
        inner = f"""<p>Promemoria: manca poco a questo evento. <b>Verifica che tutto il materiale sia pronto e disponibile.</b></p>
          <table style="font-size:14px;border-collapse:collapse;margin:12px 0;">
            <tr><td style="padding:3px 14px 3px 0;color:#666;">Sala</td><td><b>{label}</b></td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:#666;">Quando</td><td>{start_local}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:#666;">Evento</td><td>{b.get('title') or '—'}</td></tr>
            <tr><td style="padding:3px 14px 3px 0;color:#666;">Referente</td><td>{b.get('referente') or '—'}</td></tr>
          </table>
          <h3 style="font-size:14px;margin:16px 0 6px;">Checklist materiale / allestimento</h3>
          <ul style="margin:0 0 8px;padding-left:20px;">{items}</ul>
          {creative}"""
        html = email_template(f'⏰ Reminder evento — {label}', inner, accent='#f0a030')
        try:
            send_mail(recips, f'Reminder: {label} — {start_local}', html)
            for o in due:
                sb('POST', 'reminders_log?on_conflict=booking_id,offset_h', token,
                   {'booking_id': b['id'], 'offset_h': o},
                   prefer='return=minimal,resolution=ignore-duplicates')
            n += 1
            print(f'  ⏰ reminder inviato ({o_send}h) per {label} {start_local} → {recips}')
        except Exception as e:
            print(f'  ✗ reminder non inviato: {e}')
    return n

# ── RIEPILOGO GIORNALIERO (solo al responsabile) ──
def _rows(token, path):
    st, rows = sb('GET', path, token)
    return rows if isinstance(rows, list) else []

def gather_digest_context(token, now_local):
    today = now_local.date().isoformat()
    tomorrow = (now_local.date() + datetime.timedelta(days=1)).isoformat()
    start_utc = now_local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(datetime.timezone.utc).isoformat()
    end_utc   = now_local.replace(hour=23, minute=59, second=59, microsecond=0).astimezone(datetime.timezone.utc).isoformat()
    checks   = _rows(token, f"checks?date=eq.{today}&select=room,check_id,state")
    rooms_ck = sorted(set(c['room'] for c in checks))
    bk_today = _rows(token, f"bookings?start_at=gte.{start_utc}&start_at=lte.{end_utc}&select=room,title,start_at")
    bk_tom   = _rows(token, f"bookings?start_at=gte.{tomorrow}T00:00:00&start_at=lte.{tomorrow}T23:59:59&select=room,title,allestimento,creative_support")
    tk_open  = _rows(token, "tickets?status=in.(open,in-progress)&select=id,room,priority,title,status")
    tk_res   = _rows(token, f"tickets?resolved_at=gte.{start_utc}&select=id,title")
    inbox_td = _rows(token, f"inbox?received_at=gte.{start_utc}&select=intent,status")
    return {
        'data': today,
        'check_mattutini': {
            'sale_controllate': [ROOM_LABELS.get(r, r) for r in rooms_ck],
            'sale_totali': list(ROOM_LABELS.values()),
            'ko': [{'sala': ROOM_LABELS.get(c['room'], c['room']), 'voce': c['check_id']} for c in checks if c.get('state') == 'ko'],
        },
        'prenotazioni_oggi': [{'sala': ROOM_LABELS.get(b['room'], b['room']), 'titolo': b.get('title'), 'quando': b['start_at']} for b in bk_today],
        'prenotazioni_domani': [{'sala': ROOM_LABELS.get(b['room'], b['room']), 'titolo': b.get('title'),
                                 'allestimento': b.get('allestimento') or [], 'materiale_creativo': bool(b.get('creative_support'))} for b in bk_tom],
        'ticket_ancora_aperti': [{'id': t.get('id'), 'sala': ROOM_LABELS.get(t['room'], t['room']), 'priorita': t.get('priority'), 'titolo': t.get('title'), 'stato': t.get('status')} for t in tk_open],
        'ticket_risolti_oggi': [{'id': t.get('id'), 'titolo': t.get('title')} for t in tk_res],
        'mail_ricevute_oggi': {'totali': len(inbox_td), 'da_gestire': len([m for m in inbox_td if (m.get('status') or 'new') == 'new'])},
    }

def deterministic_digest(ctx):
    ck = ctx['check_mattutini']
    non_fatti = [s for s in ck['sale_totali'] if s not in ck['sale_controllate']]
    fatto = [
        f"Check mattutini eseguiti: {', '.join(ck['sale_controllate']) or 'nessuno'}",
        f"Prenotazioni di oggi: {len(ctx['prenotazioni_oggi'])}",
        f"Ticket risolti oggi: {len(ctx['ticket_risolti_oggi'])}",
        f"Mail ricevute: {ctx['mail_ricevute_oggi']['totali']}",
    ]
    dafare = []
    if non_fatti: dafare.append(f"Check NON eseguiti: {', '.join(non_fatti)}")
    if ck['ko']: dafare.append("Check falliti: " + ', '.join(f"{k['sala']} ({k['voce']})" for k in ck['ko']))
    if ctx['ticket_ancora_aperti']: dafare.append("Ticket ancora aperti: " + ', '.join(f"{t['id']} {t['titolo']}" for t in ctx['ticket_ancora_aperti']))
    if ctx['mail_ricevute_oggi']['da_gestire']: dafare.append(f"Mail da gestire: {ctx['mail_ricevute_oggi']['da_gestire']}")
    for b in ctx['prenotazioni_domani']:
        if not b['allestimento'] or b['materiale_creativo']:
            dafare.append(f"Domani {b['sala']} '{b['titolo']}': verificare materiale/allestimento")
    fh = ''.join(f'<li>{x}</li>' for x in fatto)
    dh = ''.join(f'<li>{x}</li>' for x in dafare) or '<li style="color:#5a8a00;">Nulla in sospeso</li>'
    return f"<h3 style='font-size:14px;margin:6px 0;'>✅ Fatto oggi</h3><ul>{fh}</ul><h3 style='font-size:14px;margin:14px 0 6px;'>⚠️ Da completare / non fatto</h3><ul>{dh}</ul>"

def process_daily_digest(token):
    cfg = get_assistant_config(token)
    if not cfg.get('digest'):
        return False
    tz = ZoneInfo('Europe/Rome') if ZoneInfo else datetime.timezone(datetime.timedelta(hours=2))
    now_local = datetime.datetime.now(tz)
    if now_local.hour < int(cfg.get('digestHour', 18)):
        return False
    key = f"__digest__{now_local.date().isoformat()}"
    # già inviato oggi? (riuso reminders_log con chiave sintetica, unique booking_id+offset_h)
    if _rows(token, f"reminders_log?booking_id=eq.{key}&select=booking_id"):
        return False
    # prenota subito lo slot per evitare doppioni tra run ravvicinati
    sb('POST', 'reminders_log?on_conflict=booking_id,offset_h', token,
       {'booking_id': key, 'offset_h': 0}, prefer='return=minimal,resolution=ignore-duplicates')
    ctx = gather_digest_context(token, now_local)
    prompt = (
        "Genera un RIEPILOGO GIORNALIERO operativo in italiano (solo corpo email, conciso) per il responsabile delle sale. "
        "Struttura in due sezioni con elenchi puntati: '✅ Fatto oggi' e '⚠️ Da completare / non fatto'. "
        "In 'Da completare' includi: check mattutini non eseguiti (confronta sale_controllate con sale_totali), check falliti, "
        "ticket ancora aperti, mail da gestire, e materiale/allestimento mancante per le prenotazioni di domani. "
        "Usa SOLO i dati del contesto, niente preamboli né firme, e NON ripetere il titolo o la data (già in intestazione). "
        "Se una sezione non ha voci, scrivi 'nulla da segnalare'."
    )
    body = ai_reply(token, prompt, ctx)
    inner = md_to_html(body) if body else deterministic_digest(ctx)
    html = email_template(f"📋 Riepilogo giornaliero — {now_local.strftime('%d/%m/%Y')}", inner, accent='#4da6ff')
    to = cfg.get('digestTo') or 'marco.manfredini@area62.it'
    to = os.environ.get('DIGEST_TEST_TO', to)  # override sicuro per i test
    try:
        send_mail(to, f"Riepilogo giornaliero sale — {now_local.strftime('%d/%m/%Y')}", html)
        print(f'  📋 riepilogo giornaliero inviato a {to} ({"AI" if body else "fallback"})')
        return True
    except Exception as e:
        print('  ✗ riepilogo non inviato:', e)
        return False

WATCHDOG_TO = ['marco.manfredini@area62.it', 'andrea.isidoro@alascom.it']
WATCH_ROOMS = [('Solaria – Roma', 'Solaria Roma'), ('Solaria – Milano', 'Solaria Milano'), ('Armonia – Roma', 'Armonia Roma')]

def process_check_watchdog(token):
    """Alle 10:00 (ora Italia): se non risultano inviati i check mattutini del giorno
    delle sale attive, accoda un alert a Marco + Andrea Isidoro spiegando il motivo
    (check non chiuso oppure problema di invio nel worker/Aruba). Una sola volta al giorno."""
    try:
        from zoneinfo import ZoneInfo
        now_local = datetime.datetime.now(ZoneInfo('Europe/Rome'))
    except Exception:
        now_local = datetime.datetime.utcnow() + datetime.timedelta(hours=2)  # fallback CEST
    if now_local.hour < 10:
        return 0
    day = now_local.strftime('%Y-%m-%d')
    # dedup: alert già emesso oggi?
    st, ex = sb('GET', f"email_queue?select=id&subject=like.*Guardiano%20check*&created_at=gte.{day}T00:00:00", token)
    if isinstance(ex, list) and ex:
        return 0
    # sale ATTIVE = quelle con almeno un report inviato negli ultimi 7 giorni
    week = (now_local - datetime.timedelta(days=7)).strftime('%Y-%m-%d')
    st, recent = sb('GET', f"email_queue?select=subject,status,created_at&subject=like.Check%20mattutino*&created_at=gte.{week}T00:00:00", token)
    recent = recent if isinstance(recent, list) else []
    def room_of(subj):
        for key, label in WATCH_ROOMS:
            if key in (subj or ''):
                return label
        return None
    active = set(room_of(r.get('subject')) for r in recent if r.get('status') == 'sent')
    active.discard(None)
    if not active:
        return 0
    done, queued = set(), set()
    for r in recent:
        if (r.get('created_at') or '') < day:
            continue
        lbl = room_of(r.get('subject'))
        if not lbl:
            continue
        (done if r.get('status') == 'sent' else queued).add(lbl)
    missing = active - done
    lines = []
    for l in sorted(active):
        if l in done:
            lines.append(f'{l}: ✓ inviato')
        elif l in queued:
            lines.append(f'{l}: ⚠ report in coda ma NON ancora consegnato (problema di invio)')
        else:
            lines.append(f'{l}: ✗ check non ancora chiuso/inviato')
    lst = '<ul>' + ''.join(f'<li>{l}</li>' for l in lines) + '</ul>'
    if not missing:
        # TUTTO A POSTO: conferma verde (solo a Marco) — così sai che il sistema è vivo
        body = ('<p>Alle ore 10:00 <b>tutti i check mattutini della giornata risultano inviati correttamente</b>:</p>'
                + lst +
                '<p style="font-size:13px;color:#666;">Sistema operativo: portale, worker e invio email funzionanti. Nessun problema.</p>')
        html = email_template('✓ Guardiano check — tutto a posto', body, accent='#86BC25')
        to = ['marco.manfredini@area62.it']
        subject = f'Guardiano check — tutto a posto ({now_local.strftime("%d/%m")}) ✓'
    else:
        # PROBLEMA: alert arancione a Marco + Andrea Isidoro
        st, errs = sb('GET', f"email_queue?select=id&status=in.(error,pending)&created_at=gte.{day}T00:00:00", token)
        n_err = len(errs) if isinstance(errs, list) else 0
        reason = (f'<p style="color:#c0392b;"><b>Possibile problema nel worker/invio:</b> {n_err} email di oggi risultano in errore o in attesa '
                  f'(es. IP dei runner in blacklist DNSBL / 554). Il worker sta ritentando in automatico.</p>'
                  if n_err else
                  '<p>La coda email è pulita: molto probabilmente i check <b>non sono ancora stati chiusi</b> dal presidio.</p>')
        body = ('<p>Alle ore 10:00 non risultano ancora inviati tutti i check mattutini della giornata:</p>'
                + lst + reason +
                '<p style="font-size:13px;color:#666;">Verifica sul portale che i check delle sale segnalate siano stati chiusi con "Chiudi e segnala".</p>')
        html = email_template('⚠ Guardiano check — report non ancora inviati', body, accent='#f0a030')
        to = WATCHDOG_TO
        subject = f'Guardiano check — report non ancora inviati ({now_local.strftime("%d/%m")}) ⚠'
    sb('POST', 'email_queue', token, {'to_addr': to, 'subject': subject, 'html': html, 'status': 'pending'}, prefer='return=minimal')
    print(f'  🛡 guardiano: stato accodato ({"tutto ok" if not missing else "mancano: " + ", ".join(sorted(missing))})')
    return 1

def main():
    token = sb_login()
    try:
        wd = process_check_watchdog(token)   # accoda l'eventuale alert PRIMA di svuotare la coda
    except Exception as e:
        wd = 0; print('  ✗ guardiano errore (ignorato):', e)   # non deve mai bloccare l'invio
    out = process_outbound(token)
    inb = process_inbound(token)
    rem = process_reminders(token)
    dig = process_daily_digest(token)
    print(f'== worker done == coda:{out} · prenotazioni:{inb} · reminder:{rem} · riepilogo:{"sì" if dig else "no"} · guardiano:{wd}')

if __name__ == '__main__':
    main()
