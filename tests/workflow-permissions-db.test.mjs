import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const ids={operatore_cliente:'00000000-0000-4000-8000-000000000001',Founder:'00000000-0000-4000-8000-000000000002',admin:'00000000-0000-4000-8000-000000000003',viewer:'00000000-0000-4000-8000-000000000004'};
async function fixture(patched=true){
 const db=new PGlite();await db.exec(`create schema auth;create schema private;create schema storage;create role authenticated;create role anon;create role service_role bypassrls;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,private,storage to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
 create table profiles(id uuid primary key,role text);create table app_settings(id text primary key,data jsonb);insert into app_settings values('global','{}');
 create table bookings(id text primary key);create table maintenance(id text primary key);
 create table tickets(id text primary key,status text default 'open',priority text default 'P3',resolved_at timestamptz,created_at timestamptz default '2026-11-25T09:00Z',updated_at timestamptz,description text,sla_respected boolean);
 create table ticket_actions(id text primary key,ticket_id text,text text);
 create table rapporti(id text primary key,status text default 'open',stages jsonb default '{}',closed_at timestamptz,pdf_path text);
 create table storage.objects(bucket_id text,name text);grant select on storage.objects to authenticated,service_role;alter table storage.objects enable row level security;
 create policy doc_read on storage.objects for select to authenticated using(bucket_id='documenti' and auth.uid() is not null);
 grant select,insert,update,delete on tickets,ticket_actions,rapporti to authenticated,service_role;
 insert into tickets(id) values('open');insert into tickets(id,status,resolved_at) values('closed','resolved','2026-11-25T10:00Z');insert into rapporti(id) values('existing');
 insert into storage.objects values('documenti','contratti/synthetic.txt'),('documenti','_text/contratti/synthetic.txt'),('documenti','materiali/synthetic.txt');`);
 for(const table of['tickets','ticket_actions','rapporti'])await db.exec(`alter table ${table} enable row level security;create policy ${table}_read on ${table} for select to authenticated using(auth.uid() is not null);create policy ${table}_write on ${table} for all to authenticated using((select role from profiles where id=auth.uid()) in ('Founder','operatore_cliente','admin')) with check((select role from profiles where id=auth.uid()) in ('Founder','operatore_cliente','admin'));`);
 await db.exec('grant select on profiles to authenticated');for(const[role,id]of Object.entries(ids))await db.query('insert into profiles values($1,$2)',[id,role]);
 await db.exec(readFileSync('supabase/migrations/20261125115153_calendar_permission_matrix.sql','utf8'));
 if(patched)await db.exec(readFileSync('review/workflow-permissions.sql','utf8'));return db;
}
async function asRole(db,role,fn){await db.exec(`set role ${role==='service_role'?'service_role':'authenticated'};select set_config('request.jwt.claim.sub','${ids[role]||''}',false)`);try{return await fn();}finally{await db.exec('reset role');}}
const setRoles=(db,roles)=>db.query("update app_settings set data=jsonb_build_object('roles',$1::jsonb)",[JSON.stringify(roles)]);
const upsertTicket=(db,id,fields={})=>db.query(`insert into tickets(id,status,priority,resolved_at,created_at,updated_at,description,sla_respected) values($1,$2,$3,$4,$5,now(),$6,$7) on conflict(id) do update set status=excluded.status,priority=excluded.priority,resolved_at=excluded.resolved_at,created_at=excluded.created_at,updated_at=excluded.updated_at,description=excluded.description,sla_respected=excluded.sla_respected returning id`,[id,fields.status||'open',fields.priority||'P3',fields.resolved_at||null,'2026-11-25T09:00Z',fields.description||'Comment',fields.sla_respected??null]);

test('baseline riproduce bypass reali della matrice, senza invii o record originali',async()=>{
 const db=await fixture(false);try{
  assert.equal((await db.query("select private.rooms_role_permission('operatore_cliente','{}','anomalie','chiudi') as allowed")).rows[0].allowed,false);
  assert.equal((await asRole(db,'operatore_cliente',()=>db.query("update tickets set status='resolved',priority='P1',sla_respected=true where id='open' returning id"))).rows.length,1);
  assert.equal((await asRole(db,'operatore_cliente',()=>db.query("insert into rapporti(id) values('forbidden') returning id"))).rows.length,1);
  assert.equal((await asRole(db,'operatore_cliente',()=>db.query("select name from storage.objects where name like '%contratti%'"))).rows.length,2);
 }finally{await db.close();}
});

