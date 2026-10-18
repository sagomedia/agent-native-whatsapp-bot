import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import pg from 'pg';
import {readConfig} from '../apps/server/src/config.js';
import {createAccessVerifier} from '../apps/server/src/http/access.js';
import {createApp} from '../apps/server/src/http/app.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore,fixtureConversation} from '../profiles/hardware.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {pcmWav} from '../apps/server/src/services/voice-media.js';

const owner={hostname:'shopbot-preview.example.test',issuer:'https://shopbot-test.cloudflareaccess.com',audience:'test_application_audience_123',email:'owner@example.test',storeId:fixtureStore};
const pair=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...pair.publicKey.export({format:'jwk'}),kid:'owner-test-key',alg:'RS256',use:'sig'};
function jwt(changes:Record<string,unknown>={},headerChanges:Record<string,unknown>={}){
 const now=Math.floor(Date.now()/1000),encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const content=encode({alg:'RS256',kid:jwk.kid,...headerChanges})+'.'+encode({iss:owner.issuer,aud:[owner.audience],email:owner.email,sub:'owner',iat:now,exp:now+600,...changes});
 return content+'.'+sign('RSA-SHA256',Buffer.from(content),pair.privateKey).toString('base64url');
}

test('owner history binds audio to its conversation and labels missing recordings without broken playback URLs',async()=>{
 const schema='owner_media_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA "${schema}"`);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{
  await setupDatabase(pool,'mock');const present=randomUUID(),missing=randomUUID(),foreign=randomUUID();
  await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'other-audio')",[foreign,fixtureStore]);
  for(const [id,conversation] of [[present,fixtureConversation],[missing,fixtureConversation],[randomUUID(),foreign]])await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload) VALUES($1,$2,'inbound','Saved voice','processed',$3)",[id,conversation,JSON.stringify({id,type:'voice',mediaId:present===id?id:conversation===foreign?present:id})]);
  await pool.query("INSERT INTO voice_media(id,store_id,conversation_id,actor,source_hash,audio,duration_seconds) VALUES($1,$2,$3,'local-simulator','test',$4,1)",[present,fixtureStore,fixtureConversation,pcmWav(Buffer.alloc(32000))]);
  app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/owner-media-test',owner},pool,undefined,undefined,createAccessVerifier(owner,async()=>[jwk]));
  const headers={host:owner.hostname,'cf-access-jwt-assertion':jwt()};
  const messages=(await app.inject({url:'/api/owner/conversations/'+fixtureConversation,headers})).json().messages;
  assert.equal(messages.find((m:any)=>m.id===present).media_available,true);assert.equal(messages.find((m:any)=>m.id===missing).media_available,false);assert.ok(messages.every((m:any)=>m.conversation_id===fixtureConversation));
  assert.equal((await app.inject({url:`/api/owner/conversations/${fixtureConversation}/media/voice/${present}`,headers})).statusCode,200);
  const other=(await app.inject({url:'/api/owner/conversations/'+foreign,headers})).json();assert.equal(other.messages[0].media_available,false);
  assert.equal((await app.inject({url:`/api/owner/conversations/${foreign}/media/voice/${present}`,headers})).statusCode,404);
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
test('Access validates signatures, exact merchant owner, issuer, audience, expiry and algorithm',async()=>{
 const verify=createAccessVerifier(owner,async()=>[jwk]);
 assert.equal((await verify(jwt())).email,owner.email);
 for(const changes of [{email:'other@example.test'},{iss:'https://other.cloudflareaccess.com'},{aud:['other_application']},{exp:0},{iat:Date.now()},{nbf:Date.now()}])await assert.rejects(verify(jwt(changes)));
 await assert.rejects(verify(jwt({}, {alg:'none'})));
 await assert.rejects(verify(jwt({}, {kid:'unknown'})));
 const forged=jwt().split('.');forged[1]=Buffer.from(JSON.stringify({email:owner.email})).toString('base64url');await assert.rejects(verify(forged.join('.')));
 await assert.rejects(verify('bad-token'));
 assert.throws(()=>readConfig({DATABASE_URL:'postgres://unused',OWNER_EMAIL:owner.email}),/Complete owner/);
});
test('owner snapshot retains the recent inbox and store-scoped metadata for an older deep-linked conversation',async()=>{
 const schema='owner_deeplink_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA "${schema}"`);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{
  await setupDatabase(pool,'mock');const older=randomUUID(),foreign=randomUUID(),otherStore=randomUUID(),recent=Array.from({length:100},()=>randomUUID());
  await pool.query("INSERT INTO conversations(id,store_id,actor,operator_mode,operator_revision,reply_language) VALUES($1,$2,'older-shopper','owner',7,'ta')",[older,fixtureStore]);
  await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,created_at) VALUES($1,$2,'inbound','Earlier request needs review','pending','2020-01-01')",[randomUUID(),older]);
  await pool.query("INSERT INTO conversations(id,store_id,actor) SELECT id,$1,'recent-'||id FROM unnest($2::uuid[]) AS id",[fixtureStore,recent]);
  await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status) SELECT gen_random_uuid(),id,'inbound','Recent message','processed' FROM unnest($1::uuid[]) AS id",[recent]);
  await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other shop','true')",[otherStore]);await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'private-other-shop')",[foreign,otherStore]);
  app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/owner-deeplink-test',owner},pool,undefined,undefined,createAccessVerifier(owner,async()=>[jwk]));
  const headers={host:owner.hostname,'cf-access-jwt-assertion':jwt()},snapshot=async(id?:string)=>app!.inject({url:'/api/owner/snapshot'+(id?'?conversation='+id:''),headers});
  const before=(await snapshot()).json();assert.equal(before.conversations.length,100);assert.ok(!before.conversations.some((c:any)=>c.id===older));
  const selectedResponse=await snapshot(older);assert.equal(selectedResponse.statusCode,200);const selected=selectedResponse.json();
  assert.deepEqual(selected.conversations.slice(0,100),before.conversations);assert.equal(selected.conversations.length,101);
  const metadata=selected.conversations.find((c:any)=>c.id===older);assert.equal(metadata.operator_mode,'owner');assert.equal(metadata.operator_revision,7);assert.equal(metadata.reply_language,'ta');assert.equal(metadata.last_text,'Earlier request needs review');assert.equal(metadata.pending,1);
  assert.equal((await snapshot(recent[0])).json().conversations.length,100);
  assert.deepEqual((await snapshot(foreign)).json().conversations,before.conversations);
  assert.equal((await snapshot('invalid-id')).statusCode,400);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM owner_audit')).rows[0].n,0);
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
test('owner isolation, CSRF, takeover, stale controls, pause and request decisions are durable and audited',async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='owner_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{
  await setupDatabase(pool,'mock');const otherStore=randomUUID(),otherConversation=randomUUID();
  await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other merchant','true')",[otherStore]);await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'other')",[otherConversation,otherStore]);
  await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status) VALUES($1,$2,'inbound','private other shop message','processed')",[randomUUID(),otherConversation]);
  const config={mode:'mock' as const,databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/owner-test',owner};
  await assert.rejects(createApp({...config,host:'0.0.0.0'},pool),/loopback/);
  await assert.rejects(createApp({...config,mode:'live'},pool),/mock mode/);
  app=await createApp(config,pool,undefined,undefined,createAccessVerifier(owner,async()=>[jwk]));
  const headers={host:owner.hostname,'cf-access-jwt-assertion':jwt(),origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json'};
  const post=(path:string,payload:unknown,h=headers)=>app!.inject({method:'POST',url:'/api/owner/'+path,headers:h,payload:JSON.stringify(payload)});
  assert.equal((await app.inject({url:'/api/owner/snapshot',headers:{host:owner.hostname}})).statusCode,403);
  assert.equal((await app.inject({url:'/api/owner/snapshot',headers:{...headers,'cf-access-jwt-assertion':jwt({email:'other@example.test'})}})).statusCode,403);
  assert.equal((await app.inject({url:'/api/simulator',headers})).statusCode,404);
  assert.equal((await app.inject({url:'/api/owner/snapshot',headers:{...headers,host:'wrong.example.test'}})).statusCode,404);
  const snapshot=(await app.inject({url:'/api/owner/snapshot',headers})).json();assert.equal(snapshot.conversations.length,1);assert.equal(snapshot.channel.liveSending,false);assert.equal(snapshot.store.id,fixtureStore);
  assert.equal((await app.inject({url:'/api/owner/conversations/'+otherConversation,headers})).statusCode,404);
  assert.equal((await post('conversations/'+otherConversation+'/control',{mode:'owner',revision:0})).statusCode,409);
  assert.equal((await post('pause',{paused:true,revision:0},{...headers,origin:'https://foreign.test'})).statusCode,403);
  const inbox=new SimulatorService(pool);await inbox.ingest({id:randomUUID(),type:'text',text:'hello'});
  assert.equal((await post('conversations/'+fixtureConversation+'/control',{mode:'owner',revision:0})).statusCode,200);assert.equal(await inbox.processNext(),false);
  assert.equal((await post('conversations/'+fixtureConversation+'/control',{mode:'assistant',revision:0})).statusCode,409);
  assert.equal((await post('conversations/'+fixtureConversation+'/control',{mode:'assistant',revision:1})).statusCode,200);
  assert.equal((await post('pause',{paused:true,revision:0})).statusCode,200);assert.equal(await inbox.processNext(),false);
  assert.equal((await post('pause',{paused:false,revision:1})).statusCode,200);assert.equal(await inbox.processNext(),true);
  // Taking over while interpretation is outside its transaction must invalidate
  // its lease, including when the owner later returns the thread to the bot.
  let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),begin=new Promise<void>(resolve=>{started=resolve;});
  const delayed=new SimulatorService(pool,undefined,{name:'owner-race',mode:'mock',interpret:async()=>{started();await gate;return {output:{operations:[],next:'continue'},truncated:false,usage:null};}});
  const delayedId=randomUUID(),outboundBefore=(await inbox.snapshot()).messages.filter(m=>m.direction==='outbound').length;
  await delayed.ingest({id:delayedId,type:'text',text:'an unusual shopping description for the interpreter'});
  const running=delayed.processNext();await begin;
  assert.equal((await post('conversations/'+fixtureConversation+'/control',{mode:'owner',revision:2})).statusCode,200);
  assert.equal((await post('conversations/'+fixtureConversation+'/control',{mode:'assistant',revision:3})).statusCode,200);
  release();await running;
  assert.equal((await inbox.snapshot()).messages.filter(m=>m.direction==='outbound').length,outboundBefore);
  assert.equal((await pool.query('SELECT status FROM messages WHERE id=$1',[delayedId])).rows[0].status,'pending');
  const requestId=randomUUID();await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise) VALUES($1,$2,$3,'local-simulator',$4,'[]',0)",[requestId,fixtureStore,fixtureConversation,randomUUID()]);
  assert.equal((await post('requests/'+requestId+'/decision',{decision:'accepted'})).statusCode,200);
  assert.equal((await post('requests/'+requestId+'/decision',{decision:'rejected'})).statusCode,409);
  assert.equal((await pool.query('SELECT acceptance FROM order_requests WHERE id=$1',[requestId])).rows[0].acceptance,'accepted');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM owner_audit WHERE store_id=$1',[fixtureStore])).rows[0].n,7);
  const recreated=await createApp(config,pool,undefined,undefined,createAccessVerifier(owner,async()=>[jwk]));try{assert.equal((await recreated.inject({url:'/api/owner/snapshot',headers})).json().audit.length,7);}finally{await recreated.close();}
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
