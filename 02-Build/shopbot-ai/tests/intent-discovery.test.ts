import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {FinishReason,type GenerateContentResponse} from '@google/genai';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {discoverProducts} from '../apps/server/src/services/catalog-discovery.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {GoogleInterpreter,type GoogleTransport} from '../apps/server/src/adapters/google-interpreter.js';
import {geminiTextRate} from '../apps/server/src/services/inference-budget.js';
import {safeQuestion} from '../packages/contracts/language.js';
import {makeProductCheck} from '../apps/server/src/services/product-verification.js';
import type {Product,Snapshot,DiscoveryPlan} from '../packages/contracts/index.js';
async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){
 const schema='intent_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA "${schema}"`);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');await setupImageDemo(pool);const id=randomUUID();await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language) VALUES($1,$2,'intent-test','ta')",[id,demoCatalogStore]);await run(pool,new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'intent-test',role:'customer'}));}finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
async function send(inbox:SimulatorService,runtime:ConversationRuntime,text:string){await inbox.ingest({id:randomUUID(),type:'text',text});await runtime.processNext(inbox.context);return inbox.snapshot();}
const last=(s:Snapshot)=>s.messages.at(-1)!.rich!;
test('actual failed pipe cutter name and 42mm size return H19, never the reducer',async()=>fixture(async(pool,inbox)=>{
 const c=await pool.connect();try{for(const query of ['Ratchet PVC Pipe Cutter 42mm','pipe cutter 42mm','PVC pipe cuter','பைப் கட்டர்']){const r=await discoverProducts(c,inbox.context,query);assert.deepEqual(r.products.map(p=>p.sku),['H19'],query);assert.equal(r.noExactMatch,false);}
 const r=await discoverProducts(c,inbox.context,'1.25 inch PVC pipe');assert.equal(r.products.length,0);
 }finally{c.release();}
}));
test('a vague cutting job can compare six actual alternatives; hard job filters reject irrelevant preferred SKUs',async()=>fixture(async(pool,inbox)=>{
 const c=await pool.connect();try{
 const plan:DiscoveryPlan={keywords:['pipe cutter','hacksaw blade','cutting wheel','garden shear'],familyIds:['pipe-cutters','saw-blades','cutting-discs','garden-cutters'],useCase:'customer has not specified what to cut',preferredSkus:['H19','H16','H14','H15','H17','H18']};
 const r=await discoverProducts(c,inbox.context,'cutter',plan);assert.deepEqual(r.products.map(p=>p.sku),plan.preferredSkus);assert.equal(r.products.length,6);assert.ok(!r.products.some(p=>['H22','H30'].includes(p.sku)));
 const narrow=await discoverProducts(c,inbox.context,'pipe cutter',{keywords:['pipe cutter'],familyId:'pipe-cutters',preferredSkus:['H30','MADE-UP','H14']});assert.deepEqual(narrow.products.map(p=>p.sku),['H19']);
 await assert.rejects(discoverProducts(c,inbox.context,'cutter',{keywords:['cutter'],familyIds:['other-store']}),/this shop/);
 await assert.rejects(discoverProducts(c,inbox.context,'cutter',{keywords:['cutter'],familyIds:['pipe-cutters'],departmentId:'garden'}),/department/);
 }finally{c.release();}
}));
test('typed semantic plans preserve job question, multilingual input, read-only choices, history language and zero-call rechecks',async()=>fixture(async(pool,inbox)=>{
 let calls=0;const runtime=new ConversationRuntime(pool,{name:'offline-semantic-plan',mode:'mock',interpret:async input=>{calls++;assert.equal(input.state.replyLanguage,'ta');assert.ok(input.catalog!.some(p=>p.sku==='H27'));return {output:{operations:[],next:'assist',assistance:{rootQuery:'cutter',queries:['pipe cutter','garden shear','hacksaw blade'],question:'எந்தப் பொருளை வெட்ட வேண்டும்?',search:{keywords:['pipe cutter','garden shear','cutting wheel','hacksaw blade'],familyIds:['pipe-cutters','garden-cutters','cutting-discs','saw-blades'],preferredSkus:['H19','H16','H14','H15','H17','H18'],useCase:'identify the cutting job'}}},usage:null,truncated:false};}});
 for(const text of ['ennaku oru cuter veeanum, options kaatu','I need something for cutting, what options do you have?','வெட்டுவதற்கு ஒரு கருவி வேண்டும், என்ன வகைகள் உள்ளன?']){const s=await send(inbox,runtime,text);assert.equal(last(s).cards?.length,6);assert.match(last(s).text,/எந்தப் பொருளை வெட்ட வேண்டும்/);assert.equal(last(s).outboundMessages,1);assert.equal(last(s).replyLanguage,'ta');assert.equal(s.conversation.draft.length,0);assert.equal(s.requests.length,0);}
 const before=calls;let s=await send(inbox,runtime,'check again');assert.equal(calls,before);assert.equal(last(s).cards!.length,6);
 const old=last(s).buttons!.find(b=>b.event.type==='refine_discovery'&&b.event.value==='pipe-cutters')!.event;await inbox.ingest(old);await runtime.processNext(inbox.context);s=await inbox.snapshot();assert.deepEqual(last(s).cards!.map(c=>c.product.sku),['H19']);assert.equal(calls,before);
 await send(inbox,runtime,'Reply in English');s=await inbox.snapshot();assert.equal(s.conversation.replyLanguage,'en');assert.equal(s.messages.find(m=>m.rich?.cards?.length===6)!.rich!.replyLanguage,'ta');assert.equal(s.requests.length,0);
}));
test('strict official adapter carries semantic keyword plans while rejecting mixed assistance and order actions',async()=>{
 const state={draft:[],version:0,pending:null,fulfillment:'pickup' as const,lastRequestId:null,replyLanguage:'ta' as const};
 const valid={operations:[],next:'assist',assistance:{rootQuery:'cutter',queries:['pipe cutter','garden shear'],question:'என்ன வேலைக்குத் தேவை?'},assistanceSearch:{keywords:['pipe cutter','garden shear'],familyIds:['pipe-cutters','garden-cutters'],preferredSkus:['H19','H18'],useCase:'unclear cutting job'}};
 let result:unknown=valid;const transport:GoogleTransport={generateContent:async params=>{assert.match(params.config!.systemInstruction as string,/misspellings/);return {modelVersion:geminiTextRate.model,candidates:[{finishReason:FinishReason.STOP,content:{parts:[{text:JSON.stringify(result)}]}}]} as GenerateContentResponse;}};
 const provider=new GoogleInterpreter({allowPaidInference:true,apiKey:'offline',model:geminiTextRate.model,budgetMicrousd:500000},transport);
 let parsed=await provider.interpret({text:'ennaku cuter',state},AbortSignal.timeout(1000));assert.equal(parsed.validationIssues,undefined);assert.deepEqual((parsed.output as any).assistance.search.familyIds,['pipe-cutters','garden-cutters']);
 result={...valid,operations:[{kind:'add_item',query:'H19',quantity:1}],next:'review'};parsed=await provider.interpret({text:'test',state},AbortSignal.timeout(1000));assert.ok(parsed.validationIssues?.some(i=>i.path==='assistance'));assert.ok(parsed.validationIssues?.some(i=>i.path==='assistanceSearch'));
});
test('several requested lines never create a carousel over ten photos and keep deferred groups',()=>{
 const products=Array.from({length:6},(_,i):Product=>({sku:'P'+i,name:'Fixture '+i,pricePaise:100,unit:'piece',version:1,stock:null,aliases:[],quantityStep:1}));
 const check=makeProductCheck({catalogDiscovery:true,requireProductConfirmation:true,version:1,pending:null,fulfillment:'pickup',lastRequestId:null,draft:Array.from({length:3},()=>({id:randomUUID(),name:'cutter',quantity:2,resolution:'needs_choice' as const,candidates:products}))})!;
 assert.ok(check.groups.reduce((n,g)=>n+g.products.length,0)<=10);assert.equal(check.remaining,3-check.groups.length);
});
test('discovery remembers an explicit purchase amount through refinement and selection; units are not converted',async()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,{name:'quantity-in-exploration',mode:'mock',interpret:async()=>({output:{operations:[],next:'assist',assistance:{quantity:2,requestedUnit:'foot',rootQuery:'pipe',queries:['PVC pipe'],question:'எந்தப் பைப் வேண்டும்?',search:{keywords:['PVC pipe'],familyId:'pvc-pipes'}}},usage:null,truncated:false})});
 let s=await send(inbox,runtime,'I need two feet of pipe, show types');assert.equal(s.conversation.draft.length,0);assert.match(last(s).cards![0].quantityLabel!,/2/);s=await send(inbox,runtime,'check again');assert.equal(s.interpretationAttempts,1);
 const filter=last(s).buttons![0].event;await inbox.ingest(filter);await runtime.processNext(inbox.context);s=await inbox.snapshot();const choice=last(s).cards![0].action!;await inbox.ingest(choice);await runtime.processNext(inbox.context);s=await inbox.snapshot();assert.equal(s.conversation.draft[0].requestedQuantity,2);assert.equal(s.conversation.draft[0].requestedUnit,'foot');assert.equal(s.conversation.draft[0].resolution,'needs_unit');assert.equal(s.requests.length,0);assert.equal(s.interpretationAttempts,1);
}));
test('an AI job clarification survives the explicit multi-option photo confirmation',async()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,{name:'product-job-question',mode:'mock',interpret:async()=>({output:{operations:[{kind:'add_item',query:'blade',quantity:1,search:{keywords:['hacksaw blade','cutting wheel','putty scraper']}}],next:'review',clarifyQuestion:'எதை வெட்ட வேண்டும்?'},usage:null,truncated:false})});
 const s=await send(inbox,runtime,'one blade please');assert.match(last(s).text,/எதை வெட்ட வேண்டும்/);assert.equal(s.conversation.draft[0].quantity,1);assert.equal(s.conversation.pending?.kind,'products');assert.equal(s.requests.length,0);
}));

