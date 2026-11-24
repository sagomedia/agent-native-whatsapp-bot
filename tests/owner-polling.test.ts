import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as wait} from 'node:timers/promises';
import {visiblePoll} from '../apps/dashboard/src/owner-polling.js';
import {latestCatalogRead} from '../apps/dashboard/src/owner-catalog-loading.js';
class Doc extends EventTarget{hidden=false;}
async function flush(){await Promise.resolve();await Promise.resolve();await Promise.resolve();}
test('owner polling avoids offline traffic, cancels in-flight reads, and resumes when connectivity returns',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const doc=new Doc(),win=new EventTarget(),nav={onLine:false};let calls=0,signal:AbortSignal|undefined;
 const stop=visiblePoll(async s=>{calls++;signal=s;await new Promise<void>((_resolve,reject)=>s.addEventListener('abort',()=>reject(s.reason),{once:true}));},{intervalMs:5000,doc,win,nav});
 try{
  t.mock.timers.tick(60000);assert.equal(calls,0);
  nav.onLine=true;win.dispatchEvent(new Event('online'));assert.equal(calls,1);
  nav.onLine=false;win.dispatchEvent(new Event('offline'));assert.equal(signal?.aborted,true);await flush();
  t.mock.timers.tick(60000);assert.equal(calls,1);
  nav.onLine=true;win.dispatchEvent(new Event('online'));assert.equal(calls,2);
 }finally{stop();await flush();}
});
test('owner polling backs off repeated failures and resets to its normal cadence after success',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const doc=new Doc(),win=new EventTarget();let calls=0,fail=true;
 const stop=visiblePoll(async()=>{calls++;if(fail)throw new Error('Offline upstream');},{intervalMs:5000,doc,win,nav:{onLine:true}});
 try{
  await flush();assert.equal(calls,1);t.mock.timers.tick(9999);assert.equal(calls,1);t.mock.timers.tick(1);await flush();assert.equal(calls,2);
  t.mock.timers.tick(19999);assert.equal(calls,2);fail=false;t.mock.timers.tick(1);await flush();assert.equal(calls,3);
  t.mock.timers.tick(5000);await flush();assert.equal(calls,4);
 }finally{stop();}
});
test('owner polling waits for completion, pauses hidden and aborts on disposal',async()=>{
 const doc=new Doc(),win=new EventTarget();let calls=0,finish:()=>void=()=>{},signal:AbortSignal|undefined;
 const stop=visiblePoll(async s=>{calls++;signal=s;await new Promise<void>(resolve=>{finish=resolve;});},{intervalMs:5,doc,win});
 try{assert.equal(calls,1);await wait(20);assert.equal(calls,1);finish();await wait(20);assert.equal(calls,2);doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(signal?.aborted,true);finish();await wait(20);assert.equal(calls,2);doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(calls,3);stop();assert.equal(signal?.aborted,true);finish();await wait(15);assert.equal(calls,3);}finally{stop();finish();}
});
test('disabled owner polling starts no requests, including on focus',async()=>{const doc=new Doc(),win=new EventTarget();let calls=0;const stop=visiblePoll(async()=>{calls++;},{enabled:false,intervalMs:1,doc,win});try{win.dispatchEvent(new Event('focus'));await wait(10);assert.equal(calls,0);}finally{stop();}});
test('owner polling resumes immediately when the connection returns and removes its listener on disposal',async()=>{
 const doc=new Doc(),win=new EventTarget();let calls=0;
 const stop=visiblePoll(async()=>{calls++;},{intervalMs:60000,doc,win});
 await wait(5);assert.equal(calls,1);win.dispatchEvent(new Event('online'));await wait(5);assert.equal(calls,2);
 stop();win.dispatchEvent(new Event('online'));await wait(5);assert.equal(calls,2);
});
test('catalog reads abort superseded work while retaining late-result guards',async()=>{const reads=latestCatalogRead();let firstSignal:AbortSignal|undefined,resolveFirst!:(value:string)=>void;const applied:string[]=[],errors:Error[]=[];const first=reads.run(signal=>{firstSignal=signal;return new Promise<string>(resolve=>resolveFirst=resolve);},v=>applied.push(v),e=>errors.push(e));await reads.run(async()=> 'new',v=>applied.push(v),e=>errors.push(e));assert.equal(firstSignal?.aborted,true);resolveFirst('old');await first;assert.deepEqual(applied,['new']);assert.deepEqual(errors,[]);reads.cancel();});
