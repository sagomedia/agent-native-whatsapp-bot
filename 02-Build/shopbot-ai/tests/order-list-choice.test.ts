import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import type {Operation,SimulatorEvent,Snapshot,RichReply} from '../packages/contracts/index.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import {normalizeVoice,pcmWav} from '../apps/server/src/services/voice-media.js';

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService,runtime:ConversationRuntime,plan:(ops:Operation[])=>void,calls:()=>number)=>Promise<void>){
 const schema='list_choice_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');await setupImageDemo(pool);const id=randomUUID();await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language) VALUES($1,$2,'list-choice','ta')",[id,demoCatalogStore]);
  const inbox=new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'list-choice',role:'customer'});let ops:Operation[]=[{kind:'add_item',query:'H08',quantity:1}],calls=0;
  const provider:Interpreter={name:'list-choice-fixture',mode:'mock',supportsAudio:true,interpret:async input=>{calls++;return {usage:null,truncated:false,output:input.stage==='recognize'?{transcript:'rendu pipe cutter venum',operations:[],next:'continue'}:{operations:ops,next:'review'}};}};
  const runtime=new ConversationRuntime(pool,provider,{visualOrdering:true,mediaRecommendations:true,partialReviews:true});
  let s=await send(inbox,runtime,{id:randomUUID(),type:'text',text:'one teflon tape'});s=await send(inbox,runtime,action(s,'confirm_products'));s=await send(inbox,runtime,action(s,'confirm'));assert.equal(s.requests.length,1);
  await run(pool,inbox,runtime,value=>{ops=value;},()=>calls);
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
const last=(s:Snapshot)=>s.messages.at(-1)!.rich!;
const actions=(r:RichReply)=>r.parts?.flatMap(p=>[...p.buttons??[],...p.cards.flatMap(c=>c.buttons??[])])??r.buttons??[];
const action=(s:Snapshot,type:SimulatorEvent['type'],choice?:string)=>{const found=actions(last(s)).find(b=>b.event.type===type&&(!choice||b.event.type==='shopping_action'&&b.event.action===choice));assert.ok(found,JSON.stringify(last(s)));return found.event;};
async function send(inbox:SimulatorService,runtime:ConversationRuntime,event:SimulatorEvent){await inbox.ingest(event);await runtime.processNext(inbox.context);return inbox.snapshot();}
const text=(inbox:SimulatorService,runtime:ConversationRuntime,value:string)=>send(inbox,runtime,{id:randomUUID(),type:'text',text:value});
async function voice(inbox:SimulatorService,runtime:ConversationRuntime){const id=randomUUID(),pcm=Buffer.alloc(32000);for(let i=0;i<16000;i++)pcm.writeInt16LE(Math.round(Math.sin(i*.17)*1200),i*2);await inbox.ingest({id,type:'voice',mediaId:id},await normalizeVoice({id,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')}));await runtime.processNext(inbox.context);return inbox.snapshot();}

for(const mode of ['text','voice'])test(`${mode}: one item after submission asks the list target and new-list tap replays it once`,()=>fixture(async(pool,inbox,runtime,plan,calls)=>{
 const before=await inbox.snapshot(),old=before.requests[0];plan([{kind:'add_item',query:'H19',quantity:2}]);
 let s=mode==='voice'?await voice(inbox,runtime):await text(inbox,runtime,'two pipe cutters');assert.equal(last(s).clarificationReason,'order_list_choice');assert.ok(last(s).text.length<160);assert.deepEqual(s.conversation.draft,before.conversation.draft);assert.equal(s.conversation.lastRequestId,old.id);
 const choose=action(s,'shopping_action','new_list'),count=calls();
 await pool.query('UPDATE stores SET catalog_revision=catalog_revision+1 WHERE id=$1',[demoCatalogStore]);
 s=await send(inbox,runtime,choose);assert.equal(calls(),count,'no repeated speech or inference');assert.equal(s.conversation.lastRequestId,null);assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].sku,'H19');assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.requests.length,1);assert.deepEqual(s.requests[0].lines,old.lines);
 await inbox.ingest(choose);assert.equal(await runtime.processNext(inbox.context),false);assert.equal((await inbox.snapshot()).conversation.draft.length,1);
}));

test('explicit add asks the target, and existing-order choice creates a consent proposal without silently editing the order',()=>fixture(async(pool,inbox,runtime,plan)=>{
 const old=(await inbox.snapshot()).requests[0];plan([{kind:'add_item',query:'H19',quantity:2}]);let s=await text(inbox,runtime,'add two pipe cutters');assert.equal(last(s).clarificationReason,'order_list_choice');
 s=await send(inbox,runtime,action(s,'shopping_action','continue_list'));assert.ok(actions(last(s)).some(b=>b.event.type==='confirm_amendment'));assert.deepEqual(s.requests[0].lines,old.lines);const row=(await pool.query('SELECT * FROM order_amendments')).rows[0];assert.equal(row.state,'proposed');assert.equal(row.proposed_lines.find((l:any)=>l.sku==='H19').quantity,2);assert.equal(row.proposed_lines.find((l:any)=>l.sku==='H08').quantity,1);assert.equal(s.requests.length,1);
}));

test('greeting asks the target and selecting existing order remembers the choice for the next item',()=>fixture(async(_pool,inbox,runtime,plan)=>{
 let s=await text(inbox,runtime,'hi');assert.equal(last(s).clarificationReason,'order_list_choice');s=await send(inbox,runtime,action(s,'shopping_action','continue_list'));assert.match(last(s).text,/என்ன சேர்க்கணும்/);
 plan([{kind:'add_item',query:'H19',quantity:2}]);s=await text(inbox,runtime,'two pipe cutters');assert.ok(actions(last(s)).some(b=>b.event.type==='confirm_amendment'));assert.notEqual(last(s).clarificationReason,'order_list_choice');
}));

test('an order closed after the choice cannot be amended and the saved request can still start a new list',()=>fixture(async(pool,inbox,runtime,plan)=>{
 plan([{kind:'add_item',query:'H19',quantity:2}]);let s=await text(inbox,runtime,'two pipe cutters');const add=action(s,'shopping_action','continue_list');await pool.query("UPDATE order_requests SET fulfillment='collected' WHERE id=$1",[s.conversation.lastRequestId]);s=await send(inbox,runtime,add);assert.equal((await pool.query('SELECT count(*)::int n FROM order_amendments')).rows[0].n,0);assert.ok(!actions(last(s)).some(b=>b.event.type==='shopping_action'&&b.event.action==='continue_list'));s=await send(inbox,runtime,action(s,'shopping_action','new_list'));assert.equal(s.conversation.draft[0].sku,'H19');assert.equal(s.conversation.draft[0].quantity,2);
}));

test('a replaced list-choice button cannot apply a newer saved request',()=>fixture(async(_pool,inbox,runtime,plan)=>{
 plan([{kind:'add_item',query:'H19',quantity:2}]);let s=await text(inbox,runtime,'two pipe cutters');const old=action(s,'shopping_action','new_list'),request=s.conversation.lastRequestId;plan([{kind:'add_item',query:'H29',quantity:1}]);s=await text(inbox,runtime,'one pair of gloves');s=await send(inbox,runtime,old);assert.equal(s.conversation.lastRequestId,request);assert.equal(s.conversation.draft[0].sku,'H08');assert.equal(s.requests.length,1);
}));
