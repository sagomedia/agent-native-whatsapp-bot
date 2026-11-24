import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {understandingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';
import {namedEditLines} from '../apps/server/src/adapters/mention-reconciliation.js';
import {materialOnlyCorrection} from '../apps/server/src/services/cart-edit-targets.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {saveAssistantMemory} from '../apps/server/src/services/agent-assistance.js';
import type {ConversationState,DraftLine} from '../packages/contracts/index.js';
const row=(name:string,quantity:number|null=1):DraftLine=>({id:randomUUID(),query:name,name,quantity,resolution:'unavailable',candidates:[]});
const source='இல்ல இல்ல ஸ்டெயின்லெஸ் ஸ்டீல் இல்ல இது அலுமினியம்.';
const answer='அந்த ஸ்டெய்ன்லெஸ் ஸ்டீல் டோர் லேட்ச்ன்னு போட்டுருக்கல்ல அந்த பொருளை தான் மாத்தணும்.';
const empty={schemaVersion:2 as const,inputKind:'text' as const,intents:['edit' as const],requestedItems:[],proposedEdits:[],shopQuestions:[],unresolved:[]};
function cart():ConversationState{const draft=[row('stainless steel tap',null),row('stainless steel screw box',2),row('stainless steel door latch 6 inch',1)];return {version:0,draft,pending:null,fulfillment:'pickup',lastRequestId:null,visualOrdering:true,replyLanguage:'en',activeItemId:draft[2].id};}
const edit=(s:ConversationState)=>({kind:'replace' as const,sourceText:source,targetLineId:s.draft[0].id,targetQuery:'stainless steel tap',query:'aluminium tap'});
test('a material correction retains the active door latch, dimension and quantities despite a wrong model noun/ID',()=>{
 const s=cart(),before=structuredClone(s),r=understandingToInterpretation({...empty,proposedEdits:[edit(s)]},{text:source,state:s},false);
 assert.deepEqual(r.operations,[{kind:'resolve_line',lineId:s.draft[2].id,query:'aluminium door latch 6 inch',supportingPhrase:source}]);assert.equal(r.deferredCartTargets,undefined);assert.deepEqual(s,before);
});
test('explicit Tamil door-latch identity excludes screws and a tap sharing the material',()=>{
 const s=cart();assert.deepEqual(namedEditLines(answer,s).map(l=>l.id),[s.draft[2].id]);
 const u={...empty,proposedEdits:[{...edit(s),sourceText:'change stainless steel door latch to aluminium door latch',targetLineId:s.draft[1].id}]};
 const r=understandingToInterpretation(u,{text:u.proposedEdits[0].sourceText,state:s},false);assert.deepEqual(r.operations,[]);assert.deepEqual(r.deferredCartTargets?.[0].candidateLineIds,[s.draft[2].id]);
});
test('negative material and explicitly named replacements are not treated as this-item material changes',()=>{
 const s=cart();for(const text of ['this aluminium is not wanted','இது அலுமினியம் இல்ல','replace stainless steel latch with aluminium tap'])assert.equal(materialOnlyCorrection({...edit(s),sourceText:text}),undefined);
});
test('an unrelated active product cannot capture a correction naming a different old material',()=>{
 const s=cart();s.draft[2].query='wooden door latch';s.draft[2].name=s.draft[2].query;
 const r=understandingToInterpretation({...empty,proposedEdits:[edit(s)]},{text:source,state:s},false);
 assert.deepEqual(r.operations,[]);assert.ok(!r.deferredCartTargets?.[0].candidateLineIds.includes(s.draft[2].id));
});
for(const pending of [false,true])test(`recorded material correction ${pending?'recovers a wrongly narrowed saved goal':'updates only the latest active request'} and never submits`,async()=>{
 const schema='material_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema});
 try{
  await setupDatabase(pool,'mock');const s=cart(),inbox=new SimulatorService(pool),ctx=inbox.context;let calls=0;
  await pool.query('UPDATE conversations SET visual_ordering=true,partial_reviews=true,reply_language=$1,draft=$2::jsonb,active_item_id=$4 WHERE id=$3',['en',JSON.stringify(s.draft),ctx.conversationId,s.activeItemId]);
  // Restore the current active item independently of a pending target question.
  const client=await pool.connect();try{
   if(pending)await saveAssistantMemory(client,ctx,{purpose:'cart_edit',queries:['stainless steel tap'],lineId:null,sourceVersion:0,observations:[],cartEdit:{description:source,understanding:{...empty,proposedEdits:[edit(s)]},targets:[{kind:'edit',index:0,candidateLineIds:[s.draft[1].id]}],selections:[]}});
   else await saveAssistantMemory(client,ctx,{purpose:'pending',queries:[s.draft[2].query!],lineId:s.draft[2].id,sourceVersion:0,observations:[]});
  }finally{client.release();}
  const runtime=new ConversationRuntime(pool,{name:'recorded-material-offline',mode:'mock',interpret:async input=>{calls++;return {output:understandingToInterpretation(pending?{...empty,cartTargetAnswer:{sourceText:answer,query:'stainless steel door latch',targetLineId:s.draft[2].id}}:{...empty,proposedEdits:[edit(s)]},input,false),usage:null,truncated:false};}},{visualOrdering:true,partialReviews:true});
  await inbox.ingest({id:randomUUID(),type:'text',text:pending?answer:source});await runtime.processNext(ctx);const result=await inbox.snapshot();
  assert.equal(result.requests.length,0);assert.equal(result.conversation.draft.length,3);assert.equal(calls,1);
  assert.equal(result.conversation.draft[2].query,'aluminium door latch 6 inch');assert.equal(result.conversation.draft[2].quantity,1);
  assert.deepEqual(result.conversation.draft.slice(0,2).map(l=>({id:l.id,query:l.query,quantity:l.quantity})),s.draft.slice(0,2).map(l=>({id:l.id,query:l.query,quantity:l.quantity})));
 }finally{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
});
