import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {createApp} from '../apps/server/src/http/app.js';
import {reserveRequest} from '../apps/server/src/services/inventory.js';
import {fixtureStore,fixtureConversation} from '../profiles/hardware.js';

test('not-picked-up cancellation is scoped, revision checked, auditable, and releases stock without recording collection or a refund',async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const schema='uncollected_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 const apps:Awaited<ReturnType<typeof createApp>>[]=[];
 try{
  await setupDatabase(pool,'mock');
  const product=(await pool.query("UPDATE products SET stock=10,reserved_stock=0 WHERE store_id=$1 AND sku='PVC-ELBOW-050' RETURNING *",[fixtureStore])).rows[0];
  const id=randomUUID(),line={id:randomUUID(),sku:product.sku,productVersion:product.version,name:product.name,quantity:2,unit:product.unit,pricePaise:product.price_paise,resolution:'matched' as const};
  await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise,acceptance,fulfillment,effective_revision,packed_revision) VALUES($1,$2,$3,'local-simulator',$4,$5::jsonb,$6,'accepted','ready_for_pickup',1,1)",[id,fixtureStore,fixtureConversation,randomUUID(),JSON.stringify([line]),2*product.price_paise]);
  const owner={hostname:'owner.example.test',issuer:'https://fixture.cloudflareaccess.com',audience:'offline_fixture',email:'owner@example.test',storeId:fixtureStore};
  const c=await pool.connect();try{await c.query('BEGIN');await reserveRequest(c,fixtureStore,id,[line],1,owner.email);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  await pool.query("INSERT INTO order_advances(id,store_id,request_id,review_id,amount_paise,payee_vpa,payee_name,upi_uri,state,verified_by,verified_at) VALUES($1,$2,$3,$4,1000,'fixture@bank','Fixture shop','upi://pay?am=10.00','verified',$5,now())",[randomUUID(),fixtureStore,id,randomUUID(),owner.email]);
  const config={mode:'mock' as const,databaseUrl:process.env.DATABASE_URL!,host:'127.0.0.1',port:3017,mediaDir:'/tmp/shopbot-uncollected-test',owner};
  const app=await createApp(config,pool,undefined,undefined,async()=>({email:owner.email,subject:'fixture-owner'}));apps.push(app);
  const headers={host:owner.hostname,'cf-access-jwt-assertion':'fixture-owner',origin:'https://'+owner.hostname,'x-shopbot-owner':'1'};
  const payload={expected:'ready_for_pickup',status:'cancelled',expectedRevision:1,reason:'not_picked_up',notify:false};
  const url='/api/owner/requests/'+id+'/fulfillment';
  const post=(body:object)=>app.inject({method:'POST',url,headers,payload:body});
  assert.equal((await app.inject({method:'POST',url,headers:{host:owner.hostname},payload})).statusCode,403);
  assert.equal((await post({...payload,expectedRevision:0})).statusCode,409);
  assert.equal((await post({...payload,expected:'preparing'})).statusCode,400);
  assert.equal((await post({...payload,reason:'other'})).statusCode,400);
  const otherStore=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other fixture','true')",[otherStore]);
  const other=await createApp({...config,owner:{...owner,storeId:otherStore}},pool,undefined,undefined,async()=>({email:owner.email,subject:'other-fixture'}));apps.push(other);
  assert.equal((await other.inject({method:'POST',url,headers,payload})).statusCode,409);
  await pool.query("UPDATE order_requests SET fulfillment='collected' WHERE id=$1",[id]);
  assert.equal((await post(payload)).statusCode,409,'A collected order must never become a not-picked-up cancellation');
  await pool.query("UPDATE order_requests SET fulfillment='ready_for_pickup' WHERE id=$1",[id]);
  assert.equal(Number((await pool.query('SELECT reserved_stock FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,product.sku])).rows[0].reserved_stock),2);
  const result=await post(payload);assert.equal(result.statusCode,200,result.body);assert.equal(result.json().reason,'not_picked_up');assert.equal(result.json().customerNotification,'not_requested');
  const closed=(await pool.query('SELECT * FROM order_requests WHERE id=$1',[id])).rows[0];assert.equal(closed.fulfillment,'cancelled');assert.equal(closed.inventory_state,'released');assert.equal(closed.payment,'not_requested');assert.deepEqual(closed.lines,[line]);assert.equal(Number(closed.total_paise),2*product.price_paise);
  const stock=(await pool.query('SELECT stock,reserved_stock FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,product.sku])).rows[0];assert.equal(Number(stock.stock),10);assert.equal(Number(stock.reserved_stock),0);
  const advance=(await pool.query('SELECT state,verified_by,transaction_reference FROM order_advances WHERE request_id=$1',[id])).rows[0];assert.equal(advance.state,'refund_pending');assert.equal(advance.verified_by,owner.email);assert.equal(advance.transaction_reference,null);
  const audit=(await pool.query("SELECT details FROM owner_audit WHERE action='request_fulfillment' AND target_id=$1 ORDER BY sequence",[id])).rows;assert.equal(audit[0].details.reason,'not_picked_up');
  const retry=await post(payload);assert.equal(retry.statusCode,200,retry.body);assert.equal(retry.json().duplicate,true);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM inventory_movements WHERE request_id=$1 AND kind='release'",[id])).rows[0].n,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM inventory_movements WHERE request_id=$1 AND kind='collect'",[id])).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM whatsapp_outbox')).rows[0].n,0);
  for(const stage of ['ready','completed','all']){const r=await app.inject({url:'/api/owner/snapshot?details=0&orderStage='+stage,headers});assert.equal(r.statusCode,200,r.body);const found=r.json().requests.find((r:any)=>r.id===id);if(stage==='all')assert.equal(found.stage,'cancelled');else assert.equal(found,undefined);}
  assert.equal((await app.inject({method:'POST',url:'/api/owner/requests/'+id+'/complete',headers,payload:{expectedRevision:1}})).statusCode,409);
 }finally{for(const app of apps)await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