test('guardie mirate negano chiusura/SLA/rapporti cliente ma preservano commenti e upsert invariati',async()=>{
 const db=await fixture();try{
  await assert.rejects(asRole(db,'operatore_cliente',()=>db.query("update tickets set status='resolved' where id='open'")),/non autorizzata/);
  await assert.rejects(asRole(db,'operatore_cliente',()=>db.query("update tickets set priority='P1' where id='open'")),/SLA non autorizzata/);
  await assert.rejects(asRole(db,'operatore_cliente',()=>db.query("update tickets set created_at=now() where id='open'")),/SLA non autorizzata/);
  await assert.rejects(asRole(db,'operatore_cliente',()=>db.query("delete from tickets where id='open'")),/non autorizzata/);
  await assert.rejects(asRole(db,'operatore_cliente',()=>db.query("insert into rapporti(id) values('forbidden')")),/non autorizzata/);
  await assert.rejects(asRole(db,'operatore_cliente',()=>db.query("update rapporti set stages='{\"note\":\"forbidden\"}' where id='existing'")),/non autorizzata/);
  await asRole(db,'operatore_cliente',()=>db.query("insert into ticket_actions values('comment','closed','Allowed comment')"));
  await asRole(db,'operatore_cliente',()=>upsertTicket(db,'closed',{status:'resolved',resolved_at:'2026-11-25T10:00Z'}));
  await asRole(db,'operatore_cliente',()=>upsertTicket(db,'new-open'));
  await asRole(db,'Founder',()=>db.query("update tickets set status='resolved',resolved_at=now() where id='new-open'"));
  await assert.rejects(asRole(db,'Founder',()=>db.query("update tickets set priority='P1' where id='open'")),/SLA non autorizzata/);
  await setRoles(db,{operatore_cliente:{anomalie:{chiudi:1,sla:1},rapporti:{crea:1,creanuovo:1,invia:1}}});
  await asRole(db,'operatore_cliente',()=>upsertTicket(db,'open',{status:'resolved',priority:'P1',sla_respected:true}));
  await asRole(db,'operatore_cliente',()=>db.query("insert into rapporti(id,status) values('granted','closed')"));
 }finally{await db.close();}
});

test('upsert rapporto esistente distingue compila, crea nuovo e invia; viewer negato, admin/worker preservati',async()=>{
 const db=await fixture();try{
  await setRoles(db,{operatore_agenzia:{rapporti:{crea:1,creanuovo:0,invia:0}}});
  await asRole(db,'Founder',()=>db.query("insert into rapporti(id,stages) values('existing','{\"note\":\"Allowed\"}') on conflict(id) do update set stages=excluded.stages"));
  await assert.rejects(asRole(db,'Founder',()=>db.query("insert into rapporti(id) values('forbidden')")),/non autorizzata/);
  await assert.rejects(asRole(db,'Founder',()=>db.query("update rapporti set status='closed' where id='existing'")),/non autorizzate/);
  await asRole(db,'admin',()=>db.query("update rapporti set status='closed',pdf_path='rapporti/synthetic.pdf' where id='existing'"));
  await asRole(db,'Founder',()=>db.query("insert into rapporti(id,status,pdf_path) values('existing','closed','rapporti/synthetic.pdf') on conflict(id) do update set status=excluded.status,pdf_path=excluded.pdf_path"));
  await assert.rejects(asRole(db,'viewer',()=>db.query("insert into tickets(id) values('viewer')")),error=>error.code==='42501');
  await asRole(db,'service_role',()=>db.query("update tickets set priority='P1',status='resolved' where id='open'"));
 }finally{await db.close();}
});

test('categoria Storage e testo estratto rispettano dinieghi senza colpire materiali o admin',async()=>{
 const db=await fixture();try{
  assert.deepEqual((await asRole(db,'operatore_cliente',()=>db.query('select name from storage.objects order by name'))).rows.map(r=>r.name),['materiali/synthetic.txt']);
  assert.equal((await asRole(db,'admin',()=>db.query('select name from storage.objects'))).rows.length,3);
  await setRoles(db,{operatore_cliente:{cartelle:{contratti:1}}});
  assert.equal((await asRole(db,'operatore_cliente',()=>db.query('select name from storage.objects'))).rows.length,3);
 }finally{await db.close();}
});
