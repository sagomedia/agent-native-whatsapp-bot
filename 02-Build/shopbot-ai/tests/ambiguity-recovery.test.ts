import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {GoogleInterpreter,type NativeSettings} from '../apps/server/src/adapters/google-interpreter.js';
import {initializeBudget} from '../apps/server/src/services/inference-budget.js';
import type {SimulatorEvent,RichReply} from '../packages/contracts/index.js';
import {spokenClearCommand} from '../apps/server/src/services/shopping-language.js';
const settings:NativeSettings={allowPaidInference:true,apiKey:'offline-only',model:'gemini-3.5-flash-lite',budgetMicrousd:5000000,allowMultimodal:true,unifiedUnderstanding:true,allowImageLists:true};
const base=(kind='text')=>({schemaVersion:2,inputKind:kind,intents:['edit'],requestedItems:[],proposedEdits:[],shopQuestions:[],unresolved:[]});
const response=(output:unknown)=>({modelVersion:settings.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:200,totalTokenCount:1200}} as any);
const actions=(r:RichReply)=>[...r.buttons??[],...(r.parts??[]).flatMap(p=>[...p.buttons??[],...p.cards.flatMap(c=>c.buttons??[])])];
async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='recovery_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');await setupImageDemo(pool);const id=randomUUID();await pool.query('INSERT INTO conversations(id,store_id,actor,visual_ordering) VALUES($1,$2,$3,true)',[id,demoCatalogStore,'round2']);const inbox=new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'round2',role:'customer'});await initializeBudget(pool,inbox.context,settings.budgetMicrousd);await run(pool,inbox);}
 finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
async function send(inbox:SimulatorService,r:ConversationRuntime,event:SimulatorEvent){await inbox.ingest(event);await r.processNext(inbox.context);return inbox.snapshot();}
async function voice(inbox:SimulatorService,r:ConversationRuntime){const id=randomUUID();await inbox.ingest({id,type:'voice',mediaId:id},{audio:Buffer.from('RIFF controlled evidence'),durationSeconds:4.34,sourceHash:'controlled'});await r.processNext(inbox.context);return inbox.snapshot();}
test('current ambiguous pipe target replaces the stale hose question without changing old quantities',()=>fixture(async(pool,inbox)=>{
 const tools=new RetailTools(pool);let seeded=await tools.invoke(inbox.context,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'H02',quantity:2},{kind:'add_item',query:'H01',quantity:2},{kind:'add_item',query:'H13',quantity:null}]}},'seed');
 seeded=await tools.invoke(inbox.context,{name:'preview_order',args:{expectedVersion:seeded.state!.version}},'old-question');const old=seeded.state!;
 await pool.query('UPDATE conversations SET pending=$1::jsonb WHERE id=$2',[JSON.stringify({kind:'question',id:randomUUID(),lineId:old.draft[2].id,version:old.version}),inbox.context.conversationId]);
 const output={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:'two one inch pipes',query:'1 inch PVC pipe',purchaseCount:2,dimensions:[{role:'diameter',value:1,unit:'inch'}],unresolved:[]},{ordinal:1,sourceText:'a PVC pipe cutter',query:'PVC pipe cutter',purchaseCount:null,unresolved:[]}]};
 const r=new ConversationRuntime(pool,new GoogleInterpreter(settings,{generateContent:async()=>response(output)}),{allowPaidInference:true,visualOrdering:true});
 let s=await send(inbox,r,{id:randomUUID(),type:'text',text:'two one inch pipes and a PVC pipe cutter'});
 assert.equal(s.conversation.draft.length,4);assert.equal(s.conversation.draft[2].quantity,null);assert.equal(s.conversation.pending,null);
 assert.equal(s.messages.at(-1)!.rich?.stage,'identify');assert.match(s.messages.at(-1)!.text,/Which|existing/);assert.doesNotMatch(s.messages.at(-1)!.text,/How many.*hose/i);
 const ids=s.conversation.draft.map(l=>l.id),counts=s.conversation.draft.map(l=>l.quantity);s=await send(inbox,r,{id:randomUUID(),type:'text',text:'2'});
 assert.deepEqual(s.conversation.draft.map(l=>l.id),ids);assert.deepEqual(s.conversation.draft.map(l=>l.quantity),counts);assert.equal(s.requests.length,0);
}));
test('recorded clear-everything voice asks before deleting and rejects forged/stale confirmation',()=>fixture(async(pool,inbox)=>{
 const transcript='ோதுமை வேண்டாம் எல்லாரும் கிளியர் பண்ணிடு';assert.equal(spokenClearCommand(transcript),'clear my list');
 const old=(await new RetailTools(pool).invoke(inbox.context,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'H02',quantity:2},{kind:'add_item',query:'H13',quantity:1}]}},'seed')).state!;
 const r=new ConversationRuntime(pool,new GoogleInterpreter(settings,{generateContent:async()=>response({...base('audio'),transcript,intents:['cancel'],clarifyQuestion:'அனைத்து பொருட்களையும் நீக்க வேண்டுமா?'})}),{allowPaidInference:true,visualOrdering:true});
 let s=await voice(inbox,r);assert.equal(s.conversation.draft.length,2);assert.equal(s.conversation.handoffRequested,false);assert.equal(s.conversation.pending,null);assert.ok(s.conversation.version>old.version);
 const confirmation=actions(s.messages.at(-1)!.rich!).find(b=>b.event.type==='shopping_action'&&b.event.action==='confirm_clear')!.event;
 s=await send(inbox,r,{...confirmation,id:randomUUID()});assert.equal(s.conversation.draft.length,2);
 s=await send(inbox,r,confirmation);assert.equal(s.conversation.draft.length,0);assert.equal(s.requests.length,0);
 s=await send(inbox,r,{...confirmation,id:randomUUID()});assert.equal(s.conversation.draft.length,0);assert.equal(s.requests.length,0);
}));
test('a valid transcript with an invalid proposed reference yields a grounded no-op clarification',()=>fixture(async(pool,inbox)=>{
 const output={...base('audio'),transcript:'two water pumping pipes',requestedItems:[{ordinal:0,sourceText:'two water pumping pipes',query:'water pumping pipe',purchaseCount:2,targetLineId:randomUUID(),unresolved:[]}]};
 const r=new ConversationRuntime(pool,new GoogleInterpreter(settings,{generateContent:async()=>response(output)}),{allowPaidInference:true,visualOrdering:true});
 const s=await voice(inbox,r);assert.equal(s.conversation.draft.length,0);assert.equal(s.requests.length,0);assert.notEqual(s.messages.at(-1)!.rich?.stage,'error');assert.match(s.messages.at(-1)!.text,/two water pumping pipes/);
 const a=(await pool.query('SELECT response,validation_issues FROM provider_attempts WHERE conversation_id=$1',[inbox.context.conversationId])).rows[0];assert.deepEqual(a.response.operations,[]);assert.equal(a.validation_issues[0].code,'invalid_evidence');
}));

test('a negated typed clear never asks the model or hands control to the owner',()=>fixture(async(pool,inbox)=>{
 await new RetailTools(pool).invoke(inbox.context,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'H13',quantity:1}]}},'seed');
 let calls=0;const r=new ConversationRuntime(pool,new GoogleInterpreter(settings,{generateContent:async()=>{calls++;return response({...base(),intents:['cancel']});}}),{allowPaidInference:true,visualOrdering:true});
 const s=await send(inbox,r,{id:randomUUID(),type:'text',text:"don't clear my list"});assert.equal(calls,0);assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.handoffRequested,false);assert.equal(s.requests.length,0);
}));
