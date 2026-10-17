import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {readBulkCatalogPackage,dryRunBulkCatalog,stageBulkCatalog,bulkCatalogStatus} from '../apps/server/src/services/catalog-package.js';

const database=process.env.DATABASE_URL;
if(!database)throw new Error('Bulk tests require an explicit isolated DATABASE_URL.');
const nodes=[{id:'bulk-dept',parentId:null,kind:'department',label:'Bulk fixtures',localNames:{},aliases:[]},{id:'bulk-family',parentId:'bulk-dept',kind:'family',label:'Bulk fixture products',localNames:{},aliases:[]}];
const row=(i:number)=>({sourceSku:`SOURCE-${String(i).padStart(5,'0')}`,details:{name:`Bulk fixture product ${i}`,familyId:'source-family',unit:'piece',quantityStep:1,pricePaise:0,priceStatus:'confirm',stock:null},provenance:{source:'Synthetic bulk test',issues:['Merchant confirmation pending']}});
async function source(count=3){
 const directory=await mkdtemp(join(tmpdir(),'shopbot-bulk-'));await mkdir(join(directory,'images'));
 const products={schemaVersion:2,currency:'INR',products:Array.from({length:count},(_,i)=>row(i))};
 const mapping={schemaVersion:1,skus:products.products.map((p,i)=>({sourceSku:p.sourceSku,canonicalSku:`BULK-${String(i).padStart(5,'0')}`,baseVersion:undefined as number|undefined})),families:[{sourceFamilyId:'source-family',canonicalFamilyId:'bulk-family'}],exclusions:[] as {sourceSku:string;reason:string}[]};
 const save=async()=>{await writeFile(join(directory,'products.json'),JSON.stringify(products));await writeFile(join(directory,'canonical-map.json'),JSON.stringify(mapping));await writeFile(join(directory,'catalog-map.json'),JSON.stringify({schemaVersion:1,nodes}));};
 await save();return {directory,products,mapping,save,cleanup:()=>rm(directory,{recursive:true,force:true})};
}
async function fixture(run:(pool:pg.Pool)=>Promise<void>){
 const schema='bulk_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:database});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:database,options:`-c search_path=${schema}`,max:4});
 try{await setupDatabase(pool,'mock');await run(pool);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
const stage=(pool:pg.Pool,directory:string,extra:{batchId?:string;maxItems?:number}={})=>stageBulkCatalog(pool,fixtureStore,'bulk-synthetic-test',directory,{batchId:'stable-bulk',chunkSize:17,...extra});

test('3000-item dry-run accounts for every source; bounded staging resumes and replay creates no duplicate drafts',{timeout:180000},()=>fixture(async pool=>{
 const s=await source(3000);try{
  const bundle=await readBulkCatalogPackage(s.directory),preview=await dryRunBulkCatalog(pool,fixtureStore,bundle,'stable-bulk');assert.equal(preview.new,3000);assert.equal(preview.effectiveUniqueCount,3000);assert.equal(preview.databaseChecked,true);
  const before=(await pool.query('SELECT count(*)::int AS n FROM products')).rows[0].n;assert.equal(preview.expectedCatalogUniqueCount,before+3000);assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_intake_batches')).rows[0].n,0);
  let status=await stage(pool,s.directory,{maxItems:17});assert.equal(status.counts.staged,17);assert.equal(status.counts.pending,2983);assert.equal(status.results.length,100);assert.ok(status.nextCursor);
  status=await stage(pool,s.directory);assert.deepEqual(status.counts,{staged:3000});assert.equal(status.published,0);
  const replay=await stage(pool,s.directory);assert.equal(replay.counts.staged,3000);assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_proposals')).rows[0].n,3000);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM products')).rows[0].n,before);
  const drafts=(await pool.query('SELECT details,provenance,state FROM catalog_proposals')).rows;for(const p of drafts){assert.equal(p.details.priceStatus,'confirm');assert.equal(p.details.pricePaise,0);assert.equal(p.details.stock,null);assert.equal(p.details.active,undefined);assert.equal(p.details.verified,undefined);assert.equal(p.state,'draft');assert.equal(p.provenance.sourceHash,bundle.hash);}
  const page2=await bulkCatalogStatus(pool,fixtureStore,'stable-bulk',replay.nextCursor,200);assert.equal(page2.results.length,200);assert.ok(page2.results[0].source_sku>replay.results.at(-1).source_sku);
 }finally{await s.cleanup();}
}));

