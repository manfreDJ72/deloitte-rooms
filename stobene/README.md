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
└── vercel.json           # Config Vercel (headers, cache)
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
