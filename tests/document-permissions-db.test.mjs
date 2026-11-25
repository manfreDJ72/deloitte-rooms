import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const ids={operatore_cliente:'00000000-0000-4000-8000-000000000001',Founder:'00000000-0000-4000-8000-000000000002',admin:'00000000-0000-4000-8000-000000000003',viewer:'00000000-0000-4000-8000-000000000004',pending:'00000000-0000-4000-8000-000000000005'};
async function fixture(){
 const db=new PGlite();await db.exec(`create schema auth;create schema private;create schema storage;create role authenticated;create role anon;create role service_role bypassrls;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,private,storage to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
 create table profiles(id uuid primary key,role text);create table app_settings(id text primary key,data jsonb);insert into app_settings values('global','{}');
 create table bookings(id text primary key);create table maintenance(id text primary key);
 create table storage.objects(bucket_id text,name text);grant select on storage.objects to authenticated,service_role;alter table storage.objects enable row level security;
 create policy doc_read on storage.objects for select to authenticated using(bucket_id='documenti' and auth.uid() is not null);
 insert into storage.objects values('documenti','contratti/synthetic.txt'),('documenti','_text/contratti/synthetic.txt'),('documenti','preventivi/synthetic.txt'),('documenti','_text/preventivi/synthetic.txt'),('documenti','materiali/synthetic.txt'),('documenti','_text/materiali/synthetic.txt'),('other','materiali/unrelated.txt');`);
 for(const[role,id]of Object.entries(ids))await db.query('insert into profiles values($1,$2)',[id,role]);
 await db.exec(readFileSync('supabase/migrations/20261125115153_calendar_permission_matrix.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261125121500_document_category_permissions.sql','utf8'));return db;
}
async function asRole(db,role,fn){await db.exec(`set role ${role==='service_role'?'service_role':'authenticated'};select set_config('request.jwt.claim.sub','${ids[role]||''}',false)`);try{return await fn();}finally{await db.exec('reset role');}}
const setRoles=(db,roles)=>db.query("update app_settings set data=jsonb_build_object('roles',$1::jsonb)",[JSON.stringify(roles)]);

test('Storage: cliente non legge categorie negate o relativi sidecar, materiali e membri autorizzati restano accessibili',async()=>{
 const db=await fixture();try{
  assert.deepEqual((await asRole(db,'operatore_cliente',()=>db.query('select name from storage.objects order by name'))).rows.map(r=>r.name),['_text/materiali/synthetic.txt','materiali/synthetic.txt']);
  assert.equal((await asRole(db,'Founder',()=>db.query('select name from storage.objects'))).rows.length,6);
  assert.equal((await asRole(db,'admin',()=>db.query('select name from storage.objects'))).rows.length,6);
  assert.equal((await asRole(db,'viewer',()=>db.query('select name from storage.objects'))).rows.length,6);
  assert.equal((await asRole(db,'pending',()=>db.query('select name from storage.objects'))).rows.length,0);
  assert.equal((await asRole(db,'service_role',()=>db.query('select name from storage.objects'))).rows.length,7);
 }finally{await db.close();}
});

test('Storage: grant/deny numerici e repository.vedi=0 applicati, booleani/stringhe non elevano privilegi',async()=>{
 const db=await fixture();try{
  await setRoles(db,{operatore_cliente:{cartelle:{contratti:1}}});
  assert.equal((await asRole(db,'operatore_cliente',()=>db.query('select name from storage.objects'))).rows.length,4);
  await setRoles(db,{operatore_cliente:{cartelle:{contratti:0,materiali:0}}});
  assert.equal((await asRole(db,'operatore_cliente',()=>db.query('select name from storage.objects'))).rows.length,0);
  await setRoles(db,{operatore_cliente:{cartelle:{contratti:true,preventivi:'1'}}});
  assert.equal((await asRole(db,'operatore_cliente',()=>db.query('select name from storage.objects'))).rows.length,2);
  await setRoles(db,{operatore_cliente:{repository:{vedi:0},cartelle:{contratti:1,preventivi:1,materiali:1}}});
  assert.equal((await asRole(db,'operatore_cliente',()=>db.query('select name from storage.objects'))).rows.length,0);
  assert.equal((await asRole(db,'admin',()=>db.query('select name from storage.objects'))).rows.length,6);
 }finally{await db.close();}
});
