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
test('semantic clear intent keeps the list until a current confirmation is selected',()=>fixture(async(pool,inbox)=>{
 await new RetailTools(pool).invoke(inbox.context,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'H13',quantity:1}]}},'seed');
 const transcript='discard everything in this basket';
 const provider=new GoogleInterpreter(settings,{generateContent:async()=>response({...base('audio'),transcript,intents:['clear_list']})});
 const runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true,visualOrdering:true});
 let snapshot=await voice(inbox,runtime);
 assert.equal(snapshot.conversation.draft.length,1);assert.equal(snapshot.conversation.handoffRequested,false);
 const confirmation=actions(snapshot.messages.at(-1)!.rich!).find(b=>b.event.type==='shopping_action'&&b.event.action==='confirm_clear')!.event;
 assert.ok(confirmation);assert.equal(snapshot.requests.length,0);
 snapshot=await send(inbox,runtime,confirmation);
 assert.equal(snapshot.conversation.draft.length,0);assert.equal(snapshot.requests.length,0);
}));

test('audio repair uses retained transcript and receives the exact rejected proposal and feedback',()=>fixture(async(pool,inbox)=>{
 const transcript="I don't want PVC pipe, I want garden hose";let calls=0;
 const bad={...base('audio'),transcript,intents:['add'],requestedItems:[{ordinal:0,sourceText:"I don't want PVC pipe",query:'PVC pipe',purchaseCount:1,unresolved:[]}]};
 const provider=new GoogleInterpreter(settings,{generateContent:async params=>{
  calls++;const content=params.contents as any[];const context=JSON.parse(content[0].parts[0].text);
  if(calls===1){assert.ok(content[0].parts.some((p:any)=>p.inlineData));return response(bad);}
  assert.equal(calls,2);assert.equal(context.inputKind,'text');assert.equal(context.customerText,transcript);
  assert.equal(context.repair.originalInputKind,'audio');assert.match(context.repair.feedback,/negated|declined/);
  assert.equal(context.repair.priorProposal.operations[0].query,'PVC pipe');
  assert.equal(content[0].parts.some((p:any)=>p.inlineData),false);
  return response({...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:'I want garden hose',query:'garden hose',purchaseCount:1,unresolved:[]}]});
 }});
 const snapshot=await voice(inbox,new ConversationRuntime(pool,provider,{allowPaidInference:true,visualOrdering:true}));
 assert.equal(calls,2);assert.equal(snapshot.conversation.draft.length,1);assert.equal(snapshot.conversation.draft[0].sku,'H13');
 assert.equal(snapshot.conversation.draft[0].quantity,1);assert.equal(snapshot.requests.length,0);
}));
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

