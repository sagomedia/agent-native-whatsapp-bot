import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {WhatsAppChannel,webhookSchema} from '../apps/server/src/services/whatsapp-channel.js';
import {createApp} from '../apps/server/src/http/app.js';
import {geminiTextRate} from '../apps/server/src/services/inference-budget.js';
import {reviewDeliveryReady} from '../apps/server/src/services/review-delivery.js';
import type {WhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';

test('delayed invoice delivery cannot be overtaken by consent; a tap proves its own page and creates an owner-visible order with a reusable ₹10 QR',async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='invoice_delivery_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{
  await setupDatabase(pool,'mock');await setupImageDemo(pool);
  const config:WhatsAppConfig={visualOrdering:true,aiEnabled:true,hostname:'invoice.example.test',storeId:demoCatalogStore,appId:'123456789',wabaId:'987654321',phoneId:'123987654',appSecret:'offline-fixture-secret',verifyToken:'offline-fixture-verify',accessToken:'offline-fixture-token',graphVersion:'v25.0',recipients:['919000000001'],defaultReplyLanguage:'en',processEnabled:true,sendEnabled:true,partialReviews:true,advance:{vpa:'fixture.merchant@bank',name:'Fixture shop',hostname:'invoice.example.test',demoPayAtShop:true}};
  let calls=0,sends=0;
  const provider:Interpreter={name:'offline-invoice-fixture',mode:'live',billing:geminiTextRate,freeQuota:{scope:schema,model:'gemini-3.5-flash-lite'},interpret:async()=>{calls++;return {output:{operations:Array.from({length:9},(_,i)=>({kind:'add_item',query:'H'+String(i+1).padStart(2,'0'),quantity:1})),next:'review'},usage:{promptTokenCount:20,candidatesTokenCount:20,totalTokenCount:40},responseModel:'gemini-3.5-flash-lite',truncated:false};}};
  const channel=new WhatsAppChannel(pool,config,async()=>new Response(JSON.stringify({messages:[{id:'offline.sent.'+(++sends)}]}),{status:200}),provider);await channel.setup();
  const envelope=(value:object)=>webhookSchema.parse({object:'whatsapp_business_account',entry:[{id:config.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:config.phoneId},...value}}]}]});
  const incoming=(body:object)=>channel.receive(envelope({messages:[{id:'offline.in.'+randomUUID(),from:config.recipients[0],timestamp:String(Math.floor(Date.now()/1000)),...body}]}));
  const delivered=(providerId:string)=>channel.receive(envelope({statuses:[{id:providerId,recipient_id:config.recipients[0],timestamp:String(Math.floor(Date.now()/1000)),status:'delivered'}]}));
  const flush=async()=>{for(let i=0;i<50;i++){if(!await channel.sendNext())break;const rows=(await pool.query("SELECT provider_id FROM whatsapp_outbox WHERE state='accepted'")).rows;for(const row of rows)await delivered(row.provider_id);}};
  const action=async(type:string)=>(await pool.query("SELECT a.*,o.provider_id FROM whatsapp_actions a JOIN whatsapp_outbox o ON o.message_id=a.message_id WHERE a.event->>'type'=$1 ORDER BY o.created_at DESC,a.id LIMIT 1",[type])).rows[0];
  const tap=async(a:any)=>{await incoming({type:'interactive',context:{id:a.provider_id},interactive:{type:'button_reply',button_reply:{id:a.id,title:'untrusted label'}}});assert.equal(await channel.processNext(),true);};
  const owner={hostname:'owner.example.test',issuer:'https://fixture.cloudflareaccess.com',audience:'offline-fixture',email:'fixture@example.test',storeId:demoCatalogStore};
  app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/invoice-delivery-fixture',owner,whatsapp:config},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline'}),channel);
  const headers={host:owner.hostname,'cf-access-jwt-assertion':'offline'};
  const snapshot=async()=>(await app!.inject({url:'/api/owner/snapshot',headers})).json();
  await incoming({type:'text',text:{body:'one each H01 H02 H03 H04 H05 H06 H07 H08 H09'}});assert.equal(await channel.processNext(),true);await flush();
  await tap(await action('confirm_products'));
  const invoice=(await pool.query("SELECT m.*,o.state FROM messages m JOIN whatsapp_outbox o ON o.message_id=m.id WHERE m.stage='bill' ORDER BY m.sequence")).rows;
  assert.equal(invoice.length,2);assert.ok(invoice.every(m=>m.payload.parts[0].cards[0].billRows));
  assert.equal(await channel.sendNext(),true);assert.equal(await channel.sendNext(),false,'accepted image must not release the final confirmation image');
  let ownerState=await snapshot();assert.equal(ownerState.requestCounts.active,0);assert.equal(ownerState.conversations.find((c:any)=>c.checkout)?.checkout.state,'invoice_arriving');
  const first=(await pool.query('SELECT provider_id FROM whatsapp_outbox WHERE message_id=$1',[invoice[0].id])).rows[0];await delivered(first.provider_id);
  assert.equal(await channel.sendNext(),true);
  const confirm=await action('confirm'),client=await pool.connect();
  try{
   assert.equal(await reviewDeliveryReady(client,confirm.conversation_id,confirm.binding_id,true),false,'a generic tap cannot prove unseen multipart pages');
   assert.equal(await reviewDeliveryReady(client,confirm.conversation_id,confirm.binding_id,true,confirm.event.id),true,'the bound final-page tap proves that accepted image');
   await client.query("UPDATE whatsapp_outbox SET state='unknown' WHERE message_id=$1",[invoice[0].id]);
   assert.equal(await reviewDeliveryReady(client,confirm.conversation_id,confirm.binding_id,true,confirm.event.id),false,'a final-page tap never bypasses another unknown page');
   await client.query("UPDATE whatsapp_outbox SET state='delivered' WHERE message_id=$1",[invoice[0].id]);
  }finally{client.release();}
  await tap(confirm);await flush();
  ownerState=await snapshot();assert.equal(ownerState.requestCounts.active,1);assert.equal(ownerState.requests.length,1);assert.equal(ownerState.requests[0].lines.length,9);assert.equal(ownerState.requests[0].acceptance,'awaiting_approval');assert.equal(ownerState.conversations.find((c:any)=>c.id===confirm.conversation_id).checkout,null);
  const advance=(await pool.query('SELECT * FROM order_advances')).rows[0],uri=new URL(advance.upi_uri);assert.equal(uri.searchParams.get('am'),'10.00');assert.equal(uri.searchParams.get('cu'),'INR');assert.equal(uri.searchParams.get('pa'),config.advance!.vpa);assert.equal(uri.searchParams.has('mam'),false);
  const count=sends;await incoming({type:'text',text:{body:'status'}});assert.equal(await channel.processNext(),true);await flush();const show=await action('show_payment_qr');assert.ok(show);
  await tap(show);await flush();assert.ok(sends>count);assert.equal((await pool.query('SELECT count(*)::int n FROM order_advances')).rows[0].n,1);
  await tap(await action('pay_at_shop'));await flush();ownerState=await snapshot();assert.equal(ownerState.requests[0].advance_state,'pay_at_shop');assert.equal(ownerState.requests[0].payment,'not_requested');assert.equal(ownerState.requests[0].advance_required,false);assert.equal(ownerState.requestCounts.active,1);
  assert.equal((await pool.query('SELECT verified_at FROM order_advances')).rows[0].verified_at,null);assert.equal(calls,1,'consent, QR, status and demo choice must not invoke AI');
  // A large history must never push an older active order out of the dashboard.
  await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise,acceptance,fulfillment,created_at) SELECT gen_random_uuid(),store_id,conversation_id,actor,gen_random_uuid(),'[]',0,'accepted','collected',now()+g*interval '1 second' FROM order_requests CROSS JOIN generate_series(1,110) g WHERE id=$1",[ownerState.requests[0].id]);
  ownerState=await snapshot();assert.equal(ownerState.requestCounts.active,1);assert.equal(ownerState.requestCounts.history,110);assert.ok(ownerState.requests.some((r:any)=>r.id===advance.request_id));
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});

