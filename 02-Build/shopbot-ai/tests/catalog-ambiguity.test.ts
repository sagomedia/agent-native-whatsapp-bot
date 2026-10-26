import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {discoverProducts,needsPipeType} from '../apps/server/src/services/catalog-discovery.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {visualReply} from '../apps/server/src/services/visual-ordering.js';

test('unspecified water and pumping pipes retain quantity without inventing a PVC or hose SKU',async()=>{
 const schema='catalog_ambiguity_'+randomUUID().replaceAll('-','');
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');await setupImageDemo(pool);
  const conversationId=randomUUID(),ctx={storeId:demoCatalogStore,conversationId,actor:'ambiguity-test',role:'customer' as const};
  await pool.query('INSERT INTO conversations(id,store_id,actor,visual_ordering) VALUES($1,$2,$3,true)',[conversationId,ctx.storeId,ctx.actor]);
  const client=await pool.connect();
  try{
   for(const query of ['pipe','water pipe','1 inch pipe','water pumping pipe','pipe for pumping water','water pump hose pipe','motor hose','தண்ணீர் பைப்']){
    assert.equal(needsPipeType(query),true,query);
    for(const familyId of ['pvc-pipes','hose']){
     const found=await discoverProducts(client,ctx,query,{keywords:[query,'PVC pipe','garden hose'],familyId});
     assert.deepEqual(found.products,[],`${query} with ${familyId} hint`);
     assert.equal(found.noExactMatch,true);
    }
   }
   // Publishing a real pump product makes its exact curated name/alias eligible.
   await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,version,aliases,quantity_step,active,family_id) VALUES($1,'PUMP1','BSA Rubber Suction Pipe','piece',99000,10,1,'[\"water pumping pipe\"]',1,true,'hose')",[ctx.storeId]);
   const supplied=await discoverProducts(client,ctx,'water pumping pipe');assert.equal(supplied.products[0]?.sku,'PUMP1');
   await pool.query("DELETE FROM products WHERE store_id=$1 AND sku='PUMP1'",[ctx.storeId]);
   for(const [query,familyId] of [['1 inch PVC pipe','pvc-pipes'],['garden hose','hose']] as const){
    assert.equal(needsPipeType(query),false);
    const found=await discoverProducts(client,ctx,query);
    assert.ok(found.products.length>0,query);
    assert.ok(found.products.every(p=>p.familyId===familyId),query);
   }
   for(const query of ['pipe solvent','pipe cement','pipe adhesive','pipe glue','பைப் சால்வென்ட்'])assert.equal(needsPipeType(query),false,query);
   // A generic solvent may mean paint thinner or PVC cement. A model's
   // guessed family must not turn this into an automatic product match.
   for(const query of ['solvent','சால்வென்ட்']){
    const found=await discoverProducts(client,ctx,query,{keywords:[query],familyId:'pvc-pipes'});
    assert.deepEqual(found.products,[],query);
    assert.equal(found.matchStatus,'needs_detail',query);
    assert.ok(found.diagnostics?.uncertainty.includes('solvent_use_required'),query);
    const guessed=await discoverProducts(client,ctx,query,{keywords:[query],selectedSkus:['H07']});
    assert.deepEqual(guessed.products,[],`${query} with an AI-suggested SKU`);
    assert.equal(guessed.matchStatus,'needs_detail');
   }
   // A request for an adhesive used on pipe is not a request for the pipe itself.
   // Its actual catalog search should remain eligible, without guessing a pipe type.
   for(const query of ['pipe solvent','pipe cement','pipe glue']){
    const found=await discoverProducts(client,ctx,query);
    assert.ok(found.products.some(p=>p.sku==='H07'),query);
    assert.ok(!found.diagnostics?.uncertainty.includes('pipe_type_required'),query);
   }
  }finally{client.release();}
  const tools=new RetailTools(pool);
  let result=await tools.invoke(ctx,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'1 inch water pumping pipe',quantity:2,productMeasures:[{value:1,unit:'inch'}],search:{keywords:['water pipe','PVC pipe'],familyId:'pvc-pipes'}}]}},randomUUID());
  assert.equal(result.state?.draft.length,1);
  assert.equal(result.state?.draft[0].quantity,2);
  assert.deepEqual(result.state?.draft[0].productMeasures,[{value:1,unit:'inch'}]);
  assert.equal(result.state?.draft[0].sku,undefined);
  assert.equal(result.state?.draft[0].resolution,'unavailable');
  result=await tools.invoke(ctx,{name:'preview_order',args:{expectedVersion:result.state!.version}},randomUUID());
  assert.match(result.message,/Which kind of pipe/);
  assert.match(result.message,/kept your requested quantity/);
  assert.equal(result.state?.pending?.kind,'question');
  const visible=visualReply({version:1,kind:'text',text:result.message,presentation:'text',outboundMessages:1},result.state!);
  assert.equal(visible.stage,'identify');
  assert.match(visible.text,/Which kind of pipe/);
  assert.equal(visible.parts,undefined);
  assert.equal(result.state!.draft[0].quantity,2,'the known count stays in the cart without repeating it in a category question');
  assert.match(visible.text,/1 inch/);
  assert.ok(!JSON.stringify(visible).includes('H13'));
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM order_requests WHERE conversation_id=$1',[conversationId])).rows[0].count,0);
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});

test('generic solvent asks its use before product approval and preserves the request',async()=>{
 const schema='solvent_clarification_'+randomUUID().replaceAll('-','');
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');await setupImageDemo(pool);
  const ctx={storeId:demoCatalogStore,conversationId:randomUUID(),actor:'solvent-flow',role:'customer' as const};
  await pool.query('INSERT INTO conversations(id,store_id,actor,visual_ordering) VALUES($1,$2,$3,true)',[ctx.conversationId,ctx.storeId,ctx.actor]);
  const tools=new RetailTools(pool);
  let result=await tools.invoke(ctx,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'solvent',quantity:1}]}},randomUUID());
  assert.equal(result.state?.draft[0].sku,undefined);
  result=await tools.invoke(ctx,{name:'preview_order',args:{expectedVersion:result.state!.version}},randomUUID());
  assert.equal(result.state?.pending?.kind,'question');
  assert.match(result.message,/joining PVC pipes or for thinning paint/);
  assert.equal(result.state?.draft[0].quantity,1);
  const visible=visualReply({version:1,kind:'text',text:result.message,presentation:'text',outboundMessages:1},result.state!);
  assert.match(visible.text,/joining PVC pipes or for thinning paint/);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM order_requests WHERE conversation_id=$1',[ctx.conversationId])).rows[0].count,0);
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
