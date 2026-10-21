import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {previewReferencePhotos,applyReferencePhotos} from '../apps/server/src/services/catalog-reference-photos.js';
const actor='authorized-reference-photo-owner',authorization={ownerAuthorized:true} as const;
const raw=Buffer.from('private original with metadata, never served'),image=Buffer.from([255,216,255,224,0,0,255,217]);
const imageHash=createHash('sha256').update(raw).digest('hex'),sourceHash='a'.repeat(64);
async function fixture(run:(pool:pg.Pool)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='reference_photo_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');await run(pool);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
async function seed(pool:pg.Pool,count=1,batchId='reference-import'){
 const entries=Array.from({length:count},(_,i)=>({sourceSku:`SOURCE-${i}`,canonicalSku:`REFERENCE-${batchId}-${i}`,image:{matchKind:'unconfirmed',mimeType:'image/jpeg'},imageHash}));
 await pool.query('INSERT INTO catalog_intake_batches(store_id,batch_id,source_hash,manifest) VALUES($1,$2,$3,$4)',[fixtureStore,batchId,sourceHash,JSON.stringify({entries,mapping:{exclusions:[]}})]);
 const result=[];
 for(const [index,entry] of entries.entries()){
  const proposalId=randomUUID(),assetId=randomUUID(),sku=entry.canonicalSku;
  await pool.query(`INSERT INTO products(store_id,sku,name,unit,quantity_step,price_paise,price_status,stock,active,version,merchant_verification,selling_unit_verified,selling_policy) VALUES($1,$2,'Reference fixture','metre',0.5,4321,'priced',12.5,true,7,$3,true,$4)`,[fixtureStore,sku,JSON.stringify({identity:true,photo:true,sellingUnit:true,price:true,stock:true}),JSON.stringify({cutAllowed:true,continuousLengthAvailable:true})]);
  await pool.query("INSERT INTO catalog_proposals(id,store_id,batch_id,client_item_id,input_hash,details,provenance,actor,state,published_sku,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'published',$9,3)",[proposalId,fixtureStore,batchId,entry.sourceSku,'b'.repeat(64),JSON.stringify({sku,name:'Reference fixture'}),JSON.stringify({source:'Explicit catalog import fixture',sourceHash,issues:['Identity requires review']}),actor,sku]);
  await pool.query("INSERT INTO catalog_intake_items(store_id,batch_id,source_sku,canonical_sku,input_hash,state,proposal_id,proposal_version) VALUES($1,$2,$3,$4,$5,'staged',$6,2)",[fixtureStore,batchId,entry.sourceSku,sku,'b'.repeat(64),proposalId]);
  await pool.query('INSERT INTO catalog_proposal_assets(id,store_id,proposal_id,original,mime_type,sha256,image,width,height,match_kind) VALUES($1,$2,$3,$4,$5,$6,$7,1,1,$8)',[assetId,fixtureStore,proposalId,raw,'image/jpeg',imageHash,image,index%2?'exact':'unconfirmed']);
  result.push({proposalId,assetId,sku});
 }return result;
}

