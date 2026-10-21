import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {previewReviewLater,applyReviewLater} from '../apps/server/src/services/catalog-review-later.js';
import {saveCatalogProduct,saveReviewLaterCatalogProduct} from '../apps/server/src/services/catalog-products.js';
import {catalogWrite,createProposal,updateProposal} from '../apps/server/src/services/catalog-proposals.js';
const authorization={ownerAuthorized:true} as const;
const verification={identity:false,photo:false,sellingUnit:false,price:false,stock:false};
const actor='authorized-fixture-owner';
const details=(sku:string)=>({sku,name:'Fixture brass adaptor '+sku,localNames:{ta:'பித்தளை இணைப்பு','ta-Latn':'pithalai inaippu'},aliases:['fixture adaptor'],keywords:['brass','fixture'],unit:'piece',quantityStep:1,pricePaise:0,priceStatus:'confirm',stock:null,familyId:'',brand:'Fixture brand',specifications:{size:'20 mm'},sellingPolicy:{cutAllowed:false,continuousLengthAvailable:null}});
async function fixture(run:(pool:pg.Pool)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='review_later_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');await run(pool);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
async function seed(pool:pg.Pool,count:number,prefix='LATER'){
 const d=details(prefix);
 return (await pool.query(`INSERT INTO catalog_proposals(id,store_id,batch_id,client_item_id,input_hash,details,provenance,actor)
 SELECT gen_random_uuid(),$1,$2,n::text,'fixture-source-hash', $3::jsonb||jsonb_build_object('sku',$2||'-'||lpad(n::text,4,'0'),'name','Fixture brass adaptor '||n),$4::jsonb,$5 FROM generate_series(1,$6::int) n RETURNING *`,[fixtureStore,prefix,JSON.stringify(d),JSON.stringify({source:'owner-provided fixture source',issues:['Stock and price need owner review','Photo identity pending']}),actor,count])).rows;
}

