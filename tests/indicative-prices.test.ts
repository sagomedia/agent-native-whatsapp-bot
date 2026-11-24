import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {indicativeProposalSchema,planIndicativePrices,snapshotIndicativePrices,applyIndicativePrices,type IndicativeSnapshot} from '../apps/server/src/services/indicative-prices.js';
import {indicativePriceFor,productPriceText} from '../packages/contracts/language.js';
import {buildProductCaption} from '../packages/contracts/channel-text.js';
import {productFromRow} from '../apps/server/src/services/catalog.js';
import {counterLine} from '../apps/server/src/services/counter-state.js';
import {estimateLines} from '../apps/server/src/services/order-estimate.js';
import type {DraftLine,Product} from '../packages/contracts/index.js';
const proposalHash='a'.repeat(64),inputHash='b'.repeat(64);
const item=(sku='IND-1')=>({sku,sourceVersion:1,unit:'piece',pricePaise:10000,lowPaise:7000,highPaise:14000,basis:'category_estimate' as const,sourceUrls:[],note:'Indicative category estimate; shop price pending.'});
const proposal=(items=[item()])=>indicativeProposalSchema.parse({kind:'indicative_demo_not_shop_verified',currency:'INR',asOf:'2026-10-18',generation:{model:'gpt-6',effort:'low',inputHash},items,sources:[]});
const snapshot=(rows:Partial<IndicativeSnapshot['rows'][number]>[]=[{}]):IndicativeSnapshot=>({schemaVersion:1,storeId:fixtureStore,proposalHash,inputHash,rows:rows.map((row,i)=>({sku:'IND-'+(i+1),name:'PVC pipe 20mm',unit:'piece',version:1,pricePaise:0,priceStatus:'confirm',merchantPriceVerified:false,sellingPolicy:null,specifications:{},indicativePrice:null,...row}))});

test('indicative prices display approximately and never satisfy exact quote/estimate eligibility',()=>{
 const info=planIndicativePrices(proposal(),proposalHash,snapshot()).updates[0].indicativePrice;
 assert.equal(info.source,'model-low-indicative');assert.equal(info.generation.requestedModel,'gpt-6-luna');assert.equal(info.generation.model,'gpt-6');
 const product:Product={sku:'IND-1',name:'PVC pipe',unit:'piece',pricePaise:0,priceStatus:'confirm',stock:null,version:1,aliases:[],quantityStep:1,indicativePrice:info};
 assert.equal(indicativePriceFor(product)?.pricePaise,10000);
 assert.match(productPriceText(product,'ta'),/^சுமார் ₹100.00/);
 const caption=buildProductCaption({...product,imageReference:true},'ta');assert.match(caption,/சுமார் ₹100.00/);assert.ok(caption.endsWith('Reference படம்'));assert.ok(Array.from(caption).length<=160);
 const line:DraftLine={id:randomUUID(),sku:product.sku,name:product.name,quantity:2,unit:product.unit,pricePaise:0,productVersion:1,candidates:[product],resolution:'matched'};
 assert.equal(counterLine(line).canQuote,false);assert.equal(estimateLines([line]).complete,false);assert.equal(estimateLines([line]).knownSubtotalPaise,0);
 assert.equal(indicativePriceFor({...product,unit:'box'}),undefined);
 assert.equal(indicativePriceFor({...product,pricePaise:15000,priceStatus:'priced'}),undefined);
 assert.ok(!productPriceText({...product,pricePaise:15000,priceStatus:'priced'},'ta').includes('சுமார்'));
 const mapped=productFromRow({sku:product.sku,name:product.name,unit:product.unit,price_paise:0,price_status:'confirm',stock:null,version:1,quantity_step:1,aliases:[],indicative_price:info});assert.equal(mapped.indicativePrice?.pricePaise,10000);
});

