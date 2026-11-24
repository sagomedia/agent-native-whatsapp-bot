import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {understandingToInterpretation,understandingPrompt,inventoryGroundingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';
import {measurementText} from '../packages/contracts/language.js';
import {catalogMeasurements} from '../packages/contracts/catalog-measurements.js';
import {discoverProducts,refinementPlan} from '../apps/server/src/services/catalog-discovery.js';
import {validateCurrentTurn} from '../apps/server/src/services/current-turn.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {validateInventoryReplan,inventoryCandidateFacts,observeInventory} from '../apps/server/src/services/inventory-grounding.js';
import {catalogGroupReply} from '../apps/server/src/services/catalog-group-replies.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {normalizeVoice,pcmWav} from '../apps/server/src/services/voice-media.js';
import {GoogleInterpreter} from '../apps/server/src/adapters/google-interpreter.js';
import {admitRequest} from '../apps/server/src/services/inference-admission.js';
import {geminiSpeechRate,geminiTextRate,initializeBudget} from '../apps/server/src/services/inference-budget.js';
import type {GenerateContentParameters,GenerateContentResponse} from '@google/genai';
import type {ConversationState,Interpretation,SimulatorEvent} from '../packages/contracts/index.js';
import type {Interpreter,InterpretationInput} from '../apps/server/src/adapters/interpreter.js';

const base=()=>({schemaVersion:2,inputKind:'text',intents:['edit'],requestedItems:[],proposedEdits:[],shopQuestions:[],unresolved:[]});
const empty:ConversationState={version:0,draft:[],pending:null,lastRequestId:null,fulfillment:'pickup',replyLanguage:'en'};
const fixturePhoto=(sku:string)=>`https://catalog.example.test/fixtures/${sku}.jpg`;
const id=randomUUID(),other=randomUUID();
const cart:ConversationState={...empty,editingLineId:id,draft:[{id,query:'hammer',name:'Hammer',quantity:2,resolution:'unavailable'},{id:other,query:'brush',name:'Brush',quantity:4,resolution:'unavailable'}]};

for(const source of ['take the hammer off my list','exclude the hammer from my list','சுத்தியலை பட்டியலிலிருந்து அகற்று'])test(`semantic removal accepts a complete paraphrase: ${source}`,()=>{
 const plan=understandingToInterpretation({...base(),proposedEdits:[{kind:'remove_item',sourceText:source,targetLineId:id,targetQuery:'hammer'}]},{text:source,state:cart,inventoryGrounding:true},false);
 assert.deepEqual(plan.operations,[{kind:'remove_item',reference:id,supportingPhrase:source}]);
 assert.deepEqual(validateCurrentTurn(plan.operations,source,cart),plan.operations);
 assert.equal(cart.draft[1].quantity,4);
});

test('count evidence supports paraphrased additions and quantities without a number-word allowlist',()=>{
 for(const [source,kind,mode,countPhrase] of [['increase the hammers by two','increment_quantity','additional','two'],['make the hammer count a couple','set_quantity','total','a couple']] as const){
  const plan=understandingToInterpretation({...base(),proposedEdits:[{kind,sourceText:source,targetLineId:id,targetQuery:'hammer',quantity:2,countEvidence:{sourceText:countPhrase,value:2,mode},...(kind==='increment_quantity'?{additionalEvidence:'increase'}:{})}]},{text:source,state:cart,inventoryGrounding:true},false);
  assert.equal(plan.operations[0].kind,kind);assert.equal(validateCurrentTurn(plan.operations,source,cart).length,1);
 }
});

test('semantic evidence never authorizes negation, a stale row, a bare noun or a dimension as a count',()=>{
 for(const [source,targetLineId,evidence] of [["do not remove the hammer",id,undefined],['hammer',id,undefined],['remove the hammer',randomUUID(),undefined]] as const){
  assert.throws(()=>understandingToInterpretation({...base(),proposedEdits:[{kind:'remove_item',sourceText:source,targetLineId,targetQuery:'hammer'}]},{text:source,state:cart,inventoryGrounding:true},false));
 }
 assert.throws(()=>understandingToInterpretation({...base(),proposedEdits:[{kind:'set_quantity',sourceText:'hammer 5 inch',targetLineId:id,targetQuery:'hammer',quantity:5,countEvidence:{sourceText:'5 inch',value:5,mode:'total'}}]},{text:'hammer 5 inch',state:cart},false),/count must appear/);
});

test('spoken translated attributes use verbatim evidence, and an explicit four-litre pack cannot become one litre',()=>{
 const source='நாலு லிட்டர் ஒயிட் பெயிண்ட்';
 const item={ordinal:0,sourceText:source,query:'white paint',colour:'white',attributeEvidence:[{field:'colour',value:'white',sourceText:'ஒயிட்'}],purchaseCount:null,packSize:{value:4,unit:'litre'},unresolved:[],search:{keywords:['white paint','white wall coating']}};
 const input={text:source,state:empty};
 const valid=understandingToInterpretation({...base(),intents:['add'],requestedItems:[item]},input,false);
 assert.equal(valid.operations[0].kind,'add_item');assert.equal((valid.operations[0] as any).search.specifications.colour,'white');assert.equal((valid.operations[0] as any).search.specifications.pack_size,'4 litre');
 assert.throws(()=>understandingToInterpretation({...base(),intents:['add'],requestedItems:[{...item,packSize:{value:1,unit:'litre'}}]},input,false),/Pack size conflicts/);
});

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='dynamic_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');const storeId=randomUUID(),conversationId=randomUUID();
  await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Synthetic grocery','true')",[storeId]);
  await pool.query("INSERT INTO catalog_profiles(store_id,store_type) VALUES($1,'grocery')",[storeId]);
  await pool.query("INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,aliases) VALUES($1,'food',NULL,'department','Food','[]'),($1,'plant-drinks','food','family','Plant drinks','[\"oat milk\",\"oat drink\"]'),($1,'dairy-drinks','food','family','Dairy drinks','[\"milk\",\"dairy milk\"]')",[storeId]);
  for(const [sku,name,family,aliases] of [['OAT','Field Oat Drink 1L','plant-drinks',['oat milk','oat drink']],['DAIRY','Farm Dairy Milk 1L','dairy-drinks',['milk','dairy milk']]] as const){
   await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,aliases,specifications,image_path,selling_unit_verified) VALUES($1,$2,$3,'can',10000,10,$4,$5::jsonb,'{\"pack_size\":\"1 litre\"}',$6,true)",[storeId,sku,name,family,JSON.stringify(aliases),fixturePhoto(sku)]);
  }
  await pool.query("INSERT INTO conversations(id,store_id,actor,visual_ordering,reply_language) VALUES($1,$2,'dynamic-test',true,'en')",[conversationId,storeId]);
  await pool.query('INSERT INTO store_policies(store_id,require_product_confirmation) VALUES($1,true)',[storeId]);
  await run(pool,new SimulatorService(pool,{storeId,conversationId,actor:'dynamic-test',role:'customer'}));
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
async function turn(inbox:SimulatorService,runtime:ConversationRuntime,event:SimulatorEvent){await inbox.ingest(event);await runtime.processNext(inbox.context);return inbox.snapshot();}

test('a minute-long grocery list reaches catalog interpretation near the paid reservation limit',()=>fixture(async(pool,inbox)=>{
 const items=['oat milk','dairy milk','rice flour','vanilla pods','millet flakes','tamarind paste','dried figs','coconut cream','ginger tea','peanut oil'];
 const countWords=['one','two','three','four','five','six','seven','eight','nine','ten'];
 const requestedItems=items.map((query,ordinal)=>({ordinal,sourceText:`${countWords[ordinal]} ${query}`,query,purchaseCount:ordinal+1,unresolved:[],search:{keywords:[query]}}));
 const transcript='Could you set these by the till for me, please: '+requestedItems.map(item=>item.sourceText).join(', ');
 const {storeId}=inbox.context;
 for(const [index,name] of items.entries()){
  if(index<2)continue;
  await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,image_path,selling_unit_verified) VALUES($1,$2,$3,'pack',5000,20,$4,true)",[storeId,`FOOD-${index}`,name,fixturePhoto(`FOOD-${index}`)]);
 }
 await initializeBudget(pool,inbox.context,500000);
 await pool.query('UPDATE inference_budgets SET committed_microusd=143526 WHERE store_id=$1',[storeId]);
 const requests:GenerateContentParameters[]=[];
 let recordings=0;
 const provider=new GoogleInterpreter({allowPaidInference:true,allowMultimodal:true,apiKey:'offline',model:geminiTextRate.model,budgetMicrousd:500000,transcriptionModel:geminiSpeechRate.model,unifiedUnderstanding:true,maxOutputTokens:16384},{
  generateContent:async request=>{
   requests.push(request);
   return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...base(),intents:['add'],requestedItems})}]}}],
    usageMetadata:{promptTokenCount:4500,candidatesTokenCount:1600,totalTokenCount:6100}} as GenerateContentResponse;
  },
 },{
  create:async()=>{
   recordings++;
   return {id:'synthetic-voice-list',status:'completed',model:geminiSpeechRate.model,steps:[{type:'model_output',content:[{type:'text',text:transcript}]}],
    usage:{total_input_tokens:1619,total_output_tokens:177,total_tokens:1796}};
  },
 });
 const mediaId=randomUUID();
 const sampleCount=Math.round(64.6935*16000),samples=Buffer.alloc(sampleCount*2);
 for(let i=0;i<sampleCount;i++)samples.writeInt16LE(Math.round(Math.sin(i*0.17)*1200),i*2);
 const media=await normalizeVoice({id:mediaId,mimeType:'audio/wav',data:pcmWav(samples).toString('base64')});
 await inbox.ingest({id:mediaId,type:'voice',mediaId},media);
 const runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true,visualOrdering:true});
 await runtime.processNext(inbox.context);
 const snapshot=await inbox.snapshot();
 assert.equal(recordings,1);
 assert.equal(requests.length,1,`catalog interpretation call: ${snapshot.messages.at(-1)?.rich?.clarificationReason}`);
 assert.equal(requests[0].config?.maxOutputTokens,14615);
 assert.equal(snapshot.messages.find(message=>message.id===mediaId)?.text,transcript);
 assert.deepEqual(snapshot.conversation.draft.map(line=>line.quantity),requestedItems.map(item=>item.purchaseCount));
 assert.equal(snapshot.requests.length,0);
 const attempts=(await pool.query('SELECT stage,state,input_admission,rate_snapshot,reserved_microusd FROM provider_attempts WHERE message_id=$1 ORDER BY attempt',[mediaId])).rows;
 assert.deepEqual(attempts.map(a=>[a.stage,a.state]),[['recognize','succeeded'],['identify','succeeded']]);
 assert.deepEqual(attempts[1].input_admission,admitRequest(requests[0]));
 assert.equal(attempts[1].rate_snapshot.maxOutputTokens,14615);
 assert.equal(attempts[1].reserved_microusd,'351111');
 assert.deepEqual((await pool.query('SELECT committed_microusd,held_microusd FROM inference_budgets WHERE store_id=$1',[storeId])).rows[0],{committed_microusd:'154238',held_microusd:'0'});
}));

