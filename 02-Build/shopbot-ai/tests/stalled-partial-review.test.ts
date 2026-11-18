import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import {productColumns,productFromRow} from '../apps/server/src/services/catalog.js';
import {productIdentity} from '../apps/server/src/services/product-confirmation.js';
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

test('checkout explains the blocking line and gives an exit when partial submission is disabled',async()=>{
 const schema='blocked_checkout_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');
  const line={id:randomUUID(),name:'unlisted spare',query:'unlisted spare',quantity:1,resolution:'unavailable'};
  const product=productFromRow((await pool.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,price_status,stock,selling_unit_verified)
   VALUES($1,'VERIFIED-ELBOW','PVC elbow','piece',9500,'priced',10,true) RETURNING ${productColumns}`,[simulatorContext.storeId])).rows[0]);
  const priced={id:randomUUID(),name:product.name,sku:product.sku,quantity:1,unit:product.unit,pricePaise:product.pricePaise,productVersion:product.version,resolution:'matched',candidates:[product],productConfirmation:{sku:product.sku,version:product.version,identityHash:productIdentity(product)}};
  await pool.query("UPDATE conversations SET visual_ordering=true,partial_reviews=false,reply_language='en',version=1,draft=$1::jsonb WHERE id=$2",[JSON.stringify([priced,line]),simulatorContext.conversationId]);
  const provider:Interpreter={name:'no-inference',mode:'mock',interpret:async()=>{throw Error('Checkout actions do not need interpretation');}};
  const inbox=new SimulatorService(pool),runtime=new ConversationRuntime(pool,provider,{visualOrdering:true,partialReviews:false});
  for(const trigger of ['Bill','checkout','send it']){
   await inbox.ingest({id:randomUUID(),type:'text',text:trigger});
   assert.equal(await runtime.processNext(inbox.context),true);
   const snapshot=await inbox.snapshot(),reply=snapshot.messages.at(-1)!.rich!;
   assert.match(reply.text,/shop needs to check “unlisted spare”/i,`trigger: ${trigger}, stage: ${reply.stage}, pending: ${snapshot.conversation.pending?.kind}, rows: ${snapshot.conversation.draft.map(l=>l.resolution+'/'+!!l.productConfirmation).join(',')}`);
   if(trigger==='Bill')assert.match(reply.text,/Known subtotal: ₹95/);
   assert.ok(actions(reply).some(b=>b.event.type==='edit_item'&&b.event.lineId===line.id));
   assert.ok(actions(reply).some(b=>b.event.type==='shopping_action'&&b.event.action==='handoff'));
   assert.ok(!actions(reply).some(b=>['review','review_partial','confirm'].includes(b.event.type)));
   assert.deepEqual(snapshot.conversation.draft.map(item=>item.id),[priced.id,line.id]);
   assert.equal(snapshot.requests.length,0);
  }
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
