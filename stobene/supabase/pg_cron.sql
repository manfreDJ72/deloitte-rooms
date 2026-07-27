-- ============================================================
-- Sto Bene — Setup pg_cron per allerte check-in mancati
-- ============================================================
-- Da eseguire una volta sola nel SQL editor di Supabase.
-- Prerequisiti:
--   1. Abilita pg_cron: Database → Extensions → pg_cron → Enable
--   2. Deploy dell'edge function check-missed
--   3. Prendi la URL della function e la service_role key:
--        SUPABASE_URL              = https://<project>.supabase.co
--        SUPABASE_SERVICE_ROLE_KEY = da Settings → API
--   4. Sostituisci i placeholder qui sotto
--
-- Il job gira ogni 15 minuti. La function stessa fa da idempotency
-- (missed_alerts.unique(user_id, for_local_day) impedisce doppie email).
-- ============================================================

-- Abilita l'estensione se non l'hai fatto dal UI
create extension if not exists pg_cron;
create extension if not exists pg_net;   -- per net.http_post

-- Rimuovi il vecchio schedule se esiste
select cron.unschedule('stobene-check-missed')
where exists (select 1 from cron.job where jobname = 'stobene-check-missed');

-- Schedula: ogni 15 minuti
select cron.schedule(
  'stobene-check-missed',
  '*/15 * * * *',
  $$
    select net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/check-missed',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>'
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $$
);

-- Per vedere i job attivi
-- select * from cron.job;
-- Per vedere gli ultimi run
-- select * from cron.job_run_details order by start_time desc limit 20;


-- ============================================================
-- RPC helper: conta i check-in per giorno locale
-- (usata da check-missed per una query più efficiente)
-- ============================================================
create or replace function public.count_checkins_on_local_day(
  p_user_id uuid,
  p_local_day date
) returns integer
language plpgsql
security definer
as $$
declare
  v_tz text;
  v_count integer;
begin
  select reminder_timezone into v_tz
    from public.profiles where user_id = p_user_id;
  if v_tz is null then v_tz := 'Europe/Rome'; end if;

  select count(*) into v_count
  from public.checkins
  where user_id = p_user_id
    and (at at time zone v_tz)::date = p_local_day;

  return v_count;
end;
$$;

grant execute on function public.count_checkins_on_local_day(uuid, date) to service_role;
