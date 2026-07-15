# Sto Bene

PWA installabile con un grosso bottone "STO BENE".
Al tap invia un messaggio WhatsApp / SMS / email al contatto di riferimento e ti ricorda ogni giorno con una notifica.

## Deploy su Vercel

L'app è indipendente dal sito rooms.area62.it — è pensata per essere deployata
separatamente su Vercel (o altro hosting statico).

### Con il sito vercel.com (metodo consigliato)

1. Vai su https://vercel.com/new
2. **Import** questo repository (`manfreDJ72/deloitte-rooms`)
3. Nel form di configurazione:
   - **Root Directory**: `stobene`  ← IMPORTANTE
   - **Framework Preset**: `Other` (o lascialo vuoto)
   - **Build Command**: (lascia vuoto)
   - **Output Directory**: (lascia vuoto)
4. Deploy

Vercel pubblicherà l'app all'indirizzo `<nome-progetto>.vercel.app` — non
c'entra nulla con rooms.area62.it.

### Con Vercel CLI (metodo alternativo)

```bash
cd stobene
npx vercel deploy --prod
```

Al primo lancio Vercel chiede login (email / GitHub) e crea il progetto.

### Dominio personalizzato

Dal dashboard del progetto Vercel → Settings → Domains, aggiungi il dominio
che preferisci (es. `stobene.tuodominio.it`) e configura il record DNS come
suggerito da Vercel.

## Invio email server-side (Resend + Vercel)

Se il canale scelto è **Email**, l'app POSTa a `/api/send` che a sua volta
manda l'email tramite [Resend](https://resend.com). Se la function non è
raggiungibile (es. hosting solo statico) l'app fa fallback su `mailto:`
che apre il client email dell'utente.

### Setup una-tantum

1. **Crea account Resend** su https://resend.com (piano free: 3.000 email/mese, 100/giorno)
2. **Crea una API key** su https://resend.com/api-keys
3. **Mittente**: verifica un dominio (https://resend.com/domains) e crea un
   indirizzo tipo `stobene@tuodominio.it`. In alternativa, per test rapidi,
   puoi usare `onboarding@resend.dev` — ma questo mittente può inviare
   **solo verso l'email del tuo account Resend**.
4. **Su Vercel** → Project → Settings → Environment Variables, aggiungi:

   | Nome                | Valore                                    | Note                          |
   |---------------------|-------------------------------------------|-------------------------------|
   | `RESEND_API_KEY`    | `re_xxxxxxxxxxxx`                         | obbligatoria                  |
   | `RESEND_FROM`       | `Sto Bene <stobene@tuodominio.it>`        | opzionale (default sandbox)   |
   | `ALLOWED_RECIPIENT` | `marco@example.com,anna@example.com`      | opzionale ma **consigliata**  |

   `ALLOWED_RECIPIENT` limita a chi può essere inviata la mail dalla tua
   function (una function pubblica senza allowlist è a rischio abuso).

5. **Redeploy** del progetto Vercel (le env var vengono applicate al nuovo
   deploy).

### Test rapido

```bash
curl -X POST https://<tuo-progetto>.vercel.app/api/send \
  -H "Content-Type: application/json" \
  -d '{"to":"tuo@indirizzo.it","message":"Test da curl","senderName":"Emilia"}'
```

Risposta 200 → email inviata. Errori:
- `403 Recipient not in allowlist` → email non in `ALLOWED_RECIPIENT`
- `500 missing RESEND_API_KEY` → env var non impostata
- `502 Resend ...` → API key non valida o dominio non verificato

## Struttura file

```
stobene/
├── index.html            # UI: schermate setup + main
├── style.css             # Stile (bottone arancione → verde)
├── app.js                # Logica: setup, invio messaggio, notifiche
├── sw.js                 # Service worker (offline + notifiche)
├── manifest.webmanifest  # PWA manifest
├── icon.svg              # Icona vettoriale
├── icon-192.png          # Icona iOS/Android 192×192
├── icon-512.png          # Icona Android 512×512
├── vercel.json           # Config Vercel (headers, cache)
└── api/
    └── send.js           # Serverless function (Resend)
```

## Come usare l'app dopo il deploy

1. Aprire l'URL Vercel dal telefono (iPhone → Safari, Android → Chrome)
2. **Aggiungi a Home** (iOS: Condividi → Aggiungi a Home; Android: menu → Installa app)
3. Aprire l'app dall'icona sulla home
4. Compilare il setup (nome, contatto, canale, orario)
5. Concedere il permesso notifiche

Ogni giorno all'orario impostato arriva una notifica: un tap sul bottone
"STO BENE" apre WhatsApp (o SMS/email) con il messaggio precompilato.

## Note tecniche

- **Notifiche schedulate**: funzionano su Chrome Android (Notification
  Triggers API). Su iOS Safari non c'è supporto nativo per notifiche locali
  schedulate senza server push — l'app mostra un avviso e consiglia
  di impostare anche una sveglia sull'app Orologio.
- **Storage**: nome, contatto e cronologia check-in vengono salvati in
  `localStorage` — restano solo sul dispositivo dell'utente.
- **Nessun backend**: tutto client-side, l'app funziona anche offline.
