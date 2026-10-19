import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {WhatsAppChannel,webhookSchema} from '../apps/server/src/services/whatsapp-channel.js';
import {whatsappSendError} from '../apps/server/src/services/whatsapp-send-error.js';
import type {WhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';

const cfg:WhatsAppConfig={hostname:'delivery.example.test',storeId:fixtureStore,appId:'123456789',wabaId:'987654321',phoneId:'123987654',appSecret:'offline-secret',verifyToken:'offline-verify',accessToken:'offline-token',graphVersion:'v25.0',recipients:['919000000001'],defaultReplyLanguage:'en',visualOrdering:true,processEnabled:true,sendEnabled:true};
function envelope(value:object){return webhookSchema.parse({object:'whatsapp_business_account',entry:[{id:cfg.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:cfg.phoneId},...value}}]}]});}
function incoming(id:string){return envelope({messages:[{id,from:cfg.recipients[0],timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'hello'}}]});}
async function fixture(run:(pool:pg.Pool)=>Promise<void>){
 assert.ok(process.env.DATABASE_URL,'An isolated test database is required');
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='wa_recovery_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');await run(pool);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}

test('send error diagnostics only permit retries for established pre-connection failures',()=>{
 for(const code of ['UND_ERR_CONNECT_TIMEOUT','ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH'])assert.deepEqual(whatsappSendError(new TypeError('fetch failed',{cause:{code,syscall:['ENOTFOUND','EAI_AGAIN'].includes(code)?'getaddrinfo':'connect'}})),{retryable:true,code:'network_connection_failed'});
 assert.equal(whatsappSendError(new TypeError('fetch failed',{cause:new AggregateError([{code:'ENETUNREACH',syscall:'connect'},{code:'ECONNREFUSED',syscall:'connect'}])})).retryable,true);
 assert.equal(whatsappSendError(new TypeError('fetch failed',{cause:new AggregateError([{code:'ENETUNREACH',syscall:'connect'},{code:'ECONNRESET'}])})).retryable,false);
 for(const syscall of [undefined,'write','read'])assert.equal(whatsappSendError(new TypeError('fetch failed',{cause:{code:'ENETUNREACH',syscall}})).retryable,false,'a code alone does not prove that failure preceded dispatch');
 for(const error of [new Error('synthetic secret which must never be stored'),null,{},new AggregateError([])])assert.deepEqual(whatsappSendError(error),{retryable:false,code:'network_outcome_unknown_transport'});
 assert.deepEqual(whatsappSendError(new DOMException('deadline','TimeoutError')),{retryable:false,code:'network_outcome_unknown_timeout'});
 assert.deepEqual(whatsappSendError(new TypeError('fetch failed',{cause:{code:'ECONNRESET'}})),{retryable:false,code:'network_outcome_unknown_connection_reset'});
});

test('an obsolete multipart review cannot strand a fresh customer turn or replay its uncertain first page',()=>fixture(async pool=>{
 const sent:any[]=[];
 const channel=new WhatsAppChannel(pool,cfg,async(_url,init)=>{sent.push(JSON.parse(String(init!.body)));return new Response(JSON.stringify({messages:[{id:'wamid.recovered.'+sent.length}]}),{status:200});});await channel.setup();
 await channel.receive(incoming('old.turn'));
 const old=(await pool.query('SELECT id,conversation_id FROM messages WHERE direction=\'inbound\'')).rows[0];
 await pool.query("UPDATE messages SET status='processed' WHERE id=$1",[old.id]);
 const group=randomUUID(),pages=[group,randomUUID(),randomUUID()];
 for(const [index,id] of pages.entries()){
  const state=index===0?'unknown':'queued';
  await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,response_to,reply_group_id,part_index,part_count) VALUES($1,$2,'outbound',$3,$4,$5,$6,$7,3)",[id,old.conversation_id,'obsolete page '+index,state,old.id,group,index]);
  await pool.query("INSERT INTO whatsapp_outbox(message_id,conversation_id,state,attempts,operator_revision,last_error) VALUES($1,$2,$3,$4,0,$5)",[id,old.conversation_id,state,index===0?1:0,index===0?'network_outcome_unknown':null]);
 }
 await pool.query('INSERT INTO whatsapp_actions(id,message_id,conversation_id,event,label,source_version,operator_revision,binding_id) VALUES($1,$2,$3,$4::jsonb,\'Old approval\',-1,0,$5)',[randomUUID(),pages[2],old.conversation_id,JSON.stringify({id:randomUUID(),type:'shopping_action',action:'new_list',expectedVersion:0}),randomUUID()]);
 await channel.receive(incoming('fresh.turn'));assert.equal(await channel.processNext(),true);
 const states=await pool.query('SELECT state,last_error,attempts FROM whatsapp_outbox WHERE message_id=ANY($1::uuid[]) ORDER BY message_id',[pages]);
 assert.equal(states.rows.filter(row=>row.state==='unknown'&&row.last_error==='network_outcome_unknown'&&row.attempts===1).length,1);
 assert.equal(states.rows.filter(row=>row.state==='cancelled'&&row.last_error==='review_superseded'&&row.attempts===0).length,2,'all unsent pages, including the text-only page, are cancelled');
 assert.equal(await channel.sendNext(),true);assert.equal(sent.length,1);assert.ok(!JSON.stringify(sent).includes('obsolete page'));
 assert.equal(await channel.sendNext(),false,'the ambiguous page is never retried');
 await channel.receive(envelope({statuses:[{id:'wamid.late.original',recipient_id:cfg.recipients[0],timestamp:String(Math.floor(Date.now()/1000)),status:'delivered',biz_opaque_callback_data:pages[0]}]}));
 assert.equal((await pool.query('SELECT state FROM whatsapp_outbox WHERE message_id=$1',[pages[0]])).rows[0].state,'delivered');
 assert.equal(sent.length,1,'late receipt reconciles the original without another send');
}));

