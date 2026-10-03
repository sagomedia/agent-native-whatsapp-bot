import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {FinishReason,type GenerateContentResponse,type GenerateContentParameters} from '@google/genai';
import {setupDatabase,resetMock} from '../apps/server/src/db/migrate.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {GoogleInterpreter,readNativeSettings,type GoogleTransport} from '../apps/server/src/adapters/google-interpreter.js';
import {geminiTextRate,initializeBudget,worstCaseReservation,usageEstimate,validateRateCard,settleAttempt} from '../apps/server/src/services/inference-budget.js';
import {readConfig} from '../apps/server/src/config.js';
import type {ActorContext} from '../apps/server/src/services/context.js';

const settings={allowPaidInference:true,apiKey:'offline-test-key',model:geminiTextRate.model,budgetMicrousd:500000};
const operations=[{kind:'add_item',query:'PVC-ELBOW-050',quantity:3},{kind:'add_item',query:'PTFE-TAPE',quantity:2},{kind:'add_item',query:'WRENCH-10',quantity:1},{kind:'add_item',query:'SCREW-M4-25',quantity:4},{kind:'add_item',query:'HAMMER-500',quantity:1}];
function response(output:unknown={operations,next:'review'},finish=FinishReason.STOP,usage=true):GenerateContentResponse {
  return {modelVersion:geminiTextRate.model,candidates:[{finishReason:finish,content:{parts:[{text:typeof output==='string'?output:JSON.stringify(output)}]}}],...(usage?{usageMetadata:{promptTokenCount:1000,candidatesTokenCount:100,thoughtsTokenCount:20,totalTokenCount:1120}}:{})} as GenerateContentResponse;
}
async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>) {
  const config=readConfig(),admin=new pg.Pool({connectionString:config.databaseUrl});
  assert.equal(config.mode,'mock');const schema='native_test_'+randomUUID().replaceAll('-','');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool=new pg.Pool({connectionString:config.databaseUrl,options:`-c search_path=${schema}`});
  try{await setupDatabase(pool,'mock');await run(pool,new SimulatorService(pool));}
  finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
async function turn(inbox:SimulatorService,runtime:ConversationRuntime,text:string) {await inbox.ingest({id:randomUUID(),type:'text',text});await runtime.processNext(inbox.context);return inbox.snapshot();}

test('native configuration fails closed; dated USD rates include thinking and never imply paise conversion',()=>{
  assert.throws(()=>readNativeSettings({}),/disabled/);
  assert.throws(()=>readNativeSettings({ALLOW_PAID_INFERENCE:'true'}),/GEMINI_API_KEY/);
  assert.throws(()=>readNativeSettings({ALLOW_PAID_INFERENCE:'true',GEMINI_API_KEY:'offline',AI_BUDGET_USD:'0'}),/Invalid/);
  assert.throws(()=>readNativeSettings({ALLOW_PAID_INFERENCE:'true',GEMINI_API_KEY:'offline',AI_BUDGET_USD:'1',AI_MODEL:'unpriced'}),/verified/);
  assert.equal(readNativeSettings({ALLOW_PAID_INFERENCE:'true',GEMINI_API_KEY:'offline',AI_BUDGET_USD:'1.000001'}).budgetMicrousd,1000001);
  assert.throws(()=>validateRateCard({...geminiTextRate,validUntil:'2026-10-01'}),/expired/);
  assert.equal(worstCaseReservation(geminiTextRate),324813);
  assert.deepEqual(usageEstimate(geminiTextRate,{output:{},truncated:false,responseModel:geminiTextRate.model,usage:{promptTokenCount:1000,candidatesTokenCount:100,totalTokenCount:1120}}),{microusd:600,violation:false});
});

test('official SDK wire contract: one request, JSON mode and strict backend contract, standard tier, bounded minimal thinking and no hidden retries',async()=>{
  const savedFetch=globalThis.fetch;let calls=0;let body:any;
  globalThis.fetch=async(input,init)=>{
    calls++;const request=new Request(input,init);assert.equal(new URL(request.url).hostname,'generativelanguage.googleapis.com');body=await request.json();
    return new Response(JSON.stringify(response()),{headers:{'Content-Type':'application/json'}});
  };
  try{
    const native=new GoogleInterpreter(settings);
    const result=await native.interpret({text:'five items',state:{draft:[],version:0,pending:null,fulfillment:'pickup',lastRequestId:null}},AbortSignal.timeout(1000));
    assert.equal(calls,1);assert.deepEqual(result.output,{operations,next:'review'});
    assert.equal(body.generationConfig.maxOutputTokens,4096);assert.equal(body.generationConfig.candidateCount,1);assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.generationConfig.responseJsonSchema,undefined);assert.match(JSON.stringify(body.systemInstruction),/Planning contract/);assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'MINIMAL');assert.equal(body.serviceTier,'standard');assert.equal(body.tools,undefined);
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{message:'offline transient',code:503}}),{status:503,headers:{'Content-Type':'application/json'}});};
    calls=0;await assert.rejects(native.interpret({text:'test',state:{draft:[],version:0,pending:null,fulfillment:'pickup',lastRequestId:null}},AbortSignal.timeout(1000)));assert.equal(calls,1);
  }finally{globalThis.fetch=savedFetch;}
});

