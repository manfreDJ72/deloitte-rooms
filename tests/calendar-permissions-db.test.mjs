import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
const migration=readFileSync('supabase/migrations/20261125115153_calendar_permission_matrix.sql','utf8');
const ids={operatore_cliente:'00000000-0000-4000-8000-000000000005',Founder:'00000000-0000-4000-8000-000000000001',operator:'00000000-0000-4000-8000-000000000002',viewer:'00000000-0000-4000-8000-000000000003',admin:'00000000-0000-4000-8000-000000000004'};
async function fixture(){
 const db=new PGlite();
 await db.exec(`create schema auth;create schema private;create role authenticated;create role anon;create role service_role;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,private to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
 create table profiles(id uuid primary key,role text);create table app_settings(id text primary key,data jsonb);insert into app_settings values('global','{}');
 create table bookings(id text primary key,title text);create table maintenance(id text primary key,title text);
 grant select,insert,update,delete on bookings,maintenance to authenticated;grant select on profiles to authenticated;
 alter table bookings enable row level security;alter table maintenance enable row level security;
 create policy bookings_read on bookings for select to authenticated using(auth.uid() is not null);
 create policy maintenance_read on maintenance for select to authenticated using(auth.uid() is not null);
 create policy bookings_write on bookings for all to authenticated using(auth.uid() is not null) with check(auth.uid() is not null);
 create policy maintenance_write on maintenance for all to authenticated using(auth.uid() is not null) with check(auth.uid() is not null);`);
 for(const[role,id]of Object.entries(ids))await db.query('insert into profiles values($1,$2)',[id,role]);
 await db.exec(migration);return db;
}
async function asRole(db,role,fn){await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${ids[role]}',false)`);try{return await fn();}finally{await db.exec('reset role');}}
const setRoles=(db,roles)=>db.query("update app_settings set data=jsonb_build_object('roles',$1::jsonb) where id='global'",[JSON.stringify(roles)]);

test('la decisione SQL coincide con la matrice UI: alias, fallback e override numerici',async()=>{
 const db=await fixture();try{
  let currentRole;const store=new Map();const context={currentUser:()=>({role:currentRole}),localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)}};vm.createContext(context);vm.runInContext(readFileSync('js/config.js','utf8'),context);
  const caps=vm.runInContext('CAPABILITIES',context);
  const roles=['Founder','operator','viewer','admin','operatore_agenzia','operatore_cliente','visualizzatore_agenzia','visualizzatore_cliente','pending','unknown'];
  const matrices=[{}, {operatore_agenzia:{prenotazioni:{elimina:1,crea:0}}}, {operatore_agenzia:{prenotazioni:{elimina:true,crea:'0'}}}, {admin:{prenotazioni:{elimina:0}},visualizzatore_agenzia:{prenotazioni:{elimina:1}}}];
  for(const matrix of matrices){store.set('dlt_settings',JSON.stringify({roles:matrix}));for(const role of roles){currentRole=role;for(const cap of caps)for(const action of cap.actions){context.cap=cap.key;context.action=action.key;const expected=vm.runInContext('can(cap,action)',context);const {rows}=await db.query('select private.rooms_role_permission($1,$2::jsonb,$3,$4) as allowed',[role,JSON.stringify(matrix),cap.key,action.key]);assert.equal(rows[0].allowed,expected,`${role}/${cap.key}/${action.key}`);}}}
 }finally{await db.close();}
});

test('RLS calendario: Founder/viewer negati, operatore autorizzato e admin consentiti, override negate rispettate',async()=>{
 const db=await fixture();try{
  for(const table of['bookings','maintenance']){
   await db.query(`insert into ${table} values('legacy','Original fixture')`);
   for(const role of['Founder','viewer']){const result=await asRole(db,role,()=>db.query(`delete from ${table} where id='legacy' returning id`));assert.equal(result.rows.length,0);}
   assert.equal((await db.query(`select title from ${table} where id='legacy'`)).rows[0].title,'Original fixture');
   await setRoles(db,{operatore_agenzia:{prenotazioni:{elimina:1}}});
   assert.equal((await asRole(db,'operator',()=>db.query(`delete from ${table} where id='legacy' returning id`))).rows.length,1);
   await db.query(`insert into ${table} values('denied','Retained')`);
   await setRoles(db,{operatore_agenzia:{prenotazioni:{elimina:0,crea:0}},admin:{prenotazioni:{elimina:0}}});
   assert.equal((await asRole(db,'operator',()=>db.query(`delete from ${table} where id='denied' returning id`))).rows.length,0);
   await assert.rejects(asRole(db,'operator',()=>db.query(`insert into ${table} values('blocked','Forbidden')`)),/row-level security/);
   assert.equal((await asRole(db,'operator',()=>db.query(`update ${table} set title='Forbidden' where id='denied' returning id`))).rows.length,0);
   assert.equal((await asRole(db,'admin',()=>db.query(`delete from ${table} where id='denied' returning id`))).rows.length,1);
   await setRoles(db,{});
   assert.equal((await asRole(db,'Founder',()=>db.query(`insert into ${table} values('allowed','Created') returning id`))).rows.length,1);
   assert.equal((await asRole(db,'Founder',()=>db.query(`update ${table} set title='Updated' where id='allowed' returning id`))).rows.length,1);
   await db.query(`delete from ${table} where id='allowed'`);
  }
 }finally{await db.close();}
});


test('check.esegui: cliente negato, override rispettati e Founder/admin autorizzati senza modificare storico',async()=>{
 const db=await fixture();try{
  await db.exec(`create table checks(id text primary key,title text);grant select,insert,update,delete on checks to authenticated;alter table checks enable row level security;
  create policy checks_read on checks for select to authenticated using(auth.uid() is not null);
  create policy checks_write on checks for all to authenticated using(auth.uid() is not null) with check(auth.uid() is not null);insert into checks values('history','Retained');`);
  await db.exec(readFileSync('supabase/migrations/20261125120500_check_permission_matrix.sql','utf8'));
  for(const role of ['operatore_cliente','viewer']){
   await assert.rejects(asRole(db,role,()=>db.query("insert into checks values('blocked','Forbidden')")),/row-level security/);
   assert.equal((await asRole(db,role,()=>db.query("update checks set title='Forbidden' where id='history' returning id"))).rows.length,0);
   assert.equal((await asRole(db,role,()=>db.query("delete from checks where id='history' returning id"))).rows.length,0);
   assert.equal((await asRole(db,role,()=>db.query("select title from checks where id='history'"))).rows[0].title,'Retained');
  }
  await asRole(db,'Founder',()=>db.query("insert into checks values('new-day','Created')"));
  await setRoles(db,{operatore_agenzia:{check:{esegui:0}},operatore_cliente:{check:{esegui:1}}});
  await assert.rejects(asRole(db,'Founder',()=>db.query("insert into checks values('denied','Forbidden')")),/row-level security/);
  await asRole(db,'operatore_cliente',()=>db.query("insert into checks values('override','Allowed')"));
  await asRole(db,'admin',()=>db.query("delete from checks where id='override'"));
 }finally{await db.close();}
});
