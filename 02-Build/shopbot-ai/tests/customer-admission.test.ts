import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {WhatsAppChannel,webhookSchema} from '../apps/server/src/services/whatsapp-channel.js';
import {readWhatsAppConfig,type WhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';
import {admissionKey,recipientAllowed} from '../apps/server/src/services/customer-admission.js';
import {geminiTextRate} from '../apps/server/src/services/inference-budget.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import {createApp} from '../apps/server/src/http/app.js';

const offlineFetch:typeof fetch=async()=>new Response(JSON.stringify({messages:[{id:'offline-'+randomUUID()}]}),{status:200});
const external='919000000099';
const config:WhatsAppConfig={audience:'public',hostname:'shopbot.example.test',storeId:fixtureStore,appId:'123456789',wabaId:'987654321',phoneId:'123987654',appSecret:'offline-secret-1234',verifyToken:'offline-verify-1234',accessToken:'offline-token-not-real-123456789012345',graphVersion:'v25.0',recipients:[],defaultReplyLanguage:'en',processEnabled:true,sendEnabled:true};
const incoming=(id:string,text='hello',from=external,type='text')=>webhookSchema.parse({object:'whatsapp_business_account',entry:[{id:config.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:config.phoneId},messages:[{id,from,timestamp:String(Math.floor(Date.now()/1000)),type,...(type==='text'?{text:{body:text}}:{audio:{id:'offline-audio'}})}]}}]}]});
async function fixture(run:(pool:pg.Pool)=>Promise<void>){
 assert.ok(process.env.DATABASE_URL,'Use an isolated test database');
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='customer_guard_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');await run(pool);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
function provider(output:unknown,calls:{value:number}):Interpreter{return {name:'offline-cost-test',mode:'live',billing:geminiTextRate,supportsAudio:true,interpret:async()=>{calls.value++;return {output,truncated:false,usage:{promptTokenCount:10,candidatesTokenCount:10}};}};}
async function runTurn(channel:WhatsAppChannel,pool:pg.Pool){await pool.query("UPDATE provider_attempts SET created_at=now()-interval '10 seconds'");await pool.query('UPDATE messages SET not_before=NULL');return channel.processNext({skipMedia:true});}

test('public admission is explicit and test mode keeps its allowlist',()=>{
 const e={WHATSAPP_ENABLED:'true',WHATSAPP_HOSTNAME:config.hostname,WHATSAPP_STORE_ID:fixtureStore,WHATSAPP_APP_ID:config.appId,WHATSAPP_WABA_ID:config.wabaId,WHATSAPP_PHONE_ID:config.phoneId,WHATSAPP_APP_SECRET:config.appSecret,WHATSAPP_VERIFY_TOKEN:config.verifyToken,WHATSAPP_ACCESS_TOKEN:config.accessToken};
 assert.throws(()=>readWhatsAppConfig(e));
 assert.equal(readWhatsAppConfig({...e,WHATSAPP_AUDIENCE:'public'})?.audience,'public');
 assert.throws(()=>readWhatsAppConfig({...e,WHATSAPP_AUDIENCE:'pubic'}));
 assert.equal(recipientAllowed(config,external),true);
 assert.equal(recipientAllowed({...config,audience:'test'},external),false);
 assert.equal(recipientAllowed(config,'not-a-phone'),false);
 assert.equal(admissionKey(' HI! ',0,null),admissionKey('hello',4,'a'));
 assert.notEqual(admissionKey('2',0,'a'),admissionKey('2',1,'b'));
});

test('a fresh non-allowlisted customer receives a greeting and delivery status is retained',()=>fixture(async pool=>{
 let sends=0;const channel=new WhatsAppChannel(pool,config,async()=>{sends++;return new Response(JSON.stringify({messages:[{id:'offline-sent'}]}),{status:200});});
 await channel.setup();assert.equal((await channel.receive(incoming('new-customer'))).accepted,1);
 assert.equal(await channel.processNext(),true);assert.equal(await channel.sendNext(),true);assert.equal(sends,1);
 const delivered=webhookSchema.parse({object:'whatsapp_business_account',entry:[{id:config.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:config.phoneId},statuses:[{id:'offline-sent',recipient_id:external,timestamp:String(Math.floor(Date.now()/1000)),status:'delivered'}]}}]}]});
 await channel.receive(delivered);assert.equal((await pool.query('SELECT state FROM whatsapp_outbox')).rows[0].state,'delivered');
 const wrong=incoming('wrong');wrong.entry[0].id='999999999';assert.equal((await channel.receive(wrong)).accepted,0);
}));

