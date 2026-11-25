-- REVIEW ONLY: not a deployed migration. See workflow-permissions.md.
-- Existing role policies remain in force. These guards add field/action checks;
-- service_role/background workers retain their existing behavior.
begin;
create or replace function private.rooms_guard_ticket_mutation()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user <> 'authenticated' then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 if tg_op='DELETE' then
  if not private.rooms_can('anomalie','chiudi') then raise exception using errcode='42501',message='Chiusura o eliminazione ticket non autorizzata'; end if;
  return old;
 end if;
 -- PostgREST upsert runs BEFORE INSERT even for an existing ID. Only apply
 -- creation checks to genuinely new IDs; the conflict UPDATE is checked below.
 if tg_op='INSERT' then
  if exists(select 1 from public.tickets t where t.id=new.id) then return new; end if;
  if not private.rooms_can('anomalie','apri') then raise exception using errcode='42501',message='Creazione ticket non autorizzata'; end if;
  if (new.status in ('resolved','closed') or new.resolved_at is not null) and not private.rooms_can('anomalie','chiudi') then raise exception using errcode='42501',message='Chiusura ticket non autorizzata'; end if;
  if new.sla_respected is not null and not private.rooms_can('anomalie','sla') then raise exception using errcode='42501',message='Gestione SLA non autorizzata'; end if;
  return new;
 end if;
 if new.id is distinct from old.id then raise exception using errcode='42501',message='Identità ticket immutabile'; end if;
 if ((new.status is distinct from old.status and (new.status in ('resolved','closed') or old.status in ('resolved','closed'))) or new.resolved_at is distinct from old.resolved_at)
  and not private.rooms_can('anomalie','chiudi') then raise exception using errcode='42501',message='Chiusura o riapertura ticket non autorizzata'; end if;
 if (new.priority is distinct from old.priority or new.sla_respected is distinct from old.sla_respected or new.created_at is distinct from old.created_at)
  and not private.rooms_can('anomalie','sla') then raise exception using errcode='42501',message='Gestione SLA non autorizzata'; end if;
 return new;
end $$;
revoke all on function private.rooms_guard_ticket_mutation() from public,anon,authenticated;
drop trigger if exists rooms_guard_ticket_mutation on public.tickets;
create trigger rooms_guard_ticket_mutation before insert or update or delete on public.tickets for each row execute function private.rooms_guard_ticket_mutation();

create or replace function private.rooms_guard_report_mutation()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user <> 'authenticated' then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 if tg_op='DELETE' then
  if not private.rooms_can('rapporti','crea') then raise exception using errcode='42501',message='Eliminazione rapporto non autorizzata'; end if;
  return old;
 end if;
 if tg_op='INSERT' then
  if exists(select 1 from public.rapporti r where r.id=new.id) then return new; end if;
  if not private.rooms_can('rapporti','creanuovo') or not private.rooms_can('rapporti','crea') then raise exception using errcode='42501',message='Creazione rapporto non autorizzata'; end if;
  if (new.status='closed' or new.closed_at is not null or new.pdf_path is not null) and not private.rooms_can('rapporti','invia') then raise exception using errcode='42501',message='Chiusura e archiviazione rapporto non autorizzate'; end if;
  return new;
 end if;
 if new.id is distinct from old.id then raise exception using errcode='42501',message='Identità rapporto immutabile'; end if;
 if new is distinct from old and not private.rooms_can('rapporti','crea') then raise exception using errcode='42501',message='Compilazione rapporto non autorizzata'; end if;
 if (new.status is distinct from old.status or new.closed_at is distinct from old.closed_at or new.pdf_path is distinct from old.pdf_path)
  and not private.rooms_can('rapporti','invia') then raise exception using errcode='42501',message='Chiusura e archiviazione rapporto non autorizzate'; end if;
 return new;
end $$;
revoke all on function private.rooms_guard_report_mutation() from public,anon,authenticated;
drop trigger if exists rooms_guard_report_mutation on public.rapporti;
create trigger rooms_guard_report_mutation before insert or update or delete on public.rapporti for each row execute function private.rooms_guard_report_mutation();

create or replace function private.rooms_document_category(p_name text)
returns text language sql immutable security invoker set search_path='' as $$
 select case when split_part(case when split_part(p_name,'/',1)='_text' then substr(p_name,7) else p_name end,'/',1) in ('rapporti','contratti','preventivi','materiali','altro')
 then split_part(case when split_part(p_name,'/',1)='_text' then substr(p_name,7) else p_name end,'/',1) else 'altro' end
$$;
revoke all on function private.rooms_document_category(text) from public,anon;
grant execute on function private.rooms_document_category(text) to authenticated,service_role;
drop policy if exists doc_read on storage.objects;
create policy doc_read on storage.objects for select to authenticated using (
 bucket_id='documenti' and (select private.rooms_can('repository','vedi'))
 and private.rooms_can('cartelle',private.rooms_document_category(name))
);
commit;