for(const scenario of ['active_review','same_customer_turn','same_reply_group','other_cancellation'] as const)test(`${scenario} still holds later replies behind an uncertain send`,()=>fixture(async pool=>{
 let sends=0;const channel=new WhatsAppChannel(pool,cfg,async()=>{sends++;return new Response(JSON.stringify({messages:[{id:'unexpected'}]}),{status:200});});await channel.setup();
 await channel.receive(incoming('old.turn'));await channel.processNext();
 const old=(await pool.query("SELECT m.id,m.response_to,m.conversation_id,m.reply_group_id FROM messages m JOIN whatsapp_outbox o ON o.message_id=m.id ORDER BY m.sequence LIMIT 1")).rows[0];
 await pool.query("UPDATE whatsapp_outbox SET state='unknown',attempts=1 WHERE message_id=$1",[old.id]);
 const cancelledId=randomUUID();
 await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,response_to,reply_group_id,part_index,part_count) VALUES($1,$2,'outbound','cancelled button','cancelled',$3,$4,1,2)",[cancelledId,old.conversation_id,old.response_to,old.reply_group_id]);
 await pool.query("INSERT INTO whatsapp_outbox(message_id,conversation_id,state,operator_revision,last_error) VALUES($1,$2,'cancelled',0,$3)",[cancelledId,old.conversation_id,scenario==='active_review'?'owner_control_changed':scenario==='other_cancellation'?'some_other_reason':'review_superseded']);
 await channel.receive(incoming('fresh.turn'));await channel.processNext();
 const latest=(await pool.query("SELECT m.id FROM messages m JOIN whatsapp_outbox o ON o.message_id=m.id WHERE o.state='queued' ORDER BY m.sequence DESC LIMIT 1")).rows[0];
 if(scenario==='same_customer_turn')await pool.query('UPDATE messages SET response_to=$1,part_index=2,part_count=3 WHERE id=$2',[old.response_to,latest.id]);
 if(scenario==='same_reply_group')await pool.query('UPDATE messages SET reply_group_id=$1,part_index=2,part_count=3 WHERE id=$2',[old.reply_group_id,latest.id]);
 assert.equal(await channel.sendNext(),false);assert.equal(sends,0);
}));

test('pre-connection retries are delayed and capped; resets and deadlines remain unknown without retries',()=>fixture(async pool=>{
 let sends=0,error:unknown=new TypeError('fetch failed',{cause:{code:'EAI_AGAIN',syscall:'getaddrinfo'}});
 const channel=new WhatsAppChannel(pool,cfg,async()=>{sends++;throw error;});await channel.setup();await channel.receive(incoming('retry.turn'));await channel.processNext();
 for(let attempt=1;attempt<=3;attempt++){
  assert.equal(await channel.sendNext(),true);
  const row=(await pool.query('SELECT state,attempts,last_error,next_attempt_at>now() delayed FROM whatsapp_outbox ORDER BY created_at DESC LIMIT 1')).rows[0];
  assert.equal(row.attempts,attempt);assert.equal(row.last_error,'network_connection_failed');assert.equal(row.state,attempt===3?'failed':'queued');
  if(attempt<3){assert.equal(row.delayed,true);assert.equal(await channel.sendNext(),false);await pool.query('UPDATE whatsapp_outbox SET next_attempt_at=now()');}
 }
 assert.equal(await channel.sendNext(),false);assert.equal(sends,3);
 for(const [kind,code] of [['TimeoutError','network_outcome_unknown_timeout'],['reset','network_outcome_unknown_connection_reset']] as const){
  error=kind==='TimeoutError'?new DOMException('deadline',kind):new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});
  await channel.receive(incoming('uncertain.'+kind));await channel.processNext();assert.equal(await channel.sendNext(),true);
  const row=(await pool.query('SELECT state,attempts,last_error FROM whatsapp_outbox ORDER BY created_at DESC LIMIT 1')).rows[0];assert.deepEqual(row,{state:'unknown',attempts:1,last_error:code});
  assert.equal(await channel.sendNext(),false);
  // Isolate the next failure case without changing the assertion under test.
  await pool.query("UPDATE conversations SET operator_revision=operator_revision+1");
 }
 assert.equal(sends,5);
}));

test('an incomplete successful HTTP response is ambiguous and does not disable the whole channel',()=>fixture(async pool=>{
 let sends=0;const channel=new WhatsAppChannel(pool,cfg,async()=>{sends++;return new Response('{truncated',{status:200});});await channel.setup();
 await channel.receive(incoming('incomplete.response'));await channel.processNext();assert.equal(await channel.sendNext(),true);
 assert.deepEqual((await pool.query('SELECT state,last_error,attempts FROM whatsapp_outbox')).rows[0],{state:'unknown',last_error:'meta_invalid_response',attempts:1});
 assert.equal((await pool.query('SELECT send_blocked FROM whatsapp_channels')).rows[0].send_blocked,false);
 assert.equal(await channel.sendNext(),false);assert.equal(sends,1);
}));
