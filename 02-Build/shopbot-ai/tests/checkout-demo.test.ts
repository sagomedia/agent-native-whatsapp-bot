import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import type {Interpretation,SimulatorEvent,RichReply,Snapshot} from '../packages/contracts/index.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo} from '../apps/server/src/services/demo-catalog.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {chooseDemoPayAtShop,readUpiAdvance,verifyManualAdvance} from '../apps/server/src/services/upi-advance.js';
import {withConversation} from '../apps/server/src/services/context.js';
import {createApp} from '../apps/server/src/http/app.js';
import {visualStatus} from '../apps/server/src/services/visual-ordering.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';

const advance={vpa:'fixture.merchant@bank',name:'Fixture shop',hostname:'bot.example.com',demoPayAtShop:true};
const last=(s:Snapshot)=>s.messages.filter(m=>m.direction==='outbound').at(-1)!.rich!;
const buttons=(r:RichReply)=>[...r.buttons??[],...r.parts?.flatMap(p=>[...p.buttons??[],...p.cards.flatMap(c=>c.buttons??[])])??[]];
async function fixture(run:(f:{pool:pg.Pool;turn:(e:SimulatorEvent|string)=>Promise<Snapshot>;set:(i:Interpretation)=>void;calls:()=>number})=>Promise<void>,demo=true){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='checkout_demo_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');await setupImageDemo(pool,simulatorContext.storeId);
  await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases,image_path,family_id,brand,specifications,selling_unit_verified) VALUES($1,'PAINT-KG','Asian Paints Tractor Uno Acrylic Distemper 10kg','bucket',11200,20,'[\"Asian Paints Tractor Uno Acrylic Distemper\"]','/demo-images/H10.jpg','paint','Asian Paints','{\"weight\":\"10kg\"}',true)",[simulatorContext.storeId]);
  let next:Interpretation={operations:[],next:'continue'},calls=0;
  const provider={name:'offline-checkout-demo',mode:'mock' as const,interpret:async()=>{calls++;return {output:next,usage:null,truncated:false};}};
  const inbox=new SimulatorService(pool),runtime=new ConversationRuntime(pool,provider,{visualOrdering:true,partialReviews:true,advance:{...advance,demoPayAtShop:demo}});
  const turn=async(e:SimulatorEvent|string)=>{await inbox.ingest(typeof e==='string'?{id:randomUUID(),type:'text',text:e}:e);assert.equal(await runtime.processNext(simulatorContext),true);return inbox.snapshot();};
  await run({pool,turn,set:i=>{next=i;},calls:()=>calls});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}

test('real paint photos survive a litre/kg pack mismatch; only a current explicit choice changes the pack',()=>fixture(async({pool,turn,set})=>{
 set({operations:[{kind:'add_item',query:'Asian Paints Tractor Uno Acrylic Distemper 10kg',quantity:1,requestedUnit:'container',packSize:{value:10,unit:'litre'},supportingPhrase:'one 10 litre Asian Paints Tractor Uno Acrylic Distemper can'}],next:'review'});
 let s=await turn('one 10 litre Asian Paints Tractor Uno Acrylic Distemper can');
 const line=s.conversation.draft[0];assert.equal(line.sku,undefined);assert.equal(line.packSize?.unit,'litre');assert.equal(line.catalogIssue,'pack_unit_mismatch');
 assert.ok(last(s).parts?.flatMap(p=>p.cards).some(c=>c.kind==='product'&&c.product.sku==='PAINT-KG'));
 assert.equal(buttons(last(s)).some(b=>b.event.type==='shopping_action'&&b.event.action==='handoff'),false);
 const choice=buttons(last(s)).find(b=>b.event.type==='select_product')!.event;s=await turn(choice);
 assert.equal(s.conversation.draft[0].packSize?.unit,'kg');assert.equal(s.conversation.draft[0].quantity,1);assert.equal(s.conversation.draft[0].unit,'bucket');
 assert.equal(s.conversation.draft[0].packUnitAlternative?.requested.unit,'litre');assert.equal(s.conversation.draft[0].packUnitAlternative?.acceptedSku,'PAINT-KG');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_requests')).rows[0].n,0);
}));