test('repeats survive a worker restart, stop model calls, and hand over once without dropping inbound',()=>fixture(async pool=>{
 const calls={value:0},p=provider({operations:[],next:'continue',conversation:'unrelated'},calls);
 let channel=new WhatsAppChannel(pool,{...config,aiEnabled:true,paidEnabled:true,budgetMicrousd:5000000},offlineFetch,p);await channel.setup();
 await channel.receive(incoming('repeat-1','asdf qwer'));await runTurn(channel,pool);assert.equal(calls.value,1);
 channel=new WhatsAppChannel(pool,{...config,aiEnabled:true,paidEnabled:true,budgetMicrousd:5000000},offlineFetch,p);await channel.setup();
 await channel.receive(incoming('repeat-2','ASDF   qwer'));await runTurn(channel,pool);assert.equal(calls.value,1);
 await channel.receive(incoming('repeat-3','asdf qwer'));
 await channel.receive(incoming('repeat-4','asdf qwer'));
 await channel.receive(incoming('repeat-4','asdf qwer')); // Meta retry, not a new turn.
 assert.equal((await pool.query('SELECT count(*) FROM whatsapp_inbound')).rows[0].count,'4');
 const c=(await pool.query('SELECT operator_mode,handoff_requested FROM conversations WHERE id IN (SELECT conversation_id FROM whatsapp_conversations)')).rows[0];
 assert.equal(c.operator_mode,'owner');assert.equal(c.handoff_requested,true);assert.equal(await runTurn(channel,pool),false);assert.equal(calls.value,1);
 assert.equal((await pool.query("SELECT count(*) FROM messages WHERE payload->>'clarificationReason'='owner_handling'")).rows[0].count,'1');
 assert.equal((await pool.query("SELECT count(*) FROM owner_audit WHERE action='customer_guard_handoff'")).rows[0].count,'1');
}));

test('a thirty-message burst is retained and handed over before any AI, with other customers unaffected',()=>fixture(async pool=>{
 const calls={value:0},p=provider({operations:[],next:'continue'},calls);
 const channel=new WhatsAppChannel(pool,{...config,aiEnabled:true,paidEnabled:true,budgetMicrousd:5000000},offlineFetch,p);await channel.setup();
 for(let i=0;i<50;i++)await channel.receive(incoming('burst-'+i,'item description '+i));
 assert.equal((await pool.query('SELECT count(*) FROM whatsapp_inbound')).rows[0].count,'50');
 assert.equal(await runTurn(channel,pool),false);assert.equal(calls.value,0);
 assert.equal((await pool.query('SELECT reason FROM whatsapp_customer_guards')).rows[0].reason,'message_burst');
 await channel.receive(incoming('other-customer','hi','919000000088'));await runTurn(channel,pool);assert.equal(calls.value,0);
 const states=(await pool.query('SELECT recipient,operator_mode FROM whatsapp_conversations w JOIN conversations c ON c.id=w.conversation_id ORDER BY recipient')).rows;
 assert.deepEqual(states,[{recipient:'919000000088',operator_mode:'assistant'},{recipient:external,operator_mode:'owner'}]);
}));

test('distinct off-topic turns reuse existing interpretation then stop; typos are not a spam heuristic',()=>fixture(async pool=>{
 const calls={value:0},p=provider({operations:[],next:'continue',conversation:'unrelated'},calls);
 const channel=new WhatsAppChannel(pool,{...config,aiEnabled:true,paidEnabled:true,budgetMicrousd:5000000},offlineFetch,p);await channel.setup();
 await channel.receive(incoming('off-topic-1','my unrelated personal memo'));await runTurn(channel,pool);
 await channel.receive(incoming('off-topic-2','another personal memo'));await runTurn(channel,pool);
 assert.equal(calls.value,2);assert.equal((await pool.query('SELECT reason FROM whatsapp_customer_guards')).rows[0].reason,'repeated_unrelated_intent');
 const q=provider({operations:[],next:'continue',clarifyQuestion:'Which item do you need?'},calls);
 const second=new WhatsAppChannel(pool,{...config,aiEnabled:true,paidEnabled:true,budgetMicrousd:5000000},offlineFetch,q);
 await second.receive(incoming('typo','piip cuter','919000000077'));await runTurn(second,pool);
 assert.equal((await pool.query('SELECT operator_mode FROM conversations c JOIN whatsapp_conversations w ON w.conversation_id=c.id WHERE w.recipient=$1',['919000000077'])).rows[0].operator_mode,'assistant');
}));

