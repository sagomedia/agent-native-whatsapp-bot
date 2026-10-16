import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {type GenerateContentParameters,type GenerateContentResponse} from '@google/genai';
import {admitRequest,inputAdmissionLimits} from '../apps/server/src/services/inference-admission.js';
import {geminiTextRate,rateHealth,validateRateCard,initializeBudget,worstCaseReservation,reserveAttempt,settleAttempt} from '../apps/server/src/services/inference-budget.js';
import {GoogleInterpreter,readNativeSettings} from '../apps/server/src/adapters/google-interpreter.js';
import {GoogleCatalogGenerator,catalogGenerationRate,generateCatalogDraft} from '../apps/server/src/services/catalog-assistant.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {withConversation} from '../apps/server/src/services/context.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import {fixtureStore,fixtureConversation} from '../profiles/hardware.js';

const settings={allowPaidInference:true,apiKey:'offline-only',model:geminiTextRate.model,budgetMicrousd:5000000};
const state={version:0,draft:[],pending:null,fulfillment:'pickup' as const,lastRequestId:null};
const request=(text='hello'):GenerateContentParameters=>({model:geminiTextRate.model,contents:text,config:{systemInstruction:'bounded instructions',responseJsonSchema:{type:'object'},maxOutputTokens:4096}});
async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='admission_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');await run(pool,new SimulatorService(pool));}finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}

test('admission includes instructions, response schema and UTF-8 bytes, with a stable transport hash',()=>{
 const r=request('தமிழ்');const a=admitRequest(r);
 assert.equal(a.textBytes,Buffer.byteLength(JSON.stringify(r)));assert.ok(a.textBytes>JSON.stringify(r).length);
 assert.equal(admitRequest({...r,config:{...r.config,abortSignal:new AbortController().signal,httpOptions:{timeout:100}}}).requestHash,a.requestHash);
 assert.notEqual(admitRequest({...r,config:{...r.config,systemInstruction:'changed'}}).requestHash,a.requestHash);
 assert.throws(()=>admitRequest({...r,config:{...r.config,responseJsonSchema:{description:'x'.repeat(inputAdmissionLimits.textBytes)}}}),/including instructions and schema/);
});

test('multimodal bytes and every output ceiling are checked before reservation',()=>{
 for(const [mimeType,cap] of [['image/jpeg',inputAdmissionLimits.imageBytes],['audio/wav',inputAdmissionLimits.audioBytes]] as const){
  const r={...request(),contents:[{parts:[{inlineData:{mimeType,data:Buffer.alloc(cap).toString('base64')}}]}]};
  assert.equal(admitRequest(r).mediaBytes,cap);
  assert.throws(()=>admitRequest({...r,contents:[{parts:[{inlineData:{mimeType,data:Buffer.alloc(cap+1).toString('base64')}}]}]}),/too large/);
 }
 for(const maxOutputTokens of [0,-1,1.5,16385])assert.throws(()=>admitRequest({...request(),config:{maxOutputTokens}}));
 assert.equal(admitRequest({...request(),config:{maxOutputTokens:16384}}).maxOutputTokens,16384);
});

test('rate health warns seven days before expiry, stops without grace, and rejects malformed/future evidence',()=>{
 assert.equal(rateHealth(geminiTextRate,Date.parse('2026-10-15')).status,'fresh');
 assert.equal(rateHealth(geminiTextRate,Date.parse('2026-10-25')).status,'expiring');
 assert.equal(rateHealth(geminiTextRate,Date.parse('2026-10-31T23:59:59.999Z')).status,'expiring');
 assert.equal(rateHealth(geminiTextRate,Date.parse('2026-11-01')).status,'expired');
 assert.throws(()=>validateRateCard(geminiTextRate,Date.parse('2026-11-01')),/expired/);
 for(const change of [{verifiedOn:'2026-10-16'},{verifiedOn:'2026-02-30'},{source:'https://example.test/unreviewed'},{validUntil:'2027-12-31'},{inputMicrousdPerMillion:NaN},{maxOutputTokens:16385}])assert.equal(rateHealth({...geminiTextRate,...change},Date.parse('2026-10-15')).status,'invalid');
});

