-- ================================================================
-- DELOITTE ROOM MANAGEMENT – Supabase Schema (completo)
-- Incolla TUTTO nel SQL Editor di Supabase (New query) e premi RUN.
-- È ri-eseguibile: puoi lanciarlo più volte senza rompere nulla.
-- ================================================================

-- ── PROFILES (estende auth.users) ────────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null default 'Utente',
  role       text not null default 'operator',  -- admin | operator | viewer
  avatar     text,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_select" on public.profiles for select using (auth.uid() is not null);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- Trigger: crea automaticamente il profilo quando aggiungi un utente in Authentication
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, role, avatar)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'role', 'operator'),
    coalesce(new.raw_user_meta_data->>'avatar', upper(left(new.email,2)))
  )
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── BOOKINGS (con allegati e supporto creativo) ──────────────────
create table if not exists public.bookings (
  id               text primary key,
  room             text not null,
  title            text not null,
  referente        text,
  organizzatore    text,
  partecipanti     jsonb default '[]',
  allestimento     jsonb default '[]',
  start_at         timestamptz not null,
  end_at           timestamptz not null,
  note             text,
  type             text default 'booking',
  creative_support boolean default false,
  creative_desc    text,
  attachments      jsonb default '[]',
  created_by       uuid references auth.users(id),
  created_at       timestamptz default now()
);
alter table public.bookings enable row level security;
drop policy if exists "bookings_all" on public.bookings;
create policy "bookings_all" on public.bookings for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ── MAINTENANCE ──────────────────────────────────────────────────
create table if not exists public.maintenance (
  id         text primary key,
  room       text not null,
  title      text not null,
  description text,
  start_at   timestamptz not null,
  end_at     timestamptz not null,
  type       text default 'maint',
  created_at timestamptz default now()
);
alter table public.maintenance enable row level security;
drop policy if exists "maintenance_all" on public.maintenance;
create policy "maintenance_all" on public.maintenance for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ── TICKETS ──────────────────────────────────────────────────────
create table if not exists public.tickets (
  id             text primary key,
  room           text not null,
  priority       text not null,          -- P1 | P2 | P3 | P4
  title          text not null,
  description    text,
  category       text,
  status         text default 'open',    -- open | in-progress | resolved
  segnalatore    text,
  sla_respected  boolean,
  from_rapporto  boolean default false,
  note_residue   text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  resolved_at    timestamptz
);
alter table public.tickets enable row level security;
drop policy if exists "tickets_all" on public.tickets;
create policy "tickets_all" on public.tickets for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ── TICKET ACTIONS ───────────────────────────────────────────────
create table if not exists public.ticket_actions (
  id         text primary key,
  ticket_id  text not null references public.tickets(id) on delete cascade,
  ts         timestamptz default now(),
  user_name  text,
  text       text not null
);
alter table public.ticket_actions enable row level security;
drop policy if exists "ticket_actions_all" on public.ticket_actions;
create policy "ticket_actions_all" on public.ticket_actions for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ── CHECKS (stato giornaliero + storico) ─────────────────────────
create table if not exists public.checks (
  id          text primary key default gen_random_uuid()::text,
  room        text not null,
  date        date not null,
  check_id    text not null,
  state       text,                      -- ok | ko | fixed
  ts          timestamptz,
  fail_ts     timestamptz,
  note        text,
  fix_applied text,
  created_at  timestamptz default now(),
  unique (room, date, check_id)
);
alter table public.checks enable row level security;
drop policy if exists "checks_all" on public.checks;
create policy "checks_all" on public.checks for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ── MEETINGS (call del giovedì, con task in jsonb) ───────────────
create table if not exists public.meetings (
  id           text primary key,
  date         date not null,
  partecipanti text,
  argomenti    text,
  tasks        jsonb default '[]',
  created_at   timestamptz default now()
);
alter table public.meetings enable row level security;
drop policy if exists "meetings_all" on public.meetings;
create policy "meetings_all" on public.meetings for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ── RICHIESTE SPECIALI (software / hardware) ─────────────────────
create table if not exists public.reqspec (
  id           text primary key,
  num          text,
  tipo         text not null,            -- software | hardware
  title        text not null,
  richiedente  text,
  priorita     text default 'media',     -- alta | media | bassa
  assegnatario text,
  descr        text,
  stato        text default 'nuova',     -- nuova | in-corso | completata
  created_at   timestamptz default now()
);
alter table public.reqspec enable row level security;
drop policy if exists "reqspec_all" on public.reqspec;
create policy "reqspec_all" on public.reqspec for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ── APP SETTINGS (riga singola con l'intera configurazione) ──────
create table if not exists public.app_settings (
  id         text primary key default 'global',
  data       jsonb not null default '{}',
  updated_at timestamptz default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "settings_select" on public.app_settings;
drop policy if exists "settings_write" on public.app_settings;
-- lettura a tutti gli autenticati, scrittura solo admin
create policy "settings_select" on public.app_settings for select using (auth.uid() is not null);
create policy "settings_write" on public.app_settings for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ================================================================
-- FINE. Dopo il RUN:
-- 1) Authentication → Providers → Email → disattiva "Confirm email"
-- 2) Authentication → Users → Add user:
--      email + password (spunta "Auto Confirm User")
--      In "User Metadata" (JSON) puoi mettere:
--      { "name": "Marco Manfredini", "role": "admin", "avatar": "MM" }
--    → il profilo viene creato in automatico dal trigger.
-- ================================================================
