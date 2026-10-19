import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {FinishReason,type GenerateContentResponse,type GenerateContentParameters} from '@google/genai';
import {understandingToInterpretation,understandingPrompt} from '../apps/server/src/adapters/turn-understanding.js';
import {namedEditLines} from '../apps/server/src/adapters/mention-reconciliation.js';
import {GoogleInterpreter,type NativeSettings} from '../apps/server/src/adapters/google-interpreter.js';
import {positiveRemoval} from '../packages/contracts/intent-language.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {initializeBudget} from '../apps/server/src/services/inference-budget.js';
import {normalizeVoice,pcmWav} from '../apps/server/src/services/voice-media.js';
import type {ConversationState,DraftLine} from '../packages/contracts/index.js';
import type {TurnUnderstanding} from '../packages/contracts/understanding.js';
import type {AssistantMemory} from '../apps/server/src/services/agent-assistance.js';

// Recorded wording, with synthetic cart identities and no customer/media data.
const latin='Fevicol dappa Fevicol eduthurunga. Adhukku apram indha idhuvum drill machine-um venam. Screw dappa-vum venam. Screw dappa adhum venam.';
const tamil='அதானே சொன்னேனே அந்த ஃபெவிகால் டப்பா வேண்டாம், அதுக்கப்புறம் அந்த டிரில் மெஷினும் வேண்டாம், ஸ்க்ரூ டப்பாவும் வேண்டாம்.';
const row=(query:string):DraftLine=>({id:randomUUID(),query,name:query,quantity:1,resolution:'unavailable'});
function state():ConversationState{return {version:0,draft:[row('cutting blade'),row('drill machine'),{...row('screw box'),productMeasures:[{role:'size',unit:'inch',value:4}]},{...row('Fevicol adhesive'),packSize:{value:500,unit:'ml'}},row('screwdriver'),row('wire cutter'),row('pipe cutter')],pending:null,fulfillment:'pickup',lastRequestId:null,replyLanguage:'ta',visualOrdering:true};}
const empty={schemaVersion:2 as const,inputKind:'text' as const,intents:['edit' as const],requestedItems:[],proposedEdits:[],shopQuestions:[],unresolved:[]};
function proposal(s:ConversationState,transcript=latin):TurnUnderstanding{
 const phrases=transcript===latin?['Fevicol dappa Fevicol eduthurunga','drill machine-um venam','Screw dappa-vum venam']:['ஃபெவிகால் டப்பா வேண்டாம்','டிரில் மெஷினும் வேண்டாம்','ஸ்க்ரூ டப்பாவும் வேண்டாம்'];
 return {...empty,inputKind:'audio',transcript,proposedEdits:[3,1,2].map((index,n)=>({kind:'remove_item',targetLineId:s.draft[index].id,targetQuery:s.draft[index].query,sourceText:phrases[n]}))};
}
for(const source of ['Fevicol eduthurunga','Fevicol eduthudunga','Fevicol eduthidunga','Fevicol neekkunga','screw dappa venam'])test(`colloquial removal evidence: ${source}`,()=>assert.equal(positiveRemoval(source),true));
for(const source of ['Fevicol edukka vendam','Fevicol eduthura vendam','Fevicol eduthuda venam','Fevicol neekka vendam','Fevicol remove panna vendam'])test(`colloquial do-not-remove evidence stays blocked: ${source}`,()=>assert.equal(positiveRemoval(source),false));

test('a screw box cannot target a screwdriver through its screw alias',()=>{
 const s=state();s.draft[4].name='Taparia Screw Driver Set';
 for(const text of ['Screw dappa-vum venam','ஸ்க்ரூ டப்பாவும் வேண்டாம்','remove screws','make screw box three'])assert.deepEqual(namedEditLines(text,s).map(line=>line.id),[s.draft[2].id]);
 for(const text of ['remove screwdriver','ஸ்க்ரூ டிரைவர் வேண்டாம்'])assert.deepEqual(namedEditLines(text,s).map(line=>line.id),[s.draft[4].id]);
});
for(const transcript of [latin,tamil])test(`recorded three-product removal compiles without touching the screwdriver: ${transcript===latin?'Latin':'Tamil'}`,()=>{
 const s=state(),before=structuredClone(s),result=understandingToInterpretation(proposal(s,transcript),{text:'current audio',audio:{mimeType:'audio/wav',data:'AA==',durationSeconds:1},state:s},false);
 assert.deepEqual(result.operations.map(op=>op.kind==='remove_item'?op.reference:null),[s.draft[3].id,s.draft[1].id,s.draft[2].id]);assert.equal(result.deferredCartTargets,undefined);assert.deepEqual(s,before);
});
for(const kind of ['set_quantity','increment_quantity','decrement_quantity','replace'] as const)test(`screw/screwdriver identity is preserved for ${kind}`,()=>{
 const s=state();s.draft[2].quantity=4;
 const source=kind==='set_quantity'?'make screw box three':kind==='increment_quantity'?'add two more screw box':kind==='decrement_quantity'?'remove one screw box':'replace screw box with brass union';
 const u={...empty,proposedEdits:[{kind,targetLineId:s.draft[2].id,targetQuery:'screw box',sourceText:source,...(kind==='replace'?{query:'brass union'}:{quantity:kind==='set_quantity'?3:kind==='increment_quantity'?2:1})}]};
 const result=understandingToInterpretation(u,{text:source,state:s},false);assert.equal(result.operations.length,1);assert.equal(result.deferredCartTargets,undefined);
 const op=result.operations[0];assert.equal('reference' in op?op.reference:'lineId' in op?op.lineId:null,s.draft[2].id);
});