test('partial SQL failure rolls back each item, resumes and respects reviewed proposal versions',{timeout:60000},()=>fixture(async pool=>{
 const s=await source();try{
  await writeFile(join(s.directory,'images','atomic.jpg'),await readFile('resources/catalog/ksmc-demo/images/H19.jpg'));Object.assign(s.products.products[1],{image:{path:'images/atomic.jpg',mimeType:'image/jpeg',matchKind:'exact'}});await s.save();
  await pool.query("CREATE FUNCTION reject_bulk_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_sku='SOURCE-00001' AND NEW.state='staged' THEN RAISE EXCEPTION 'temporary fixture failure'; END IF; RETURN NEW; END $$");
  await pool.query('CREATE TRIGGER reject_bulk_item BEFORE UPDATE ON catalog_intake_items FOR EACH ROW EXECUTE FUNCTION reject_bulk_item()');
  let status=await stage(pool,s.directory);assert.equal(status.counts.staged,2);assert.equal(status.counts.failed,1);assert.match(status.results.find((r:any)=>r.source_sku==='SOURCE-00001').error,/temporary fixture failure/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_proposal_assets')).rows[0].n,0);assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_proposals')).rows[0].n,2);
  await pool.query('DROP TRIGGER reject_bulk_item ON catalog_intake_items');status=await stage(pool,s.directory);assert.deepEqual(status.counts,{staged:3});
  const id=status.results[0].proposal_id;await pool.query("UPDATE catalog_proposals SET version=version+1,details=details||'{\"name\":\"Merchant reviewed name\"}'::jsonb WHERE id=$1",[id]);
  await Promise.all([stage(pool,s.directory),stage(pool,s.directory)]);assert.equal((await bulkCatalogStatus(pool,fixtureStore,'stable-bulk')).results.find((r:any)=>r.proposal_id===id).proposal_version,2);
  assert.equal((await pool.query('SELECT details FROM catalog_proposals WHERE id=$1',[id])).rows[0].details.name,'Merchant reviewed name');assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_proposals')).rows[0].n,3);
  s.products.products[0].details.name='Changed source';await s.save();await assert.rejects(stage(pool,s.directory),/Batch source changed/);await assert.rejects(dryRunBulkCatalog(pool,fixtureStore,await readBulkCatalogPackage(s.directory),'stable-bulk'),/Batch source changed/);
 }finally{await s.cleanup();}
}));

