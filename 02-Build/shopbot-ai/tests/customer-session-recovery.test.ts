import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import type {Interpretation,Operation,RichReply,SimulatorEvent,Snapshot} from '../packages/contracts/index.js';
import {interpretationSchema} from '../packages/contracts/index.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import type {Interpreter,InterpretationInput} from '../apps/server/src/adapters/interpreter.js';
import {normalizeVoice,pcmWav} from '../apps/server/src/services/voice-media.js';
import {catalogMeasures,catalogPack} from '../apps/server/src/services/quantity-evidence.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){
  const schema='session_recovery_'+randomUUID().replaceAll('-','');
  const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
  try{
    await setupDatabase(pool,'mock');await setupImageDemo(pool);
    const id=randomUUID();
    await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language) VALUES($1,$2,'customer-session','ta')",[id,demoCatalogStore]);
    await run(pool,new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'customer-session',role:'customer'}));
  }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
function provider(plan:(input:InterpretationInput)=>Interpretation,recognize:()=>string=()=> ''):Interpreter{
  return {name:'customer-session-fixture',mode:'mock',supportsAudio:true,interpret:async input=>({output:input.stage==='recognize'?{transcript:recognize(),operations:[],next:'continue'}:plan(input),truncated:false,usage:null})};
}
const last=(s:Snapshot)=>s.messages.at(-1)!.rich!;
const actions=(r:RichReply)=>r.parts?.flatMap(p=>[...p.buttons??[],...p.cards.flatMap(c=>c.buttons??[])])??r.buttons??[];
const choose=(s:Snapshot,type:SimulatorEvent['type'])=>actions(last(s)).find(a=>a.event.type===type)!.event;
async function send(inbox:SimulatorService,runtime:ConversationRuntime,event:SimulatorEvent){await inbox.ingest(event);await runtime.processNext(inbox.context);return inbox.snapshot();}
const text=(inbox:SimulatorService,runtime:ConversationRuntime,value:string)=>send(inbox,runtime,{id:randomUUID(),type:'text',text:value});
async function voice(inbox:SimulatorService,runtime:ConversationRuntime){
  const id=randomUUID(),pcm=Buffer.alloc(32000);
  for(let n=0;n<16000;n++)pcm.writeInt16LE(Math.round(Math.sin(n*.19)*1500),n*2);
  const media=await normalizeVoice({id,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')});
  await inbox.ingest({id,type:'voice',mediaId:id},media);await runtime.processNext(inbox.context);return inbox.snapshot();
}
const three:Operation[]=[{kind:'add_item',query:'H01',quantity:1},{kind:'add_item',query:'H08',quantity:1},{kind:'add_item',query:'H29',quantity:1}];

test('ambiguous spoken tube asks product type, keeps other items, and completes a single hose order',()=>fixture(async(pool,inbox)=>{
  const transcript='Enakku thanni tube onnu and teflon tape onnu. Kai la podra gloves onnu.';
  const plan:Interpretation={next:'review',operations:[{kind:'add_item',query:'water pipe',quantity:1,productIntent:{kind:'ambiguous',sourcePhrase:'thanni tube onnu',alternatives:[{query:'PVC pipe',familyId:'pvc-pipes'},{query:'garden hose',familyId:'hose'}],question:'தண்ணீர் ஊற்ற hose வேணுமா, PVC pipe வேணுமா?'}},three[1],three[2]]};
  const runtime=new ConversationRuntime(pool,provider(()=>plan,()=>transcript),{visualOrdering:true});
  let s=await voice(inbox,runtime);
  assert.equal(s.conversation.replyLanguage,'ta');assert.equal(s.conversation.draft.length,3);
  assert.equal(last(s).clarificationReason,'product_meaning');assert.equal(s.conversation.draft[0].sku,undefined);
  assert.deepEqual(last(s).parts![0].cards.flatMap(c=>c.kind==='product'?[c.product.familyId]:[]),['pvc-pipes','hose']);
  const hose=actions(last(s)).find(b=>b.event.type==='refine_search'&&b.event.value==='hose')!;
  const ids=s.conversation.draft.map(l=>l.id);
  s=await send(inbox,runtime,hose.event);
  assert.deepEqual(s.conversation.draft.map(l=>l.id),ids);
  assert.deepEqual(s.conversation.draft[0].candidates!.map(p=>p.sku),['H13']);
  assert.equal(s.conversation.draft[0].productIntent,undefined);
  if(actions(last(s)).some(a=>a.event.type==='select_product'))s=await send(inbox,runtime,choose(s,'select_product'));
  assert.equal(last(s).stage,'products');
  s=await send(inbox,runtime,choose(s,'confirm_products'));
  assert.equal(last(s).stage,'bill');assert.equal(s.requests.length,0);
  const bill=s.messages.filter(m=>m.rich?.groupId===last(s).groupId).flatMap(m=>m.rich?.parts?.flatMap(p=>p.cards)??[]).find(c=>c.kind==='bill')!;assert.ok(bill.kind==='bill');
  assert.equal(bill.billRows![0].packSize,'0.5 இன்ச் x 10 மீட்டர்');assert.match(bill.billRows![0].count,/1/);
  assert.equal(s.conversation.pending?.kind==='review'&&s.conversation.pending.totalPaise,55500);
  const confirm=choose(s,'confirm');s=await send(inbox,runtime,confirm);
  assert.equal(s.requests.length,1);assert.equal(s.requests[0].totalPaise,55500);
  await inbox.ingest(confirm);assert.equal(await runtime.processNext(inbox.context),false);assert.equal((await inbox.snapshot()).requests.length,1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_requests WHERE conversation_id=$1',[inbox.context.conversationId])).rows[0].n,1);
}));

test('recorded hose correction removes old PVC diameter and retains both other stable lines',()=>fixture(async(_pool,inbox)=>{
  let operations=three;
  const transcript='enakku vandhu hose indha marathukku thanni utra hose adha mathanum';
  const runtime=new ConversationRuntime(_pool,provider(()=>({operations,next:'review'}),()=>transcript),{visualOrdering:true});
  let s=await text(inbox,runtime,'one PVC pipe, one tape and one pair of gloves');
  const ids=s.conversation.draft.map(l=>l.id),oldProductApproval=choose(s,'confirm_products');
  s=await send(inbox,runtime,oldProductApproval);const oldFinal=choose(s,'confirm');
  s=await text(inbox,runtime,'edit my list');
  const target=actions(last(s)).find(a=>a.event.type==='edit_item'&&a.event.lineId===ids[0])!;
  s=await send(inbox,runtime,target.event);
  assert.equal(last(s).parts![0].cards[0].kind,'product');
  operations=[{kind:'resolve_line',lineId:ids[0],query:'garden hose',search:{keywords:['garden hose','watering hose'],familyId:'hose'},quantity:1}];
  s=await voice(inbox,runtime);
  assert.equal(s.conversation.replyLanguage,'ta'); // ASR transliteration does not change the saved conversation language.
  assert.deepEqual(s.conversation.draft.map(l=>l.id),ids);
  assert.equal(s.conversation.draft[0].packSize,undefined);assert.equal(s.conversation.draft[0].productMeasures,undefined);
  assert.deepEqual(s.conversation.draft[0].candidates!.map(p=>p.sku),['H13']);
  assert.deepEqual(s.conversation.draft.slice(1).map(l=>[l.sku,l.quantity,l.unit]),[['H08',1,'roll'],['H29',1,'pair']]);
  s=await send(inbox,runtime,oldFinal);assert.equal(s.requests.length,0);assert.equal(last(s).stage,'products');assert.notEqual(s.conversation.pending?.id,'reviewId' in oldFinal?oldFinal.reviewId:undefined);
  s=await text(inbox,runtime,'review');if(actions(last(s)).some(a=>a.event.type==='select_product'))s=await send(inbox,runtime,choose(s,'select_product'));
  s=await send(inbox,runtime,choose(s,'confirm_products'));s=await send(inbox,runtime,choose(s,'confirm'));
  assert.equal(s.requests.length,1);assert.equal(s.requests[0].lines[0].sku,'H13');
}));

test('inferred watering use produces an actual hose proposal rather than literal tube search',()=>fixture(async(pool,inbox)=>{
  const phrase='marathukku thanni utra tube onnu';
  const runtime=new ConversationRuntime(pool,provider(()=>({next:'review',operations:[{kind:'add_item',query:'garden hose',quantity:1,search:{keywords:['watering hose'],familyId:'hose'},productIntent:{kind:'inferred',sourcePhrase:phrase,useCase:'watering trees'}}]})),{visualOrdering:true});
  const s=await text(inbox,runtime,phrase);
  assert.equal(s.conversation.draft[0].productIntent?.sourcePhrase,phrase);
  assert.deepEqual(s.conversation.draft[0].candidates!.map(p=>p.sku),['H13']);
  assert.ok(actions(last(s)).some(a=>['select_product','confirm_products'].includes(a.event.type)));assert.equal(s.requests.length,0);
}));

test('a specific two one-inch PVC request retains count and dimension without a hose alternative',()=>fixture(async(pool,inbox)=>{
  const runtime=new ConversationRuntime(pool,provider(()=>({next:'review',operations:[{kind:'add_item',query:'1 inch PVC pipe',quantity:2,search:{keywords:['PVC pipe'],familyId:'pvc-pipes'}}]})),{visualOrdering:true});
  const s=await text(inbox,runtime,'two 1-inch PVC pipes');
  assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.conversation.draft[0].packSize,undefined);
  assert.deepEqual(s.conversation.draft[0].productMeasures,[{value:1,unit:'inch'}]);
  assert.ok(s.conversation.draft[0].candidates!.length);assert.ok(s.conversation.draft[0].candidates!.every(p=>p.familyId==='pvc-pipes'&&p.specifications?.size==='1 inch'));
  assert.notEqual(last(s).clarificationReason,'product_meaning');
}));

test('replacement still respects a newly specified diameter instead of showing a mismatched stocked hose',()=>fixture(async(pool,inbox)=>{
  let operations=three;
  const runtime=new ConversationRuntime(pool,provider(()=>({operations,next:'review'})),{visualOrdering:true});
  let s=await text(inbox,runtime,'shopping list');const id=s.conversation.draft[0].id;
  operations=[{kind:'resolve_line',lineId:id,query:'1 inch garden hose',search:{keywords:['garden hose'],familyId:'hose'}}];
  s=await text(inbox,runtime,'replace the pipe with a 1-inch garden hose');
  assert.deepEqual(s.conversation.draft[0].productMeasures,[{value:1,unit:'inch'}]);
  assert.equal(s.conversation.draft[0].resolution,'unavailable');assert.equal(s.requests.length,0);
  assert.deepEqual(s.conversation.draft.slice(1).map(l=>l.sku),['H08','H29']);
}));

test('unfounded meaning evidence and invented family IDs cannot partially add a shopping list',()=>fixture(async(pool,inbox)=>{
  for(const [sourcePhrase,familyId] of [['not said','hose'],['tube','invented-family']]){
    const runtime=new ConversationRuntime(pool,provider(()=>({next:'review',operations:[three[1],{kind:'add_item',query:'tube',quantity:1,productIntent:{kind:'ambiguous',sourcePhrase,alternatives:[{query:'PVC pipe',familyId:'pvc-pipes'},{query:'garden hose',familyId}]}}]})),{visualOrdering:true});
    const s=await text(inbox,runtime,'tube');assert.equal(s.conversation.draft.length,0);assert.equal(last(s).stage,'error');assert.equal(s.requests.length,0);
  }
}));

for(const failures of [1,2])test(`${failures} recognition 503s: bounded retry and honest bill-stage recovery`,()=>fixture(async(pool,inbox)=>{
  let calls=0;
  const runtime=new ConversationRuntime(pool,provider(input=>input.text==='shopping list'?{operations:three,next:'review'}:{operations:[],next:'continue',clarifyQuestion:'எந்தப் பொருளை மாற்றணும்?'},()=>{calls++;if(calls<=failures)throw Object.assign(new Error('speech unavailable'),{status:503});return 'hose maathanum';}),{visualOrdering:true});
  let s=await text(inbox,runtime,'shopping list');s=await send(inbox,runtime,choose(s,'confirm_products'));
  const draft=s.conversation.draft,pending=s.conversation.pending;
  s=await voice(inbox,runtime);assert.equal(calls,2);
  assert.deepEqual(s.conversation.draft,draft);assert.deepEqual(s.conversation.pending,pending);assert.equal(s.requests.length,0);
  const attempts=(await pool.query('SELECT stage,state,failure_code FROM provider_attempts WHERE message_id=$1 ORDER BY attempt',[s.messages.filter(m=>m.direction==='inbound').at(-1)!.id])).rows;
  assert.deepEqual(attempts.slice(0,2).map(a=>a.state),failures===1?['failed','succeeded']:['failed','failed']);
  if(failures===2){
    assert.equal(last(s).stage,'error');assert.equal(last(s).clarificationReason,'voice_processing_failed');
    assert.equal(last(s).parts,undefined);
    assert.equal(last(s).presentation,'list');
    const retry=actions(last(s)).find(b=>b.event.type==='retry_voice')!;assert.ok(retry);
    s=await send(inbox,runtime,retry.event);assert.equal(calls,3);assert.equal(s.requests.length,0);
  }else{assert.equal(last(s).clarificationReason,'intent_clarification');assert.equal(last(s).stage,'identify');}
}));

test('nontransient speech errors have no automatic retry and a visible kept-list error',()=>fixture(async(pool,inbox)=>{
  let calls=0;
  const runtime=new ConversationRuntime(pool,provider(()=>({operations:[],next:'continue'}),()=>{calls++;throw Object.assign(new Error('permission denied'),{status:403});}),{visualOrdering:true});
  const s=await voice(inbox,runtime);assert.equal(calls,1);assert.equal(last(s).stage,'error');assert.equal(s.conversation.draft.length,0);
}));

test('voice approval submits the current delivered bill without requiring a button',()=>fixture(async(pool,inbox)=>{
  const runtime=new ConversationRuntime(pool,provider(input=>input.text==='shopping list'?{operations:three,next:'review'}:{operations:[],next:'continue'},()=> 'yes'),{visualOrdering:true});
  let s=await text(inbox,runtime,'shopping list');s=await send(inbox,runtime,choose(s,'confirm_products'));s=await voice(inbox,runtime);
  assert.equal(last(s).stage,'submitted');assert.equal(s.requests.length,1);
}));

test('per-product change opens that item directly, and new-draft copy does not claim submission',()=>fixture(async(pool,inbox)=>{
  const runtime=new ConversationRuntime(pool,provider(()=>({operations:three,next:'review'})),{visualOrdering:true});
  let s=await text(inbox,runtime,'shopping list');const id=s.conversation.draft[1].id;
  const card=s.messages.filter(m=>m.rich?.groupId===last(s).groupId).flatMap(m=>m.rich?.parts?.flatMap(p=>p.cards)??[]).find(c=>c.kind==='product'&&c.lineId===id)!;
  const edit=card.buttons!.find(b=>b.event.type==='edit_item');assert.ok(edit);s=await send(inbox,runtime,edit.event);
  assert.equal(s.conversation.editingLineId,id);assert.equal(last(s).parts![0].cards[0].kind,'product');
  s=await send(inbox,runtime,{id:randomUUID(),type:'shopping_action',action:'new_list',expectedVersion:s.conversation.version});
  assert.equal(s.conversation.draft.length,0);assert.equal(s.requests.length,0);assert.doesNotMatch(last(s).text,/previous.*shop|முந்தைய|Munthaya/i);
}));

test('compound hose dimensions stay specifications and never become a count conversion',()=>{
  const hose={specifications:{size:'0.5 inch x 10m'}} as any;
  assert.deepEqual(catalogMeasures(hose),[{value:.5,unit:'inch',role:'size'},{value:10,unit:'m',role:'size'}]);assert.equal(catalogPack(hose),undefined);
  assert.equal(interpretationSchema.safeParse({operations:[{kind:'add_item',query:'tube',quantity:1,productIntent:{kind:'ambiguous',sourcePhrase:'tube',alternatives:[{query:'pipe',familyId:'pvc-pipes'},{query:'hose',familyId:'pvc-pipes'}]}}],next:'review'}).success,false);
});

test('category labels remain complete in the image and native button titles do not truncate',()=>fixture(async(pool,inbox)=>{
  const runtime=new ConversationRuntime(pool,provider(()=>({operations:[],next:'continue'})),{visualOrdering:true});
  const s=await send(inbox,runtime,{id:randomUUID(),type:'shopping_action',action:'browse',expectedVersion:0});
  const reply=last(s),cards=reply.parts!.flatMap(p=>p.cards);
  assert.ok(cards.every(c=>c.kind==='instruction'));
  assert.ok(cards.some(c=>c.kind==='instruction'&&[c.title,...c.lines].some(l=>/ஹார்டுவேர்/.test(l))));
  const native=renderWhatsAppReply(reply,randomUUID(),'example.test');assert.ok(native.actions.length>=3);assert.ok(native.actions.every(a=>!a.label.includes('…')&&Array.from(a.label).length<=20));
}));


for(const validTarget of [false,true])test(`a replacement remove/add plan ${validTarget?'preserves the named line ID/count':'cannot silently replace a different named item'}`,()=>fixture(async(pool,inbox)=>{
 let operations:Operation[]=three;
 const runtime=new ConversationRuntime(pool,provider(()=>({operations,next:'review'})),{visualOrdering:true});let s=await text(inbox,runtime,'shopping list');const before=structuredClone(s.conversation.draft);
 operations=[{kind:'remove_item',reference:before[validTarget?0:1].id},{kind:'add_item',query:'garden hose',quantity:null,search:{keywords:['garden hose'],familyId:'hose'}}];
 s=await text(inbox,runtime,'Please replace the PVC pipe with the hose used for watering trees');
 if(!validTarget){assert.deepEqual(s.conversation.draft,before);assert.equal(last(s).clarificationReason,'correction_target');assert.equal(last(s).stage,'error');}
 else{assert.deepEqual(s.conversation.draft.map(l=>l.id),before.map(l=>l.id));assert.deepEqual(s.conversation.draft.slice(1),before.slice(1));assert.equal(s.conversation.draft[0].sku,'H13');assert.equal(s.conversation.draft[0].quantity,1);}
 assert.equal(s.requests.length,0);
}));

test('a count word mislabeled as a selling unit does not force an unnecessary unit question',()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,provider(()=>({next:'review',operations:[{kind:'add_item',query:'teflon tape',quantity:1,requestedUnit:'onnu',supportingPhrase:'teflon tape onnu'}]})),{visualOrdering:true});
 const s=await text(inbox,runtime,'teflon tape onnu');assert.equal(s.conversation.draft[0].quantity,1);assert.equal(s.conversation.draft[0].unit,'roll');assert.equal(s.conversation.draft[0].resolution,'matched');assert.equal(last(s).stage,'products');
}));


