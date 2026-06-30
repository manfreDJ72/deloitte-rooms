// ── SUPABASE CONFIG ──
const SUPABASE_URL     = 'https://vepplgeiykrsgkfrbswi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ptO60rE97Qv7IpWCEY1bww_FGnd8wG9';

// ── DEMO MODE ──
// true = tutto su localStorage (sviluppo locale)
// false = usa Supabase
const DEMO_MODE = true;

// ── ROOMS ──
const ROOMS = [
  { id: 'solaria-roma',   name: 'Solaria',  city: 'Roma',   font: 'solaria', color: '#4da6ff' },
  { id: 'solaria-milano', name: 'Solaria',  city: 'Milano', font: 'solaria', color: '#4da6ff' },
  { id: 'armonia-roma',   name: 'Armonia',  city: 'Roma',   font: 'armonia', color: '#D4457B' },
];

// ── SLA DEFINITIONS ──
const SLA = {
  P1: {
    label: 'P1 Critico',
    contact_h: 1,
    remote_h: 2,
    onsite_days: null, // vedi ripristino
    restore_sw_prov_h: 12,
    restore_sw_def_days: 2,
    restore_hw_prov_h: 24,
    restore_hw_def_h: 24,
    penalty_contact: '1%',
    penalty_onsite: '2%',
    penalty_restore_prov: '3%',
  },
  P2: {
    label: 'P2 Alto',
    contact_h: 1,
    remote_h: 2,
    onsite_days: 2,
    restore_sw_prov_days: 1,
    restore_sw_def_days: 5,
    restore_hw_prov_days: 2,
    restore_hw_def_days: 5,
    penalty_contact: '1%',
    penalty_onsite: '2%',
    penalty_restore_prov: '1%',
  },
  P3: {
    label: 'P3 Medio',
    contact_h: 1,
    remote_h: 2,
    onsite_days: 2,
    restore_sw_plan_days: 3,
    restore_sw_def_days: 10,
    restore_hw_plan_days: 5,
    penalty_contact: '1%',
  },
  P4: {
    label: 'P4 Basso',
    contact_h: 1,
    remote_h: 2,
    onsite_days: null,
    restore_sw: 'Pianificazione concordata',
    restore_hw: 'Pianificazione concordata',
  },
};

// ── CHECK ITEMS ──
// quickFixes: soluzioni rapide mostrate quando il check fallisce
const CHECK_ITEMS = {
  'solaria-roma':   getCheckItemsSolaria('roma'),
  'solaria-milano': getCheckItemsSolaria('milano'),
  'armonia-roma':   getCheckItemsArmonia(),
};