test('all 296 current drafts become active products without fabricating facts or approving staged photos; metadata and originals survive retry',()=>fixture(async pool=>{
 const drafts=await seed(pool,296),first=drafts[0],known=drafts[1];
 await pool.query("UPDATE catalog_proposals SET details=details||'{\"pricePaise\":12345,\"priceStatus\":\"priced\",\"stock\":7}'::jsonb WHERE id=$1",[known.id]);
 const bytes=Buffer.from('original private fixture bytes'),sha=createHash('sha256').update(bytes).digest('hex');
 for(const [i,kind] of ['unconfirmed','family_only','exact'].entries())await pool.query('INSERT INTO catalog_proposal_assets(id,store_id,proposal_id,original,mime_type,sha256,image,width,height,match_kind) VALUES($1,$2,$3,$4,$5,$6,$4,1,1,$7)',[randomUUID(),fixtureStore,drafts[i].id,bytes,'image/jpeg',sha,kind]);
 const before=(await pool.query('SELECT count(*)::int AS count FROM products WHERE store_id=$1',[fixtureStore])).rows[0].count;
 const preserved=(await pool.query('SELECT id,details,provenance FROM catalog_proposals ORDER BY id')).rows;
 const auditBefore=(await pool.query('SELECT count(*)::int AS count FROM owner_audit')).rows[0].count;
 const snapshot=await previewReviewLater(pool,fixtureStore);assert.equal(snapshot.items.length,296);assert.ok(snapshot.items.every(i=>i.status==='ready'));
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM owner_audit')).rows[0].count,auditBefore);
 assert.equal((await pool.query("SELECT count(*)::int AS count FROM catalog_proposals WHERE state='draft'")).rows[0].count,296);
 const result=await applyReviewLater(pool,fixtureStore,actor,snapshot,authorization);assert.equal(result.published,296);assert.equal(result.conflicts,0,JSON.stringify(result.results.filter(r=>r.status==='conflict')));
 const products=(await pool.query("SELECT * FROM products WHERE store_id=$1 AND sku LIKE 'LATER-%' ORDER BY sku",[fixtureStore])).rows;assert.equal(products.length,296);
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM products WHERE store_id=$1',[fixtureStore])).rows[0].count,before+296);
 for(const p of products){assert.equal(p.active,true);assert.equal(p.selling_unit_verified,false);assert.deepEqual(p.merchant_verification,verification);assert.equal(p.image_path,null);assert.deepEqual(p.local_names,first.details.localNames);assert.ok(p.aliases.includes('fixture adaptor'));assert.deepEqual(p.keywords,first.details.keywords);assert.deepEqual(p.specifications,first.details.specifications);assert.equal(p.brand,'Fixture brand');assert.equal(p.unit,'piece');assert.equal(Number(p.quantity_step),1);assert.deepEqual(p.selling_policy,first.details.sellingPolicy);if(p.sku===known.details.sku){assert.equal(p.price_paise,12345);assert.equal(p.price_status,'priced');assert.equal(Number(p.stock),7);}else{assert.equal(p.price_paise,0);assert.equal(p.price_status,'confirm');assert.equal(p.stock,null);}}
 assert.deepEqual((await pool.query('SELECT id,details,provenance FROM catalog_proposals ORDER BY id')).rows,preserved);
 for(const p of (await pool.query('SELECT original,sha256,match_kind FROM catalog_proposal_assets')).rows){assert.ok(p.original.equals(bytes));assert.equal(p.sha256,sha);}
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM catalog_proposals WHERE state='published'")).rows[0].n,296);
 const audits=(await pool.query("SELECT details FROM owner_audit WHERE action='catalog_review_later_publish'")).rows;assert.equal(audits.length,296);assert.ok(audits.every(a=>a.details.reviewPending&&a.details.photosHeld&&a.details.snapshotId===snapshot.snapshotId));
 const revision=(await pool.query('SELECT catalog_revision FROM stores WHERE id=$1',[fixtureStore])).rows[0].catalog_revision;
 const replay=await applyReviewLater(pool,fixtureStore,actor,snapshot,authorization);assert.equal(replay.alreadyPublished,296);assert.equal(replay.published,0);assert.equal(replay.conflicts,0);
 assert.equal((await pool.query('SELECT catalog_revision FROM stores WHERE id=$1',[fixtureStore])).rows[0].catalog_revision,revision);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM owner_audit WHERE action='catalog_review_later_publish'")).rows[0].n,296);
}));

test('review later handles 1200 new drafts in one bounded snapshot without a page limit',()=>fixture(async pool=>{
 await seed(pool,1200,'SCALE-LATER');const snapshot=await previewReviewLater(pool,fixtureStore);assert.equal(snapshot.items.length,1200);
 const report=await applyReviewLater(pool,fixtureStore,actor,snapshot,authorization);assert.equal(report.published,1200);assert.equal(report.conflicts,0);assert.equal(report.blocked,0);
}));

