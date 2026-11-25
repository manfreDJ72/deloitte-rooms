const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
let role='Founder';const store=new Map();const context={localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},currentUser:()=>({role})};vm.createContext(context);vm.runInContext(fs.readFileSync('js/config.js','utf8'),context);
assert.equal(vm.runInContext("can('prenotazioni','crea')",context),true);
assert.equal(vm.runInContext("can('settings','accesso')",context),false);
assert.equal(vm.runInContext("can('prenotazioni','elimina')",context),false);
role='unknown';assert.equal(vm.runInContext("can('prenotazioni','crea')",context),false);
console.log('PASS: legacy Founder has explicit operator permissions; unknown roles receive no permissions');
