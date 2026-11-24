import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {catalogCapacity} from '../apps/server/src/services/catalog-capacity.js';
import {saveCatalogPhoto} from '../apps/server/src/services/catalog-photos.js';
import {catalogWrite} from '../apps/server/src/services/catalog-proposals.js';

async function fixture(run:(pool:pg.Pool,store:string,other:string)=>Promise<void>){
 const schema='capacity_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');const store=randomUUID(),other=randomUUID();for(const id of [store,other])await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Capacity fixture','true')",[id]);await run(pool,store,other);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
const filesystem={path:'/explicit/test/volume',totalBytes:10*1024**3,availableBytes:300*1024**2};

test('identical published photo bytes reuse immutable assets only inside the same store',()=>fixture(async(pool,store,other)=>{
 const media={image:Buffer.from('synthetic-normalized-photo'),width:16,height:16};
 const save=(id:string,value=media)=>catalogWrite(pool,id,'fixture','test_photo',id,c=>saveCatalogPhoto(c,id,value));
 const first=await save(store),same=await save(store),foreign=await save(other),changed=await save(store,{...media,image:Buffer.from('different-bytes')});
 assert.equal(first,same);assert.notEqual(first,foreign);assert.notEqual(first,changed);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_photos WHERE store_id=$1',[store])).rows[0].n,2);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_photos WHERE store_id=$1 AND content_hash IS NOT NULL',[store])).rows[0].n,2);
}));

test('capacity uses store-scoped logical payloads, explicit assumptions and a conservative space gate without writes',()=>fixture(async(pool,store,other)=>{
 for(const id of [store,other])await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock) VALUES($1,'ITEM','Fixture','piece',0,NULL)",[id]);
 const photo={image:Buffer.alloc(1024),width:16,height:16};await catalogWrite(pool,store,'fixture','test_photo',store,c=>saveCatalogPhoto(c,store,photo));
 await catalogWrite(pool,other,'fixture','test_photo',other,c=>saveCatalogPhoto(c,other,{...photo,image:Buffer.alloc(8192)}));
 const before=Number((await pool.query('SELECT count(*) FROM owner_audit')).rows[0].count);
 const r=await catalogCapacity(pool,{storeId:store,filesystem,targetProducts:3000,sample:{bytes:300*180000,count:300}});
 assert.equal(r.products.total,1);assert.equal(r.publishedPhotos.bytes,1024);assert.equal(r.projection.additionalProducts,2999);assert.equal(r.projection.status,'insufficient_space');assert.equal(r.readOnly,true);assert.equal(r.projection.sampleSource,'supplied_final_photo_sample');assert.ok(r.unknowns.length>0);assert.equal(r.assumptions.deduplicationSavingsAssumed,false);
 assert.equal(Number((await pool.query('SELECT count(*) FROM owner_audit')).rows[0].count),before);
 assert.ok(!JSON.stringify(r).includes('password'));
}));

test('capacity reports missing photo sample as unknown and rejects invalid accounting inputs',()=>fixture(async(pool,store)=>{
 const r=await catalogCapacity(pool,{storeId:store,filesystem});assert.equal(r.projection.status,'capacity_unknown');assert.equal(r.projection.projectedAdditionalBytes,null);
 await assert.rejects(catalogCapacity(pool,{storeId:store,filesystem,sample:{bytes:1,count:0}}),/sample count/);
 await assert.rejects(catalogCapacity(pool,{storeId:store,filesystem:{...filesystem,availableBytes:filesystem.totalBytes+1}}),/available/);
 await assert.rejects(catalogCapacity(pool,{storeId:randomUUID(),filesystem}),/Store not found/);
}));
