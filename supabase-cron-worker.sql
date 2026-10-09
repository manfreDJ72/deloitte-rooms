-- ================================================================
-- TRIGGER AFFIDABILE DEL WORKER EMAIL  (Supabase pg_cron → GitHub Actions)
--
-- Perché: il cron di GitHub Actions (*/5) viene throttlato e gira in ritardo
-- (anche ore). Supabase pg_cron è uno scheduler vero e affidabile: ogni 5
-- minuti chiama GitHub per far partire il worker che svuota la coda email,
-- legge le mail in arrivo e manda reminder/riepiloghi.
--
-- COME USARLO (una volta sola):
--   1) Crea un GitHub Personal Access Token "fine-grained":
--        github.com → Settings → Developer settings → Fine-grained tokens →
--        Generate new token → Repository access: solo "manfreDJ72/deloitte-rooms" →
--        Permissions → Repository permissions → Actions = "Read and write".
--        (Scadenza: metti 1 anno o "No expiration"). Copia il token (ghp_.../github_pat_...).
--   2) Qui sotto sostituisci  <IL_TUO_GITHUB_PAT>  con quel token.
--   3) Incolla TUTTO nel SQL Editor di Supabase e premi RUN.
--
-- Il token resta solo nel tuo database (tabella cron.job), non passa da nessuna chat.
-- ================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- rimuove un'eventuale schedulazione precedente con lo stesso nome
do $$ begin perform cron.unschedule('trigger-email-worker'); exception when others then null; end $$;

-- ogni 5 minuti: chiede a GitHub di eseguire il workflow "Email Worker"
select cron.schedule(
  'trigger-email-worker',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url     := 'https://api.github.com/repos/manfreDJ72/deloitte-rooms/actions/workflows/email-worker.yml/dispatches',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer <IL_TUO_GITHUB_PAT>',
                 'Accept',        'application/vnd.github+json',
                 'User-Agent',    'supabase-cron',
                 'Content-Type',  'application/json'),
    body    := jsonb_build_object('ref', 'main')
  );
  $job$
);

-- verifica: deve comparire il job attivo
select jobid, jobname, schedule, active from cron.job where jobname = 'trigger-email-worker';

-- ── Note ──
-- • Se "create extension pg_cron" dà errore, abilitalo prima da:
--     Database → Extensions → cerca "pg_cron" e "pg_net" → Enable.
-- • Per fermarlo in futuro:   select cron.unschedule('trigger-email-worker');
-- • Il workflow ha già "workflow_dispatch", quindi è triggerabile via API.
-- ================================================================
