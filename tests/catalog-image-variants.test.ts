import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {createApp} from '../apps/server/src/http/app.js';
import {setupImageDemo} from '../apps/server/src/services/demo-catalog.js';
import {backfillCatalogImageVariants,catalogImageSize,imageHash,prepareCatalogImageVariants} from '../apps/server/src/services/catalog-image-variants.js';
import {addProposalAsset,catalogWrite,createProposal,prepareProposalAsset} from '../apps/server/src/services/catalog-proposals.js';
import {fixtureStore} from '../profiles/hardware.js';

const owner={hostname:'image-owner.example.test',issuer:'https://test.cloudflareaccess.com',audience:'catalog-image-app',email:'owner@example.test',storeId:fixtureStore};
const headers={host:owner.hostname,'cf-access-jwt-assertion':'synthetic'};
const uploadHeaders={...headers,origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json','x-product-version':'1'};
function dimensions(bytes:Buffer){const probe=spawnSync('ffprobe',['-v','error','-protocol_whitelist','pipe','-select_streams','v:0','-show_entries','stream=width,height','-of','json','-i','pipe:0'],{input:bytes,encoding:'utf8'});assert.equal(probe.status,0,probe.stderr);return JSON.parse(probe.stdout).streams[0] as {width:number;height:number};}
async function fixture(run:(pool:pg.Pool,app:Awaited<ReturnType<typeof createApp>>)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='image_variants_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let app;
 try{await setupDatabase(pool,'mock');await setupImageDemo(pool,fixtureStore);app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,host:'127.0.0.1',port:3017,mediaDir:'/tmp/test',owner},pool,undefined,undefined,async token=>{if(token!=='synthetic')throw Error('Invalid access');return {email:owner.email,subject:'owner'};});await run(pool,app);}
 finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}

test('catalog image variants are bounded JPEGs, preserve aspect and substantially reduce thumbnail bytes',async()=>{
 const original=await readFile('resources/catalog/ksmc-demo/images/H14.jpg'),variants=await prepareCatalogImageVariants(original);
 assert.deepEqual(variants.map(v=>v.size),[128,256,640]);
 for(const variant of variants){const d=dimensions(variant.image);assert.equal(Math.max(d.width,d.height),variant.size);assert.equal(variant.contentHash,imageHash(variant.image));assert.ok(variant.image.length<original.length);}
 assert.ok(variants[0].image.length<original.length/10);
 assert.equal(catalogImageSize('128'),128);for(const invalid of ['0','4096','128.0',['128'],128])assert.throws(()=>catalogImageSize(invalid),/Choose image size/);
});

test('owner photos ingest previews; authenticated ETags revalidate actual bytes across sizes, shop scope and mutable product versions',()=>fixture(async(pool,app)=>{
 const legacy=await app.inject({url:'/api/owner/products/H14/image?size=128&v=1',headers});assert.equal(legacy.statusCode,200);assert.equal(legacy.headers['cache-control'],'private, no-cache, max-age=0');
 const bytes=await readFile('resources/catalog/ksmc-demo/images/H14.jpg');
 const response=await app.inject({method:'POST',url:'/api/owner/catalog/products/H14/photo',headers:uploadHeaders,payload:JSON.stringify({id:randomUUID(),mimeType:'image/jpeg',data:bytes.toString('base64'),caption:''})});assert.equal(response.statusCode,200,response.body);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_image_variants WHERE store_id=$1',[fixtureStore])).rows[0].n,3);
 const url='/api/owner/products/H14/image?size=128&v=1',thumb=await app.inject({url,headers});assert.equal(thumb.statusCode,200);assert.ok(thumb.rawPayload.length<legacy.rawPayload.length/10);assert.ok(Math.max(...Object.values(dimensions(thumb.rawPayload)))<=128);
 const etag=String(thumb.headers.etag);assert.equal(etag,'"'+imageHash(thumb.rawPayload)+'"');
 const cached=await app.inject({url,headers:{...headers,'if-none-match':'"unrelated", W/'+etag}});assert.equal(cached.statusCode,304);assert.equal(cached.rawPayload.length,0);assert.equal(cached.headers.etag,etag);
 for(const token of [undefined,'expired']){const rejected=await app.inject({url,headers:{host:owner.hostname,...(token?{'cf-access-jwt-assertion':token}:{}),'if-none-match':etag}});assert.equal(rejected.statusCode,403);}
 const large=await app.inject({url:'/api/owner/products/H14/image?size=640',headers:{...headers,'if-none-match':etag}});assert.equal(large.statusCode,200);assert.notEqual(large.headers.etag,etag);
 const foreign=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other','true')",[foreign]);await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,image_path) VALUES($1,'SECRET','Other shop photo','piece',1,0,'/demo-images/H14.jpg')",[foreign]);
 assert.equal((await app.inject({url:'/api/owner/products/SECRET/image?size=128',headers:{...headers,'if-none-match':'*'}})).statusCode,404);
 assert.equal((await app.inject({url:'/api/owner/products/H14/image?size=4096',headers})).statusCode,400);
 // Same mutable URL and old v query: replacement must return current bytes, never a stale 304.
 await pool.query("UPDATE products SET image_path='/demo-images/H19.jpg',version=version+1 WHERE store_id=$1 AND sku='H14'",[fixtureStore]);
 const changed=await app.inject({url,headers:{...headers,'if-none-match':etag}});assert.equal(changed.statusCode,200);assert.notEqual(changed.headers.etag,etag);
 await pool.query("UPDATE products SET image_path=NULL WHERE store_id=$1 AND sku='H14'",[fixtureStore]);assert.equal((await app.inject({url,headers:{...headers,'if-none-match':etag}})).statusCode,404);
}));

