import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {discoverProducts} from '../apps/server/src/services/catalog-discovery.js';
import {loadAssistantMemory,saveAssistantMemory} from '../apps/server/src/services/agent-assistance.js';
import {amountToCount} from '../apps/server/src/services/quantity-evidence.js';
import {submissionIntent,validateCurrentTurn} from '../apps/server/src/services/current-turn.js';
import {phrasingLanguage} from '../packages/contracts/language.js';
import type {Interpretation,Snapshot,ConversationState,SimulatorEvent} from '../packages/contracts/index.js';
import type {InterpretationInput,Interpreter} from '../apps/server/src/adapters/interpreter.js';
import {startWhatsAppJobs} from '../apps/server/src/jobs/whatsapp.js';
import type {WhatsAppChannel} from '../apps/server/src/services/whatsapp-channel.js';

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='inventory_flow_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');await setupImageDemo(pool);const id=randomUUID();await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language,visual_ordering) VALUES($1,$2,'inventory-test','ta',true)",[id,demoCatalogStore]);await run(pool,new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'inventory-test',role:'customer'}));}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
function planner(plan:(i:InterpretationInput)=>Interpretation):Interpreter{return {name:'controlled-current-turn-test',mode:'mock',interpret:async i=>({output:plan(i),truncated:false,usage:null})};}
async function send(inbox:SimulatorService,runtime:ConversationRuntime,event:Omit<Extract<SimulatorEvent,{type:'text'}>,'id'>|SimulatorEvent){await inbox.ingest({...event,id:'id' in event?event.id:randomUUID()});await runtime.processNext(inbox.context);return inbox.snapshot();}
const text=(i:SimulatorService,r:ConversationRuntime,t:string)=>send(i,r,{type:'text',text:t});
const last=(s:Snapshot)=>s.messages.at(-1)!.rich!;
const actions=(s:Snapshot)=>last(s).parts!.flatMap(p=>p.cards.flatMap(c=>c.buttons??[]));

test('set solvent five, add four extra elbows and remove two unresolved products atomically during pending review',()=>fixture(async(pool,inbox)=>{
 let phase=0;const runtime=new ConversationRuntime(pool,planner(i=>phase===0?{next:'review',operations:[{kind:'add_item',query:'H05',quantity:1},{kind:'add_item',query:'H07',quantity:1},{kind:'add_item',query:'H29',quantity:1},{kind:'add_item',query:'Asian paint missing',quantity:1},{kind:'add_item',query:'brush',quantity:1}]}:{next:'review',operations:[{kind:'set_quantity',reference:i.state.draft[1].id,quantity:5,supportingPhrase:'solvent five'},{kind:'increment_quantity',reference:i.state.draft[0].id,delta:4,supportingPhrase:'four extra elbows'},...i.state.draft.slice(3).map(l=>({kind:'remove_item' as const,reference:l.id,supportingPhrase:'remove paint and brush'}))]}),{visualOrdering:true});
 let s=await text(inbox,runtime,'elbow, solvent, gloves, paint and brush');const ids=s.conversation.draft.map(l=>l.id);phase=1;s=await text(inbox,runtime,'solvent five, four extra elbows, remove paint and brush');assert.equal(s.conversation.draft.length,3);assert.deepEqual(s.conversation.draft.map(l=>l.id),ids.slice(0,3));assert.deepEqual(s.conversation.draft.map(l=>l.quantity),[5,5,1]);assert.equal(last(s).stage,'products');assert.equal(last(s).parts!.flatMap(p=>p.cards).filter(c=>c.kind==='product').length,3);assert.equal(s.requests.length,0);
}));

test('Tamil evidence repair is text-only and preserves every line, negated compressor never added',()=>fixture(async(pool,inbox)=>{
 let calls=0;const runtime=new ConversationRuntime(pool,planner(i=>{calls++;if(!i.planningFeedback)return {next:'review',operations:[{kind:'add_item',query:'garden hose',quantity:1,productIntent:{kind:'inferred',sourcePhrase:'thanni oothura tube'}},{kind:'add_item',query:'compressor',quantity:1}]};assert.ok(i.proposal);assert.equal(i.audio,undefined);return {next:'review',operations:[{kind:'add_item',query:'garden hose',quantity:1,productIntent:{kind:'inferred',sourcePhrase:'தண்ணி ஊத்துற டியூப்'}}]};}),{visualOrdering:true});
 const s=await text(inbox,runtime,'தண்ணி ஊத்துற டியூப் ஒன்று, compressor வேண்டாம்');assert.equal(calls,2);assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].query,'garden hose');assert.equal(s.conversation.replyLanguage,'ta');
}));

