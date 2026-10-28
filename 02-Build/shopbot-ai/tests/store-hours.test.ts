import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {readStoreHours,storeHoursSchema,appendClosedShopNotice,hoursAnswer} from '../apps/server/src/services/store-hours.js';
import {ownerDailyBriefing} from '../apps/server/src/services/owner-daily-briefing.js';
import {confirmedPriceBill} from '../apps/server/src/services/confirmed-bill.js';
import {createApp} from '../apps/server/src/http/app.js';
import {customerContact} from '../apps/dashboard/src/customer-contact.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {MockInterpreter} from '../apps/server/src/adapters/mock-interpreter.js';

const allDays=[0,1,2,3,4,5,6],p={storeId:fixtureStore,actor:'hours-owner',canReadOwner:true};
const normal={timezone:'Asia/Kolkata',opensAt:'09:00',closesAt:'21:00',days:allDays};
async function fixture(run:(pool:pg.Pool)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='hours_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema});
 try{await setupDatabase(pool,'mock');await run(pool);}finally{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
}
async function save(pool:pg.Pool,schedule:unknown){await pool.query('UPDATE stores SET opening_hours=$2::jsonb WHERE id=$1',[fixtureStore,JSON.stringify(schedule)]);}
async function read(pool:pg.Pool,at?:string){const c=await pool.connect();try{return await readStoreHours(c,fixtureStore,at?new Date(at):undefined);}finally{c.release();}}

test('shop hours validate days, timezone and unambiguous different times',()=>{
 assert.ok(storeHoursSchema.safeParse(normal).success);
 for(const value of [{...normal,opensAt:'25:00'},{...normal,closesAt:'09:00'},{...normal,days:[]},{...normal,days:[1,1]},{...normal,timezone:'not/a-zone'}])assert.equal(storeHoursSchema.safeParse(value).success,false);
});
test('saved hours respect exact boundaries, closed weekdays and overnight shifts',()=>fixture(async pool=>{
 assert.equal((await read(pool)).status,'not_configured');await save(pool,normal);
 assert.equal((await read(pool,'2026-10-28T03:29:59Z')).status,'closed');assert.equal((await read(pool,'2026-10-28T03:30:00Z')).status,'open');
 const closed=await read(pool,'2026-10-28T15:30:00Z');assert.equal(closed.status,'closed');assert.equal(closed.nextOpening,'2026-10-29T03:30:00.000Z');assert.equal(closed.lastClosing,'2026-10-28T15:30:00.000Z');
 await save(pool,{...normal,days:[1,2,3,4,5]});const sunday=await read(pool,'2026-11-01T08:00:00Z');assert.equal(sunday.status,'closed');assert.equal(sunday.nextOpening,'2026-11-02T03:30:00.000Z');assert.equal(sunday.lastClosing,'2026-10-30T15:30:00.000Z');
 await save(pool,{...normal,opensAt:'20:00',closesAt:'02:00',days:[3]});const overnight=await read(pool,'2026-10-28T19:30:00Z');assert.equal(overnight.status,'open');assert.equal(overnight.closesAt,'2026-10-28T20:30:00.000Z');assert.equal((await read(pool,'2026-10-28T20:30:00Z')).status,'closed');
}));
test('calendar calculations use saved timezone across daylight saving changes and isolate shops',()=>fixture(async pool=>{
 await save(pool,{timezone:'America/New_York',opensAt:'09:00',closesAt:'18:00',days:allDays});
 const after=await read(pool,'2026-03-08T12:59:00Z');assert.equal(after.nextOpening,'2026-03-08T13:00:00.000Z');assert.equal(after.lastClosing,'2026-03-07T23:00:00.000Z');
 const other=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other','true')",[other]);const c=await pool.connect();try{assert.equal((await readStoreHours(c,other)).status,'not_configured');}finally{c.release();}
}));
test('morning preparation uses the saved closing boundary, exposes audit steps and never asks routine questions',()=>fixture(async pool=>{
 await save(pool,normal);const initial=await ownerDailyBriefing(pool,p,{});assert.equal(initial.afterClosing.status,'available');assert.equal(initial.timezone,'Asia/Kolkata');
 const close=initial.shopHours.lastClosing!;
 for(const delta of [-1,1]){const conversationId=randomUUID();await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'hours-test')",[conversationId,fixtureStore]);await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise,created_at) VALUES($1,$2,$3,'hours-test',$4,'[]',1000,$5)",[randomUUID(),fixtureStore,conversationId,randomUUID(),new Date(Date.parse(close)+delta)]);}
 const before=await pool.query('SELECT (SELECT count(*) FROM owner_audit) audit,(SELECT count(*) FROM whatsapp_outbox) outbox');const report=await ownerDailyBriefing(pool,p,{});
 assert.equal(report.afterClosing.received,1);assert.ok(!('question' in report.afterClosing));assert.match(report.presentationInstructions,/without routine questions/);
 assert.deepEqual(report.preparation.steps.slice(0,3).map(s=>s.tool),['catalog_audit_get','catalog_audit','owner_operations']);assert.equal(report.preparation.status,'checks_required');
 assert.deepEqual((await pool.query('SELECT (SELECT count(*) FROM owner_audit) audit,(SELECT count(*) FROM whatsapp_outbox) outbox')).rows,before.rows);
}));
test('closed bills show only the reopening notice and append it once',()=>fixture(async pool=>{
 await save(pool,normal);const hours=await read(pool,'2026-10-28T16:00:00Z');
 for(const replyLanguage of ['en','ta','ta-Latn'] as const){const bill=confirmedPriceBill(replyLanguage,randomUUID(),[{id:randomUUID(),name:'Tape',quantity:1,unit:'piece',pricePaise:1000,resolution:'matched',merchantConfirmed:{actor:'shop',at:'2026-01-01',free:false}}],1000);
  const decorated=appendClosedShopNotice(bill,hours,{replyLanguage});assert.equal(decorated.parts!.at(-1)!.text.includes(hoursAnswer(hours,{replyLanguage})),true);assert.deepEqual(appendClosedShopNotice(decorated,hours,{replyLanguage}),decorated);assert.equal(decorated.text,bill.text+'\n\n'+hoursAnswer(hours,{replyLanguage}));
 }
 const open=await read(pool,'2026-10-28T07:00:00Z'),bill=confirmedPriceBill('en',randomUUID(),[{id:randomUUID(),name:'Tape',quantity:1,unit:'piece',pricePaise:1000,resolution:'matched',merchantConfirmed:{actor:'shop',at:'2026-01-01',free:false}}],1000);assert.deepEqual(appendClosedShopNotice(bill,open,{replyLanguage:'en'}),bill);
}));
test('hours settings require authenticated owner origin, validate input and reject stale edits',()=>fixture(async pool=>{
 const owner={hostname:'owner.example.test',issuer:'https://fixture.cloudflareaccess.com',audience:'hours-test',email:'owner@example.test',storeId:fixtureStore};
 const app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/hours-media',owner},pool,undefined,undefined,async token=>{if(token!=='test')throw Error('Bad token');return {email:owner.email,subject:'fixture'};});
 const headers={host:owner.hostname,'cf-access-jwt-assertion':'test',origin:'https://'+owner.hostname,'x-shopbot-owner':'1'};
 try{assert.equal((await app.inject({method:'GET',url:'/api/owner/store/hours',headers:{host:owner.hostname}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/owner/store/hours',headers:{...headers,origin:'https://elsewhere.test'},payload:{expectedRevision:0,schedule:normal}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/owner/store/hours',headers,payload:{expectedRevision:0,schedule:{...normal,days:[]}}})).statusCode,400);
  const saved=await app.inject({method:'POST',url:'/api/owner/store/hours',headers,payload:{expectedRevision:0,schedule:normal}});assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().revision,1);
  assert.equal((await app.inject({method:'POST',url:'/api/owner/store/hours',headers,payload:{expectedRevision:0,schedule:{...normal,opensAt:'10:00'}}})).statusCode,409);
  assert.equal((await read(pool)).schedule!.opensAt,'09:00');
 }finally{await app.close();}
}));
test('saved WhatsApp numbers produce a dialer link without guessing or accepting arbitrary URLs',()=>{
 assert.deepEqual(customerContact('919876543210'),{number:'+919876543210',href:'tel:+919876543210'});assert.equal(customerContact('+919876543210')!.href,'tel:+919876543210');
 for(const value of [undefined,'local-simulator','javascript:alert(1)','123','0001234567','+91 98765'])assert.equal(customerContact(value),null);
});
test('saved hours do not change responses outside the billing flow',()=>fixture(async pool=>{
 await save(pool,normal);const conversationId=randomUUID();await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'hours-runtime')",[conversationId,fixtureStore]);
 const inbox=new SimulatorService(pool,{storeId:fixtureStore,conversationId,actor:'hours-runtime',role:'customer'}),runtime=new ConversationRuntime(pool,new MockInterpreter());
 await inbox.ingest({id:randomUUID(),type:'text',text:'What are your opening hours?'});await runtime.processNext(inbox.context);
 const state=await inbox.snapshot(),last=state.messages.at(-1)!;assert.match(last.text,/opening hours aren’t in this catalog/);
}));

for(const visualOrdering of [false,true])test(`real ${visualOrdering?'image':'text'} bills and submissions attach truthful closing context`,()=>fixture(async pool=>{
 await pool.query('UPDATE products SET selling_unit_verified=true WHERE store_id=$1',[fixtureStore]);
 await save(pool,{timezone:'UTC',opensAt:'09:00',closesAt:'18:00',days:[(new Date().getUTCDay()+1)%7]});
 const conversationId=randomUUID();await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'hours-bill')",[conversationId,fixtureStore]);
 const inbox=new SimulatorService(pool,{storeId:fixtureStore,conversationId,actor:'hours-bill',role:'customer'}),runtime=new ConversationRuntime(pool,new MockInterpreter(),{visualOrdering});
 await inbox.ingest({id:randomUUID(),type:'text',text:'I need two PTFE tape rolls'});await runtime.processNext(inbox.context);
 if(visualOrdering){const preview=await inbox.snapshot(),r=preview.messages.at(-1)!.rich!;const approval=[...r.buttons??[],...(r.parts??[]).flatMap(part=>[...part.buttons??[],...part.cards.flatMap(card=>card.buttons??[])])].find(b=>b.event.type==='confirm_products');assert.ok(approval);await inbox.ingest({...approval.event,id:randomUUID()});await runtime.processNext(inbox.context);}
 const draft=await inbox.snapshot(),reply=draft.messages.at(-1)!.rich!;assert.equal(reply.kind,'order_review',JSON.stringify({text:reply.text,pending:draft.conversation.pending,stage:reply.stage}));assert.match(reply.text,/The shop is closed/);assert.match(reply.text,/Opens/);assert.doesNotMatch(reply.text,/send your order now|order request is noted/);assert.equal(draft.requests.length,0);assert.equal(draft.conversation.pending?.kind,'review');
 await inbox.ingest({id:randomUUID(),type:'confirm',reviewId:draft.conversation.pending!.id});await runtime.processNext(inbox.context);
 const submitted=await inbox.snapshot();assert.equal(submitted.requests.length,1);assert.match(submitted.messages.at(-1)!.text,/The shop is closed.*Opens/);assert.doesNotMatch(submitted.messages.at(-1)!.text,/order request is noted/);
}));