test('practical AI questions may finish in parentheses but factual claims remain blocked',()=>{
 assert.equal(safeQuestion('எதை வெட்ட வேண்டும்? (உலோகமா, பைப்பா?)','ta'),'எதை வெட்ட வேண்டும்? (உலோகமா, பைப்பா?)');
 assert.equal(safeQuestion('Will this cost ₹50? (including delivery?)','en'),undefined);
 assert.equal(safeQuestion('Can I guarantee this fits?','en'),undefined);
});

test('rechecking a persisted wrong product proposal reruns retrieval instead of repeating a cached image',async()=>fixture(async(pool,inbox)=>{
 const c=await pool.connect();let wrong;try{wrong=(await discoverProducts(c,inbox.context,'H30')).products[0];}finally{c.release();}
 const id=randomUUID();await pool.query('UPDATE conversations SET draft=$1::jsonb WHERE id=$2',[JSON.stringify([{id,name:'Ratchet PVC Pipe Cutter 42mm',query:'Ratchet PVC Pipe Cutter 42mm',quantity:1,resolution:'needs_choice',candidates:[wrong]}]),inbox.context.conversationId]);
 const runtime=new ConversationRuntime(pool,{name:'no-ai-refresh',mode:'mock',interpret:async()=>{throw new Error('Recheck must not use AI');}});await pool.query('UPDATE conversations SET pending=$1::jsonb WHERE id=$2',[JSON.stringify({kind:'products',id:randomUUID(),version:0,expiresAt:new Date(Date.now()+900000).toISOString(),groups:[{lineId:id,products:[wrong]}],remaining:0}),inbox.context.conversationId]);let s=await inbox.snapshot();assert.equal(s.conversation.pending?.kind,'products');
 s=await send(inbox,runtime,'check again');assert.deepEqual(last(s).cards!.map(c=>c.product.sku),['H19']);assert.equal(s.conversation.draft[0].quantity,1);assert.ok(!s.conversation.draft[0].productConfirmation);assert.equal(s.interpretationAttempts,0);assert.equal(s.requests.length,0);
}));

test('a model cannot default one or write the cart from a job answer during read-only exploration',async()=>fixture(async(pool,inbox)=>{
 let calls=0;const runtime=new ConversationRuntime(pool,{name:'mistaken-model-add',mode:'mock',interpret:async()=>{calls++;return {output:{operations:[{kind:'add_item',query:'Ratchet PVC Pipe Cutter 42mm',quantity:1}],next:'review'},usage:null,truncated:false};}});
 await inbox.ingest({id:randomUUID(),type:'browse',query:'tools',expectedVersion:0});await runtime.processNext(inbox.context);
 let s=await send(inbox,runtime,'It is for cutting plastic water pipes, about 25 mm.');assert.equal(s.conversation.draft.length,0);assert.deepEqual(last(s).cards!.map(c=>c.product.sku),['H19']);assert.equal(s.requests.length,0);
 await inbox.ingest(last(s).cards![0].action!);await runtime.processNext(inbox.context);s=await inbox.snapshot();assert.equal(s.conversation.draft[0].quantity,null);assert.equal(s.conversation.draft[0].resolution,'needs_quantity');assert.equal(calls,1);assert.equal(s.requests.length,0);
}));
