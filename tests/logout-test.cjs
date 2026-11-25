const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const values={'dlt_user':'synthetic','dlt_bookings':'private-cache','sb-qa-auth-token':'session','unrelated':'keep'};
const localStorage={...values};
Object.defineProperty(localStorage,'removeItem',{enumerable:false,value:key=>delete localStorage[key]});
let scope;
const client={auth:{signOut:async options=>{scope=options.scope;}}};
const context={DEMO_MODE:false,SUPABASE_URL:'https://qa.supabase.co',SUPABASE_ANON_KEY:'publishable',supabase:{createClient:()=>client},LS:{},localStorage,window:{location:{}},URL,console};
vm.createContext(context);vm.runInContext(fs.readFileSync('js/db.js','utf8'),context);
(async()=>{await vm.runInContext('db.signOut()',context);assert.equal(scope,'local');assert.equal(localStorage.dlt_user,undefined);assert.equal(localStorage.dlt_bookings,undefined);assert.equal(localStorage['sb-qa-auth-token'],undefined);assert.equal(localStorage.unrelated,'keep');assert.equal(context.window.location.href,'index.html');console.log('PASS: logout revokes local Auth session and clears app data/token before redirect');})();