test('reference publication uses normalized bytes, records before/after audit and preserves price, units, stock, activity and all other verification',()=>fixture(async pool=>{
 const [first,second]=await seed(pool,2),before=(await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,first.sku])).rows[0];
 const revision=(await pool.query('SELECT catalog_revision FROM stores WHERE id=$1',[fixtureStore])).rows[0].catalog_revision;
 const snapshot=await previewReferencePhotos(pool,fixtureStore,'reference-import');assert.equal(snapshot.items.length,2);assert.ok(snapshot.items.every(i=>i.status==='ready'));
 assert.equal((await pool.query('SELECT catalog_revision FROM stores WHERE id=$1',[fixtureStore])).rows[0].catalog_revision,revision);
 assert.equal((await pool.query("SELECT count(*)::int n FROM owner_audit WHERE action='catalog_reference_photo_publish'")).rows[0].n,0);
 const report=await applyReferencePhotos(pool,fixtureStore,actor,snapshot,authorization);assert.equal(report.published,2);assert.equal(report.conflicts,0,JSON.stringify(report));
 const after=(await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,first.sku])).rows[0];
 assert.match(after.image_path,/^\/catalog-images\/reference\/[a-f0-9-]{36}\.jpg$/);assert.equal(after.version,before.version+1);assert.deepEqual(after.merchant_verification,{...before.merchant_verification,photo:false});
 const expected={...before,image_path:after.image_path,version:after.version,merchant_verification:after.merchant_verification};assert.deepEqual(after,expected);
 const saved=(await pool.query('SELECT * FROM catalog_photos WHERE store_id=$1',[fixtureStore])).rows;assert.equal(saved.length,1,'identical normalized bytes are reused');assert.ok(saved[0].image.equals(image));assert.ok(!saved[0].image.equals(raw));
 assert.ok((await pool.query('SELECT original FROM catalog_proposal_assets WHERE id=$1',[first.assetId])).rows[0].original.equals(raw));
 const audits=(await pool.query("SELECT details FROM owner_audit WHERE action='catalog_reference_photo_publish'")).rows;assert.equal(audits.length,2);
 for(const {details:audit} of audits){assert.equal(audit.snapshotId,snapshot.snapshotId);assert.equal(audit.referenceOnly,true);assert.equal(audit.photoVerified,false);assert.match(audit.productHashBefore,/^[a-f0-9]{64}$/);assert.match(audit.productHashAfter,/^[a-f0-9]{64}$/);assert.notEqual(audit.productHashBefore,audit.productHashAfter);assert.equal(audit.productVersionBefore,7);assert.equal(audit.productVersionAfter,8);}
 // Owner later replaces/removes the reference. Replay preserves that choice.
 await pool.query("UPDATE products SET image_path='/catalog-images/custom/later-owner-photo.jpg',price_paise=9999,version=version+1 WHERE store_id=$1 AND sku=$2",[fixtureStore,first.sku]);
 await pool.query('UPDATE products SET image_path=NULL,version=version+1 WHERE store_id=$1 AND sku=$2',[fixtureStore,second.sku]);
 const later=(await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku=ANY($2::text[]) ORDER BY sku',[fixtureStore,[first.sku,second.sku]])).rows;
 const replay=await applyReferencePhotos(pool,fixtureStore,actor,snapshot,authorization);assert.equal(replay.alreadyPublished,2);assert.equal(replay.published,0);
 assert.deepEqual((await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku=ANY($2::text[]) ORDER BY sku',[fixtureStore,[first.sku,second.sku]])).rows,later);
 const forged={...snapshot,items:snapshot.items.map(i=>({...i,imageHash:'f'.repeat(64)}))};assert.equal((await applyReferencePhotos(pool,fixtureStore,actor,forged,authorization)).conflicts,2);
}));

