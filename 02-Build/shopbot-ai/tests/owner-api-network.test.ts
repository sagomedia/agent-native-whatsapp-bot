import {test} from 'node:test';
import assert from 'node:assert/strict';
import {redesignApi} from '../apps/dashboard/src/redesign-api.js';

test('owner API rejects login pages and malformed success responses instead of accepting empty records',async t=>{
 const responses=[new Response('<html>Sign in</html>',{headers:{'content-type':'text/html'}}),Response.json(null),Response.json([])];
 t.mock.method(globalThis,'fetch',async()=>responses.shift()!);
 for(let i=0;i<3;i++)await assert.rejects(redesignApi('summary'),/unexpected response|incomplete response/);
});
test('owner API reports expired authentication and preserves action validation messages',async t=>{
 const responses=[Response.json({error:'Forbidden'},{status:403}),Response.json({error:'Product changed. Refresh it.'},{status:409}),Response.json({saved:true})];
 t.mock.method(globalThis,'fetch',async()=>responses.shift()!);
 await assert.rejects(redesignApi('summary'),/sign-in may have expired/);
 await assert.rejects(redesignApi('products/simple',{}),/Product changed/);
 assert.deepEqual(await redesignApi('products/simple',{}),{saved:true});
});
test('owner reads time out and cancel their transport instead of leaving the screen loading forever',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let signal:AbortSignal|undefined;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>{signal=init.signal!;signal.addEventListener('abort',()=>reject(signal!.reason),{once:true});}));
 const result=redesignApi('summary'),rejection=assert.rejects(result,/taking too long/);
 t.mock.timers.tick(20000);await rejection;assert.equal(signal?.aborted,true);
});
test('owner writes have a longer deadline, warn about uncertain outcomes, and are never automatically replayed',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0,signal:AbortSignal|undefined;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{calls++;return new Promise<Response>((_resolve,reject)=>{signal=init.signal!;signal.addEventListener('abort',()=>reject(signal!.reason),{once:true});});});
 const result=redesignApi('products/simple',{createId:'same-attempt'}),rejection=assert.rejects(result,/action may already be saved/);
 t.mock.timers.tick(20000);assert.equal(signal?.aborted,false);
 t.mock.timers.tick(100000);await rejection;assert.equal(calls,1);assert.equal(signal?.aborted,true);
});
test('owner API preserves caller cancellation and clears its deadline after success',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let transport:AbortSignal|undefined;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{transport=init.signal!;return Response.json({ok:true});});
 const controller=new AbortController();assert.deepEqual(await redesignApi('summary',undefined,controller.signal),{ok:true});
 controller.abort();t.mock.timers.tick(120000);assert.equal(transport?.aborted,false);
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(init.signal!.reason),{once:true})));
 const second=new AbortController(),cancelled=redesignApi('summary',undefined,second.signal),rejection=assert.rejects(cancelled,{name:'AbortError'});
 second.abort();await rejection;
});

test('expired demo sessions return to the password screen with the current owner view',async t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'window'),locations:string[]=[];
 Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{pathname:'/owner',search:'?view=catalog',assign:(url:string)=>locations.push(url)}}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'window',original);else Reflect.deleteProperty(globalThis,'window');});
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:'Owner sign-in required',signInUrl:'/login'},{status:403}));
 await assert.rejects(redesignApi('summary'),/sign-in may have expired/);
 assert.equal(locations.length,1);const target=new URL(locations[0],'https://owner.example.test');assert.equal(target.pathname,'/login');assert.equal(target.searchParams.get('next'),'/owner?view=catalog');
});
