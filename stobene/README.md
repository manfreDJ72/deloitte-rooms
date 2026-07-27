# Sto Bene

PWA installabile per il check-in giornaliero: un tap sul bottone dice ai
tuoi cari che stai bene. Se salti il check-in, un familiare riceve una email
di allerta automatica.

**Architettura:** frontend statico + Supabase (auth, database, edge functions) + Resend (email).

## Cosa c'è dentro

```
stobene/
├── index.html                  # UI: login, setup, main, storico
├── app.js                      # Logica client (Supabase JS)
├── style.css                   # Stile
├── sw.js                       # Service worker
├── manifest.webmanifest        # PWA manifest
├── icon.svg / icon-192.png / icon-512.png
├── config.example.js           # Modello configurazione (copiare in config.js)
├── config.js                   # ← QUI incolli URL Supabase + anon key
├── vercel.json                 # Config hosting Vercel (headers/cache)
└── supabase/
    ├── schema.sql              # Tabelle + RLS + trigger  →  eseguire nel SQL Editor
    ├── pg_cron.sql             # Setup cron allerte      →  eseguire nel SQL Editor
    └── functions/
        ├── send-checkin/       # Edge function: bottone → email + DB
        └── check-missed/       # Edge function: cron controllo giornaliero
```

## Setup completo end-to-end

### 1. Crea il progetto Supabase (5 min)

1. Vai su https://supabase.com/dashboard e crea un nuovo progetto (Free tier va bene)
2. Aspetta ~2 min che il database sia pronto
3. Prendi nota:
   - **Project Ref** → visibile nell'URL (es. `abcdefgh`)
   - **Project URL** → `https://<ref>.supabase.co`
   - **anon public key** → Settings → API → `Project API keys → anon public`
   - **service_role secret** → Settings → API → `service_role` (tienila SEGRETA)

### 2. Esegui lo schema (2 min)

1. Nel dashboard Supabase apri **SQL Editor** → **New query**
2. Copia-incolla tutto `supabase/schema.sql` → **Run**
3. Verifica: **Table Editor** deve mostrare `profiles`, `checkins`, `missed_alerts`

### 3. Attiva pg_cron per gli alert automatici (2 min)

1. **Database → Extensions** → cerca `pg_cron` → abilita
2. Cerca anche `pg_net` → abilita (serve per chiamate HTTP dai job cron)
3. Apri `supabase/pg_cron.sql` e sostituisci i placeholder:
   - `<PROJECT_REF>` → il tuo ref
   - `<SUPABASE_SERVICE_ROLE_KEY>` → la service_role key
4. Nel **SQL Editor** incolla il risultato e **Run**

### 4. Deploy delle edge functions (5 min)

Serve la [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

```bash
# Installa CLI
npm install -g supabase

# Login
supabase login

# Vai nella cartella dell'app
cd stobene

# Link al progetto
supabase link --project-ref <PROJECT_REF>

# Deploy delle due function
supabase functions deploy send-checkin
supabase functions deploy check-missed
```

Se non vuoi usare la CLI, puoi anche fare deploy dal dashboard (Edge Functions
→ Deploy new function → copia-incolla il codice TypeScript).

### 5. Configura le variabili Resend

1. Crea account su https://resend.com e prendi una API key
2. (Consigliato) Verifica un tuo dominio su https://resend.com/domains
3. Nel dashboard Supabase: **Edge Functions → Manage secrets**
4. Aggiungi:
   - `RESEND_API_KEY` = `re_xxxxxxxx`
   - `RESEND_FROM` = `Sto Bene <ciao@tuodominio.it>` (opzionale, default sandbox)
   - `CRON_SECRET` = una stringa a caso (opzionale, per chiamare check-missed dall'esterno)

### 6. Configura il client

Modifica `stobene/config.js`:

```js
window.STOBENE_CONFIG = {
  SUPABASE_URL: 'https://<PROJECT_REF>.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIs...',
};
```

### 7. Deploy del frontend

Tre opzioni comuni. **La più semplice: Vercel**.

**Vercel** (raccomandato):
1. https://vercel.com/new → importa il repository
2. Root Directory: `stobene`
3. Framework Preset: Other
4. Deploy → ti dà l'URL `<progetto>.vercel.app`

**Cloudflare Pages**:
1. https://dash.cloudflare.com → Pages → Create → Connect to Git
2. Build settings: Framework preset = None; Root directory = `stobene`
3. Deploy

**Netlify**:
1. https://app.netlify.com → Add new site → Import from Git
2. Base directory: `stobene`
3. Deploy

Con tutti e tre, Supabase (dov'è il backend) è già online — l'hosting serve
solo per i file statici del frontend.

### 8. Configura Auth (email conferma)

Nel dashboard Supabase → **Authentication → Providers → Email**:
- Enable Email provider ✓
- Per test rapidi: puoi **disabilitare "Confirm email"** — così quando qualcuno si registra entra subito
- Per produzione: lascia abilitata la conferma email

## Come si usa

1. Apri l'URL del deploy su Safari/Chrome sul telefono
2. **Registrati** con email + password
3. Compila il **setup**: nome, contatto (nome + email obbligatoria), canale, orario
4. **Aggiungi a Home** per installare come app
5. Ogni giorno tap sul bottone **STO BENE** → email al contatto + registrato in DB
6. Icona storico in alto per vedere tutti i check-in con esito email
7. Se salti il check-in per più di N minuti oltre il tuo orario → il contatto riceve email di allerta automatica

## Sicurezza

- **RLS attivo**: ogni utente vede solo i propri check-in e il proprio profile
- La `anon key` nel `config.js` è **pubblica** (design Supabase) — la sicurezza è nel database via RLS
- La `service_role key` NON deve mai finire nel client — vive solo come secret nelle edge functions
- L'edge function `check-missed` è protetta da service_role o `CRON_SECRET`
- Password sono hashate da Supabase Auth (bcrypt)

## Diagnostica

- **Storico check-in con "email fallita"** → verifica `RESEND_API_KEY` sul dashboard Supabase Edge Functions, e che il dominio in `RESEND_FROM` sia verificato
- **pg_cron non parte** → `select * from cron.job_run_details order by start_time desc limit 20;` nel SQL Editor
- **"Profile not found"** al primo login → controlla che il trigger `on_auth_user_created` sia attivo (Database → Triggers)
- **Notifiche giornaliere non arrivano** → funzionano solo su Chrome Android (Notification Triggers API); su iOS Safari non c'è supporto e l'app suggerisce una sveglia manuale

## Limitazioni note

- Auto-alert è solo email (non SMS/WhatsApp) perché richiederebbero un servizio a pagamento tipo Twilio
- WhatsApp/SMS come canale principale apre l'app nativa: nessun server invia realmente il messaggio, viene solo tracciato che l'utente l'ha attivato
