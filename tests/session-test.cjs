const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync('js/db.js','utf8');
async function run(session, user, bridge=Promise.resolve()) {
 const cache=new Map([['user',JSON.stringify({sb:true,role:'admin'})]]); const redirects=[]; const notices=[]; let reads=0;
 const client={auth:{getSession:async()=>({data:{session}}),getUser:async()=>user},from:()=>{reads++;return {select(){return this},eq(){return this},single:async()=>({data:{name:'Member',role:'operator'}})}}};
 const ctx={DEMO_MODE:false,copilotSessionReady:bridge,SUPABASE_URL:'',SUPABASE_ANON_KEY:'',supabase:{createClient:()=>client}, LS:{user:'user'},localStorage:{getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)},location:{replace:x=>redirects.push(x)},document:{createElement:()=>({setAttribute(){},style:{}}),body:{appendChild:x=>notices.push(x)}},console:{error(){}}};
 vm.createContext(ctx);vm.runInContext(source,ctx);const ok=await vm.runInContext('db.requireSession()',ctx);return {ok,cache,redirects,notices,reads};
}
(async()=>{
 let r=await run(null,{});assert.equal(r.ok,false);assert.deepEqual(r.redirects,['index.html?reason=session']);assert.equal(r.reads,0);assert.equal(r.cache.has('user'),false);
 r=await run({}, {data:{user:{id:'1',email:'member@example.com'}}});assert.equal(r.ok,true);assert.equal(JSON.parse(r.cache.get('user')).role,'operator');
 r=await run({}, {error:{status:401}});assert.equal(r.ok,false);assert.equal(r.redirects.length,1);
 r=await run({}, {error:{status:503}});assert.equal(r.ok,false);assert.equal(r.redirects.length,0);assert.equal(r.notices.length,1);assert.equal(r.cache.has('user'),true);
 let resolve;const bridge=new Promise(r=>resolve=r);let complete=false;const pending=run({}, {data:{user:{id:'1',email:'member@example.com'}}},bridge).then(r=>{complete=true;return r});await Promise.resolve();assert.equal(complete,false);resolve();assert.equal((await pending).ok,true);
 for(const file of fs.readdirSync('.').filter(f=>f.endsWith('.html'))){for(const m of fs.readFileSync(file,'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1],{filename:file});}
 console.log('PASS: missing session, valid session/profile, expired session, service outage, bridge ordering, inline script syntax');
})();