test('holds, exclusions, absent catalog assets, existing images, private later uploads and other batches remain untouched',()=>fixture(async pool=>{
 const rows=await seed(pool,7),[held,excluded,absent,existing,privateUpload,good,inactive]=rows;
 await pool.query("UPDATE catalog_proposals SET provenance=jsonb_set(provenance,'{issues}',$2::jsonb) WHERE id=$1",[held.proposalId,JSON.stringify(['Image held: wrong size and identity mismatch'])]);
 await pool.query("UPDATE catalog_intake_batches SET manifest=jsonb_set(manifest,'{mapping,exclusions}',$2::jsonb) WHERE store_id=$1",[fixtureStore,JSON.stringify([{sourceSku:'SOURCE-1',reason:'wrong image'}])]);
 await pool.query('DELETE FROM catalog_proposal_assets WHERE id=ANY($1::uuid[])',[[absent.assetId,privateUpload.assetId]]);
 await pool.query("UPDATE products SET image_path='/demo-images/H01.jpg' WHERE store_id=$1 AND sku=$2",[fixtureStore,existing.sku]);
 await pool.query('INSERT INTO catalog_proposal_assets(id,store_id,proposal_id,original,mime_type,sha256,image,width,height,match_kind) VALUES($1,$2,$3,$4,$5,$6,$7,1,1,$8)',[randomUUID(),fixtureStore,privateUpload.proposalId,Buffer.from('customer original'),'image/jpeg','c'.repeat(64),image,'exact']);
 await pool.query('UPDATE products SET active=false WHERE store_id=$1 AND sku=$2',[fixtureStore,inactive.sku]);
 await seed(pool,1,'other-batch');
 const before=(await pool.query('SELECT * FROM products WHERE store_id=$1 ORDER BY sku',[fixtureStore])).rows;
 const snapshot=await previewReferencePhotos(pool,fixtureStore,'reference-import');assert.equal(snapshot.items.length,6);assert.equal(snapshot.items.filter(i=>i.status==='held').length,2);assert.equal(snapshot.items.filter(i=>i.status==='no_asset').length,2);assert.equal(snapshot.items.filter(i=>i.status==='existing_image').length,1);assert.equal(snapshot.items.find(i=>i.sku===good.sku)?.status,'ready');
 const report=await applyReferencePhotos(pool,fixtureStore,actor,snapshot,authorization);assert.equal(report.published,1);assert.equal(report.held,2);assert.equal(report.existingImage,1);assert.equal(report.noAsset,2);assert.equal(report.conflicts,0);
 assert.deepEqual((await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku<>$2 ORDER BY sku',[fixtureStore,good.sku])).rows,before.filter(p=>p.sku!==good.sku));
 // Changing held to ready cannot bypass provenance validation.
 const tampered={...snapshot,snapshotId:randomUUID(),items:snapshot.items.filter(i=>i.sku===held.sku).map(i=>({...i,status:'ready'}))};assert.equal((await applyReferencePhotos(pool,fixtureStore,actor,tampered,authorization)).conflicts,1);
}));

test('stale version, unversioned product edits, provenance edits and normalized byte changes conflict with no mutation',()=>fixture(async pool=>{
 const rows=await seed(pool,5),[version,product,provenance,asset,unchanged]=rows,snapshot=await previewReferencePhotos(pool,fixtureStore,'reference-import');
 await pool.query('UPDATE products SET version=version+1 WHERE store_id=$1 AND sku=$2',[fixtureStore,version.sku]);
 await pool.query('UPDATE products SET price_paise=11111 WHERE store_id=$1 AND sku=$2',[fixtureStore,product.sku]);
 await pool.query("UPDATE catalog_proposals SET provenance=provenance||'{\"issues\":[\"Image held: mismatch\"]}'::jsonb WHERE id=$1",[provenance.proposalId]);
 await pool.query('UPDATE catalog_proposal_assets SET image=$2 WHERE id=$1',[asset.assetId,Buffer.from([255,216,0,0,255,217])]);
 const before=(await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku<>$2 ORDER BY sku',[fixtureStore,unchanged.sku])).rows;
 const report=await applyReferencePhotos(pool,fixtureStore,actor,snapshot,authorization);assert.equal(report.conflicts,4);assert.equal(report.published,1);
 assert.deepEqual((await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku<>$2 ORDER BY sku',[fixtureStore,unchanged.sku])).rows,before);
 const foreign=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Foreign reference fixture',true)",[foreign]);
 await assert.rejects(applyReferencePhotos(pool,foreign,actor,snapshot,authorization),/another shop/);
 const forged={...snapshot,storeId:foreign};assert.equal((await applyReferencePhotos(pool,foreign,actor,forged,authorization)).published,0);
 await assert.rejects(applyReferencePhotos(pool,fixtureStore,actor,snapshot,{ownerAuthorized:false} as any),/owner authorization/);
 await assert.rejects(applyReferencePhotos(pool,fixtureStore,actor,{...snapshot,items:[snapshot.items[0],snapshot.items[0]]},authorization),/repeats/);
 await assert.rejects(previewReferencePhotos(pool,fixtureStore,'missing-batch'),/batch not found/);
}));

test('batch changes after snapshot invalidate ready rows before any image is saved',()=>fixture(async pool=>{
 await seed(pool);const snapshot=await previewReferencePhotos(pool,fixtureStore,'reference-import');
 await pool.query("UPDATE catalog_intake_batches SET manifest=manifest||'{\"changed\":true}'::jsonb WHERE store_id=$1",[fixtureStore]);
 const report=await applyReferencePhotos(pool,fixtureStore,actor,snapshot,authorization);assert.equal(report.conflicts,1);assert.equal(report.published,0);assert.equal((await pool.query('SELECT count(*)::int n FROM catalog_photos')).rows[0].n,0);
}));


test('native compiled CLI creates a private immutable preview, applies it and safely replays against PG17',()=>fixture(async pool=>{
 await seed(pool);const directory=await mkdtemp(join(tmpdir(),'reference-photos-cli-')),snapshotPath=join(directory,'snapshot.json');
 try{
  const database=new URL(process.env.DATABASE_URL!);database.searchParams.set('options',pool.options.options!);
  const cli=resolve('dist/scripts/publish-catalog-reference-photos.js'),args=['--batch=reference-import','--snapshot='+snapshotPath];
  const env={PATH:process.env.PATH,DATABASE_URL:database.toString(),SHOPBOT_CATALOG_STORE_ID:fixtureStore,SHOPBOT_CATALOG_ACTOR:actor};
  const run=(extra:string[]=[])=>promisify(execFile)(process.execPath,[cli,...args,...extra],{env,timeout:15000});
  const preview=JSON.parse((await run()).stdout);assert.equal(preview.ready,1);assert.equal(preview.published,0);assert.equal((await stat(snapshotPath)).mode&0o777,0o600);
  await assert.rejects(run(),/Command failed/,'existing snapshots cannot be overwritten');
  const applied=JSON.parse((await run(['--apply','--owner-authorized'])).stdout);assert.equal(applied.published,1);assert.equal(applied.conflicts,0);
  const replay=JSON.parse((await run(['--apply','--owner-authorized'])).stdout);assert.equal(replay.alreadyPublished,1);assert.equal(replay.published,0);
 }finally{await rm(directory,{recursive:true,force:true});}
}));