test('stale sources, collisions, existing-product edits, missing units and foreign shops never overwrite products; partial retry is idempotent',()=>fixture(async pool=>{
 const drafts=await seed(pool,6,'CONFLICT-LATER'),[stale,collision,base,missing,good,duplicate]=drafts;
 const product=(await pool.query('SELECT * FROM products WHERE store_id=$1 ORDER BY sku LIMIT 1',[fixtureStore])).rows[0];
 await pool.query('UPDATE catalog_proposals SET base_sku=$2,base_version=$3 WHERE id=$1',[base.id,product.sku,product.version]);
 await pool.query("UPDATE catalog_proposals SET details=details-'unit' WHERE id=$1",[missing.id]);
 await pool.query("UPDATE catalog_proposals SET details=jsonb_set(details,'{sku}',$2::jsonb) WHERE id=$1",[duplicate.id,JSON.stringify(product.sku)]);
 const snapshot=await previewReviewLater(pool,fixtureStore);assert.equal(snapshot.items.find(i=>i.id===base.id)?.status,'blocked');assert.equal(snapshot.items.find(i=>i.id===missing.id)?.status,'blocked');assert.equal(snapshot.items.find(i=>i.id===duplicate.id)?.status,'blocked');
 await catalogWrite(pool,fixtureStore,actor,'test_update',stale.id,c=>updateProposal(c,fixtureStore,{id:stale.id,version:1,details:{...stale.details,name:'Edited after preview'}}));
 // A new product can claim an otherwise clear code after preview.
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise) VALUES($1,$2,'Must preserve collision','piece',999)",[fixtureStore,collision.details.sku]);
 const report=await applyReviewLater(pool,fixtureStore,actor,snapshot,authorization);assert.equal(report.published,1);assert.equal(report.blocked,3);assert.equal(report.conflicts,2);
 assert.equal((await pool.query('SELECT name FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,collision.details.sku])).rows[0].name,'Must preserve collision');
 assert.deepEqual((await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,product.sku])).rows[0],product);
 assert.equal((await pool.query('SELECT state FROM catalog_proposals WHERE id=$1',[base.id])).rows[0].state,'draft');
 const retry=await applyReviewLater(pool,fixtureStore,actor,snapshot,authorization);assert.equal(retry.alreadyPublished,1);assert.equal(retry.conflicts,2);assert.equal(retry.published,0);
 const foreign=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Foreign fixture',true)",[foreign]);
 await assert.rejects(applyReviewLater(pool,foreign,actor,snapshot,authorization),/another shop/);
 const forged={...snapshot,storeId:foreign};const denied=await applyReviewLater(pool,foreign,actor,forged,authorization);assert.equal(denied.published,0);assert.equal(denied.conflicts,3);
 await assert.rejects(applyReviewLater(pool,fixtureStore,actor,snapshot,{ownerAuthorized:false} as any),/owner authorization/);
 // A mutated snapshot cannot reuse the successful item's audit as approval.
 const tampered={...snapshot,items:snapshot.items.map(i=>i.id===good.id?{...i,sourceHash:'0'.repeat(64)}:i)};
 assert.equal((await applyReviewLater(pool,fixtureStore,actor,tampered,authorization)).results.find(r=>r.id===good.id)?.status,'conflict');
}));

test('public saves still require verification; trusted helper rejects edits and snapshots reject duplicated IDs/codes',()=>fixture(async pool=>{
 const product={...details('UNVERIFIED'),version:0,active:true,verified:false,verification};
 await assert.rejects(catalogWrite(pool,fixtureStore,actor,'strict_save',randomUUID(),c=>saveCatalogProduct(c,fixtureStore,product)),/Confirm identity/);
 await assert.rejects(catalogWrite(pool,fixtureStore,actor,'strict_edit',randomUUID(),c=>saveReviewLaterCatalogProduct(c,fixtureStore,{...product,version:1})),/only creates new/);
 const first={id:randomUUID(),batchId:'manual',clientItemId:'one',details:details('SAME-CODE'),provenance:{source:'fixture',issues:[]}};
 await catalogWrite(pool,fixtureStore,actor,'fixture',first.id,c=>createProposal(c,fixtureStore,actor,first));
 const second={...first,id:randomUUID(),clientItemId:'two'};await catalogWrite(pool,fixtureStore,actor,'fixture',second.id,c=>createProposal(c,fixtureStore,actor,second));
 const snapshot=await previewReviewLater(pool,fixtureStore);assert.equal(snapshot.items.length,2);assert.ok(snapshot.items.every(i=>i.status==='blocked'));
 const edited={...snapshot,items:snapshot.items.map(i=>({...i,status:'ready',issues:[]}))};const report=await applyReviewLater(pool,fixtureStore,actor,edited,authorization);assert.equal(report.blocked,2);assert.equal(report.published,0);
 await assert.rejects(applyReviewLater(pool,fixtureStore,actor,{...snapshot,items:[snapshot.items[0],snapshot.items[0]]},authorization),/repeats a draft/);
}));
