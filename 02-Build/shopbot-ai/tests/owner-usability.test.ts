import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {createApp} from '../apps/server/src/http/app.js';
import {fixtureStore} from '../profiles/hardware.js';
import {stockChangePreview} from '../apps/dashboard/src/owner-stock-preview.js';
import {inlineFactsCsv} from '../apps/dashboard/src/owner-inline-facts.js';
import {ownerSearchPattern} from '../apps/server/src/services/owner-read-query.js';
import type {Product} from '../packages/contracts/index.js';

test('stock previews retain holds, exact increments and the difference between zero and unknown',()=>{
 const p={stockOnHand:12,stockReserved:3,quantityStep:1};
 assert.deepEqual(stockChangePreview(p,'restock','6'),{onHand:18,reserved:3,available:15,error:''});
 assert.equal(stockChangePreview(p,'sale','2').available,7);
 assert.match(stockChangePreview(p,'count','2').error,/held/);
 assert.match(stockChangePreview({...p,stockOnHand:null},'restock','2').error,/unknown/);
 assert.equal(stockChangePreview({...p,stockReserved:0},'count','0').onHand,0);
 assert.match(stockChangePreview(p,'restock','0').error,/above zero/);
 assert.equal(stockChangePreview({...p,quantityStep:0.125},'restock','0.375').onHand,12.375);
 assert.match(stockChangePreview({...p,quantityStep:0.125},'restock','0.2').error,/increment/);
 assert.match(stockChangePreview(p,'count','1e2').error,/stock quantity/);
});
test('inline facts writes only edited fields and never silently clears an untouched count or makes an unknown item free',()=>{
 const p={sku:'SHOP-1',name:'Switch, 6A',version:4,inventoryVersion:7,unit:'piece',quantityStep:1,stockOnHand:12,stockReserved:3} as Product;
 const csv=inlineFactsCsv([{product:p,price:'25.50'}]);
 assert.match(csv,/"SHOP-1","4","7","Switch, 6A","piece","25.50","priced","yes","",""/);
 assert.throws(()=>inlineFactsCsv([{product:p,price:'0'}]),/free/);
 assert.match(inlineFactsCsv([{product:p,price:'0',free:true}]),/"0","free","yes"/);
 assert.throws(()=>inlineFactsCsv([{product:p,stock:''}]),/physical count/);
 assert.throws(()=>inlineFactsCsv([{product:p,stock:'2'}]),/held/);
 assert.match(inlineFactsCsv([{product:p,stock:'18'}]),/"","","","18","yes"/);
 assert.equal(ownerSearchPattern('50%_off\\part'),'%50\\%\\_off\\\\part%');
});
test('owner queue and inbox paging search beyond 100 rows, retain selected metadata and truthful global counts without writes',async()=>{
 const schema='owner_pages_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{
  await setupDatabase(pool,'mock');const ids=Array.from({length:130},()=>({conversation:randomUUID(),order:randomUUID()}));
  for(const [i,id] of ids.entries()){
   await pool.query("INSERT INTO conversations(id,store_id,actor,handoff_requested) VALUES($1,$2,$3,$4)",[id.conversation,fixtureStore,'shopper-'+i,i===0]);
   await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,created_at) VALUES($1,$2,'inbound',$3,'processed',now()-($4::int * interval '1 minute'))",[randomUUID(),id.conversation,i===0?'archived needle':'Message '+i,130-i]);
   await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise,created_at) VALUES($1,$2,$3,$4,$5,$6,100,now()-($7::int * interval '1 minute'))",[id.order,fixtureStore,id.conversation,'shopper-'+i,randomUUID(),JSON.stringify([{id:randomUUID(),name:i===0?'Archived special 50%_item':'Product '+i,quantity:1,unit:'piece',resolution:'unavailable'}]),130-i]);
  }
  await pool.query("UPDATE order_requests SET acceptance='accepted',fulfillment='ready_for_pickup' WHERE id=$1",[ids[1]!.order]);
  const owner={hostname:'owner.example.test',issuer:'https://offline.example.test',audience:'offline',email:'owner@example.test',storeId:fixtureStore};
  app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,host:'127.0.0.1',port:3017,mediaDir:'/tmp/owner-page-test',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline'}));
  const read=async(q:string)=>{const response=await app!.inject({url:'/api/owner/snapshot?details=0&'+q,headers:{host:owner.hostname,'cf-access-jwt-assertion':'offline'}});assert.equal(response.statusCode,200,response.body);return response.json();};
  const first=await read('orderStage=review&inboxPage=1');assert.equal(first.requests.length,25);assert.equal(first.orderPage.total,129);assert.equal(first.requestCounts.ready,1);assert.equal(first.requestCounts.active,130);assert.equal(first.inboxPage.size,25);assert.equal(first.conversationCounts.help,1);
  const all=await read('orderStage=all');assert.equal(all.orderPage.total,130);assert.equal(all.requests.length,25);
  const allCustomer=await read('orderStage=all&orderSearch='+ids[1]!.conversation);assert.equal(allCustomer.requests[0].id,ids[1]!.order);assert.equal(allCustomer.requests[0].fulfillment,'ready_for_pickup');
  const second=await read('orderStage=review&orderPage=2');assert.ok(second.requests.every((r:any)=>!first.requests.some((before:any)=>before.id===r.id)));
  const searched=await read('orderStage=review&orderSearch=Archived');assert.equal(searched.requests.length,1);assert.equal(searched.requests[0].id,ids[0]!.order);assert.equal(searched.orderPage.total,1);
  const literal=await read('orderStage=review&orderSearch='+encodeURIComponent('50%_item'));assert.equal(literal.orderPage.total,1);
  const deep=await read('orderStage=review&order='+ids[0]!.order);assert.equal(deep.orderPage.ids.length,25);assert.equal(deep.requests.length,26);assert.ok(deep.requests.some((r:any)=>r.id===ids[0]!.order));
  const inbox=await read('inboxPage=1&inboxSearch=archived');assert.equal(inbox.inboxPage.total,1);assert.equal(inbox.conversations[0].id,ids[0]!.conversation);
  const help=await read('inboxPage=1&inboxHelp=1');assert.equal(help.inboxPage.total,1);
  for(const query of ['orderPage=0','orderStage=bogus','order=bad','inboxPage=-1','orderSearch='+encodeURIComponent('x'.repeat(201))]){assert.equal((await app!.inject({url:'/api/owner/snapshot?'+query,headers:{host:owner.hostname,'cf-access-jwt-assertion':'offline'}})).statusCode,400);}
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_requests')).rows[0].n,130);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM owner_audit')).rows[0].n,0);
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});