test('repeated invalid polarity repairs do not partially change the draft',()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner(()=>({next:'review',operations:[{kind:'add_item',query:'H08',quantity:1},{kind:'add_item',query:'compressor',quantity:1}]})),{visualOrdering:true});
 const s=await text(inbox,runtime,'tape one, compressor venda');assert.equal(s.conversation.draft.length,0);assert.equal(s.interpretationAttempts,2);
}));

test('paint family phrases retain word order while brand and litre-vs-kg remain protected',()=>fixture(async(pool,inbox)=>{
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,brand,specifications,aliases) VALUES($1,'NEW-PAINT','Asian Paints Tractor Uno Acrylic Emulsion Paint 10L','can',120000,2,'paint','Asian Paints','{\"size\":\"10L\"}','[]'),($1,'WRONG-PAINT','Other Paint 10kg','box',100000,2,'paint','Other','{\"size\":\"10kg\"}','[]')",[demoCatalogStore]);
 const c=await pool.connect();try{const withoutPlan=await discoverProducts(c,inbox.context,'Asian Paints wall paint');assert.ok(withoutPlan.products.some(p=>p.sku==='NEW-PAINT'));const result=await discoverProducts(c,inbox.context,'Asian Paints wall paint',{keywords:['paint'],familyId:'paint',brand:'Asian Paints'});assert.ok(result.products.some(p=>p.sku==='NEW-PAINT'));assert.ok(result.products.every(p=>p.brand==='Asian Paints'));assert.equal((await discoverProducts(c,inbox.context,'paint brush',{keywords:['paint'],familyId:'paint'})).products.length,0);}finally{c.release();}
}));

test('inventory updates invalidate remembered suggestions immediately and remain store scoped',()=>fixture(async(pool,inbox)=>{
 const c=await pool.connect();try{await saveAssistantMemory(c,inbox.context,{purpose:'discovery',queries:['tape'],lineId:null,sourceVersion:0,observations:[]});assert.ok(await loadAssistantMemory(c,inbox.context));await c.query("UPDATE products SET stock=stock+1,version=version+1 WHERE store_id=$1 AND sku='H08'",[demoCatalogStore]);assert.equal(await loadAssistantMemory(c,inbox.context),null);}finally{c.release();}
}));

test('short greetings stay Tamil, sustained Tanglish switches, explicit choice is retained',()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner(()=>({next:'continue',operations:[]})),{visualOrdering:true});
 let s=await text(inbox,runtime,'Hi');assert.equal(s.conversation.replyLanguage,'ta');assert.deepEqual(actions(s).slice(0,2).map(a=>a.label),['தமிழ்','Tanglish']);s=await text(inbox,runtime,'okay nice');assert.equal(s.conversation.replyLanguage,'ta');assert.equal(phrasingLanguage('Asian Paints 10L'),undefined);assert.equal(phrasingLanguage('enakku oru tape venum'),'ta-Latn');
 s=await text(inbox,runtime,'enakku oru tape venum');assert.equal(s.conversation.replyLanguage,'ta-Latn');s=await send(inbox,runtime,{id:randomUUID(),type:'change_language',language:'ta'});s=await text(inbox,runtime,'enakku oru tape venum');assert.equal(s.conversation.replyLanguage,'ta');
}));

test('short submission intents skip historical model edits and route to current prerequisites',()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner(()=>{throw Error('submission must not invoke planning');}),{visualOrdering:true});assert.equal(submissionIntent('Ok perfect, anupirlam'),true);assert.equal(submissionIntent('அனுப்பலாம்'),true);assert.equal(submissionIntent('remove paint and send it'),false);
 const s=await text(inbox,runtime,'Ok perfect, anupirlam');assert.equal(s.interpretationAttempts,0);assert.equal(s.requests.length,0);
}));

test('outbound and reconciliation continue while one planning worker is waiting',async()=>{
 let finish!:()=>void;const wait=new Promise<void>(r=>finish=r);let sends=0,reconciles=0,plans=0;const channel={reconcile:async()=>{reconciles++;},sendNext:async()=>{sends++;return true;},processNext:async()=>{plans++;await wait;return true;}};
 const errors:unknown[]=[];const stop=await startWhatsAppJobs(channel as unknown as WhatsAppChannel,e=>errors.push(e));await new Promise(r=>setTimeout(r,1100));assert.equal(plans,1);assert.ok(sends>=2);assert.ok(reconciles>=2);finish();await stop();assert.deepEqual(errors,[]);
});

 test('requested volume is converted in the verified selling unit, not automatically divided by a pictured pack',()=>{
 const product={sku:'PAINT',name:'10L paint',unit:'litre',pricePaise:10000,stock:50,version:1,aliases:[],quantityStep:1,specifications:{size:'10L'},sellingUnitVerified:true};
 const line={id:randomUUID(),name:'paint',quantity:null,resolution:'needs_quantity' as const,requestedAmount:{value:20,unit:'litre'}};
 assert.equal(amountToCount(line,product),20);assert.equal(amountToCount(line,{...product,unit:'can'}),2);assert.equal(amountToCount(line,{...product,sellingUnitVerified:false}),null);
});