test('coordinated Latin Tamil removal uses the shared verb without inventing a count',()=>{
 const s=state(),source='Fevicol-um screw box-um rendaiyum eduthurunga vendam',u={...empty,proposedEdits:[{kind:'remove_item',targetLineId:s.draft[3].id,targetQuery:'Fevicol adhesive',sourceText:'Fevicol-um'},{kind:'remove_item',targetLineId:s.draft[2].id,targetQuery:'screw box',sourceText:'screw box-um'}]};
 const result=understandingToInterpretation(u,{text:source,state:s},false);assert.deepEqual(result.operations.map(op=>op.kind==='remove_item'?op.reference:null),[s.draft[3].id,s.draft[2].id]);
});

test('a model-selected screwdriver ID cannot override a named screw-box target',()=>{
 const s=state(),source='screw box venam',result=understandingToInterpretation({...empty,proposedEdits:[{kind:'remove_item',targetLineId:s.draft[4].id,targetQuery:'screw box',sourceText:source}]},{text:source,state:s},false);
 assert.deepEqual(result.operations,[]);assert.deepEqual(result.deferredCartTargets?.[0].candidateLineIds,[s.draft[2].id]);
});

test('a normalized screwdriver target cannot override screw evidence when no screw row exists',()=>{
 const s=state();s.draft=[s.draft[4]];const source='screw dappa venam';
 const result=understandingToInterpretation({...empty,proposedEdits:[{kind:'remove_item',targetLineId:s.draft[0].id,targetQuery:'screwdriver',sourceText:source}]},{text:source,state:s},false);assert.deepEqual(result.operations,[]);assert.ok(result.deferredCartTargets?.length);
});

test('prompt exposes the current saved operation and candidates; stale goals stay absent',()=>{
 const s=state(),u=proposal(s),memory:AssistantMemory={id:randomUUID(),purpose:'cart_edit',queries:['screw box'],lineId:null,sourceVersion:s.version,observations:[],cartEdit:{description:latin,understanding:u,targets:[{kind:'edit',index:2,candidateLineIds:[s.draft[2].id,s.draft[4].id]}],selections:[]}};
 const prompt=JSON.parse(understandingPrompt({text:'screw box',state:s,assistantMemory:memory}));
 assert.deepEqual(prompt.pendingCartEdit.proposedEdits,u.proposedEdits);assert.deepEqual(prompt.pendingCartEdit.targets,memory.cartEdit!.targets);assert.equal(prompt.pendingCartEdit.description,latin);
 assert.equal(JSON.parse(understandingPrompt({text:'screw box',state:{...s,version:1},assistantMemory:memory})).pendingCartEdit,undefined);
});
const settings:NativeSettings={allowPaidInference:true,apiKey:'offline-only',model:'gemini-3.5-flash-lite',budgetMicrousd:5000000,allowMultimodal:true,unifiedUnderstanding:true};
const response=(value:unknown):GenerateContentResponse=>({modelVersion:settings.model,candidates:[{finishReason:FinishReason.STOP,content:{parts:[{text:typeof value==='string'?value:JSON.stringify(value)}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:100,totalTokenCount:1100}} as GenerateContentResponse);
async function fixture(run:(pool:pg.Pool,inbox:SimulatorService,runtime:ConversationRuntime,s:ConversationState,requests:GenerateContentParameters[])=>Promise<void>,generate:(s:ConversationState,n:number)=>unknown){
 const schema='crud_language_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');const id=randomUUID(),ctx={storeId:fixtureStore,conversationId:id,actor:'synthetic-crud',role:'customer' as const},s=state();
  await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language,draft) VALUES($1,$2,$3,'ta',$4::jsonb)",[id,fixtureStore,ctx.actor,JSON.stringify(s.draft)]);await initializeBudget(pool,ctx,settings.budgetMicrousd);
  const requests:GenerateContentParameters[]=[],provider=new GoogleInterpreter(settings,{generateContent:async request=>{requests.push(request);return response(generate(s,requests.length));}}),inbox=new SimulatorService(pool,ctx),runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true,visualOrdering:true});
  await run(pool,inbox,runtime,s,requests);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