test('configured unified 16K output limits stay bounded and each adapter admits the actual request',async()=>{
 let captured:GenerateContentParameters|undefined;
 const provider=new GoogleInterpreter({...settings,unifiedUnderstanding:true,maxOutputTokens:16384},{generateContent:async r=>{captured=r;return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({schemaVersion:2,inputKind:'text',intents:['browse'],requestedItems:[],proposedEdits:[],shopQuestions:[],unresolved:[]})}]}}]} as GenerateContentResponse;}});
 const prepared=provider.prepareInput({text:'show me tools',state});await prepared.interpret(new AbortController().signal);
 assert.equal(prepared.admission.requestHash,admitRequest(captured!).requestHash);assert.equal(prepared.admission.maxOutputTokens,16384);
 assert.equal(prepared.admission.reservationBasis,'model_context_limit');assert.equal(provider.billing.inputTokenLimit,1048576);
 const env=readNativeSettings({ALLOW_PAID_INFERENCE:'true',AI_BUDGET_USD:'1',GEMINI_API_KEY:'offline-only',AI_MODEL:geminiTextRate.model,GEMINI_UNIFIED_UNDERSTANDING_ENABLED:'true'});
 assert.equal(env!.maxOutputTokens,16384);assert.equal(rateHealth(new GoogleInterpreter(env!).billing).status,'fresh');
 const generator=new GoogleCatalogGenerator('offline-only',{generateContent:async()=>{throw new Error('must not call');}});
 assert.throws(()=>generator.prepareInput({description:'x'.repeat(65536),nodes:[]}),/including instructions and schema/);
 assert.equal(catalogGenerationRate.inputTokenLimit,geminiTextRate.inputTokenLimit);
});

test('runtime persists the admitted wire hash, and duplicate usage settlement cannot spend twice',()=>fixture(async(pool,inbox)=>{
 await initializeBudget(pool,inbox.context,5000000);let captured:GenerateContentParameters|undefined,calls=0;
 const provider=new GoogleInterpreter(settings,{generateContent:async r=>{captured=r;calls++;return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({operations:[{kind:'add_item',query:'PTFE-TAPE',quantity:3}],next:'review'})}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:100,thoughtsTokenCount:20,totalTokenCount:1120}} as GenerateContentResponse;}});
 const id=randomUUID();await inbox.ingest({id,type:'text',text:'I need three PTFE tape rolls'});
 const runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true});await runtime.processNext(inbox.context);
 assert.equal(calls,1);const row=(await pool.query('SELECT * FROM provider_attempts WHERE message_id=$1',[id])).rows[0];
 assert.equal(row.input_admission.requestHash,admitRequest(captured!).requestHash);assert.equal(Number(row.reserved_microusd),worstCaseReservation(provider.billing));
 assert.equal(row.billing_state,'estimated');
 const before=(await pool.query('SELECT * FROM inference_budgets')).rows[0];
 await Promise.all([settleAttempt(pool,inbox.context,row.id),settleAttempt(pool,inbox.context,row.id)]);
 assert.deepEqual((await pool.query('SELECT * FROM inference_budgets')).rows[0],before);assert.equal(await runtime.processNext(inbox.context),false);
}));

test('oversized prepared input creates no paid attempt and leaves the existing draft and budget intact',()=>fixture(async(pool,inbox)=>{
 await initializeBudget(pool,inbox.context,5000000);let calls=0;
 const provider:Interpreter={name:'offline-bounded-request',mode:'live',billing:geminiTextRate,prepareInput(){return {admission:admitRequest(request('x'.repeat(65536))),interpret:async()=>{throw new Error('unreachable');}};},interpret:async()=>{calls++;throw new Error('unreachable');}};
 const before=(await inbox.snapshot()).conversation;await inbox.ingest({id:randomUUID(),type:'text',text:'Please find the tools I need'});
 await new ConversationRuntime(pool,provider,{allowPaidInference:true}).processNext(inbox.context);
 assert.equal(calls,0);assert.equal((await pool.query('SELECT * FROM provider_attempts')).rowCount,0);
 assert.deepEqual((await inbox.snapshot()).conversation.draft,before.draft);
 assert.equal((await pool.query('SELECT held_microusd FROM inference_budgets')).rows[0].held_microusd,'0');
}));