test('multiple observed semantic choices do not inherit the first alias match pack size',()=>fixture(async(pool,inbox)=>{
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,aliases,specifications,image_path,selling_unit_verified) VALUES($1,'OAT-SMALL','Other Oat Beverage 500ml','can',5000,10,'plant-drinks','[]','{\"pack_size\":\"500 ml\"}',$2,true)",[inbox.context.storeId,fixturePhoto('OAT-SMALL')]);
 const c=await pool.connect();try{
  const search={keywords:['oat drink'],selectedSkus:['OAT','OAT-SMALL']};
  const choices=await discoverProducts(c,inbox.context,'oat drink',search);assert.deepEqual(new Set(choices.products.map(p=>p.sku)),new Set(search.selectedSkus));
  const limited=await discoverProducts(c,inbox.context,'oat drink',{...search,specifications:{pack_size:'1 litre'}});assert.deepEqual(limited.products.map(p=>p.sku),['OAT']);
 }finally{c.release();}
}));

test('the single evidence repair also grounds replacement photos without a third model call',()=>fixture(async(pool,inbox)=>{
 const old=randomUUID(),untouched=randomUUID();
 await pool.query('UPDATE conversations SET draft=$1::jsonb WHERE id=$2',[JSON.stringify([{id:old,name:'Dairy milk',query:'dairy milk',quantity:3,resolution:'needs_choice'},{id:untouched,name:'Rice flour',query:'rice flour',quantity:7,resolution:'unavailable'}]),inbox.context.conversationId]);
 const source='The dairy milk is wrong; I meant oat drink';
 const rejected={...base(),intents:['edit','add'],requestedItems:[{ordinal:0,sourceText:'oat drink',query:'oat drink',purchaseCount:null,unresolved:['quantity'],search:{keywords:['oat drink']}}],proposedEdits:[{kind:'remove_item',targetLineId:old,targetQuery:'dairy milk',sourceText:'dairy milk'}]};
 let calls=0;
 const provider:Interpreter={name:'controlled-repair-with-inventory',mode:'mock',unifiedUnderstanding:true,interpret:async input=>{
  if(++calls===1)return {output:{operations:[],next:'continue',understanding:{...base(),unresolved:['validation_recovery']}},evidenceRepair:{understanding:rejected as any,feedback:'Use one complete replacement.'},usage:null,truncated:false};
  assert.equal(calls,2);assert.ok(input.planningFeedback?.includes('same repair'));
  assert.equal(input.observations?.[0].query,'oat drink');assert.ok(input.observations?.[0].products.some(p=>p.sku==='OAT'));
  const repaired={...base(),proposedEdits:[{kind:'replace',targetLineId:old,targetQuery:'dairy milk',query:'oat drink',sourceText:source,search:{keywords:['oat drink'],selectedSkus:['OAT']}}]};
  return {output:understandingToInterpretation(repaired,input,false),usage:null,truncated:false};
 }};
 const snapshot=await turn(inbox,new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true}),{id:randomUUID(),type:'text',text:source});
 assert.equal(calls,2);assert.equal(snapshot.requests.length,0);assert.equal(snapshot.conversation.draft.length,2);
 const line=snapshot.conversation.draft[0];assert.equal(line.id,old);assert.equal(line.quantity,3);assert.deepEqual(line.candidates?.map(p=>p.sku),['OAT']);assert.ok(!line.productConfirmation);
 assert.equal(snapshot.conversation.draft[1].id,untouched);assert.equal(snapshot.conversation.draft[1].quantity,7);
 assert.ok(snapshot.messages.at(-1)?.rich?.parts?.some(part=>part.cards.some(card=>card.kind==='product'&&card.product.imageUrl===fixturePhoto('OAT'))));
 const attempts=(await pool.query('SELECT stage,state FROM provider_attempts WHERE conversation_id=$1 ORDER BY created_at',[inbox.context.conversationId])).rows;
 assert.deepEqual(attempts.map(a=>[a.stage,a.state]),[['identify','failed'],['repair','succeeded']]);
}));

test('a noisy per-item query is replanned against an unrelated shop inventory and shows real product photos',()=>fixture(async(pool,inbox)=>{
 let calls=0;const source='two oat letter milk';
 const original={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'oat letter milk',purchaseCount:2,unresolved:[],search:{keywords:['oat milk','oat drink']}}]};
 const provider:Interpreter={name:'controlled-inventory-planner',mode:'mock',unifiedUnderstanding:true,interpret:async input=>{
  calls++;
  if(calls===1)return {output:understandingToInterpretation(original,input,false),usage:null,truncated:false};
  assert.equal(input.observations?.[0].query,'oat letter milk');assert.ok(input.planningFeedback?.includes('fresh inventory'));assert.ok(input.observations?.[0].products.some(p=>p.sku==='OAT'));
  const grounded={...original,requestedItems:original.requestedItems.map(item=>({...item,search:{...item.search,identityQuery:'oat milk'}}))};
  return {output:understandingToInterpretation(grounded,input,false),usage:null,truncated:false};
 }};
 const runtime=new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true});
 const snapshot=await turn(inbox,runtime,{id:randomUUID(),type:'text',text:source});
 assert.equal(calls,2);assert.equal(snapshot.conversation.draft.length,1);assert.equal(snapshot.conversation.draft[0].quantity,2);
 assert.deepEqual(snapshot.conversation.draft[0].candidates?.map(p=>p.sku),['OAT']);
 assert.ok(snapshot.messages.at(-1)?.rich?.parts?.some(part=>part.cards.some(card=>card.kind==='product'&&card.product.imageUrl===fixturePhoto('OAT'))));
 assert.equal(snapshot.requests.length,0);
}));

for(const failure of ['provider failure','truncated response','changed count'] as const)test(`inventory grounding ${failure} keeps the draft and a customer retry can succeed`,()=>fixture(async(pool,inbox)=>{
 const existing={id:randomUUID(),name:'Rice flour',query:'rice flour',quantity:7,resolution:'unavailable'};
 await pool.query('UPDATE conversations SET draft=$1::jsonb WHERE id=$2',[JSON.stringify([existing]),inbox.context.conversationId]);
 const source='two oat milk';
 const original={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'oat milk',purchaseCount:2,unresolved:[],search:{keywords:['oat milk']}}]};
 let first=true;
 const provider:Interpreter={name:'controlled-inventory-failure',mode:'mock',unifiedUnderstanding:true,interpret:async input=>{
  if(!input.inventoryReplan)return {output:understandingToInterpretation(original,input,false),usage:null,truncated:false};
  assert.ok(input.observations?.[0].products.some(p=>p.sku==='OAT'));
  const output=inventoryGroundingToInterpretation({items:[{ordinal:0,query:'oat milk',search:{keywords:['oat milk'],selectedSkus:['OAT']}}],replacements:[]},input,false);
  if(!first)return {output,usage:null,truncated:false};
  first=false;
  if(failure==='provider failure')throw new Error('private provider failure');
  if(failure==='changed count')output.understanding!.requestedItems[0].purchaseCount=8;
  return {output,usage:null,truncated:failure==='truncated response'};
 }};
 const runtime=new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true});
 const inbound={id:randomUUID(),type:'text' as const,text:source};
 const failed=await turn(inbox,runtime,inbound);
 const reply=failed.messages.at(-1)!;
 assert.equal(reply.rich?.stage,'error');
 assert.equal(reply.rich?.clarificationReason,'inventory_check_incomplete');
 assert.match(reply.text,/couldn’t finish checking the catalog.*sending your request again/i);
 assert.doesNotMatch(reply.text,/no matching listing|not in this catalog|private provider failure/i);
 assert.deepEqual(failed.conversation.draft,[existing]);
 assert.equal(failed.conversation.version,0);
 assert.equal(failed.requests.length,0);
 assert.ok(failed.messages.some(message=>message.id===inbound.id&&message.text===source));
 const retried=await turn(inbox,runtime,{...inbound,id:randomUUID()});
 const item=retried.conversation.draft.find(line=>line.id!==existing.id);
 assert.ok(item);
 assert.equal(item.quantity,2);
 assert.deepEqual(item.candidates?.map(product=>product.sku),['OAT']);
 assert.ok(!item.productConfirmation);
 assert.equal(retried.requests.length,0);
}));

