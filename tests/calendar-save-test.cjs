const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const LS=Object.fromEntries(['user','bookings','maint','tickets','meetings','reqspec','settings'].map(k=>[k,k]));
let allowed=true,mode='allowed',calls=0,quota=false;const cache=new Map();const client={from(){return{upsert(row){calls++;return{select:async()=>{if(mode==='network')throw Error('network');return mode==='error'?{error:{code:'42501'}}:{data:mode==='allowed'?[{id:row.id}]:[]};}};}};}};
const context={LS,DEMO_MODE:false,can:()=>allowed,client,console,ls:key=>JSON.parse(cache.get(key)||'[]'),localStorage:{setItem:(key,value)=>{if(quota)throw Error('QuotaExceededError');cache.set(key,value);}}};vm.createContext(context);vm.runInContext(fs.readFileSync('js/db.js','utf8'),context);vm.runInContext('_sb=client',context);
(async()=>{
 const save=()=>vm.runInContext("db.saveCalendarEvent(LS.bookings,{id:'new',title:'Saved',start:'2026-12-01T09:00:00Z',end:'2026-12-01T10:00:00Z'})",context);
 cache.set('bookings',JSON.stringify([{id:'unrelated'}]));allowed=false;await assert.rejects(save(),/permesso/);assert.equal(calls,0);
 allowed=true;for(const rejected of['error','filtered','network']){mode=rejected;await assert.rejects(save());assert.deepEqual(JSON.parse(cache.get('bookings')),[{id:'unrelated'}]);}
 mode='allowed';await save();assert.equal(JSON.parse(cache.get('bookings')).length,2);await save();assert.equal(JSON.parse(cache.get('bookings')).length,2);
 quota=true;const persisted=await save();assert.equal(persisted.cacheUpdated,false);assert.equal(persisted.event.id,'new');
 console.log('PASS: calendar create/update only change the targeted cache row after confirmed database persistence');
})();
