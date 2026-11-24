import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {createApp} from '../apps/server/src/http/app.js';
import {WhatsAppChannel} from '../apps/server/src/services/whatsapp-channel.js';
import type {WhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';
import {customerLabel} from '../apps/dashboard/src/owner-model.js';
const cfg:WhatsAppConfig={hostname:'api.example.test',storeId:fixtureStore,appId:'123456789',wabaId:'987654321',phoneId:'123987654',appSecret:'synthetic-secret',verifyToken:'synthetic-verification-token',accessToken:'synthetic-token',graphVersion:'v25.0',recipients:['919000000001','919000000002'],processEnabled:false,sendEnabled:false};
const owner={hostname:'owner.example.test',issuer:'https://offline.example.test',audience:'offline',email:'owner@example.test',storeId:fixtureStore};
async function fixture(run:(pool:pg.Pool,app:Awaited<ReturnType<typeof createApp>>)=>Promise<void>){
 const schema='identity_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{await setupDatabase(pool,'mock');app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,host:'127.0.0.1',port:3017,mediaDir:'/tmp/synthetic-identity',owner,whatsapp:cfg},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline'}));await run(pool,app);}
 finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
const headers={host:owner.hostname,'cf-access-jwt-assertion':'offline'};
test('verified ingress matches profiles to each sender, retains missing names and rejects stale/duplicate profile changes',()=>fixture(async(pool,app)=>{
 const now=Math.floor(Date.now()/1000);
 async function receive(id:string,seconds:number,contacts?:unknown[],from=cfg.recipients[0],valid=true){
  const payload=JSON.stringify({object:'whatsapp_business_account',entry:[{id:cfg.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:cfg.phoneId},contacts,messages:[{id,from,timestamp:String(seconds),type:'text',text:{body:'hello'}}]}}]}]});
  const signature='sha256='+createHmac('sha256',cfg.appSecret).update(payload).digest('hex');
  const response=await app.inject({method:'POST',url:'/webhooks/whatsapp',headers:{host:cfg.hostname,'content-type':'application/json','x-hub-signature-256':valid?signature:'sha256=invalid'},payload});assert.equal(response.statusCode,valid?200:403,response.body);
 }
 const profile=(name:unknown,wa_id=cfg.recipients[0])=>({wa_id,profile:{name}});
 const row=async(from=cfg.recipients[0])=>(await pool.query('SELECT * FROM whatsapp_conversations WHERE recipient=$1',[from])).rows[0];
 await receive('one',now-20,[profile('Wrong sender',cfg.recipients[1]),profile('  கோகுல்\n Kumar\u202e  ')]);
 assert.equal((await row()).profile_name,'கோகுல் Kumar');
 await receive('two',now-10,[profile('Other customer',cfg.recipients[1])],cfg.recipients[1]);assert.equal((await row(cfg.recipients[1])).profile_name,'Other customer');
 await receive('new',now-5,[profile('New name')]);await receive('older',now-15,[profile('Outdated')]);await receive('new',now,[profile('Duplicate')]);
 for(const [i,contacts] of [undefined,[profile('   ')],[profile(42)],[{wa_id:'invalid',profile:{name:'bad'}}],[profile('x'.repeat(513))],[profile('Other only',cfg.recipients[1])]].entries())await receive('missing-'+i,now,contacts);
 assert.equal((await row()).profile_name,'New name');
 await receive('unsigned',now,[profile('Unverified')],cfg.recipients[0],false);assert.equal((await row()).profile_name,'New name');
 await receive('unknown',now,[profile('Not approved','919000000003')],'919000000003');assert.equal(await row('919000000003'),undefined);
 const snapshot=(await app.inject({url:'/api/owner/snapshot?details=0',headers})).json();
 const identity=snapshot.conversations.find((c:any)=>c.customer_phone===cfg.recipients[0]);assert.equal(identity.customer_name,'New name');assert.equal(customerLabel(identity.actor,identity.id,identity),'New name · +919000000001');
 assert.equal((await app.inject({url:'/api/owner/snapshot'})).statusCode,403);
 await receive('bounded',now,[profile('😀'.repeat(220))]);assert.equal(Array.from((await row()).profile_name).length,200);
}));

