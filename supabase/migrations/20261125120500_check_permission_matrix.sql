-- Preserve shared history and blank-day UI initialization; require existing
-- check.esegui capability only when rows are actually mutated.
begin;
drop policy if exists checks_write on public.checks;
create policy checks_insert on public.checks for insert to authenticated
 with check ((select private.rooms_can('check','esegui')));
create policy checks_update on public.checks for update to authenticated
 using ((select private.rooms_can('check','esegui')))
 with check ((select private.rooms_can('check','esegui')));
create policy checks_delete on public.checks for delete to authenticated
 using ((select private.rooms_can('check','esegui')));
commit;