test('catalog size filters can offer the same identity with another pack unit without weakening brand constraints',()=>fixture(async({turn,set})=>{
 set({operations:[{kind:'add_item',query:'Asian Paints Tractor Uno Acrylic Distemper 10 litre',quantity:1,requestedUnit:'container',packSize:{value:10,unit:'litre'},search:{keywords:['Asian Paints Tractor Uno Acrylic Distemper 10 litre'],brand:'Asian Paints',familyId:'paint',specifications:{size:'10 litre'}}}],next:'review'});
 let s=await turn('one 10 litre Asian Paints Tractor Uno Acrylic Distemper can');assert.equal(s.conversation.draft[0].catalogIssue,'pack_unit_mismatch');
 s=await turn(buttons(last(s)).find(b=>b.event.type==='select_product')!.event);assert.equal(s.conversation.draft[0].sku,'PAINT-KG');
}));

test('duplicated Tamil/English brand names survive common Tamil paint spelling variants before pack checking',()=>fixture(async({pool,turn,set})=>{
 await pool.query("UPDATE products SET aliases=aliases||$1::jsonb WHERE sku='PAINT-KG'",[JSON.stringify(['ஏசியன் பெயின்ட்ஸ் டிராக்டர் உனோ அக்ரிலிக் டிஸ்டெம்பர்'])]);
 set({operations:[{kind:'add_item',query:'ஏசியன் பெயிண்ட்ஸ் Asian Paints Tractor Uno Acrylic Distemper 10kg',quantity:1,requestedUnit:'container',packSize:{value:10,unit:'litre'},supportingPhrase:'ஏசியன் பெயிண்ட்ஸ் 10 லிட்டர் டப்பா ஒன்னு'}],next:'review'});
 const s=await turn('ஏசியன் பெயிண்ட்ஸ் 10 லிட்டர் டப்பா ஒன்னு');const line=s.conversation.draft[0];
 assert.equal(line.catalogIssue,'pack_unit_mismatch');assert.deepEqual(line.candidates?.map(p=>p.sku),['PAINT-KG']);assert.equal(line.sku,undefined);assert.equal(line.quantity,1);
 assert.ok(last(s).parts?.flatMap(p=>p.cards).some(c=>c.kind==='product'&&c.product.sku==='PAINT-KG'));
}));

test('known and missing products progress through photos, invoice, explicit submission, QR and unpaid demo pickup',()=>fixture(async({pool,turn,set,calls})=>{
 set({operations:[{kind:'add_item',query:'H08',quantity:2},{kind:'add_item',query:'unknown unicorn bolt',quantity:1}],next:'review'});
 let s=await turn('two PTFE tape rolls and one unknown unicorn bolt');
 const approve=buttons(last(s)).find(b=>b.event.type==='confirm_products')?.event;assert.ok(approve,'a clear checkout step exists despite a missing catalog item: '+JSON.stringify(last(s)));
 s=await turn(approve);assert.equal(last(s).stage,'bill');assert.equal(s.requests.length,0);
 assert.match(last(s).accessibleText!,/unknown unicorn bolt/);assert.match(last(s).text,/₹40/);assert.ok(s.messages.filter(m=>m.rich?.groupId===last(s).groupId).flatMap(m=>m.rich?.parts?.flatMap(p=>p.cards)??[]).some(c=>c.kind==='bill'&&c.billRows?.some(row=>row.unitPrice==='—')));
 const confirm=buttons(last(s)).find(b=>b.event.type==='confirm')!.event;s=await turn(confirm);assert.equal(s.requests.length,1);
 const qr=last(s),pay=buttons(qr).find(b=>b.event.type==='pay_at_shop')!.event;assert.ok(qr.parts?.[0].cards[0].kind!=='product'&&qr.parts?.[0].cards[0].imageUrl);assert.match(qr.text,/No advance has been received yet/);
 assert.ok(renderWhatsAppReply(qr,randomUUID(),advance.hostname).actions.some(a=>a.event.type==='pay_at_shop'));
 const before=calls();s=await turn(pay);assert.equal(calls(),before);assert.match(last(s).text,/pay the full amount at the shop/i);assert.doesNotMatch(last(s).text,/advance received/i);
 const order=(await pool.query('SELECT advance_required,payment,acceptance,fulfillment,lines FROM order_requests')).rows[0];assert.equal(order.advance_required,false);assert.equal(order.payment,'not_requested');assert.equal(order.acceptance,'awaiting_approval');assert.equal(order.lines.length,2);
 const payment=(await pool.query('SELECT state,transaction_reference,verified_at,offered_at FROM order_advances')).rows[0];assert.equal(payment.state,'pay_at_shop');assert.equal(payment.verified_at,null);assert.equal(payment.transaction_reference,null);assert.ok(payment.offered_at);
 s=await turn('status');assert.match(last(s).text,/No advance received/);assert.equal(buttons(last(s)).some(b=>b.event.type==='payment_claim'),false);
}));

