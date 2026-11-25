-- Match can()/_mergeRoles(): existing aliases, numeric 0/1 overrides and UI defaults.
-- Only calendar mutation policies change. Account roles and shared settings stay intact.
begin;
create or replace function private.rooms_role_permission(p_role text,p_roles jsonb,p_capability text,p_action text)
returns boolean language plpgsql immutable security invoker set search_path='' as $function$
declare
 role_key text := case p_role when 'operator' then 'operatore_agenzia' when 'Founder' then 'operatore_agenzia' when 'viewer' then 'visualizzatore_agenzia' else p_role end;
 defaults constant jsonb := $defaults${"admin":{"prenotazioni":{"crea":1,"elimina":1},"check":{"esegui":1,"storico":1,"quotidiano":1},"anomalie":{"apri":1,"chiudi":1,"sla":1},"rapporti":{"crea":1,"invia":1,"creanuovo":1},"repository":{"vedi":1,"gestisci":1},"cartelle":{"rapporti":1,"contratti":1,"preventivi":1,"materiali":1,"altro":1},"assistente":{"vedi":1},"settings":{"accesso":1}},"operatore_agenzia":{"prenotazioni":{"crea":1,"elimina":0},"check":{"esegui":1,"storico":1,"quotidiano":1},"anomalie":{"apri":1,"chiudi":1,"sla":0},"rapporti":{"crea":1,"invia":1,"creanuovo":1},"repository":{"vedi":1,"gestisci":0},"cartelle":{"rapporti":1,"contratti":1,"preventivi":1,"materiali":1,"altro":1},"assistente":{"vedi":1},"settings":{"accesso":0}},"operatore_cliente":{"prenotazioni":{"crea":1,"elimina":0},"check":{"esegui":0,"storico":1,"quotidiano":1},"anomalie":{"apri":1,"chiudi":0,"sla":0},"rapporti":{"crea":0,"invia":0,"creanuovo":0},"repository":{"vedi":1,"gestisci":0},"cartelle":{"rapporti":1,"contratti":0,"preventivi":0,"materiali":1,"altro":1},"assistente":{"vedi":0},"settings":{"accesso":0}},"visualizzatore_agenzia":{"prenotazioni":{"crea":0,"elimina":0},"check":{"esegui":0,"storico":1,"quotidiano":1},"anomalie":{"apri":0,"chiudi":0,"sla":0},"rapporti":{"crea":0,"invia":0,"creanuovo":0},"repository":{"vedi":1,"gestisci":0},"cartelle":{"rapporti":1,"contratti":1,"preventivi":1,"materiali":1,"altro":1},"assistente":{"vedi":1},"settings":{"accesso":0}},"visualizzatore_cliente":{"prenotazioni":{"crea":0,"elimina":0},"check":{"esegui":0,"storico":1,"quotidiano":1},"anomalie":{"apri":0,"chiudi":0,"sla":0},"rapporti":{"crea":0,"invia":0,"creanuovo":0},"repository":{"vedi":1,"gestisci":0},"cartelle":{"rapporti":1,"contratti":0,"preventivi":0,"materiali":1,"altro":0},"assistente":{"vedi":0},"settings":{"accesso":0}}}$defaults$::jsonb;
 fallback jsonb;
 saved jsonb;
begin
 if p_role='admin' then return true; end if;
 if role_key is null then return false; end if;
 fallback := defaults #> array[role_key,p_capability,p_action];
 if fallback is null then return false; end if;
 saved := p_roles #> array[role_key,p_capability,p_action];
 if saved in ('0'::jsonb,'1'::jsonb) then return saved='1'::jsonb; end if;
 return fallback='1'::jsonb;
end $function$;
revoke all on function private.rooms_role_permission(text,jsonb,text,text) from public,anon,authenticated;
grant execute on function private.rooms_role_permission(text,jsonb,text,text) to service_role;
create or replace function private.rooms_can(p_capability text,p_action text)
returns boolean language sql stable security definer set search_path='' as $function$
 select private.rooms_role_permission(
  (select p.role from public.profiles p where p.id=(select auth.uid())),
  (select s.data->'roles' from public.app_settings s where s.id='global'),
  p_capability,p_action
 )
$function$;
revoke all on function private.rooms_can(text,text) from public,anon;
grant execute on function private.rooms_can(text,text) to authenticated,service_role;
do $policies$ declare target text; begin
 foreach target in array array['bookings','maintenance'] loop
  execute format('drop policy if exists %I on public.%I',target||'_write',target);
  execute format('drop policy if exists %I on public.%I',target||'_insert',target);
  execute format('drop policy if exists %I on public.%I',target||'_update',target);
  execute format('drop policy if exists %I on public.%I',target||'_delete',target);
  execute format('create policy %I on public.%I for insert to authenticated with check ((select private.rooms_can(''prenotazioni'',''crea'')))',target||'_insert',target);
  execute format('create policy %I on public.%I for update to authenticated using ((select private.rooms_can(''prenotazioni'',''crea''))) with check ((select private.rooms_can(''prenotazioni'',''crea'')))',target||'_update',target);
  execute format('create policy %I on public.%I for delete to authenticated using ((select private.rooms_can(''prenotazioni'',''elimina'')))',target||'_delete',target);
 end loop;
end $policies$;
commit;
