/* ── REPORT ATTIVITÀ (PDF) ─────────────────────────────────────────────
   Modulo condiviso: aggiunge un bottone "Report attività (PDF)" alle pagine
   Anomalie / Richieste / Task, con selezione del periodo. Genera un documento
   stampabile (stile report/preventivo) che aggrega Manutenzioni + Anomalie +
   Richieste + Task del periodo, per dimostrare il volume di lavoro svolto.
   Stampa via window.print() → Salva come PDF.
*/
(function () {
  'use strict';

  /* ---------- helpers ---------- */
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseD = s => { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d; };
  const itD = s => { const d = parseD(s); return d ? d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'; };
  const itDT = s => { const d = parseD(s); return d ? d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '—'; };
  const esc = s => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function weekMonday(base) { const d = new Date(base); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); d.setHours(0, 0, 0, 0); return d; }
  function roomLabel(id) { try { const r = (typeof ROOMS !== 'undefined' ? ROOMS : []).find(x => x.id === id); return r ? `${r.name} · ${r.city}` : (id || '—'); } catch { return id || '—'; } }

  const STATO_TASK = { 'da-fare': 'Da fare', 'in-corso': 'In corso', 'completato': 'Completato' };
  const STATO_REQ = { nuova: 'Nuova', 'in-corso': 'In lavorazione', completata: 'Completata' };
  const STATO_TCK = { open: 'Aperta', 'in-corso': 'In corso', resolved: 'Risolta', closed: 'Chiusa' };

  /* ---------- stile (iniettato) ---------- */
  const style = document.createElement('style');
  style.textContent = `
  .rep-bar { display:flex; justify-content:flex-end; margin:-4px 0 14px; }
  .rep-overlay { position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:400; display:none; align-items:flex-start; justify-content:center; overflow:auto; padding:24px 12px; }
  .rep-overlay.open { display:flex; }
  .rep-pmodal { background:var(--bg-card,#111); border:1.5px solid var(--border,#2a2a2a); border-radius:14px; width:100%; max-width:460px; overflow:hidden; }
  .rep-pm-head { display:flex; align-items:center; justify-content:space-between; padding:15px 18px; border-bottom:1px solid var(--border,#2a2a2a); font-weight:800; }
  .rep-pm-head button { background:none; border:none; color:var(--text-muted,#888); font-size:18px; cursor:pointer; }
  .rep-pm-body { padding:16px 18px; }
  .rep-presets { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
  .rep-preset { font-size:12px; font-weight:700; padding:6px 12px; border-radius:20px; border:1px solid var(--border,#2a2a2a); background:var(--bg-card2,#1a1a1a); color:var(--text-muted,#888); cursor:pointer; }
  .rep-preset.active { background:var(--green,#86BC25); color:#0a0a0a; border-color:var(--green,#86BC25); }
  .rep-daterow { display:flex; gap:10px; margin-bottom:14px; }
  .rep-daterow > div { flex:1; }
  .rep-daterow label { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--text-muted,#888); margin-bottom:5px; }
  .rep-daterow input { width:100%; padding:9px 10px; border-radius:8px; border:1px solid var(--border,#2a2a2a); background:var(--bg-card2,#1a1a1a); color:var(--text,#f0f0f0); }
  .rep-checks { display:flex; flex-direction:column; gap:8px; padding-top:6px; border-top:1px solid var(--border,#2a2a2a); }
  .rep-checks label { display:flex; align-items:center; gap:9px; font-size:13px; cursor:pointer; }
  .rep-pm-foot { display:flex; justify-content:flex-end; gap:10px; padding:14px 18px; border-top:1px solid var(--border,#2a2a2a); }

  /* ----- foglio report (tema chiaro, per PDF) ----- */
  .rep-viewwrap { width:100%; max-width:820px; }
  .rep-toolbar { display:flex; justify-content:flex-end; gap:10px; margin-bottom:12px; }
  .rep-sheet { background:#ffffff; color:#1a2230; border-radius:10px; padding:34px 38px; box-shadow:0 20px 60px rgba(0,0,0,.4); font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif; }
  .rep-sheet * { box-sizing:border-box; }
  .rep-head { display:flex; align-items:center; justify-content:space-between; border-bottom:3px solid #86BC25; padding-bottom:16px; margin-bottom:4px; gap:16px; }
  .rep-head .rep-logos { display:flex; align-items:center; gap:12px; }
  .rep-head .rep-logos img.a62 { height:30px; }
  .rep-head .rep-logos img.dlt { height:22px; }
  .rep-head .rep-logos .sep { width:1px; height:26px; background:#d5dbe3; }
  .rep-title { text-align:right; }
  .rep-title h1 { margin:0; font-size:19px; font-weight:800; color:#0f1826; }
  .rep-title .sub { font-size:12px; color:#6b7685; margin-top:3px; }
  .rep-period { background:#f4f8ec; border:1px solid #d9e8bf; border-radius:8px; padding:10px 14px; margin:16px 0 20px; font-size:13px; color:#31502a; }
  .rep-period b { color:#2c4a1f; }
  .rep-tiles { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:24px; }
  .rep-tile { border:1px solid #e2e7ee; border-radius:9px; padding:12px 14px; }
  .rep-tile .n { font-size:24px; font-weight:800; color:#0f1826; line-height:1; }
  .rep-tile .l { font-size:11px; color:#6b7685; margin-top:5px; text-transform:uppercase; letter-spacing:.4px; }
  .rep-tile .d { font-size:11px; color:#8a94a3; margin-top:3px; }
  .rep-sec { margin:22px 0; }
  .rep-sec h2 { font-size:13px; text-transform:uppercase; letter-spacing:.6px; color:#86BC25; border-bottom:1px solid #e2e7ee; padding-bottom:6px; margin:0 0 10px; }
  .rep-sec h2 span { color:#9aa4b2; font-weight:600; }
  table.rep-table { width:100%; border-collapse:collapse; font-size:12.5px; }
  table.rep-table th { text-align:left; background:#f4f6f9; color:#4a5563; font-weight:700; padding:7px 9px; border-bottom:1px solid #e2e7ee; font-size:11px; text-transform:uppercase; letter-spacing:.3px; }
  table.rep-table td { padding:7px 9px; border-bottom:1px solid #eef1f5; vertical-align:top; color:#26303d; }
  table.rep-table tr:last-child td { border-bottom:none; }
  .rep-pill { display:inline-block; font-size:11px; font-weight:700; padding:2px 8px; border-radius:20px; }
  .p-alta,.p-p1 { background:#fdecec; color:#c62828; }
  .p-media,.p-p2 { background:#fff3e0; color:#b45309; }
  .p-bassa,.p-p3,.p-p4 { background:#eaf3ff; color:#1d6fd0; }
  .s-done { background:#eaf6e2; color:#3d7a1e; }
  .s-prog { background:#fff3e0; color:#b45309; }
  .s-open { background:#f0f2f5; color:#59626e; }
  .rep-empty { font-size:12.5px; color:#9aa4b2; font-style:italic; padding:4px 0; }
  .rep-foot { margin-top:26px; padding-top:12px; border-top:1px solid #e2e7ee; font-size:11px; color:#9aa4b2; display:flex; justify-content:space-between; }

  /* contenitore di stampa: il foglio viene clonato QUI (in flusso normale, fuori
     dall'overlay fixed) così la stampa può scorrere su più pagine */
  .rep-print-root { display:none; }
  @media print {
    @page { margin:12mm; }
    body { background:#fff !important; }
    body.rep-printing > *:not(.rep-print-root) { display:none !important; }
    .rep-print-root { display:block !important; }
    .rep-print-root .rep-sheet { box-shadow:none !important; border-radius:0; padding:0; }
    .rep-sec { break-inside:auto; }
    table.rep-table tr { break-inside:avoid; }
  }`;

  /* ---------- markup (iniettato una volta) ---------- */
  function injectModals() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div class="rep-overlay" id="rep-period">
      <div class="rep-pmodal">
        <div class="rep-pm-head"><span>📊 Report attività — periodo</span><button id="rep-pclose">✕</button></div>
        <div class="rep-pm-body">
          <div class="rep-presets" id="rep-presets">
            <span class="rep-preset active" data-p="week">Questa settimana</span>
            <span class="rep-preset" data-p="lastweek">Settimana scorsa</span>
            <span class="rep-preset" data-p="month">Questo mese</span>
            <span class="rep-preset" data-p="7">Ultimi 7 giorni</span>
          </div>
          <div class="rep-daterow">
            <div><label>Dal</label><input type="date" id="rep-from"></div>
            <div><label>Al</label><input type="date" id="rep-to"></div>
          </div>
          <div class="rep-checks">
            <label><input type="checkbox" id="rep-c-maint" checked> Manutenzioni (calendario)</label>
            <label><input type="checkbox" id="rep-c-tck" checked> Anomalie / Interventi</label>
            <label><input type="checkbox" id="rep-c-req" checked> Richieste</label>
            <label><input type="checkbox" id="rep-c-task" checked> Task interni</label>
            <label style="margin-top:4px;color:var(--text-muted,#888);font-size:12px;"><input type="checkbox" id="rep-c-tagged" checked> …solo i task contrassegnati per il report</label>
          </div>
        </div>
        <div class="rep-pm-foot">
          <button class="btn btn-outline" id="rep-pcancel">Annulla</button>
          <button class="btn btn-primary" id="rep-gen">Genera report</button>
        </div>
      </div>
    </div>
    <div class="rep-overlay" id="rep-view">
      <div class="rep-viewwrap">
        <div class="rep-toolbar rep-noprint">
          <button class="btn btn-outline" id="rep-vclose">Chiudi</button>
          <button class="btn btn-primary" id="rep-print">🖨 Stampa / Salva PDF</button>
        </div>
        <div class="rep-sheet" id="rep-sheet"></div>
      </div>
    </div>`;
    document.body.appendChild(wrap);
  }

  /* ---------- periodo ---------- */
  function setPreset(p) {
    const now = new Date();
    let from, to;
    if (p === 'week') { from = weekMonday(now); to = new Date(from); to.setDate(from.getDate() + 6); }
    else if (p === 'lastweek') { to = weekMonday(now); to.setDate(to.getDate() - 1); from = new Date(to); from.setDate(to.getDate() - 6); }
    else if (p === 'month') { from = new Date(now.getFullYear(), now.getMonth(), 1); to = new Date(now.getFullYear(), now.getMonth() + 1, 0); }
    else { to = new Date(now); from = new Date(now); from.setDate(now.getDate() - 6); }
    document.getElementById('rep-from').value = ymd(from);
    document.getElementById('rep-to').value = ymd(to);
  }

  /* ---------- generazione ---------- */
  async function generate() {
    const opt = {
      maint: document.getElementById('rep-c-maint').checked,
      tck: document.getElementById('rep-c-tck').checked,
      req: document.getElementById('rep-c-req').checked,
      task: document.getElementById('rep-c-task').checked,
      tagged: document.getElementById('rep-c-tagged').checked,
    };
    const fromV = document.getElementById('rep-from').value;
    const toV = document.getElementById('rep-to').value;
    if (!fromV || !toV) { toast('Seleziona il periodo', 'error'); return; }
    const from = new Date(fromV + 'T00:00:00');
    const to = new Date(toV + 'T23:59:59');
    const inP = s => { const d = parseD(s); return !!d && d >= from && d <= to; };

    const gen = document.getElementById('rep-gen');
    gen.disabled = true; gen.textContent = 'Genero…';
    try {
      const [tickets, tasks, reqs, maints] = await Promise.all([
        db.getTickets ? db.getTickets() : [],
        db.getTasks ? db.getTasks() : [],
        db.getReqspec ? db.getReqspec() : [],
        db.getMaintenance ? db.getMaintenance() : [],
      ]);
      const tk = (opt.tck ? tickets : []).filter(t => inP(t.createdAt) || inP(t.resolvedAt));
      const tks = (opt.task ? tasks : []).filter(t => (opt.tagged ? t.inReport !== false : true) && (inP(t.createdAt) || inP(t.completedAt)));
      const rq = (opt.req ? reqs : []).filter(r => inP(r.createdAt));
      const mt = (opt.maint ? maints : []).filter(m => inP(m.start));
      document.getElementById('rep-sheet').innerHTML = buildHTML({ from, to, tk, tks, rq, mt, opt });
      // nome file per il salvataggio PDF: "Report attività <inizio> - <fine> (generato <oggi>)"
      const fmtF = d => pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear();
      _printTitle = `Report attività ${fmtF(from)} - ${fmtF(to)} (generato ${fmtF(new Date())})`;
      closeP(); document.getElementById('rep-view').classList.add('open');
    } catch (e) {
      console.error('report', e); toast('Errore nella generazione del report', 'error');
    } finally { gen.disabled = false; gen.textContent = 'Genera report'; }
  }

  function tile(n, label, detail) {
    return `<div class="rep-tile"><div class="n">${n}</div><div class="l">${label}</div>${detail ? `<div class="d">${detail}</div>` : ''}</div>`;
  }
  function pill(cls, txt) { return `<span class="rep-pill ${cls}">${esc(txt)}</span>`; }

  function buildHTML({ from, to, tk, tks, rq, mt, opt }) {
    const periodTxt = `${from.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })} — ${to.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    const oggi = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

    const tckAperte = tk.filter(t => { const d = parseD(t.createdAt); return d && d >= from && d <= to; }).length;
    const tckRisolte = tk.filter(t => { const d = parseD(t.resolvedAt); return d && d >= from && d <= to; }).length;
    const taskDone = tks.filter(t => t.stato === 'completato').length;
    const mtStraord = mt.filter(m => /straordinari/i.test((m.title || '') + (m.desc || ''))).length;
    const totale = mt.length + tk.length + rq.length + tks.length;

    let tiles = '';
    if (opt.maint) tiles += tile(mt.length, 'Manutenzioni', `${mt.length - mtStraord} ordinarie · ${mtStraord} straord.`);
    if (opt.tck) tiles += tile(tk.length, 'Anomalie', `${tckAperte} aperte · ${tckRisolte} risolte`);
    if (opt.req) tiles += tile(rq.length, 'Richieste', '');
    if (opt.task) tiles += tile(tks.length, 'Task interni', `${taskDone} completati`);

    const secMaint = !opt.maint ? '' : `
      <div class="rep-sec">
        <h2>Manutenzioni eseguite <span>(${mt.length})</span></h2>
        ${mt.length ? `<table class="rep-table"><thead><tr><th>Data</th><th>Orario</th><th>Sala</th><th>Attività</th></tr></thead><tbody>
        ${mt.sort((a, b) => new Date(a.start) - new Date(b.start)).map(m => `<tr>
          <td>${itD(m.start)}</td>
          <td>${parseD(m.start) ? parseD(m.start).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : ''}–${parseD(m.end) ? parseD(m.end).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : ''}</td>
          <td>${esc(roomLabel(m.room))}</td>
          <td><b>${esc(m.title || '')}</b>${m.desc ? `<br><span style="color:#6b7685;">${esc(m.desc)}</span>` : ''}</td>
        </tr>`).join('')}</tbody></table>` : '<div class="rep-empty">Nessuna manutenzione nel periodo.</div>'}
      </div>`;

    const secTck = !opt.tck ? '' : `
      <div class="rep-sec">
        <h2>Anomalie / Interventi <span>(${tk.length})</span></h2>
        ${tk.length ? `<table class="rep-table"><thead><tr><th>ID</th><th>Sala</th><th>Priorità</th><th>Descrizione</th><th>Stato</th><th>Aperta</th><th>Risolta</th></tr></thead><tbody>
        ${tk.map(t => `<tr>
          <td>${esc(t.id)}</td>
          <td>${esc(roomLabel(t.room))}</td>
          <td>${pill('p-' + String(t.priority || '').toLowerCase(), t.priority || '—')}</td>
          <td>${esc(t.title || '')}${(t.desc || t.noteResidue) ? `<div style="color:#6b7685;font-size:11.5px;margin-top:3px;">${esc([t.desc, t.noteResidue].filter(Boolean).join(' · '))}</div>` : ''}</td>
          <td>${pill(t.status === 'resolved' || t.status === 'closed' ? 's-done' : t.status === 'open' ? 's-open' : 's-prog', STATO_TCK[t.status] || t.status || '—')}</td>
          <td>${itD(t.createdAt)}</td>
          <td>${t.resolvedAt ? itD(t.resolvedAt) : '—'}</td>
        </tr>`).join('')}</tbody></table>` : '<div class="rep-empty">Nessuna anomalia nel periodo.</div>'}
      </div>`;

    const secReq = !opt.req ? '' : `
      <div class="rep-sec">
        <h2>Richieste <span>(${rq.length})</span></h2>
        ${rq.length ? `<table class="rep-table"><thead><tr><th>Num</th><th>Tipo</th><th>Titolo</th><th>Richiedente</th><th>Stato</th><th>Data</th></tr></thead><tbody>
        ${rq.map(r => `<tr>
          <td>${esc(r.num || '—')}</td>
          <td>${r.tipo === 'hardware' ? 'Hardware' : 'Software'}</td>
          <td>${esc(r.title || '')}</td>
          <td>${esc(r.richiedente || '—')}</td>
          <td>${pill(r.stato === 'completata' ? 's-done' : r.stato === 'in-corso' ? 's-prog' : 's-open', STATO_REQ[r.stato] || r.stato || '—')}</td>
          <td>${itD(r.createdAt)}</td>
        </tr>`).join('')}</tbody></table>` : '<div class="rep-empty">Nessuna richiesta nel periodo.</div>'}
      </div>`;

    const secTask = !opt.task ? '' : `
      <div class="rep-sec">
        <h2>Task interni <span>(${tks.length}${opt.tagged ? ' · solo contrassegnati' : ''})</span></h2>
        ${tks.length ? `<table class="rep-table"><thead><tr><th>ID</th><th>App / Ambito</th><th>Descrizione</th><th>Priorità</th><th>Stato</th><th>Completato</th></tr></thead><tbody>
        ${tks.map(t => `<tr>
          <td>${esc(t.id)}</td>
          <td>${esc(t.app || '—')}${t.domain ? ' · ' + esc(t.domain) : ''}</td>
          <td>${esc(t.title || '')}${t.note ? `<div style="color:#6b7685;font-size:11.5px;margin-top:3px;">${esc(t.note)}</div>` : ''}</td>
          <td>${pill('p-' + String(t.priorita || '').toLowerCase(), (t.priorita || '—').charAt(0).toUpperCase() + (t.priorita || '').slice(1))}</td>
          <td>${pill(t.stato === 'completato' ? 's-done' : t.stato === 'in-corso' ? 's-prog' : 's-open', STATO_TASK[t.stato] || t.stato || '—')}</td>
          <td>${t.completedAt ? itD(t.completedAt) : '—'}</td>
        </tr>`).join('')}</tbody></table>` : '<div class="rep-empty">Nessun task nel periodo.</div>'}
      </div>`;

    return `
      <div class="rep-head">
        <div class="rep-logos">
          <img class="a62" src="assets/area62.png" alt="Area62">
          <span class="sep"></span>
          <img class="dlt" src="assets/deloitte-black.svg" alt="Deloitte">
        </div>
        <div class="rep-title">
          <h1>Report Attività</h1>
          <div class="sub">Volume di lavoro — manutenzioni e interventi</div>
        </div>
      </div>
      <div class="rep-period">Periodo di riferimento: <b>${periodTxt}</b> &nbsp;·&nbsp; Documento generato il ${oggi} &nbsp;·&nbsp; <b>${totale}</b> attività totali</div>
      <div class="rep-tiles">${tiles}</div>
      ${secMaint}${secTck}${secReq}${secTask}
      <div class="rep-foot"><span>Area62 Srl · Deloitte Room Management</span><span>Solaria &amp; Armonia · documento riepilogativo</span></div>`;
  }

  /* ---------- stampa (multi-pagina + nome file) ---------- */
  let _printTitle = 'Report attività';
  function printReport() {
    // clona il foglio in un contenitore in flusso normale: dentro l'overlay
    // (position:fixed) il browser stamperebbe UNA sola pagina tagliando il resto
    let root = document.querySelector('.rep-print-root');
    if (!root) { root = document.createElement('div'); root.className = 'rep-print-root'; document.body.appendChild(root); }
    root.innerHTML = '<div class="rep-sheet">' + document.getElementById('rep-sheet').innerHTML + '</div>';
    const origTitle = document.title;
    document.title = _printTitle;                 // il browser lo propone come nome del PDF
    document.body.classList.add('rep-printing');
    const cleanup = () => { document.body.classList.remove('rep-printing'); document.title = origTitle; window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 2000);                    // rete di sicurezza se afterprint non scatta
  }

  /* ---------- wiring ---------- */
  function openP() { setPreset('week'); document.getElementById('rep-period').classList.add('open'); }
  function closeP() { document.getElementById('rep-period').classList.remove('open'); }

  function init() {
    const pageHead = document.querySelector('.page-head');
    if (!pageHead) return; // pagine senza intestazione: niente bottone
    document.head.appendChild(style);
    injectModals();

    const bar = document.createElement('div');
    bar.className = 'rep-bar';
    bar.innerHTML = `<button class="btn btn-outline btn-sm" id="rep-open">📊 Report attività (PDF)</button>`;
    pageHead.insertAdjacentElement('afterend', bar);

    document.getElementById('rep-open').addEventListener('click', openP);
    document.getElementById('rep-pclose').addEventListener('click', closeP);
    document.getElementById('rep-pcancel').addEventListener('click', closeP);
    document.getElementById('rep-gen').addEventListener('click', generate);
    document.getElementById('rep-vclose').addEventListener('click', () => document.getElementById('rep-view').classList.remove('open'));
    document.getElementById('rep-print').addEventListener('click', printReport);
    document.querySelectorAll('#rep-presets .rep-preset').forEach(p => p.addEventListener('click', () => {
      document.querySelectorAll('#rep-presets .rep-preset').forEach(x => x.classList.remove('active'));
      p.classList.add('active'); setPreset(p.dataset.p);
    }));
    [document.getElementById('rep-period'), document.getElementById('rep-view')].forEach(ov =>
      ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); }));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
