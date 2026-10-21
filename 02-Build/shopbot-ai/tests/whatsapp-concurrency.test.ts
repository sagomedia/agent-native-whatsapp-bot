import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {WhatsAppChannel,webhookSchema} from '../apps/server/src/services/whatsapp-channel.js';
import {readWhatsAppConfig,validateWhatsAppWorkers,type WhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import {geminiTextRate,worstCaseReservation} from '../apps/server/src/services/inference-budget.js';
import {startWhatsAppJobs} from '../apps/server/src/jobs/whatsapp.js';

const pause=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release};}
async function until(check:()=>boolean|Promise<boolean>){const end=Date.now()+10000;while(!await check()){if(Date.now()>end)throw Error('Timed out waiting for worker evidence');await pause(10);}}
const recipients=Array.from({length:10},(_,i)=>String(919000000001+i));
const cfg:WhatsAppConfig={hostname:'runtime.example.test',storeId:fixtureStore,appId:'123456789',wabaId:'987654321',phoneId:'123987654',appSecret:'offline-test-secret',verifyToken:'offline-test-verify',accessToken:'offline-test-access-token',graphVersion:'v25.0',recipients,defaultReplyLanguage:'en',processEnabled:true,sendEnabled:false};
function input(id:string,from=recipients[0],text='hello'){
 return webhookSchema.parse({object:'whatsapp_business_account',entry:[{id:cfg.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:cfg.phoneId},messages:[{id,from,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:text}}]}}]}]});
}
async function fixture(run:(pool:pg.Pool)=>Promise<void>){
 if(!process.env.DATABASE_URL)throw Error('An explicit isolated DATABASE_URL is required');
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='wa_workers_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`,max:10});
 try{await setupDatabase(pool,'mock');await run(pool);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}

test('worker configuration defaults to one per stage and rejects unsafe bounds',()=>{
 assert.deepEqual(validateWhatsAppWorkers({planning:1,media:1,outbound:1}),{planning:1,media:1,outbound:1});
 for(const workers of [{planning:0,media:1,outbound:1},{planning:11,media:1,outbound:1},{planning:2.5,media:1,outbound:1},{planning:1,media:3,outbound:1},{planning:1,media:1,outbound:NaN}])assert.throws(()=>validateWhatsAppWorkers(workers),/workers/);
 const env={WHATSAPP_ENABLED:'true',WHATSAPP_HOSTNAME:cfg.hostname,WHATSAPP_STORE_ID:cfg.storeId,WHATSAPP_APP_ID:cfg.appId,WHATSAPP_WABA_ID:cfg.wabaId,WHATSAPP_PHONE_ID:cfg.phoneId,WHATSAPP_APP_SECRET:'x'.repeat(20),WHATSAPP_VERIFY_TOKEN:'x'.repeat(20),WHATSAPP_ACCESS_TOKEN:'x'.repeat(40),WHATSAPP_TEST_RECIPIENTS:recipients[0]};
 assert.deepEqual(readWhatsAppConfig(env)!.workers,{planning:1,media:1,outbound:1});
 assert.deepEqual(readWhatsAppConfig({...env,WHATSAPP_PLANNING_WORKERS:'10',WHATSAPP_MEDIA_WORKERS:'2',WHATSAPP_OUTBOUND_WORKERS:'2'})!.workers,{planning:10,media:2,outbound:2});
 assert.throws(()=>readWhatsAppConfig({...env,WHATSAPP_PLANNING_WORKERS:'100'}),/planning workers/);
});

for(const count of [1,5,10])test(`${count} independent conversations progress concurrently within configured planning bound`,()=>fixture(async pool=>{
 const config={...cfg,workers:{planning:count,media:1,outbound:1}},channel=new WhatsAppChannel(pool,config);
 await channel.setup();for(let i=0;i<count;i++)await channel.receive(input('wamid.load.'+i,recipients[i],'find an item for customer '+i));
 let active=0,maxActive=0,entered=0;const hold=gate(),calls:string[]=[];
 const provider:Interpreter={name:'offline-concurrent-provider',mode:'mock',interpret:async i=>{active++;maxActive=Math.max(maxActive,active);entered++;calls.push(i.text);try{await hold.promise;return {output:{next:'continue',operations:[]},usage:null,truncated:false};}finally{active--;}}};
 const runtime=new ConversationRuntime(pool,provider);channel.runtime.processNext=runtime.processNext.bind(runtime);
 const errors:unknown[]=[];const stop=await startWhatsAppJobs(channel,e=>errors.push(e),{pollIntervalMs:10});
 try{await until(()=>entered===count);assert.equal(maxActive,count);assert.ok(maxActive<=config.workers.planning);hold.release();await until(async()=>Number((await pool.query("SELECT count(*) FROM messages WHERE direction='inbound' AND status='processed'")).rows[0].count)===count);}
 finally{hold.release();await stop();}
 assert.deepEqual(errors,[]);assert.equal(new Set(calls).size,count);assert.equal(calls.length,count);assert.equal((await pool.query('SELECT count(DISTINCT actor) FROM conversations WHERE id IN (SELECT conversation_id FROM whatsapp_conversations)')).rows[0].count,String(count));
}));

test('a slow chat retains same-chat order while another chat and reconciliation advance',()=>fixture(async pool=>{
 const config={...cfg,workers:{planning:5,media:1,outbound:1}},channel=new WhatsAppChannel(pool,config);await channel.setup();
 await channel.receive(input('wamid.slow.1',recipients[0],'slow first request'));await channel.receive(input('wamid.slow.2',recipients[0],'second request'));await channel.receive(input('wamid.fast',recipients[1],'independent request'));
 const hold=gate(),started:string[]=[];let reconciles=0;const reconcile=channel.reconcile.bind(channel);channel.reconcile=async()=>{reconciles++;await reconcile();};
 const provider:Interpreter={name:'offline-order-provider',mode:'mock',interpret:async i=>{started.push(i.text);if(i.text==='slow first request')await hold.promise;return {output:{next:'continue',operations:[]},usage:null,truncated:false};}};
 const runtime=new ConversationRuntime(pool,provider);channel.runtime.processNext=runtime.processNext.bind(runtime);
 const errors:unknown[]=[];const stop=await startWhatsAppJobs(channel,e=>errors.push(e),{pollIntervalMs:10});
 try{await until(()=>started.includes('slow first request')&&started.includes('independent request'));await until(()=>reconciles>=2);assert.ok(!started.includes('second request'));
  const competing=new WhatsAppChannel(pool,config);assert.equal(await competing.processNext({skipMedia:true}),false,'a second process respects the durable conversation lease');
  hold.release();await until(()=>started.includes('second request'));
 }finally{hold.release();await stop();}
 assert.deepEqual(errors,[]);assert.deepEqual(started.filter(t=>t!=='independent request'),['slow first request','second request']);
}));

test('waiting media and retry delays at the head of a chat do not starve independent work',()=>fixture(async pool=>{
 const channel=new WhatsAppChannel(pool,cfg);await channel.setup();
 await channel.receive(input('wamid.media.head'));await channel.receive(input('wamid.media.tail'));await channel.receive(input('wamid.ready',recipients[1]));
 const head=(await pool.query("SELECT m.id FROM messages m JOIN whatsapp_inbound i ON i.message_id=m.id WHERE i.provider_id='wamid.media.head'")).rows[0].id;
 await pool.query("INSERT INTO whatsapp_media(message_id,media_id,kind,source_version) VALUES($1,'offline','voice',0)",[head]);
 assert.equal(await channel.processNext({skipMedia:true}),true);assert.equal(await channel.processNext({skipMedia:true}),false);
 assert.equal((await pool.query('SELECT status FROM messages WHERE id=$1',[head])).rows[0].status,'pending');
 await pool.query("UPDATE whatsapp_media SET state='ready' WHERE message_id=$1",[head]);await pool.query("UPDATE messages SET not_before=now()+interval '1 hour' WHERE id=$1",[head]);
 assert.equal(await channel.processNext({skipMedia:true}),false);await pool.query('UPDATE messages SET not_before=NULL WHERE id=$1',[head]);
 assert.equal(await channel.processNext({skipMedia:true}),true);assert.equal(await channel.processNext({skipMedia:true}),true);
}));

test('restart honors active leases, recovers expired work and deduplicates repeated webhooks/replies',()=>fixture(async pool=>{
 const channel=new WhatsAppChannel(pool,cfg);await channel.setup();await channel.receive(input('wamid.restart'));assert.equal((await channel.receive(input('wamid.restart'))).accepted,0);await channel.receive(input('wamid.other',recipients[1]));
 const head=(await pool.query("SELECT message_id FROM whatsapp_inbound WHERE provider_id='wamid.restart'")).rows[0].message_id;
 await pool.query("UPDATE messages SET status='processing',claim_token=$2,lease_until=now()+interval '1 hour' WHERE id=$1",[head,randomUUID()]);
 const restarted=new WhatsAppChannel(pool,cfg);assert.equal(await restarted.processNext({skipMedia:true}),true);assert.equal(await restarted.processNext({skipMedia:true}),false);
 await pool.query("UPDATE messages SET lease_until=now()-interval '1 second' WHERE id=$1",[head]);
 assert.equal(await restarted.processNext({skipMedia:true}),true);assert.equal(await restarted.processNext({skipMedia:true}),false);
 assert.equal((await restarted.receive(input('wamid.restart'))).accepted,0);assert.equal((await pool.query('SELECT count(*) FROM messages WHERE response_to=$1',[head])).rows[0].count,'1');assert.equal((await pool.query('SELECT count(*) FROM whatsapp_outbox o JOIN messages m ON m.id=o.message_id WHERE m.response_to=$1',[head])).rows[0].count,'1');
}));

test('independent media, outbound and reconciliation slots remain bounded and shutdown drains tasks',async()=>{
 const media=gate(),plan=gate();let plans=0,medias=0,sends=0,reconciles=0;const errors:unknown[]=[];
 const fake={config:{workers:{planning:5,media:2,outbound:2}},processNext:async(options:{skipMedia?:boolean})=>{assert.equal(options.skipMedia,true);plans++;await plan.promise;},processMediaNext:async()=>{medias++;await media.promise;},sendNext:async()=>{sends++;},reconcile:async()=>{reconciles++;}};
 const stop=await startWhatsAppJobs(fake as unknown as WhatsAppChannel,e=>errors.push(e),{pollIntervalMs:10});
 await until(()=>plans===5&&medias===2&&sends>=4&&reconciles>=2);assert.equal(plans,5);assert.equal(medias,2);
 let stopped=false;const stopping=stop().then(()=>{stopped=true;});await pause(30);assert.equal(stopped,false);const oldSends=sends;plan.release();media.release();await stopping;await pause(30);assert.equal(sends,oldSends);assert.deepEqual(errors,[]);
});


test('concurrent outbound sends preserve per-chat order and ambiguous attempts wait for reconciliation',()=>fixture(async pool=>{
 const hold=gate(),sent:string[]=[],config={...cfg,sendEnabled:true};
 const channel=new WhatsAppChannel(pool,config,async(_url,init)=>{
  const body=JSON.parse(String(init!.body));sent.push(body.to);const attempt=sent.length;
  if(attempt===1)await hold.promise;
  return new Response(JSON.stringify({messages:[{id:'wamid.sent.'+attempt}]}),{status:200});
 });
 await channel.setup();await channel.receive(input('wamid.order.1'));await channel.processNext({skipMedia:true});
 await channel.receive(input('wamid.order.2'));await channel.processNext({skipMedia:true});
 await channel.receive(input('wamid.order.other',recipients[1]));await channel.processNext({skipMedia:true});
 const first=channel.sendNext();
 try{await until(()=>sent.length===1);assert.equal(await channel.sendNext(),true);assert.deepEqual(sent,[recipients[0],recipients[1]]);assert.equal(await channel.sendNext(),false,'same-chat second send cannot overtake an in-flight send');}
 finally{hold.release();await first;}
 assert.equal(await channel.sendNext(),true);assert.deepEqual(sent,[recipients[0],recipients[1],recipients[0]]);
 // Unknown delivery outcomes are never automatically resent or overtaken.
 await channel.receive(input('wamid.ambiguous.1'));await channel.processNext({skipMedia:true});await channel.receive(input('wamid.ambiguous.2'));await channel.processNext({skipMedia:true});
 const queued=(await pool.query("SELECT o.message_id FROM whatsapp_outbox o JOIN messages m ON m.id=o.message_id WHERE o.state='queued' ORDER BY m.sequence")).rows;
 await pool.query("UPDATE whatsapp_outbox SET state='unknown' WHERE message_id=$1",[queued[0].message_id]);assert.equal(await channel.sendNext(),false);
 const status=webhookSchema.parse({object:'whatsapp_business_account',entry:[{id:cfg.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:cfg.phoneId},statuses:[{id:'wamid.reconciled',recipient_id:recipients[0],timestamp:String(Math.floor(Date.now()/1000)),status:'delivered',biz_opaque_callback_data:queued[0].message_id}]}}]}]});
 await channel.receive(status);assert.equal(await channel.sendNext(),true);assert.equal(sent.length,4);
}));


