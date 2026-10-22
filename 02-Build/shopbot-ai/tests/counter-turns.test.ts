import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import pg from 'pg';
import type {Operation,RichReply,SimulatorEvent,Snapshot} from '../packages/contracts/index.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>) {
  const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const schema='counter_'+randomUUID().replaceAll('-','');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
  try {
    await setupDatabase(pool,'mock');
    await setupImageDemo(pool);
    // Explicit synthetic merchant facts, independent from the demo SKU labels.
    await pool.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,stock,specifications,image_path,selling_unit_verified)
      VALUES($1,'PAINT10','White paint 10 litre','can',120000,4,'{"size":"10L"}',NULL,true),
      ($1,'COUNTER-SCRAPER-4','Wall scraper 4 inch','piece',6500,8,'{"size":"4 inch"}',NULL,true)`,[demoCatalogStore]);
    const id=randomUUID();
    await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language) VALUES($1,$2,'counter-test','en')",[id,demoCatalogStore]);
    const inbox=new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'counter-test',role:'customer'});
    await run(pool,inbox);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}

function planner(operations:Operation[]):Interpreter {
  return {name:'counter-offline',mode:'mock',interpret:async input=>({output:input.text==='keep my list'
    ?{operations:[],next:'continue',conversation:'pause'}:{operations,next:'review'},usage:null,truncated:false})};
}
async function turn(inbox:SimulatorService,runtime:ConversationRuntime,event:SimulatorEvent|string) {
  await inbox.ingest(typeof event==='string'?{id:randomUUID(),type:'text',text:event}:event);
  assert.equal(await runtime.processNext(inbox.context),true);
  return inbox.snapshot();
}
function lastReply(snapshot:Snapshot) {return snapshot.messages.filter(m=>m.direction==='outbound').at(-1)!.rich!;}
function buttons(reply:RichReply) {
  return [...reply.buttons??[],...reply.parts?.flatMap(p=>[...p.buttons??[],...p.cards.flatMap(c=>c.buttons??[])])??[]];
}
function action(snapshot:Snapshot,predicate:(event:SimulatorEvent)=>boolean) {
  const found=buttons(lastReply(snapshot)).find(b=>predicate(b.event));
  assert.ok(found,`Expected action in ${JSON.stringify(visible(lastReply(snapshot)))}`);
  return found.event;
}

// Snapshot all customer-visible surfaces; IDs, PNG hashes and clocks are not wording.
function visible(reply:RichReply) {
  const rendered=renderWhatsAppReply(reply,'counter-transcript','example.test');
  return JSON.parse(JSON.stringify({
    stage:reply.stage,text:reply.text,
    cards:reply.parts?.flatMap(p=>p.cards.map(c=>({kind:c.kind,caption:c.caption,
      ...(c.kind==='product'?{sku:c.product.sku,name:c.product.name}: {title:c.title,lines:c.lines,billRows:c.billRows,total:c.total})})))??[],
    actions:rendered.actions.map(a=>({label:a.label,type:a.event.type,
      ...(a.event.type==='shopping_action'?{action:a.event.action}:{}),
      ...(a.event.type==='select_product'?{sku:a.event.sku}:{}),
      ...(a.event.type==='choose_pipe_type'?{pipeType:a.event.pipeType}:{})})),
  }));
}
function visibleTurn(snapshot:Snapshot){const message=snapshot.messages.filter(m=>m.direction==='outbound').at(-1)!;return snapshot.messages.filter(m=>m.direction==='outbound'&&(message.rich?.groupId?m.rich?.groupId===message.rich.groupId:m.id===message.id)).map(m=>visible(m.rich!));}
function textOnPhone(reply:RichReply) {
  const frame=visible(reply);
  return [frame.text,...frame.cards.flatMap((c:{caption:string;lines?:string[];billRows?:Record<string,string>[];total?:string})=>[c.caption,...c.lines??[],...c.billRows?.map(row=>Object.values(row).join(' '))??[],c.total??''])].join('\n');
}

const fiveItems:Operation[]=[
  {kind:'add_item',query:'1 inch pipe',quantity:1,productMeasures:[{value:1,unit:'inch'}],supportingPhrase:'one 1 inch pipe'},
  {kind:'add_item',query:'0.75 inch pipe',quantity:1,productMeasures:[{value:0.75,unit:'inch'}],supportingPhrase:'one 0.75 inch pipe'},
  {kind:'add_item',query:'COUNTER-SCRAPER-4',quantity:1,supportingPhrase:'one scraper'},
  {kind:'add_item',query:'H19',quantity:1,supportingPhrase:'one PVC pipe cutter'},
  {kind:'add_item',query:'PAINT10',quantity:1,supportingPhrase:'one 10L can white paint'},
];
const shoppingList='one 1 inch pipe, one 0.75 inch pipe, one scraper, one PVC pipe cutter, one 10L can white paint';

test('missing pack count asks a focused question before photo confirmation, never send or a zero bill',()=>fixture(async(pool,inbox)=>{
  const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'PAINT10',quantity:null,packSize:{value:10,unit:'litre'}}]),{visualOrdering:true});
  let snapshot=await turn(inbox,runtime,'10L white paint');
  const reply=lastReply(snapshot);
  assert.equal(snapshot.conversation.draft[0].quantity,null);
  assert.ok(!buttons(reply).some(b=>b.event.type==='shopping_action'&&b.event.action==='finish_order'));
  assert.doesNotMatch(textOnPhone(reply),/₹0\.00|send my list to the store|Review the estimated bill/i);
  assert.equal(lastReply(snapshot).stage,'quantity');
  snapshot=await turn(inbox,runtime,'two cans');
  snapshot=await turn(inbox,runtime,action(snapshot,e=>e.type==='confirm_products'));
  assert.equal(snapshot.conversation.pending?.kind,'review');
  assert.equal(snapshot.conversation.draft[0].quantity,2);
  assert.equal(snapshot.requests.length,0);
}));

test('pipe choice retains the diameter and progresses this line before the second pipe',()=>fixture(async(pool,inbox)=>{
  const runtime=new ConversationRuntime(pool,planner(fiveItems),{visualOrdering:true});
  let snapshot=await turn(inbox,runtime,shoppingList);
  const ids=snapshot.conversation.draft.map(l=>l.id);
  snapshot=await turn(inbox,runtime,action(snapshot,e=>e.type==='choose_pipe_type'&&e.pipeType==='pvc'));
  assert.deepEqual(snapshot.conversation.draft.map(l=>l.id),ids);
  assert.deepEqual(snapshot.conversation.draft[0].productMeasures,[{value:1,unit:'inch'}]);
  assert.match(textOnPhone(lastReply(snapshot)),/1 inch PVC pipe/i);
  assert.doesNotMatch(textOnPhone(lastReply(snapshot)),/PVC pipe: shop check needed/);
  assert.equal(snapshot.conversation.pending?.kind,'products');
  if(snapshot.conversation.pending?.kind!=='products')throw Error('Expected variants');
  assert.deepEqual(snapshot.conversation.pending.groups.find(g=>g.lineId===ids[0])!.products.map(p=>p.sku).sort(),['H01','H02']);
  snapshot=await turn(inbox,runtime,action(snapshot,e=>e.type==='select_product'&&e.sku==='H01'));
  assert.match(textOnPhone(lastReply(snapshot)),/0\.75 inch pipe/);
  assert.equal(snapshot.conversation.pending?.kind,'question');
  if(snapshot.conversation.pending?.kind==='question')assert.equal(snapshot.conversation.pending.lineId,ids[1]);
}));

test('read-only cutter price answers the question without cart noise or changing its pending choice',()=>fixture(async(pool,inbox)=>{
  const runtime=new ConversationRuntime(pool,planner(fiveItems),{visualOrdering:true});
  let snapshot=await turn(inbox,runtime,shoppingList);
  const before=snapshot.conversation;
  snapshot=await turn(inbox,runtime,'price of H19');
  assert.deepEqual(snapshot.conversation,before);
  const phone=textOnPhone(lastReply(snapshot));
  assert.match(phone,/₹350\.00/);
  assert.doesNotMatch(phone,/shop must confirm the requested amount|Known catalog subtotal|Which kind of pipe|Choose a quantity/i);
  assert.ok(!buttons(lastReply(snapshot)).some(b=>b.event.type==='choose_product'));
}));

test('early send asks the pending quantity instead of handing the conversation to the shop',()=>fixture(async(pool,inbox)=>{
  const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'PAINT10',quantity:null}]),{visualOrdering:true});
  let snapshot=await turn(inbox,runtime,'white paint');
  snapshot=await turn(inbox,runtime,'send it');
  assert.equal(snapshot.conversation.pending?.kind,'question');
  assert.equal(lastReply(snapshot).stage,'quantity');
  assert.equal(snapshot.requests.length,0);
  assert.equal((await pool.query('SELECT operator_mode FROM conversations WHERE id=$1',[inbox.context.conversationId])).rows[0].operator_mode,'assistant');
}));

test('an unverified price answer retains the product and known stock without showing a zero quote',()=>fixture(async(pool,inbox)=>{
  await pool.query("UPDATE products SET price_paise=0,price_status='confirm' WHERE store_id=$1 AND sku='PAINT10'",[demoCatalogStore]);
  const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'H19',quantity:1}]),{visualOrdering:true});
  const before=(await turn(inbox,runtime,'one pipe cutter')).conversation;
  const snapshot=await turn(inbox,runtime,'price of PAINT10');
  assert.deepEqual(snapshot.conversation,before);
  const phone=textOnPhone(lastReply(snapshot));
  assert.match(phone,/White paint 10 litre/);
  assert.match(phone,/Price: shop to confirm/);
  assert.match(phone,/Recorded stock · shop will confirm/);
  assert.doesNotMatch(phone,/₹0|Which|Choose a quantity/);
  assert.equal(lastReply(snapshot).readOnly,true);
  assert.equal(buttons(lastReply(snapshot)).length,0);
  assert.equal(snapshot.requests.length,0);
}));

test('negative keep-list retains every line and the current question',()=>fixture(async(pool,inbox)=>{
  const runtime=new ConversationRuntime(pool,planner(fiveItems),{visualOrdering:true});
  let snapshot=await turn(inbox,runtime,shoppingList);
  const before=snapshot.conversation.draft;
  snapshot=await turn(inbox,runtime,'keep my list');
  assert.deepEqual(snapshot.conversation.draft,before);
  assert.equal(snapshot.requests.length,0);
  assert.ok(!buttons(lastReply(snapshot)).some(b=>b.event.type==='shopping_action'&&b.event.action==='confirm_clear'));
}));

test('an explicitly free product can reach a zero bill and still needs final consent',()=>fixture(async(pool,inbox)=>{
  await pool.query("UPDATE products SET price_paise=0,price_status='free' WHERE store_id=$1 AND sku='PAINT10'",[demoCatalogStore]);
  const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'PAINT10',quantity:1,supportingPhrase:'one white paint can'}]),{visualOrdering:true});
  let snapshot=await turn(inbox,runtime,'one white paint can');
  assert.equal(snapshot.conversation.draft[0].resolution,'matched');
  assert.ok(!buttons(lastReply(snapshot)).some(b=>b.event.type==='confirm'));
  snapshot=await turn(inbox,runtime,action(snapshot,e=>e.type==='confirm_products'));
  assert.equal(lastReply(snapshot).stage,'bill');
  assert.match(textOnPhone(lastReply(snapshot)),/₹0\.00/);
  assert.equal(snapshot.requests.length,0);
  snapshot=await turn(inbox,runtime,action(snapshot,e=>e.type==='confirm'));
  assert.equal(snapshot.requests.length,1);
  assert.equal(snapshot.requests[0].totalPaise,0);
}));

test('five-item conversation matches the full phone transcript and submits exactly once',()=>fixture(async(pool,inbox)=>{
  const runtime=new ConversationRuntime(pool,planner(fiveItems),{visualOrdering:true});
  const frames:ReturnType<typeof visible>[]=[];
  let snapshot=await turn(inbox,runtime,shoppingList);frames.push(...visibleTurn(snapshot));
  snapshot=await turn(inbox,runtime,action(snapshot,e=>e.type==='choose_pipe_type'&&e.pipeType==='pvc'));frames.push(...visibleTurn(snapshot));
  const pipeChoice=action(snapshot,e=>e.type==='select_product'&&e.sku==='H01');
  snapshot=await turn(inbox,runtime,'price of H19');frames.push(...visibleTurn(snapshot));
  snapshot=await turn(inbox,runtime,pipeChoice);frames.push(...visibleTurn(snapshot));
  snapshot=await turn(inbox,runtime,action(snapshot,e=>e.type==='choose_pipe_type'&&e.pipeType==='pvc'));frames.push(...visibleTurn(snapshot));
  snapshot=await turn(inbox,runtime,action(snapshot,e=>e.type==='confirm_products'));frames.push(...visibleTurn(snapshot));
  assert.equal(snapshot.requests.length,0);
  const confirm=action(snapshot,e=>e.type==='confirm');
  snapshot=await turn(inbox,runtime,confirm);
  assert.equal(snapshot.requests.length,1);
  assert.equal(snapshot.requests[0].lines.length,5);
  await inbox.ingest(confirm);
  assert.equal(await runtime.processNext(inbox.context),false);
  assert.equal((await inbox.snapshot()).requests.length,1);
  if(process.env.COUNTER_TRANSCRIPT_PATH)writeFileSync(process.env.COUNTER_TRANSCRIPT_PATH,JSON.stringify(frames,null,2)+'\n');
  const expected=JSON.parse(readFileSync(new URL('./fixtures/counter-five-item-transcript.json',import.meta.url),'utf8'));
  assert.deepEqual(frames,expected);
}));