test('native runtime reserves before SDK invocation, settles measured usage, and known confirmation needs no calls',async()=>fixture(async(pool,inbox)=>{
  await initializeBudget(pool,simulatorContext,500000);let calls=0;
  const transport:GoogleTransport={generateContent:async(params)=>{
    calls++;const a=(await pool.query('SELECT * FROM provider_attempts')).rows[0];assert.equal(a.state,'started');assert.equal(a.billing_state,'held');assert.equal(a.provider_cost_paise,null);
    assert.equal(Number((await pool.query('SELECT held_microusd FROM inference_budgets')).rows[0].held_microusd),324813);
    assert.ok(String(params.contents).includes('PTFE-TAPE'));assert.ok(!String(params.contents).includes('local-simulator'));
    return response();
  }};
  const runtime=new ConversationRuntime(pool,new GoogleInterpreter(settings,transport),{allowPaidInference:true});
  let state=await turn(inbox,runtime,'five-item test');assert.equal(state.conversation.draft.length,5);assert.equal(state.conversation.pending?.kind,'review');
  state=await turn(inbox,runtime,'yes');assert.equal(state.requests.length,1);assert.equal(calls,1);
  let a=(await pool.query('SELECT * FROM provider_attempts')).rows[0];assert.equal(a.billing_state,'estimated');assert.equal(Number(a.estimated_cost_microusd),600);assert.equal(a.rate_snapshot.currency,'USD');
  await settleAttempt(pool,simulatorContext,a.id,{output:{},truncated:false,responseModel:geminiTextRate.model,usage:{promptTokenCount:1000,candidatesTokenCount:100,thoughtsTokenCount:20,totalTokenCount:1120}});
  const b=(await pool.query('SELECT * FROM inference_budgets')).rows[0];assert.equal(Number(b.held_microusd),0);assert.equal(Number(b.committed_microusd),600);
  await assert.rejects(resetMock(pool,'mock'),/paid inference/);
  await assert.rejects(initializeBudget(pool,simulatorContext,1000000),/differs/);
}));

test('truncated, invalid JSON and invalid operation responses still retain billed usage without draft changes',async()=>{
  for(const r of [response({operations,next:'review'},FinishReason.MAX_TOKENS),response('{broken json'),response({operations:[{kind:'mark_ready'}],next:'review'})]) {
    await fixture(async(pool,inbox)=>{
      await initializeBudget(pool,simulatorContext,500000);
      const runtime=new ConversationRuntime(pool,new GoogleInterpreter(settings,{generateContent:async()=>r}),{allowPaidInference:true});
      const state=await turn(inbox,runtime,'test');assert.equal(state.conversation.draft.length,0);
      const a=(await pool.query('SELECT state,billing_state,estimated_cost_microusd FROM provider_attempts')).rows[0];assert.equal(a.state,'failed');assert.equal(a.billing_state,'estimated');assert.equal(Number(a.estimated_cost_microusd),600);
    });
  }
});

test('missing usage and network errors retain budget holds across runtime restart; secrets never reach replies',async()=>{
  for(const missing of [true,false]) await fixture(async(pool,inbox)=>{
    await initializeBudget(pool,simulatorContext,500000);let calls=0;
    const provider=new GoogleInterpreter(settings,{generateContent:async()=>{calls++;if(missing)return response(undefined,FinishReason.STOP,false);throw new Error('secret-api-key-and-provider-body');}});
    const runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true});
    let state=await turn(inbox,runtime,'first test');assert.ok(!state.messages.at(-1)!.text.includes('secret-api-key'));
    let b=(await pool.query('SELECT * FROM inference_budgets')).rows[0];assert.equal(Number(b.held_microusd),324813);assert.equal(Number(b.committed_microusd),0);
    const restarted=new ConversationRuntime(pool,provider,{allowPaidInference:true});
    state=await turn(inbox,restarted,'next test');assert.equal(calls,1);assert.equal((await pool.query('SELECT * FROM provider_attempts')).rowCount,1);
    assert.equal((await pool.query('SELECT billing_state FROM provider_attempts')).rows[0].billing_state,'unknown');
  });
});

test('cross-conversation reservations serialize at store budget; depleted budgets stop before provider invocation',async()=>fixture(async(pool,inbox)=>{
  await initializeBudget(pool,simulatorContext,500000);
  const other:ActorContext={...simulatorContext,conversationId:randomUUID(),actor:'second-customer'};
  await pool.query('INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,$3)',[other.conversationId,other.storeId,other.actor]);
  const secondInbox=new SimulatorService(pool,other);let release!:()=>void,started!:()=>void,calls=0;
  const gate=new Promise<void>(resolve=>release=resolve),called=new Promise<void>(resolve=>started=resolve);
  const provider=new GoogleInterpreter(settings,{generateContent:async()=>{calls++;started();await gate;return response();}});
  const runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true});
  await inbox.ingest({id:randomUUID(),type:'text',text:'shopping request A'});const first=runtime.processNext(simulatorContext);await called;
  await turn(secondInbox,runtime,'shopping request B');assert.equal(calls,1);assert.equal((await secondInbox.snapshot()).conversation.draft.length,0);
  release();await first;assert.equal((await inbox.snapshot()).conversation.draft.length,5);
}));

