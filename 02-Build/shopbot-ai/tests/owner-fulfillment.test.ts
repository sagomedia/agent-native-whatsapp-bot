import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo} from '../apps/server/src/services/demo-catalog.js';
import {WhatsAppChannel,webhookSchema} from '../apps/server/src/services/whatsapp-channel.js';
import {createApp} from '../apps/server/src/http/app.js';
import {fixtureStore} from '../profiles/hardware.js';
import type {WhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';

const cfg:WhatsAppConfig={hostname:'api.example.test',storeId:fixtureStore,appId:'123456789',wabaId:'987654321',phoneId:'123987654',appSecret:'offline-only-secret',verifyToken:'offline-only-verify',accessToken:'offline-only-token',graphVersion:'v25.0',recipients:['919000000001'],defaultReplyLanguage:'en',processEnabled:true,sendEnabled:true};
const owner={hostname:'owner.example.test',issuer:'https://test.cloudflareaccess.com',audience:'offline-audience',email:'owner@example.test',storeId:fixtureStore};
const headers={host:owner.hostname,'cf-access-jwt-assertion':'offline-owner',origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json'};
function inbound(body:object){return webhookSchema.parse({object:'whatsapp_business_account',entry:[{id:cfg.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:cfg.phoneId},messages:[{id:'wamid.'+randomUUID(),from:cfg.recipients[0],timestamp:String(Math.floor(Date.now()/1000)),...body}]}}]}]});}
const tap=(action:any)=>({type:'interactive',context:{id:action.provider_id},interactive:{type:'button_reply',button_reply:{id:action.id,title:'Untrusted button title'}}});
async function turn(channel:WhatsAppChannel,body:object){await channel.receive(inbound(body));assert.equal(await channel.processNext(),true);assert.equal(await channel.sendNext(),true);}
async function action(pool:pg.Pool,event:object){
 const row=(await pool.query("SELECT a.*,o.provider_id FROM whatsapp_actions a JOIN whatsapp_outbox o ON o.message_id=a.message_id WHERE a.event @> $1::jsonb AND o.state IN ('accepted','delivered','read') ORDER BY o.created_at DESC LIMIT 1",[JSON.stringify(event)])).rows[0];
 assert.ok(row,'Expected an action from a message sent to the fake customer');return row;
}