test('planning refuses stale source units/versions and invalid ranges; protects shop prices and skips unclear bases',()=>{
 assert.throws(()=>proposal([{...item(),lowPaise:11000}]),/low <= price <= high/);
 assert.throws(()=>proposal([{...item(),pricePaise:0}]),/number to be >0/);
 assert.throws(()=>planIndicativePrices(proposal(),proposalHash,snapshot([{version:2}])),/source version/);
 assert.throws(()=>planIndicativePrices(proposal(),proposalHash,snapshot([{unit:'box'}])),/selling unit/);
 for(const row of [{pricePaise:12000,priceStatus:'priced'},{merchantPriceVerified:true,pricePaise:12000}]){const plan=planIndicativePrices(proposal(),proposalHash,snapshot([row]));assert.equal(plan.updates.length,0);assert.equal(plan.skipped[0].reason,'existing_shop_price');}
 assert.equal(planIndicativePrices(proposal(),proposalHash,snapshot([{merchantPriceVerified:true}])).updates.length,1);
 const unclear=proposal([{...item(),pricePaise:null,lowPaise:null,highPaise:null,basis:'needs_unit_check'}] as any);
 assert.equal(planIndicativePrices(unclear,proposalHash,snapshot()).skipped[0].reason,'selling_unit_to_check');
 const unitMismatch=snapshot([{name:'Paint 10kg',unit:'litre'}]);const mismatchProposal=proposal([{...item(),unit:'litre'}]);assert.equal(planIndicativePrices(mismatchProposal,proposalHash,unitMismatch).updates.length,0);
});

test('isolated migration/import preserves shop truth, audits once, validates snapshots and rejects real stores',{skip:!process.env.DATABASE_URL},async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='indicative_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');await setupDatabase(pool,'mock');
  assert.equal((await pool.query('SELECT version FROM schema_migrations WHERE version=37')).rowCount,1);
  await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,price_status,stock) VALUES($1,'IND-1','PVC pipe 20mm','piece',0,'confirm',NULL),($1,'IND-2','Priced pipe','piece',15000,'priced',NULL)",[fixtureStore]);
  const p=proposal([item(),item('IND-2')]),before=await snapshotIndicativePrices(pool,fixtureStore,p,proposalHash);
  const revision=Number((await pool.query('SELECT catalog_revision FROM stores WHERE id=$1',[fixtureStore])).rows[0].catalog_revision);
  const first=await applyIndicativePrices(pool,fixtureStore,'offline-test',p,proposalHash,before);
  assert.equal(first.updated,1);assert.equal(first.replayed,false);
  const after=(await pool.query("SELECT * FROM products WHERE store_id=$1 AND sku='IND-1'",[fixtureStore])).rows[0];
  assert.equal(after.price_paise,0);assert.equal(after.price_status,'confirm');assert.equal(after.stock,null);assert.equal(after.merchant_verification.price,false);assert.equal(after.version,2);assert.equal(after.indicative_price.pricePaise,10000);
  assert.equal(Number((await pool.query('SELECT catalog_revision FROM stores WHERE id=$1',[fixtureStore])).rows[0].catalog_revision),revision+1);
  assert.equal((await applyIndicativePrices(pool,fixtureStore,'offline-test',p,proposalHash,JSON.parse(JSON.stringify(before)))).replayed,true);
  assert.equal((await pool.query("SELECT * FROM owner_audit WHERE action='indicative_price_import'")).rowCount,1);
  assert.equal((await pool.query("SELECT indicative_price FROM products WHERE sku='IND-2'")).rows[0].indicative_price,null);
  await assert.rejects(pool.query("UPDATE products SET indicative_price='{}' WHERE sku='IND-2'"),/products_indicative_price_check/);
  await assert.rejects(pool.query("UPDATE products SET indicative_price=jsonb_set(indicative_price,'{pricePaise}','null') WHERE sku='IND-1'"),/products_indicative_price_check/);
  await pool.query("UPDATE products SET version=version+1 WHERE sku='IND-1'");await assert.rejects(applyIndicativePrices(pool,fixtureStore,'offline-test',p,proposalHash,before),/snapshot changed/);
  assert.ok((await pool.query("SELECT indicative_price FROM products WHERE sku='IND-1'")).rows[0].indicative_price,'unrelated version changes do not alter the priced identity');
  await pool.query("UPDATE products SET name='Different pipe size' WHERE sku='IND-1'");
  assert.equal((await pool.query("SELECT indicative_price FROM products WHERE sku='IND-1'")).rows[0].indicative_price,null,'a changed identity cannot reuse the previous model price');
  await assert.rejects(applyIndicativePrices(pool,randomUUID(),'offline-test',p,proposalHash,before),/OWNER_STORE_ID/);
  await pool.query("UPDATE stores SET synthetic='false' WHERE id=$1",[fixtureStore]);await assert.rejects(snapshotIndicativePrices(pool,fixtureStore,p,proposalHash),/synthetic OWNER_STORE_ID/);
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
