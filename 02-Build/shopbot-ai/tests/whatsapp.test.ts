import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {createApp} from '../apps/server/src/http/app.js';
import {WhatsAppChannel,webhookSchema} from '../apps/server/src/services/whatsapp-channel.js';
import {readWhatsAppConfig,type WhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';
import {validSignature} from '../apps/server/src/http/whatsapp.js';
import {setupImageDemo} from '../apps/server/src/services/demo-catalog.js';
import {GoogleInterpreter} from '../apps/server/src/adapters/google-interpreter.js';
import {geminiTextRate} from '../apps/server/src/services/inference-budget.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {markProductConfirmed} from '../apps/server/src/services/product-verification.js';

const cfg:WhatsAppConfig={hostname:'shopbot-api.example.test',storeId:fixtureStore,appId:'123456789',wabaId:'987654321',phoneId:'123987654',appSecret:'test-app-secret-not-real',verifyToken:'test-verification-token',accessToken:'test-api-token-not-a-real-credential',graphVersion:'v25.0',recipients:['919000000001','919000000002'],defaultReplyLanguage:'en',processEnabled:true,sendEnabled:true};
const owner={hostname:'shopbot-preview.example.test',issuer:'https://shopbot-test.cloudflareaccess.com',audience:'test_application_audience_123',email:'owner@example.test',storeId:fixtureStore};
const event=(providerId:string,from=cfg.recipients[0],text='hello',seconds=Math.floor(Date.now()/1000))=>({object:'whatsapp_business_account',entry:[{id:cfg.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:cfg.phoneId},messages:[{id:providerId,from,timestamp:String(seconds),type:'text',text:{body:text}}]}}]}]});
const status=(providerId:string,state:string,recipient=cfg.recipients[0],callback?:string)=>({object:'whatsapp_business_account',entry:[{id:cfg.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:cfg.phoneId},statuses:[{id:providerId,recipient_id:recipient,timestamp:String(Math.floor(Date.now()/1000)),status:state,...(callback?{biz_opaque_callback_data:callback}:{})}]}}]}]});
test('owner waiting is acknowledged once and assistant resume sends fresh bound quantity choices',async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='wa_resume_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{
  await setupDatabase(pool,'mock');await setupImageDemo(pool,fixtureStore);
  const config={...cfg,visualOrdering:true},sent:any[]=[];
  const channel=new WhatsAppChannel(pool,config,async(_url,init)=>{sent.push(JSON.parse(String(init!.body)));return new Response(JSON.stringify({messages:[{id:'wamid.resume.'+sent.length}]}),{status:200});});await channel.setup();
  await channel.receive(webhookSchema.parse(event('wamid.resume-start')));await channel.processNext();await channel.sendNext();
  const c=(await pool.query('SELECT id,actor FROM conversations WHERE id IN (SELECT conversation_id FROM whatsapp_conversations)')).rows[0],ctx={storeId:fixtureStore,conversationId:c.id,actor:c.actor,role:'customer' as const};
  const state=(await new RetailTools(pool).invoke(ctx,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'H02',quantity:2},{kind:'add_item',query:'H22',quantity:null}]}},'resume-seed')).state!;
  for(const l of state.draft)markProductConfirmed(l,l.candidates![0]);
  const expired={kind:'products',id:randomUUID(),groups:[],version:state.version,expiresAt:new Date(0).toISOString(),remaining:0};
  await pool.query("UPDATE conversations SET draft=$1::jsonb,pending=$2::jsonb,operator_mode='owner',operator_revision=1 WHERE id=$3",[JSON.stringify(state.draft),JSON.stringify(expired),c.id]);
  await channel.receive(webhookSchema.parse(event('wamid.waiting-1',undefined,'two H22')));await channel.receive(webhookSchema.parse(event('wamid.waiting-2',undefined,'two H22')));
  assert.equal(await channel.processNext(),false);assert.equal((await pool.query("SELECT count(*)::int AS n FROM messages WHERE payload->>'clarificationReason'='owner_handling'")).rows[0].n,1);
  assert.equal(await channel.sendNext(),true);assert.match(sent.at(-1).text.body,/shop is handling/);
  // The owner resolves these pending notes before returning control.
  await pool.query("UPDATE messages SET status='processed' WHERE conversation_id=$1 AND direction='inbound'",[c.id]);
  app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/wa-resume-test',owner,whatsapp:config},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline-owner'}),channel);
  const res=await app.inject({method:'POST',url:'/api/owner/conversations/'+c.id+'/control',headers:{host:owner.hostname,'cf-access-jwt-assertion':'offline-owner',origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json'},payload:{mode:'assistant',revision:1,notify:true}});assert.equal(res.statusCode,200,res.body);
  const current=(await pool.query('SELECT pending,draft,version FROM conversations WHERE id=$1',[c.id])).rows[0];assert.equal(current.pending.kind,'question');assert.equal(current.pending.lineId,state.draft[1].id);assert.deepEqual(current.draft.map((l:any)=>l.id),state.draft.map(l=>l.id));
  const actions=(await pool.query("SELECT a.* FROM whatsapp_actions a JOIN whatsapp_outbox o ON o.message_id=a.message_id WHERE o.operator_revision=2 AND o.state='queued'")).rows;assert.ok(actions.length);assert.ok(actions.every(a=>a.source_version===current.version&&a.binding_id===current.pending.id));
  const reply=(await pool.query("SELECT text FROM messages WHERE conversation_id=$1 AND direction='outbound' ORDER BY sequence DESC LIMIT 1",[c.id])).rows[0].text;assert.match(reply,/assistant is back/);assert.match(reply,/How many/);assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,0);
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
test('WhatsApp signature covers exact bytes and channel flags require complete configuration',()=>{
 const bytes=Buffer.from('{"value":1}'),signature='sha256='+createHmac('sha256',cfg.appSecret).update(bytes).digest('hex');
 assert.equal(validSignature(bytes,signature,cfg.appSecret),true);
 assert.equal(validSignature(Buffer.from('{"value": 1}'),signature,cfg.appSecret),false);
 assert.equal(validSignature(bytes,'sha256=bad',cfg.appSecret),false);
 assert.throws(()=>readWhatsAppConfig({WHATSAPP_SEND_ENABLED:'true'}),/explicit/);
 assert.throws(()=>readWhatsAppConfig({WHATSAPP_ENABLED:'true'}),/Complete/);
 assert.throws(()=>readWhatsAppConfig({WHATSAPP_ENABLED:'true',WHATSAPP_AI_ENABLED:'true'}),/free-only/);
});
test('WhatsApp free AI uses the scoped hardware catalog, delivered history and text product-code choices without repeating inference',async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='wa_ai_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');await setupImageDemo(pool,fixtureStore);
  assert.equal((await pool.query('SELECT count(*) FROM products WHERE store_id=$1 AND sku ~ $2',[fixtureStore,'^H[0-9]{2}$'])).rows[0].count,'30');
  assert.equal((await pool.query('SELECT count(*) FROM products WHERE store_id=$1',[fixtureStore])).rows[0].count,'36');
  let calls=0,history:unknown;
  const provider=new GoogleInterpreter({allowPaidInference:false,apiKey:'offline',model:geminiTextRate.model,budgetMicrousd:0,freeQuota:{scope:'wa-ai-test',model:geminiTextRate.model}},{generateContent:async params=>{
   calls++;history=JSON.parse(String(params.contents)).recentMessages;
   return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({operations:[],next:'assist',assistance:{rootQuery:'pipe cutter',queries:['pipe cutter'],question:'What pipe material will you cut?'}})}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:100,totalTokenCount:1100}} as any;
  }});
  assert.throws(()=>new WhatsAppChannel(pool,{...cfg,aiEnabled:true}),/free-tier/);
  const channel=new WhatsAppChannel(pool,{...cfg,aiEnabled:true,discoveryStages:true},async()=>new Response(JSON.stringify({messages:[{id:'wamid.ai-out'}]}),{status:200}),provider);
  await channel.setup();await channel.receive(webhookSchema.parse(event('wamid.greeting',undefined,'hi')));await channel.processNext();await channel.sendNext();
  await channel.receive(webhookSchema.parse(status('wamid.ai-out','delivered')));
  await channel.receive(webhookSchema.parse(event('wamid.cutter',undefined,'i want cutter')));await channel.processNext();
  assert.equal(calls,1);await pool.query("UPDATE provider_attempts SET created_at=now()-interval '7 seconds'");await pool.query('UPDATE messages SET not_before=now()');await channel.processNext();
  assert.equal(calls,2);assert.ok(JSON.stringify(history).includes('What are you looking for'));
  const reply=(await pool.query("SELECT text,payload FROM messages WHERE direction='outbound' ORDER BY sequence DESC LIMIT 1")).rows[0];
  assert.equal(reply.payload.cards[0].product.sku,'H19');assert.ok(!reply.text.includes('hi i want cutter'));
  await channel.receive(webhookSchema.parse(event('wamid.code',undefined,'H19')));await channel.processNext();assert.equal(calls,2);
  const draft=(await pool.query('SELECT draft FROM conversations WHERE id IN (SELECT conversation_id FROM whatsapp_conversations)')).rows[0].draft;
  assert.equal(draft[0].sku,'H19');assert.equal(draft[0].quantity,null);
  const attempts=(await pool.query("SELECT provider_mode,billing_state FROM provider_attempts WHERE provider_mode='live'")).rows;
  assert.deepEqual(attempts,[{provider_mode:'live',billing_state:'free_declared'},{provider_mode:'live',billing_state:'free_declared'}]);
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
test('signed ingress isolates hosts/assets/recipients, commits before ACK, deduplicates batches and honors owner controls',async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='whatsapp_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{
  await setupDatabase(pool,'mock');let sends=0;
  const channel=new WhatsAppChannel(pool,cfg,async(_url,init)=>{
   sends++;const body=JSON.parse(String(init!.body));assert.ok(['text','interactive'].includes(body.type));assert.equal(body.to,cfg.recipients[0]);
   return new Response(JSON.stringify({messages:[{id:'wamid.out.'+sends}]}),{status:200});
  });
  const config={mode:'mock' as const,databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/wa-test',owner,whatsapp:cfg};
  app=await createApp(config,pool,undefined,undefined,async()=>({email:owner.email,subject:'owner'}),channel);
  const headers={host:cfg.hostname,'content-type':'application/json'};
  const post=(data:unknown,extra:Record<string,string>={})=>{const payload=JSON.stringify(data);return app!.inject({method:'POST',url:'/webhooks/whatsapp',payload,headers:{...headers,'x-hub-signature-256':'sha256='+createHmac('sha256',cfg.appSecret).update(payload).digest('hex'),...extra}});};
  assert.equal((await app.inject({url:'/owner',headers:{host:cfg.hostname}})).statusCode,404);
  assert.equal((await app.inject({url:'/api/simulator',headers:{host:cfg.hostname}})).statusCode,404);
  assert.equal((await post(event('wamid.one'),{host:owner.hostname})).statusCode,404);
  assert.equal((await post(event('wamid.one'),{'x-hub-signature-256':'sha256='+'0'.repeat(64)})).statusCode,403);
  assert.equal((await app.inject({url:'/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123',headers:{host:cfg.hostname}})).statusCode,403);
  const verified=await app.inject({url:'/webhooks/whatsapp?'+new URLSearchParams({'hub.mode':'subscribe','hub.verify_token':cfg.verifyToken,'hub.challenge':'123'}),headers:{host:cfg.hostname}});
  assert.equal(verified.statusCode,200);assert.equal(verified.body,'123');
  const wrong=event('wamid.wrong');wrong.entry[0].id='other-account';assert.equal((await post(wrong)).statusCode,200);
  assert.equal((await post(event('wamid.outside','919000000003'))).statusCode,200);
  assert.equal((await pool.query('SELECT * FROM whatsapp_inbound')).rowCount,0);
  await Promise.all([post(event('wamid.one')),post(event('wamid.one'))]);
  assert.equal((await pool.query('SELECT * FROM whatsapp_inbound')).rowCount,1);
  const mapped=(await pool.query('SELECT * FROM whatsapp_conversations')).rows[0];
  assert.notEqual(mapped.conversation_id,'00000000-0000-4000-8000-000000000002');
  await pool.query('UPDATE stores SET operator_paused=true WHERE id=$1',[fixtureStore]);assert.equal(await channel.processNext(),false);
  await pool.query('UPDATE stores SET operator_paused=false WHERE id=$1',[fixtureStore]);assert.equal(await channel.processNext(),true);
  assert.equal((await pool.query('SELECT state FROM whatsapp_outbox')).rows[0].state,'queued');assert.equal(sends,0);
  await pool.query("UPDATE conversations SET operator_mode='owner',operator_revision=operator_revision+1 WHERE id=$1",[mapped.conversation_id]);assert.equal(await channel.sendNext(),false);
  await pool.query("UPDATE conversations SET operator_mode='assistant',operator_revision=operator_revision+1 WHERE id=$1",[mapped.conversation_id]);await channel.sendNext();assert.equal(sends,0);
  assert.equal((await pool.query('SELECT state FROM whatsapp_outbox')).rows[0].state,'blocked');
  await post(event('wamid.two'));await channel.processNext();await channel.sendNext();assert.equal(sends,1);
  let out=(await pool.query("SELECT * FROM whatsapp_outbox WHERE state='accepted'")).rows[0];assert.equal(out.provider_id,'wamid.out.1');
  await post(status(out.provider_id,'read'));await post(status(out.provider_id,'sent'));
  assert.equal((await pool.query('SELECT state FROM whatsapp_outbox WHERE message_id=$1',[out.message_id])).rows[0].state,'read');
  const batch=event('wamid.three');batch.entry[0].changes[0].value.messages.push({...batch.entry[0].changes[0].value.messages[0],id:'wamid.four',from:cfg.recipients[1]});
  await post(batch);assert.equal((await pool.query('SELECT * FROM whatsapp_conversations')).rowCount,2);
  assert.equal((await pool.query('SELECT * FROM whatsapp_inbound')).rowCount,4);
  const ownerHeaders={host:owner.hostname,'cf-access-jwt-assertion':'synthetic-test'};
  const snapshot=(await app.inject({url:'/api/owner/snapshot',headers:ownerHeaders})).json();assert.equal(snapshot.channel.whatsapp,'receiving');assert.equal(snapshot.channel.liveSending,true);assert.equal(snapshot.inference.enabled,false);
  const legacy=await createApp({...config,whatsapp:{...cfg,path:'/webhook'}},pool,undefined,undefined,async()=>({email:owner.email,subject:'owner'}));
  try{
   assert.equal((await legacy.inject({url:'/privacy',headers:{host:cfg.hostname}})).statusCode,404);
   assert.equal((await legacy.inject({url:'/api/owner/privacy-draft',headers:{host:owner.hostname}})).statusCode,403);
   assert.equal((await legacy.inject({url:'/webhooks/whatsapp',headers:{host:cfg.hostname}})).statusCode,404);
   assert.equal((await legacy.inject({url:'/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123',headers:{host:cfg.hostname}})).statusCode,403);
  }finally{await legacy.close();}
  const ignored={object:'whatsapp_business_account',entry:[{id:cfg.wabaId,changes:[{field:'account_alerts',value:{alert:'synthetic'}}]}]};assert.equal((await post(ignored)).statusCode,200);
  const recreated=new WhatsAppChannel(pool,cfg);await recreated.setup();assert.equal((await pool.query('SELECT * FROM whatsapp_inbound')).rowCount,4);
  await assert.rejects(new WhatsAppChannel(pool,{...cfg,appId:'99999999'}).setup(),/already bound/);
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
test('closed service window, uncertain sends, early statuses and authentication failure do not cause repeated sends',async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='wa_delivery_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');let sends=0;
  const channel=new WhatsAppChannel(pool,cfg,async()=>{sends++;throw new Error('synthetic timeout');});await channel.setup();
  await channel.receive(webhookSchema.parse(event('wamid.old',cfg.recipients[0],'hello',Math.floor(Date.now()/1000)-25*3600)));await channel.processNext();await channel.sendNext();assert.equal(sends,0);
  await channel.receive(webhookSchema.parse(event('wamid.new')));await channel.processNext();await channel.sendNext();assert.equal(sends,1);assert.equal(await channel.sendNext(),false);
  const unknown=(await pool.query("SELECT message_id FROM whatsapp_outbox WHERE state='unknown'")).rows[0].message_id;
  await channel.receive(webhookSchema.parse(status('wamid.early','delivered',cfg.recipients[0],unknown)));
  assert.equal((await pool.query('SELECT status FROM messages WHERE id=$1',[unknown])).rows[0].status,'delivered');
  const denied=new WhatsAppChannel(pool,cfg,async()=>{sends++;return new Response(JSON.stringify({error:{code:190}}),{status:401});});
  await denied.receive(webhookSchema.parse(event('wamid.auth')));await denied.processNext();await denied.sendNext();assert.equal(sends,2);
  assert.equal((await pool.query('SELECT send_blocked FROM whatsapp_channels')).rows[0].send_blocked,true);
  await denied.receive(webhookSchema.parse(event('wamid.next')));await denied.processNext();assert.equal(await denied.sendNext(),false);assert.equal(sends,2);
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
