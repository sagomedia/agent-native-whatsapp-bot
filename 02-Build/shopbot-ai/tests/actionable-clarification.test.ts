import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {FinishReason,type GenerateContentResponse} from '@google/genai';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {GoogleInterpreter,type NativeSettings} from '../apps/server/src/adapters/google-interpreter.js';
import {understandingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';
import {initializeBudget} from '../apps/server/src/services/inference-budget.js';
import {customerError} from '../packages/contracts/language.js';
import type {ConversationState,DraftLine,Product,SimulatorEvent} from '../packages/contracts/index.js';
import type {Interpreter,InterpretationInput} from '../apps/server/src/adapters/interpreter.js';
import type {AssistantMemory} from '../apps/server/src/services/agent-assistance.js';
import type {TurnUnderstanding} from '../packages/contracts/understanding.js';

const base=()=>({schemaVersion:2,inputKind:'text',intents:['edit'],requestedItems:[],proposedEdits:[],shopQuestions:[],unresolved:[]});
const product=(sku:string,name:string):Product=>({sku,name,unit:'piece',pricePaise:1000,stock:20,version:1,aliases:[],quantityStep:1,sellingUnitVerified:true,imageUrl:'/fixtures/'+sku+'.jpg'});
const products:Product[]=[{...product('PIPE','PVC pipe 3/4 inch'),specifications:{diameter:'3/4 inch'}},{...product('KEY','Allen key set'),unit:'pack'},product('OAT','Plant drink'),product('DAIRY','Dairy drink')];
const row=(p:Product,quantity:number|null):DraftLine=>({id:randomUUID(),query:p.sku==='PIPE'?'3/4 inch pipe':p.name.toLowerCase(),name:p.name,quantity,sku:p.sku,unit:p.unit,pricePaise:p.pricePaise,productVersion:1,candidates:[p],resolution:quantity===null?'needs_quantity':'matched'});
const source='அண்ணா எனக்கு ஒரு ஆலன் கீ ஒன்னு அடுத்து வந்து முக்கால் இன்ச் பைப் ஒன்னு.';
const initial=():DraftLine[]=>[{id:randomUUID(),query:'3/4 inch pipe',name:'3/4 inch pipe',quantity:null,resolution:'unavailable'},row(products[1],1)];
const state=(draft:DraftLine[]):ConversationState=>({version:0,draft,pending:null,fulfillment:'pickup',lastRequestId:null,visualOrdering:true,replyLanguage:'en'});
const item=(sourceText:string,query:string,ordinal:number,count:number)=>({sourceText,query,ordinal,purchaseCount:count,unresolved:[],requestMode:'set',search:{keywords:[query]}});

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService,draft:DraftLine[])=>Promise<void>,draft=initial()){
 const schema='actionable_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');const storeId=randomUUID(),conversationId=randomUUID();
  await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Synthetic action shop','true')",[storeId]);
  await pool.query("INSERT INTO catalog_profiles(store_id,store_type) VALUES($1,'general')",[storeId]);
  for(const p of products)await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases,image_path,selling_unit_verified,specifications) VALUES($1,$2,$3,$4,$5,20,$6::jsonb,$7,true,$8::jsonb)",[storeId,p.sku,p.name,p.unit,p.pricePaise,JSON.stringify(p.sku==='PIPE'?['3/4 inch pipe']:[]),p.imageUrl,JSON.stringify(p.specifications??{})]);
  await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language,visual_ordering,draft) VALUES($1,$2,'actionable-test','en',true,$3::jsonb)",[conversationId,storeId,JSON.stringify(draft)]);
  await pool.query('INSERT INTO store_policies(store_id,require_product_confirmation) VALUES($1,true)',[storeId]);
  await run(pool,new SimulatorService(pool,{storeId,conversationId,actor:'actionable-test',role:'customer'}),draft);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
async function send(inbox:SimulatorService,runtime:ConversationRuntime,event:SimulatorEvent){await inbox.ingest(event);await runtime.processNext(inbox.context);return inbox.snapshot();}
const provider=(make:(input:InterpretationInput)=>unknown):Interpreter=>({name:'controlled-action-understanding',mode:'mock',unifiedUnderstanding:true,interpret:async input=>({output:understandingToInterpretation(make(input),input,false),usage:null,truncated:false})});

test('a count alone cannot authorize additional mode on the reported unfinished cart',()=>{
 const s=state(initial()),bad={...base(),intents:['add'],requestedItems:[{...item('முக்கால் இன்ச் பைப் ஒன்னு','3/4 inch pipe',1,1),requestMode:'additional',countEvidence:{sourceText:'ஒன்னு',value:1,mode:'additional'}}]};
 assert.throws(()=>understandingToInterpretation(bad,{text:source,state:s},false),/separate current action evidence/);
});