test('owner message pages retain older Tamil evidence with stable, bounded, store-scoped cursors',async()=>{
 const schema='owner_history_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{
  await setupDatabase(pool,'mock');const conversation=randomUUID(),otherStore=randomUUID(),foreign=randomUUID();
  await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'history-shopper')",[conversation,fixtureStore]);
  await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other shop',true)",[otherStore]);
  await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'foreign-shopper')",[foreign,otherStore]);
  const expected:string[]=[];
  for(let index=0;index<405;index++){
   const id=randomUUID();expected.push(id);
   await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status) VALUES($1,$2,'inbound',$3,'processed')",[id,conversation,`தமிழ் பொருள் விவரம் ${index}`]);
  }
  const owner={hostname:'owner.example.test',issuer:'https://offline.example.test',audience:'offline',email:'owner@example.test',storeId:fixtureStore};
  app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,host:'127.0.0.1',port:3017,mediaDir:'/tmp/owner-history-test',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline-owner'}));
  const read=async(id=conversation,cursor='')=>app!.inject({url:'/api/owner/conversations/'+id+(cursor?'?before='+encodeURIComponent(cursor):''),headers:{host:owner.hostname,'cf-access-jwt-assertion':'offline'}});
  const first=(await read()).json();assert.equal(first.messages.length,200);assert.equal(first.limit,200);assert.deepEqual(first.messages.map((m:any)=>m.id),expected.slice(-200));assert.ok(first.olderCursor);
  // New incoming messages cannot shift or duplicate the older page.
  const latest=randomUUID();await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status) VALUES($1,$2,'inbound','New incoming message','processed')",[latest,conversation]);
  const second=(await read(conversation,first.olderCursor)).json(),third=(await read(conversation,second.olderCursor)).json();
  assert.equal(second.messages.length,200);assert.equal(third.messages.length,5);assert.equal(third.olderCursor,null);
  const all=[...third.messages,...second.messages,...first.messages];assert.deepEqual(all.map((m:any)=>m.id),expected);assert.equal(new Set(all.map((m:any)=>m.id)).size,405);assert.ok(all.every((m:any)=>m.text.startsWith('தமிழ் பொருள் விவரம்')));
  assert.equal((await read()).json().messages.at(-1).id,latest);
  assert.equal((await read(foreign,first.olderCursor)).statusCode,404);
  for(const cursor of ['-1','0','1.1','1 OR 1=1','9223372036854775808'])assert.equal((await read(conversation,cursor)).statusCode,400);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM owner_audit')).rows[0].n,0);
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
