import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';

test('generic refinements retain earlier qualifiers; explicit replacements change only that line',async()=>{
 const schema='refinement_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');await setupImageDemo(pool);
  const conversationId=randomUUID();
  await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'refinement-test')",[conversationId,demoCatalogStore]);
  const inbox=new SimulatorService(pool,{storeId:demoCatalogStore,conversationId,actor:'refinement-test',role:'customer'});
  let output:unknown={operations:[{kind:'add_item',query:'Asian Paints',quantity:1},{kind:'add_item',query:'pipe',quantity:2}],next:'review'};
  const provider:Interpreter={name:'refinement-test',mode:'mock',interpret:async()=>({output,truncated:false,usage:null})};
  const runtime=new ConversationRuntime(pool,provider,{sequentialItems:true});
  const turn=async(text:string)=>{await inbox.ingest({id:randomUUID(),type:'text',text});await runtime.processNext(inbox.context);return inbox.snapshot();};
  let s=await turn('I need one Asian Paints and two pipes.');
  const [paint,pipe]=s.conversation.draft;
  output={operations:[{kind:'resolve_line',lineId:paint.id,query:'wall paint',quantity:1}],next:'review'};
  s=await turn('இல்ல இல்ல அதெல்லாம் இல்ல பெயிண்ட் சுவருல அடிக்கிற பெயிண்ட் வேணும்.');
  assert.equal(s.conversation.draft[0].query,'Asian Paints wall paint');
  assert.equal(s.conversation.draft[0].id,paint.id);assert.deepEqual(s.conversation.draft[1],pipe);
  output={operations:[{kind:'resolve_line',lineId:paint.id,query:'cutting plier',quantity:1}],next:'review'};
  s=await turn('Change only that paint item to one cutting plier.');
  assert.equal(s.conversation.draft[0].query,'cutting plier');assert.deepEqual(s.conversation.draft[1],pipe);
  output={operations:[{kind:'resolve_line',lineId:paint.id,query:'Asian Paints wall paint',quantity:1}],next:'review'};
  await turn('Change it back to Asian Paints wall paint.');
  output={operations:[{kind:'resolve_line',lineId:paint.id,query:'wall paint',quantity:1}],next:'review'};
  s=await turn('Any brand wall paint is fine.');
  assert.equal(s.conversation.draft[0].query,'wall paint');assert.deepEqual(s.conversation.draft[1],pipe);assert.equal(s.requests.length,0);
  output={operations:[{kind:'resolve_line',lineId:paint.id,query:'wood paint',quantity:1}],next:'review'};
  await turn('Change it to wood paint.');
  output={operations:[{kind:'resolve_line',lineId:paint.id,query:'wall paint',quantity:1}],next:'review'};
  s=await turn('I want wall paint.');
  assert.equal(s.conversation.draft[0].query,'wall paint');assert.deepEqual(s.conversation.draft[1],pipe);
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
