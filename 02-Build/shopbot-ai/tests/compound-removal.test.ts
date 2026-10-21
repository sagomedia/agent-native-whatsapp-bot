import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {FinishReason,type GenerateContentResponse} from '@google/genai';
import {understandingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';
import {GoogleInterpreter,type NativeSettings} from '../apps/server/src/adapters/google-interpreter.js';
import {positiveRemoval} from '../packages/contracts/intent-language.js';
import {sharedRemovalEvidence} from '../apps/server/src/services/cart-removal-evidence.js';
import {validateCurrentTurn} from '../apps/server/src/services/current-turn.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {initializeBudget} from '../apps/server/src/services/inference-budget.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {normalizeVoice,pcmWav} from '../apps/server/src/services/voice-media.js';
import type {ConversationState,DraftLine} from '../packages/contracts/index.js';

const speech='இல்லை இல்லை அந்த பெவிகால் டப்பாவும் 4 in ஸ்க்ரூ டப்பாவும் ரெண்டே எடுத்துருங்க வேண்டாம்';
function fixtureState():ConversationState {
 const line=(name:string,quantity:number|null=1):DraftLine=>({id:randomUUID(),query:name,name,quantity,resolution:'unavailable'});
 return {version:7,draft:[line('cutting blade'),line('drill machine'),{...line('screw box'),productMeasures:[{role:'size',unit:'inch',value:4}]},{...line('Fevicol adhesive',null),packSize:{unit:'ml',value:500}}],pending:null,fulfillment:'pickup',lastRequestId:null,replyLanguage:'ta',visualOrdering:true};
}
function proposal(s:ConversationState,transcript=speech){return {schemaVersion:2,inputKind:'audio',transcript,intents:['edit'],requestedItems:[],proposedEdits:[{kind:'remove_item' as const,targetLineId:s.draft[3].id,sourceText:'பெவிகால் டப்பாவும்',targetQuery:'Fevicol adhesive'},{kind:'remove_item' as const,targetLineId:s.draft[2].id,sourceText:'4 in ஸ்க்ரூ டப்பாவும்',targetQuery:'screw box'}],shopQuestions:[],unresolved:[]};}
const input=(state:ConversationState)=>({text:'current recording',state,audio:{mimeType:'audio/wav' as const,data:'AA==',durationSeconds:6}});

test('the captured compound provider response compiles two full-row removals with shared current evidence',()=>{
 const s=fixtureState(),before=structuredClone(s),result=understandingToInterpretation(proposal(s),input(s),false);
 assert.deepEqual(result.operations,[{kind:'remove_item',reference:s.draft[3].id,supportingPhrase:speech},{kind:'remove_item',reference:s.draft[2].id,supportingPhrase:speech}]);
 assert.deepEqual(validateCurrentTurn(result.operations,speech,s),result.operations);assert.deepEqual(s,before);assert.equal(result.deferredCartTargets,undefined);
 assert.equal(s.draft[3].quantity,null,'whole-row removal must not invent a count for the unpriced adhesive');
});

for(const text of ['போல்ட் எடுத்துருங்க வேண்டாம்','போல்ட் எடுத்துடுங்க வேண்டாம்','போல்ட் நீக்குங்க வேண்டாம்'])test(`an affirmative completed removal verb is not an infinitive negation: ${text}`,()=>assert.equal(positiveRemoval(text),true));
for(const text of ['போல்ட் எடுக்க வேண்டாம்','போல்ட் எடுத்துர வேண்டாம்','போல்ட் எடுத்துட வேண்டாம்','போல்ட் நீக்க வேண்டாம்','போல்ட் நீக்கிடவேண்டாம்','போல்ட் ரிமூவ் பண்ண வேண்டாம்'])test(`a true negated removal remains blocked: ${text}`,()=>assert.equal(positiveRemoval(text),false));

for(const ending of ['ரெண்டே எடுக்க வேண்டாம்','ரெண்டே ரிமூவ் பண்ண வேண்டாம்','ரெண்டே எடுத்துர வேண்டாம்','மூன்றையும் எடுத்துருங்க','or take both out','if available remove both'])test(`the shared predicate cannot authorize a conflicting or conditional group: ${ending}`,()=>{
 const s=fixtureState(),text='பெவிகால் டப்பாவும் 4 in ஸ்க்ரூ டப்பாவும் '+ending;
 assert.throws(()=>understandingToInterpretation(proposal(s,text),input(s),false),/positive current-message evidence|negates this cart mutation/);
});

test('an omitted third product, another action or a later separate clause cannot lend removal authority',()=>{
 const s=fixtureState();
 for(const text of ['பெவிகால் டப்பாவும் 4 in ஸ்க்ரூ டப்பாவும் drill machine எல்லாம் எடுத்துருங்க','keep பெவிகால் டப்பாவும் 4 in ஸ்க்ரூ டப்பாவும் ரெண்டே எடுத்துருங்க','பெவிகால் டப்பாவும் 4 in ஸ்க்ரூ டப்பாவும். drill machine வேண்டாம்'])assert.equal(sharedRemovalEvidence(proposal(s,text).proposedEdits,text).size,0);
});

test('reused targets and overlapping/repeated source spans cannot borrow a coordinated predicate',()=>{
 const s=fixtureState(),u=proposal(s),duplicate=structuredClone(u.proposedEdits);duplicate[1].targetLineId=duplicate[0].targetLineId;
 assert.equal(sharedRemovalEvidence(duplicate,speech).size,0);
 assert.equal(sharedRemovalEvidence(u.proposedEdits,speech+' பெவிகால் டப்பாவும்').size,0);
 assert.equal(sharedRemovalEvidence([u.proposedEdits[0]],speech).size,0);
});

test('shared removal evidence preserves individual identity and size checks and linked atomicity',()=>{
 const s=fixtureState(),u=proposal(s);u.proposedEdits[1].targetLineId=s.draft[1].id;
 const result=understandingToInterpretation(u,input(s),false);assert.deepEqual(result.operations,[]);assert.deepEqual(result.deferredCartTargets?.[0].candidateLineIds,[s.draft[2].id]);
 const conflicting=fixtureState();conflicting.draft[2].productMeasures=[{role:'size',unit:'inch',value:2}];assert.deepEqual(understandingToInterpretation(proposal(conflicting),input(conflicting),false).operations,[]);
});

test('a plain English coordinated group can share its verb without inventing one in each name span',()=>{
 for(const count of ['','both','two','2']){
  const s=fixtureState(),text=`please remove ${count} Fevicol adhesive and screw box`,u={...proposal(s,text),proposedEdits:[{kind:'remove_item',targetLineId:s.draft[3].id,sourceText:'Fevicol adhesive'},{kind:'remove_item',targetLineId:s.draft[2].id,sourceText:'screw box'}]};
  const result=understandingToInterpretation(u,input(s),false);assert.equal(result.operations.length,2);assert.ok(result.operations.every(op=>op.kind==='remove_item'&&op.supportingPhrase===text));
 }
});

test('a spoken group count can be written as a digit or either Tamil form without changing item quantities',()=>{
 for(const count of ['2','இரண்டு','ரெண்டு']){
  const s=fixtureState(),u=proposal(s,speech.replace('ரெண்டே',count)),result=understandingToInterpretation(u,input(s),false);
  assert.equal(result.operations.length,2);assert.ok(result.operations.every(op=>op.kind==='remove_item'));assert.equal(s.draft[3].quantity,null);
 }
});

for(const needsChoice of [false,true])test(`Google wire response and voice runtime remove both rows${needsChoice?' after resolving one target':''} and show only the remaining cart`,async()=>{
 const schema='compound_remove_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');const s=fixtureState(),id=randomUUID(),ctx={storeId:fixtureStore,conversationId:id,actor:'offline-compound-remove',role:'customer' as const};
  for(const [index,sku] of ['KEEP-BLADE','KEEP-DRILL'].entries()){
   await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases,selling_unit_verified) VALUES($1,$2,$3,'piece',1000,100,'[]',true)",[fixtureStore,sku,s.draft[index].name]);
   Object.assign(s.draft[index],{sku,unit:'piece',pricePaise:1000,productVersion:1,resolution:'matched'});
  }
  await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language,version,draft) VALUES($1,$2,$3,'ta',$4,$5)",[id,fixtureStore,ctx.actor,s.version,JSON.stringify(s.draft)]);
  const settings:NativeSettings={allowPaidInference:true,apiKey:'offline-only',model:'gemini-3.5-flash-lite',budgetMicrousd:5000000,allowMultimodal:true,unifiedUnderstanding:true};await initializeBudget(pool,ctx,settings.budgetMicrousd);
  let calls=0;const provider=new GoogleInterpreter(settings,{generateContent:async()=>{calls++;const value=proposal(s);if(needsChoice)value.proposedEdits[1].targetLineId=s.draft[1].id;return {modelVersion:settings.model,candidates:[{finishReason:FinishReason.STOP,content:{parts:[{text:JSON.stringify(value)}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:100,totalTokenCount:1100}} as GenerateContentResponse;}});
  const inbox=new SimulatorService(pool,ctx),runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true,visualOrdering:true}),mediaId=randomUUID(),pcm=Buffer.alloc(16000);
  for(let n=0;n<8000;n++)pcm.writeInt16LE(Math.round(Math.sin(n*.17)*1500),n*2);
  await inbox.ingest({id:mediaId,type:'voice',mediaId},await normalizeVoice({id:mediaId,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')}));await runtime.processNext(ctx);
  if(needsChoice){
   const pending=await inbox.snapshot();assert.deepEqual(pending.conversation.draft.map(row=>row.id),s.draft.map(row=>row.id),'both linked removals must wait');
   const choice=pending.messages.filter(message=>message.direction==='outbound').at(-1)?.rich?.buttons?.find(button=>button.event.type==='resolve_cart_target'&&button.event.lineId===s.draft[2].id)?.event;assert.ok(choice);
   await inbox.ingest(choice);await runtime.processNext(ctx);
  }
  const after=await inbox.snapshot();assert.equal(calls,1);assert.deepEqual(after.conversation.draft.map(row=>row.id),s.draft.slice(0,2).map(row=>row.id));assert.deepEqual(after.conversation.draft.map(row=>row.quantity),[1,1]);assert.equal(after.requests.length,0);
  const attempt=(await pool.query('SELECT state,validation_issues,response FROM provider_attempts WHERE conversation_id=$1',[id])).rows[0];assert.equal(attempt.state,'succeeded');assert.equal(attempt.validation_issues,null);assert.equal(attempt.response.operations.length,needsChoice?0:2);
  const reply=after.messages.filter(message=>message.direction==='outbound').at(-1)!;assert.doesNotMatch(reply.text,/கேட்டது:|பட்டியல் அப்படியே|எந்தப் பொருளை மாற்றணும்/);
  const cards=reply.rich?.parts?.flatMap(part=>part.cards??[])??reply.rich?.cards??[];
  assert.deepEqual(cards.flatMap(card=>'kind' in card&&card.kind==='product'?[card.lineId]:[]),s.draft.slice(0,2).map(row=>row.id));assert.match(reply.text,/\n2 items$/);assert.match(reply.text,/screw box/);assert.match(reply.text,/Fevicol adhesive/);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
