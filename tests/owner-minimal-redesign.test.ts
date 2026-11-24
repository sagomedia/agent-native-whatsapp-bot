import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo} from '../apps/server/src/services/demo-catalog.js';
import {simulatorContext} from '../apps/server/src/services/simulator.js';
import {createApp} from '../apps/server/src/http/app.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {reserveRequest} from '../apps/server/src/services/inventory.js';

test('owner revises, marks ready and completes an order with advisory stock and manual ₹10 receipt',async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const schema='owner_redesign_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');
  await setupImageDemo(pool,simulatorContext.storeId);
  const product=(await pool.query("UPDATE products SET stock=0 WHERE store_id=$1 AND sku='H08' RETURNING sku,name,unit,price_paise,version",[simulatorContext.storeId])).rows[0];
  assert.ok(product);
  const orderId=randomUUID(),lineId=randomUUID();
  const original={id:lineId,sku:product.sku,productVersion:product.version,name:product.name,quantity:1,unit:product.unit,pricePaise:Number(product.price_paise),resolution:'matched' as const};
  await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",[orderId,simulatorContext.storeId,simulatorContext.conversationId,simulatorContext.actor,randomUUID(),JSON.stringify([original]),product.price_paise]);
  await pool.query("INSERT INTO order_advances(id,store_id,request_id,amount_paise,payee_vpa,payee_name,upi_uri,review_id) VALUES($1,$2,$3,1000,'shop@bank','Shop','upi://pay?am=10.00',$4)",[randomUUID(),simulatorContext.storeId,orderId,randomUUID()]);
  const owner={hostname:'owner.example.test',issuer:'https://fixture.cloudflareaccess.com',audience:'offline_fixture_audience',email:'owner@example.test',storeId:simulatorContext.storeId};
  const app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/owner-redesign-test',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline-owner'}));
  try{
   const headers={host:owner.hostname,'cf-access-jwt-assertion':'offline-owner',origin:'https://'+owner.hostname,'x-shopbot-owner':'1'};
   const post=(path:string,payload:object)=>app.inject({method:'POST',url:'/api/owner/requests/'+orderId+path,headers,payload});
   const confirmed=await post('/advance/confirm',{received:true,expectedState:'requested'});
   assert.equal(confirmed.statusCode,200,confirmed.body);
   const receipt=(await pool.query('SELECT state,transaction_reference,verified_by,verified_at FROM order_advances WHERE request_id=$1',[orderId])).rows[0];
   assert.equal(receipt.state,'verified');assert.equal(receipt.transaction_reference,null);assert.equal(receipt.verified_by,owner.email);assert.ok(receipt.verified_at);
   // Later catalog edits must not force a rewrite of the bill identity or price the customer saw.
   await pool.query('UPDATE products SET name=$3,price_paise=price_paise+500,version=version+1 WHERE store_id=$1 AND sku=$2',[simulatorContext.storeId,product.sku,'Renamed catalog item']);
   const revised={id:lineId,sku:product.sku,productVersion:product.version,name:product.name,quantity:2,unit:product.unit,pricePaise:Number(product.price_paise)+100};
   const revisionId=randomUUID();
   const revise=await post('/review',{id:revisionId,expectedRevision:1,action:'revise',lines:[revised],notify:false});
   assert.equal(revise.statusCode,200,revise.body);
   assert.equal(revise.json().stage,'new');assert.equal(revise.json().effectiveRevision,2);
   const replay=await post('/review',{id:revisionId,expectedRevision:1,action:'revise',lines:[revised],notify:false});
   assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().replayed,true);
   const foreignId=randomUUID();
   await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",[foreignId,simulatorContext.storeId,simulatorContext.conversationId,simulatorContext.actor,randomUUID(),JSON.stringify([original]),product.price_paise]);
   const crossTarget=await app.inject({method:'POST',url:'/api/owner/requests/'+foreignId+'/review',headers,payload:{id:revisionId,expectedRevision:1,action:'revise',lines:[revised],notify:false}});
   assert.equal(crossTarget.statusCode,409,crossTarget.body);
   assert.equal((await pool.query('SELECT effective_revision FROM order_requests WHERE id=$1',[foreignId])).rows[0].effective_revision,1);
   const unauthorized=await app.inject({method:'POST',url:'/api/owner/requests/'+foreignId+'/review',headers:{host:owner.hostname},payload:{id:randomUUID(),expectedRevision:1,action:'save',lines:[revised]}});
   assert.equal(unauthorized.statusCode,403);
   const ready=await post('/review',{id:randomUUID(),expectedRevision:2,action:'ready',lines:[revised],notify:false});
   assert.equal(ready.statusCode,200,ready.body);assert.equal(ready.json().stage,'ready');
   const after=(await pool.query('SELECT fulfillment,acceptance,total_paise,effective_total_paise,inventory_state FROM order_requests WHERE id=$1',[orderId])).rows[0];
   assert.equal(after.fulfillment,'ready_for_pickup');assert.equal(after.acceptance,'accepted');
   assert.equal(Number(after.total_paise),product.price_paise);assert.equal(Number(after.effective_total_paise),2*(product.price_paise+100));
   assert.equal(after.inventory_state,'untracked');
   assert.equal((await pool.query("SELECT count(*)::int AS n FROM inventory_reservations WHERE request_id=$1 AND state='active'",[orderId])).rows[0].n,0);
   const complete=await post('/complete',{expectedRevision:3});
   assert.equal(complete.statusCode,200,complete.body);assert.equal(complete.json().stage,'completed');
   const count=(await pool.query("SELECT stock,reserved_stock FROM products WHERE store_id=$1 AND sku='H08'",[simulatorContext.storeId])).rows[0];
   assert.equal(Number(count.stock),0);assert.equal(Number(count.reserved_stock),0);
   const originalSnapshot=(await pool.query('SELECT lines,effective_lines FROM order_requests WHERE id=$1',[orderId])).rows[0];
   assert.equal(originalSnapshot.lines[0].pricePaise,Number(product.price_paise));
   assert.equal(originalSnapshot.lines[0].name,product.name);
   assert.equal(originalSnapshot.effective_lines[0].name,product.name);
   await pool.query('UPDATE products SET name=$3,price_paise=$4,version=$5 WHERE store_id=$1 AND sku=$2',[simulatorContext.storeId,product.sku,product.name,product.price_paise,product.version]);
   await pool.query("UPDATE products SET stock=10 WHERE store_id=$1 AND sku='H08'",[simulatorContext.storeId]);
   const olderId=randomUUID(),olderLineId=randomUUID(),olderLine={...original,id:olderLineId};
   await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise,acceptance,fulfillment) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,'accepted','preparing')",[olderId,simulatorContext.storeId,simulatorContext.conversationId,simulatorContext.actor,randomUUID(),JSON.stringify([olderLine]),Number(product.price_paise)]);
   const client=await pool.connect();
   try{await client.query('BEGIN');await reserveRequest(client,simulatorContext.storeId,olderId,[olderLine],1,owner.email);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
   const older=await app.inject({method:'POST',url:'/api/owner/requests/'+olderId+'/review',headers,payload:{id:randomUUID(),expectedRevision:1,action:'ready',lines:[{id:olderLineId,sku:product.sku,productVersion:product.version,name:product.name,quantity:1,unit:product.unit,pricePaise:Number(product.price_paise)}],notify:false}});
   assert.equal(older.statusCode,200,older.body);
   const oldHold=(await pool.query('SELECT state FROM inventory_reservations WHERE request_id=$1',[olderId])).rows[0];
   assert.equal(oldHold.state,'released');
   const oldStock=(await pool.query("SELECT stock,reserved_stock FROM products WHERE store_id=$1 AND sku='H08'",[simulatorContext.storeId])).rows[0];
   assert.equal(Number(oldStock.stock),10);assert.equal(Number(oldStock.reserved_stock),0);
  }finally{await app.close();}
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});