test('the reported voice plan is repaired once, retains both requested totals and shows a real pipe photo',()=>fixture(async(pool,inbox,draft)=>{
 const settings:NativeSettings={apiKey:'offline-only',allowPaidInference:true,model:'gemini-3.5-flash-lite',budgetMicrousd:5000000,allowMultimodal:true,unifiedUnderstanding:true};
 await initializeBudget(pool,inbox.context,settings.budgetMicrousd);let calls=0;
 const interpreter=new GoogleInterpreter(settings,{generateContent:async request=>{
  calls++;const raw=calls===1?{...base(),inputKind:'audio',transcript:source,intents:['add'],requestedItems:[{...item('முக்கால் இன்ச் பைப் ஒன்னு','3/4 inch pipe',1,1),requestMode:'additional',countEvidence:{sourceText:'ஒன்னு',value:1,mode:'additional'}}]}:{...base(),intents:['add'],requestedItems:[item('ஒரு ஆலன் கீ ஒன்னு','allen key set',0,1),{...item('முக்கால் இன்ச் பைப் ஒன்னு','3/4 inch pipe',1,1),search:{keywords:['3/4 inch pipe'],selectedSkus:['PIPE']}}]};
  if(calls===2){assert.doesNotMatch(JSON.stringify(request),/inlineData/);assert.match(JSON.stringify(request),/Include every named requested item/);}
  return {modelVersion:settings.model,candidates:[{finishReason:FinishReason.STOP,content:{parts:[{text:JSON.stringify(raw)}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:200,totalTokenCount:1200}} as GenerateContentResponse;
 }});
 const runtime=new ConversationRuntime(pool,interpreter,{allowPaidInference:true,inventoryGrounding:true,visualOrdering:true});
 const id=randomUUID();await inbox.ingest({id,type:'voice',mediaId:id},{audio:Buffer.from('RIFF controlled audio'),durationSeconds:2,sourceHash:'synthetic-voice'});await runtime.processNext(inbox.context);
 const s=await inbox.snapshot();assert.equal(calls,2);assert.deepEqual(s.conversation.draft.map(line=>[line.id,line.quantity]),draft.map(line=>[line.id,1]));assert.equal(s.requests.length,0);
 assert.ok(s.messages.at(-1)?.rich?.parts?.some(part=>part.cards.some(card=>card.kind==='product'&&card.product.sku==='PIPE'&&!!card.product.imageUrl)),'a verified pipe candidate must use its real product photo');
 assert.notEqual(s.messages.at(-1)?.rich?.stage,'error');
 const attempts=(await pool.query('SELECT stage,state FROM provider_attempts ORDER BY created_at')).rows;assert.deepEqual(attempts.map(a=>[a.stage,a.state]),[['identify','failed'],['repair','succeeded']]);
}));

test('explicit more on an unknown total asks about that product and a bare number resumes it without another model call',()=>fixture(async(pool,inbox,draft)=>{
 let calls=0;const runtime=new ConversationRuntime(pool,provider(()=>{calls++;return {...base(),intents:['add'],requestedItems:[{...item('one more 3/4 inch pipe','3/4 inch pipe',0,1),requestMode:'additional'}]};}),{visualOrdering:true});
 const s=await send(inbox,runtime,{id:randomUUID(),type:'text',text:'one more 3/4 inch pipe'});
 assert.equal(s.conversation.draft[0].quantity,null);assert.equal(s.conversation.draft[1].quantity,1);assert.equal(s.conversation.pending?.kind,'question');
 assert.match(s.messages.at(-1)!.text,/3\/4 inch pipe.*total/i);assert.doesNotMatch(s.messages.at(-1)!.text,/unit|conversion|clarify/i);
 const after=await send(inbox,runtime,{id:randomUUID(),type:'text',text:'4'});assert.equal(calls,1);assert.equal(after.conversation.draft[0].id,draft[0].id);assert.equal(after.conversation.draft[0].quantity,4);assert.equal(after.conversation.draft[1].quantity,1);assert.equal(after.requests.length,0);
}));

test('an unchanged existing item with a known count is retained without asking its count again',()=>{
 const s=state([row(products[1],1)]),u={...base(),intents:['add'],requestedItems:[{...item('allen key set','allen key set',0,1),purchaseCount:null,unresolved:['quantity']}]};
 const plan=understandingToInterpretation(u,{text:'allen key set',state:s},false);assert.equal(plan.quantityQuestion,undefined);assert.equal(plan.clarifyQuestion,undefined);assert.equal(plan.operations[0].kind,'resolve_line');
});

for(const answer of ['button','text'] as const)test(`named ambiguity offers actual grocery rows and ${answer} can remove exactly all offered rows`,()=>fixture(async(pool,inbox,draft)=>{
 let calls=0;const runtime=new ConversationRuntime(pool,provider(input=>{
  calls++;return input.text==='both of those'?{...base(),cartGroupAnswer:{sourceText:input.text,scope:'all_offered'}}:{...base(),proposedEdits:[{kind:'remove_item',targetLineId:draft[0].id,targetQuery:'drink',sourceText:'remove drink'}]};
 }),{visualOrdering:true,inventoryGrounding:true});
 const first=await send(inbox,runtime,{id:randomUUID(),type:'text',text:'remove drink'}),rich=first.messages.at(-1)!.rich!;
 assert.match(rich.text,/Plant drink/);assert.match(rich.text,/Dairy drink/);assert.match(rich.text,/remove/i);assert.doesNotMatch(rich.text,/Allen key/);
 const group=rich.buttons!.find(button=>button.event.type==='resolve_cart_group')!;assert.ok(group);
 const cards=rich.parts!.flatMap(part=>part.cards);assert.equal(cards.filter(card=>card.kind==='product').length,2);
 assert.ok(cards.every(card=>card.buttons?.some(button=>button.event.type==='resolve_cart_group')));
 const event=answer==='button'?group.event:{id:randomUUID(),type:'text' as const,text:'both of those'};
 const after=await send(inbox,runtime,event);assert.deepEqual(after.conversation.draft.map(line=>line.id),[draft[2].id]);assert.equal(after.conversation.draft[0].quantity,1);assert.equal(after.requests.length,0);assert.equal(calls,answer==='button'?1:2);
 const stale={...group.event,id:randomUUID()};await send(inbox,runtime,stale);assert.deepEqual((await inbox.snapshot()).conversation.draft.map(line=>line.id),[draft[2].id]);
},[row(products[2],1),row(products[3],2),row(products[1],1)]));

test('a forged group choice cannot add an unrelated row to its offered scope',()=>fixture(async(pool,inbox,draft)=>{
 const runtime=new ConversationRuntime(pool,provider(()=>({...base(),proposedEdits:[{kind:'remove_item',targetLineId:draft[0].id,targetQuery:'drink',sourceText:'remove drink'}]})),{visualOrdering:true});
 const first=await send(inbox,runtime,{id:randomUUID(),type:'text',text:'remove drink'}),group=first.messages.at(-1)!.rich!.buttons!.find(button=>button.event.type==='resolve_cart_group')!.event;
 assert.equal(group.type,'resolve_cart_group');if(group.type!=='resolve_cart_group')return;
 const forged={...group,id:randomUUID(),lineIds:[...group.lineIds,draft[2].id]};
 const after=await send(inbox,runtime,forged);assert.deepEqual(after.conversation.draft.map(line=>line.id),draft.map(line=>line.id));assert.equal(after.requests.length,0);
},[row(products[2],1),row(products[3],2),row(products[1],1)]));

for(const sourceText of ["don't remove both",'not both','இரண்டையும் நீக்க வேண்டாம்','if both','both?'])test(`a semantic group answer cannot override negation or a question: ${sourceText}`,()=>{
 const s=state([row(products[2],1),row(products[3],2)]),understanding:TurnUnderstanding={...base(),schemaVersion:2,inputKind:'text',intents:['edit'],proposedEdits:[{kind:'remove_item',targetLineId:s.draft[0].id,sourceText:'remove drink'}]};
 const memory:AssistantMemory={id:randomUUID(),purpose:'cart_edit',queries:['drink'],lineId:null,sourceVersion:0,observations:[],cartEdit:{description:'remove drink',understanding,targets:[{kind:'edit',index:0,candidateLineIds:s.draft.map(line=>line.id)}],selections:[]}};
 assert.throws(()=>understandingToInterpretation({...base(),cartGroupAnswer:{sourceText,scope:'all_offered'}},{text:sourceText,state:s,assistantMemory:memory},false),/affirmative current evidence/);
 const conflicting={...base(),cartGroupAnswer:{sourceText:'both',scope:'all_offered'},cartTargetAnswer:{sourceText:'both',query:'plant drink',targetLineId:s.draft[0].id}};
 assert.throws(()=>understandingToInterpretation(conflicting,{text:'both',state:s,assistantMemory:memory},false),/Cart answer needs/);
});

test('quantity errors use typed meanings instead of matching the word quantity in arbitrary errors',()=>{
 assert.match(customerError('internal quantity callback mismatch','ta','quantity_unknown'),/மொத்தம்/);
 assert.doesNotMatch(customerError('quantity callback mismatch','ta','stale_question'),/அலகு|மாற்றத்தை/);
});