test('usage above configured bounds blocks the budget and preserves draft; unknown held attempts are not refunded',async()=>fixture(async(pool,inbox)=>{
  await initializeBudget(pool,simulatorContext,500000);
  const r=response();r.usageMetadata={promptTokenCount:1000,candidatesTokenCount:5000,totalTokenCount:6000};
  let calls=0;const provider=new GoogleInterpreter(settings,{generateContent:async()=>{calls++;return r;}});
  const runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true});
  const state=await turn(inbox,runtime,'test');assert.equal(state.conversation.draft.length,0);
  const budget=(await pool.query('SELECT * FROM inference_budgets')).rows[0];assert.equal(budget.blocked,true);assert.equal(Number(budget.held_microusd),324813);
  await turn(inbox,runtime,'again');assert.equal(calls,1);
}));

test('crashed paid attempt remains unknown and held when recovery lacks another reservation',async()=>fixture(async(pool,inbox)=>{
  await initializeBudget(pool,simulatorContext,500000);
  const id=randomUUID();await inbox.ingest({id,type:'text',text:'shopping request'});
  await pool.query("UPDATE messages SET status='processing',claim_token=$1,lease_until=now()-interval '1 second' WHERE id=$2",[randomUUID(),id]);
  await pool.query("UPDATE inference_budgets SET held_microusd=324813 WHERE store_id=$1",[simulatorContext.storeId]);
  await pool.query("INSERT INTO provider_attempts(id,store_id,conversation_id,actor,message_id,attempt,provider,source_version,state,provider_mode,billing_state,rate_snapshot,reserved_microusd) VALUES($1,$2,$3,$4,$5,1,$6,0,'started','live','held',$7::jsonb,324813)",[randomUUID(),simulatorContext.storeId,simulatorContext.conversationId,simulatorContext.actor,id,`google:${geminiTextRate.model}`,JSON.stringify(geminiTextRate)]);
  const runtime=new ConversationRuntime(pool,new GoogleInterpreter(settings,{generateContent:async()=>{throw new Error('must not call');}}),{allowPaidInference:true});
  await runtime.processNext(simulatorContext);
  const a=(await pool.query('SELECT state,billing_state FROM provider_attempts')).rows[0];assert.equal(a.state,'unknown');assert.equal(a.billing_state,'unknown');
  assert.equal(Number((await pool.query('SELECT held_microusd FROM inference_budgets')).rows[0].held_microusd),324813);assert.equal((await inbox.snapshot()).conversation.draft.length,0);
}));

const freeSettings={...settings,allowPaidInference:false,budgetMicrousd:0,freeQuota:{scope:'test-project',model:geminiTextRate.model}};
test('free-tier configuration requires explicit opt-in, stable project scope and zero paid budget',()=>{
  const env={ALLOW_FREE_INFERENCE:'true',ALLOW_PAID_INFERENCE:'false',GEMINI_API_KEY:'offline',AI_BUDGET_USD:'0',AI_QUOTA_PROJECT:'test-project'};
  assert.equal(readNativeSettings(env).allowPaidInference,false);
  assert.equal(readNativeSettings(env).budgetMicrousd,0);
  assert.throws(()=>readNativeSettings({...env,ALLOW_PAID_INFERENCE:'true'}),/disabled/);
  assert.throws(()=>readNativeSettings({...env,AI_BUDGET_USD:'1'}),/zero/);
  assert.throws(()=>readNativeSettings({...env,AI_QUOTA_PROJECT:''}),/stable/);
});
test('free attempts reserve durable project quota before calling, create no paid budget, and throttle across conversations',async()=>fixture(async(pool,inbox)=>{
  let calls=0;const provider=new GoogleInterpreter(freeSettings,{generateContent:async()=>{
    calls++;assert.equal((await pool.query('SELECT quota_scope FROM provider_attempts')).rows[0].quota_scope,'test-project');return response();
  }});
  const runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
  const state=await turn(inbox,runtime,'shopping');assert.equal(state.conversation.draft.length,5);
  assert.equal((await pool.query('SELECT * FROM inference_budgets')).rowCount,0);
  const a=(await pool.query('SELECT * FROM provider_attempts')).rows[0];assert.equal(a.billing_state,'free_declared');assert.equal(a.estimated_cost_microusd,null);assert.equal(a.reserved_microusd,'0');assert.equal(a.usage.totalTokenCount,1120);
  const other={...simulatorContext,conversationId:randomUUID(),actor:'another'};
  await pool.query('INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,$3)',[other.conversationId,other.storeId,other.actor]);
  const next=new SimulatorService(pool,other);
  await turn(next,new ConversationRuntime(pool,provider,{allowFreeInference:true}),'shopping again');assert.equal(calls,1);
  assert.equal((await next.snapshot()).conversation.draft.length,0);
}));
test('free 429 cooldown survives runtime restart and never retries or exposes provider errors',async()=>fixture(async(pool,inbox)=>{
  let calls=0;const provider=new GoogleInterpreter(freeSettings,{generateContent:async()=>{calls++;throw {status:429,message:'secret-provider-body'};}});
  await turn(inbox,new ConversationRuntime(pool,provider,{allowFreeInference:true}),'shopping');
  await pool.query("UPDATE provider_attempts SET created_at=now()-interval '2 minutes'");
  await turn(inbox,new ConversationRuntime(pool,provider,{allowFreeInference:true}),'retry');
  assert.equal((await pool.query('SELECT failure_code FROM provider_attempts')).rows[0].failure_code,'rate_limited');
  assert.equal(calls,1);assert.ok(!(await inbox.snapshot()).messages.some(m=>m.text.includes('secret-provider-body')));
  assert.equal((await pool.query('SELECT cooldown_until>now() AS cooling FROM free_inference_quota')).rows[0].cooling,true);
}));
test('free daily cap counts failed and unknown requests at Pacific day boundaries',async()=>fixture(async(pool,inbox)=>{
  let calls=0;const provider=new GoogleInterpreter(freeSettings,{generateContent:async()=>{calls++;return response();}});
  const runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
  await turn(inbox,runtime,'shopping');
  const a=(await pool.query('SELECT * FROM provider_attempts')).rows[0];
  // Seed retained failures early in the current quota day; minute guard is deliberately expired.
  await pool.query("UPDATE provider_attempts SET created_at=date_trunc('day',now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles'");
  for(let i=0;i<99;i++) {
    const id=randomUUID();await inbox.ingest({id,type:'text',text:'seed'});
    await pool.query("UPDATE messages SET status='processed' WHERE id=$1",[id]);
    await pool.query(`INSERT INTO provider_attempts(id,store_id,conversation_id,actor,message_id,attempt,provider,source_version,state,provider_mode,quota_scope,created_at)
      VALUES($1,$2,$3,$4,$5,1,$6,0,'unknown','live',$7,date_trunc('day',now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles')`,[randomUUID(),a.store_id,a.conversation_id,a.actor,id,a.provider,a.quota_scope]);
  }
  await turn(inbox,runtime,'next shopping');assert.equal(calls,1);assert.equal((await pool.query('SELECT * FROM provider_attempts')).rowCount,100);
}));