test('only one automatic QR offer is shown and real-payment mode cannot accept the demo escape',()=>fixture(async({pool,turn,set})=>{
 set({operations:[{kind:'add_item',query:'H08',quantity:2}],next:'review'});let s=await turn('two PTFE tape rolls');s=await turn(buttons(last(s)).find(b=>b.event.type==='confirm_products')!.event);s=await turn(buttons(last(s)).find(b=>b.event.type==='confirm')!.event);
 assert.equal(buttons(last(s)).some(b=>b.event.type==='pay_at_shop'),false);const request=s.requests[0];
 await assert.rejects(withConversation(pool,simulatorContext,c=>chooseDemoPayAtShop(c,simulatorContext,request.id,false)),/only enabled/);
 s=await turn('status');assert.equal(buttons(last(s)).some(b=>b.event.type==='payment_claim'),false);assert.equal((await pool.query('SELECT advance_required FROM order_requests')).rows[0].advance_required,true);
},false));

test('ordinary Tamil checkout phrasing opens the invoice flow without a human handoff or implicit order',()=>fixture(async({turn,set,calls})=>{
 set({operations:[{kind:'add_item',query:'H08',quantity:2}],next:'review'});let s=await turn('two PTFE tape rolls');s=await turn('எல்லா பொருளும் ஓகே அண்ணே');assert.equal(last(s).stage,'bill');
 const before=calls();s=await turn('சரி பேக் பண்ணுங்க');assert.equal(calls(),before);assert.equal(last(s).stage,'bill');assert.equal(s.requests.length,0);assert.equal(s.conversation.handoffRequested,false);
}));

test('demo configuration is explicit and defaults to requiring real advance verification',()=>{
 const env={UPI_ADVANCE_ENABLED:'true',UPI_PAYEE_VPA:advance.vpa,UPI_PAYEE_NAME:advance.name};
 assert.equal(readUpiAdvance(env,advance.hostname)?.demoPayAtShop,false);assert.equal(readUpiAdvance({...env,UPI_DEMO_PAY_AT_SHOP_ENABLED:'true'},advance.hostname)?.demoPayAtShop,true);
});

test('a later genuine bank receipt after the demo choice can still be verified and credited without inventing a receipt',()=>fixture(async({pool,turn,set})=>{
 set({operations:[{kind:'add_item',query:'H08',quantity:2}],next:'review'});let s=await turn('two teflon tape rolls');s=await turn(buttons(last(s)).find(b=>b.event.type==='confirm_products')!.event);s=await turn(buttons(last(s)).find(b=>b.event.type==='confirm')!.event);s=await turn(buttons(last(s)).find(b=>b.event.type==='pay_at_shop')!.event);
 const id=s.requests[0].id;await withConversation(pool,simulatorContext,c=>verifyManualAdvance(c,simulatorContext.storeId,id,'offline-owner','ACTUAL-BANK-123456'));
 const row=(await pool.query('SELECT a.state,a.transaction_reference,r.advance_required FROM order_advances a JOIN order_requests r ON r.id=a.request_id')).rows[0];assert.equal(row.state,'verified');assert.equal(row.advance_required,true);assert.equal(row.transaction_reference,'ACTUAL-BANK-123456');
 s=await turn('status');assert.match(last(s).text,/₹10 advance received/);assert.doesNotMatch(last(s).text,/No advance received/);
}));

