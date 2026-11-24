import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {FinishReason,GenerateContentResponse} from '@google/genai';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import {GoogleInterpreter} from '../apps/server/src/adapters/google-interpreter.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {geminiTextRate,initializeBudget} from '../apps/server/src/services/inference-budget.js';
import {pcmWav} from '../apps/server/src/services/voice-media.js';

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>) {
  const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const schema='timing_'+randomUUID().replaceAll('-','');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
  try {
    await setupDatabase(pool,'mock');
    await setupImageDemo(pool);
    const id=randomUUID();
    await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language) VALUES($1,$2,'timing-test','en')",[id,demoCatalogStore]);
    await run(pool,new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'timing-test',role:'customer'}));
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}

// Advance inference time without waiting in real time or mocking pg timers.
// Abort signals fire at their actual requested deadlines, so this test would
// reject a 25-second reply if the runtime still imposed its old 20-second cap.
function inferenceClock(t:TestContext) {
  let now=Date.now();
  const timers:{ms:number;at:number;controller:AbortController}[]=[];
  t.mock.method(Date,'now',()=>now);
  t.mock.method(AbortSignal,'timeout',(ms:number)=>{
    const controller=new AbortController();
    timers.push({ms,at:now+ms,controller});
    return controller.signal;
  });
  return {timers,advance(ms:number){now+=ms;for(const timer of timers)if(now>=timer.at)timer.controller.abort(new DOMException('Timed out','TimeoutError'));}};
}

async function voice(inbox:SimulatorService) {
  const id=randomUUID(),pcm=Buffer.alloc(32000);
  for(let n=0;n<16000;n++)pcm.writeInt16LE(Math.round(1200*Math.sin(n/10)),n*2);
  const audio=pcmWav(pcm);
  await inbox.ingest({id,type:'voice',mediaId:id},{audio,durationSeconds:1,sourceHash:'synthetic-timing-audio'});
  return id;
}

test('a 25-second audio reply succeeds with a 45-second call and a 135-second lease',t=>fixture(async(pool,inbox)=>{
  const clock=inferenceClock(t);
  const provider:Interpreter={name:'slow-offline-audio',mode:'mock',supportsAudio:true,unifiedUnderstanding:true,interpret:async(_input,signal)=>{
    const lease=(await pool.query("SELECT extract(epoch FROM lease_until-now()) AS seconds FROM messages WHERE status='processing'")).rows[0];
    assert.ok(Number(lease.seconds)>130);
    clock.advance(25000);
    signal.throwIfAborted();
    return {output:{operations:[{kind:'add_item',query:'H19',quantity:1,supportingPhrase:'one pipe cutter'}],next:'review',transcript:'one pipe cutter'},usage:null,truncated:false};
  }};
  const id=await voice(inbox);
  const runtime=new ConversationRuntime(pool,provider,{visualOrdering:true});
  await runtime.processNext(inbox.context);
  const snapshot=await inbox.snapshot();
  assert.deepEqual(clock.timers.map(timer=>timer.ms),[45000]);
  assert.equal(snapshot.conversation.draft[0].sku,'H19');
  assert.equal(snapshot.conversation.draft[0].quantity,1);
  assert.equal(snapshot.requests.length,0);
  assert.equal((await pool.query('SELECT state FROM provider_attempts WHERE message_id=$1',[id])).rows[0].state,'succeeded');
}));

test('an audio timeout keeps its unknown paid reservation and makes no shopping changes',t=>fixture(async(pool,inbox)=>{
  const clock=inferenceClock(t);
  await initializeBudget(pool,inbox.context,1000000);
  let calls=0;
  // Live mode exercises accounting only: this provider has no network transport.
  const provider:Interpreter={name:'offline-paid-timeout',mode:'live',billing:geminiTextRate,supportsAudio:true,unifiedUnderstanding:true,interpret:async()=>{
    calls++;
    await Promise.resolve();
    clock.advance(46000);
    return new Promise(()=>{});
  }};
  const id=await voice(inbox);
  const runtime=new ConversationRuntime(pool,provider,{visualOrdering:true,allowPaidInference:true});
  await runtime.processNext(inbox.context);
  const snapshot=await inbox.snapshot();
  assert.equal(calls,1);
  assert.deepEqual(snapshot.conversation.draft,[]);
  assert.equal(snapshot.requests.length,0);
  assert.equal(snapshot.messages.at(-1)!.rich!.stage,'error');
  const attempt=(await pool.query('SELECT state,billing_state,reserved_microusd,failure_code FROM provider_attempts WHERE message_id=$1',[id])).rows[0];
  assert.equal(attempt.state,'failed');
  assert.equal(attempt.billing_state,'unknown');
  assert.equal(attempt.failure_code,'provider_timeout');
  const budget=(await pool.query('SELECT held_microusd,committed_microusd FROM inference_budgets WHERE store_id=$1',[inbox.context.storeId])).rows[0];
  assert.ok(Number(budget.held_microusd)>0);
  assert.equal(Number(budget.held_microusd),Number(attempt.reserved_microusd));
  assert.equal(Number(budget.committed_microusd),0);
  assert.equal(await runtime.processNext(inbox.context),false);
  assert.equal(calls,1);
}));