test('draft preview returns its small representation, preserves original inspection bytes and cannot revalidate a foreign proposal',()=>fixture(async(pool,app)=>{
 const proposalId=randomUUID(),bytes=await readFile('resources/catalog/ksmc-demo/images/H14.jpg');
 await catalogWrite(pool,fixtureStore,'fixture','draft',proposalId,c=>createProposal(c,fixtureStore,'fixture',{id:proposalId,batchId:'images',clientItemId:'one',details:{name:'Photo test'},provenance:{source:'offline fixture'}}));
 const prepared=await prepareProposalAsset({proposalId,version:1,photo:{id:randomUUID(),mimeType:'image/jpeg',data:bytes.toString('base64'),caption:''},matchKind:'unconfirmed'});
 const saved=await catalogWrite(pool,fixtureStore,'fixture','photo',proposalId,c=>addProposalAsset(c,fixtureStore,prepared.input,prepared.media));
 const url='/api/owner/catalog/proposals/'+proposalId+'/photos/'+saved.id,preview=await app.inject({url:url+'?size=256',headers});assert.equal(preview.statusCode,200);assert.ok(Math.max(...Object.values(dimensions(preview.rawPayload)))<=256);
 const original=await app.inject({url:url+'?original=1',headers});assert.equal(original.statusCode,200);assert.ok(original.rawPayload.equals(bytes));assert.equal(original.headers['cache-control'],'private, no-store');assert.equal((await app.inject({url:url+'?original=1',headers:{...headers,'if-none-match':'*'}})).statusCode,200);assert.notEqual(original.headers.etag,preview.headers.etag);
 assert.equal((await app.inject({url:url+'?size=256',headers:{...headers,'if-none-match':String(preview.headers.etag)}})).statusCode,304);
 assert.equal((await app.inject({url:'/api/owner/catalog/proposals/'+randomUUID()+'/photos/'+saved.id+'?size=256',headers:{...headers,'if-none-match':'*'}})).statusCode,404);
 assert.equal((await app.inject({url:url+'?size=256',headers:{host:owner.hostname,'if-none-match':String(preview.headers.etag)}})).statusCode,403);
}));

test('bounded backfill preview writes nothing, resumes safely, fills legacy/demo images and reuses existing variants',()=>fixture(async(pool)=>{
 const bytes=await readFile('resources/catalog/ksmc-demo/images/H14.jpg'),id=randomUUID();
 await pool.query('INSERT INTO catalog_photos(id,store_id,image,width,height) VALUES($1,$2,$3,800,800)',[id,fixtureStore,bytes]);
 const preview=await backfillCatalogImageVariants(pool,fixtureStore,{limit:1});assert.equal(preview.readOnly,true);assert.equal(preview.processed,1);assert.equal(preview.created,0);assert.equal(preview.items[0].missing,3);assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_image_variants')).rows[0].n,0);assert.equal((await pool.query('SELECT content_hash FROM catalog_photos WHERE id=$1',[id])).rows[0].content_hash,null);
 const applied=await backfillCatalogImageVariants(pool,fixtureStore,{limit:1,apply:true});assert.equal(applied.created,3);assert.equal(applied.hasMore,true);assert.equal(applied.nextCursor,'catalog:'+id);
 const replay=await backfillCatalogImageVariants(pool,fixtureStore,{limit:1,apply:true});assert.equal(replay.created,0);assert.equal(replay.items[0].missing,0);
 const demo=await backfillCatalogImageVariants(pool,fixtureStore,{limit:1,after:applied.nextCursor,apply:true});assert.equal(demo.processed,1);assert.match(demo.nextCursor,/^demo:H/);assert.equal(demo.items[0].missing,3);
 const foreign=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other','true')",[foreign]);assert.equal((await backfillCatalogImageVariants(pool,foreign,{apply:true})).processed,0);
 await assert.rejects(backfillCatalogImageVariants(pool,fixtureStore,{limit:101}),/1 to 100/);await assert.rejects(backfillCatalogImageVariants(pool,fixtureStore,{after:'../../file'}),/Invalid image backfill cursor/);
 // Decoder failure is resumable and never advances past the failed source.
 const broken=randomUUID();await pool.query('INSERT INTO catalog_photos(id,store_id,image,width,height) VALUES($1,$2,$3,1,1)',[broken,foreign,Buffer.from('not an image')]);
 const failed=await backfillCatalogImageVariants(pool,foreign,{limit:1,apply:true});assert.equal(failed.failures.length,1);assert.equal(failed.nextCursor,'');assert.equal(failed.hasMore,true);
}));

test('compiled variant CLI loads without development tools and fails closed before implicit database work',()=>{
 const cli=resolve('dist/scripts/backfill-catalog-image-variants.js');assert.ok(existsSync(cli),'Build first for compiled CLI tests.');
 const run=(args:string[])=>spawnSync(process.execPath,[cli,...args],{env:{PATH:process.env.PATH??''},encoding:'utf8',timeout:15000});
 const help=run(['--help']);assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/Preview is read-only/);assert.match(help.stdout,/nextCursor/);
 const missing=run([]);assert.equal(missing.status,1);assert.match(JSON.parse(missing.stderr).message,/Explicit DATABASE_URL/);assert.doesNotMatch(missing.stderr,/MODULE_NOT_FOUND/);
 const unauthorized=run(['--apply']);assert.equal(unauthorized.status,1);assert.match(JSON.parse(unauthorized.stderr).message,/--owner-authorized/);
});