test('native add wire alias translates only a complete strict operation object',async()=>fixture(async(pool,inbox)=>{
  const aliased=operations.map(op=>({...op,kind:'add'}));
  const provider=new GoogleInterpreter(freeSettings,{generateContent:async()=>response({operations:aliased,next:'review'})});
  const state=await turn(inbox,new ConversationRuntime(pool,provider,{allowFreeInference:true}),'shopping');
  assert.equal(state.conversation.draft.length,5);assert.equal(state.conversation.pending?.kind,'review');
  const bad=new GoogleInterpreter(freeSettings,{generateContent:async()=>response({operations:[{kind:'add',query:'PTFE-TAPE',quantity:1,approve:true}],next:'review'})});
  const result=await bad.interpret({text:'test',state:state.conversation},AbortSignal.timeout(1000));
  assert.equal(result.output&&typeof result.output==='object'&&'operations' in result.output?(result.output as any).operations[0].kind:undefined,'add');
}));

test('local native HTTP channel requires local origin/header and signed fresh session; retries do not repeat inference',async()=>fixture(async(pool)=>{
  const {createApp}=await import('../apps/server/src/http/app.js');let calls=0;
  const provider=new GoogleInterpreter(freeSettings,{generateContent:async()=>{calls++;return response();}});
  const app=await createApp(readConfig(),pool,provider);
  try {
    assert.equal((await app.inject({method:'POST',url:'/api/native-test/session'})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/native-test/session',headers:{host:'localhost:3017',origin:'https://other.example','x-shopbot-local-test':'1'}})).statusCode,403);
    assert.equal((await app.inject({method:'GET',url:'/api/native-test',headers:{host:'evil.example'}})).statusCode,403);
    const start=await app.inject({method:'POST',url:'/api/native-test/session',headers:{'x-shopbot-local-test':'1'}});
    const cookie=String(start.headers['set-cookie']).split(';')[0],headers={cookie,'x-shopbot-local-test':'1'};
    const event={id:randomUUID(),type:'text',text:'five-item shopping'};
    assert.equal((await app.inject({method:'POST',url:'/api/native-test/events',headers,payload:event})).statusCode,200);
    await app.inject({method:'POST',url:'/api/native-test/events',headers,payload:event});assert.equal(calls,1);
    const state=(await app.inject({method:'GET',url:'/api/native-test',headers})).json();assert.equal(state.conversation.draft.length,5);assert.equal(state.provider,provider.name);
    assert.equal((await app.inject({method:'GET',url:'/api/native-test',headers:{cookie:cookie.replace(/.$/,'x')}})).statusCode,401);
    assert.equal((await app.inject({method:'GET',url:'/api/simulator'})).json().conversation.version,0);
  }finally{await app.close();}
}));

test('persona greetings preserve the draft, use no AI request, and replies remain one persisted message',async()=>fixture(async(pool,inbox)=>{
  let calls=0;const provider=new GoogleInterpreter(freeSettings,{generateContent:async()=>{calls++;return response();}});
  const runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
  const state=await turn(inbox,runtime,'hello');assert.match(state.messages.at(-1)!.text,/Hi!.*shop assistant/);assert.equal(calls,0);assert.equal(state.conversation.version,0);assert.equal(state.interpretationAttempts,0);
  assert.equal(state.messages.at(-1)!.rich?.outboundMessages,1);
  await turn(inbox,runtime,'thank you');assert.equal(calls,0);assert.equal((await inbox.snapshot()).messages.filter(m=>m.direction==='outbound').length,2);
}));
test('vague screw box plus paint retains both, asks size then quantity, and sends one photo envelope per turn',async()=>fixture(async(pool,inbox)=>{
  await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases,image_path) VALUES($1,'BOX','Stainless screws 1 inch — box of 100','box',9500,NULL,'[\"screw box\",\"screws\"]','/demo-images/H27.jpg')",[simulatorContext.storeId]);
  const provider=new GoogleInterpreter(freeSettings,{generateContent:async()=>response({operations:[{kind:'add_item',query:'screw box',quantity:null},{kind:'add_item',query:'paint',quantity:null}],next:'review'})});
  const runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});let state=await turn(inbox,runtime,'screw boxes plus some paints');
  assert.equal(state.conversation.draft.length,2);assert.equal(state.conversation.draft[0].resolution,'needs_choice');assert.equal(state.conversation.draft[1].resolution,'unavailable');
  assert.match(state.messages.at(-1)!.text,/paint/);assert.equal(state.messages.at(-1)!.rich?.cards?.length,1);assert.equal(state.messages.at(-1)!.rich?.outboundMessages,1);
  const select=state.messages.at(-1)!.rich!.cards![0].action!;await inbox.ingest(select);await runtime.processNext(inbox.context);state=await inbox.snapshot();assert.equal(state.conversation.draft[0].resolution,'needs_quantity');assert.equal(state.interpretationAttempts,1);
  state=await turn(inbox,runtime,'2');assert.equal(state.conversation.draft[0].quantity,2);assert.equal(state.conversation.draft[1].resolution,'unavailable');assert.match(state.messages.at(-1)!.text,/What are you painting/);assert.equal(state.interpretationAttempts,1);assert.equal(state.requests.length,0);
}));
test('typo matches are choices, numeric specs stay exact, and browse caps at ten without adding or auto-paging',async()=>fixture(async(pool,inbox)=>{
  const runtime=inbox.runtime;
  await inbox.ingest({id:randomUUID(),type:'browse',query:'PVC elbw',expectedVersion:0});await runtime.processNext(inbox.context);let state=await inbox.snapshot();assert.equal(state.conversation.draft.length,0);assert.equal(state.messages.at(-1)!.rich?.cards?.length,2);
  await inbox.ingest({id:randomUUID(),type:'text',text:'add PVC elbw'});await runtime.processNext(inbox.context);state=await inbox.snapshot();assert.equal(state.conversation.draft[0].resolution,'needs_choice');
  const {searchProducts}=await import('../apps/server/src/services/catalog.js');const client=await pool.connect();try{assert.equal((await searchProducts(client,simulatorContext,'0.6 PVC elbow')).length,0);}finally{client.release();}
  for(let i=0;i<15;i++)await pool.query('INSERT INTO products(store_id,sku,name,unit,price_paise,stock) VALUES($1,$2,$3,$4,100,10)',[simulatorContext.storeId,'P'+i,'Garden clamp '+i,'piece']);
  await inbox.ingest({id:randomUUID(),type:'browse',query:'garden clamp',expectedVersion:state.conversation.version});await runtime.processNext(inbox.context);state=await inbox.snapshot();assert.equal(state.messages.at(-1)!.rich?.cards?.length,10);assert.equal(state.conversation.draft.length,1);assert.equal(state.messages.filter(m=>m.direction==='outbound').length,3);
}));