test('three inference stages share one deadline and cannot apply a late result',t=>fixture(async(pool,inbox)=>{
  const clock=inferenceClock(t);
  const provider:Interpreter={name:'offline-three-stages',mode:'mock',supportsAudio:true,interpret:async(input,signal)=>{
    await Promise.resolve();
    clock.advance(input.stage==='recommend'?40001:40000);
    signal.throwIfAborted();
    return {output:input.stage==='recognize'
      ?{transcript:'Show me a pipe cutter',operations:[],next:'continue'}
      :{operations:[],next:'assist',assistance:{queries:['pipe cutter'],rootQuery:'pipe cutter'}},usage:null,truncated:false};
  }};
  await voice(inbox);
  await new ConversationRuntime(pool,provider,{visualOrdering:true,mediaRecommendations:true}).processNext(inbox.context);
  const snapshot=await inbox.snapshot();
  assert.deepEqual(clock.timers.map(timer=>timer.ms),[45000,45000,40000]);
  assert.deepEqual(snapshot.conversation.draft,[]);
  assert.equal(snapshot.requests.length,0);
  assert.equal(snapshot.messages.at(-1)!.rich!.clarificationReason,'turn_deadline');
  const writes=await pool.query('SELECT tool_name FROM tool_receipts WHERE tool_name=ANY($1::text[])',[['apply_draft_changes','confirm_product_choices','preview_order','submit_order_request','request_store_assistance']]);
  assert.equal(writes.rowCount,0);
}));

test('a worker with an expired lease cannot save shopping effects or a reply',()=>fixture(async(pool,inbox)=>{
  const provider:Interpreter={name:'offline-expired-lease',mode:'mock',interpret:async()=>{
    await pool.query("UPDATE messages SET lease_until=now()-interval '1 second' WHERE status='processing'");
    return {output:{operations:[{kind:'add_item',query:'H19',quantity:1}],next:'review'},usage:null,truncated:false};
  }};
  await inbox.ingest({id:randomUUID(),type:'text',text:'one pipe cutter'});
  await new ConversationRuntime(pool,provider,{visualOrdering:true}).processNext(inbox.context);
  const snapshot=await inbox.snapshot();
  assert.deepEqual(snapshot.conversation.draft,[]);
  assert.equal(snapshot.requests.length,0);
  assert.equal(snapshot.messages.filter(message=>message.direction==='outbound').length,0);
  const writes=await pool.query('SELECT tool_name FROM tool_receipts WHERE tool_name=ANY($1::text[])',[['apply_draft_changes','confirm_product_choices','preview_order','submit_order_request','request_store_assistance']]);
  assert.equal(writes.rowCount,0);
}));

test('Google audio requests use a 44-second SDK timeout and one transport attempt',()=>fixture(async(_pool,inbox)=>{
  const provider=new GoogleInterpreter({apiKey:'offline-placeholder',model:geminiTextRate.model,allowPaidInference:false,budgetMicrousd:0,freeQuota:{scope:'timing-sdk-test',model:geminiTextRate.model}},{generateContent:async params=>{
    assert.equal(params.config?.httpOptions?.timeout,44000);
    assert.equal(params.config?.httpOptions?.retryOptions?.attempts,1);
    return Object.assign(new GenerateContentResponse(),{candidates:[{finishReason:FinishReason.STOP,content:{parts:[{text:JSON.stringify({transcript:'one pipe cutter'})}]}}],modelVersion:geminiTextRate.model});
  }});
  await provider.interpret({text:'Transcribe the recording',stage:'recognize',state:(await inbox.snapshot()).conversation,audio:{mimeType:'audio/wav',data:pcmWav(Buffer.alloc(32000)).toString('base64'),durationSeconds:1}},new AbortController().signal);
}));
