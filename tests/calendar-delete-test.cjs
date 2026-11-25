const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const LS=Object.fromEntries(['user','bookings','maint','tickets','meetings','reqspec','settings'].map(k=>[k,k]));
const cache=new Map(),calls=[];let allowed=true,mode='allowed';
const client={from(table){return{
 delete(){return{eq(_field,id){return{select:async()=>{calls.push({table,id});return mode==='error'?{error:{code:'42501'}}:{data:mode==='allowed'?[{id}]:[]};}}}};},
 select(){return{eq(_field,id){return{maybeSingle:async()=>({data:mode==='missing'?null:{id}})}}};}
};}};
const context={LS,DEMO_MODE:false,can:()=>allowed,ls:key=>JSON.parse(cache.get(key)||'[]'),localStorage:{setItem:(key,value)=>cache.set(key,value)},client,console};vm.createContext(context);vm.runInContext(fs.readFileSync('js/db.js','utf8'),context);vm.runInContext('_sb=client',context);
const reset=()=>cache.set('bookings',JSON.stringify([{id:'a'},{id:'b'}]));
(async()=>{
 reset();mode='filtered';await assert.rejects(vm.runInContext("db.deleteCalendarEvent(LS.bookings,'a')",context),/non ha confermato/);assert.equal(JSON.parse(cache.get('bookings')).length,2);
 mode='error';await assert.rejects(vm.runInContext("db.deleteCalendarEvent(LS.bookings,'a')",context),/non autorizzata/);assert.equal(JSON.parse(cache.get('bookings')).length,2);
 mode='allowed';await vm.runInContext("db.deleteCalendarEvent(LS.bookings,'a')",context);assert.deepEqual(JSON.parse(cache.get('bookings')),[{id:'b'}]);
 reset();allowed=false;const before=calls.length;await assert.rejects(vm.runInContext("db.deleteCalendarEvent(LS.bookings,'a')",context),/permesso/);assert.equal(calls.length,before);assert.equal(JSON.parse(cache.get('bookings')).length,2);
 allowed=true;mode='missing';await assert.rejects(vm.runInContext("db.deleteCalendarEvent(LS.bookings,'a')",context),/non ha confermato/);assert.equal(JSON.parse(cache.get('bookings')).length,2);
 console.log('PASS: refused deletion never clears cache or claims success; only confirmed deleted rows reconcile the explicit ID');
})();
