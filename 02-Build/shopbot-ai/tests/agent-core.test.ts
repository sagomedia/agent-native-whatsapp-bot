import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {MockInterpreter} from '../apps/server/src/adapters/mock-interpreter.js';
import type {Interpreter,ProviderResult} from '../apps/server/src/adapters/interpreter.js';
import type {ActorContext} from '../apps/server/src/services/context.js';
import type {SimulatorEvent} from '../packages/contracts/index.js';
import {readConfig} from '../apps/server/src/config.js';

async function fixture(run:(pool:pg.Pool,service:SimulatorService,tools:RetailTools)=>Promise<void>,provider:Interpreter=new MockInterpreter()) {
  const config=readConfig();assert.equal(config.mode,'mock');
  const admin=new pg.Pool({connectionString:config.databaseUrl});
  const schema='agent_test_'+randomUUID().replaceAll('-','');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool=new pg.Pool({connectionString:config.databaseUrl,options:`-c search_path=${schema}`});
  try {await setupDatabase(pool,'mock');await run(pool,new SimulatorService(pool,simulatorContext,provider),new RetailTools(pool));}
  finally {await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
async function turn(service:SimulatorService,text:string) {await service.ingest({id:randomUUID(),type:'text',text});assert.equal(await service.processNext(),true);return service.snapshot();}
const five='I need three half-inch PVC elbows, two PTFE tape rolls, one ten-inch adjustable wrench, four M4 screws and one claw hammer';

test('five-item text -> complete review -> confirmed request once; known actions use zero calls',async()=>fixture(async(pool,service,tools)=>{
  let state=await turn(service,five);
  assert.equal(state.conversation.draft.length,5);
  assert.equal(state.conversation.pending?.kind,'review');
  assert.equal(state.interpretationAttempts,1);
  assert.equal(state.conversation.pending?.kind==='review'?state.conversation.pending.totalPaise:0,91400);
  const review=state.conversation.pending!;
  assert.equal(review.kind,'review');
  await assert.rejects(tools.invoke(simulatorContext,{name:'submit_order_request',args:{reviewId:review.id}},randomUUID()),/explicit customer confirmation/);
  const yes:SimulatorEvent={id:randomUUID(),type:'text',text:'yes'};
  await service.ingest(yes);await service.processNext();
  assert.equal((await service.ingest(yes)).duplicate,true);assert.equal(await service.processNext(),false);
  state=await service.snapshot();assert.equal(state.requests.length,1);assert.equal(state.interpretationAttempts,1);
  assert.equal(state.requests[0].acceptance,'awaiting_approval');assert.equal(state.requests[0].payment,'not_requested');assert.equal(state.requests[0].fulfillment,'awaiting_approval');
  assert.equal(state.requests[0].totalPaise,91400);
  await turn(service,'yes');assert.equal((await service.snapshot()).requests.length,1);
  const requestsBefore=JSON.stringify(state.requests);
  await turn(service,'change the elbows to five');assert.equal(JSON.stringify((await service.snapshot()).requests),requestsBefore);
  assert.match((await service.snapshot()).messages.at(-1)!.text,/amendment/);
  await assert.rejects(tools.invoke(simulatorContext,{name:'mark_ready',args:{}},randomUUID()));
}));

test('unresolved lines survive targeted choice/quantity clarification without silent omissions',async()=>fixture(async(pool,service)=>{
  let state=await turn(service,'I need two PTFE tape rolls, one adjustable wrench, four M4 screws, one claw hammer and three PVC elbows');
  assert.equal(state.conversation.draft.length,5);
  assert.equal(state.conversation.draft.filter(l=>l.resolution==='matched').length,4);
  assert.equal(state.conversation.pending?.kind,'question');
  const oldQuestion=state.conversation.pending!;
  await service.ingest({id:randomUUID(),type:'review',expectedVersion:state.conversation.version});await service.processNext();
  const currentQuestion=(await service.snapshot()).conversation.pending!;
  await service.ingest({id:randomUUID(),type:'select_candidate',questionId:oldQuestion.id,lineId:state.conversation.draft.at(-1)!.id,sku:'PVC-ELBOW-075'});await service.processNext();
  state=await service.snapshot();assert.equal(state.conversation.pending!.id,currentQuestion.id);assert.equal(state.conversation.draft.at(-1)!.resolution,'needs_choice');
  const originalIds=state.conversation.draft.map(l=>l.id);
  const attempts=state.interpretationAttempts;
  state=await turn(service,'the second one');
  assert.equal(state.interpretationAttempts,attempts);
  assert.equal(state.conversation.draft.length,5);
  assert.deepEqual(state.conversation.draft.map(l=>l.id),originalIds);
  assert.equal(state.conversation.draft.at(-1)!.sku,'PVC-ELBOW-075');
  assert.equal(state.conversation.pending?.kind,'review');
}));

test('uncertain quantities, unmatched lines and price-only requests retain their correct purpose',async()=>fixture(async(pool,service)=>{
  let state=await turn(service,'price of PTFE tape');assert.equal(state.conversation.draft.length,0);assert.match(state.messages.at(-1)!.text,/35/);
  state=await turn(service,'I need three or four half-inch PVC elbows and two PTFE tape rolls');
  assert.equal(state.conversation.draft[0].quantity,null);assert.equal(state.conversation.draft.length,2);assert.equal(state.conversation.pending?.kind,'question');
  state=await turn(service,'4');assert.equal(state.conversation.draft[0].quantity,4);assert.equal(state.conversation.pending?.kind,'review');
  state=await turn(service,'add one unicorn bolt');assert.equal(state.conversation.draft.length,3);assert.equal(state.conversation.draft.at(-1)!.resolution,'unavailable');
  state=await turn(service,'yes');assert.equal(state.requests.length,0);assert.equal(state.conversation.draft.length,3);
  state=await turn(service,'remove the unicorn bolt');assert.equal(state.conversation.draft.length,2);assert.equal(state.conversation.pending?.kind,'review');
}));

test('compound edits and yes-but-edit create a fresh review; stale, unrelated and expired yes cannot submit',async()=>fixture(async(pool,service)=>{
  await turn(service,'yes');assert.equal((await service.snapshot()).interpretationAttempts,0);
  let state=await turn(service,'I need three half-inch PVC elbows and one adjustable wrench');
  const oldReview=state.conversation.pending!.id;
  state=await turn(service,'add two tape rolls and change the elbows to five and remove the wrench and I will collect them');
  assert.equal(state.conversation.draft.length,2);assert.equal(state.conversation.draft.find(l=>l.sku==='PVC-ELBOW-050')!.quantity,5);
  assert.notEqual(state.conversation.pending!.id,oldReview);
  await service.ingest({id:randomUUID(),type:'confirm',reviewId:oldReview});await service.processNext();assert.equal((await service.snapshot()).requests.length,0);
  state=await turn(service,'yes, but make the elbows six');assert.equal(state.requests.length,0);assert.equal(state.conversation.draft.find(l=>l.sku==='PVC-ELBOW-050')!.quantity,6);
  // Both arrive while the old review is visible. Queued yes must not approve the later edit.
  await service.ingest({id:randomUUID(),type:'text',text:'change the elbows to seven'});
  await service.ingest({id:randomUUID(),type:'text',text:'yes'});
  await service.processNext();await service.processNext();
  state=await service.snapshot();assert.equal(state.requests.length,0);assert.equal(state.conversation.draft.find(l=>l.sku==='PVC-ELBOW-050')!.quantity,7);
  const pending=state.conversation.pending!;
  await pool.query('UPDATE conversations SET pending=$1::jsonb WHERE id=$2',[JSON.stringify({...pending,expiresAt:'2000-01-01T00:00:00Z'}),simulatorContext.conversationId]);
  await turn(service,'yes');assert.equal((await service.snapshot()).requests.length,0);
  await turn(service,'review');state=await turn(service,'yes');assert.equal(state.requests.length,1);
}));

test('price changes require new review while stock stays advisory; immutable requests preserve prices and state',async()=>fixture(async(pool,service)=>{
  await turn(service,'I need two PTFE tape rolls');
  await pool.query('UPDATE products SET price_paise=4000,version=version+1 WHERE store_id=$1 AND sku=$2',[simulatorContext.storeId,'PTFE-TAPE']);
  let state=await turn(service,'yes');assert.equal(state.requests.length,0);assert.equal(state.conversation.pending,null);
  state=await turn(service,'review');assert.equal(state.conversation.pending?.kind==='review'?state.conversation.pending.totalPaise:0,8000);
  await pool.query('UPDATE products SET stock=1 WHERE store_id=$1 AND sku=$2',[simulatorContext.storeId,'PTFE-TAPE']);
  state=await turn(service,'yes');assert.equal(state.requests.length,1);
  assert.equal(state.requests[0].lines[0].quantity,2);assert.equal(state.requests[0].totalPaise,8000);
  assert.equal(state.requests[0].lines[0].resolution,'matched');
  assert.equal(Number((await pool.query('SELECT stock FROM products WHERE store_id=$1 AND sku=$2',[simulatorContext.storeId,'PTFE-TAPE'])).rows[0].stock),1);
  await pool.query('UPDATE products SET price_paise=99999,stock=0 WHERE store_id=$1 AND sku=$2',[simulatorContext.storeId,'PTFE-TAPE']);
  const saved=(await service.snapshot()).requests[0];
  assert.equal(saved.lines[0].pricePaise,4000);assert.equal(saved.lines[0].quantity,2);assert.equal(saved.totalPaise,8000);
}));

test('shared tools support a second store/profile and decimal units; tenant/actor/role injection is rejected',async()=>fixture(async(pool,service,tools)=>{
  const other:ActorContext={storeId:randomUUID(),conversationId:randomUUID(),actor:'other-customer',role:'customer'};
  await pool.query("INSERT INTO stores VALUES($1,'Grocery fixture','true')",[other.storeId]);
  await pool.query('INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,$3)',[other.conversationId,other.storeId,other.actor]);
  await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases,quantity_step) VALUES($1,'COFFEE','Coffee pack','pack',50000,10,'[\"coffee\"]',1),($1,'SUGAR','Sugar','kg',19999,10,'[\"sugar\"]',0.001)",[other.storeId]);
  const grocery=new SimulatorService(pool,other);
  let state=await turn(grocery,'I need two coffee packs and 0.125 sugar');
  assert.equal(state.conversation.draft.length,2);assert.equal(state.conversation.pending?.kind==='review'?state.conversation.pending.totalPaise:0,102500);
  await assert.rejects(tools.invoke({...other,storeId:simulatorContext.storeId},{name:'get_draft',args:{}},randomUUID()),/not accessible/);
  await assert.rejects(tools.invoke({...other,actor:'impostor'},{name:'get_draft',args:{}},randomUUID()),/not accessible/);
  await assert.rejects(tools.invoke({...other,role:'staff'},{name:'get_draft',args:{}},randomUUID()),/verified customer/);
  await assert.rejects(tools.invoke(other,{name:'get_draft',args:{storeId:simulatorContext.storeId}},randomUUID()));
  assert.equal((await tools.invoke(other,{name:'search_products',args:{query:'PTFE tape'}},randomUUID())).products!.length,0);
  const id=state.conversation.pending!.id;state=await turn(grocery,'yes');
  await assert.rejects(tools.invoke(simulatorContext,{name:'get_order_status',args:{requestId:state.requests[0].id}},randomUUID()),/not accessible/);
  assert.equal((await service.snapshot()).conversation.draft.length,0);
}));

test('tool batches roll back on invalid dependencies/line limits; replay cannot repeat a mutation',async()=>fixture(async(pool,service,tools)=>{
  const call={name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'PTFE tape',quantity:2}]}};
  const key=randomUUID();await tools.invoke(simulatorContext,call,key);await tools.invoke(simulatorContext,call,key);
  let state=await service.snapshot();assert.equal(state.conversation.draft[0].quantity,2);assert.equal(state.conversation.version,1);
  await assert.rejects(tools.invoke(simulatorContext,{...call,args:{...call.args,expectedVersion:1}},key),/different arguments/);
  const before=state.conversation;
  await assert.rejects(tools.invoke(simulatorContext,{name:'apply_draft_changes',args:{expectedVersion:1,operations:[{kind:'add_item',query:'claw hammer',quantity:1},{kind:'remove_item',reference:'does not exist'}]}},randomUUID()),/not in the draft/);
  assert.deepEqual((await service.snapshot()).conversation,before);
  await assert.rejects(tools.invoke(simulatorContext,{name:'apply_draft_changes',args:{expectedVersion:1,operations:Array.from({length:11},(_,i)=>({kind:'add_item',query:`unmatched ${i}`,quantity:1}))}},randomUUID()),/10 distinct/);
  assert.deepEqual((await service.snapshot()).conversation,before);
}));

