-- Preserve private bucket and existing admin write policies. Enforce the
-- existing repository/category matrix for originals and extracted sidecars.
begin;
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
