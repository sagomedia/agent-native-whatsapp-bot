import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {MockInterpreter} from '../apps/server/src/adapters/mock-interpreter.js';
import {digest} from '../apps/server/src/services/tools.js';
import type {DraftLine,RichReply} from '../packages/contracts/index.js';

const actions=(reply:RichReply)=>[...(reply.buttons??[]),...(reply.parts??[]).flatMap(p=>[...(p.buttons??[]),...p.cards.flatMap(c=>c.buttons??[])])];
async function fixture(run:(pool:pg.Pool,inbox:SimulatorService,runtime:ConversationRuntime)=>Promise<void>){
 const schema='partial_recovery_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');await run(pool,new SimulatorService(pool),new ConversationRuntime(pool,new MockInterpreter(),{visualOrdering:true,partialReviews:true}));}
 finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
test('rejected partial submission explains recovery and requires fresh consent with all five requests kept',()=>fixture(async(pool,inbox,runtime)=>{
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,version) VALUES($1,'RECOVER-SPIRIT','Spirit level','piece',12000,10,1)",[simulatorContext.storeId]);
 const lines:DraftLine[]=[{id:randomUUID(),sku:'RECOVER-SPIRIT',name:'Spirit level',query:'spirit level',unit:'piece',quantity:1,pricePaise:12000,productVersion:1,resolution:'matched',candidates:[]},...['solvent','tape','tap','screw box'].map(name=>({id:randomUUID(),name,query:name,quantity:name==='tap'?null:1,resolution:'unavailable' as const,candidates:[]}))];
 const snapshot={lines,fulfillment:'pickup' as const,totalPaise:0,excludedLineIds:lines.map(l=>l.id)};
 const reviewId=randomUUID(),pending={kind:'review',id:reviewId,version:1,hash:digest(snapshot),expiresAt:new Date(Date.now()+600000).toISOString(),...snapshot};
 await pool.query('UPDATE conversations SET visual_ordering=true,partial_reviews=true,version=1,draft=$1::jsonb,pending=$2::jsonb WHERE id=$3',[JSON.stringify(lines),JSON.stringify(pending),simulatorContext.conversationId]);
 await inbox.ingest({id:randomUUID(),type:'confirm',reviewId});assert.equal(await runtime.processNext(inbox.context),true);
 const result=await inbox.snapshot(),reply=result.messages.at(-1)!.rich!;
 assert.equal(result.requests.length,0);assert.equal(result.conversation.draft.length,5);assert.deepEqual(result.conversation.draft.map(l=>l.id),lines.map(l=>l.id));
 assert.match(reply.text,/Nothing was sent to the shop/);assert.match(reply.text,/confirm again/);
 assert.notEqual(result.conversation.pending?.id,reviewId);
 assert.ok(result.conversation.pending?.kind==='products'||result.conversation.pending?.kind==='review');
 assert.ok(!actions(reply).some(b=>b.event.type==='confirm'&&b.event.reviewId===reviewId));
}));