test('a spoken inventory failure can retry the saved recording without applying half a mixed cart edit',()=>fixture(async(pool,inbox)=>{
 const removed={id:randomUUID(),name:'Rice flour',query:'rice flour',quantity:7,resolution:'unavailable'};
 const retained={id:randomUUID(),name:'Vanilla',query:'vanilla',quantity:1,resolution:'unavailable'};
 const draft=[removed,retained];
 await pool.query('UPDATE conversations SET draft=$1::jsonb WHERE id=$2',[JSON.stringify(draft),inbox.context.conversationId]);
 const source='Remove the rice flour and add two oat milk';
 const original={...base(),inputKind:'audio',transcript:source,intents:['edit','add'],requestedItems:[{ordinal:0,sourceText:'add two oat milk',query:'oat milk',purchaseCount:2,unresolved:[],search:{keywords:['oat milk']}}],proposedEdits:[{kind:'remove_item',targetLineId:removed.id,targetQuery:'rice flour',sourceText:'Remove the rice flour'}]};
 let groundingCalls=0,identifyCalls=0;
 const provider:Interpreter={name:'controlled-spoken-grounding-failure',mode:'mock',supportsAudio:true,unifiedUnderstanding:true,interpret:async input=>{
  if(!input.inventoryReplan){
   identifyCalls++;
   return {output:understandingToInterpretation(original,input,false),usage:null,truncated:false};
  }
  if(++groundingCalls===1)throw new Error('Temporary lookup failure');
  return {output:inventoryGroundingToInterpretation({items:[{ordinal:0,query:'oat milk',search:{keywords:['oat milk'],selectedSkus:['OAT']}}],replacements:[]},input,false),usage:null,truncated:false};
 }};
 const runtime=new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true});
 const mediaId=randomUUID(),pcm=Buffer.alloc(32000);
 for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(i*0.17)*1200),i*2);
 const media=await normalizeVoice({id:mediaId,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')});
 await inbox.ingest({id:mediaId,type:'voice',mediaId},media);
 await runtime.processNext(inbox.context);
 const failed=await inbox.snapshot();
 assert.deepEqual(failed.conversation.draft,draft);
 assert.equal(failed.conversation.version,0);
 assert.equal(failed.requests.length,0);
 assert.equal(failed.messages.find(message=>message.id===mediaId)?.text,source);
 const error=failed.messages.at(-1)?.rich;
 assert.equal(error?.clarificationReason,'inventory_check_incomplete');
 const retry=error?.buttons?.find(button=>button.event.type==='retry_voice');
 assert.ok(retry);
 const retried=await turn(inbox,runtime,retry.event);
 assert.equal(identifyCalls,1,'catalog retry reuses the validated original meaning');
 assert.equal(groundingCalls,2);
 assert.ok(!retried.conversation.draft.some(line=>line.id===removed.id));
 const preserved=retried.conversation.draft.find(line=>line.id===retained.id);
 assert.equal(preserved?.query,retained.query);
 assert.equal(preserved?.quantity,retained.quantity);
 assert.equal(preserved?.resolution,retained.resolution);
 const added=retried.conversation.draft.find(line=>line.id!==retained.id);
 assert.equal(added?.quantity,2);
 assert.deepEqual(added?.candidates?.map(product=>product.sku),['OAT']);
 assert.equal(retried.requests.length,0);
}));

test('a completed inventory grounding pass can report a genuine catalog miss',()=>fixture(async(pool,inbox)=>{
 const source='two hibiscus concentrates',query='hibiscus concentrate';
 const original={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query,purchaseCount:2,unresolved:[],search:{keywords:[query]}}]};
 const provider:Interpreter={name:'controlled-inventory-miss',mode:'mock',unifiedUnderstanding:true,interpret:async input=>{
  if(input.inventoryReplan)assert.equal(input.observations?.[0].products.length,0);
  const output=input.inventoryReplan
   ?inventoryGroundingToInterpretation({items:[{ordinal:0,query,search:{keywords:[query],selectedSkus:[]}}],replacements:[]},input,false)
   :understandingToInterpretation(original,input,false);
  return {output,usage:null,truncated:false};
 }};
 const snapshot=await turn(inbox,new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true}),{id:randomUUID(),type:'text',text:source});
 assert.notEqual(snapshot.messages.at(-1)?.rich?.stage,'error');
 assert.match(snapshot.messages.at(-1)!.text,/no matching catalog listing/i);
 assert.equal(snapshot.conversation.draft[0].resolution,'unavailable');
 assert.equal(snapshot.conversation.draft[0].quantity,2);
 assert.equal(snapshot.conversation.draft[0].sku,undefined);
 assert.equal(snapshot.requests.length,0);
}));

test('category cards and their refinement use only types present in this store',()=>fixture(async(pool,inbox)=>{
 const c=await pool.connect();try{
  const found=await discoverProducts(c,inbox.context,'drink',{keywords:['drink','milk'],familyIds:['plant-drinks','dairy-drinks'],clarifyType:true});
  assert.equal(found.matchStatus,'needs_detail');assert.deepEqual(found.groups?.map(g=>g.value),['dairy-drinks','plant-drinks']);
  const reply=catalogGroupReply(found,empty,{memoryId:randomUUID()})!;
  assert.deepEqual(reply.parts![0].cards.map(card=>card.kind==='instruction'&&card.imageUrl),[fixturePhoto('DAIRY'),fixturePhoto('OAT')]);
  assert.ok(reply.parts![0].cards.every(card=>card.buttons?.every(b=>b.event.type==='refine_discovery')));
  const refined=await discoverProducts(c,inbox.context,'Plant drinks',refinementPlan(found,'family','plant-drinks'));
  assert.equal(refined.plan.clarifyType,false);assert.deepEqual(refined.products.map(p=>p.sku),['OAT']);
  await pool.query("UPDATE catalog_nodes SET label='Oat beverages' WHERE store_id=$1 AND id='plant-drinks'",[inbox.context.storeId]);
  const changed=await discoverProducts(c,inbox.context,'drink',{keywords:['drink'],familyIds:['plant-drinks'],clarifyType:true});
  assert.equal(changed.groups?.[0].label,'Oat beverages');
 }finally{c.release();}
}));

test('a bad exact alias cannot make a different inventory product authoritative after grounding',()=>fixture(async(pool,inbox)=>{
 await pool.query("UPDATE products SET aliases=aliases||'[\"oat milk\"]'::jsonb WHERE store_id=$1 AND sku='DAIRY'",[inbox.context.storeId]);
 let calls=0;const source='two oat milk',original={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'oat milk',purchaseCount:2,unresolved:[],search:{keywords:['oat milk']}}]};
 const provider:Interpreter={name:'controlled-alias-grounding',mode:'mock',unifiedUnderstanding:true,interpret:async input=>{
  calls++;const raw=calls===1?original:{...original,requestedItems:original.requestedItems.map(item=>({...item,search:{...item.search,selectedSkus:['OAT']}}))};
  return {output:understandingToInterpretation(raw,input,false),usage:null,truncated:false};
 }};
 const s=await turn(inbox,new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true}),{id:randomUUID(),type:'text',text:source});
 assert.equal(calls,2);assert.deepEqual(s.conversation.draft[0].candidates?.map(p=>p.sku),['OAT']);assert.equal(s.requests.length,0);
}));

test('inventory replan cannot change a count or inject a product observed for another item',()=>{
 const source='two oat milk',raw={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'oat milk',purchaseCount:2,unresolved:[],search:{keywords:['oat milk']}}]};
 const initial=understandingToInterpretation(raw,{text:source,state:empty},false);
 const wrong=understandingToInterpretation({...raw,requestedItems:[{...raw.requestedItems[0],purchaseCount:4}]},{text:source,state:empty},false);
 assert.throws(()=>validateInventoryReplan(initial,wrong,[]),/cannot change items/);
 assert.throws(()=>understandingToInterpretation({...raw,requestedItems:[{...raw.requestedItems[0],search:{keywords:['oat milk'],selectedSkus:['FOREIGN']}}]},{text:source,state:empty,proposal:initial,observations:[]},false),/fresh inventory/);
});

test('a quantity-only reply to an unresolved selling unit stays in clarification instead of processing_failed',()=>fixture(async(pool,inbox)=>{
 const id=randomUUID();await pool.query("UPDATE conversations SET draft=$2::jsonb,pending=$3::jsonb WHERE id=$1",[inbox.context.conversationId,JSON.stringify([{id,name:'oat milk',query:'oat milk',quantity:null,requestedQuantity:2,requestedUnit:'bag',unit:'can',resolution:'needs_unit',candidates:[]}]),JSON.stringify({kind:'question',id:randomUUID(),lineId:id,version:0})]);
 const provider:Interpreter={name:'no-ai-for-unit-reply',mode:'mock',interpret:async()=>{throw new Error('Unexpected inference');}};
 const s=await turn(inbox,new ConversationRuntime(pool,provider,{visualOrdering:true}),{id:randomUUID(),type:'text',text:'2'});
 assert.notEqual(s.messages.at(-1)?.rich?.stage,'error');assert.equal(s.conversation.draft[0].quantity,null);assert.equal(s.requests.length,0);
}));

