const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const calls = [];
const client = {from(table) {return {
  upsert: async rows => { calls.push({method:'upsert',table,rows}); return {}; },
  delete: () => ({in: async (_column,ids) => { calls.push({method:'delete',table,ids}); return {}; }}),
  select: () => {throw new Error('Collection sync must not scan remote IDs');}
};}};
const LS = Object.fromEntries(['user','bookings','maint','tickets','meetings','reqspec','settings'].map(k => [k,k]));
const context = {LS,DEMO_MODE:false,client,structuredClone,console,toast(){throw Error('Unexpected sync error');}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/db.js','utf8'),context);
vm.runInContext('_sb=client',context);
(async()=>{
 const a={id:'a',room:'qa',title:'A',start:'2026-11-25',end:'2026-11-26'};
 const b={...a,id:'b',title:'B'};
 context.previous=[a,b];context.next=[{...a,title:'A updated'},b];
 await vm.runInContext('_pushCollection(LS.bookings,previous,next)',context);
 assert.equal(calls.length,1);assert.equal(calls[0].method,'upsert');assert.deepEqual(calls[0].rows.map(r=>r.id),['a']);
 calls.length=0;context.previous=[a,b];context.next=[a];
 await vm.runInContext('_pushCollection(LS.bookings,previous,next)',context);
 assert.equal(calls.length,1);assert.equal(calls[0].method,'delete');assert.deepEqual(calls[0].ids,['b']);
 calls.length=0;context.previous=null;context.next=[a];
 await vm.runInContext('_pushCollection(LS.bookings,previous,next)',context);
 assert.equal(calls.length,1);assert.equal(calls[0].method,'upsert');
 console.log('PASS: changed-row writes, explicit-row deletes, unknown remote rows never scanned or deleted');
})();
