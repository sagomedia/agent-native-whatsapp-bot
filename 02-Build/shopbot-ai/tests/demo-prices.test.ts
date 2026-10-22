import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {prepareDemoPrices} from '../apps/server/src/services/demo-prices.js';
const price={pricePaise:10000,lowPaise:7000,highPaise:14000,unit:'piece',currency:'INR',asOf:'2026-10-18',source:'model-low-indicative',generation:{model:'offline-fixture',effort:'low',inputHash:'a'.repeat(64),proposalHash:'b'.repeat(64)}};

test('explicit demo price preparation previews without writes, checks stale versions, audits provenance and rejects real stores',async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='demo_price_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');
  await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,price_status,stock,indicative_price) VALUES($1,'DEMO','Demo item','piece',0,'confirm',NULL,$2),($1,'MISMATCH','Unit mismatch','box',0,'confirm',NULL,$2),($1,'PRICED','Existing price','piece',25000,'priced',NULL,$2)",[fixtureStore,price]);
  let plan=await prepareDemoPrices(pool,fixtureStore,'offline-test');
  assert.equal(plan.applied,false);assert.equal(plan.planned,1);assert.equal(plan.skipped[0].sku,'MISMATCH');
  assert.equal((await pool.query("SELECT price_paise FROM products WHERE sku='DEMO'")).rows[0].price_paise,0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM owner_audit WHERE action='demo_prices_prepare'")).rows[0].n,0);
  await assert.rejects(prepareDemoPrices(pool,fixtureStore,'offline-test',{apply:true}),/hash from a dry run/);
  await pool.query("UPDATE products SET version=version+1 WHERE sku='DEMO'");
  await assert.rejects(prepareDemoPrices(pool,fixtureStore,'offline-test',{apply:true,expectedPlanHash:plan.planHash}),/plan changed/);
  plan=await prepareDemoPrices(pool,fixtureStore,'offline-test');
  const applied=await prepareDemoPrices(pool,fixtureStore,'offline-test',{apply:true,expectedPlanHash:plan.planHash});
  assert.equal(applied.updated,1);
  const row=(await pool.query("SELECT * FROM products WHERE sku='DEMO'")).rows[0];
  assert.equal(row.price_paise,10000);assert.equal(row.price_status,'priced');assert.equal(row.version,3);assert.equal(row.indicative_price,null);
  assert.equal(row.merchant_verification.price,false);assert.equal(row.stock,null);
  const audit=(await pool.query("SELECT details FROM owner_audit WHERE action='demo_prices_prepare'")).rows[0];
  assert.deepEqual(audit.details.updates[0].source,price);
  assert.equal((await pool.query("SELECT price_paise FROM products WHERE sku='PRICED'")).rows[0].price_paise,25000);
  assert.equal((await prepareDemoPrices(pool,fixtureStore,'offline-test')).planned,0);
  await pool.query("UPDATE stores SET synthetic='false' WHERE id=$1",[fixtureStore]);
  await assert.rejects(prepareDemoPrices(pool,fixtureStore,'offline-test'),/exact synthetic/);
  await assert.rejects(prepareDemoPrices(pool,fixtureStore,'offline-test',{apply:true,expectedPlanHash:plan.planHash}),/exact synthetic/);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