test('understanding receives real family IDs, fresh names and specifications instead of a fixed shop dictionary',()=>{
 const prompt=JSON.parse(understandingPrompt({text:'find a drink',state:empty,catalogMap:{store:{name:'New shop',type:'grocery'},productCount:1,truncated:false,departments:[{id:'food',label:'Food',count:1,families:[{id:'new-family',label:'New beverages',aliases:['drink'],count:1}]}]},observations:[{tool:'discover_products',query:'drink',totalCount:1,products:[{sku:'NEW',name:'New drink',unit:'can',pricePaise:100,stock:1,version:1,aliases:[],quantityStep:1,specifications:{flavour:'oat'}}]}]}));
 assert.equal(prompt.storeContext.families[0].id,'new-family');assert.equal(prompt.catalogObservations[0].products[0].specifications.flavour,'oat');
});


test('grounding binds selected SKUs to the actual attribute-expanded item query',()=>{
 const source='two white oat milk',item={ordinal:0,sourceText:source,query:'oat milk',colour:'white',purchaseCount:2,unresolved:[],search:{keywords:['oat milk']}};
 const raw={...base(),intents:['add'],requestedItems:[item]},original=understandingToInterpretation(raw,{text:source,state:empty},false);
 const product={sku:'OAT',name:'White oat milk',unit:'can',pricePaise:100,stock:1,version:1,aliases:[],quantityStep:1};
 const observations=[{tool:'discover_products' as const,query:'white oat milk',products:[product],totalCount:1}];
 const grounded=understandingToInterpretation({...raw,requestedItems:[{...item,search:{...item.search,selectedSkus:['OAT']}}]},{text:source,state:empty,proposal:original,observations},false);
 assert.equal(validateInventoryReplan(original,grounded,observations).operations.length,1);
});

test('semantic inventory lookup and price remain read-only through grounding',()=>{
 for(const intent of ['lookup','price']){
  const source='show white oat milk',item={ordinal:0,sourceText:source,query:'oat milk',colour:'white',purchaseCount:null,unresolved:[],search:{keywords:['oat milk']}};
  const raw={...base(),intents:[intent],requestedItems:[item]},original=understandingToInterpretation(raw,{text:source,state:empty},false);
  const product={sku:'OAT',name:'White oat milk',unit:'can',pricePaise:100,stock:1,version:1,aliases:[],quantityStep:1};
  const observations=[{tool:'discover_products' as const,query:original.assistance?.queries[0]??original.priceQuery!,products:[product],totalCount:1}];
  const grounded=understandingToInterpretation({...raw,requestedItems:[{...item,search:{...item.search,selectedSkus:['OAT']}}]},{text:source,state:empty,proposal:original,observations},false);
  const plan=validateInventoryReplan(original,grounded,observations);assert.deepEqual(plan.operations,[]);assert.equal(plan.next,intent==='lookup'?'assist':'price');
 }
});


test('an observed semantic selection can match a synonym without the literal query head',()=>fixture(async(pool,inbox)=>{
 const source='two plant beverages',raw={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'plant beverages',purchaseCount:2,unresolved:[],search:{keywords:['oat drink']}}]};
 let calls=0;const provider:Interpreter={name:'controlled-semantic-synonym',mode:'mock',unifiedUnderstanding:true,interpret:async input=>{
  calls++;const proposal=calls===1?raw:{...raw,requestedItems:raw.requestedItems.map(item=>({...item,search:{...item.search,selectedSkus:['OAT']}}))};
  return {output:understandingToInterpretation(proposal,input,false),usage:null,truncated:false};
 }};
 const s=await turn(inbox,new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true}),{id:randomUUID(),type:'text',text:source});
 assert.equal(calls,2);assert.deepEqual(s.conversation.draft[0].candidates?.map(p=>p.sku),['OAT']);assert.equal(s.requests.length,0);assert.ok(!s.conversation.draft[0].productConfirmation);
}));


test('a replacement cannot select a SKU observed for a different requested replacement',()=>{
 const source='replace hammer with oat drink',edit={kind:'replace',targetLineId:id,targetQuery:'hammer',sourceText:source,query:'oat drink',search:{keywords:['oat drink']}};
 const raw={...base(),proposedEdits:[edit]},original=understandingToInterpretation(raw,{text:source,state:cart,inventoryGrounding:true},false);
 const product={sku:'DAIRY',name:'Dairy milk',unit:'can',pricePaise:100,stock:1,version:1,aliases:[],quantityStep:1};
 const observations=[{tool:'discover_products' as const,query:'oat drink',products:[],totalCount:0},{tool:'discover_products' as const,query:'dairy milk',products:[product],totalCount:1}];
 const prompt=JSON.parse(understandingPrompt({text:source,state:cart,inventoryGrounding:true,inventoryReplan:true,proposal:original,observations}));
 assert.deepEqual(prompt.groundingTargets,{items:[],replacements:[{index:0,query:'oat drink'}]});
 assert.throws(()=>understandingToInterpretation({...raw,proposedEdits:[{...edit,search:{...edit.search,selectedSkus:['DAIRY']}}]},{text:source,state:cart,inventoryGrounding:true,proposal:original,observations},false),/this item’s fresh inventory/);
});

test('an unsupported replacement SKU leaves the existing row for shop checking',()=>{
 const source='swap the hammer for oat drink';
 const edit={kind:'replace',targetLineId:id,targetQuery:'hammer',sourceText:source,query:'oat drink',search:{keywords:['oat drink']}};
 const original=understandingToInterpretation({...base(),proposedEdits:[edit]},{text:source,state:cart,inventoryGrounding:true},false);
 const observations=[{tool:'discover_products' as const,query:'oat drink',products:[{sku:'OAT',name:'Oat Drink',unit:'can',pricePaise:100,stock:1,version:1,aliases:[],quantityStep:1}],totalCount:1}];
 const input={text:source,state:cart,inventoryGrounding:true,inventoryReplan:true,proposal:original,observations};
 const recovered=inventoryGroundingToInterpretation({items:[],replacements:[{index:0,search:{keywords:['oat drink'],selectedSkus:['OTHER']}}]},input,false,true);
 assert.equal(recovered.operations.length,1);
 assert.equal(recovered.operations[0].kind,'resolve_line');
 assert.ok((recovered.operations[0] as any).sourceUncertainty?.includes('catalog_check_pending'));
 assert.deepEqual((recovered.operations[0] as any).search.selectedSkus,[]);
 assert.equal(validateInventoryReplan(original,recovered,observations).operations.length,1);
});


test('an empty unobserved SKU array is absence, while an observed rejection stays explicit',()=>{
 const source='two oat drinks',raw={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'oat drink',purchaseCount:2,unresolved:[],search:{keywords:['oat drink'],selectedSkus:[]}}]};
 const original=understandingToInterpretation(raw,{text:source,state:empty},false);
 assert.equal(original.understanding!.requestedItems[0].search?.selectedSkus,undefined);
 assert.equal((original.operations[0] as any).search.selectedSkus,undefined);
 const rejected=understandingToInterpretation(raw,{text:source,state:empty,proposal:original,observations:[{tool:'discover_products',query:'oat drink',products:[],totalCount:0}]},false);
 assert.deepEqual(rejected.understanding!.requestedItems[0].search?.selectedSkus,[]);
});

test('optional count evidence cannot turn a measured pack with unknown count into a purchase amount',()=>{
 const source='நாலு லிட்டர் ஒயிட் பெயிண்ட் வேணும்',raw={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'white paint',purchaseCount:null,packSize:{value:4,unit:'litre'},countEvidence:{sourceText:'நாலு லிட்டர்',value:4,mode:'total'},unresolved:[],attributeEvidence:[],dimensions:[]}]};
 const plan=understandingToInterpretation(raw,{text:source,state:empty},false);
 assert.equal((plan.operations[0] as any).quantity,null);assert.deepEqual((plan.operations[0] as any).packSize,{value:4,unit:'litre'});assert.equal(plan.understanding!.requestedItems[0].countEvidence,undefined);
});

test('grounding search patches preserve all source fields and cannot invent a pack or rewrite counts',()=>{
 const source='two oat drinks',item={ordinal:1,sourceText:source,query:'oat drinks',purchaseCount:2,unresolved:['variant'],search:{keywords:['oat drink'],familyIds:['dairy-drinks']}};
 const raw={...base(),intents:['add'],requestedItems:[item]},original=understandingToInterpretation(raw,{text:source,state:empty},false);
 const observations=[{tool:'discover_products' as const,query:'oat drinks',products:[{sku:'OAT',name:'Oat Drink',unit:'can',pricePaise:100,stock:1,version:1,aliases:[],quantityStep:1,familyId:'plant-drinks'}],totalCount:1}];
 const input={text:source,state:empty,proposal:original,observations,inventoryReplan:true};
 const patch={items:[{ordinal:1,query:'oat drink',search:{keywords:['oat drink'],selectedSkus:['OAT'],familyIds:['dairy-drinks']}}],replacements:[]};
 const plan=inventoryGroundingToInterpretation(patch,input,false);
 assert.equal((plan.operations[0] as any).quantity,2);assert.equal((plan.operations[0] as any).packSize,undefined);assert.equal((plan.operations[0] as any).search.familyIds,undefined);
 assert.deepEqual(plan.understanding!.requestedItems[0].unresolved,['variant']);assert.equal(validateInventoryReplan(original,plan,observations).operations.length,1);
 assert.throws(()=>inventoryGroundingToInterpretation({...patch,items:[{...patch.items[0],purchaseCount:10}]},input,false));
 assert.throws(()=>inventoryGroundingToInterpretation({...patch,items:[{...patch.items[0],search:{keywords:['drink'],selectedSkus:['FOREIGN']}}]},input,false),/fresh inventory/);
 assert.throws(()=>inventoryGroundingToInterpretation({...patch,items:[]},input,false),/observed items/);
});

