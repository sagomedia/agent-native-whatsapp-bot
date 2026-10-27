import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import type {RichReply} from '../packages/contracts/index.js';

const actions=(reply:RichReply)=>[...(reply.buttons??[]),...(reply.parts??[]).flatMap(part=>[...(part.buttons??[]),...part.cards.flatMap(card=>card.buttons??[])])];

test('stalled partial review shows a bill and only explicit confirmation sends one request, without inference',async()=>{
 const schema='stalled_partial_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');const id=randomUUID(),line={id,name:'unlisted spare',query:'unlisted spare',quantity:1,resolution:'unavailable',candidates:[],clarification:{signature:'fixture',unproductiveTurns:2}};
  await pool.query('UPDATE conversations SET visual_ordering=true,partial_reviews=true,version=1,draft=$1::jsonb,pending=$2::jsonb WHERE id=$3',[JSON.stringify([line]),JSON.stringify({kind:'question',id:randomUUID(),lineId:id,version:1}),simulatorContext.conversationId]);
  let calls=0;const provider:Interpreter={name:'no-inference',mode:'mock',interpret:async()=>{calls++;throw new Error('No inference is expected for button actions');}};
  const inbox=new SimulatorService(pool),runtime=new ConversationRuntime(pool,provider,{visualOrdering:true,partialReviews:true});
  const event={id:randomUUID(),type:'review_partial' as const,expectedVersion:1};await inbox.ingest(event);assert.equal(await runtime.processNext(inbox.context),true);
  let s=await inbox.snapshot();const bill=s.messages.at(-1)!.rich!;assert.equal(bill.stage,'bill');assert.notEqual(bill.clarificationReason,'stalled_request');assert.equal(s.conversation.pending?.kind,'review');assert.equal(s.requests.length,0);
  const confirm=actions(bill).find(b=>b.event.type==='confirm')?.event;if(confirm?.type!=='confirm')throw new Error('Expected explicit confirmation');assert.equal(confirm.reviewId,s.conversation.pending.id);assert.equal(calls,0);
  await inbox.ingest(confirm);assert.equal(await runtime.processNext(inbox.context),true);s=await inbox.snapshot();assert.equal(s.requests.length,1);assert.equal(s.requests[0].lines.length,1);assert.equal(s.requests[0].lines[0].id,id);assert.equal((await pool.query('SELECT estimate_complete FROM order_requests WHERE conversation_id=$1',[simulatorContext.conversationId])).rows[0].estimate_complete,false);assert.equal(calls,0);
  await inbox.ingest(confirm);assert.equal(await runtime.processNext(inbox.context),false);assert.equal((await inbox.snapshot()).requests.length,1);assert.equal(calls,0);
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