const nativeBroadcast=(ids:string[])=>({"schemaVersion": 2, "inputKind": "audio", "transcript": "எனக்கு வந்து சேர நான் சொல்லியிருக்கேன். எனக்கு வந்து பைப் வேணும். PVC பைப். ஆல்ரெடி லிஸ்ட்ல இருக்கு, எக்ஸ்ட்ரா ரெண்டு ஆட் பண்ணிக்கோ. அண்ட் அவ்ளோதான். டேப் இருக்கா, டெப்லான் டேப் ஒரு ரெண்டு.", "intents": ["add"], "requestedItems": [{"ordinal": 1, "sourceText": "பைப் வேணும். PVC பைப்", "query": "PVC pipe", "purchaseCount": null, "material": "PVC", "unresolved": ["quantity"]}, {"ordinal": 2, "sourceText": "டேப் இருக்கா, டெப்லான் டேப் ஒரு ரெண்டு", "query": "teflon tape", "purchaseCount": 2, "brand": "Teflon", "unresolved": []}], "proposedEdits": [{"kind": "increment_quantity", "targetLineId": ids[0], "sourceText": "எக்ஸ்ட்ரா ரெண்டு ஆட் பண்ணிக்கோ", "quantity": 2}, {"kind": "increment_quantity", "targetLineId": ids[1], "sourceText": "எக்ஸ்ட்ரா ரெண்டு ஆட் பண்ணிக்கோ", "quantity": 2}, {"kind": "increment_quantity", "targetLineId": ids[2], "sourceText": "எக்ஸ்ட்ரா ரெண்டு ஆட் பண்ணிக்கோ", "quantity": 2}], "shopQuestions": [], "unresolved": [], "clarifyQuestion": "எந்த பைப்பைக் குறிப்பிடுகிறீர்கள்?"});
test('one spoken extra phrase cannot increment three legacy pipes; the independent tape still adds',()=>fixture(async(pool,inbox)=>{
 const old=(await new RetailTools(pool).invoke(inbox.context,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'H02',quantity:2},{kind:'add_item',query:'H01',quantity:null},{kind:'add_item',query:'H03',quantity:2}]}},'seed')).state!;
 const counts=old.draft.map(l=>l.quantity);const r=new ConversationRuntime(pool,new GoogleInterpreter(settings,{generateContent:async()=>response(nativeBroadcast(old.draft.map(l=>l.id)))}),{allowPaidInference:true,visualOrdering:true});
 const s=await voice(inbox,r);assert.deepEqual(s.conversation.draft.slice(0,3).map(l=>l.quantity),counts);assert.equal(s.conversation.draft.length,4);assert.equal(s.conversation.draft[3].sku,'H08');assert.equal(s.conversation.draft[3].quantity,2);assert.equal(s.messages.at(-1)!.rich?.stage,'identify');assert.equal(s.requests.length,0);
}));
test('global change ASR variation offers edit or clear confirmation and never hands over',()=>fixture(async(pool,inbox)=>{
 await new RetailTools(pool).invoke(inbox.context,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'H13',quantity:1}]}},'seed');
 const transcript='அதே மாதிரி வேண்டா. எல்லாத்தையும் சேஞ்ச் பண்ணிடு.';const r=new ConversationRuntime(pool,new GoogleInterpreter(settings,{generateContent:async()=>response({...base('audio'),transcript,intents:['edit','cancel'],clarifyQuestion:'எந்த பொருளை மாற்ற வேண்டும்?'})}),{allowPaidInference:true,visualOrdering:true});
 const s=await voice(inbox,r);assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.handoffRequested,false);const a=actions(s.messages.at(-1)!.rich!).map(b=>b.event).filter(e=>e.type==='shopping_action');assert.ok(a.some(e=>e.action==='edit_list'));assert.ok(a.some(e=>e.action==='confirm_clear'));assert.equal(s.requests.length,0);
}));

test('empty optional clarify text is absence and does not discard a valid spoken list',()=>fixture(async(pool,inbox)=>{
 const output={...base('audio'),transcript:'two water pumping pipes',intents:['add'],requestedItems:[{ordinal:0,sourceText:'two water pumping pipes',query:'water pumping pipe',purchaseCount:2,unresolved:[],brand:null}],clarifyQuestion:''};
 const r=new ConversationRuntime(pool,new GoogleInterpreter(settings,{generateContent:async()=>response(output)}),{allowPaidInference:true,visualOrdering:true});const s=await voice(inbox,r);assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.conversation.draft[0].sku,undefined);assert.notEqual(s.messages.at(-1)!.rich?.stage,'error');assert.equal(s.requests.length,0);
}));
test('Latin Tanglish clear-all variation creates a confirmation rather than a handover',()=>fixture(async(pool,inbox)=>{
 await new RetailTools(pool).invoke(inbox.context,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'H13',quantity:1}]}},'seed');const transcript='athu mael venaam, ellaam clear panniru';assert.equal(spokenClearCommand(transcript),'clear my list');
 const r=new ConversationRuntime(pool,new GoogleInterpreter(settings,{generateContent:async()=>response({...base('audio'),transcript,intents:['cancel'],clarifyQuestion:'எதை நீக்க வேண்டும்?'})}),{allowPaidInference:true,visualOrdering:true});const s=await voice(inbox,r);assert.equal(s.conversation.handoffRequested,false);assert.equal(s.conversation.draft.length,1);assert.ok(actions(s.messages.at(-1)!.rich!).some(b=>b.event.type==='shopping_action'&&b.event.action==='confirm_clear'));
}));

test('unspecified cancellation offers guarded list choices without requiring exact ASR spelling',()=>fixture(async(pool,inbox)=>{
 await new RetailTools(pool).invoke(inbox.context,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'H13',quantity:1}]}},'seed');
 const r=new ConversationRuntime(pool,new GoogleInterpreter(settings,{generateContent:async()=>response({...base('audio'),transcript:'ithu venda cancel pannu',intents:['cancel']})}),{allowPaidInference:true,visualOrdering:true});const s=await voice(inbox,r);assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.handoffRequested,false);assert.ok(actions(s.messages.at(-1)!.rich!).some(b=>b.event.type==='shopping_action'&&b.event.action==='confirm_clear'));assert.equal(s.requests.length,0);
}));