test('a repair SKU outside one observed item holds that item and preserves another valid request',()=>{
 const source='put a couple of oat drinks and one four litre white paint tin on my list';
 const requests=[
  {ordinal:0,sourceText:'a couple of oat drinks',query:'oat drink',purchaseCount:2,countEvidence:{sourceText:'a couple',value:2,mode:'total'},unresolved:[],search:{keywords:['oat drink']}},
  {ordinal:1,sourceText:'one four litre white paint tin',query:'white paint',purchaseCount:1,countEvidence:{sourceText:'one',value:1,mode:'total'},packSize:{value:4,unit:'litre'},unresolved:[],search:{keywords:['white paint']}},
 ];
 const original=understandingToInterpretation({...base(),intents:['add'],requestedItems:requests},{text:source,state:empty},false);
 const observations=[
  {tool:'discover_products' as const,query:'oat drink',products:[{sku:'OAT',name:'Oat Drink',unit:'can',pricePaise:100,stock:4,version:1,aliases:[],quantityStep:1}],totalCount:1},
  {tool:'discover_products' as const,query:'white paint',products:[{sku:'PAINT-4L',name:'White Paint 4 L',unit:'tin',pricePaise:50000,stock:4,version:1,aliases:[],quantityStep:1}],totalCount:1},
 ];
 const input={text:source,state:empty,proposal:original,observations,inventoryReplan:true};
 const patch={items:[
  {ordinal:0,query:'oat drink',search:{keywords:['oat drink'],selectedSkus:['FOREIGN']}},
  {ordinal:1,query:'white paint',search:{keywords:['white paint'],selectedSkus:['PAINT-4L']}},
 ],replacements:[]};
 assert.throws(()=>inventoryGroundingToInterpretation(patch,input,false),/fresh inventory/);
 const recovered=inventoryGroundingToInterpretation(patch,input,false,true);
 assert.equal(recovered.operations.length,2);
 assert.equal((recovered.operations[0] as any).quantity,2);
 assert.deepEqual((recovered.operations[0] as any).search.selectedSkus,[]);
 assert.ok((recovered.operations[0] as any).sourceUncertainty?.includes('catalog_check_pending'));
 assert.equal((recovered.operations[1] as any).quantity,1);
 assert.deepEqual((recovered.operations[1] as any).packSize,{value:4,unit:'litre'});
 assert.deepEqual((recovered.operations[1] as any).search.selectedSkus,['PAINT-4L']);
 assert.ok(!(recovered.operations[1] as any).sourceUncertainty?.includes('catalog_check_pending'));
 assert.equal(validateInventoryReplan(original,recovered,observations).operations.length,2);
});

const fanSource='I need one Ottenburger fan';
const heardFan={
 ordinal:0,sourceText:'one Ottenburger fan',query:'Attomberg fan',brand:'Attomberg',purchaseCount:1,
 countEvidence:{sourceText:'one',value:1,mode:'total'},
 attributeEvidence:[{field:'brand',value:'Attomberg',sourceText:'Ottenburger'}],
 unresolved:[],search:{keywords:['table fan','Attomberg fan']},
};
const fanSku='ATOM-TABLE';
const fanGrounding={items:[{ordinal:0,query:'Atomberg table fan',search:{identityQuery:'Atomberg table fan',keywords:['table fan'],selectedSkus:[fanSku]}}],replacements:[]};
const fanProduct={sku:fanSku,name:'Atomberg Renesa Table Fan',brand:'Atomberg',unit:'piece',pricePaise:10000,stock:10,version:1,aliases:['table fan'],quantityStep:1};

test('only an unambiguous same-item catalog match can correct a near spelling from voice',()=>{
 const compile=(sourceKind:'text'|'audio',brand='Attomberg',exactRequestedBrand?:string,wording='Atomberg table fan',extraProducts:typeof fanProduct[]=[])=>{
  const source=fanSource.replace('Ottenburger',brand);
  const item={...heardFan,sourceText:heardFan.sourceText.replace('Ottenburger',brand),query:brand+' fan',brand,attributeEvidence:[]};
  const original=understandingToInterpretation({...base(),intents:['add'],requestedItems:[item]},{text:source,state:empty},false);
  const observation={tool:'discover_products' as const,query:item.query,products:[fanProduct,...extraProducts],totalCount:1+extraProducts.length,exactRequestedBrand};
  const patch={...fanGrounding,items:[{...fanGrounding.items[0],query:wording,search:{...fanGrounding.items[0].search,identityQuery:wording}}]};
  const grounded=inventoryGroundingToInterpretation(patch,{text:source,state:empty,proposal:original,observations:[observation],inventoryReplan:true,repairSourceKind:sourceKind},false);
  const plan=validateInventoryReplan(original,grounded,[observation]);
  assert.equal(plan.understanding!.requestedItems[0].brand,brand);
  const operation=plan.operations[0];
  assert.ok(operation.kind==='add_item');
  return operation.search?.brand;
 };
 assert.equal(compile('audio'),'Atomberg');
 assert.equal(compile('text'),'Attomberg');
 assert.equal(compile('audio','Crompton'),'Crompton');
 assert.equal(compile('audio','Attomberg','Attomberg'),'Attomberg');
 assert.equal(compile('audio','Attomberg',undefined,'table fan'),'Attomberg');
 assert.equal(compile('audio','Attomberg',undefined,'Atomberg table fan',[{...fanProduct,sku:'OTHER',brand:'Attamberg'}]),'Attomberg');
});

test('a grounded voice brand spelling reaches SQL as the catalog brand and still needs product confirmation',()=>fixture(async(pool,inbox)=>{
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,brand,aliases,image_path,selling_unit_verified) VALUES($1,$2,$3,'piece',10000,10,'Atomberg','[\"table fan\"]',$4,true)",[inbox.context.storeId,fanSku,fanProduct.name,fixturePhoto(fanSku)]);
 const provider:Interpreter={name:'controlled-voice-brand',mode:'mock',unifiedUnderstanding:true,supportsAudio:true,interpret:async input=>{
  const output=input.inventoryReplan
   ?inventoryGroundingToInterpretation(fanGrounding,input,false)
   :understandingToInterpretation({...base(),inputKind:'audio',transcript:fanSource,intents:['add'],requestedItems:[heardFan]},input,false);
  if(input.inventoryReplan){
   assert.equal(input.repairSourceKind,'audio');
   // Cached provider results are read from JSONB, which reorders object keys.
   const stored=await pool.query('SELECT $1::jsonb AS proposal',[JSON.stringify(input.proposal)]);
   validateInventoryReplan(stored.rows[0].proposal,output,input.observations!);
   assert.ok(input.observations?.some(observation=>observation.products.some(product=>product.sku===fanSku)));
   assert.deepEqual(output.understanding!.requestedItems[0].attributeEvidence,heardFan.attributeEvidence);
   assert.equal(output.understanding!.requestedItems[0].sourceText,heardFan.sourceText);
  }
  return {output,usage:null,truncated:false};
 }};
 const runtime=new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true});
 const id=randomUUID(),pcm=Buffer.alloc(32000);
 for(let n=0;n<16000;n++)pcm.writeInt16LE(Math.round(Math.sin(n*.17)*1500),n*2);
 await inbox.ingest({id,type:'voice',mediaId:id},await normalizeVoice({id,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')}));
 await runtime.processNext(inbox.context);
 const snapshot=await inbox.snapshot(),line=snapshot.conversation.draft[0];
 assert.equal(line.quantity,1);
 assert.deepEqual(line.candidates?.map(product=>product.sku),[fanSku]);
 assert.ok(!line.productConfirmation);
 assert.ok(snapshot.messages.at(-1)?.rich?.parts?.some(part=>part.cards.some(card=>card.kind==='product'&&card.product.sku===fanSku)));
 assert.equal(snapshot.requests.length,0);
}));

test('semantic retrieval finds actual names across wrong family labels and remains store scoped',()=>fixture(async(pool,inbox)=>{
 await pool.query("UPDATE products SET family_id='dairy-drinks' WHERE store_id=$1 AND sku='OAT'",[inbox.context.storeId]);
 const c=await pool.connect();try{
  const products=await inventoryCandidateFacts(c,inbox.context,'oat drink',{keywords:['oat drink'],familyIds:['plant-drinks']});
  assert.equal(products[0].sku,'OAT');assert.equal(products[0].familyId,'dairy-drinks');
  assert.deepEqual(await inventoryCandidateFacts(c,{...inbox.context,storeId:randomUUID()},'oat drink',{keywords:['oat drink']}),[]);
 }finally{c.release();}
}));