test('the saved legacy hose error recovers through a fresh complete review without losing count or other lines',()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,provider(()=>({operations:three,next:'review'})),{visualOrdering:true});let s=await text(inbox,runtime,'shopping list');const draft=structuredClone(s.conversation.draft),ids=draft.map(l=>l.id);
 draft[0]={id:ids[0],query:'garden hose',name:'garden hose',quantity:1,packSize:{value:1,unit:'inch'},supportingPhrase:'enakku vandhu hose indha marathukku thanni utra hose adha mathanum',quantityEvidenceVersion:1,resolution:'unavailable',candidates:[],discovery:{query:'garden hose',plan:{familyId:'hose',keywords:['garden hose','watering hose']},products:[],rankings:[],facets:[],totalCount:1,retrievedCount:1,noExactMatch:true}};
 await pool.query('UPDATE conversations SET draft=$1::jsonb,pending=NULL,product_review=NULL WHERE id=$2',[JSON.stringify(draft),inbox.context.conversationId]);
 s=await text(inbox,runtime,'review');assert.deepEqual(s.conversation.draft.map(l=>l.id),ids);assert.equal(s.conversation.draft[0].packSize,undefined);assert.equal(s.conversation.draft[0].productMeasures,undefined);assert.equal(s.conversation.draft[0].sku,'H13');assert.equal(s.conversation.draft[0].quantity,1);assert.deepEqual(s.conversation.draft.slice(1),draft.slice(1));assert.equal(last(s).stage,'products');assert.equal(s.requests.length,0);
}));
