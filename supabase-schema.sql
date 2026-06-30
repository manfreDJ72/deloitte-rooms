-- ================================================================
-- DELOITTE ROOM MANAGEMENT – Supabase Schema
-- Incolla questo SQL nell'editor SQL di Supabase (SQL Editor > New Query)
-- ================================================================

-- ── PROFILES (estende auth.users) ────────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  role       text not null default 'presidio',  -- admin | presidio | viewer
  avatar     text,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "Profilo visibile a utenti autenticati"
  on public.profiles for select using (auth.uid() is not null);
create policy "Profilo modificabile da owner"
  on public.profiles for update using (auth.uid() = id);

-- ── BOOKINGS ─────────────────────────────────────────────────────
create table if not exists public.bookings (
  id              text primary key,
  room            text not null,
  title           text not null,
  referente       text,
  organizzatore   text,
  partecipanti    jsonb default '[]',
  allestimento    jsonb default '[]',
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  note            text,
  type            text default 'booking',
  created_by      uuid references auth.users(id),
  created_at      timestamptz default now()
);
alter table public.bookings enable row level security;
create policy "Bookings leggibili da autenticati"
  on public.bookings for select using (auth.uid() is not null);
create policy "Bookings modificabili da autenticati"
  on public.bookings for all using (auth.uid() is not null);

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
create policy "Maintenance leggibile da autenticati"
  on public.maintenance for select using (auth.uid() is not null);
create policy "Maintenance modificabile da autenticati"
  on public.maintenance for all using (auth.uid() is not null);

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
create policy "Tickets leggibili da autenticati"
  on public.tickets for select using (auth.uid() is not null);
create policy "Tickets modificabili da autenticati"
  on public.tickets for all using (auth.uid() is not null);

-- ── TICKET ACTIONS ───────────────────────────────────────────────
create table if not exists public.ticket_actions (
  id         text primary key,
  ticket_id  text not null references public.tickets(id) on delete cascade,
  ts         timestamptz default now(),
  user_name  text,
  text       text not null
);
alter table public.ticket_actions enable row level security;
create policy "Actions leggibili da autenticati"
  on public.ticket_actions for select using (auth.uid() is not null);
create policy "Actions inseribili da autenticati"
  on public.ticket_actions for insert with check (auth.uid() is not null);

-- ── CHECKS ───────────────────────────────────────────────────────
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
create policy "Checks leggibili da autenticati"
  on public.checks for select using (auth.uid() is not null);
create policy "Checks modificabili da autenticati"
  on public.checks for all using (auth.uid() is not null);

-- ================================================================
-- UTENTI INIZIALI
-- Crea gli utenti in Supabase Authentication > Users > Invite User
-- poi esegui questo INSERT per creare i profili:
-- ================================================================
-- insert into public.profiles (id, name, role, avatar) values
--   ('<uuid-di-marco>', 'Marco Manfredini', 'admin', 'MM'),
--   ('<uuid-presidio>', 'Presidio Area62',  'presidio', 'PR'),
--   ('<uuid-admin>',    'Admin Area62',     'admin', 'AD'),
--   ('<uuid-deloitte>', 'Deloitte User',    'viewer', 'DL');