test('generic identity hints preserve stated pipe type, material and dimension in SQL and grounding',()=>fixture(async(pool,inbox)=>{
 const ctx=inbox.context;
 await pool.query(`INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,aliases) VALUES
  ($1,'hardware',NULL,'department','Hardware','[]'),
  ($1,'pvc-pipes','hardware','family','PVC pipe','["pipe"]'),
  ($1,'garden-hoses','hardware','family','Garden hose','[]')`,[ctx.storeId]);
 for(const [sku,name,family,size,material,stock] of [
  ['PIPE-075','PVC pipe SDR 13','pvc-pipes','3/4 inch','PVC',8],
  ['PIPE-100','PVC pipe SDR 26','pvc-pipes','1 inch','PVC',0],
  ['HOSE-075','Garden hose 3/4 inch','garden-hoses','3/4 inch','rubber',15],
  ['HOSE-100','Garden hose 1 inch','garden-hoses','1 inch','rubber',15],
 ] as const){
  await pool.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,aliases,specifications,selling_unit_verified)
   VALUES($1,$2,$3,'piece',10000,$4,$5,'["PVC pipe","water pipe", "pipe"]',$6::jsonb,true)`,[ctx.storeId,sku,name,stock,family,JSON.stringify({size,material})]);
 }
 const search={identityQuery:'pipe',keywords:['pipe','PVC pipe','water pipe']};
 const client=await pool.connect();try{
  const queries=['3/4 inch PVC pipe','1 inch PVC pipe'];
  for(const [index,sku] of ['PIPE-075','PIPE-100'].entries()){
   const query=queries[index],result=await discoverProducts(client,ctx,query,search);
   assert.deepEqual(result.products.map(p=>p.sku),[sku]);
   assert.equal(result.products[0].stock,index===0?8:0);
   const facts=await inventoryCandidateFacts(client,ctx,query,{...search,specifications:{material:'PVC'}});
   assert.deepEqual(facts.map(p=>p.sku),[sku]);
  }
  const observed=await observeInventory(client,ctx,new RetailTools(pool),queries.map(query=>({query,search})),randomUUID());
  assert.deepEqual(observed.map(o=>o.products.map(p=>p.sku)),[['PIPE-075'],['PIPE-100']]);
  assert.deepEqual((await discoverProducts(client,ctx,'¾-inch PVC pipe',search)).products.map(p=>p.sku),['PIPE-075']);
  const source='Do you have 3/4 inch PVC pipe?';
  for(const intent of ['add','lookup','price']){
   const raw={...base(),intents:[intent],requestedItems:[{ordinal:0,sourceText:source,query:'PVC pipe',purchaseCount:null,dimensions:[{role:'diameter',value:.75,unit:'inch'}],unresolved:[],search}]};
   const plan=understandingToInterpretation(raw,{text:source,state:empty},false);
   const searchPlan=plan.next==='assist'?plan.assistance!.search:plan.next==='price'?plan.priceSearch:plan.operations[0].kind==='add_item'?plan.operations[0].search:undefined;
   assert.ok(searchPlan);
   assert.deepEqual((await discoverProducts(client,ctx,'PVC pipe',searchPlan)).products.map(p=>p.sku),['PIPE-075'],intent);
  }
 }finally{client.release();}
}));

test('a count expression that belongs only to a measurement cannot count packages',()=>{
 for(const [source,word] of [['நாலு லிட்டர் ஒயிட் பெயிண்ட்','நாலு'],['four litres of oat drink','four']]){
  const plan=understandingToInterpretation({...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'drink',purchaseCount:4,requestedAmount:{value:4,unit:'litre'},amountMode:'total',countEvidence:{sourceText:word,value:4,mode:'total'},unresolved:[]}]},{text:source,state:empty},false);
  assert.equal((plan.operations[0] as any).quantity,null);assert.equal((plan.operations[0] as any).requestedAmount.value,4);
 }
});

test('empty optional family hints do not reject an item or erase an explicit grounded rejection',()=>{
 const source='two oat drinks',raw={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'oat drink',purchaseCount:2,unresolved:[],search:{keywords:['oat drink'],familyIds:[],identityQuery:null,useCase:null,clarifyType:null,selectedSkus:[]}}]};
 const original=understandingToInterpretation(raw,{text:source,state:empty},false);
 assert.equal((original.operations[0] as any).quantity,2);assert.equal(original.understanding!.requestedItems[0].search?.familyIds,undefined);
 const input={text:source,state:empty,proposal:original,observations:[{tool:'discover_products' as const,query:'oat drink',products:[],totalCount:0}]};
 const rejected=inventoryGroundingToInterpretation({items:[{ordinal:0,query:'oat drink',search:{keywords:['oat drink'],familyIds:[],selectedSkus:[]}}],replacements:[]},input,false);
 assert.deepEqual(rejected.understanding!.requestedItems[0].search?.selectedSkus,[]);
 const normalized=inventoryGroundingToInterpretation({items:[{ordinal:0,query:'oat drink',search:{keywords:[],selectedSkus:[]}}],replacements:[]},input,false);
 assert.deepEqual(normalized.understanding?.requestedItems[0].search,{...rejected.understanding?.requestedItems[0].search});
 assert.throws(()=>inventoryGroundingToInterpretation({items:[{ordinal:0,query:'oat drink',search:{keywords:[17],selectedSkus:[]}}],replacements:[]},input,false));
});

test('replacement searches normalize absent family hints and still reject unknown keys',()=>{
 const source='replace hammer with oat drink',edit={kind:'replace',targetLineId:id,targetQuery:'hammer',sourceText:source,query:'oat drink',search:{keywords:['oat drink'],familyIds:[]}};
 const plan=understandingToInterpretation({...base(),proposedEdits:[edit]},{text:source,state:cart,inventoryGrounding:true},false);
 assert.equal((plan.operations[0] as any).search.familyIds,undefined);
 assert.throws(()=>understandingToInterpretation({...base(),proposedEdits:[{...edit,search:{...edit.search,unknownHint:'injected'}}]},{text:source,state:cart,inventoryGrounding:true},false));
});

for(const first of ['brand','spec:pack_size'])test(`144 products narrow using the agent's ${first} strategy, preserving counts and other cart rows`,()=>fixture(async(pool,inbox)=>{
 await pool.query('UPDATE products SET active=false WHERE store_id=$1',[inbox.context.storeId]);
 for(let b=0;b<3;b++)for(let p=0;p<4;p++)for(let f=0;f<4;f++)for(let tier=0;tier<3;tier++)await pool.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,brand,specifications,image_path,selling_unit_verified,aliases) VALUES($1,$2,$3,'can',$4,100,'plant-drinks',$5,$6::jsonb,'https://images.example.test/catalog.jpg',true,'["oat drink"]')`,[inbox.context.storeId,`DRINK-${b}${p}${f}${tier}`,`Field Oat Drink ${b}${p}${f}${tier}`,10000+tier*5000,`Farm ${b}`,JSON.stringify({pack_size:`${p+1} litre`,process:`Process ${f}`})]);
 const kept=randomUUID();await pool.query('UPDATE conversations SET draft=$1::jsonb WHERE id=$2',[JSON.stringify([{id:kept,query:'rice flour',name:'Rice flour',quantity:7,resolution:'unavailable'}]),inbox.context.conversationId]);
 const source='two oat drinks',steps=[first,...['brand','spec:pack_size','spec:process','price'].filter(k=>k!==first)];let calls=0;
 const provider:Interpreter={name:'synthetic-dynamic-narrowing',mode:'mock',unifiedUnderstanding:true,interpret:async input=>{
  calls++;let output:Interpretation;
  if(input.inventoryReplan){
   const facts=input.observations![0];assert.equal(facts.totalCount,144);assert.ok(facts.discovery!.facets.some(f=>f.key==='price'));assert.ok(JSON.parse(understandingPrompt(input)).catalogObservations[0].facets.some((f:any)=>f.key==='spec:process'));
   output=inventoryGroundingToInterpretation({items:[{ordinal:0,query:'oat drink',search:{keywords:['oat drink'],narrowing:steps.map(key=>({key,question:`Which ${key==='brand'?'farm':key==='spec:pack_size'?'pack size':key==='price'?'price range':'process'}?`}))}}],replacements:[]},input,false);
  }else output=understandingToInterpretation({...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'oat drink',purchaseCount:2,countEvidence:{sourceText:'two',value:2,mode:'total'},unresolved:[],search:{keywords:['oat drink']}}]},input,false);
  return {output,usage:null,truncated:false};
 }};
 const runtime=new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true});let s=await turn(inbox,runtime,{id:randomUUID(),type:'text',text:source});
 const id=s.conversation.draft.find(l=>l.id!==kept)!.id;
 const entries=()=>s.messages.at(-1)!.rich!.parts![0].cards;
 const e=entries()[0].buttons![0].event;assert.equal(e.type,'refine_search');if(e.type==='refine_search')assert.equal(e.facet,first);assert.equal(calls,2);
 const initial=s,forged={...e,id:randomUUID(),facet:'spec:process',value:'Process 3'} as SimulatorEvent;const version=s.conversation.version;s=await turn(inbox,runtime,forged);assert.equal(s.conversation.version,version);
 for(let level=0;level<3;level++){
  const next:SimulatorEvent=level===0?e:entries()[0].buttons![0].event;assert.equal(next.type,'refine_search');if(next.type==='refine_search')assert.equal(next.facet,steps[level]);
  const rich=(level===0?initial:s).messages.at(-1)!.rich!;assert.ok(rich.text.length<100,JSON.stringify({level,text:rich.text}));assert.ok(rich.parts![0].cards.length<=10);
  s=await turn(inbox,runtime,next);assert.equal(s.conversation.draft.find(l=>l.id===id)!.quantity,2);assert.equal(s.conversation.draft.find(l=>l.id===kept)!.quantity,7);assert.equal(s.conversation.draft.find(l=>l.id===id)!.sku,undefined,'group examples are not selected products');
 }
 assert.equal(calls,2,'facet taps reuse the validated strategy');assert.equal(s.requests.length,0);assert.equal(s.conversation.draft.find(l=>l.id===id)!.candidates!.length,3);assert.ok(s.messages.at(-1)!.rich!.parts![0].cards.every(c=>c.kind==='product'));
}));

test('grounding rejects invented narrowing keys and a strategy combined with sampled SKUs',()=>{
 const source='oat drink',prior=understandingToInterpretation({...base(),intents:['lookup'],requestedItems:[{ordinal:0,sourceText:source,query:source,purchaseCount:null,unresolved:[],search:{keywords:[source]}}]},{text:source,state:empty},false);
 const input={text:source,state:empty,proposal:prior,inventoryReplan:true,observations:[{tool:'discover_products' as const,query:source,totalCount:100,products:[],discovery:{query:source,plan:{keywords:[source]},products:[],rankings:[],totalCount:100,retrievedCount:0,noExactMatch:false,facets:[{key:'brand',label:'Brand',values:[{value:'A',label:'A',count:50},{value:'B',label:'B',count:50}]}]}}]};
 for(const search of [{keywords:[source],narrowing:[{key:'spec:invented_premium',question:'Premium?'}]},{keywords:[source],selectedSkus:[],narrowing:[{key:'brand',question:'Which brand?'}]}])assert.throws(()=>inventoryGroundingToInterpretation({items:[{ordinal:0,query:source,search}],replacements:[]},input,false),/observed|strategy|selection/i);
});

test('metadata-poor inventory pages through all 203 actual products beyond the retrieval sample',()=>fixture(async(pool,inbox)=>{
 await pool.query('UPDATE products SET active=false WHERE store_id=$1',[inbox.context.storeId]);
 await pool.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,aliases) SELECT $1,'DRINK-'||lpad(n::text,4,'0'),'Field Oat Drink model '||n,'can',0,100,'plant-drinks','["oat drink"]' FROM generate_series(1,203) n`,[inbox.context.storeId]);
 const c=await pool.connect();try{
  let result=await discoverProducts(c,inbox.context,'oat drink',{keywords:['oat drink'],browseAll:true});const seen:string[]=[];
  for(let page=0;page<30;page++){
   assert.equal(result.facets.length,0);assert.ok(result.products.length<=10);seen.push(...result.products.map(p=>p.sku));
   const reply=catalogGroupReply(result,empty,{memoryId:randomUUID()})!;assert.ok(reply.parts![0].cards.length<=10);
   if(result.nextProductOffset===undefined)break;
   result=await discoverProducts(c,inbox.context,'oat drink',refinementPlan(result,'__products__','__more__'));
  }
  assert.equal(seen.length,203);assert.equal(new Set(seen).size,203);assert.ok(seen.includes('DRINK-0203'));
 }finally{c.release();}
}));