test('customer photo choice and bound submission continue through owner approval, pickup, and handoff using only a fake sender',async()=>{
 const schema='owner_fulfillment_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 const apps:Awaited<ReturnType<typeof createApp>>[]=[],sent:any[]=[];
 try{
  await setupDatabase(pool,'mock');await setupImageDemo(pool,fixtureStore);
  const channel=new WhatsAppChannel(pool,cfg,async(_url,init)=>{
   const payload=JSON.parse(String(init!.body));assert.equal(payload.to,cfg.recipients[0]);sent.push(payload);
   return new Response(JSON.stringify({messages:[{id:'wamid.owner-flow.'+sent.length}]}),{status:200});
  });
  await channel.setup();
  const config={mode:'mock' as const,databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/offline-owner-fulfillment',owner,whatsapp:cfg};
  const app=await createApp(config,pool,undefined,undefined,async()=>({email:owner.email,subject:'offline-owner'}),channel);apps.push(app);
  const post=(url:string,payload:object)=>app.inject({method:'POST',url,headers,payload});

  await turn(channel,{type:'text',text:{body:'hello'}});
  await turn(channel,tap(await action(pool,{type:'shopping_action',action:'browse'})));
  await turn(channel,tap(await action(pool,{type:'browse',query:'plumbing'})));
  assert.equal(sent.at(-1).interactive.type,'carousel');
  const choice=await action(pool,{type:'choose_product'});
  await turn(channel,{type:'button',context:{id:choice.provider_id},button:{payload:choice.id,text:'Choose this'}});
  const conversationId=choice.conversation_id;
  const state=async()=>(await pool.query('SELECT * FROM conversations WHERE id=$1',[conversationId])).rows[0];
  assert.equal((await state()).draft[0].quantity,null);
  await turn(channel,tap(await action(pool,{type:'set_quantity',quantity:2})));
  const reviewed=await state(),review=reviewed.pending;
  assert.equal(review.kind,'review');assert.equal(review.lines[0].sku,choice.event.sku);assert.equal(review.lines[0].quantity,2);
  const product=(await pool.query('SELECT price_paise FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,choice.event.sku])).rows[0];
  assert.equal(review.totalPaise,product.price_paise*2);
  assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,0,'Choosing a product or quantity is not consent to submit');
  const confirm=await action(pool,{type:'confirm',reviewId:review.id}),callback=inbound(tap(confirm));
  await channel.receive(callback);assert.equal(await channel.processNext(),true);assert.equal(await channel.sendNext(),true);
  await channel.receive(callback);assert.equal(await channel.processNext(),false);
  assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,1);
  const submitted=(await pool.query('SELECT * FROM order_requests')).rows[0],requestUrl='/api/owner/requests/'+submitted.id;
  const request=async()=>(await pool.query('SELECT * FROM order_requests WHERE id=$1',[submitted.id])).rows[0];
  assert.deepEqual(submitted.lines,review.lines);assert.equal(Number(submitted.total_paise),review.totalPaise);
  assert.equal(submitted.acceptance,'awaiting_approval');assert.equal(submitted.fulfillment,'awaiting_approval');assert.equal(submitted.payment,'not_requested');
  assert.equal((await post(requestUrl+'/fulfillment',{expected:'awaiting_approval',status:'ready_for_pickup',notify:true})).statusCode,409);
  assert.equal((await pool.query('SELECT * FROM request_notifications')).rowCount,0);

  // Another authenticated merchant must not decide this customer's request.
  const otherStore=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other merchant','true')",[otherStore]);
  const foreign=await createApp({...config,owner:{...owner,storeId:otherStore}},pool,undefined,undefined,async()=>({email:owner.email,subject:'other-owner'}),channel);apps.push(foreign);
  assert.equal((await foreign.inject({method:'POST',url:requestUrl+'/decision',headers,payload:{decision:'accepted',notify:true}})).statusCode,409);
  const accepted=await post(requestUrl+'/decision',{decision:'accepted',notify:true});assert.equal(accepted.statusCode,200,accepted.body);
  assert.equal(accepted.json().fulfillment,'preparing');assert.equal(accepted.json().customerNotification,'queued');
  assert.equal((await request()).payment,'not_requested');
  assert.equal((await pool.query("SELECT * FROM owner_audit WHERE action='request_decision' AND target_id=$1",[submitted.id])).rowCount,1);
  const notification=(await pool.query('SELECT * FROM whatsapp_outbox WHERE message_id=$1',[accepted.json().messageId])).rows[0];assert.equal(notification.sender_kind,'system');
  assert.equal(await channel.sendNext(),true);assert.match(sent.at(-1).text.body,/accepted.*preparing/i);assert.match(sent.at(-1).text.body,/not marked ready/i);
  assert.equal((await post(requestUrl+'/decision',{decision:'rejected',notify:true})).statusCode,409);
  await turn(channel,tap(await action(pool,{type:'shopping_action',action:'status'})));assert.match(sent.at(-1).interactive.body.text,/preparing/i);
  assert.equal((await post(requestUrl+'/fulfillment',{expected:'preparing',status:'collected',notify:true})).statusCode,409);
  assert.equal((await post(requestUrl+'/fulfillment',{expected:'awaiting_approval',status:'ready_for_pickup',notify:true})).statusCode,409);
  assert.equal((await foreign.inject({method:'POST',url:requestUrl+'/fulfillment',headers,payload:{expected:'preparing',status:'ready_for_pickup',notify:true}})).statusCode,409);

  const readyPayload={expected:'preparing',status:'ready_for_pickup',notify:true};
  const ready=await post(requestUrl+'/fulfillment',readyPayload);assert.equal(ready.statusCode,200,ready.body);assert.equal(ready.json().customerNotification,'queued');
  const repeated=await post(requestUrl+'/fulfillment',readyPayload);assert.equal(repeated.statusCode,200,repeated.body);assert.equal(repeated.json().duplicate,true);assert.equal(repeated.json().messageId,ready.json().messageId);
  assert.equal((await pool.query('SELECT * FROM request_notifications WHERE request_id=$1',[submitted.id])).rowCount,2);
  assert.equal(await channel.sendNext(),true);assert.match(sent.at(-1).text.body,/ready for pickup/i);assert.equal(await channel.sendNext(),false);
  await turn(channel,tap(await action(pool,{type:'shopping_action',action:'status'})));assert.match(sent.at(-1).interactive.body.text,/ready for pickup/i);
  const snapshot=(await app.inject({url:'/api/owner/snapshot',headers})).json();assert.equal(snapshot.requests.find((r:any)=>r.id===submitted.id).fulfillment,'ready_for_pickup');

  await turn(channel,{type:'text',text:{body:'talk to shop'}});
  const handedOff=await state();assert.equal(handedOff.operator_mode,'owner');assert.equal(handedOff.handoff_requested,true);
  assert.deepEqual(handedOff.draft,review.lines);assert.equal(handedOff.last_request_id,submitted.id);assert.deepEqual((await request()).lines,review.lines);
  const followup=inbound({type:'text',text:{body:'Where should I collect this?'}});
  await channel.receive(followup);assert.equal(await channel.processNext(),false);
  const manual={id:randomUUID(),text:'Please collect your items at the shop counter.',revision:handedOff.operator_revision},replyUrl='/api/owner/conversations/'+conversationId+'/reply';
  assert.equal((await post(replyUrl,manual)).statusCode,200);assert.equal((await post(replyUrl,manual)).statusCode,200);
  assert.equal((await pool.query("SELECT * FROM whatsapp_outbox WHERE sender_kind='owner'")).rowCount,1);
  assert.equal((await state()).handoff_requested,false);assert.equal(await channel.sendNext(),true);assert.equal(sent.at(-1).text.body,manual.text);assert.equal(await channel.sendNext(),false);

  // A later owner update persists, but cannot bypass the closed WhatsApp window.
  await pool.query("UPDATE whatsapp_conversations SET last_inbound_at=now()-interval '25 hours' WHERE conversation_id=$1",[conversationId]);
  const sendsBefore=sent.length,collected=await post(requestUrl+'/fulfillment',{expected:'ready_for_pickup',status:'collected',notify:true});
  assert.equal(collected.statusCode,200,collected.body);assert.equal(collected.json().customerNotification,'not_sent');
  assert.equal(await channel.sendNext(),false);assert.equal(sent.length,sendsBefore);
  const final=await request();assert.equal(final.fulfillment,'collected');assert.equal(final.payment,'not_requested');assert.deepEqual(final.lines,review.lines);assert.equal(final.total_paise,submitted.total_paise);
  assert.equal((await post(requestUrl+'/fulfillment',{expected:'collected',status:'ready_for_pickup',notify:true})).statusCode,409);
  assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,1);assert.equal((await pool.query('SELECT * FROM provider_attempts')).rowCount,0);
 }finally{for(const app of apps)await app.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});

test('owner controls and newer statuses invalidate queued notifications; explicit retries never resend uncertain outcomes',async()=>{
 const schema='owner_notifications_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`}),sent:any[]=[];
 let app:Awaited<ReturnType<typeof createApp>>|undefined,uncertainSend=false;
 try{
  await setupDatabase(pool,'mock');await setupImageDemo(pool,fixtureStore);
  const channel=new WhatsAppChannel(pool,cfg,async(_url,init)=>{
   const payload=JSON.parse(String(init!.body));assert.equal(payload.to,cfg.recipients[0]);sent.push(payload);
   if(uncertainSend)throw new Error('Synthetic response lost after send');
   return new Response(JSON.stringify({messages:[{id:'wamid.notification.'+sent.length}]}),{status:200});
  });await channel.setup();
  app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/offline-owner-notifications',owner,whatsapp:cfg},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline-owner'}),channel);
  const post=(url:string,payload:object)=>app!.inject({method:'POST',url,headers,payload});
  await turn(channel,{type:'text',text:{body:'2 H05'}});
  await turn(channel,tap(await action(pool,{type:'confirm_products'})));
  await turn(channel,tap(await action(pool,{type:'confirm'})));
  const request=(await pool.query('SELECT * FROM order_requests')).rows[0],url='/api/owner/requests/'+request.id;
  const inferenceBeforeOwner=(await pool.query('SELECT * FROM provider_attempts')).rowCount;
  const delivery=async(id:string)=>(await pool.query('SELECT state FROM whatsapp_outbox WHERE message_id=$1',[id])).rows[0].state;
  const control=async(mode:'owner'|'assistant')=>{
   const row=(await pool.query('SELECT operator_revision FROM conversations WHERE id=$1',[request.conversation_id])).rows[0];
   const result=await post('/api/owner/conversations/'+request.conversation_id+'/control',{mode,revision:row.operator_revision});assert.equal(result.statusCode,200,result.body);
  };
  const accepted=await post(url+'/decision',{decision:'accepted',notify:true});assert.equal(accepted.statusCode,200,accepted.body);
  const acceptanceId=accepted.json().messageId;assert.ok(acceptanceId);assert.equal(await delivery(acceptanceId),'queued');
  await control('owner');assert.equal(await delivery(acceptanceId),'cancelled');
  const readyPayload={expected:'preparing',status:'ready_for_pickup',notify:true};
  const ready=await post(url+'/fulfillment',readyPayload);assert.equal(ready.statusCode,200,ready.body);
  const firstReadyId=ready.json().messageId;assert.ok(firstReadyId);assert.equal(await delivery(firstReadyId),'queued');
  await control('assistant');assert.equal(await delivery(firstReadyId),'cancelled');
  const retried=await post(url+'/fulfillment',readyPayload);assert.equal(retried.statusCode,200,retried.body);
  const retryId=retried.json().messageId;assert.ok(retryId);assert.notEqual(retryId,firstReadyId);assert.equal(await delivery(retryId),'queued');
  const repeat=await post(url+'/fulfillment',readyPayload);assert.equal(repeat.statusCode,200,repeat.body);assert.equal(repeat.json().messageId,retryId);
  const receipt=(await pool.query("SELECT message_id FROM request_notifications WHERE request_id=$1 AND status_key='accepted:ready_for_pickup'",[request.id])).rows[0];assert.equal(receipt.message_id,retryId);
  assert.equal((await pool.query("SELECT * FROM whatsapp_outbox WHERE state='queued'")).rowCount,1);

  // Superseding readiness must cancel its unsent announcement even when the
  // owner initially declines to notify about collection.
  const collected=await post(url+'/fulfillment',{expected:'ready_for_pickup',status:'collected',notify:false});assert.equal(collected.statusCode,200,collected.body);
  assert.equal(await delivery(retryId),'cancelled');assert.equal(await channel.sendNext(),false);
  const collectedPayload={expected:'collected',status:'collected',notify:true};
  const announce=await post(url+'/fulfillment',collectedPayload);assert.equal(announce.statusCode,200,announce.body);
  const collectedId=announce.json().messageId;assert.ok(collectedId);
  const beforeSend=sent.length;uncertainSend=true;
  assert.equal(await channel.sendNext(),true);assert.equal(sent.length,beforeSend+1);assert.match(sent.at(-1).text.body,/marked.*collected/i);
  assert.equal(await delivery(collectedId),'unknown');
  const uncertainRetry=await post(url+'/fulfillment',collectedPayload);assert.equal(uncertainRetry.statusCode,200,uncertainRetry.body);assert.equal(uncertainRetry.json().messageId,collectedId);
  assert.equal(await delivery(collectedId),'unknown');assert.equal(await channel.sendNext(),false);assert.equal(sent.length,beforeSend+1);
  assert.equal((await pool.query("SELECT * FROM whatsapp_outbox WHERE state='queued'")).rowCount,0);
  assert.equal((await pool.query('SELECT * FROM provider_attempts')).rowCount,inferenceBeforeOwner);
  assert.equal((await pool.query("SELECT * FROM provider_attempts WHERE provider_mode='live'")).rowCount,0);
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});