test('canonical SKU conflicts, exclusions, mapped families and verified facts remain explicit',()=>fixture(async pool=>{
 const s=await source(4);try{
  const prior=(await pool.query('SELECT * FROM products WHERE store_id=$1 ORDER BY sku LIMIT 1',[fixtureStore])).rows[0];
  await pool.query("INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label) VALUES($1,'merchant-family',NULL,'department','Merchant department'),($1,'merchant-type','merchant-family','family','Merchant verified type')",[fixtureStore]);prior.family_id='merchant-type';
  await pool.query("UPDATE products SET family_id='merchant-type',merchant_verification=$3,price_paise=77700,price_status='priced',stock=9,unit='piece',quantity_step=1 WHERE store_id=$1 AND sku=$2",[fixtureStore,prior.sku,JSON.stringify({identity:true,sellingUnit:true,price:true,stock:true,photo:true})]);
  s.mapping.skus[0].canonicalSku=prior.sku;
  s.mapping.exclusions=[{sourceSku:s.products.products[3].sourceSku,reason:'Confirmed duplicate of source row 2'}];s.mapping.skus.pop();await s.save();
  let preview=await dryRunBulkCatalog(pool,fixtureStore,await readBulkCatalogPackage(s.directory),'stable-bulk');assert.equal(preview.conflicts,1);assert.equal(preview.excluded,1);assert.equal(preview.effectiveUniqueCount,3);
  s.mapping.skus[0].baseVersion=prior.version;await s.save();preview=await dryRunBulkCatalog(pool,fixtureStore,await readBulkCatalogPackage(s.directory),'stable-bulk');assert.equal(preview.updates,1);
  const status=await stage(pool,s.directory);assert.equal(status.counts.staged,3);assert.equal(status.counts.excluded,1);
  const p=(await pool.query('SELECT * FROM catalog_proposals WHERE details->>\'sku\'=$1',[prior.sku])).rows[0];assert.equal(p.base_version,prior.version);assert.equal(p.details.pricePaise,77700);assert.equal(p.details.priceStatus,'priced');assert.equal(p.details.stock,9);assert.equal(p.details.inventoryVersion,prior.inventory_version);assert.equal(p.details.name,prior.name);assert.equal(p.details.familyId,prior.family_id);
  assert.equal((await pool.query('SELECT version FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,prior.sku])).rows[0].version,prior.version);
  await pool.query('UPDATE products SET version=version+1 WHERE store_id=$1 AND sku=$2',[fixtureStore,prior.sku]);
  const changed=await dryRunBulkCatalog(pool,fixtureStore,await readBulkCatalogPackage(s.directory),'new-review');assert.match(changed.results[0].reason!,/version changed/);
  const other=await stage(pool,s.directory,{batchId:'another-source'});assert.equal(other.counts.conflict,3);assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_proposals')).rows[0].n,3);
 }finally{await s.cleanup();}
}));

test('maps reject missing coverage, duplicate canonical targets, family gaps and fabricated source prices',async()=>{
 const s=await source();try{
  const original=s.mapping.skus[1].canonicalSku;s.mapping.skus[1].canonicalSku=s.mapping.skus[0].canonicalSku;await s.save();await assert.rejects(readBulkCatalogPackage(s.directory),/Canonical SKU targets/);s.mapping.skus[1].canonicalSku=original;
  const m=s.mapping.skus.pop()!;await s.save();await assert.rejects(readBulkCatalogPackage(s.directory),/exactly one/);s.mapping.skus.push(m);
  s.mapping.families[0].canonicalFamilyId='missing';await s.save();await assert.rejects(readBulkCatalogPackage(s.directory),/Unknown canonical family/);s.mapping.families[0].canonicalFamilyId='bulk-family';
  s.products.products[0].details.pricePaise=100;await s.save();await assert.rejects(readBulkCatalogPackage(s.directory),/unknown price and stock/);
 }finally{await s.cleanup();}
});

test('photos retain original hashes, family-only holds, MIME/path validation, and invalid decode is a resumable row failure',{timeout:60000},()=>fixture(async pool=>{
 const s=await source(3);try{
  const bytes=await readFile('resources/catalog/ksmc-demo/images/H19.jpg');await writeFile(join(s.directory,'images','photo.jpg'),bytes);await writeFile(join(s.directory,'images','broken.jpg'),Buffer.from([255,216,255,1,2,3]));
  const image=(path:string,matchKind:string)=>({path,mimeType:'image/jpeg',matchKind});
  Object.assign(s.products.products[0],{image:image('images/photo.jpg','family_only')});Object.assign(s.products.products[1],{image:image('images/photo.jpg','exact')});Object.assign(s.products.products[2],{image:image('images/broken.jpg','exact')});await s.save();
  const bundle=await readBulkCatalogPackage(s.directory),preview=await dryRunBulkCatalog(pool,fixtureStore,bundle,'stable-bulk');assert.equal(preview.imagesHeld,1);
  let status=await stage(pool,s.directory);assert.equal(status.counts.staged,2);assert.equal(status.counts.failed,1);
  const originals=(await pool.query('SELECT sha256,original,match_kind FROM catalog_proposal_assets ORDER BY match_kind')).rows;assert.equal(originals.length,2);for(const p of originals){assert.equal(p.sha256,createHash('sha256').update(bytes).digest('hex'));assert.ok(p.original.equals(bytes));}assert.ok(originals.some(p=>p.match_kind==='family_only'));
  status=await stage(pool,s.directory);assert.equal(status.counts.staged,2);assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_proposal_assets')).rows[0].n,2);
  await writeFile(join(s.directory,'images','photo.jpg'),Buffer.concat([bytes,Buffer.from([1])]));await assert.rejects(stage(pool,s.directory),/Batch source changed/);await writeFile(join(s.directory,'images','photo.jpg'),bytes);
  await symlink(join(s.directory,'products.json'),join(s.directory,'images','escape.jpg'));Object.assign(s.products.products[0],{image:image('images/escape.jpg','exact')});await s.save();let invalid=await readBulkCatalogPackage(s.directory);assert.match(invalid.entries[0].imageError!,/remain inside/);
  Object.assign(s.products.products[0],{image:{...image('images/photo.jpg','exact'),mimeType:'image/png'}});await s.save();invalid=await readBulkCatalogPackage(s.directory);assert.match(invalid.entries[0].imageError!,/MIME/);
  Object.assign(s.products.products[0],{image:image('images/../products.json','exact')});await s.save();invalid=await readBulkCatalogPackage(s.directory);assert.match(invalid.entries[0].imageError!,/local images/);
 }finally{await s.cleanup();}
}));


test('canonical taxonomy conflicts are visible in dry-run and cannot rewrite merchant taxonomy',()=>fixture(async pool=>{
 const s=await source(2);try{
  await pool.query("INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label) VALUES($1,'bulk-dept',NULL,'department','Merchant tools')",[fixtureStore]);
  const preview=await dryRunBulkCatalog(pool,fixtureStore,await readBulkCatalogPackage(s.directory),'stable-bulk');assert.equal(preview.conflicts,2);assert.deepEqual(preview.taxonomyConflicts,['bulk-dept']);assert.equal(preview.expectedCatalogUniqueCount,null);
  const status=await stage(pool,s.directory);assert.equal(status.counts.conflict,2);assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_proposals')).rows[0].n,0);assert.equal((await pool.query("SELECT label FROM catalog_nodes WHERE store_id=$1 AND id='bulk-dept'",[fixtureStore])).rows[0].label,'Merchant tools');
  await assert.rejects(bulkCatalogStatus(pool,randomUUID(),'stable-bulk'),/not found/);
 }finally{await s.cleanup();}
}));
