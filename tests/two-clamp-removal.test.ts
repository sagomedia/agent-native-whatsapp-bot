import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {FinishReason,type GenerateContentResponse} from '@google/genai';
import {GoogleInterpreter,type NativeSettings} from '../apps/server/src/adapters/google-interpreter.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {initializeBudget} from '../apps/server/src/services/inference-budget.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {sharedRemovalEvidence} from '../apps/server/src/services/cart-removal-evidence.js';
import {normalizeVoice,pcmWav} from '../apps/server/src/services/voice-media.js';
import type {DraftLine} from '../packages/contracts/index.js';

test('recorded Tamil instruction removes both named clamps atomically and keeps other items',async()=>{
 const schema='two_clamps_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');const line=(name:string,quantity:number|null):DraftLine=>({id:randomUUID(),name,query:name,quantity,resolution:'unavailable'});
  const draft=[line('tape',2),line('T clamp',1),{...line('L angle clamp',null),productMeasures:[{role:'size' as const,value:1,unit:'inch'}]},line('screw box',1)];
  const id=randomUUID(),ctx={storeId:fixtureStore,conversationId:id,actor:'clamp-fixture',role:'customer' as const};
  await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language,version,draft) VALUES($1,$2,$3,'ta',1,$4)",[id,fixtureStore,ctx.actor,JSON.stringify(draft)]);
  const text='அந்த டீ கிளாம்ப்பையும் ஒரு இன்ச் எல் ஆங்கிள் கிளாம்ப்பையும் ரிமூவ் பண்ணிருங்க.';
  const proposal={schemaVersion:2,inputKind:'audio',transcript:text,intents:['edit'],requestedItems:[],proposedEdits:[{kind:'remove_item',targetLineId:draft[1].id,sourceText:'டீ கிளாம்ப்பையும்',targetQuery:'T clamp'},{kind:'remove_item',targetLineId:draft[2].id,sourceText:'ஒரு இன்ச் எல் ஆங்கிள் கிளாம்ப்பையும்',targetQuery:'L angle clamp'}],shopQuestions:[],unresolved:[]};
  const settings:NativeSettings={allowPaidInference:true,apiKey:'offline-only',model:'gemini-3.5-flash-lite',budgetMicrousd:5000000,allowMultimodal:true,unifiedUnderstanding:true};await initializeBudget(pool,ctx,settings.budgetMicrousd);
  let calls=0;const provider=new GoogleInterpreter(settings,{generateContent:async()=>{calls++;return {modelVersion:settings.model,candidates:[{finishReason:FinishReason.STOP,content:{parts:[{text:JSON.stringify(proposal)}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:100,totalTokenCount:1100}} as GenerateContentResponse;}});
  const inbox=new SimulatorService(pool,ctx),runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true,visualOrdering:true}),mediaId=randomUUID(),pcm=Buffer.alloc(16000);
  for(let n=0;n<8000;n++)pcm.writeInt16LE(Math.round(Math.sin(n*.17)*1500),n*2);
  await inbox.ingest({id:mediaId,type:'voice',mediaId},await normalizeVoice({id:mediaId,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')}));assert.equal(await runtime.processNext(ctx),true);
  let s=await inbox.snapshot();const reply=s.messages.filter(m=>m.direction==='outbound').at(-1)?.rich;
  const target=reply?.parts?.flatMap(p=>p.cards.flatMap(c=>c.buttons??[])).find(b=>b.event.type==='resolve_cart_target')?.event??reply?.buttons?.find(b=>b.event.type==='resolve_cart_target')?.event;
  if(target){assert.deepEqual(s.conversation.draft.map(l=>l.id),draft.map(l=>l.id),'both removals wait for resolution');await inbox.ingest(target);assert.equal(await runtime.processNext(ctx),true);s=await inbox.snapshot();}
  assert.deepEqual(s.conversation.draft.map(l=>l.id),[draft[0].id,draft[3].id]);assert.deepEqual(s.conversation.draft.map(l=>l.quantity),[2,1]);assert.equal(s.requests.length,0);assert.equal(calls,1);
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});

test('negated two-clamp removal does not grant shared removal evidence',()=>{
 const text='அந்த டீ கிளாம்ப்பையும் ஒரு இன்ச் எல் ஆங்கிள் கிளாம்ப்பையும் ரிமூவ் பண்ண வேண்டாம்.';
 const edits=[{kind:'remove_item' as const,targetLineId:randomUUID(),sourceText:'டீ கிளாம்ப்பையும்'},{kind:'remove_item' as const,targetLineId:randomUUID(),sourceText:'ஒரு இன்ச் எல் ஆங்கிள் கிளாம்ப்பையும்'}];
 assert.equal(sharedRemovalEvidence(edits,text).size,0);
});