test('voice can be a first message and repeated unreadable speech hands over without losing attachments',()=>fixture(async pool=>{
 const calls={value:0},p=provider({operations:[],next:'continue',conversation:'unrelated',transcript:'unrelated personal recording'},calls);
 const channel=new WhatsAppChannel(pool,{...config,aiEnabled:true,mediaEnabled:true,paidEnabled:true,budgetMicrousd:5000000},offlineFetch,p);await channel.setup();
 for(let i=0;i<2;i++){
  await channel.receive(incoming('voice-'+i,'',external,'audio'));
  const row=(await pool.query("SELECT m.id,c.actor,m.conversation_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.direction='inbound' ORDER BY m.sequence DESC LIMIT 1")).rows[0];
  await pool.query('INSERT INTO voice_media(id,store_id,conversation_id,actor,source_hash,audio,duration_seconds,source_version) VALUES($1,$2,$3,$4,$5,$6,1,0)',[row.id,fixtureStore,row.conversation_id,row.actor,'a'.repeat(64),Buffer.from('synthetic audio')]);
  await pool.query("UPDATE whatsapp_media SET state='ready' WHERE message_id=$1",[row.id]);
  for(let attempt=0;attempt<4;attempt++){await runTurn(channel,pool);if(!(await pool.query("SELECT 1 FROM messages WHERE id=$1 AND status IN ('pending','processing')",[row.id])).rowCount)break;}
 }
 assert.equal(calls.value,4);assert.equal((await pool.query('SELECT count(*) FROM voice_media')).rows[0].count,'2');
 assert.equal((await pool.query('SELECT operator_mode FROM conversations WHERE id IN (SELECT conversation_id FROM whatsapp_conversations)')).rows[0].operator_mode,'owner');
}));

test('owner can reply to a newly admitted customer and resume without replaying held spam',()=>fixture(async pool=>{
 const channel=new WhatsAppChannel(pool,config);await channel.setup();
 for(let i=0;i<3;i++)await channel.receive(incoming('hello-'+i,'hi'));
 const c=(await pool.query('SELECT id,operator_revision FROM conversations WHERE id IN (SELECT conversation_id FROM whatsapp_conversations)')).rows[0];
 const owner={hostname:'owner.example.test',issuer:'https://owner.cloudflareaccess.com',audience:'offline-audience',email:'owner@example.test',storeId:fixtureStore};
 const app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/guard-test-media',owner,whatsapp:config},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline-owner'}),channel);
 try{
  const headers={host:owner.hostname,'cf-access-jwt-assertion':'offline-owner',origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json'};
  const snapshot=await app.inject({url:'/api/owner/snapshot',headers});assert.equal(snapshot.statusCode,200,snapshot.body);assert.equal(snapshot.json().channel.testOnly,false);
  const reply=await app.inject({method:'POST',url:'/api/owner/conversations/'+c.id+'/reply',headers,payload:{id:randomUUID(),revision:c.operator_revision,text:'I can help with your order.'}});assert.equal(reply.statusCode,200,reply.body);
  await pool.query("UPDATE whatsapp_outbox SET state='delivered' WHERE sender_kind='owner'");
  const resume=await app.inject({method:'POST',url:'/api/owner/conversations/'+c.id+'/control',headers,payload:{mode:'assistant',revision:c.operator_revision}});assert.equal(resume.statusCode,200,resume.body);
  assert.equal(await channel.processNext(),false);
  await channel.receive(incoming('after-resume','hello'));await channel.processNext();
  assert.equal((await pool.query('SELECT operator_mode FROM conversations WHERE id=$1',[c.id])).rows[0].operator_mode,'assistant');
 }finally{await app.close();}
}));

