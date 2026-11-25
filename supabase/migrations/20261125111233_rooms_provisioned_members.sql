-- Existing users and data are preserved. Unprovisioned signups get no access.
begin;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
create or replace function private.rooms_role()
returns text language sql stable security definer set search_path = ''
as $$ select p.role from public.profiles p where p.id = (select auth.uid()) $$;
revoke all on function private.rooms_role() from public, anon;
grant execute on function private.rooms_role() to authenticated, service_role;

alter table public.profiles alter column role set default 'pending';
alter table public.profiles drop constraint if exists profiles_role_valid;
alter table public.profiles add constraint profiles_role_valid check (role in (
  'pending','admin','operator','viewer','operatore_agenzia','operatore_cliente',
  'visualizzatore_agenzia','visualizzatore_cliente'
)) not valid;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id,name,role,avatar) values (
    new.id,coalesce(new.raw_user_meta_data->>'name',split_part(new.email,'@',1)),
    'pending',coalesce(new.raw_user_meta_data->>'avatar',upper(left(new.email,2)))
  ) on conflict (id) do nothing;
  return new;
end; $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id=(select auth.uid()) or (select private.rooms_role()) in (
    'admin','operator','viewer','operatore_agenzia','operatore_cliente',
    'visualizzatore_agenzia','visualizzatore_cliente'
  )
);
create policy profiles_update on public.profiles for update to authenticated
  using (id=(select auth.uid())) with check (id=(select auth.uid()));
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name,avatar) on public.profiles to authenticated;
grant select,insert,update,delete on public.profiles to service_role;

do $$ declare t text; p record; begin
 foreach t in array array[
  'bookings','maintenance','tickets','ticket_actions','checks','meetings','reqspec',
  'inbox','reminders_log','rapporti','tasks','email_queue'
 ] loop
  execute format('alter table public.%I enable row level security',t);
  for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
   execute format('drop policy %I on public.%I',p.policyname,t);
  end loop;
  execute format('create policy %I on public.%I for select to authenticated using ((select private.rooms_role()) in (''admin'',''operator'',''viewer'',''operatore_agenzia'',''operatore_cliente'',''visualizzatore_agenzia'',''visualizzatore_cliente''))',t||'_read',t);
  execute format('create policy %I on public.%I for all to authenticated using ((select private.rooms_role()) in (''admin'',''operator'',''operatore_agenzia'',''operatore_cliente'')) with check ((select private.rooms_role()) in (''admin'',''operator'',''operatore_agenzia'',''operatore_cliente''))',t||'_write',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated, service_role',t);
 end loop;
end $$;
revoke all on public.app_settings from anon, authenticated;
grant select,insert,update,delete on public.app_settings to authenticated, service_role;
drop policy if exists settings_select on public.app_settings;
drop policy if exists settings_write on public.app_settings;
create policy settings_select on public.app_settings for select to authenticated using (
 (select private.rooms_role()) in ('admin','operator','viewer','operatore_agenzia','operatore_cliente','visualizzatore_agenzia','visualizzatore_cliente')
);
create policy settings_write on public.app_settings for all to authenticated
 using ((select private.rooms_role())='admin') with check ((select private.rooms_role())='admin');
grant usage,select on sequence public.reminders_log_id_seq to authenticated, service_role;

drop policy if exists doc_read on storage.objects;
create policy doc_read on storage.objects for select to authenticated using (
 bucket_id='documenti' and (select private.rooms_role()) in ('admin','operator','viewer','operatore_agenzia','operatore_cliente','visualizzatore_agenzia','visualizzatore_cliente')
);
commit;
