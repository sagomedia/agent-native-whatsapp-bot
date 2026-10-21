import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as wait} from 'node:timers/promises';
import {visiblePoll} from '../apps/dashboard/src/owner-polling.js';
import {latestCatalogRead} from '../apps/dashboard/src/owner-catalog-loading.js';
class Doc extends EventTarget{hidden=false;}
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