test('burst handover invalidates an in-flight model result before it can change the draft or reply',()=>fixture(async pool=>{
 let unblock!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>{unblock=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
 const calls={value:0},p=provider({operations:[],next:'continue'},calls);
 p.interpret=async()=>{calls.value++;started();await gate;return {output:{operations:[],next:'continue'},truncated:false,usage:{promptTokenCount:10,candidatesTokenCount:10}};};
 const channel=new WhatsAppChannel(pool,{...config,aiEnabled:true,paidEnabled:true,budgetMicrousd:5000000},offlineFetch,p);await channel.setup();
 await channel.receive(incoming('in-flight','need a nail'));const planning=runTurn(channel,pool);await entered;
 try{for(let i=0;i<30;i++)await channel.receive(incoming('flood-flight-'+i,'different note '+i));}finally{unblock();}
 await planning;assert.equal(calls.value,1);assert.equal(await runTurn(channel,pool),false);
 assert.equal((await pool.query("SELECT count(*) FROM whatsapp_outbox WHERE state='queued'")).rows[0].count,'1');
 assert.equal((await pool.query("SELECT count(*) FROM messages WHERE status='processing'")).rows[0].count,'0');
 assert.deepEqual((await pool.query('SELECT draft FROM conversations WHERE id IN (SELECT conversation_id FROM whatsapp_conversations)')).rows[0].draft,[]);
}));

test('re-sent voice bytes skip AI after the first turn and owner-held recordings remain playable',()=>fixture(async pool=>{
 const {pcmWav}=await import('../apps/server/src/services/voice-media.js');
 const pcm=Buffer.alloc(32000);for(let i=0;i<16000;i++)pcm.writeInt16LE(Math.round(Math.sin(i*.17)*1200),i*2);const bytes=pcmWav(pcm);
 const calls={value:0},p=provider({operations:[],next:'continue',conversation:'unrelated',transcript:'a personal recording'},calls);
 const transport:typeof fetch=async url=>String(url).includes('lookaside.fbsbx.com')?new Response(bytes,{status:200}):new Response(JSON.stringify({url:'https://lookaside.fbsbx.com/audio',mime_type:'audio/wav',file_size:bytes.length}),{status:200});
 const channel=new WhatsAppChannel(pool,{...config,aiEnabled:true,mediaEnabled:true,paidEnabled:true,budgetMicrousd:5000000},transport,p);await channel.setup();
 for(let i=0;i<3;i++){
  const msg=incoming('repeat-audio-'+i,'',external,'audio');msg.entry[0].changes[0].value.messages![0].audio!.id='123456789001';
  await channel.receive(msg);assert.equal(await channel.processMediaNext(),true);await runTurn(channel,pool);
 }
 assert.equal(calls.value,2);assert.equal((await pool.query('SELECT reason FROM whatsapp_customer_guards')).rows[0].reason,'repeated_attachment');
 const fourth=incoming('owner-audio','',external,'audio');fourth.entry[0].changes[0].value.messages![0].audio!.id='123456789002';await channel.receive(fourth);
 assert.equal(await channel.processMediaNext(),true);assert.equal(await runTurn(channel,pool),false);assert.equal(calls.value,2);
 assert.equal((await pool.query('SELECT count(*) FROM voice_media')).rows[0].count,'4');
}));

test('a shopping clarification is never classified off-topic just because no item was added yet',()=>fixture(async pool=>{
 const calls={value:0},p=provider({operations:[],next:'assist',conversation:'unrelated',assistance:{rootQuery:'unlisted hardware',queries:['unlisted hardware'],question:'What size do you need?'}},calls);
 const channel=new WhatsAppChannel(pool,{...config,aiEnabled:true,paidEnabled:true,budgetMicrousd:5000000},offlineFetch,p);await channel.setup();
 await channel.receive(incoming('clarify-1','a partly described item'));await runTurn(channel,pool);
 await channel.receive(incoming('clarify-2','another unclear specification'));await runTurn(channel,pool);
 assert.equal((await pool.query('SELECT off_topic_count,reason FROM whatsapp_customer_guards')).rows[0].off_topic_count,0);
 assert.equal((await pool.query('SELECT operator_mode FROM conversations WHERE id IN (SELECT conversation_id FROM whatsapp_conversations)')).rows[0].operator_mode,'assistant');
}));

test('repeated silent recordings preserve original bytes without repeated failure replies or AI',()=>fixture(async pool=>{
 const {pcmWav}=await import('../apps/server/src/services/voice-media.js');const bytes=pcmWav(Buffer.alloc(32000));
 const calls={value:0},p=provider({operations:[],next:'continue'},calls);
 const transport:typeof fetch=async url=>String(url).includes('lookaside.fbsbx.com')?new Response(bytes):new Response(JSON.stringify({url:'https://lookaside.fbsbx.com/silence',mime_type:'audio/wav',file_size:bytes.length}));
 const channel=new WhatsAppChannel(pool,{...config,aiEnabled:true,mediaEnabled:true,paidEnabled:true,budgetMicrousd:5000000},transport,p);await channel.setup();
 for(let i=0;i<3;i++){
  const msg=incoming('silent-'+i,'',external,'audio');msg.entry[0].changes[0].value.messages![0].audio!.id='123456789003';
  await channel.receive(msg);await channel.processMediaNext();await runTurn(channel,pool);
 }
 assert.equal(calls.value,0);assert.equal((await pool.query('SELECT count(*) FROM whatsapp_media WHERE original_audio IS NOT NULL')).rows[0].count,'3');
 assert.equal((await pool.query('SELECT reason FROM whatsapp_customer_guards')).rows[0].reason,'repeated_attachment');
 assert.equal((await pool.query("SELECT count(*) FROM whatsapp_outbox WHERE state='queued'")).rows[0].count,'1');
}));