async function voice(inbox:SimulatorService,runtime:ConversationRuntime){const id=randomUUID(),pcm=Buffer.alloc(16000);for(let n=0;n<8000;n++)pcm.writeInt16LE(Math.round(Math.sin(n*.17)*1500),n*2);await inbox.ingest({id,type:'voice',mediaId:id},await normalizeVoice({id,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')}));await runtime.processNext(inbox.context);return inbox.snapshot();}
for(const transcript of [latin,tamil])test(`full Google-adapter voice flow executes all three removals atomically: ${transcript===latin?'Latin':'Tamil'}`,()=>fixture(async(pool,inbox,runtime,s,requests)=>{
 const after=await voice(inbox,runtime);assert.equal(requests.length,1);assert.deepEqual(after.conversation.draft.map(line=>line.id),[0,4,5,6].map(index=>s.draft[index].id));assert.equal(after.requests.length,0);
 const calls=(await pool.query("SELECT result FROM tool_receipts WHERE conversation_id=$1 AND tool_name='apply_draft_changes'",[inbox.context.conversationId])).rows;assert.equal(calls.length,1);assert.equal(calls[0].result.state.draft.length,4);
 assert.doesNotMatch(after.messages.filter(m=>m.direction==='outbound').at(-1)!.text,/கேட்டது:|எந்த item|பட்டியல் அப்படியே/);
},s=>proposal(s,transcript)));

for(const repaired of [true,false])test(`evidence repair is metered, transcript-only, bounded and ${repaired?'executes only the corrected plan':'leaves the entire cart unchanged after a second failure'}`,()=>fixture(async(pool,inbox,runtime,s,requests)=>{
 const after=await voice(inbox,runtime);assert.equal(requests.length,2);
 const attempts=(await pool.query('SELECT stage,state FROM provider_attempts WHERE conversation_id=$1 ORDER BY created_at',[inbox.context.conversationId])).rows;assert.deepEqual(attempts.map(a=>a.stage),['identify','repair']);assert.deepEqual(attempts.map(a=>a.state),['failed',repaired?'succeeded':'failed']);
 const second=JSON.stringify(requests[1]);assert.doesNotMatch(second,/inlineData/);assert.match(second,/Repair the rejected proposal/);assert.match(second,/Removal needs explicit current intent/);
 assert.deepEqual(after.conversation.draft.map(line=>line.id),(repaired?[0,4,5,6]:[0,1,2,3,4,5,6]).map(index=>s.draft[index].id));assert.equal(after.requests.length,0);
 const mutations=Number((await pool.query("SELECT count(*) FROM tool_receipts WHERE conversation_id=$1 AND tool_name='apply_draft_changes'",[inbox.context.conversationId])).rows[0].count);assert.equal(mutations,repaired?1:0);
 assert.ok(after.messages.find(m=>m.direction==='inbound'&&m.text===latin),'the original transcript remains stored');
},(s,n)=>{const u=proposal(s);if(n===1||!repaired)u.proposedEdits[0].sourceText='Fevicol dappa Fevicol';if(n>1){u.inputKind='text';delete u.transcript;}return u;}));

test('malformed provider JSON keeps safe failure handling',async()=>{
 const provider=new GoogleInterpreter(settings,{generateContent:async()=>response('{invalid json')});
 const result=await provider.interpret({text:'remove screw box',state:state()},new AbortController().signal);assert.equal(result.output,null);assert.equal(result.evidenceRepair,undefined);assert.equal(result.validationIssues?.[0].code,'invalid_evidence');
});

test('a failed repair preserves the original transcript and safe clarification',()=>fixture(async(pool,inbox,runtime,s,requests)=>{
 const after=await voice(inbox,runtime);assert.equal(requests.length,2);assert.deepEqual(after.conversation.draft.map(line=>line.id),s.draft.map(line=>line.id));assert.equal(after.requests.length,0);
 const reply=after.messages.filter(m=>m.direction==='outbound').at(-1)!;assert.notEqual(reply.rich?.stage,'error');assert.match(reply.text,/Fevicol dappa/);
 const attempts=(await pool.query('SELECT state FROM provider_attempts WHERE conversation_id=$1 ORDER BY created_at',[inbox.context.conversationId])).rows;assert.deepEqual(attempts.map(a=>a.state),['failed','failed']);
},(s,n)=>{if(n>1)throw new Error('synthetic provider failure');const u=proposal(s);u.proposedEdits[0].sourceText='Fevicol dappa Fevicol';return u;}));