test('WhatsApp planning respects approved card count, marketing cost, service window and one-message ceiling',async()=>{
  const {planWhatsAppReply}=await import('../apps/server/src/services/whatsapp-plan.js');
  const card={product:{sku:'P',name:'Pipe',unit:'piece',pricePaise:100,stock:null,version:1,aliases:[],quantityStep:1,imageUrl:'/image.jpg'},label:'Choose'};
  const reply={version:1 as const,kind:'product_choices' as const,text:'Which size?',cards:Array.from({length:10},()=>card),presentation:'carousel_preview' as const,outboundMessages:1 as const};
  const c={serviceWindowOpen:true,catalogConnected:false,serviceRatePaise:12,allowMarketingCarousel:true,marketingOptIn:true,approvedCarousels:[{name:'options10',cardCount:10,ratePaise:86}],maxPaisePerTurn:50};
  assert.equal(planWhatsAppReply(reply,c).format,'list');assert.equal(planWhatsAppReply(reply,c).messageCount,1);
  assert.equal(planWhatsAppReply(reply,{...c,serviceWindowOpen:false}).format,'blocked');
  assert.equal(planWhatsAppReply(reply,{...c,serviceWindowOpen:false,maxPaisePerTurn:100}).format,'carousel_template');
  assert.equal(planWhatsAppReply({...reply,cards:reply.cards.slice(0,4)},{...c,serviceWindowOpen:false,maxPaisePerTurn:100}).format,'blocked');
  assert.equal(planWhatsAppReply(reply,{...c,catalogConnected:true}).format,'multi_product');
  assert.equal(planWhatsAppReply({...reply,cards:[card]},{...c,catalogConnected:true}).format,'single_product');
});