test('an unpaid demo order appears in owner requests and can be accepted, packed, collected and queried later',()=>fixture(async({pool,turn,set})=>{
 set({operations:[{kind:'add_item',query:'H08',quantity:2}],next:'review'});
 let s=await turn('two teflon tape rolls');s=await turn(buttons(last(s)).find(b=>b.event.type==='confirm_products')!.event);s=await turn(buttons(last(s)).find(b=>b.event.type==='confirm')!.event);s=await turn(buttons(last(s)).find(b=>b.event.type==='pay_at_shop')!.event);
 const owner={hostname:'owner.example.test',issuer:'https://fixture.cloudflareaccess.com',audience:'offline_fixture_audience',email:'owner@example.test',storeId:simulatorContext.storeId};
 const app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/checkout-demo-owner',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline-owner'}));
 const headers={host:owner.hostname,'cf-access-jwt-assertion':'offline-owner',origin:'https://'+owner.hostname,'x-shopbot-owner':'1'};
 try{
  const snapshot=(await app.inject({url:'/api/owner/snapshot',headers})).json();assert.equal(snapshot.requests.length,1);assert.equal(snapshot.requests[0].advance_state,'pay_at_shop');assert.equal(snapshot.requests[0].payment,'not_requested');
  const id=s.requests[0].id;
  const post=(path:string,payload:object)=>app.inject({method:'POST',url:'/api/owner/requests/'+id+path,headers,payload});
  assert.equal((await post('/decision',{decision:'accepted'})).statusCode,200);
  assert.equal((await post('/fulfillment',{expected:'preparing',status:'ready_for_pickup'})).statusCode,200);
  s=await turn('status');assert.match(last(s).text,/ready for pickup/i);assert.match(last(s).text,/No advance received/);
  assert.equal((await post('/fulfillment',{expected:'ready_for_pickup',status:'collected'})).statusCode,200);
  const count=s.messages.length;s=await turn('thanks');assert.equal(s.messages.length,count+1);s=await turn('status');assert.match(last(s).text,/collected/i);s=await turn('bill');assert.match(last(s).text,/collected/i);assert.equal(buttons(last(s)).some(b=>b.event.type==='review'||b.event.type==='review_partial'||b.event.type==='confirm'),false);
 }finally{await app.close();}
}));


test('a bad catalog selling basis retains the requested one-container count in the unpriced invoice',()=>fixture(async({pool,turn,set})=>{
 await pool.query("UPDATE products SET unit='litre',selling_unit_verified=false WHERE sku='PAINT-KG'");
 set({operations:[{kind:'add_item',query:'Asian Paints Tractor Uno Acrylic Distemper 10kg',quantity:1,requestedUnit:'container',packSize:{value:10,unit:'litre'},supportingPhrase:'one 10 litre Asian Paints Tractor Uno Acrylic Distemper can'}],next:'review'});
 let s=await turn('one 10 litre Asian Paints Tractor Uno Acrylic Distemper can');s=await turn(buttons(last(s)).find(b=>b.event.type==='select_product')!.event);
 s=await turn({id:randomUUID(),type:'review_partial',expectedVersion:s.conversation.version});
 assert.equal(last(s).stage,'bill');assert.match(last(s).accessibleText!,/1 container/);assert.doesNotMatch(last(s).text,/₹112/);
 const row=s.messages.filter(m=>m.rich?.groupId===last(s).groupId).flatMap(m=>m.rich?.parts?.flatMap(p=>p.cards)??[]).find(c=>c.kind==='bill');assert.ok(row&&row.kind!=='product');assert.equal(row.billRows?.[0].count,'1 container');assert.equal(row.billRows?.[0].unitPrice,'—');
 assert.equal(s.requests.length,0);
}));

// Payment prompts must disappear with a declined, cancelled or collected order.
test('closed orders cannot advertise a pending advance QR',()=>{
 const state={version:1,draft:[],pending:null,fulfillment:'pickup' as const,lastRequestId:randomUUID(),replyLanguage:'en' as const};
 const request={id:state.lastRequestId,acceptance:'awaiting_approval' as const,fulfillment:'awaiting_approval' as const,payment:'pending' as const,totalPaise:100,lines:[],advanceRequired:true,advanceState:'requested'};
 assert.ok(buttons(visualStatus(state,request)).some(b=>b.event.type==='show_payment_qr'));
 for(const closed of [{...request,acceptance:'rejected' as const},{...request,fulfillment:'cancelled' as const},{...request,acceptance:'accepted' as const,fulfillment:'collected' as const}])assert.equal(buttons(visualStatus(state,closed)).some(b=>b.event.type==='show_payment_qr'),false);
});