test('staff acknowledges a handoff with a scoped visual receipt, rejects stale clicks, and notifies assistant resume',async()=>{
 const schema='handoff_ack_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let app:Awaited<ReturnType<typeof createApp>>|undefined;const sent:any[]=[];
 try{
  await setupDatabase(pool,'mock');await setupImageDemo(pool,fixtureStore);
  const visualCfg={...cfg,visualOrdering:true};
  const channel=new WhatsAppChannel(pool,visualCfg,async(_url,init)=>{sent.push(JSON.parse(String(init!.body)));return new Response(JSON.stringify({messages:[{id:'wamid.ack.'+sent.length}]}),{status:200});});await channel.setup();
  await turn(channel,{type:'text',text:{body:'hello'}});await turn(channel,{type:'text',text:{body:'talk to shop'}});
  const c=(await pool.query("SELECT * FROM conversations WHERE handoff_requested=true")).rows[0];assert.ok(c);
  app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/offline-handoff-ack',owner,whatsapp:visualCfg},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline-owner'}),channel);
  const post=(id:string,payload:object)=>app!.inject({method:'POST',url:'/api/owner/conversations/'+id+'/control',headers,payload});
  assert.equal((await post(randomUUID(),{mode:'owner',revision:c.operator_revision,acknowledge:true})).statusCode,409);
  const ack=await post(c.id,{mode:'owner',revision:c.operator_revision,acknowledge:true});assert.equal(ack.statusCode,200,ack.body);assert.equal(ack.json().customerNotification,'queued');
  assert.equal((await post(c.id,{mode:'owner',revision:c.operator_revision,acknowledge:true})).statusCode,409);
  const status=(await pool.query('SELECT * FROM whatsapp_outbox WHERE message_id=$1',[ack.json().messageId])).rows[0];assert.equal(status.sender_kind,'system');assert.equal(status.reply_payload.type,'text');assert.match(status.reply_payload.text.body,/checking your list/);
  assert.equal((await pool.query('SELECT handoff_requested FROM conversations WHERE id=$1',[c.id])).rows[0].handoff_requested,false);assert.equal(await channel.sendNext(),true);
  const resume=await post(c.id,{mode:'assistant',revision:ack.json().operator_revision,notify:true});assert.equal(resume.statusCode,200,resume.body);assert.equal(resume.json().customerNotification,'queued');assert.equal(await channel.sendNext(),true);assert.match(sent.at(-1).text.body,/assistant is available again/);
  const hold=await post(c.id,{mode:'owner',revision:resume.json().operator_revision});assert.equal(hold.statusCode,200);
  const state=(await pool.query('SELECT * FROM conversations WHERE id=$1',[c.id])).rows[0];
  await channel.runtime.tools.invoke({storeId:fixtureStore,conversationId:c.id,actor:c.actor,role:'customer'},{name:'apply_draft_changes',args:{expectedVersion:state.version,operations:[{kind:'add_item',query:'H08',quantity:1}]}},randomUUID());
  await channel.receive(inbound({type:'text',text:{body:'Hi'}}));const sentBefore=sent.length;
  const combined=await post(c.id,{mode:'assistant',revision:hold.json().operator_revision,notify:true});assert.equal(combined.statusCode,200);assert.equal(combined.json().customerNotification,'combined_with_pending_reply');
  assert.equal(await channel.processNext(),true);assert.equal(await channel.sendNext(),true);assert.equal(sent.length,sentBefore+1);assert.match(JSON.stringify(sent.at(-1)),/saved list with 1 item/);
  await pool.query("UPDATE conversations SET handoff_requested=true,operator_mode='owner' WHERE id=$1",[c.id]);await pool.query("UPDATE whatsapp_conversations SET last_inbound_at=now()-interval '25 hours' WHERE conversation_id=$1",[c.id]);
  const closed=await post(c.id,{mode:'owner',revision:combined.json().operator_revision,acknowledge:true});assert.equal(closed.statusCode,200,closed.body);assert.equal(closed.json().customerNotification,'not_sent');assert.equal(await channel.sendNext(),false);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_requests')).rows[0].n,0);
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
