-- Preserve the existing legacy role without changing any user's profile or
-- granting user-administration privileges. Unknown future roles stay denied.
begin;
create or replace function private.rooms_role()
returns text language sql stable security definer set search_path = '' as $$
 select case when p.role='Founder' then 'operator' else p.role end
 from public.profiles p where p.id=(select auth.uid())
$$;
revoke all on function private.rooms_role() from public, anon;
grant execute on function private.rooms_role() to authenticated, service_role;
alter table public.profiles drop constraint if exists profiles_role_valid;
alter table public.profiles add constraint profiles_role_valid check (role in (
 'pending','admin','operator','viewer','Founder','operatore_agenzia','operatore_cliente',
 'visualizzatore_agenzia','visualizzatore_cliente'
)) not valid;
commit;