function getCheckItemsSolaria(city) {
  return [
    {
      section: 'Regia',
      icon: '🎛️',
      items: [
        {
          id: `sol-${city}-app`, name: 'Applicazioni principali',
          desc: 'Verificare che tutte le applicazioni principali siano attive e funzionanti (Pixera, Docker, NUC manager, tool di controllo).',
          quickFixes: ['Riavvio applicazione', 'Riavvio NUC Regia', 'Verifica avvio automatico', 'Riavvio PC Regia'],
        },
        {
          id: `sol-${city}-internet`, name: 'Connessione Internet',
          desc: 'Verificare che la connessione internet sia disponibile e stabile dalla regia.',
          quickFixes: ['Riavvio router/switch', 'Test ping Google', 'Verifica cavo LAN', 'Contattare IT Deloitte'],
        },
        {
          id: `sol-${city}-pixera-reg`, name: 'Pixera – Timeline e Default',
          desc: 'Verificare che le timeline siano attive e che i contenuti di default siano presenti e caricati correttamente.',
          quickFixes: ['Riavvio Pixera', 'Ricaricare timeline da backup', 'Verifica path contenuti', 'Riavvio NUC Pixera'],
        },
        {
          id: `sol-${city}-docker`, name: 'Docker',
          desc: 'Verificare che Docker sia attivo e i container necessari siano in esecuzione.',
          quickFixes: ['Riavvio container Docker', 'Riavvio servizio Docker', 'Verifica log container', 'Riavvio PC Regia'],
        },
      ]
    },
    {
      section: 'Stanza',
      icon: '📱',
      items: [
        {
          id: `sol-${city}-tablet`, name: 'Tablet di Controllo',
          desc: 'Verificare che tutti i tablet siano carichi (>30%), accesi e che raggiungano correttamente la webapp di controllo.',
          quickFixes: ['Collegare alla ricarica', 'Riavvio tablet', 'Verifica connessione Wi-Fi', 'Reset applicazione webapp'],
        },
        {
          id: `sol-${city}-webapp`, name: 'Web App Sala',
          desc: 'Verificare che l\'applicazione webapp sia attiva, navigabile in tutte le voci di menu e risponda ai comandi.',
          quickFixes: ['Ricaricare pagina (F5)', 'Svuotare cache browser', 'Riavvio server webapp', 'Verifica connessione rete'],
        },
      ]
    },
    {
      section: 'Arena',
      icon: '🖥️',
      items: [
        {
          id: `sol-${city}-arena-sorgenti`, name: 'Arena – Sorgenti',
          desc: 'Verificare il cambio sorgenti dell\'Arena: tutte le sorgenti devono essere selezionabili e attive.',
          quickFixes: ['Riavvio Atlona', 'Verifica cavi HDMI', 'Reset selettore sorgente', 'Riavvio NUC Arena'],
        },
        {
          id: `sol-${city}-arena-ledwall`, name: 'Arena – LED Wall',
          desc: 'Verificare che il LED Wall dell\'Arena riproduca contenuto a tutto schermo senza artefatti o zone spente.',
          quickFixes: ['Riavvio controller LED Wall', 'Verifica alimentazione pannelli', 'Riavvio Pixera + ricarica timeline', 'Verifica cavi dati LED'],
        },
        {
          id: `sol-${city}-arena-audio`, name: 'Arena – Audio',
          desc: 'Riproduzione contenuto con audio: verificare che il suono esca correttamente dagli altoparlanti dell\'Arena.',
          quickFixes: ['Alzare volume sistema', 'Riavvio sistema audio', 'Verifica cavi audio', 'Verifica mixer/amplificatore'],
        },
        {
          id: `sol-${city}-arena-mic`, name: 'Arena – Microfono',
          desc: 'Eseguire test audio con i microfoni dell\'Arena: verificare ricezione e amplificazione corretta.',
          quickFixes: ['Sostituire batterie microfono', 'Verifica frequenza ricevitore', 'Riavvio ricevitore wireless', 'Cambio canale RF'],
        },
        {
          id: `sol-${city}-arena-pixera`, name: 'Arena – Pixera',
          desc: 'Verificare che il cambio contenuto tramite Pixera funzioni correttamente nell\'Arena.',
          quickFixes: ['Riavvio Pixera', 'Ricarica timeline Arena', 'Verifica output Pixera', 'Riavvio NUC'],
        },
        {
          id: `sol-${city}-arena-atlona`, name: 'Arena – Atlona (PC esterno)',
          desc: 'Verificare il collegamento di un PC esterno tramite Atlona: segnale video e audio devono passare correttamente.',
          quickFixes: ['Riavvio Atlona', 'Verifica cavo HDMI PC', 'Cambio porta HDMI', 'Reset Atlona da web interface'],
        },
        {
          id: `sol-${city}-arena-nuc`, name: 'Arena – NUC',
          desc: 'Verificare che il NUC dell\'Arena sia attivo, raggiungibile in rete e risponda correttamente.',
          quickFixes: ['Riavvio NUC (tasto power)', 'Verifica alimentazione NUC', 'Ping NUC da regia', 'Verifica accesso remoto'],
        },
      ]
    },
    {
      section: 'Cave',
      icon: '📽️',
      items: [
        {
          id: `sol-${city}-cave-sorgenti`, name: 'Cave – Sorgenti',
          desc: 'Verificare il cambio sorgenti della Cave: tutte le sorgenti selezionabili e attive.',
          quickFixes: ['Riavvio Atlona', 'Verifica cavi HDMI', 'Reset selettore sorgente', 'Riavvio NUC Cave'],
        },
        {
          id: `sol-${city}-cave-schermo`, name: 'Cave – Schermo',
          desc: 'Verificare che lo schermo della Cave riproduca contenuto a tutto schermo senza problemi.',
          quickFixes: ['Riavvio schermo (power cycle)', 'Verifica ingresso HDMI selezionato', 'Riavvio Pixera', 'Verifica cavo HDMI'],
        },
        {
          id: `sol-${city}-cave-audio`, name: 'Cave – Audio',
          desc: 'Riproduzione contenuto con audio nella Cave: verificare uscita audio corretta.',
          quickFixes: ['Alzare volume', 'Riavvio sistema audio Cave', 'Verifica cavi audio', 'Verifica mixer'],
        },
        {
          id: `sol-${city}-cave-mic`, name: 'Cave – Microfono',
          desc: 'Test audio microfono nella Cave.',
          quickFixes: ['Sostituire batterie', 'Verifica frequenza ricevitore', 'Cambio canale RF'],
        },
        {
          id: `sol-${city}-cave-pixera`, name: 'Cave – Pixera',
          desc: 'Verifica cambio contenuto tramite Pixera nella Cave.',
          quickFixes: ['Riavvio Pixera', 'Ricarica timeline Cave', 'Verifica output Pixera Cave'],
        },
        {
          id: `sol-${city}-cave-atlona`, name: 'Cave – Atlona (PC esterno)',
          desc: 'Collegamento PC esterno tramite Atlona nella Cave.',
          quickFixes: ['Riavvio Atlona', 'Verifica cavo HDMI', 'Reset Atlona'],
        },
        {
          id: `sol-${city}-cave-nuc`, name: 'Cave – NUC',
          desc: 'Verificare che il NUC della Cave sia attivo e raggiungibile.',
          quickFixes: ['Riavvio NUC', 'Verifica alimentazione', 'Ping NUC da regia'],
        },
      ]
    },
    {
      section: 'Totem',
      icon: '📺',
      items: [
        {
          id: `sol-${city}-totem-sorgenti`, name: 'Totem – Sorgenti',
          desc: 'Verifica cambio sorgenti del Totem.',
          quickFixes: ['Riavvio Atlona Totem', 'Verifica cavi', 'Reset sorgente'],
        },
        {
          id: `sol-${city}-totem-schermo`, name: 'Totem – Schermo',
          desc: 'Verifica riproduzione contenuto a tutto schermo sul Totem.',
          quickFixes: ['Riavvio Totem', 'Verifica ingresso HDMI', 'Riavvio Pixera'],
        },
        {
          id: `sol-${city}-totem-audio`, name: 'Totem – Audio',
          desc: 'Riproduzione con audio sul Totem.',
          quickFixes: ['Alzare volume', 'Verifica cavi audio', 'Riavvio sistema audio'],
        },
        {
          id: `sol-${city}-totem-pixera`, name: 'Totem – Pixera',
          desc: 'Cambio contenuto tramite Pixera sul Totem.',
          quickFixes: ['Riavvio Pixera', 'Ricarica timeline Totem'],
        },
        {
          id: `sol-${city}-totem-atlona`, name: 'Totem – Atlona',
          desc: 'Collegamento PC esterno tramite Atlona al Totem.',
          quickFixes: ['Riavvio Atlona', 'Verifica cavo HDMI'],
        },
        {
          id: `sol-${city}-totem-nuc`, name: 'Totem – NUC',
          desc: 'NUC del Totem attivo e raggiungibile.',
          quickFixes: ['Riavvio NUC', 'Verifica alimentazione'],
        },
      ]
    },
    {
      section: 'Agorà',
      icon: '🎥',
      items: [
        {
          id: `sol-${city}-agora-sorgenti`, name: 'Agorà – Sorgenti',
          desc: 'Verifica cambio sorgenti nell\'Agorà.',
          quickFixes: ['Riavvio Atlona Agorà', 'Verifica cavi', 'Reset sorgente'],
        },
        {
          id: `sol-${city}-agora-proiettori`, name: 'Agorà – Proiettori',
          desc: 'Verifica riproduzione contenuto a tutto schermo sui proiettori dell\'Agorà.',
          quickFixes: ['Riavvio proiettore', 'Verifica lampada/LED', 'Verifica segnale HDMI', 'Riavvio Pixera Agorà'],
        },
        {
          id: `sol-${city}-agora-audio`, name: 'Agorà – Audio',
          desc: 'Riproduzione audio nell\'Agorà.',
          quickFixes: ['Alzare volume', 'Verifica cavi audio', 'Riavvio amplificatore'],
        },
        {
          id: `sol-${city}-agora-mic`, name: 'Agorà – Microfono',
          desc: 'Test microfono nell\'Agorà.',
          quickFixes: ['Batterie microfono', 'Cambio canale RF', 'Verifica ricevitore'],
        },
        {
          id: `sol-${city}-agora-pixera`, name: 'Agorà – Pixera',
          desc: 'Cambio contenuto tramite Pixera nell\'Agorà.',
          quickFixes: ['Riavvio Pixera', 'Ricarica timeline Agorà'],
        },
        {
          id: `sol-${city}-agora-atlona`, name: 'Agorà – Atlona',
          desc: 'Collegamento PC esterno nell\'Agorà.',
          quickFixes: ['Riavvio Atlona', 'Verifica cavi HDMI'],
        },
        {
          id: `sol-${city}-agora-nuc`, name: 'Agorà – NUC',
          desc: 'NUC Agorà attivo e raggiungibile.',
          quickFixes: ['Riavvio NUC', 'Verifica alimentazione', 'Ping NUC'],
        },
      ]
    },
    {
      section: 'Ingresso',
      icon: '🚪',
      items: [
        {
          id: `sol-${city}-ingresso-schermo`, name: 'Ingresso – Schermo',
          desc: 'Verificare che lo schermo dell\'ingresso riproduca il contenuto a tutto schermo correttamente.',
          quickFixes: ['Riavvio schermo', 'Verifica alimentazione', 'Verifica HDMI', 'Cambio sorgente'],
        },
      ]
    },
  ];
}

