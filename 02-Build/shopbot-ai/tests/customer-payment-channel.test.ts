import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {WhatsAppChannel,webhookSchema} from '../apps/server/src/services/whatsapp-channel.js';
import type {WhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';
import {createApp} from '../apps/server/src/http/app.js';
import {fixtureStore} from '../profiles/hardware.js';

const config:WhatsAppConfig={hostname:'bot.example.test',storeId:fixtureStore,appId:'123456789',wabaId:'987654321',phoneId:'123987654',appSecret:'offline-only-secret',verifyToken:'offline-only-verify',accessToken:'offline-only-token',graphVersion:'v25.0',recipients:['919000000001'],defaultReplyLanguage:'en',processEnabled:true,sendEnabled:true,partialReviews:true,advance:{vpa:'fixture.merchant@bank',name:'Fixture merchant',hostname:'bot.example.test'}};
const owner={hostname:'owner.example.test',issuer:'https://test.cloudflareaccess.com',audience:'offline-audience',email:'owner@example.test',storeId:fixtureStore};
const headers={host:owner.hostname,'cf-access-jwt-assertion':'offline-owner',origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json'};
function inbound(body:object){return webhookSchema.parse({object:'whatsapp_business_account',entry:[{id:config.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:config.phoneId},messages:[{id:'wamid.fixture.'+randomUUID(),from:config.recipients[0],timestamp:String(Math.floor(Date.now()/1000)),...body}]}}]}]});}

test('WhatsApp → partial estimate → QR → manual advance check → final quote → amendment → pickup preserves consent and original order',async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='upi_channel_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{
  await setupDatabase(pool,'mock');let sends=0;
  const channel=new WhatsAppChannel(pool,config,async()=>new Response(JSON.stringify({messages:[{id:'wamid.fixture.sent.'+(++sends)}]}),{status:200}));await channel.setup();
  app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/upi-channel',owner,whatsapp:config},pool,undefined,undefined,async()=>({email:owner.email,subject:'fixture-owner'}),channel);
  const post=(path:string,payload:object)=>app!.inject({method:'POST',url:'/api/owner/'+path,headers,payload});
  const deliver=async()=>{while(await channel.sendNext()){}await pool.query("UPDATE whatsapp_outbox SET state='delivered' WHERE state='accepted'");await pool.query("UPDATE messages SET status='delivered' WHERE id IN (SELECT message_id FROM whatsapp_outbox WHERE state='delivered')");};
  const turn=async(body:object)=>{await channel.receive(inbound(body));assert.equal(await channel.processNext(),true);await deliver();};
  const tap=async(event:object)=>{
   const action=(await pool.query("SELECT a.*,o.provider_id FROM whatsapp_actions a JOIN whatsapp_outbox o ON o.message_id=a.message_id WHERE a.event @> $1::jsonb AND o.state IN ('delivered','read') ORDER BY o.created_at DESC LIMIT 1",[JSON.stringify(event)])).rows[0];
   assert.ok(action,'the bound action must have been delivered');
   await turn({type:'interactive',context:{id:action.provider_id},interactive:{type:'button_reply',button_reply:{id:action.id,title:'untrusted customer title'}}});
   return action;
  };
  await turn({type:'text',text:{body:'I need two PTFE tape rolls and one unicorn bolt'}});
  await tap({type:'review_partial'});await tap({type:'confirm'});
  let request=(await pool.query('SELECT * FROM order_requests')).rows[0];assert.ok(request);const original=structuredClone(request.lines),path='requests/'+request.id;
  const advance=(await pool.query('SELECT * FROM order_advances')).rows[0];
  const page=await app.inject({url:'/pay/'+advance.id,headers:{host:config.hostname}});assert.equal(page.statusCode,200,page.body);assert.match(page.body,/upi:\/\/pay/);assert.doesNotMatch(page.body,/unicorn|PTFE/);
  assert.equal((await app.inject({url:'/api/owner/snapshot',headers:{host:config.hostname}})).statusCode,404);
  await tap({type:'payment_claim'});assert.equal((await pool.query('SELECT state FROM order_advances')).rows[0].state,'claimed');
  assert.equal((await post(path+'/decision',{decision:'accepted',notify:true})).statusCode,409);
  const verified=await post(path+'/advance/verify',{reference:'UPI-987654321012',notify:true});assert.equal(verified.statusCode,200,verified.body);await deliver();
  assert.equal((await post(path+'/decision',{decision:'accepted',notify:true})).statusCode,409,'unknown items still require a quote');
  const quote=await post(path+'/quote',{id:randomUUID(),expectedRevision:1,lines:request.lines.map((l:any)=>({id:l.id,name:l.name,quantity:l.quantity??1,unit:l.unit??'piece',pricePaise:l.sku?l.pricePaise:2500})),notify:true});assert.equal(quote.statusCode,200,quote.body);await deliver();
  const quoteAction=await tap({type:'confirm_order_quote'});
  const q=(await pool.query('SELECT * FROM order_quotes')).rows[0];assert.equal(q.state,'accepted');assert.notEqual(q.consent_message_id,quoteAction.event.id,'consent records the actual inbound message ID, not the outbound button ID');
  const consent=(await pool.query('SELECT payload FROM messages WHERE id=$1',[q.consent_message_id])).rows[0];assert.equal(consent.payload.type,'confirm_order_quote');
  const accept=await post(path+'/decision',{decision:'accepted',notify:true});assert.equal(accept.statusCode,200,accept.body);await deliver();
  await turn({type:'text',text:{body:'change the tape to three'}});
  const amendment=(await pool.query('SELECT * FROM order_amendments')).rows[0];assert.ok(amendment);await tap({type:'confirm_amendment'});
  const changed=await post('amendments/'+amendment.id+'/decision',{decision:'accepted',notify:true});assert.equal(changed.statusCode,200,changed.body);await deliver();
  request=(await pool.query('SELECT * FROM order_requests')).rows[0];assert.deepEqual(request.lines,original);assert.equal(request.effective_lines.find((l:any)=>l.sku==='PTFE-TAPE').quantity,3);
  assert.equal((await pool.query('SELECT * FROM order_advances')).rowCount,1);
  const ready=await post(path+'/fulfillment',{expected:'preparing',status:'ready_for_pickup',notify:true});assert.equal(ready.statusCode,200,ready.body);await deliver();
  const collected=await post(path+'/fulfillment',{expected:'ready_for_pickup',status:'collected',notify:true});assert.equal(collected.statusCode,200,collected.body);await deliver();
  const before=sends;await turn({type:'text',text:{body:'thanks 👍'}});assert.equal(sends,before);
  await turn({type:'text',text:{body:'status'}});assert.equal(sends,before+1);assert.match((await pool.query("SELECT text FROM messages WHERE direction='outbound' ORDER BY sequence DESC LIMIT 1")).rows[0].text,/collected/);
  assert.equal((await pool.query('SELECT operator_mode FROM conversations WHERE id=$1',[request.conversation_id])).rows[0].operator_mode,'assistant');
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