test('migration keeps historical phones and orders; owner name/phone searches cross inbox pages and retain order identity without an inbox row',()=>fixture(async(pool,app)=>{
 const channel=new WhatsAppChannel(pool,cfg);await channel.setup();const old=randomUUID(),order=randomUUID();
 await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'whatsapp:historical')",[old,fixtureStore]);
 await pool.query('INSERT INTO whatsapp_conversations(conversation_id,phone_id,recipient,last_inbound_at) VALUES($1,$2,$3,now())',[old,cfg.phoneId,cfg.recipients[0]]);
 await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise) VALUES($1,$2,$3,'whatsapp:historical',$4,$5,100)",[order,fixtureStore,old,randomUUID(),JSON.stringify([{id:randomUUID(),name:'Pipe',quantity:1,unit:'piece',resolution:'unavailable'}])]);
 // Rehearse the additive migration over populated version 40, then run it again.
 await pool.query('ALTER TABLE whatsapp_conversations DROP COLUMN profile_name,DROP COLUMN profile_updated_at');await pool.query('DELETE FROM schema_migrations WHERE version=42');await setupDatabase(pool,'mock');await setupDatabase(pool,'mock');
 const read=async(query:string)=>{const r=await app.inject({url:'/api/owner/snapshot?details=0&'+query,headers});assert.equal(r.statusCode,200,r.body);return r.json();};
 const historical=(await read('order='+order)).requests.find((r:any)=>r.id===order);assert.equal(historical.customer_name,null);assert.equal(customerLabel(historical.actor,old,historical),'+919000000001');
 await pool.query('UPDATE whatsapp_conversations SET profile_name=$1 WHERE conversation_id=$2',['கோகுல் 50%_shop',old]);
 await pool.query("INSERT INTO conversations(id,store_id,actor) SELECT gen_random_uuid(),$1,'recent-'||i FROM generate_series(1,105) i",[fixtureStore]);
 await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status) SELECT gen_random_uuid(),id,'inbound','Recent','processed' FROM conversations WHERE actor LIKE 'recent-%'");
 const page=await read('orderStage=all&inboxPage=1');assert.equal(page.conversations.some((c:any)=>c.id===old),false);assert.equal(page.requests.find((r:any)=>r.id===order).customer_name,'கோகுல் 50%_shop');
 for(const query of ['கோகுல்','+919000000001','9000000001','50%_shop']){
  const result=await read('orderStage=all&inboxPage=1&orderSearch='+encodeURIComponent(query)+'&inboxSearch='+encodeURIComponent(query));assert.equal(result.orderPage.total,1,query);assert.equal(result.inboxPage.total,1,query);assert.equal(result.requests[0].id,order);assert.equal(result.conversations[0].id,old);
 }
 const foreignStore=randomUUID(),foreign=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Foreign',true)",[foreignStore]);await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'foreign')",[foreign,foreignStore]);await pool.query("INSERT INTO whatsapp_channels(phone_id,store_id,app_id,waba_id) VALUES('999999999',$1,'888888888','777777777')",[foreignStore]);await pool.query("INSERT INTO whatsapp_conversations(conversation_id,phone_id,recipient,last_inbound_at,profile_name) VALUES($1,'999999999','919000000099',now(),'Private identity')",[foreign]);
 const denied=await read('conversation='+foreign+'&inboxSearch=Private');assert.equal(denied.inboxPage.total,0);assert.equal(denied.conversations.length,0);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_requests')).rows[0].n,1);assert.equal((await pool.query('SELECT count(*)::int AS n FROM whatsapp_outbox')).rows[0].n,0);
}));

test('customer labels retain simulator and unknown-channel fallbacks',()=>{
 assert.equal(customerLabel('local-simulator','abcdef12'),'Demo shopper');assert.equal(customerLabel(undefined,'abcdef123'),'Customer · abcdef12');
 assert.equal(customerLabel('whatsapp:hidden','abcdef12',{customer_name:null,customer_phone:'919000000002'}),'+919000000002');
});