function getCheckItemsArmonia() {
  return [
    {
      section: 'Armonia AI',
      icon: '🤖',
      items: [
        {
          id: 'arm-attivazione', name: 'Attivazione Vocale',
          desc: 'Dire "Ciao Armonia" ad alta voce e verificare che Armonia risponda con animazione e audio entro 3 secondi.',
          quickFixes: ['Riavvio applicazione Armonia', 'Verifica microfoni attivi', 'Riavvio server AI', 'Verifica connessione internet'],
        },
        {
          id: 'arm-risposta', name: 'Risposta Vocale',
          desc: 'Fare una domanda generica (es. "Come stai?") e verificare che Armonia risponda vocalmente in modo coerente.',
          quickFixes: ['Riavvio sintesi vocale', 'Verifica volume altoparlanti', 'Riavvio applicazione Armonia'],
        },
        {
          id: 'arm-avatar', name: 'Animazione Avatar',
          desc: 'Verificare che l\'avatar si animi correttamente mentre Armonia risponde (lip sync e movimento).',
          quickFixes: ['Riavvio rendering avatar', 'Verifica GPU', 'Riavvio applicazione Armonia'],
        },
        {
          id: 'arm-preset', name: 'Comando Preset',
          desc: 'Chiedere ad Armonia di cambiare il preset stanza (es. "Armonia, cambia preset riunione") e verificare il cambio.',
          quickFixes: ['Verificare integrazione webapp', 'Riavvio Armonia', 'Verifica connessione al sistema luci'],
        },
        {
          id: 'arm-sfondo', name: 'Comando Sfondo',
          desc: 'Chiedere ad Armonia di cambiare sfondo (es. "Armonia, metti il bosco") e verificare che il LED Wall si aggiorni.',
          quickFixes: ['Verifica connessione Pixera', 'Riavvio Armonia', 'Riavvio Pixera', 'Verifica OSC/WebSocket'],
        },
        {
          id: 'arm-luminosita', name: 'Comando Luminosità',
          desc: 'Chiedere di alzare/abbassare luminosità, volume o luci e verificare la risposta del sistema.',
          quickFixes: ['Verifica integrazione Madrix', 'Riavvio sistema luci', 'Riavvio Armonia'],
        },
        {
          id: 'arm-spegnimento', name: 'Spegnimento Controllato',
          desc: 'Verificare che Armonia risponda al comando "Armonia spegniti" e che il sistema si spenga correttamente (non prima).',
          quickFixes: ['Riavvio applicazione', 'Verifica log di sistema'],
        },
      ]
    },
    {
      section: 'Unreal 3D',
      icon: '🌳',
      items: [
        {
          id: 'unr-vis', name: 'Visualizzazione Scenario',
          desc: 'Verificare che lo scenario Unreal Engine sia visualizzato correttamente su tutti i pannelli LED senza artefatti.',
          quickFixes: ['Riavvio Unreal Engine', 'Verifica GPU/VRAM', 'Riavvio NUC rendering', 'Verifica output video'],
        },
        {
          id: 'unr-meteo', name: 'Cambio Meteo',
          desc: 'Verificare che sia possibile cambiare il meteo dello scenario (soleggiato → nuvoloso → pioggia).',
          quickFixes: ['Riavvio Unreal', 'Verifica parametri Blueprint', 'Riavvio connessione OSC'],
        },
        {
          id: 'unr-orario', name: 'Cambio Orario',
          desc: 'Verificare che sia possibile cambiare l\'orario dello scenario (alba → giorno → tramonto → notte).',
          quickFixes: ['Riavvio Unreal', 'Verifica controllo time-of-day', 'Riavvio OSC'],
        },
        {
          id: 'unr-webapp', name: 'Controllo da WebApp',
          desc: 'Verificare che lo scenario sia controllabile dalla webapp (cambio preset, meteo, orario).',
          quickFixes: ['Verifica connessione webapp-Unreal', 'Riavvio server WebSocket', 'Riavvio webapp'],
        },
      ]
    },
    {
      section: 'Madrix / Luci',
      icon: '💡',
      items: [
        {
          id: 'mad-strip', name: 'Strip LED – Coerenza',
          desc: 'Verificare che le strip LED riflettano lo scenario/sfondo attuale con colori e animazioni coerenti.',
          quickFixes: ['Riavvio Madrix', 'Verifica connessione DMX', 'Ricaricare preset Madrix', 'Verifica alimentazione strip'],
        },
        {
          id: 'mad-tav', name: 'Tavoli – Luci e Controllo',
          desc: 'Verificare che i tavoli cambino effetti luminosi sia tramite webapp che tramite comando vocale.',
          quickFixes: ['Riavvio controller tavolo', 'Verifica collegamento USB/DMX', 'Ricollegare tavolo', 'Verifica Madrix'],
        },
        {
          id: 'mad-hdmi', name: 'Tavoli – HDMI/USB-C',
          desc: 'Verificare che gli ingressi HDMI e USB-C dei tavoli condividano correttamente audio e video.',
          quickFixes: ['Verifica cavo HDMI', 'Verifica USB-C Alt Mode', 'Riavvio switch HDMI tavolo', 'Test con altro PC'],
        },
        {
          id: 'mad-prese', name: 'Prese di Corrente Tavoli',
          desc: 'Verificare che tutte le prese di corrente sui tavoli siano funzionanti.',
          quickFixes: ['Verifica interruttore differenziale', 'Test con dispositivo diverso', 'Verifica cablaggio tavolo'],
        },
      ]
    },
    {
      section: 'Web App',
      icon: '🌐',
      items: [
        {
          id: 'wa-nav', name: 'Navigazione WebApp',
          desc: 'Verificare che tutti i tasti della webapp portino alle pagine corrette e che non ci siano errori.',
          quickFixes: ['Ricaricare pagina', 'Svuotare cache', 'Riavvio server webapp', 'Verifica rete'],
        },
        {
          id: 'wa-stanza', name: 'Controlli Stanza',
          desc: 'Verificare che dalla webapp sia possibile modificare luminosità, volume e potenza luci con effetto immediato.',
          quickFixes: ['Verifica integrazione Madrix', 'Riavvio webapp', 'Verifica WebSocket attivo'],
        },
        {
          id: 'wa-sfondi', name: 'Sfondi e LED Wall',
          desc: 'Selezionare uno sfondo dalla webapp e verificare che appaia sia nella pagina home che sul LED Wall.',
          quickFixes: ['Verifica connessione Pixera', 'Riavvio Pixera', 'Verifica trigger webapp→Pixera'],
        },
        {
          id: 'wa-sync', name: 'Sync Real-time con Armonia AI',
          desc: 'Verificare che la webapp si aggiorni in tempo reale quando Armonia cambia parametri con comandi vocali.',
          quickFixes: ['Verifica WebSocket server', 'Riavvio connessione real-time', 'Riavvio Armonia', 'Ricarica webapp'],
        },
      ]
    },
    {
      section: 'Connettività & Comfort',
      icon: '🔌',
      items: [
        {
          id: 'arm-rete', name: 'Rete / Internet',
          desc: 'Verificare connessione internet stabile. Attenzione: verificare anche dopo eventuali problemi Vodafone segnalati.',
          quickFixes: ['Riavvio router Vodafone', 'Test ping esterno', 'Verifica LAN interna', 'Contattare Vodafone se necessario'],
        },
        {
          id: 'arm-clima', name: 'Clima',
          desc: 'Verificare che la climatizzazione sia funzionante e impostata a temperatura adeguata per l\'uso della sala.',
          quickFixes: ['Accendere manualmente climatizzatore', 'Verifica impostazione temperatura', 'Contattare manutenzione edificio'],
        },
        {
          id: 'arm-pulizia', name: 'Pulizia Sala',
          desc: 'Verificare che la sala sia pulita, in ordine e pronta per l\'utilizzo da parte degli utenti.',
          quickFixes: ['Contattare servizio pulizie', 'Sistemare manualmente', 'Segnalare a referente Deloitte'],
        },
      ]
    },
  ];
}

// ── DEMO USERS ──
// ⚠️ ATTENZIONE: questo file è PUBBLICO (repo su GitHub Pages).
// NON inserire qui password reali o personali.
// Queste sono credenziali DEMO usa-e-getta, valide solo con DEMO_MODE=true.
// In produzione impostare DEMO_MODE=false: l'autenticazione passa da Supabase
// e le password reali vivono solo lì (mai nel codice).
const DEMO_USERS = [
  { email: 'marco.manfredini@area62.it', password: 'area62', name: 'Marco Manfredini', role: 'admin', avatar: 'MM' },
];

// ── LOCAL STORAGE KEYS ──
const LS = {
  user:     'dlt_user',
  checks:   'dlt_checks',
  bookings: 'dlt_bookings',
  tickets:  'dlt_tickets',
  maint:    'dlt_maintenance',
};