test('malformed/truncated/privilege-changing provider output cannot mutate draft; live adapter fails closed',async()=>{
  for(const result of [
    {output:{operations:[{kind:'add_item',query:'PTFE tape',quantity:2,storeId:randomUUID()}],next:'review'},truncated:false,usage:null},
    {output:{operations:[{kind:'add_item',query:'PTFE tape',quantity:2}],next:'review'},truncated:true,usage:null},
    {output:{operations:[{kind:'mark_ready'}],next:'review'},truncated:false,usage:null},
  ]) await fixture(async(pool,service)=>{
    const state=await turn(service,'I need two tape rolls');assert.equal(state.conversation.draft.length,0);assert.equal(state.requests.length,0);assert.equal(state.interpretationAttempts,1);
    assert.equal((await pool.query('SELECT state FROM provider_attempts')).rows[0].state,'failed');
  },{name:'test-invalid',mode:'mock',interpret:async()=>result as ProviderResult});
  await fixture(async(pool)=>{
    assert.throws(()=>new SimulatorService(pool,simulatorContext,{name:'unapproved-live',mode:'live',interpret:async()=>{throw new Error('must not run');}}),/Live interpretation is disabled/);
  });
});

test('expired work lease reuses saved interpretation, recovers once and enforces persisted attempt ceiling',async()=>fixture(async(pool,service)=>{
  const event:SimulatorEvent={id:randomUUID(),type:'text',text:'I need two PTFE tape rolls'};
  await service.ingest(event);
  const response={operations:[{kind:'add_item',query:'PTFE tape',quantity:2}],next:'review'};
  await pool.query("UPDATE messages SET status='processing',claim_token=$1,lease_until=now()-interval '1 second' WHERE id=$2",[randomUUID(),event.id]);
  await pool.query("INSERT INTO provider_attempts(id,store_id,conversation_id,actor,message_id,attempt,provider,source_version,state,response,provider_cost_paise) VALUES($1,$2,$3,$4,$5,1,'mock-text-v1',0,'succeeded',$6::jsonb,0)",[randomUUID(),simulatorContext.storeId,simulatorContext.conversationId,simulatorContext.actor,event.id,JSON.stringify(response)]);
  const recovered=new SimulatorService(pool,simulatorContext,{name:'mock-text-v1',mode:'mock',interpret:async()=>{throw new Error('cached output should be reused');}});
  assert.equal(await recovered.processNext(),true);assert.equal(await recovered.processNext(),false);
  let state=await recovered.snapshot();assert.equal(state.conversation.draft[0].quantity,2);assert.equal(state.messages.length,2);assert.equal(state.interpretationAttempts,1);
  const second:SimulatorEvent={id:randomUUID(),type:'text',text:'add one claw hammer'};await recovered.ingest(second);
  for(let attempt=1;attempt<=2;attempt++)await pool.query("INSERT INTO provider_attempts(id,store_id,conversation_id,actor,message_id,attempt,provider,source_version,state,provider_cost_paise) VALUES($1,$2,$3,$4,$5,$6,'mock-text-v1',1,'started',0)",[randomUUID(),simulatorContext.storeId,simulatorContext.conversationId,simulatorContext.actor,second.id,attempt]);
  await recovered.processNext();state=await recovered.snapshot();assert.equal(state.conversation.draft.length,1);assert.match(state.messages.at(-1)!.text,/attempt limit/);assert.equal((await pool.query("SELECT count(*)::int AS n FROM provider_attempts WHERE message_id=$1 AND state='unknown'",[second.id])).rows[0].n,2);
}));
