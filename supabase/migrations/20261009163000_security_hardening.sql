-- Security hardening for the existing Deloitte Rooms Supabase project.
-- Safe to re-run. Apply with an administrator/database-owner connection.

alter table public.profiles enable row level security;
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name, avatar) on public.profiles to authenticated;

alter table public.profiles drop constraint if exists profiles_role_valid;
alter table public.profiles add constraint profiles_role_valid
  check (role in ('admin', 'operator', 'viewer')) not valid;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;
revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated, service_role;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, role, avatar)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    'operator',
    coalesce(new.raw_user_meta_data->>'avatar', upper(left(new.email,2)))
  )
  on conflict (id) do nothing;
  return new;
end; $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'bookings', 'maintenance', 'tickets', 'ticket_actions', 'checks',
    'meetings', 'reqspec', 'inbox', 'reminders_log'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_all', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_write', table_name);
    execute format(
      'create policy %I on public.%I for select using (auth.uid() is not null)',
      table_name || '_read', table_name
    );
    execute format(
      'create policy %I on public.%I for all using (public.current_user_role() in (''admin'', ''operator'')) with check (public.current_user_role() in (''admin'', ''operator''))',
      table_name || '_write', table_name
    );
  end loop;
end $$;

drop policy if exists "settings_select" on public.app_settings;
drop policy if exists "settings_write" on public.app_settings;
create policy "settings_select" on public.app_settings for select
  using (auth.uid() is not null);
create policy "settings_write" on public.app_settings for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