test('reclaiming an expired message preserves its original deadline and starts no new inference',()=>fixture(async(pool,inbox)=>{
 let calls=0;const provider:Interpreter={name:'offline-deadline',mode:'mock',interpret:async()=>{calls++;return {output:{operations:[],next:'continue'},usage:null,truncated:false};}};
 const id=randomUUID(),deadline=new Date(Date.now()-1000);await inbox.ingest({id,type:'text',text:'Find a pipe cutter for me'});
 await pool.query("UPDATE messages SET status='processing',lease_until=now()-interval '1 second',claim_token=$2,inference_deadline_at=$3 WHERE id=$1",[id,randomUUID(),deadline]);
 await new ConversationRuntime(pool,provider).processNext(inbox.context);
 assert.equal(calls,0);assert.equal(new Date((await pool.query('SELECT inference_deadline_at FROM messages WHERE id=$1',[id])).rows[0].inference_deadline_at).getTime(),deadline.getTime());
 assert.equal((await inbox.snapshot()).messages.at(-1)!.rich!.clarificationReason,'turn_deadline');
 assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,0);
}));

test('expired rate evidence allows deterministic service startup and retains unknown paid holds',t=>fixture(async(pool,inbox)=>{
 await initializeBudget(pool,inbox.context,5000000);
 const id=randomUUID();await inbox.ingest({id,type:'text',text:'unsettled earlier call'});
 const provider=new GoogleInterpreter(settings,{generateContent:async()=>{throw new Error('no provider calls');}});
 await withConversation(pool,inbox.context,async client=>{await reserveAttempt(client,inbox.context,id,0,provider);});
 const before=(await pool.query('SELECT * FROM inference_budgets')).rows[0];
 t.mock.method(Date,'now',()=>Date.parse('2026-11-01T00:00:00Z'));
 const afterExpiry=new GoogleInterpreter(settings,{generateContent:async()=>{throw new Error('no provider calls');}});
 const runtime=new ConversationRuntime(pool,afterExpiry,{allowPaidInference:true});
 assert.throws(()=>afterExpiry.prepareInput({text:'new paid request',state}),/expired/);
 await pool.query("UPDATE messages SET status='processed' WHERE id=$1",[id]);
 await inbox.ingest({id:randomUUID(),type:'text',text:'hello'});await runtime.processNext(inbox.context);
 assert.ok((await inbox.snapshot()).messages.some(m=>m.direction==='outbound'));
 assert.deepEqual((await pool.query('SELECT * FROM inference_budgets')).rows[0],before);
}));

test('catalog generation that ignores abort still times out and preserves its unknown paid hold',t=>fixture(async(pool,inbox)=>{
 await initializeBudget(pool,inbox.context,5000000);
 t.mock.method(AbortSignal,'timeout',()=>{const controller=new AbortController();setImmediate(()=>controller.abort());return controller.signal;});
 const id=randomUUID();
 await assert.rejects(generateCatalogDraft(pool,fixtureStore,id,{description:'synthetic label',nodes:[]},{mode:'live',generate:async()=>new Promise(()=>{})}),/reliable details/);
 const row=(await pool.query('SELECT state,billing_state,reserved_microusd FROM catalog_suggestions WHERE id=$1',[id])).rows[0];
 assert.equal(row.state,'unknown');assert.equal(row.billing_state,'unknown');
 assert.equal((await pool.query('SELECT held_microusd FROM inference_budgets')).rows[0].held_microusd,row.reserved_microusd);
 assert.equal(Number(row.reserved_microusd),worstCaseReservation(catalogGenerationRate));
}));

test('conversation transactions have bounded statement and lock waits',()=>fixture(async(pool,inbox)=>{
 await withConversation(pool,inbox.context,async client=>{
  assert.equal((await client.query('SHOW statement_timeout')).rows[0].statement_timeout,'15s');
  assert.equal((await client.query('SHOW lock_timeout')).rows[0].lock_timeout,'5s');
 });
 assert.equal((await pool.query('SHOW statement_timeout')).rows[0].statement_timeout,'0');
}));

