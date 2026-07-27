-- ============================================================
-- Sto Bene — Schema database Supabase
-- ============================================================
-- Da eseguire una volta sola nel SQL editor di Supabase:
-- https://supabase.com/dashboard/project/<id>/sql/new
--
-- Contiene:
--   * profiles (impostazioni utente, 1:1 con auth.users)
--   * checkins (storico check-in con esito email)
--   * missed_alerts (allerte email inviate quando salta un check-in)
--   * RLS: ogni utente vede/modifica solo i propri dati
--   * Trigger: auto-crea profile quando un utente si registra
-- ============================================================

-- ------------------------------------------------------------
-- Tabella: profiles
-- ------------------------------------------------------------
create table if not exists public.profiles (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  name               text,                          -- Es. "Emilia"
  contact_name       text,                          -- Es. "Marco"
  contact_email      text,                          -- Sempre richiesto (alert automatici)
  contact_phone      text,                          -- Per WhatsApp/SMS opzionali
  method             text not null default 'email', -- 'whatsapp' | 'sms' | 'email'
  message_template   text default 'Sto bene! ❤️',
  reminder_time      time not null default '10:00', -- Ora locale del promemoria giornaliero
  reminder_timezone  text not null default 'Europe/Rome',
  alert_after_min    integer not null default 60,   -- Minuti di ritardo prima di allertare il contatto
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table  public.profiles is 'Impostazioni utente Sto Bene (1:1 con auth.users)';
comment on column public.profiles.method is 'Canale primario: whatsapp/sms aprono app nativa; email viene inviata via Resend';
comment on column public.profiles.alert_after_min is 'Se non c''è check-in entro reminder_time + N minuti, si allerta il contatto';

-- ------------------------------------------------------------
-- Tabella: checkins
-- ------------------------------------------------------------
create table if not exists public.checkins (
  id               bigserial primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  at               timestamptz not null default now(),
  method_used      text not null,           -- 'email' | 'whatsapp' | 'sms'
  message          text,
  email_sent       boolean,                 -- null se metodo != email
  email_message_id text,                    -- Id restituito da Resend
  email_error      text,                    -- Testo errore se email_sent = false
  client_note      text                     -- Log tecnico opzionale
);

create index if not exists idx_checkins_user_at
  on public.checkins (user_id, at desc);

-- Vista utile: giorno locale del check-in secondo il timezone dell'utente
create or replace view public.checkins_by_day as
select
  c.user_id,
  (c.at at time zone p.reminder_timezone)::date as local_day,
  count(*) as n_checkins,
  min(c.at) as first_at,
  max(c.at) as last_at
from public.checkins c
join public.profiles p on p.user_id = c.user_id
group by c.user_id, local_day;

-- ------------------------------------------------------------
-- Tabella: missed_alerts
-- ------------------------------------------------------------
create table if not exists public.missed_alerts (
  id               bigserial primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  for_local_day    date not null,           -- Il giorno saltato (secondo timezone utente)
  sent_at          timestamptz not null default now(),
  contact_email    text not null,
  email_message_id text,
  email_error      text,
  unique (user_id, for_local_day)           -- Non spedire due allerte per lo stesso giorno
);

comment on table public.missed_alerts is 'Allerte email spedite ai contatti quando l''utente salta il check-in giornaliero';

-- ------------------------------------------------------------
-- Trigger: aggiorna updated_at
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- Trigger: crea profile automaticamente alla registrazione
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.checkins       enable row level security;
alter table public.missed_alerts  enable row level security;

-- profiles: read/update own
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles
  for insert with check (auth.uid() = user_id);

-- checkins: read/insert own (nessun update/delete lato client — write-once)
drop policy if exists "read own checkins" on public.checkins;
create policy "read own checkins" on public.checkins
  for select using (auth.uid() = user_id);

drop policy if exists "insert own checkins" on public.checkins;
create policy "insert own checkins" on public.checkins
  for insert with check (auth.uid() = user_id);

-- missed_alerts: read own; write solo via service_role (edge function)
drop policy if exists "read own missed_alerts" on public.missed_alerts;
create policy "read own missed_alerts" on public.missed_alerts
  for select using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Grants minimi
-- ------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.profiles       to authenticated;
grant select, insert            on public.checkins    to authenticated;
grant select                    on public.missed_alerts to authenticated;
grant usage, select on sequence public.checkins_id_seq to authenticated;
grant select on public.checkins_by_day to authenticated;
