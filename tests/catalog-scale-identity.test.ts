import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {discoverProducts} from '../apps/server/src/services/catalog-discovery.js';
import type {ActorContext} from '../apps/server/src/services/context.js';

async function fixture(run:(client:pg.PoolClient,ctx:ActorContext)=>Promise<void>){
 const schema='scale_identity_'+randomUUID().replaceAll('-','');
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');
  const storeId=randomUUID();
  await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Scale identity fixture','true')",[storeId]);
  await pool.query("INSERT INTO catalog_profiles(store_id,store_type) VALUES($1,'hardware')",[storeId]);
  await pool.query("INSERT INTO catalog_nodes(store_id,id,kind,label,aliases) VALUES($1,'hardware','department','Hardware','[]')",[storeId]);
  for(const [id,label,aliases] of [['locks','Mortise locks',['mortise lock','door lock']],['exterior-paint','Exterior wall paint',['exterior paint','weather paint']]] as const){
   await pool.query("INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,aliases) VALUES($1,$2,'hardware','family',$3,$4)",[storeId,id,label,JSON.stringify(aliases)]);
  }
  const client=await pool.connect();
  try{await run(client,{storeId,conversationId:randomUUID(),actor:'scale-test',role:'customer'});}finally{client.release();}
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}

test('exact names and SKUs keep priority over shared aliases among crowded variants',()=>fixture(async(c,ctx)=>{
 const name='Godrej Mortise Door Lock 3 Lever';
 await c.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,brand,specifications,aliases) VALUES($1,'Z-EXACT',$2,'piece',0,NULL,'locks','Godrej','{\"levers\":\"3\"}','[]')",[ctx.storeId,name]);
 await c.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,brand,specifications,aliases)
 SELECT $1,'A-'||lpad(n::text,4,'0'),'Godrej Mortise Door Lock variant '||n,'piece',0,NULL,'locks','Godrej',jsonb_build_object('levers','7'),jsonb_build_array($2::text,'Z-EXACT') FROM generate_series(1,150) n`,[ctx.storeId,name]);
 for(const query of [name,'Z-EXACT']){
  const found=await discoverProducts(c,ctx,query);
  assert.equal(found.products[0]?.sku,'Z-EXACT',query);
  assert.ok(found.products.every(p=>p.specifications?.levers==='3'));
 }
 for(const search of [{keywords:[name],brand:'Other brand'},{keywords:[name],familyId:'exterior-paint'},{keywords:[name],specifications:{levers:'7'}}]){
  const found=await discoverProducts(c,ctx,name,search);
  assert.ok(!found.products.some(p=>p.sku==='Z-EXACT'),'exact identity must still obey explicit filters');
 }
}));

test('duplicate exact names stay ambiguous and a shared pipe alias cannot invent a unique pipe type',()=>fixture(async(c,ctx)=>{
 const name='Godrej Mortise Door Lock 3 Lever';
 for(const sku of ['LOCK-A','LOCK-B'])await c.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,brand,aliases) VALUES($1,$2,$3,'piece',0,NULL,'locks','Godrej','[\"water pumping pipe\"]')",[ctx.storeId,sku,name]);
 const found=await discoverProducts(c,ctx,name);
 assert.deepEqual(found.products.map(p=>p.sku).sort(),['LOCK-A','LOCK-B']);
 const pipe=await discoverProducts(c,ctx,'water pumping pipe');
 assert.deepEqual(pipe.products,[]);
}));

test('equivalent litre spellings find the same paint without changing its pack size or physical unit',()=>fixture(async(c,ctx)=>{
 for(const [sku,size,unit] of [['PAINT-4','4 L','can'],['PAINT-40','40 L','can'],['PAINT-KG','4 kg','bucket']] as const){
  await c.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,brand,specifications,aliases,keywords)
  VALUES($1,$2,$3,$4,0,NULL,'exterior-paint','Asian Paints',jsonb_build_object('size',$5::text),$6,'["exterior wall paint","weatherproof paint"]')`,[ctx.storeId,sku,'Asian Paints Apex Ultima Exterior Emulsion '+size+' (White)',unit,size,JSON.stringify(['Apex Ultima','Ultima exterior '+size,'Asian Paints Apex','Apex '+size])]);
 }
 for(const size of ['4L','4 L','4 litre','4 litres','4 liter','4 liters','4 ltr']){
  const found=await discoverProducts(c,ctx,'Asian Paints Apex Ultima '+size);
  assert.deepEqual(found.products.map(p=>p.sku),['PAINT-4'],size);
 }
 await c.query("UPDATE products SET aliases=aliases||'[\"Asian Paints Apex Ultima 4L\"]'::jsonb WHERE store_id=$1 AND sku='PAINT-KG'",[ctx.storeId]);
 const misleading=await discoverProducts(c,ctx,'Asian Paints Apex Ultima 4L');
 assert.deepEqual(misleading.products.map(p=>p.sku),['PAINT-4'],'a misleading alias must not override pack facts');
 const conflict=await discoverProducts(c,ctx,'Asian Paints Apex Ultima 4L',{keywords:['Apex Ultima'],specifications:{size:'4 kg'}});
 assert.deepEqual(conflict.products,[],'a conflicting filter must not turn litres into kilograms');
 const kg=await discoverProducts(c,ctx,'Asian Paints Apex Ultima 4 kg');
 assert.deepEqual(kg.products.map(p=>p.sku),['PAINT-KG']);
}));
