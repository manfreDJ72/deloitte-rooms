/* ================================================================
 * tour.js — Tour guidato di primo accesso (skippabile) + Guida/Tutorial
 * Zero dipendenze. Si auto-inietta: stili, pulsante "❓" nell'header,
 * avvio automatico al primo login sulla dashboard.
 * API globali: window.startTour(), window.openGuida()
 * ================================================================ */
(function () {
  'use strict';
  if (window.__tourLoaded) return; window.__tourLoaded = true;
  const DONE_KEY = 'dlt_tour_done';

  /* ── STILI ── */
  const css = `
  .tour-ov{position:fixed;inset:0;z-index:3000;display:none}
  .tour-ov.on{display:block}
  .tour-spot{position:absolute;border-radius:10px;box-shadow:0 0 0 9999px rgba(6,10,8,.80);transition:all .25s ease;pointer-events:none}
  .tour-pop{position:absolute;z-index:3001;max-width:320px;background:var(--bg-card,#161616);border:1.5px solid var(--green,#86BC25);border-radius:12px;padding:16px 18px;box-shadow:0 14px 44px rgba(0,0,0,.55)}
  .tour-pop h4{margin:0 0 6px;font-size:15px;color:var(--green,#86BC25)}
  .tour-pop p{margin:0 0 14px;font-size:13.5px;line-height:1.55;color:var(--text,#e6e6e6)}
  .tour-nav{display:flex;align-items:center;gap:10px;justify-content:space-between}
  .tour-dots{display:flex;gap:5px}
  .tour-dot{width:6px;height:6px;border-radius:50%;background:#555}.tour-dot.on{background:var(--green,#86BC25)}
  .tour-btns{display:flex;gap:8px}
  .tour-b{font-size:12.5px;font-weight:600;border:1px solid var(--border,#333);background:transparent;color:var(--text-muted,#aaa);border-radius:8px;padding:7px 13px;cursor:pointer}
  .tour-b.primary{background:var(--green,#86BC25);color:#0b0b0b;border-color:var(--green,#86BC25)}
  .tour-skip{position:fixed;top:14px;right:16px;z-index:3002;font-size:12px;color:#ddd;background:rgba(0,0,0,.5);border:1px solid #555;border-radius:20px;padding:6px 13px;cursor:pointer}
  .tour-center{position:fixed;inset:0;z-index:3001;display:flex;align-items:center;justify-content:center}
  .tour-center .tour-pop{position:relative;max-width:440px;text-align:center}
  .tour-center .tour-pop .tour-nav{justify-content:center;margin-top:4px}
  .tour-ring{width:46px;height:46px;border-radius:50%;margin:0 auto 12px;background:transparent;border:3px solid #a6e35c;box-shadow:0 0 14px 2px rgba(134,188,37,.8),inset 0 0 9px rgba(134,188,37,.75)}
  /* Guida */
  .guide-ov{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:2900;display:none;align-items:center;justify-content:center;padding:24px}
  .guide-ov.on{display:flex}
  .guide-modal{background:var(--bg-card,#161616);border:1px solid var(--border,#333);border-radius:14px;width:min(760px,96%);max-height:88vh;display:flex;flex-direction:column;overflow:hidden}
  .guide-head{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--border,#333)}
  .guide-head h3{margin:0;font-size:16px;font-weight:800;flex:1}
  .guide-x{background:none;border:none;color:var(--text-muted,#aaa);font-size:22px;cursor:pointer;line-height:1}
  .guide-body{padding:16px 20px;overflow:auto}
  .guide-replay{width:100%;border:1px dashed var(--green,#86BC25);background:rgba(134,188,37,.08);color:var(--green,#86BC25);border-radius:10px;padding:11px;font-weight:700;font-size:13.5px;cursor:pointer;margin-bottom:16px}
  .guide-item{border:1px solid var(--border,#333);border-radius:10px;margin-bottom:10px;overflow:hidden}
  .guide-q{display:flex;align-items:center;gap:12px;padding:13px 15px;cursor:pointer;font-weight:700;font-size:14px;user-select:none}
  .guide-q .gi-ico{font-size:18px;width:22px;text-align:center}
  .guide-q .gi-arrow{margin-left:auto;color:var(--text-faint,#666);transition:transform .2s}
  .guide-item.open .gi-arrow{transform:rotate(180deg)}
  .guide-a{display:none;padding:2px 16px 16px 49px;font-size:13.5px;line-height:1.65;color:var(--text-muted,#aaa)}
  .guide-item.open .guide-a{display:block}
  .guide-a ol{margin:4px 0;padding-left:18px}.guide-a li{margin:5px 0}
  .guide-a b{color:var(--text,#e6e6e6)}
  .help-btn{background:none;border:none;color:var(--text-muted,#aaa);font-size:17px;cursor:pointer;padding:4px 7px;border-radius:8px}
  .help-btn:hover{color:var(--green,#86BC25);background:rgba(134,188,37,.1)}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ── STEP DEL TOUR ── */
  const steps = [
    { center:true, title:'Benvenuto in Room Management', body:'Il portale <b>Area62</b> per gestire le sale immersive Deloitte <b>Solaria</b> e <b>Armonia</b>. Ti mostro in mezzo minuto le sezioni principali — puoi saltare quando vuoi.' },
    { sel:'a[href="booking.html"]',   title:'📅 Prenotazioni', body:'Prenoti le sale con calendario Settimana/Mese, allestimento e partecipanti. Si può prenotare anche via email.' },
    { sel:'a[href="checks.html"]',    title:'✓ Check Mattutini', body:'La verifica giornaliera di tutti i sistemi. Se un check fallisce, apri subito un\'anomalia direttamente dal check.' },
    { sel:'a[href="tickets.html"]',   title:'⚠ Anomalie', body:'Segnali guasti e segui gli SLA contrattuali. Da qui nasce il Rapporto di Intervento.' },
    { sel:'a[href="richieste.html"]', title:'📨 Richieste', body:'Le call del giovedì con report e task, più le richieste speciali software (webapp) e hardware (STS).' },
    { sel:'a[href="documenti.html"]', title:'🗄 Documenti', body:'Archivio di contratti, rapporti, materiali e <b>preventivi</b> (con approvazione). Visualizzi tutto dentro il portale.' },
    { sel:'a[href="assistente.html"]',title:'🟢 ArmonIA', body:'Il tuo assistente AI: legge dati e contratto, risponde anche a voce, rileva cosa manca e prepara i preventivi.' },
    { center:true, title:'Tutto qui!', body:'Ritrovi questa guida e i tutorial quando vuoi cliccando <b>❓</b> in alto a destra. Buon lavoro con ArmonIA!' },
  ];

  /* ── TUTORIAL (Guida) ── */
  const guides = [
    { ico:'📅', q:'Prenotare una sala', a:`<ol>
      <li>Apri <b>Prenotazioni</b> e scegli la vista <b>Settimana</b> o <b>Mese</b> (con "Oggi" torni alla data odierna).</li>
      <li>Clicca su uno slot libero (o su "+ Nuova prenotazione").</li>
      <li>Compila sala, data/orario, referente, partecipanti e l'<b>allestimento</b> (il materiale che serve in sala).</li>
      <li>Se serve materiale creativo, attiva <b>Supporto creativo</b> e descrivilo: ArmonIA lo terrà d'occhio.</li>
      <li>Salva. In alternativa invia una email a <b>deloitte.room@area62.it</b> con la parola "prenotazione", la sala e la data: la prenotazione viene creata da sola e ricevi conferma.</li></ol>` },
    { ico:'✓', q:'Check mattutino e segnalazione anomalia', a:`<ol>
      <li>Apri <b>Check Mattutini</b> e seleziona la sala.</li>
      <li>Scorri le voci per sezione: segna <b>OK</b> ciò che funziona.</li>
      <li>Se qualcosa non va, segna <b>KO</b>: compaiono le soluzioni rapide suggerite.</li>
      <li>Se non si risolve, dal check apri direttamente un'<b>anomalia</b> (ticket) con priorità.</li>
      <li>Al termine il report giornaliero può essere inviato ai destinatari configurati.</li></ol>` },
    { ico:'⚠', q:'Gestire un\'anomalia e gli SLA', a:`<ol>
      <li>In <b>Anomalie</b> apri un ticket indicando sala, <b>priorità</b> (P1–P4) e descrizione.</li>
      <li>Ogni priorità ha i suoi <b>SLA</b> contrattuali (contatto, intervento, ripristino): il portale mostra il tempo residuo.</li>
      <li>Aggiorna lo stato: <b>aperto → in lavorazione → risolto</b>, annotando le azioni.</li>
      <li>Se serve un intervento tecnico, genera il <b>Rapporto di Intervento</b> collegato.</li></ol>` },
    { ico:'🛠', q:'Rapporto di Intervento (apertura → chiusura → PDF)', a:`<ol>
      <li>Crea il rapporto indicando sala, componente, priorità e descrizione: alla creazione parte una <b>prima email</b>.</li>
      <li>Attiva i livelli con i rispettivi timer SLA: <b>Analisi → Intervento remoto → Intervento fisico</b>.</li>
      <li>Per ogni livello annota esito e note.</li>
      <li>Con <b>Chiudi rapporto</b> viene generato il <b>PDF brandizzato</b>, archiviato in Documenti → Rapporti e inviato via email.</li></ol>` },
    { ico:'📨', q:'Call del giovedì e richieste speciali', a:`<ol>
      <li>In <b>Richieste</b>, tab <b>Call del giovedì</b>: crea la call con meeting report e i <b>task</b> tracciati fino al giovedì successivo.</li>
      <li>Tab <b>Richieste speciali</b>: apri richieste <b>software</b> (webapp Area62) o <b>hardware</b> (fornitore STS) con priorità e assegnatario.</li>
      <li>Segui lo stato: nuova → in corso → completata.</li></ol>` },
    { ico:'🗄', q:'Documenti e Preventivi', a:`<ol>
      <li>In <b>Documenti</b> scegli la categoria e <b>trascina</b> file o intere cartelle per caricarli in blocco.</li>
      <li>Ogni documento ha <b>👁 Visualizza</b> (anteprima nel portale: PDF, Word, immagini, preventivi), <b>Scarica</b> ed elimina.</li>
      <li>I <b>Preventivi</b> hanno il badge <b>Approvato / Non approvato</b>: puoi <b>Modificare</b> la bozza e poi <b>Approvarla</b>.</li>
      <li>ArmonIA può creare da sola una bozza di preventivo quando una richiesta è fuori contratto.</li></ol>` },
    { ico:'🟢', q:'Usare ArmonIA (assistente AI)', a:`<ol>
      <li>Apri <b>ArmonIA</b>: a sinistra il <b>Monitoraggio</b> (cosa non va / cosa manca), a destra la <b>chat</b>.</li>
      <li>Scrivi o <b>detta</b> (🎤) la domanda; con 🗣️ attivi la <b>modalità conversazione</b> a mani libere.</li>
      <li>ArmonIA legge dal vivo prenotazioni, ticket, check, mail e i <b>documenti</b> (contratto incluso): chiedi "cosa non funziona oggi?" o "cosa dice il contratto su…".</li>
      <li>Se una richiesta è fuori contratto, la segnala e prepara la bozza di <b>preventivo</b> in Documenti.</li></ol>` },
    { ico:'⚙', q:'Impostazioni: ruoli, destinatari, reminder', a:`<ol>
      <li>In <b>Settings</b> gestisci gli <b>utenti</b> e i <b>ruoli</b> (Admin, Operatore/Visualizzatore · Cliente/Agenzia) con la matrice dei permessi — incluse le <b>cartelle</b> visibili e l'accesso ad ArmonIA.</li>
      <li>Imposti i <b>destinatari</b> delle notifiche per ogni evento.</li>
      <li>Configuri i <b>reminder</b> pre-evento, la risposta automatica alle email e l'ora del <b>riepilogo giornaliero</b>.</li></ol>` },
  ];

  /* ── ENGINE TOUR ── */
  let idx = 0, ov, spot, pop, skip, centerWrap;
  function build() {
    ov = document.createElement('div'); ov.className = 'tour-ov';
    spot = document.createElement('div'); spot.className = 'tour-spot';
    skip = document.createElement('button'); skip.className = 'tour-skip'; skip.textContent = 'Salta il tour ✕';
    skip.onclick = finish;
    ov.appendChild(spot); ov.appendChild(skip);
    document.body.appendChild(ov);
  }
  function popHtml(s) {
    const dots = steps.map((_, i) => `<span class="tour-dot ${i === idx ? 'on' : ''}"></span>`).join('');
    const last = idx === steps.length - 1;
    return `${s.center ? '<div class="tour-ring"></div>' : ''}<h4>${s.title}</h4><p>${s.body}</p>
      <div class="tour-nav"><div class="tour-dots">${dots}</div>
      <div class="tour-btns">
        ${idx > 0 ? '<button class="tour-b" data-a="prev">Indietro</button>' : ''}
        <button class="tour-b primary" data-a="next">${last ? 'Fine' : 'Avanti'}</button>
      </div></div>`;
  }
  function clearPop() { if (pop) pop.remove(); pop = null; if (centerWrap) centerWrap.remove(); centerWrap = null; }
  function show() {
    const s = steps[idx];
    clearPop();
    if (s.center || !document.querySelector(s.sel)) {
      spot.style.opacity = '0';
      centerWrap = document.createElement('div'); centerWrap.className = 'tour-center';
      const card = document.createElement('div'); card.className = 'tour-pop'; card.innerHTML = popHtml(s);
      centerWrap.appendChild(card); ov.appendChild(centerWrap);
      card.querySelectorAll('[data-a]').forEach(b => b.onclick = () => act(b.dataset.a));
      return;
    }
    spot.style.opacity = '1';
    const el = document.querySelector(s.sel);
    const r = el.getBoundingClientRect();
    const pad = 6;
    spot.style.left = (r.left - pad) + 'px'; spot.style.top = (r.top - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (r.height + pad * 2) + 'px';
    pop = document.createElement('div'); pop.className = 'tour-pop'; pop.innerHTML = popHtml(s);
    ov.appendChild(pop);
    // posiziona sotto l'elemento, allineato e dentro la finestra
    let top = r.bottom + 12, left = Math.min(Math.max(8, r.left), window.innerWidth - pop.offsetWidth - 8);
    if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 12);
    pop.style.top = top + 'px'; pop.style.left = left + 'px';
    pop.querySelectorAll('[data-a]').forEach(b => b.onclick = () => act(b.dataset.a));
  }
  function act(a) { if (a === 'next') { if (idx === steps.length - 1) return finish(); idx++; show(); } else { idx--; show(); } }
  function finish() { try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {} clearPop(); if (ov) ov.classList.remove('on'); }
  window.startTour = function () { if (!ov) build(); idx = 0; ov.classList.add('on'); show(); };

  /* ── GUIDA ── */
  let gov;
  function buildGuida() {
    gov = document.createElement('div'); gov.className = 'guide-ov';
    const items = guides.map((g, i) => `
      <div class="guide-item" data-i="${i}">
        <div class="guide-q"><span class="gi-ico">${g.ico}</span><span>${g.q}</span><span class="gi-arrow">▾</span></div>
        <div class="guide-a">${g.a}</div>
      </div>`).join('');
    gov.innerHTML = `<div class="guide-modal">
      <div class="guide-head"><span class="gi-ico" style="font-size:20px">📖</span><h3>Guida &amp; Tutorial</h3><button class="guide-x">✕</button></div>
      <div class="guide-body">
        <button class="guide-replay">▶ Rivedi il tour guidato</button>
        ${items}
      </div></div>`;
    document.body.appendChild(gov);
    gov.querySelector('.guide-x').onclick = () => gov.classList.remove('on');
    gov.onclick = e => { if (e.target === gov) gov.classList.remove('on'); };
    gov.querySelector('.guide-replay').onclick = () => { gov.classList.remove('on'); window.startTour(); };
    gov.querySelectorAll('.guide-item').forEach(it => it.querySelector('.guide-q').onclick = () => it.classList.toggle('open'));
  }
  window.openGuida = function () { if (!gov) buildGuida(); gov.classList.add('on'); };

  /* ── INIETTA PULSANTE "❓" + AVVIO AUTOMATICO ── */
  function init() {
    const right = document.querySelector('.header-right');
    if (right && !document.querySelector('.help-btn')) {
      const b = document.createElement('button');
      b.className = 'help-btn'; b.title = 'Guida e tour'; b.textContent = '❓';
      b.onclick = window.openGuida;
      right.insertBefore(b, right.firstChild);
    }
    // primo login: sulla dashboard, se non ancora visto → avvia
    let done = false; try { done = localStorage.getItem(DONE_KEY) === '1'; } catch (e) {}
    const onDash = location.pathname.endsWith('dashboard.html');
    const logged = (typeof currentUser === 'function') && currentUser();
    if (!done && onDash && logged) setTimeout(window.startTour, 900);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