test('native edit aliases preserve strict fields and map validated current line IDs to backend references',async()=>{
  const id=randomUUID(),state={draft:[],version:0,pending:null,fulfillment:'pickup' as const,lastRequestId:null};
  const provider=new GoogleInterpreter(freeSettings,{generateContent:async()=>response({operations:[{kind:'set_quantity',lineId:id,quantity:2},{kind:'remove_item',lineId:id}],next:'review'})});
  const r=await provider.interpret({text:'change quantity and remove another item',state},AbortSignal.timeout(1000));
  assert.deepEqual(r.output,{operations:[{kind:'set_quantity',reference:id,quantity:2},{kind:'remove_item',reference:id}],next:'review'});
  const invalid=new GoogleInterpreter(freeSettings,{generateContent:async()=>response({operations:[{kind:'remove_item',lineId:id,storeId:randomUUID()}],next:'review'})});
  const {interpretationSchema}=await import('../packages/contracts/index.js');
  assert.equal(interpretationSchema.safeParse((await invalid.interpret({text:'test',state},AbortSignal.timeout(1000))).output).success,false);
});

test('contextual yes confirms one product choice, asks quantity, and never sends an order before review',async()=>fixture(async(pool,inbox)=>{
  await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases,image_path) VALUES($1,'BOX','Screws 1 inch box','box',9500,NULL,'[\"screw box\"]','/demo-images/H27.jpg')",[simulatorContext.storeId]);
  let calls=0;const provider={name:'scripted-customer',mode:'mock' as const,interpret:async()=>{calls++;return {output:{operations:[{kind:'add_item',query:'screw box',quantity:null}],next:'review'},truncated:false,usage:null};}};
  const runtime=new ConversationRuntime(pool,provider);
  let s=await turn(inbox,runtime,'some screw boxes');assert.equal(s.conversation.draft[0].resolution,'needs_choice');
  s=await turn(inbox,runtime,'yes');assert.equal(s.conversation.draft[0].resolution,'needs_quantity');assert.match(s.messages.at(-1)!.text,/How many boxes/);assert.equal(s.requests.length,0);
  s=await turn(inbox,runtime,'yes');assert.match(s.messages.at(-1)!.text,/How many boxes/);assert.equal(s.messages.at(-1)!.rich?.cards,undefined);
  s=await turn(inbox,runtime,'three');assert.equal(s.conversation.draft[0].quantity,3);assert.equal(s.conversation.pending?.kind,'review');assert.equal(calls,1);assert.equal(s.requests.length,0);
}));

test('ambiguous numbers, greetings and declines retain the pending line without repeated photos or inference',async()=>fixture(async(pool,inbox)=>{
  let s=await turn(inbox,inbox.runtime,'I need some PVC elbows and tape');const before=s.conversation;
  for(const input of ['three','hello anna','thanks','no','just browsing','cancel that']){
    s=await turn(inbox,inbox.runtime,input);assert.deepEqual(s.conversation,before);assert.equal(s.interpretationAttempts,1);assert.equal(s.messages.at(-1)!.rich?.cards,undefined);assert.equal(s.requests.length,0);
  }
  assert.match(s.messages.at(-1)!.text,/haven’t sent.*list is kept/);
  s=await turn(inbox,inbox.runtime,'remove it');assert.equal(s.conversation.draft.length,1);assert.match(s.conversation.draft[0].name,/tape/);assert.match(s.messages.at(-1)!.text,/How many rolls/);
  s=await turn(inbox,inbox.runtime,'clear my list');assert.equal(s.conversation.draft.length,0);assert.match(s.messages.at(-1)!.text,/list is cleared/);assert.equal(s.interpretationAttempts,1);
}));

test('measurement and packaging mismatches require an explicit catalog unit and never infer conversions',async()=>fixture(async(pool,inbox)=>{
  const provider={name:'scripted-units',mode:'mock' as const,interpret:async()=>({output:{operations:[{kind:'add_item',query:'PVC-ELBOW-050',quantity:20,requestedUnit:'feet'}],next:'review'},truncated:false,usage:null})};
  const runtime=new ConversationRuntime(pool,provider);let s=await turn(inbox,runtime,'20 feet of elbows');
  assert.equal(s.conversation.draft[0].resolution,'needs_unit');assert.equal(s.conversation.draft[0].quantity,null);assert.equal(s.conversation.draft[0].requestedQuantity,20);assert.match(s.messages.at(-1)!.text,/sold per piece.*20 feet.*verified conversion/);
  const before=s.conversation;s=await turn(inbox,runtime,'yes');assert.deepEqual(s.conversation,before);assert.match(s.messages.at(-1)!.text,/Include the unit/);s=await turn(inbox,runtime,'2');assert.deepEqual(s.conversation,before);assert.equal(s.interpretationAttempts,1);
  const {RetailTools}=await import('../apps/server/src/services/tools.js');
  await assert.rejects(new RetailTools(pool).invoke(simulatorContext,{name:'apply_draft_changes',args:{expectedVersion:s.conversation.version,operations:[{kind:'resolve_line',lineId:s.conversation.draft[0].id,quantity:2}]}},randomUUID()),/include the unit/);
  s=await turn(inbox,runtime,'2 pieces');assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.conversation.draft[0].resolution,'matched');assert.equal(s.conversation.pending?.kind,'review');assert.equal(s.interpretationAttempts,1);
  await turn(inbox,runtime,'clear my list');
  await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases) VALUES($1,'BOX','M4 screw box','box',9500,NULL,'[\"M4 screw box\"]')",[simulatorContext.storeId]);
  await inbox.ingest({id:randomUUID(),type:'choose_product',sku:'BOX',expectedVersion:(await inbox.snapshot()).conversation.version});await runtime.processNext(inbox.context);
  s=await turn(inbox,runtime,'5 pieces');assert.equal(s.conversation.draft[0].resolution,'needs_unit');assert.equal(s.conversation.draft[0].quantity,null);assert.match(s.messages.at(-1)!.text,/sold per box/);
  s=await turn(inbox,runtime,'two boxes');assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.conversation.pending?.kind,'review');
}));