test('expiry during outbox work rolls back draft changes and queues only the retained-list reply',t=>fixture(async(pool,inbox)=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const id=randomUUID();await inbox.ingest({id,type:'text',text:'three PTFE tape rolls'});
 const provider:Interpreter={name:'offline-late-render',mode:'mock',interpret:async()=>({output:{operations:[{kind:'add_item',query:'PTFE-TAPE',quantity:3}],next:'review'},usage:null,truncated:false})};
 await new ConversationRuntime(pool,provider,{queueReply:async()=>{now+=121000;}}).processNext(inbox.context);
 const snapshot=await inbox.snapshot();assert.deepEqual(snapshot.conversation.draft,[]);
 const replies=snapshot.messages.filter(m=>m.direction==='outbound');assert.equal(replies.length,1);assert.equal(replies[0].rich!.clarificationReason,'turn_deadline');
 assert.equal((await pool.query("SELECT * FROM tool_receipts WHERE tool_name='apply_draft_changes'")).rowCount,0);
 assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,0);
 assert.equal((await pool.query('SELECT state FROM provider_attempts')).rows[0].state,'succeeded');
}));

test('additive v26 to current upgrade preserves prior requests, statuses, rate snapshots and unknown budget holds',()=>fixture(async(pool,inbox)=>{
 await initializeBudget(pool,inbox.context,5000000);const id=randomUUID();await inbox.ingest({id,type:'text',text:'old unknown request'});
 const provider:Interpreter={name:'offline-upgrade',mode:'live',billing:geminiTextRate,interpret:async()=>{throw new Error('no network');}};
 await withConversation(pool,inbox.context,async client=>{await reserveAttempt(client,inbox.context,id,0,provider);});
 await pool.query("UPDATE provider_attempts SET state='unknown',billing_state='unknown'");
 await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise) VALUES($1,$2,$3,$4,$5,'[]',1234)",[randomUUID(),fixtureStore,fixtureConversation,simulatorContext.actor,randomUUID()]);
 await pool.query("INSERT INTO whatsapp_statuses(phone_id,provider_id,recipient,state,provider_timestamp) VALUES('12345','old-delivery','919000000001','delivered',1)");
 // Reconstruct populated v26 in this disposable schema; production is untouched.
 await pool.query(`DROP TABLE order_quotes,order_amendments,order_advances; ALTER TABLE conversations DROP COLUMN partial_reviews,DROP COLUMN welcome_audio_queued; ALTER TABLE messages DROP COLUMN reply_decision; ALTER TABLE order_requests DROP COLUMN estimate_complete,DROP COLUMN excluded_line_ids,DROP COLUMN advance_required,DROP COLUMN effective_revision,DROP COLUMN effective_lines,DROP COLUMN effective_total_paise;`);
 await pool.query('DROP TABLE payment_events,payment_attempts,payment_quotes,catalog_proposal_assets,catalog_proposals; ALTER TABLE stores DROP COLUMN inventory_policy; ALTER TABLE products DROP COLUMN merchant_verification,DROP COLUMN selling_policy; ALTER TABLE messages DROP COLUMN release_fingerprint; DROP TABLE runtime_releases; DROP TABLE whatsapp_pricing_events,whatsapp_delivery_costs,whatsapp_delivery_cost_history,whatsapp_pricing_analytics; ALTER TABLE messages DROP COLUMN inference_deadline_at; ALTER TABLE provider_attempts DROP COLUMN input_admission,DROP COLUMN observation; ALTER TABLE catalog_suggestions DROP COLUMN input_admission; ALTER TABLE whatsapp_statuses DROP COLUMN pricing; DELETE FROM schema_migrations WHERE version>=27');
 const tables=['inference_budgets','provider_attempts','order_requests','whatsapp_statuses','messages'];
 const before=await Promise.all(tables.map(table=>pool.query('SELECT * FROM '+table).then(r=>r.rows)));
 await setupDatabase(pool,'mock');await setupDatabase(pool,'mock');
 for(const [n,table] of tables.entries()){
  const after=(await pool.query('SELECT * FROM '+table)).rows.map(row=>{delete row.input_admission;delete row.inference_deadline_at;delete row.pricing;delete row.observation;delete row.release_fingerprint;for(const key of ['reply_decision','estimate_complete','excluded_line_ids','advance_required','effective_revision','effective_lines','effective_total_paise'])delete row[key];return row;});assert.deepEqual(after,before[n],table);
 }
 assert.equal((await pool.query('SELECT version FROM schema_migrations WHERE version=27')).rowCount,1);
 assert.equal((await pool.query('SELECT * FROM whatsapp_delivery_costs')).rowCount,0);assert.equal((await pool.query('SELECT version FROM schema_migrations WHERE version BETWEEN 27 AND 31')).rowCount,5);
}));
