import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {GoogleInterpreter} from '../apps/server/src/adapters/google-interpreter.js';
import {geminiTextRate} from '../apps/server/src/services/inference-budget.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>) {
  const connectionString=process.env.DATABASE_URL;
  const admin=new pg.Pool({connectionString}),schema='agent_assist_'+randomUUID().replaceAll('-','');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool=new pg.Pool({connectionString,options:`-c search_path=${schema}`});
  try {await setupDatabase(pool,'mock');await run(pool,new SimulatorService(pool));}
  finally {await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
async function turn(inbox:SimulatorService,runtime:ConversationRuntime,text:string) {
  await inbox.ingest({id:randomUUID(),type:'text',text});await runtime.processNext(inbox.context);return inbox.snapshot();
}
test('rechecking remembers the missing item, searches again without AI, and never substitutes screws for a screwdriver',async()=>fixture(async(pool,inbox)=>{
  let calls=0;
  const provider:Interpreter={name:'observed-missing-item',mode:'mock',interpret:async input=>{
    calls++;assert.equal(input.observations?.[0].query,'screw driver');assert.equal(input.observations?.[0].totalCount,0);
    return {output:{operations:[{kind:'add_item',query:'screw driver',quantity:null}],next:'review',clarifyQuestion:'What will you use the screwdriver for?'},truncated:false,usage:null};
  }};
  const runtime=new ConversationRuntime(pool,provider);
  let s=await turn(inbox,runtime,'I want screw driver');const before=s.conversation;
  assert.match(s.messages.at(-1)!.text,/no matching listing/);
  s=await turn(inbox,runtime,'check again');assert.deepEqual(s.conversation,before);assert.equal(calls,1);
  assert.match(s.messages.at(-1)!.text,/I checked again.*screw driver.*screwdriver.*no matching listing/s);
  assert.equal(s.messages.at(-1)!.rich?.cards,undefined);assert.equal(s.requests.length,0);
  const searches=(await pool.query("SELECT result FROM tool_receipts WHERE tool_name='search_products'")).rows;
  assert.ok(searches.length>=4);assert.equal(s.messages.at(-1)!.rich?.outboundMessages,1);
}));
test('a newly listed compound-name product can be chosen after recheck without duplicating the original request',async()=>fixture(async(pool,inbox)=>{
  const provider:Interpreter={name:'missing-then-found',mode:'mock',interpret:async()=>({output:{operations:[{kind:'add_item',query:'screw driver',quantity:2},{kind:'add_item',query:'PTFE-TAPE',quantity:1}],next:'review'},truncated:false,usage:null})};
  let runtime=new ConversationRuntime(pool,provider),s=await turn(inbox,runtime,'I need two screw drivers and one tape roll');
  const ids=s.conversation.draft.map(l=>l.id);
  await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock) VALUES($1,'DRIVER','Phillips Screwdriver','piece',9000,10)",[simulatorContext.storeId]);
  // Restarted runtime reads durable assistant memory, rather than process memory.
  runtime=new ConversationRuntime(pool,{name:'must-not-call',mode:'mock',interpret:async()=>{throw new Error('recheck must not call AI');}});
  s=await turn(inbox,runtime,'can you check again?');assert.equal(s.conversation.draft.length,2);
  const card=s.messages.at(-1)!.rich!.cards![0];assert.equal(card.product.sku,'DRIVER');assert.equal(card.action!.type,'select_candidate');
  await inbox.ingest(card.action!);await runtime.processNext(inbox.context);s=await inbox.snapshot();
  assert.deepEqual(s.conversation.draft.map(l=>l.id),ids);assert.equal(s.conversation.draft[0].sku,'DRIVER');assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.conversation.pending?.kind,'review');assert.equal(s.interpretationAttempts,1);assert.equal(s.requests.length,0);
}));
test('model-chosen discovery queries run real tools and feed durable observations into the next decision',async()=>fixture(async(pool,inbox)=>{
  let calls=0;
  const provider:Interpreter={name:'use-based-planner',mode:'mock',interpret:async input=>{
    calls++;
    if(calls===2){assert.deepEqual(input.assistantMemory?.queries,['WRENCH-10','HAMMER-500']);assert.equal(input.assistantMemory?.observations[0].products[0].sku,'WRENCH-10');}
    return {output:{operations:[],next:'assist',assistance:{queries:calls===1?['WRENCH-10','HAMMER-500']:['WRENCH-10'],question:calls===1?'What kind of work are you doing?':'Is this the tool you had in mind?'}},truncated:false,usage:null};
  }};
  const runtime=new ConversationRuntime(pool,provider);
  let s=await turn(inbox,runtime,'What tools can you show for my job?');assert.equal(s.conversation.draft.length,0);assert.equal(s.messages.at(-1)!.rich?.cards?.length,2);assert.match(s.messages.at(-1)!.text,/What kind of work/);
  s=await turn(inbox,new ConversationRuntime(pool,provider),'I need to grip and turn a nut');assert.equal(s.conversation.draft.length,0);assert.equal(s.messages.at(-1)!.rich?.cards?.length,1);
  await inbox.ingest(s.messages.at(-1)!.rich!.cards![0].action!);await runtime.processNext(inbox.context);s=await inbox.snapshot();assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].sku,'WRENCH-10');assert.equal(s.conversation.draft[0].quantity,null);assert.equal(s.requests.length,0);
}));
test('an alternative shown for a pending item resolves that item only after an explicit current selection',async()=>fixture(async(pool,inbox)=>{
  let calls=0;
  const provider:Interpreter={name:'alternative-plan',mode:'mock',interpret:async input=>({output:++calls===1?{operations:[{kind:'add_item',query:'unknown wrench',quantity:1}],next:'review'}:{operations:[],next:'assist',assistance:{queries:['WRENCH-10'],lineId:input.state.pending?.kind==='question'?input.state.pending.lineId:undefined,question:'Would this adjustable wrench fit your task?'}},truncated:false,usage:null})};
  const runtime=new ConversationRuntime(pool,provider);let s=await turn(inbox,runtime,'I want one unknown wrench');const original=s.conversation;
  s=await turn(inbox,runtime,'Do you have an alternative?');assert.deepEqual(s.conversation,original);const card=s.messages.at(-1)!.rich!.cards![0];
  await inbox.ingest(card.action!);await runtime.processNext(inbox.context);s=await inbox.snapshot();assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].id,original.draft[0].id);assert.equal(s.conversation.draft[0].sku,'WRENCH-10');assert.equal(s.requests.length,0);
  await inbox.ingest({...card.action!,id:randomUUID()});await runtime.processNext(inbox.context);assert.match((await inbox.snapshot()).messages.at(-1)!.text,/stale/);
}));
test('read-only assistance refuses mixed mutations and ungrounded commerce questions',async()=>fixture(async(pool,inbox)=>{
  const invalid:Interpreter={name:'invalid-assist',mode:'mock',interpret:async()=>({output:{operations:[{kind:'add_item',query:'HAMMER-500',quantity:2}],next:'assist',assistance:{queries:['HAMMER-500']}},truncated:false,usage:null})};
  let s=await turn(inbox,new ConversationRuntime(pool,invalid),'show me options');assert.equal(s.conversation.draft.length,0);assert.equal(s.requests.length,0);
  const ungrounded:Interpreter={name:'commerce-question',mode:'mock',interpret:async()=>({output:{operations:[],next:'assist',assistance:{queries:['HAMMER-500'],question:'Shall I deliver the in stock hammer for ₹1?'}},truncated:false,usage:null})};
  s=await turn(inbox,new ConversationRuntime(pool,ungrounded),'show hammer');assert.doesNotMatch(s.messages.at(-1)!.text,/deliver|in stock|₹1/);assert.equal(s.messages.at(-1)!.rich?.cards![0].product.pricePaise,35000);assert.equal(s.conversation.draft.length,0);
}));
test('quota denial is described as a limit and a recheck still works without another provider request',async()=>fixture(async(pool,inbox)=>{
  let calls=0;
  const provider=new GoogleInterpreter({allowPaidInference:false,apiKey:'offline',model:geminiTextRate.model,budgetMicrousd:0,freeQuota:{scope:'agent-guard-'+randomUUID(),model:geminiTextRate.model}},{generateContent:async()=>{
    calls++;return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({operations:[{kind:'add_item',query:'screw driver',quantity:null}],next:'review'})}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:50,totalTokenCount:150}} as any;
  }});
  const runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});let s=await turn(inbox,runtime,'I want screw driver');const before=s.conversation;
  s=await turn(inbox,runtime,'Could you look for an alternative tool?');assert.deepEqual(s.conversation,before);assert.match(s.messages.at(-1)!.text,/temporarily at the AI request limit/);assert.doesNotMatch(s.messages.at(-1)!.text,/understand/);assert.equal(calls,1);
  s=await turn(inbox,runtime,'check again');assert.match(s.messages.at(-1)!.text,/I checked again/);assert.equal(calls,1);assert.deepEqual(s.conversation,before);
}));
test('queued rechecks cannot jump from the earlier item to the next pending question',async()=>fixture(async(pool,inbox)=>{
  const provider:Interpreter={name:'queued-recheck',mode:'mock',interpret:async()=>({output:{operations:[{kind:'add_item',query:'PTFE-TAPE',quantity:null},{kind:'add_item',query:'WRENCH-10',quantity:null}],next:'review'},truncated:false,usage:null})};
  const runtime=new ConversationRuntime(pool,provider);await turn(inbox,runtime,'tape and wrench');
  await inbox.ingest({id:randomUUID(),type:'text',text:'2 rolls'});await inbox.ingest({id:randomUUID(),type:'text',text:'check again'});await runtime.processNext(inbox.context);await runtime.processNext(inbox.context);
  const s=await inbox.snapshot();assert.equal(s.conversation.draft[1].quantity,null);assert.match(s.messages.at(-1)!.text,/earlier question/);assert.equal(s.interpretationAttempts,1);
}));
test('yes binds to a displayed discovery option but cannot add a price quote or an unseen queued option',async()=>fixture(async(pool,inbox)=>{
  const provider:Interpreter={name:'single-option',mode:'mock',interpret:async()=>({output:{operations:[],next:'assist',assistance:{queries:['WRENCH-10'],question:'Is this the tool you need?'}},truncated:false,usage:null})};
  const runtime=new ConversationRuntime(pool,provider);
  await inbox.ingest({id:randomUUID(),type:'text',text:'show a tool'});await inbox.ingest({id:randomUUID(),type:'text',text:'yes'});await runtime.processNext(inbox.context);await runtime.processNext(inbox.context);
  let s=await inbox.snapshot();assert.equal(s.conversation.draft.length,0);assert.match(s.messages.at(-1)!.text,/earlier option/);
  s=await turn(inbox,runtime,'yes');assert.equal(s.conversation.draft[0].sku,'WRENCH-10');assert.equal(s.conversation.draft[0].quantity,null);assert.equal(s.requests.length,0);assert.equal(s.interpretationAttempts,1);
  await turn(inbox,runtime,'clear my list');await turn(inbox,runtime,'price of PTFE tape');s=await turn(inbox,runtime,'yes');assert.equal(s.conversation.draft.length,0);assert.equal(s.requests.length,0);
}));
test('the native planning prompt includes current and remembered tool observations without hidden memory identity or raw pricing',async()=>{
  const observation={tool:'search_products' as const,query:'cutter',products:[{sku:'CUTTER',name:'PVC cutter',unit:'piece',pricePaise:99900,stock:null,version:1,aliases:['pipe cutter'],quantityStep:1}],totalCount:1};
  const provider=new GoogleInterpreter({allowPaidInference:false,apiKey:'offline',model:geminiTextRate.model,budgetMicrousd:0,freeQuota:{scope:'prompt-test',model:geminiTextRate.model}},{generateContent:async params=>{
    const content=JSON.parse(String(params.contents));assert.equal(content.toolObservations[0].products[0].sku,'CUTTER');assert.equal(content.assistantMemory.observations[0].products[0].name,'PVC cutter');assert.equal(content.assistantMemory.id,undefined);assert.equal(content.toolObservations[0].products[0].pricePaise,undefined);
    return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({operations:[],next:'assist',assistance:{queries:['CUTTER'],question:'What diameter is your pipe?'}})}]}}]} as any;
  }});
  const result=await provider.interpret({text:'for my pipe',state:{version:0,draft:[],pending:null,fulfillment:'pickup',lastRequestId:null},observations:[observation],assistantMemory:{id:randomUUID(),purpose:'discovery',queries:['cutter'],lineId:null,sourceVersion:0,observations:[observation]}},AbortSignal.timeout(1000));
  assert.equal((result.output as any).next,'assist');
});
test('unrelated discovery while another item is pending adds the selected new item without replacing the old request',async()=>fixture(async(pool,inbox)=>{
  let calls=0;
  const provider:Interpreter={name:'two-goals',mode:'mock',interpret:async()=>({output:++calls===1?{operations:[{kind:'add_item',query:'screwdriver',quantity:null}],next:'review'}:{operations:[],next:'assist',assistance:{queries:['HAMMER-500'],question:'Is this the hammer you need?'}},truncated:false,usage:null})};
  const runtime=new ConversationRuntime(pool,provider);let s=await turn(inbox,runtime,'I need a screwdriver');const original=s.conversation.draft[0];
  s=await turn(inbox,runtime,'Also show me a hammer');assert.equal(s.messages.at(-1)!.rich!.cards![0].action!.type,'choose_product');assert.equal(s.conversation.draft.length,1);
  s=await turn(inbox,runtime,'yes');assert.equal(s.conversation.draft.length,2);assert.deepEqual(s.conversation.draft[0],original);assert.equal(s.conversation.draft[1].sku,'HAMMER-500');assert.equal(s.requests.length,0);
}));
test('price rechecks preserve their product and quantity despite an unrelated pending item',async()=>fixture(async(pool,inbox)=>{
  let s=await turn(inbox,inbox.runtime,'I need some PVC elbows');const before=s.conversation;
  s=await turn(inbox,inbox.runtime,'How much for two PTFE tape rolls?');assert.deepEqual(s.conversation,before);
  s=await turn(inbox,inbox.runtime,'check again');assert.deepEqual(s.conversation,before);assert.match(s.messages.at(-1)!.text,/PTFE.*2 rolls.*₹70\.00/);assert.equal(s.messages.at(-1)!.rich!.cards![0].label,'Add to my list');assert.equal(s.messages.at(-1)!.rich!.cards![0].action!.type,'choose_product');
  s=await turn(inbox,inbox.runtime,'yes');assert.deepEqual(s.conversation,before);assert.match(s.messages.at(-1)!.text,/price check.*nothing has been added/);assert.equal(s.requests.length,0);
}));
test('a model cannot attach search alternatives to a nonexistent or unrelated draft line',async()=>fixture(async(pool,inbox)=>{
  const provider:Interpreter={name:'wrong-search-scope',mode:'mock',interpret:async()=>({output:{operations:[],next:'assist',assistance:{queries:['HAMMER-500'],lineId:randomUUID()}},truncated:false,usage:null})};
  const s=await turn(inbox,new ConversationRuntime(pool,provider),'show me an alternative');assert.equal(s.conversation.draft.length,0);assert.equal(s.messages.at(-1)!.rich?.cards,undefined);assert.match(s.messages.at(-1)!.text,/earlier item/);assert.equal(s.requests.length,0);
}));