test('quantity quotes are read-only, computed from catalog prices, and reject unit conversions',async()=>fixture(async(pool,inbox)=>{
  let s=await turn(inbox,inbox.runtime,'I need one claw hammer');const before=s.conversation;
  s=await turn(inbox,inbox.runtime,'how much for two PTFE tape rolls');assert.deepEqual(s.conversation,before);assert.match(s.messages.at(-1)!.text,/₹35\.00.*2 rolls.*₹70\.00/);assert.equal(s.requests.length,0);
  const provider={name:'quote-unit',mode:'mock' as const,interpret:async()=>({output:{operations:[],next:'price',priceQuery:'PTFE tape',priceQuantity:2,priceUnit:'feet'},truncated:false,usage:null})};
  s=await turn(inbox,new ConversationRuntime(pool,provider),'price for two feet of tape');assert.deepEqual(s.conversation,before);assert.match(s.messages.at(-1)!.text,/priced per roll, not feet/);assert.doesNotMatch(s.messages.at(-1)!.text,/total is/);
}));

test('owner questions give truthful answers in one reply without mutating or sending the review',async()=>fixture(async(pool,inbox)=>{
  let s=await turn(inbox,inbox.runtime,'I need two PTFE tape rolls');const before=s.conversation;
  s=await turn(inbox,inbox.runtime,'Can you deliver today and give me the plumber rate?');assert.deepEqual(s.conversation,before);assert.equal(s.interpretationAttempts,1);assert.match(s.messages.at(-1)!.text,/delivery timing.*shop.*trade rates.*confirmation/);assert.equal(s.messages.at(-1)!.rich?.cards,undefined);assert.equal(s.messages.at(-1)!.rich?.buttons,undefined);assert.equal(s.messages.at(-1)!.rich?.outboundMessages,1);
  s=await turn(inbox,inbox.runtime,'What time do you close?');assert.deepEqual(s.conversation,before);assert.match(s.messages.at(-1)!.text,/opening hours aren’t/);assert.equal(s.requests.length,0);
}));

test('mock diagnostic parser preserves box packaging and supported unit synonyms',async()=>fixture(async(pool,inbox)=>{
  await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases) VALUES($1,'BOX','M4 screw box','box',9500,10,'[\"M4 screw box\"]'),($1,'WIRE','Copper wire','foot',100,100,'[\"copper wire\"]')",[simulatorContext.storeId]);
  let s=await turn(inbox,inbox.runtime,'Can I get two M4 screw boxes and 12 feet of copper wire?');assert.equal(s.conversation.draft.length,2);assert.equal(s.conversation.draft[0].sku,'BOX');assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.conversation.draft[1].sku,'WIRE');assert.equal(s.conversation.draft[1].quantity,12);assert.equal(s.conversation.pending?.kind,'review');
  s=await turn(inbox,inbox.runtime,'Actually make the copper wire only 10');assert.equal(s.conversation.draft[1].quantity,10);assert.equal(s.conversation.draft[0].quantity,2);
}));

test('WhatsApp planning requires marketing opt-in and selects the cheapest approved matching carousel',async()=>{
  const {planWhatsAppReply}=await import('../apps/server/src/services/whatsapp-plan.js');
  const card={product:{sku:'P',name:'Pipe',unit:'piece',pricePaise:100,stock:null,version:1,aliases:[],quantityStep:1,imageUrl:'/image.jpg'},label:'Choose'};
  const reply={version:1 as const,kind:'product_choices' as const,text:'Which?',cards:[card,card],presentation:'carousel_preview' as const,outboundMessages:1 as const};
  const c={serviceWindowOpen:false,catalogConnected:false,serviceRatePaise:0,allowMarketingCarousel:true,approvedCarousels:[{name:'costly',cardCount:2,ratePaise:86},{name:'cheaper',cardCount:2,ratePaise:50}],maxPaisePerTurn:100};
  assert.equal(planWhatsAppReply(reply,c).format,'blocked');assert.equal(planWhatsAppReply(reply,{...c,marketingOptIn:true}).templateName,'cheaper');assert.equal(planWhatsAppReply(reply,{...c,marketingOptIn:true,serviceWindowOpen:true}).category,'service');
});

test('queued unit answers and remove-it stay bound to the original question instead of changing the next line',async()=>fixture(async(pool,inbox)=>{
  const provider={name:'scripted-queue',mode:'mock' as const,interpret:async()=>({output:{operations:[{kind:'add_item',query:'PVC-ELBOW-050',quantity:null},{kind:'add_item',query:'PTFE-TAPE',quantity:null}],next:'review'},truncated:false,usage:null})};
  const runtime=new ConversationRuntime(pool,provider);let s=await turn(inbox,runtime,'elbows and tape');
  await inbox.ingest({id:randomUUID(),type:'text',text:'2 pieces'});
  await inbox.ingest({id:randomUUID(),type:'text',text:'4 rolls'});
  await inbox.ingest({id:randomUUID(),type:'text',text:'remove it'});
  await runtime.processNext(inbox.context);await runtime.processNext(inbox.context);await runtime.processNext(inbox.context);
  s=await inbox.snapshot();assert.equal(s.conversation.draft.length,2);assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.conversation.draft[1].quantity,null);assert.equal(s.interpretationAttempts,1);assert.match(s.messages.at(-1)!.text,/earlier question.*list is unchanged/);
  s=await turn(inbox,runtime,'4 rolls');assert.equal(s.conversation.draft[1].quantity,4);assert.equal(s.conversation.pending?.kind,'review');assert.equal(s.requests.length,0);
}));