for(const billing of ['free','paid'] as const)test(`five workers preserve shared ${billing} admission without increasing limits`,()=>fixture(async pool=>{
 const hold=gate();let calls=0;const reservation=worstCaseReservation(geminiTextRate);
 const provider:Interpreter={name:'offline-admission-'+billing,mode:'live',billing:geminiTextRate,...(billing==='free'?{freeQuota:{scope:'isolated-'+randomUUID(),model:geminiTextRate.model}}:{}),interpret:async()=>{calls++;await hold.promise;return {output:{next:'continue',operations:[]},truncated:false,usage:null};}};
 const config={...cfg,aiEnabled:true,paidEnabled:billing==='paid',budgetMicrousd:billing==='paid'?reservation:undefined,workers:{planning:5,media:1,outbound:1}};
 const channel=new WhatsAppChannel(pool,config,async()=>{throw Error('No external HTTP requests are permitted by this test');},provider);await channel.setup();
 for(let i=0;i<5;i++)await channel.receive(input('wamid.admission.'+i,recipients[i],'find an item for customer '+i));
 const errors:unknown[]=[];const stop=await startWhatsAppJobs(channel,e=>errors.push(e),{pollIntervalMs:10});
 try{await until(async()=>calls===1&&Number((await pool.query("SELECT count(*) FROM messages WHERE direction='inbound' AND status='processed'")).rows[0].count)===4);assert.equal((await pool.query('SELECT count(*) FROM provider_attempts')).rows[0].count,'1');hold.release();await until(async()=>Number((await pool.query("SELECT count(*) FROM messages WHERE direction='inbound' AND status='processed'")).rows[0].count)===5);}
 finally{hold.release();await stop();}
 assert.equal(calls,1);assert.deepEqual(errors,[]);
 if(billing==='paid'){const budget=(await pool.query('SELECT * FROM inference_budgets WHERE store_id=$1',[fixtureStore])).rows[0];assert.equal(Number(budget.limit_microusd),reservation);assert.ok(Number(budget.committed_microusd)+Number(budget.held_microusd)<=reservation);}
}));
