const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const LS=Object.fromEntries(['user','bookings','maint','tickets','meetings','reqspec','settings'].map(k=>[k,k]));
let allowed=true,mode='allowed',calls=0;const client={from(){return{upsert(){calls++;return{select:async()=>mode==='error'?{error:{code:'42501'}}:{data:mode==='allowed'?[{check_id:'item'}]:[]}};}};}};
const context={LS,DEMO_MODE:false,can:()=>allowed,client,console};vm.createContext(context);vm.runInContext(fs.readFileSync('js/db.js','utf8'),context);vm.runInContext('_sb=client',context);
(async()=>{
 const save=()=>vm.runInContext("db.saveCheckState('qa','2026-11-25','item',{state:'ok'})",context);
 allowed=false;await assert.rejects(save(),/permesso/);assert.equal(calls,0);
 allowed=true;mode='error';await assert.rejects(save(),/non ha confermato/);
 mode='filtered';await assert.rejects(save(),/non ha confermato/);
 mode='allowed';await save();
 console.log('PASS: denied or unconfirmed check saves reject; only confirmed persistence reports success');
})();
