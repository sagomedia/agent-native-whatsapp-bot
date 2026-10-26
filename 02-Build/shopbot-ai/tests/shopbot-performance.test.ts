import {test} from 'node:test';
import assert from 'node:assert/strict';
import {redesignApi} from '../apps/dashboard/src/redesign-api.js';
import {cachedOwnerRead,invalidateOwnerReads,rememberOwnerRead} from '../apps/dashboard/src/owner-read-cache.js';
import {visiblePoll} from '../apps/dashboard/src/owner-polling.js';
const response=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
test('private read cache expires, is bounded and rejects results from before a mutation',()=>{
 invalidateOwnerReads();for(let i=0;i<40;i++)rememberOwnerRead('item-'+i,{i});assert.equal(cachedOwnerRead('item-0'),undefined);assert.deepEqual(cachedOwnerRead('item-39'),{i:39});
 const now=Date.now;try{rememberOwnerRead('expires',{ok:true});Date.now=()=>now()+61000;assert.equal(cachedOwnerRead('expires'),undefined);}finally{Date.now=now;}
 invalidateOwnerReads();assert.equal(cachedOwnerRead('item-39'),undefined);
});
test('concurrent reads share one fetch and cancelling one subscriber preserves the other',async()=>{
 const original=globalThis.fetch;invalidateOwnerReads();let calls=0,complete!:(r:Response)=>void,aborted=false;
 globalThis.fetch=async(_url,init)=>{calls++;init?.signal?.addEventListener('abort',()=>{aborted=true;});return new Promise<Response>(r=>complete=r);};
 try{const a=new AbortController(),b=new AbortController();const first=redesignApi('test-shared',undefined,a.signal),second=redesignApi('test-shared',undefined,b.signal);const failure=assert.rejects(first,{name:'AbortError'});a.abort();await failure;assert.equal(calls,1);assert.equal(aborted,false);complete(response({value:42}));assert.deepEqual(await second,{value:42});assert.deepEqual(cachedOwnerRead('test-shared'),{value:42});}finally{globalThis.fetch=original;invalidateOwnerReads();}
});
test('mutation invalidation keeps older reads out of cache and new reads out of an old flight',async()=>{
 const original=globalThis.fetch;invalidateOwnerReads();let reads=0,finishOld!:(r:Response)=>void;
 globalThis.fetch=async(_url,init)=>{if(init?.method==='POST')return response({saved:true});reads++;return reads===1?new Promise<Response>(r=>finishOld=r):response({revision:2});};
 try{const old=redesignApi('test-version');await redesignApi('test-write',{revision:1});assert.deepEqual(await redesignApi('test-version'),{revision:2});finishOld(response({revision:1}));await old;assert.deepEqual(cachedOwnerRead('test-version'),{revision:2});assert.equal(reads,2);}finally{globalThis.fetch=original;invalidateOwnerReads();}
});
test('failed writes are never automatically replayed and rejected reads are not cached',async()=>{
 const original=globalThis.fetch;invalidateOwnerReads();let calls=0;
 globalThis.fetch=async()=>{calls++;throw new Error('connection lost after possible commit');};
 try{await assert.rejects(redesignApi('test-write-failure',{id:'stable-id'}),/connection lost/);assert.equal(calls,1);await assert.rejects(redesignApi('test-read-failure'),/connection lost/);assert.equal(cachedOwnerRead('test-read-failure'),undefined);}finally{globalThis.fetch=original;invalidateOwnerReads();}
});
test('authorization rejection clears retained private reads',async()=>{
 const original=globalThis.fetch;rememberOwnerRead('private-record',{id:1});globalThis.fetch=async()=>new Response(JSON.stringify({error:'Sign in required'}),{status:403,headers:{'content-type':'application/json'}});
 try{await assert.rejects(redesignApi('test-auth'),/sign-in may have expired/);assert.equal(cachedOwnerRead('private-record'),undefined);}finally{globalThis.fetch=original;invalidateOwnerReads();}
});
test('visibility and focus coalesce into one resumed poll',async()=>{
 class Doc extends EventTarget{hidden=false;}const doc=new Doc(),win=new EventTarget();let calls=0,finish:()=>void=()=>{};
 const stop=visiblePoll(async()=>{calls++;await new Promise<void>(resolve=>finish=resolve);},{intervalMs:60000,doc,win,nav:{onLine:true}});
 try{finish();await new Promise(r=>setTimeout(r,0));doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));win.dispatchEvent(new Event('focus'));assert.equal(calls,2);finish();await new Promise(r=>setTimeout(r,15));assert.equal(calls,2);}finally{stop();finish();}
});
