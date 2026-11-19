import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {createApp} from '../apps/server/src/http/app.js';
import {WhatsAppChannel} from '../apps/server/src/services/whatsapp-channel.js';
import {fixtureStore} from '../profiles/hardware.js';
import type {WhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';

const recipient='919000000001';
const channelConfig:WhatsAppConfig={
 hostname:'api.example.test',storeId:fixtureStore,appId:'123456789',wabaId:'987654321',phoneId:'123987654',
 appSecret:'offline-secret',verifyToken:'offline-verify',accessToken:'offline-token',graphVersion:'v25.0',recipients:[recipient],
 defaultReplyLanguage:'en',processEnabled:false,sendEnabled:true,visualOrdering:true,
};
const owner={hostname:'owner.example.test',issuer:'https://test.cloudflareaccess.com',audience:'test',email:'owner@example.test',storeId:fixtureStore};
const headers={host:owner.hostname,'cf-access-jwt-assertion':'offline-owner',origin:'https://'+owner.hostname,'x-shopbot-owner':'1'};
const manual=(name:string,pricePaise:number,quantity=1)=>({id:randomUUID(),name,unit:'piece',pricePaise,quantity,manualConfirmed:true});

test('ready and counter orders use saved bill revisions and one WhatsApp send per revision',async()=>{
 const schema='owner_final_bills_'+randomUUID().replaceAll('-','');
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 let app:Awaited<ReturnType<typeof createApp>>|undefined;
 const sent:any[]=[];
 const uploads:Buffer[]=[];
 try{
  await setupDatabase(pool,'mock');
  const channel=new WhatsAppChannel(pool,channelConfig,async(url,init)=>{
   if(String(url).endsWith('/media')){
    const file=(init!.body as FormData).get('file');
    assert.ok(file instanceof Blob);
    assert.equal(file.type,'application/pdf');
    uploads.push(Buffer.from(await file.arrayBuffer()));
    return new Response(JSON.stringify({id:'media.fixture.'+uploads.length}));
   }
   const payload=JSON.parse(String(init!.body));sent.push(payload);
   return new Response(JSON.stringify({messages:[{id:'wamid.fixture.'+sent.length}]}),{status:200});
  });
  await channel.setup();
  const conversationId=randomUUID(),actor='whatsapp:'+recipient;
  await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language) VALUES($1,$2,$3,'en')",[conversationId,fixtureStore,actor]);
  await pool.query('INSERT INTO whatsapp_conversations(conversation_id,phone_id,recipient,last_inbound_at) VALUES($1,$2,$3,now())',[conversationId,channelConfig.phoneId,recipient]);
  const insertChatOrder=async(id:string,lines:ReturnType<typeof manual>[],total:number,ready=false)=>{
   const snapshots=lines.map(line=>({...line,resolution:'matched',merchantConfirmed:{actor:'fixture',at:'2026-11-18',free:false}}));
   await pool.query(`INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise,acceptance,fulfillment,packed_revision)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)`,[id,fixtureStore,conversationId,actor,randomUUID(),JSON.stringify(snapshots),total,
     ready?'accepted':'awaiting_approval',ready?'ready_for_pickup':'awaiting_approval',ready?1:null]);
  };
  app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/final-bill-test',owner,whatsapp:channelConfig},
   pool,undefined,undefined,async()=>({email:owner.email,subject:'offline-owner'}),channel);
  const post=(path:string,payload:object)=>app!.inject({method:'POST',url:'/api/owner/'+path,headers,payload});
  const get=(path:string)=>app!.inject({url:'/api/owner/'+path,headers});
  const paths=(id:string)=>'requests/'+id;
  const address=await post('store/details',{name:'Demo Hardware',expectedName:(await pool.query('SELECT name FROM stores WHERE id=$1',[fixtureStore])).rows[0].name,billAddress:'Tirunelveli, Tamil Nadu',expectedBillAddress:null});
  assert.equal(address.statusCode,200,address.body);

  const orderId=randomUUID(),a=manual('PVC elbow',5500,2),b=manual('Unavailable gloves',15000),c=manual('Sandpaper P120',2500,3);
  await insertChatOrder(orderId,[a,b],26000);
  const reviewPath=paths(orderId)+'/review';
  const swapped={id:randomUUID(),expectedRevision:1,action:'save',lines:[a,c],addedLineIds:[c.id],removedLineIds:[b.id]};
  assert.equal((await post(reviewPath,{...swapped,removedLineIds:[]})).statusCode,409);
  const saved=await post(reviewPath,swapped);
  assert.equal(saved.statusCode,200,saved.body);
  assert.deepEqual(saved.json().removedItems,[{id:b.id,name:b.name}]);
  const readyRequest={id:randomUUID(),expectedRevision:2,action:'ready',lines:[a,c]};
  const ready=await post(reviewPath,readyRequest);
  assert.equal(ready.statusCode,200,ready.body);
  const first=ready.json();
  assert.equal(first.totalPaise,18500);
  assert.equal(first.customerNotification,'queued');
  assert.equal((await post(reviewPath,readyRequest)).json().messageId,first.messageId);
  const print=await get(paths(orderId)+'/bill');
  assert.equal(print.statusCode,200,print.body);
  assert.equal(print.headers['content-type'],'application/pdf');
  assert.equal(print.rawPayload.subarray(0,5).toString(),'%PDF-');
  assert.equal(await channel.sendNext(),true);
  assert.equal(sent[0].type,'document');
  assert.equal(sent[0].document.id,'media.fixture.1');
  assert.match(sent[0].document.filename,/bill-3\.pdf$/);
  assert.match(sent[0].document.caption,/shop has checked.*ready for pickup/is);
  assert.match(sent[0].document.caption,/₹185\.00/);
  assert.deepEqual(uploads[0],print.rawPayload);

  const pipe=manual('PVC pipe',34000);
  const updated=await post(reviewPath,{id:randomUUID(),expectedRevision:3,action:'update_ready',
   lines:[{...a,quantity:1},pipe],addedLineIds:[pipe.id],removedLineIds:[c.id]});
  assert.equal(updated.statusCode,200,updated.body);
  assert.equal(updated.json().stage,'ready');
  assert.equal(updated.json().totalPaise,39500);
  assert.equal((await post(paths(orderId)+'/complete',{expectedRevision:3})).statusCode,409);
  const history=(await get(paths(orderId)+'/bills')).json();
  assert.deepEqual(history.bills.map((bill:any)=>[bill.revision,Number(bill.total_paise)]),[[4,39500],[3,18500]]);
  const olderDownload=await get(paths(orderId)+'/bill?mode=download&revision=3');
  assert.match(String(olderDownload.headers['content-disposition']),/attachment/);
  assert.deepEqual(olderDownload.rawPayload,print.rawPayload);
  assert.equal((await post(paths(orderId)+'/complete',{expectedRevision:4})).statusCode,200);
  const original=(await pool.query('SELECT lines,payment FROM order_requests WHERE id=$1',[orderId])).rows[0];
  assert.deepEqual(original.lines.map((line:any)=>line.id),[a.id,b.id]);
  assert.equal(original.payment,'not_requested');

  const legacy=randomUUID();
  await insertChatOrder(legacy,[a],11000,true);
  const legacySent=await post(paths(legacy)+'/bill/send',{expectedRevision:1});
  assert.equal(legacySent.statusCode,200,legacySent.body);
  assert.equal(legacySent.json().customerNotification,'queued');

  const walkIn={id:randomUUID(),stage:'new',lines:[manual('Steel screw',1875,2)]};
  const created=await post('requests',walkIn);
  assert.equal(created.statusCode,200,created.body);
  assert.equal(created.json().stage,'new');
  assert.equal((await post('requests',walkIn)).json().replayed,true);
  assert.equal((await post('requests',{...walkIn,stage:'completed'})).statusCode,409);
  const openOrders=(await get('snapshot?scope=orders&orderStage=new')).json().requests;
  const anonymous=openOrders.find((entry:any)=>entry.id===walkIn.id);
  assert.equal(anonymous.source,'in_store');
  assert.equal(anonymous.customer_name,null);
  assert.equal(anonymous.conversation_id,null);
  assert.equal((await post(paths(walkIn.id)+'/review',{id:randomUUID(),expectedRevision:1,action:'ready',lines:walkIn.lines})).statusCode,200);

  const completed={id:randomUUID(),stage:'completed',customerName:'Counter customer',customerPhone:'+'+recipient,
   lines:Array.from({length:13},(_,index)=>manual('Counter item '+(index+1),2500))};
  assert.equal((await post('requests',completed)).statusCode,200);
  const completedOrders=(await get('snapshot?scope=orders&orderStage=completed')).json().requests;
  assert.equal(completedOrders.find((entry:any)=>entry.id===completed.id).stage,'completed');
  const completedBill=await get(paths(completed.id)+'/bill?mode=download&revision=1');
  assert.equal(completedBill.headers['content-type'],'application/pdf');
  assert.equal((completedBill.body.match(/\/Type \/Page\b/g)??[]).length,2);
  const find=await post(paths(completed.id)+'/bill/recipient',{phone:completed.customerPhone});
  assert.equal(find.json().conversationId,conversationId);
  const sendCounter={expectedRevision:1,conversationId,customerOptedIn:true};
  assert.equal((await post(paths(completed.id)+'/bill/send',{...sendCounter,customerOptedIn:false})).statusCode,409);

  await pool.query("UPDATE whatsapp_conversations SET last_inbound_at=now()-interval '25 hours' WHERE conversation_id=$1",[conversationId]);
  const blocked=await post(paths(completed.id)+'/bill/send',sendCounter);
  assert.equal(blocked.statusCode,200,blocked.body);
  assert.match(blocked.json().reason,/24-hour/);
  assert.equal((await pool.query('SELECT conversation_id FROM order_requests WHERE id=$1',[completed.id])).rows[0].conversation_id,null);
  await pool.query('UPDATE whatsapp_conversations SET last_inbound_at=now() WHERE conversation_id=$1',[conversationId]);
  const counterSend=await post(paths(completed.id)+'/bill/send',sendCounter);
  assert.equal(counterSend.statusCode,200,counterSend.body);
  assert.equal(counterSend.json().customerNotification,'queued');
  assert.equal((await post(paths(completed.id)+'/bill/send',sendCounter)).json().messageId,counterSend.json().messageId);
  const document=(await pool.query('SELECT reply_payload,document_pdf FROM whatsapp_outbox WHERE message_id=$1',[counterSend.json().messageId])).rows[0];
  assert.equal(document.reply_payload.type,'document');
  assert.match(document.reply_payload.document.caption,/₹325\.00/);
  assert.doesNotMatch(document.reply_payload.document.caption,/ready for pickup/i);
  assert.deepEqual(document.document_pdf,completedBill.rawPayload);
  await pool.query("UPDATE whatsapp_outbox SET state='blocked' WHERE message_id=$1",[counterSend.json().messageId]);
  const retry=await post(paths(completed.id)+'/bill/send',sendCounter);
  assert.equal(retry.json().messageId,counterSend.json().messageId);
  assert.equal((await pool.query('SELECT state FROM whatsapp_outbox WHERE message_id=$1',[counterSend.json().messageId])).rows[0].state,'queued');
 }finally{
  await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
 }
});