test('a real WhatsApp stale list-choice callback re-asks and replays the saved request after a shop revision',async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='choice_delivery_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');await setupImageDemo(pool);
  const config:WhatsAppConfig={visualOrdering:true,aiEnabled:true,hostname:'choice.example.test',storeId:demoCatalogStore,appId:'123456789',wabaId:'987654321',phoneId:'123987654',appSecret:'offline-fixture-secret',verifyToken:'offline-fixture-verify',accessToken:'offline-fixture-token',graphVersion:'v25.0',recipients:['919000000001'],defaultReplyLanguage:'en',processEnabled:true,sendEnabled:true};
  let next=false,calls=0,sends=0;
  const provider:Interpreter={name:'offline-choice-fixture',mode:'live',billing:geminiTextRate,freeQuota:{scope:schema,model:'gemini-3.5-flash-lite'},interpret:async()=>{calls++;return {output:{operations:[{kind:'add_item',query:next?'H19':'H08',quantity:next?2:1}],next:'review'},usage:{promptTokenCount:20,candidatesTokenCount:20,totalTokenCount:40},responseModel:'gemini-3.5-flash-lite',truncated:false};}};
  const channel=new WhatsAppChannel(pool,config,async()=>new Response(JSON.stringify({messages:[{id:'offline.choice.sent.'+(++sends)}]}),{status:200}),provider);await channel.setup();
  const envelope=(value:object)=>webhookSchema.parse({object:'whatsapp_business_account',entry:[{id:config.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:config.phoneId},...value}}]}]});
  const incoming=(body:object)=>channel.receive(envelope({messages:[{id:'offline.choice.in.'+randomUUID(),from:config.recipients[0],timestamp:String(Math.floor(Date.now()/1000)),...body}]}));
  const flush=async()=>{for(let i=0;i<20;i++){if(!await channel.sendNext())break;for(const r of (await pool.query("SELECT provider_id FROM whatsapp_outbox WHERE state='accepted'")).rows)await channel.receive(envelope({statuses:[{id:r.provider_id,recipient_id:config.recipients[0],timestamp:String(Math.floor(Date.now()/1000)),status:'delivered'}]}));}};
  const action=async(type:string,choice?:string)=>(await pool.query("SELECT a.*,o.provider_id FROM whatsapp_actions a JOIN whatsapp_outbox o ON o.message_id=a.message_id JOIN messages m ON m.id=a.message_id WHERE a.event->>'type'=$1 AND ($2::text IS NULL OR a.event->>'action'=$2) ORDER BY m.sequence DESC LIMIT 1",[type,choice??null])).rows[0];
  const tap=async(a:any)=>incoming({type:'interactive',context:{id:a.provider_id},interactive:{type:'button_reply',button_reply:{id:a.id,title:'untrusted'}}});
  await incoming({type:'text',text:{body:'one teflon tape'}});await channel.processNext();await flush();await tap(await action('confirm_products'));await channel.processNext();await flush();await tap(await action('confirm'));await channel.processNext();await flush();const original=(await pool.query('SELECT * FROM order_requests')).rows[0];assert.ok(original);
  next=true;await pool.query("UPDATE provider_attempts SET created_at=now()-interval '7 seconds'");await incoming({type:'text',text:{body:'two pipe cutters'}});await channel.processNext();await flush();const old=await action('shopping_action','new_list'),count=calls;assert.ok(old,JSON.stringify((await pool.query('SELECT text,status,payload FROM messages ORDER BY sequence DESC LIMIT 2')).rows));
  await pool.query('UPDATE conversations SET version=version+1 WHERE id=$1',[old.conversation_id]);await tap(old);assert.equal(await channel.processNext(),false);await flush();
  const fresh=await action('shopping_action','new_list');assert.notEqual(fresh.id,old.id);assert.notEqual(fresh.binding_id,old.binding_id);assert.equal((await pool.query('SELECT count(*)::int n FROM order_requests')).rows[0].n,1);assert.equal((await pool.query('SELECT last_request_id FROM conversations WHERE id=$1',[old.conversation_id])).rows[0].last_request_id,original.id);
  await tap(fresh);assert.equal(await channel.processNext(),true);const current=(await pool.query('SELECT draft,last_request_id FROM conversations WHERE id=$1',[old.conversation_id])).rows[0];assert.equal(current.last_request_id,null);assert.equal(current.draft.length,1);assert.equal(current.draft[0].sku,'H19');assert.equal(current.draft[0].quantity,2);assert.equal(calls,count);assert.equal((await pool.query('SELECT count(*)::int n FROM order_requests')).rows[0].n,1);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