test('an unfamiliar inferred watering query is repaired using actual per-line family products, without losing tape and gloves',()=>fixture(async(pool,inbox)=>{
 let seen=false;const runtime=new ConversationRuntime(pool,planner(input=>{
  if(!input.planningFeedback)return {next:'review',operations:[{kind:'add_item',query:'irrigation hose',quantity:1,search:{keywords:['irrigation hose'],familyId:'hose'},productIntent:{kind:'inferred',sourcePhrase:'தண்ணி ஊத்துற டியூப்'}},{kind:'add_item',query:'H08',quantity:1},{kind:'add_item',query:'H29',quantity:1}]};
  assert.ok(input.observations?.some(o=>o.products.some(p=>p.sku==='H13')));seen=true;return {next:'review',operations:[{kind:'add_item',query:'H13',quantity:1,search:{keywords:['garden hose'],familyId:'hose'},productIntent:{kind:'inferred',sourcePhrase:'தண்ணி ஊத்துற டியூப்'}},{kind:'add_item',query:'H08',quantity:1},{kind:'add_item',query:'H29',quantity:1}]};
 }),{visualOrdering:true});const s=await text(inbox,runtime,'தண்ணி ஊத்துற டியூப், tape ஒன்று, gloves ஒன்று');assert.ok(seen);assert.deepEqual(s.conversation.draft.map(l=>l.sku),['H13','H08','H29']);assert.deepEqual(s.conversation.draft.map(l=>l.quantity),[1,1,1]);assert.equal(s.requests.length,0);
}));

test('catalog filter treats 10 litre and 10L as the same verified size and excludes 10kg',()=>fixture(async(pool,inbox)=>{
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,brand,specifications) VALUES($1,'VOLUME-PAINT','Asian Paints Wall Paint 10L','can',120000,2,'paint','Asian Paints','{\"size\":\"10L\"}'),($1,'WEIGHT-PAINT','Asian Paints Wall Paint 10kg','box',100000,2,'paint','Asian Paints','{\"size\":\"10kg\"}')",[demoCatalogStore]);
 const c=await pool.connect();try{const result=await discoverProducts(c,inbox.context,'Asian Paints wall paint',{keywords:['paint'],familyId:'paint',brand:'Asian Paints',specifications:{size:'10 litre'}});assert.deepEqual(result.products.map(p=>p.sku),['VOLUME-PAINT']);}finally{c.release();}
}));

 test('a count of one packed paint is never silently one litre, even when the merchant verified per-litre selling',()=>fixture(async(pool,inbox)=>{
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,brand,specifications,selling_unit_verified) VALUES($1,'PER-LITRE','Asian Paints Paint 10L','litre',12000,50,'paint','Asian Paints','{\"size\":\"10L\"}',true)",[demoCatalogStore]);
 const runtime=new ConversationRuntime(pool,planner(()=>({next:'review',operations:[{kind:'add_item',query:'PER-LITRE',quantity:1,packSize:{value:10,unit:'litre'}}]})),{visualOrdering:true});
 const s=await text(inbox,runtime,'Asian Paints 10L ஒன்று');assert.equal(s.conversation.draft[0].resolution,'needs_unit');assert.equal(s.conversation.draft[0].quantity,null);assert.equal(s.conversation.draft[0].requestedQuantity,1);assert.equal(s.requests.length,0);
}));

 test('clear named removals work with short customer names when an earlier placeholder contains missing',()=>fixture(async(pool,inbox)=>{
 let seeded=false;const runtime=new ConversationRuntime(pool,planner(input=>!seeded?{next:'review',operations:[{kind:'add_item',query:'H08',quantity:1},{kind:'add_item',query:'Asian paint missing',quantity:1},{kind:'add_item',query:'brush',quantity:1}]}:{next:'review',operations:input.state.draft.slice(1).map(l=>({kind:'remove_item',reference:l.id}))}),{visualOrdering:true});
 let s=await text(inbox,runtime,'three requests');const id=s.conversation.draft[0].id;seeded=true;s=await text(inbox,runtime,'Asian paint and brush venda');assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].id,id);assert.equal(last(s).stage,'products');
}));