test('customers can choose, review and submit recorded zero, unknown and insufficient stock',async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const schema='advisory_checkout_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');
  const tools=new RetailTools(pool);
  for(const stock of [0,null,1]){
   await pool.query("UPDATE products SET stock=$1 WHERE store_id=$2 AND sku='PTFE-TAPE'",[stock,simulatorContext.storeId]);
   const ctx={...simulatorContext,conversationId:randomUUID()};
   await pool.query('INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,$3)',[ctx.conversationId,ctx.storeId,ctx.actor]);
   let result=await tools.invoke(ctx,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'PTFE-TAPE',quantity:3}]}},randomUUID());
   assert.equal(result.state!.draft[0].resolution,'matched');
   result=await tools.invoke(ctx,{name:'preview_order',args:{expectedVersion:result.state!.version}},randomUUID());
   const pending=result.state!.pending;
   assert.equal(pending?.kind,'review');
   if(pending?.kind!=='review')throw new Error('Expected checkout review');
   result=await tools.invoke({...ctx,consentReviewId:pending.id},{name:'submit_order_request',args:{reviewId:pending.id}},randomUUID());
   assert.ok(result.request,`stock ${stock}: ${result.message}`);
   assert.equal(result.request.lines[0].quantity,3);
   assert.equal(result.request.totalPaise,10500);
  }
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
