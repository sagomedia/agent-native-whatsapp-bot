import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {reserveRequest,closeRequestStock,adjustStock,catalogStock} from '../apps/server/src/services/inventory.js';
import {productFromRow} from '../apps/server/src/services/catalog.js';
import {fixtureStore,fixtureConversation} from '../profiles/hardware.js';
import type {DraftLine} from '../packages/contracts/index.js';

async function fixture(run:(pool:pg.Pool,tx:<T>(fn:(c:pg.PoolClient)=>Promise<T>)=>Promise<T>,order:(lines:DraftLine[])=>Promise<string>)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='stock_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 const tx=async<T>(fn:(c:pg.PoolClient)=>Promise<T>)=>{const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 try{await setupDatabase(pool,'mock');
  const order=async(lines:DraftLine[])=>{const id=randomUUID();await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise) SELECT $1,store_id,id,actor,$2,$3::jsonb,1000 FROM conversations WHERE id=$4",[id,randomUUID(),JSON.stringify(lines),fixtureConversation]);return id;};
  await run(pool,tx,order);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
const line=(quantity=1,sku='INV',unit='piece'):DraftLine=>({id:randomUUID(),sku,name:'Fixture item',quantity,unit,pricePaise:1000,productVersion:1,resolution:'matched'});
async function product(pool:pg.Pool,stock:number|null=2,unit='piece',step=1){await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,quantity_step) VALUES($1,'INV','Fixture item',$2,1000,$3,$4)",[fixtureStore,unit,stock,step]);}
const row=async(pool:pg.Pool)=>(await pool.query("SELECT * FROM products WHERE store_id=$1 AND sku='INV'",[fixtureStore])).rows[0];

test('last-unit acceptance serializes, duplicate collection deducts once and photos keep their version',()=>fixture(async(pool,tx,order)=>{
 await product(pool,1);const a=[line()],b=[line()],ids=await Promise.all([order(a),order(b)]);
 const results=await Promise.allSettled(ids.map((id,i)=>tx(c=>reserveRequest(c,fixtureStore,id,[a,b][i],1,'owner'))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const winner=ids[results.findIndex(r=>r.status==='fulfilled')];
 let p=productFromRow(await row(pool));assert.equal(p.stock,0);assert.equal(p.stockOnHand,1);assert.equal(p.stockReserved,1);assert.equal(p.version,1);
 await tx(c=>closeRequestStock(c,fixtureStore,winner,'collect','owner'));await tx(c=>closeRequestStock(c,fixtureStore,winner,'collect','owner'));
 p=productFromRow(await row(pool));assert.equal(p.stockOnHand,0);assert.equal(p.stockReserved,0);assert.equal(p.version,1);
 assert.equal((await pool.query("SELECT * FROM inventory_movements WHERE kind='collect'")).rowCount,1);
}));
test('duplicate lines aggregate; changed orders adjust the hold; cancellation releases once',()=>fixture(async(pool,tx,order)=>{
 await product(pool,5);const lines=[line(1),line(2)],id=await order(lines);
 await tx(c=>reserveRequest(c,fixtureStore,id,lines,1,'owner'));assert.equal(productFromRow(await row(pool)).stock,2);
 await tx(c=>reserveRequest(c,fixtureStore,id,[{...lines[0],quantity:4}],2,'owner'));assert.equal(productFromRow(await row(pool)).stock,1);
 await assert.rejects(tx(c=>reserveRequest(c,fixtureStore,id,[{...lines[0],quantity:6}],3,'owner')),/not enough/);
 assert.equal(productFromRow(await row(pool)).stockReserved,4);
 await tx(c=>reserveRequest(c,fixtureStore,id,[{...lines[0],quantity:2}],3,'owner'));assert.equal(productFromRow(await row(pool)).stockReserved,2);
 await tx(c=>closeRequestStock(c,fixtureStore,id,'release','owner'));await tx(c=>closeRequestStock(c,fixtureStore,id,'release','owner'));
 assert.equal(productFromRow(await row(pool)).stockOnHand,5);assert.equal(productFromRow(await row(pool)).stockReserved,0);
 assert.equal((await pool.query("SELECT * FROM inventory_movements WHERE operation_key LIKE '%:release:%'")).rowCount,1);
}));
test('unknown stock and manual lines remain untracked; legacy orders never deduct automatically',()=>fixture(async(pool,tx,order)=>{
 await product(pool,null);const lines=[line(),{...line(),sku:undefined}],id=await order(lines);
 await tx(c=>reserveRequest(c,fixtureStore,id,lines,1,'owner'));assert.equal((await pool.query('SELECT inventory_state FROM order_requests WHERE id=$1',[id])).rows[0].inventory_state,'untracked');
 assert.equal(productFromRow(await row(pool)).stock,null);assert.equal((await pool.query('SELECT * FROM inventory_movements')).rowCount,0);
 await pool.query("UPDATE products SET stock=5 WHERE sku='INV'");await pool.query("UPDATE order_requests SET inventory_state='legacy' WHERE id=$1",[id]);
 await tx(c=>reserveRequest(c,fixtureStore,id,lines,2,'owner'));await tx(c=>closeRequestStock(c,fixtureStore,id,'collect','owner'));
 assert.equal(productFromRow(await row(pool)).stockOnHand,5);assert.equal((await pool.query('SELECT * FROM inventory_movements')).rowCount,0);
 await tx(c=>reserveRequest(c,fixtureStore,id,lines,2,'owner',true));assert.equal(productFromRow(await row(pool)).stockReserved,1);
}));
test('measured quantities stay exact, walk-in sales cannot consume holds and stale counts cannot overwrite them',()=>fixture(async(pool,tx,order)=>{
 await product(pool,1,'metre',0.1);const lines=[line(0.3,'INV','metre')],id=await order(lines);await tx(c=>reserveRequest(c,fixtureStore,id,lines,1,'owner'));
 const action={id:randomUUID(),kind:'sale' as const,quantity:0.7,expectedVersion:2,reason:'Counter receipt 12'};
 await tx(c=>adjustStock(c,fixtureStore,'INV','owner',action));await tx(c=>adjustStock(c,fixtureStore,'INV','owner',action));
 assert.equal(productFromRow(await row(pool)).stockOnHand,0.3);assert.equal(productFromRow(await row(pool)).stock,0);
 await assert.rejects(tx(c=>adjustStock(c,fixtureStore,'INV','owner',{...action,quantity:0.6})),/different details/);
 await assert.rejects(tx(c=>adjustStock(c,fixtureStore,'INV','owner',{...action,id:randomUUID(),expectedVersion:3,quantity:0.1})),/reserved/);
 await assert.rejects(tx(c=>catalogStock(c,fixtureStore,'INV',1,1,2)),/Stock changed/);
 await assert.rejects(tx(c=>adjustStock(c,fixtureStore,'INV','owner',{...action,id:randomUUID(),kind:'count',expectedVersion:3,quantity:0.2})),/reserved/);
 await tx(c=>closeRequestStock(c,fixtureStore,id,'collect','owner'));assert.equal(productFromRow(await row(pool)).stockOnHand,0);
 assert.equal((await pool.query("SELECT * FROM inventory_movements WHERE kind='sale'")).rowCount,1);
}));
test('inventory rejects stale product facts and incompatible unit increments before any movement',()=>fixture(async(pool,tx,order)=>{
 await product(pool,5);const l=line(),id=await order([l]);
 await assert.rejects(tx(c=>reserveRequest(c,fixtureStore,id,[{...l,unit:'kg'}],1,'owner')),/unit/);
 await assert.rejects(tx(c=>reserveRequest(c,fixtureStore,id,[{...l,quantity:0.5}],1,'owner')),/increment/);
 await assert.rejects(tx(c=>reserveRequest(c,fixtureStore,id,[{...l,productVersion:2}],1,'owner')),/catalog details/i);
 assert.equal((await pool.query('SELECT * FROM inventory_movements')).rowCount,0);
}));
