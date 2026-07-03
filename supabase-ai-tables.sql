-- ================================================================
-- DELOITTE ROOM MANAGEMENT – Tabelle Assistente AI
-- Incolla TUTTO nel SQL Editor di Supabase (New query) e premi RUN.
-- È ri-eseguibile: puoi lanciarlo più volte senza rompere nulla.
-- ================================================================

-- ── INBOX (archivio di TUTTE le email in arrivo alla casella) ────
create table if not exists public.inbox (
  id                text primary key,
  message_id        text unique,            -- Message-ID SMTP (dedup)
  from_addr         text,
  subject           text,
  body              text,
  received_at       timestamptz,
  direction         text default 'in',
  intent            text,                   -- booking | richiesta | altro
  linked_booking_id text,                   -- valorizzato se ha creato una prenotazione
  status            text default 'new',     -- new | handled | ignored
  created_at        timestamptz default now()
);
alter table public.inbox enable row level security;
drop policy if exists "inbox_all" on public.inbox;
-- lettura/scrittura per tutti gli autenticati (worker automation incluso), come le altre tabelle
create policy "inbox_all" on public.inbox for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- ── REMINDERS_LOG (traccia i reminder già inviati per evitare doppioni) ──
create table if not exists public.reminders_log (
  id         bigserial primary key,
  booking_id text not null,
  offset_h   int  not null,
  sent_at    timestamptz default now(),
  unique (booking_id, offset_h)
);
alter table public.reminders_log enable row level security;
drop policy if exists "reminders_log_all" on public.reminders_log;
create policy "reminders_log_all" on public.reminders_log for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- ================================================================
-- FINE. Le soglie dei reminder e il modello AI si configurano
-- direttamente nei Settings del portale (salvati in app_settings).
-- ================================================================