test('mixed shopping and delivery questions retain only actual item requests and one truthful reply',async()=>fixture(async(pool,inbox)=>{
  const s=await turn(inbox,inbox.runtime,'I need two PTFE tape rolls and can you deliver today?');assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.conversation.pending?.kind,'review');assert.match(s.messages.at(-1)!.text,/₹70\.00.*pickup/s);assert.match(s.messages.at(-1)!.text,/check delivery timing.*shop/);assert.equal(s.requests.length,0);assert.equal(s.messages.at(-1)!.rich?.outboundMessages,1);
}));

test('exact SKU refresh preserves loose-piece versus box identity even when SKU words match another alias',async()=>fixture(async(pool,inbox)=>{
  await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases) VALUES($1,'AAA-BOX','M4 screws box','box',9500,10,'[\"M4 screw box\",\"M4 screws\"]'),($1,'M4-SCREWS','Loose M4 screws','piece',100,100,'[\"loose M4 screws\"]')",[simulatorContext.storeId]);
  const {searchProducts}=await import('../apps/server/src/services/catalog.js');const client=await pool.connect();try{assert.deepEqual((await searchProducts(client,simulatorContext,'M4-SCREWS')).map(p=>p.sku),['M4-SCREWS']);}finally{client.release();}
  let s=await turn(inbox,inbox.runtime,'I need two M4 screw boxes and five loose M4 screws');assert.equal(s.conversation.draft.length,2);assert.equal(s.conversation.draft[0].sku,'AAA-BOX');assert.equal(s.conversation.draft[0].unit,'box');assert.equal(s.conversation.draft[1].sku,'M4-SCREWS');assert.equal(s.conversation.draft[1].unit,'piece');assert.equal(s.conversation.pending?.kind==='review'?s.conversation.pending.totalPaise:0,19500);
  s=await turn(inbox,inbox.runtime,'review');assert.equal(s.conversation.draft[1].sku,'M4-SCREWS');assert.equal(s.conversation.draft[1].pricePaise,100);assert.match(s.messages.at(-1)!.text,/Loose M4 screws.*₹5\.00/);
  s=await turn(inbox,inbox.runtime,'yes');assert.equal(s.requests[0].totalPaise,19500);assert.equal(s.requests[0].lines[1].sku,'M4-SCREWS');assert.equal(s.requests[0].lines[1].unit,'piece');
}));

test('explicit customer price intent is read-only even when a provider would misclassify it as an addition',async()=>fixture(async(pool,inbox)=>{
  await inbox.ingest({id:randomUUID(),type:'add_item',sku:'HAMMER-500',quantity:1,expectedVersion:0});await inbox.runtime.processNext(inbox.context);const before=(await inbox.snapshot()).conversation;
  let calls=0;const provider={name:'wrong-price-classifier',mode:'mock' as const,interpret:async()=>{calls++;return {output:{operations:[{kind:'add_item',query:'PTFE-TAPE',quantity:2}],next:'review'},truncated:false,usage:null};}};
  const s=await turn(inbox,new ConversationRuntime(pool,provider),'How much for two PTFE tape rolls?');assert.deepEqual(s.conversation,before);assert.equal(calls,0);assert.match(s.messages.at(-1)!.text,/2 rolls.*₹70\.00/);assert.equal(s.requests.length,0);
  const {priceInquiry}=await import('../apps/server/src/services/shopping-language.js');assert.deepEqual(priceInquiry('Price of 1 inch PVC pipe'),{query:'1 inch pvc pipe'});assert.deepEqual(priceInquiry('Price of 2 1 inch PVC pipes'),{query:'1 inch pvc pipes',quantity:2});assert.equal(priceInquiry('Price of tape and add two rolls'),undefined);
}));

test('price variant buttons keep quote intent and quantity until the customer explicitly adds to the list',async()=>fixture(async(pool,inbox)=>{
  let s=await turn(inbox,inbox.runtime,'How much for two PVC elbows?');assert.equal(s.conversation.draft.length,0);const choice=s.messages.at(-1)!.rich!.cards![0];assert.equal(choice.label,'Check this price');assert.equal(choice.action?.type,'quote_product');
  await inbox.ingest(choice.action!);await inbox.runtime.processNext(inbox.context);s=await inbox.snapshot();assert.equal(s.conversation.draft.length,0);assert.match(s.messages.at(-1)!.text,/2 pieces.*₹36\.00/);assert.equal(s.interpretationAttempts,0);
  const add=s.messages.at(-1)!.rich!.cards![0];assert.equal(add.label,'Add to my list');await inbox.ingest(add.action!);await inbox.runtime.processNext(inbox.context);s=await inbox.snapshot();assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.requests.length,0);
}));