test('actual price bands filter known prices without inventing quality or treating price as count',()=>fixture(async(pool,inbox)=>{
 await pool.query('UPDATE products SET active=false WHERE store_id=$1',[inbox.context.storeId]);
 await pool.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,selling_unit_verified) SELECT $1,'OAT-'||n,'Field Oat Drink model '||n,'can',n*1000,100,'plant-drinks',true FROM generate_series(1,18) n`,[inbox.context.storeId]);
 await pool.query(`UPDATE products SET price_status='confirm' WHERE store_id=$1 AND sku='OAT-18'`,[inbox.context.storeId]);
 const c=await pool.connect();try{
  const result=await discoverProducts(c,inbox.context,'oat drink',{keywords:['oat drink'],narrowing:[{key:'price',question:'Which price range?'}]});
  const bands=result.facets.find(f=>f.key==='price')!;assert.equal(bands.values.length,3);assert.equal(bands.values.reduce((sum,v)=>sum+v.count,0),17);
  for(const value of bands.values){const [low,high]=value.value.split(':').map(Number);assert.doesNotMatch(value.label,/premium|budget|quality/i);const refined=await discoverProducts(c,inbox.context,'oat drink',refinementPlan(result,'price',value.value));assert.ok(refined.products.length);assert.ok(refined.products.every(p=>p.priceStatus==='priced'&&p.pricePaise>=low&&p.pricePaise<=high));assert.equal(refined.plan.specifications?.pack_size,undefined);assert.equal(refined.plan.selectedSkus,undefined);}
 }finally{c.release();}
}));

test('a five-item spoken list keeps every count and shows real matches while an unclear item is held',()=>fixture(async(pool,inbox)=>{
 const source='ஒரு சாணைத்தாள், ஒரு நல்லி, டேப் ஒன்னு, ஒரு கையுறை, பாதுகாப்புக் கண்ணாடி ஒன்னு.';
 const rows=[
  {name:'சாணைத்தாள்',count:'ஒரு',query:'sandpaper',sku:'PAPER'},
  {name:'நல்லி',count:'ஒரு',query:null,sku:null},
  {name:'டேப்',count:'ஒன்னு',query:'adhesive tape',sku:'TAPE'},
  {name:'கையுறை',count:'ஒரு',query:'safety gloves',sku:'GLOVE'},
  {name:'பாதுகாப்புக் கண்ணாடி',count:'ஒன்னு',query:'safety glasses',sku:'GLASSES'},
 ];
 for(const row of rows){
  if(!row.sku)continue;
  await pool.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases,image_path,selling_unit_verified)
   VALUES($1,$2,$3,'piece',10000,10,$4::jsonb,$5,true)`,[inbox.context.storeId,row.sku,'Shop '+row.query,JSON.stringify([row.query]),fixturePhoto(row.sku)]);
 }
 // Even a store alias with the exact uncertain word cannot assign its meaning.
 await pool.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases,image_path,selling_unit_verified)
  VALUES($1,'ANCHOR','Wall plug anchor','piece',900,10,'["நல்லி"]',$2,true)`,[inbox.context.storeId,fixturePhoto('ANCHOR')]);
 const original={...base(),intents:['add'],requestedItems:rows.map((row,ordinal)=>({
  ordinal,sourceText:row.name,query:row.query,purchaseCount:1,countEvidence:{sourceText:row.count,value:1,mode:'total'},
  packSize:{value:1,unit:row.sku==='GLOVE'?'pair':'piece'},
  unresolved:row.query?[]:['identity'],...(row.query?{search:{keywords:[row.query]}}:{}),
 }))};
 let checks=0;
 const recognition:Interpreter={name:'test-verbatim-recognition',mode:'mock',supportsAudio:true,interpret:async()=>({
  output:{operations:[],next:'continue',transcript:source},usage:null,truncated:false,
 })};
 const provider:Interpreter={name:'test-whole-voice-list',mode:'mock',unifiedUnderstanding:true,supportsAudio:true,recognitionProvider:recognition,interpret:async(input)=>{
  if(!input.inventoryReplan){
   assert.ok(input.voiceTranscript);
   return {output:understandingToInterpretation(original,input,false),usage:null,truncated:false};
  }
  checks++;
  assert.deepEqual(input.observations?.map(fact=>fact.query),rows.flatMap(row=>row.query?[row.query]:[]));
  const items=rows.flatMap((row,ordinal)=>{
   if(!row.query||!row.sku)return [];
   assert.ok(input.observations?.find(fact=>fact.query===row.query)?.products.some(product=>product.sku===row.sku));
   return [{ordinal,query:row.query,search:{keywords:[row.query],selectedSkus:[row.sku]}}];
  });
  return {output:inventoryGroundingToInterpretation({items,replacements:[]},input,false),usage:null,truncated:false};
 }};
 const runtime=new ConversationRuntime(pool,provider,{visualOrdering:true,inventoryGrounding:true});
 const id=randomUUID(),pcm=Buffer.alloc(32000);
 for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(i*.17)*1100),i*2);
 await inbox.ingest({id,type:'voice',mediaId:id},await normalizeVoice({id,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')}));
 await runtime.processNext(inbox.context);
 const saved=await inbox.snapshot(),draft=saved.conversation.draft;
 assert.equal(checks,1);
 assert.equal(saved.messages.find(message=>message.id===id)?.text,source);
 assert.deepEqual(draft.map(line=>line.quantity),[1,1,1,1,1]);
 assert.ok(draft.every(line=>!line.packSize&&!line.discovery?.plan.specifications?.pack_size));
 assert.deepEqual(draft.map(line=>line.candidates?.[0]?.sku),['PAPER',undefined,'TAPE','GLOVE','GLASSES']);
 assert.match(draft[1].name,/நல்லி/);
 assert.ok(draft[1].sourceUncertainty?.includes('product_identity'));
 assert.ok(!draft.some(line=>line.productConfirmation));
 const cards=saved.messages.at(-1)?.rich?.parts?.flatMap(part=>part.cards)??[];
 const photo=cards.find(card=>card.kind==='product'&&card.product.sku==='PAPER');
 assert.ok(photo&&photo.kind==='product');
 assert.equal(photo.product.imageUrl,fixturePhoto('PAPER'));
 const pick=cards.flatMap(card=>card.buttons??[]).find(button=>button.event.type==='select_product');
 assert.ok(pick);
 const confirmed=await turn(inbox,runtime,pick.event);
 const chosen=confirmed.conversation.draft.find(line=>line.productConfirmation);
 assert.ok(chosen);
 assert.deepEqual(confirmed.conversation.draft.map(line=>[line.id,line.quantity]),draft.map(line=>[line.id,line.quantity]));
 assert.equal(confirmed.requests.length,0);
 assert.equal(checks,1);
}));


test('fractional diameter and length survive discovery, semantic selection and photo presentation',()=>fixture(async(pool,inbox)=>{
 const rows=[
  ['PVC-075-10','PVC Pipe 0.75 in 10 ft','0.75 in','10 ft'],
  ['PVC-075-20','PVC Pipe 0.75 in 20 ft','0.75 in','20 ft'],
  ['PVC-100-10','PVC Pipe 1 in 10 ft','1 in','10 ft'],
  ['PVC-SWAPPED','PVC Pipe 10 ft diameter 0.75 in long','10 ft','0.75 in'],
 ] as const;
 await pool.query("INSERT INTO catalog_nodes(store_id,id,kind,label,aliases) VALUES($1,'building','department','Building','[]')",[inbox.context.storeId]);
 await pool.query("INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,aliases) VALUES($1,'pipe','building','family','Pipe','[]')",[inbox.context.storeId]);
 for(const [sku,name,diameter,length] of rows)await pool.query(
  "INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,aliases,specifications,image_path,selling_unit_verified) VALUES($1,$2,$3,'piece',9000,10,'pipe','[]',$4,$5,true)",
  [inbox.context.storeId,sku,name,JSON.stringify({diameter,length}),fixturePhoto(sku)],
 );
 const source='two three quarter inch PVC pipe ten feet',query='PVC pipe';
 const dimensions=[{role:'diameter' as const,value:.75,unit:'inch'},{role:'length' as const,value:10,unit:'foot'}];
 const original={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query,purchaseCount:2,countEvidence:{sourceText:'two',value:2,mode:'total'},dimensions,unresolved:[],search:{keywords:[query]}}]};
 const provider:Interpreter={name:'controlled-dimensions',mode:'mock',unifiedUnderstanding:true,interpret:async input=>{
  if(input.inventoryReplan)assert.deepEqual(input.observations?.[0].products.map(p=>p.sku),['PVC-075-10']);
  const output=input.inventoryReplan
    ?inventoryGroundingToInterpretation({items:[{ordinal:0,query,search:{keywords:[query],identityQuery:'three quarter inch pvc pipe 10 feet',selectedSkus:['PVC-075-10']}}],replacements:[]},input,false)
    :understandingToInterpretation(original,input,false);
  return {output,usage:null,truncated:false};
 }};
 const snapshot=await turn(inbox,new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true}),{id:randomUUID(),type:'text',text:source});
 const line=snapshot.conversation.draft[0];
 assert.equal(line.quantity,2);
 assert.deepEqual(line.discovery?.plan.dimensions,dimensions);
 assert.deepEqual(line.candidates?.map(p=>[p.sku,p.imageUrl]),[['PVC-075-10',fixturePhoto('PVC-075-10')]]);
 assert.equal(snapshot.requests.length,0);

 // Catalog edits between a photo and review invalidate the current choice.
 await pool.query("UPDATE products SET name='PVC Pipe 2 in 10 ft',specifications=jsonb_set(specifications,'{diameter}',to_jsonb('2 in'::text)),version=version+1 WHERE store_id=$1 AND sku='PVC-075-10'",[inbox.context.storeId]);
 const changed=await turn(inbox,new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true}),{id:randomUUID(),type:'review',expectedVersion:snapshot.conversation.version});
 assert.equal(changed.requests.length,0);
 assert.equal(changed.conversation.draft[0].quantity,2);
 assert.equal(changed.conversation.draft[0].sku,undefined);
 assert.equal(changed.conversation.draft[0].productConfirmation,undefined);
 assert.doesNotMatch(changed.messages.at(-1)?.text??'',/All details could not/);
}));

test('a compact brand remains readable while explicit metre measurements still parse',()=>{
 assert.deepEqual(catalogMeasurements('3M insulation tape 3m'),[{value:3,unit:'m'}]);
 assert.equal(measurementText('3M insulation tape',{replyLanguage:'ta'}),'3M insulation tape');
});

test('a repaired voice list keeps independent counts and photos when one catalog search still needs checking',()=>fixture(async(pool,inbox)=>{
 const transcript='Two oat milk and three hibiscus concentrates';
 const understanding={...base(),schemaVersion:2 as const,inputKind:'audio' as const,transcript,intents:['add' as const],requestedItems:[
  {ordinal:0,sourceText:'Two oat milk',query:'oat milk',purchaseCount:2,unresolved:[],search:{keywords:['oat milk']}},
  {ordinal:1,sourceText:'three hibiscus concentrates',query:'hibiscus concentrate',purchaseCount:3,unresolved:[],search:{keywords:['hibiscus concentrate']}},
 ]};
 let calls=0;
 const provider:Interpreter={name:'repaired-independent-additions',mode:'mock',supportsAudio:true,unifiedUnderstanding:true,interpret:async input=>{
  if(++calls===1)return {
   output:{operations:[],next:'continue',transcript,understanding:{...base(),unresolved:['validation_recovery']}},
   evidenceRepair:{understanding:{...understanding,inputKind:'audio'},feedback:'Verify the item evidence.'},usage:null,truncated:false,
  };
  assert.equal(calls,2);
  const [oat,held]=understanding.requestedItems;
  const repaired={...understanding,inputKind:'text',transcript:undefined,requestedItems:[{...oat,search:{...oat.search,selectedSkus:['OAT']}},held]};
  return {output:understandingToInterpretation(repaired,input,false),usage:null,truncated:false};
 }};
 const runtime=new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true});
 const mediaId=randomUUID(),pcm=Buffer.alloc(32000);
 for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(i*.17)*1200),i*2);
 const media=await normalizeVoice({id:mediaId,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')});
 await inbox.ingest({id:mediaId,type:'voice',mediaId},media);
 await runtime.processNext(inbox.context);
 const snapshot=await inbox.snapshot(),[found,pending]=snapshot.conversation.draft;
 assert.equal(snapshot.requests.length,0);
 assert.equal(found?.quantity,2,JSON.stringify({calls,reason:snapshot.messages.at(-1)?.rich?.clarificationReason,attempts:(await pool.query('select stage,state,failure_code from provider_attempts where conversation_id=$1',[inbox.context.conversationId])).rows}));
 assert.deepEqual(found?.candidates?.map(p=>p.sku),['OAT']);
 assert.equal(pending?.quantity,3);
 assert.equal(pending?.catalogIssue,'catalog_check_pending');
 assert.deepEqual(pending?.candidates,[]);
 assert.ok(snapshot.messages.at(-1)?.rich?.parts?.some(part=>part.cards.some(card=>card.kind==='product'&&card.product.imageUrl===fixturePhoto('OAT'))));
}));

test('an exact store alias and an independently supported name find products outside inferred taxonomy',()=>fixture(async(pool,inbox)=>{
 const ctx=inbox.context;
 await pool.query(`INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,aliases) VALUES
  ($1,'kitchen',NULL,'department','Kitchen','[]'),
  ($1,'cookware','kitchen','family','Bowls and lids','["mixing bowl"]'),
  ($1,'serveware','kitchen','family','Serving utensils','[]')`,[ctx.storeId]);
 for(const [sku,name,family,aliases] of [
  ['BOWL-A','Ceramic Mixing Bowl','cookware',['batter container','mixing bowl']],
  ['BOWL-B','Steel Mixing Bowl','serveware',['batter container','mixing bowl']],
  ['LID','Spare Bowl Lid','cookware',['batter container','bowl cover']],
 ] as const){
  await pool.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,aliases,image_path,selling_unit_verified)
   VALUES($1,$2,$3,'piece',30000,10,$4,$5::jsonb,$6,true)`,
  [ctx.storeId,sku,name,family,JSON.stringify(aliases),fixturePhoto(sku)]);
 }
 const client=await pool.connect();
 try{
  const search={keywords:['batter container','mixing bowl'],identityQuery:'batter container'};
  const found=await discoverProducts(client,ctx,'batter container',search);
  assert.deepEqual(found.products.map(p=>p.sku).sort(),['BOWL-A','BOWL-B']);
  assert.ok(found.products.every(p=>p.imageUrl===fixturePhoto(p.sku)));
  const named=await discoverProducts(client,ctx,'mixing bowl');
  assert.deepEqual(named.products.map(p=>p.sku).sort(),['BOWL-A','BOWL-B']);
  const unsupported=await discoverProducts(client,ctx,'unknown part',{keywords:['unknown part','mixing bowl']});
  assert.equal(unsupported.products.length,0);
  const size=await discoverProducts(client,ctx,'batter container',{...search,dimensions:[{value:12,unit:'inch',role:'diameter'}]});
  assert.equal(size.products.length,0);
 }finally{client.release();}
}));

test('empty optional search keywords on a later voice item preserve the complete evidenced list',()=>{
 const names=['oat drink','dairy milk','rice flour','vanilla','green tea','hibiscus','black beans'];
 const transcript=names.map(name=>'two '+name).join(' and ');
 const items=names.map((query,ordinal)=>({ordinal,query,sourceText:'two '+query,purchaseCount:2,
  countEvidence:{sourceText:'two',value:2,mode:'total'},unresolved:[],search:{keywords:ordinal>=5?[]:[query]}}));
 const input={text:transcript,state:empty,voiceTranscript:true,inventoryGrounding:true};
 const original={...base(),intents:['add'],requestedItems:items};
 const plan=understandingToInterpretation(original,input,false);
 assert.deepEqual(plan.operations.map(op=>op.kind==='add_item'?[op.query,op.quantity]:[]),names.map(name=>[name,2]));
 assert.deepEqual(plan.understanding?.requestedItems[6].search?.keywords,['black beans']);
 assert.throws(()=>understandingToInterpretation({...original,requestedItems:items.map(item=>item.ordinal===6?{...item,sourceText:'two red beans'}:item)},input,false),/evidence is not in current input/i);
});
