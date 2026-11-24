import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {factColumns} from '../packages/contracts/catalog-facts.js';
import {parseFactCsv,factCsvCell,factPaise,factQuantity,previewCatalogFacts,applyCatalogFacts,exportCatalogFacts,catalogFactsBatch} from '../apps/server/src/services/catalog-fact-imports.js';
import {ownerOperationsSummary} from '../apps/server/src/services/owner-operations.js';
import {demoReviewSchema,demoReviewSummary,collectDemoCase} from '../apps/server/src/services/demo-evidence.js';
import {createApp} from '../apps/server/src/http/app.js';
const csv=(rows:string[][])=>[factColumns.join(','),...rows.map(r=>r.map(factCsvCell).join(','))].join('\r\n');
const row=(sku:string,price='',stock='',version='1',iv='1'):string[]=>[sku,version,iv,`Tool ${sku}`,'piece',price,price==='0'?'free':price?'priced':'',price?'yes':'',stock,stock?'true':'','Shop count'];
test('shop-fact decimals/CSV preserve zero, Unicode, quotes, newlines and formula-safe context',()=>{
 assert.equal(factPaise('123.05'),12305);assert.equal(factPaise('0'),0);assert.throws(()=>factPaise('1.001'));assert.throws(()=>factPaise('-1'));assert.throws(()=>factPaise('1e2'));
 assert.equal(factQuantity('0.125'),'0.125');assert.equal(factQuantity('0'),'0.000');assert.throws(()=>factQuantity('1.0001'));assert.throws(()=>factQuantity('-1'));
 assert.throws(()=>factQuantity('1048576.001'),/stock ledger/);
 const r=row('SKU');r[3]='தமிழ், "pipe"\n20mm';assert.equal(parseFactCsv(csv([r]))[0][3],r[3]);
 assert.equal(factCsvCell('=SUM(1)'), '"\'=SUM(1)"');assert.throws(()=>parseFactCsv('sku\nx'),/exact exported/);
 assert.throws(()=>parseFactCsv(csv([r])+'\n"unfinished'),/unfinished/);
});
test('bulk facts preview/apply/replay isolates shops, reserves stock and blocks stale chunks atomically',{skip:!process.env.DATABASE_URL},async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='facts_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 const tx=async<T>(fn:(c:pg.PoolClient)=>Promise<T>)=>{const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 try{
  await setupDatabase(pool,'mock');await setupDatabase(pool,'mock');assert.equal((await pool.query('SELECT version FROM schema_migrations WHERE version=38')).rowCount,1);
  for(let n=1;n<=52;n++){const sku='FACT-'+n;await pool.query('INSERT INTO products(store_id,sku,name,unit,price_paise,price_status,stock) VALUES($1,$2,$3,\'piece\',0,\'confirm\',NULL)',[fixtureStore,sku,`Tool ${sku}`]);}
  const exported=await tx(c=>exportCatalogFacts(c,fixtureStore,{q:'Tool FACT-',sort:'sku'}));assert.equal(exported.total,52);assert.equal(parseFactCsv(exported.csv).length,52);assert.equal(parseFactCsv(exported.csv)[0][5],'');
  const blank=await tx(c=>previewCatalogFacts(c,fixtureStore,csv([row('FACT-1')])));assert.equal(blank.counts.changed,0);assert.equal(blank.counts.unchanged,1);
  const duplicate=await tx(c=>previewCatalogFacts(c,fixtureStore,csv([row('FACT-1','12'),row('FACT-1','13')])));assert.equal(duplicate.status,'invalid');assert.equal(duplicate.counts.errors,2);
  const absent=await tx(c=>previewCatalogFacts(c,randomUUID(),csv([row('FACT-1','12')]))).catch(()=>null);assert.equal(absent,null,'missing shop cannot create batch');
  const sheet=csv(Array.from({length:52},(_,i)=>row('FACT-'+(i+1),'12.05','10'))),batch=await tx(c=>previewCatalogFacts(c,fixtureStore,sheet));
  assert.equal(batch.counts.changed,52);assert.equal(batch.rows.length,25);assert.equal(batch.nextCursor,'25');
  const receipt=await tx(c=>applyCatalogFacts(c,fixtureStore,'fixture-owner',{batchId:batch.batchId,fileHash:batch.fileHash,expectedChunk:0}));assert.equal(receipt.counts.committed,50);assert.equal(receipt.counts.remaining,2);assert.equal(receipt.nextChunk,1);
  const replay=await tx(c=>applyCatalogFacts(c,fixtureStore,'fixture-owner',{batchId:batch.batchId,fileHash:batch.fileHash,expectedChunk:0}));assert.equal(replay.replayed,true);assert.equal(replay.counts.committed,50);
  assert.equal(Number((await pool.query('SELECT count(*) FROM inventory_movements WHERE store_id=$1',[fixtureStore])).rows[0].count),50);
  const p=(await pool.query("SELECT * FROM products WHERE sku='FACT-1'")).rows[0];assert.equal(p.price_paise,1205);assert.equal(p.price_status,'priced');assert.equal(p.stock,'10.000');assert.equal(p.version,2);assert.equal(p.inventory_version,2);assert.equal(p.merchant_verification.identity,false);assert.equal(p.merchant_verification.photo,false);assert.equal(p.merchant_verification.price,true);assert.equal(p.merchant_verification.stock,true);
  await pool.query("UPDATE products SET version=version+1 WHERE sku='FACT-51'");
  const blocked=await tx(c=>applyCatalogFacts(c,fixtureStore,'fixture-owner',{batchId:batch.batchId,fileHash:batch.fileHash,expectedChunk:1}));assert.equal(blocked.status,'blocked');assert.equal(blocked.counts.committed,50);assert.equal((await pool.query("SELECT price_paise FROM products WHERE sku='FACT-52'")).rows[0].price_paise,0);
  await assert.rejects(tx(c=>applyCatalogFacts(c,fixtureStore,'fixture-owner',{batchId:batch.batchId,fileHash:'b'.repeat(64),expectedChunk:1})),/different file/);
  const last=await tx(c=>catalogFactsBatch(c,fixtureStore,batch.batchId,50,25));assert.equal(last.rows.length,2);assert.ok(last.rows[0].errors.length);
  await assert.rejects(tx(c=>catalogFactsBatch(c,randomUUID(),batch.batchId)),/not found/);
  await pool.query("UPDATE products SET stock=10,reserved_stock=5 WHERE sku='FACT-52'");
  const under=await tx(c=>previewCatalogFacts(c,fixtureStore,csv([row('FACT-52','','4')])));assert.equal(under.status,'invalid');assert.match(under.rows[0].errors.join(' '),/reserved/);
  const zero=await tx(c=>previewCatalogFacts(c,fixtureStore,csv([row('FACT-2','0','','2','2')])));assert.equal(zero.status,'preview');
  const done=await tx(c=>applyCatalogFacts(c,fixtureStore,'fixture-owner',{batchId:zero.batchId,fileHash:zero.fileHash,expectedChunk:0}));assert.equal(done.status,'complete');assert.equal((await pool.query("SELECT price_status FROM products WHERE sku='FACT-2'")).rows[0].price_status,'free');
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
test('operations summary is store-scoped/read-only and demo sessions retain failures and no-order outcomes',{skip:!process.env.DATABASE_URL},async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='ops_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');const conversation=randomUUID(),pending=randomUUID();await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'private-test-customer')",[conversation,fixtureStore]);
  await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,created_at) VALUES($1,$2,'inbound','PRIVATE customer words','pending',now()-interval '10 minutes')",[pending,conversation]);
  const before=(await pool.query('SELECT status FROM messages WHERE id=$1',[pending])).rows[0].status;
  const summary=await ownerOperationsSummary(pool,fixtureStore);assert.equal(summary.current.pending.count,1);assert.ok(summary.current.pending.oldestAgeSeconds!>=590);assert.equal(summary.timing.serverReceiptToUsefulReply,null);assert.ok(summary.issues.some(i=>i.messageId===pending));assert.ok(!JSON.stringify(summary).includes('PRIVATE customer words'));assert.equal(summary.recent.inbound,1);assert.equal((await pool.query('SELECT status FROM messages WHERE id=$1',[pending])).rows[0].status,before);
  await assert.rejects(ownerOperationsSummary(pool,randomUUID()),/Shop not found/);
  const fingerprint='a'.repeat(64),review=demoReviewSchema.parse({schemaVersion:1,kind:'demo_usability_review',reviewer:'Fixture owner',manifest:{releaseFingerprint:fingerprint,catalogRevision:1,demoOptions:{payAtShop:true}},cases:[{caseId:'T07',sessionId:'no-order',source:'fixture',outcome:'pass',conversationId:conversation,startedAt:new Date(Date.now()-1200000).toISOString(),endedAt:new Date().toISOString(),requestIds:[]},{caseId:'T05',sessionId:'failed',source:'fixture',outcome:'fail',startedAt:new Date(Date.now()-1200000).toISOString(),endedAt:new Date().toISOString(),releaseBlockingFailure:true},{caseId:'T01',sessionId:'tomorrow',source:'demo_customer',outcome:'not_executed'}]});
  const totals=demoReviewSummary(review);assert.equal(totals.executedSessions,2);assert.equal(totals.outcomes.fail,1);assert.equal(totals.outcomes.not_executed,1);assert.equal(totals.releaseBlockingFailures,1);
  const c=await pool.connect();try{await c.query('BEGIN READ ONLY');const result=await collectDemoCase(c,fixtureStore,review.cases[0],fingerprint);assert.equal(result?.requests?.length,0);assert.equal(result?.customerTurns,1);await c.query('COMMIT');}finally{c.release();}
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
test('owner fact routes retain owner authentication, CSRF, file guards and replay tokens',{skip:!process.env.DATABASE_URL},async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='facts_http_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{
  await setupDatabase(pool,'mock');await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,price_status,stock) VALUES($1,'HTTP-1','Tool HTTP-1','piece',0,'confirm',NULL)",[fixtureStore]);
  const owner={hostname:'owner.example.test',issuer:'https://fixture.cloudflareaccess.com',audience:'fixture-audience-1234',email:'owner@example.test',storeId:fixtureStore};
  app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,host:'127.0.0.1',port:3017,mediaDir:'/tmp/facts-http',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'fixture'}));
  const headers={host:owner.hostname,'cf-access-jwt-assertion':'fixture',origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json'};
  assert.equal((await app.inject({url:'/api/owner/operations/summary',headers:{host:owner.hostname}})).statusCode,403);
  assert.equal((await app.inject({url:'/api/owner/operations/summary',headers})).statusCode,200);
  const endpoint='/api/owner/catalog/facts/preview',payload={csv:csv([row('HTTP-1','10','0')])};
  assert.equal((await app.inject({url:endpoint,method:'POST',headers:{...headers,origin:'https://bad.example'},payload})).statusCode,403);
  const preview=await app.inject({url:endpoint,method:'POST',headers,payload});assert.equal(preview.statusCode,200,preview.body);const b=preview.json();
  const withoutToken=await app.inject({url:'/api/owner/catalog/facts/apply',method:'POST',headers,payload:{batchId:b.batchId,fileHash:b.fileHash}});assert.equal(withoutToken.statusCode,400);
  const apply=await app.inject({url:'/api/owner/catalog/facts/apply',method:'POST',headers,payload:{batchId:b.batchId,fileHash:b.fileHash,expectedChunk:0}});assert.equal(apply.statusCode,200,apply.body);assert.equal(apply.json().status,'complete');
  const exp=await app.inject({url:'/api/owner/catalog/facts/export?q=HTTP-1',headers});assert.equal(exp.statusCode,200);assert.match(exp.headers['content-type']!,/text\/csv/);assert.equal(parseFactCsv(exp.body)[0][5],'');
  const badPage=await app.inject({url:'/api/owner/catalog/facts/batches/'+b.batchId+'?cursor=-1',headers});assert.equal(badPage.statusCode,400);
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
