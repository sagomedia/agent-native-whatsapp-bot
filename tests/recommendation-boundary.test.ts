import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {GoogleInterpreter} from '../apps/server/src/adapters/google-interpreter.js';
import {GenerateContentResponse} from '@google/genai';
import {geminiTextRate} from '../apps/server/src/services/inference-budget.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';

for(const selected of [[],['H19']])test(`recommendation selection ${JSON.stringify(selected)} survives rendering and recheck without filler`,async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const schema='recommendation_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');await setupImageDemo(pool);
  const ctx={storeId:demoCatalogStore,conversationId:randomUUID(),actor:'recommendation-test',role:'customer' as const};
  await pool.query('INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,$3)',[ctx.conversationId,ctx.storeId,ctx.actor]);
  let calls=0;
  const provider:Interpreter={name:'selection-test',mode:'mock',interpret:async input=>{
   calls++;
   if(input.stage==='recommend'){
    assert.ok(input.observations?.flatMap(o=>o.products).some(p=>p.sku==='H19'));
    return {output:{operations:[],next:'assist',assistance:{queries:['cutter'],search:{keywords:['cutter'],selectedSkus:selected,preferredSkus:selected}}},usage:null,truncated:false};
   }
   return {output:{operations:[],next:'assist',assistance:{rootQuery:'cutter',queries:['PVC pipe cutter','cutting disc'],search:{keywords:['PVC pipe cutter','cutting disc']}}},usage:null,truncated:false};
  }};
  const inbox=new SimulatorService(pool,ctx),runtime=new ConversationRuntime(pool,provider,{discoveryStages:true});
  await inbox.ingest({id:randomUUID(),type:'text',text:'Show me cutters'});await runtime.processNext(ctx);
  let snapshot=await inbox.snapshot();
  assert.deepEqual(snapshot.messages.at(-1)?.rich?.cards?.map(c=>c.product.sku)??[],selected);
  assert.equal(snapshot.conversation.draft.length,0);assert.equal(calls,2);
  await inbox.ingest({id:randomUUID(),type:'text',text:'check again'});await runtime.processNext(ctx);
  snapshot=await inbox.snapshot();
  assert.deepEqual(snapshot.messages.at(-1)?.rich?.cards?.map(c=>c.product.sku)??[],selected);
  assert.equal(calls,2);assert.equal(snapshot.requests.length,0);
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});

test('planner receives real zero family counts and recommendation rejects every unsupported SKU',async()=>{
 const provider=new GoogleInterpreter({apiKey:'offline',model:geminiTextRate.model,allowPaidInference:true,budgetMicrousd:1},{generateContent:async params=>{
  const context=JSON.parse(params.contents as string);
  if(context.stage==='identify'){
   assert.equal(context.storeCatalogMap.departments[0].count,4);
   assert.equal(context.storeCatalogMap.departments[0].families[0].count,0);
  }
  return Object.assign(new GenerateContentResponse(),{modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(context.stage==='recommend'?{skus:['invented'],question:null}:{operations:[],next:'continue'})}]}}]});
 }});
 const state={version:0,draft:[],pending:null,fulfillment:'pickup' as const,lastRequestId:null};
 await provider.interpret({text:'paint',state,catalogMap:{store:{name:'fixture',type:'hardware'},productCount:4,truncated:false,departments:[{id:'surfaces',label:'Painting',count:4,families:[{id:'paint',label:'Paints',count:0,aliases:['paint']}]}]}},new AbortController().signal);
 const result=await provider.interpret({text:'paint',state,stage:'recommend',proposal:{operations:[],next:'assist',assistance:{queries:['paint']}},observations:[]},new AbortController().signal);
 assert.deepEqual((result.output as any).assistance.search.selectedSkus,[]);
});
