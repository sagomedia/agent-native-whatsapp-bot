import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import Fastify from 'fastify';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {registerOwnerCatalog} from '../apps/server/src/http/owner-catalog.js';
import {catalogWrite} from '../apps/server/src/services/catalog-proposals.js';
import {fixtureStore} from '../profiles/hardware.js';
import {latestCatalogRead} from '../apps/dashboard/src/owner-catalog-loading.js';

async function fixture(run:(pool:pg.Pool,app:ReturnType<typeof Fastify>)=>Promise<void>){
 assert.ok(process.env.DATABASE_URL,'Use an explicit isolated test DATABASE_URL.');
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='owner_pages_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`}),app=Fastify();
 try{await setupDatabase(pool,'mock');await pool.query('DELETE FROM products WHERE store_id=$1',[fixtureStore]);await pool.query("INSERT INTO catalog_nodes(store_id,id,kind,label,parent_id) VALUES($1,'page-department','department','Page department',NULL),($1,'page-family','family','Page family','page-department')",[fixtureStore]);
  await pool.query(`INSERT INTO products(store_id,sku,name,local_names,unit,price_paise,stock,reserved_stock,active,brand,family_id,price_status,inventory_updated_at) SELECT $1,'PAGE-'||lpad(g::text,4,'0'),'Variant '||lpad(((g-1)/3)::text,4,'0'),CASE WHEN g=3000 THEN '{"ta":"சோதனை குழாய்"}'::jsonb ELSE '{}'::jsonb END,'piece',100,CASE WHEN g%2=0 THEN NULL WHEN g%5=0 THEN 0 ELSE 10 END,0,g%2=1,CASE WHEN g%2=1 THEN 'Acme' ELSE 'Rare brand' END,'page-family',CASE WHEN g%7=0 THEN 'confirm' ELSE 'priced' END,'2026-10-17 01:00:00+00'::timestamptz+g*interval '1 microsecond' FROM generate_series(1,3000) g`,[fixtureStore]);
  await registerOwnerCatalog(app,pool,fixtureStore,(action,target,run)=>catalogWrite(pool,fixtureStore,'test',action,target,run));await app.ready();await run(pool,app);
 }finally{await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
const get=(app:ReturnType<typeof Fastify>,query:Record<string,string>={})=>app.inject({url:'/api/owner/catalog?'+new URLSearchParams(query)});
test('3,000 products are served in bounded deterministic pages with complete ties and independent selected editor',()=>fixture(async(pool,app)=>{
 const first=await get(app);assert.equal(first.statusCode,200,first.body);const body=first.json();assert.equal(body.total,3000);assert.equal(body.totalStore,3000);assert.equal(body.products.length,25);assert.ok(body.nextCursor);assert.ok(Buffer.byteLength(first.body)<70000);
 const seen=new Set<string>();let cursor='',requests=0;do{const r=await get(app,{limit:'100',...(cursor?{cursor}:{})});assert.equal(r.statusCode,200,r.body);for(const p of r.json().products){assert.ok(!seen.has(p.sku),p.sku);seen.add(p.sku);}cursor=r.json().nextCursor;requests++;}while(cursor);assert.equal(seen.size,3000);assert.equal(requests,30);
 const detail=await app.inject({url:'/api/owner/catalog/products/PAGE-3000'});assert.equal(detail.statusCode,200,detail.body);assert.equal(detail.json().product.localNames.ta,'சோதனை குழாய்');assert.ok(!body.products.some((p:any)=>p.sku==='PAGE-3000'));
 const foreign=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other','true')",[foreign]);await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise) VALUES($1,'FOREIGN-ONLY','Secret','piece',1)",[foreign]);assert.equal((await app.inject({url:'/api/owner/catalog/products/FOREIGN-ONLY'})).statusCode,404);
 for(const query of ([{limit:'101'},{limit:'0'},{limit:'2.5'},{cursor:'not-json'},{q:'changed',cursor:body.nextCursor},{sort:'sku',cursor:body.nextCursor}] as Record<string,string>[]))assert.equal((await get(app,query)).statusCode,400);
 const forged=JSON.parse(Buffer.from(body.nextCursor,'base64url').toString());forged.scope=foreign+':products';assert.equal((await get(app,{cursor:Buffer.from(JSON.stringify(forged)).toString('base64url')})).statusCode,400);
}));
test('owner search filters/counts cover the catalog rather than the loaded page and all supported sorts traverse ties',()=>fixture(async(pool,app)=>{
 const tamil=(await get(app,{q:'சோதனை குழாய்'})).json();assert.equal(tamil.total,1);assert.equal(tamil.products[0].sku,'PAGE-3000');
 const unknown=(await get(app,{stock:'unknown'})).json();assert.equal(unknown.total,1500);assert.equal(unknown.products.length,25);assert.ok(unknown.products.every((p:any)=>p.stock===null));
 assert.equal((await get(app,{stock:'out'})).json().total,300);
 assert.equal((await get(app,{brand:'Rare brand',family:'page-family',visibility:'draft'})).json().total,1500);
 assert.equal((await get(app,{exception:'pending_price'})).json().total,428);
 await pool.query("UPDATE products SET name='Literal %_ product' WHERE store_id=$1 AND sku='PAGE-3000'",[fixtureStore]);assert.equal((await get(app,{q:'%_'})).json().total,1);
 for(const sort of ['sku','updated']){const expected=(await pool.query(`SELECT sku FROM products WHERE store_id=$1 ORDER BY ${sort==='sku'?'sku':'inventory_updated_at DESC,sku'}`,[fixtureStore])).rows.map(r=>r.sku);const actual:string[]=[];let cursor='';do{const r=await get(app,{sort,limit:'100',...(cursor?{cursor}:{})});assert.equal(r.statusCode,200,r.body);actual.push(...r.json().products.map((p:any)=>p.sku));cursor=r.json().nextCursor;}while(cursor);assert.deepEqual(actual,expected);}
}));
test('pending review follows merchant confirmations and selected source photos stay bounded and owner-only',()=>fixture(async(pool,app)=>{
 const confirmed={identity:true,photo:true,sellingUnit:true,price:true,stock:true};
 await pool.query('UPDATE products SET merchant_verification=$2 WHERE store_id=$1',[fixtureStore,JSON.stringify(confirmed)]);
 await pool.query("UPDATE products SET merchant_verification=merchant_verification||'{\"photo\":false}'::jsonb WHERE store_id=$1 AND sku='PAGE-0001'",[fixtureStore]);
 const page=(await get(app,{exception:'pending_review'})).json();assert.equal(page.total,1);assert.equal(page.summary.pendingReview,1);assert.equal(page.products[0].sku,'PAGE-0001');assert.equal(page.products[0].verification.photo,false);assert.ok(!('referencePhotos' in page.products[0]));
 const proposal=randomUUID(),foreign=randomUUID(),foreignProposal=randomUUID();
 await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other','true')",[foreign]);
 for(const [id,store] of [[proposal,fixtureStore],[foreignProposal,foreign]])await pool.query("INSERT INTO catalog_proposals(id,store_id,batch_id,client_item_id,input_hash,details,provenance,actor,state,published_sku) VALUES($1,$2,'source','photo',repeat('a',64),'{}','{}','test','published','PAGE-0001')",[id,store]);
 const privateImage=Buffer.from('source photo bytes');
 const ownIds:string[]=[];
 for(let i=0;i<8;i++){
  const id=randomUUID(),isOwn=i<7;if(isOwn)ownIds.push(id);
  await pool.query("INSERT INTO catalog_proposal_assets(id,store_id,proposal_id,original,mime_type,sha256,image,width,height,match_kind) VALUES($1,$2,$3,$4,'image/png',$5,$4,1,1,'unconfirmed')",[id,isOwn?fixtureStore:foreign,isOwn?proposal:foreignProposal,privateImage,String(i).padStart(64,'0')]);
 }
 const detail=await app.inject({url:'/api/owner/catalog/products/PAGE-0001'});assert.equal(detail.statusCode,200,detail.body);
 const product=detail.json().product;assert.equal(product.imageUrl,undefined);assert.equal(product.referencePhotos.length,5);
 for(const asset of product.referencePhotos){assert.equal(asset.proposalId,proposal);assert.equal(asset.matchKind,'unconfirmed');assert.ok(ownIds.includes(asset.id));assert.ok(!('image' in asset));assert.ok(!('original' in asset));}
 const ref=product.referencePhotos[0],photo=await app.inject({url:'/api/owner/catalog/proposals/'+ref.proposalId+'/photos/'+ref.id});assert.equal(photo.statusCode,200);assert.equal(photo.headers['cache-control'],'private, no-store');
}));
test('a catalog revision change invalidates an old traversal and stale independently loaded edits cannot overwrite facts or stock',()=>fixture(async(pool,app)=>{
 const page=(await get(app)).json(),selected=(await app.inject({url:'/api/owner/catalog/products/PAGE-0001'})).json().product;
 await pool.query("UPDATE products SET price_paise=250,version=version+1,name='Current merchant name' WHERE store_id=$1 AND sku='PAGE-0001'",[fixtureStore]);
 const stale=await get(app,{cursor:page.nextCursor});assert.equal(stale.statusCode,409,stale.body);assert.match(stale.json().message??stale.json().error,/catalog changed/i);
 const write=await app.inject({method:'POST',url:'/api/owner/catalog/products',payload:{sku:selected.sku,version:selected.version,inventoryVersion:selected.inventoryVersion,name:'Stale browser name',localNames:selected.localNames,aliases:selected.aliases,keywords:[],unit:selected.unit,pricePaise:100,stock:99,quantityStep:1,familyId:'page-family',brand:'Acme',specifications:{},active:false,verified:false}});assert.equal(write.statusCode,409,write.body);
 const current=(await pool.query("SELECT name,price_paise,stock FROM products WHERE store_id=$1 AND sku='PAGE-0001'",[fixtureStore])).rows[0];assert.equal(current.name,'Current merchant name');assert.equal(current.price_paise,250);assert.equal(Number(current.stock),10);assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_movements')).rows[0].n,0);
}));
test('thousands of draft summaries remain bounded, exception counts are complete and selected draft reconciles current base version',()=>fixture(async(pool,app)=>{
 await pool.query(`INSERT INTO catalog_proposals(id,store_id,batch_id,client_item_id,input_hash,details,provenance,actor,base_sku,base_version,created_at) SELECT ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,$1,'scale-source',g::text,repeat('a',64),jsonb_build_object('name','Draft '||g,'sku','DRAFT-'||g),jsonb_build_object('source','Fixture','issues',CASE WHEN g%2=0 THEN '["Check source size"]'::jsonb ELSE '[]'::jsonb END),'test',CASE WHEN g=3000 THEN 'PAGE-0001' ELSE NULL END,CASE WHEN g=3000 THEN 99 ELSE NULL END,'2026-10-17 02:00:00+00'::timestamptz FROM generate_series(1,3000) g`,[fixtureStore]);
 const first=await app.inject({url:'/api/owner/catalog/proposals'});assert.equal(first.statusCode,200,first.body);assert.equal(first.json().total,3000);assert.equal(first.json().proposals.length,25);assert.equal(first.json().summary.conflicts,1);assert.equal(first.json().summary.issues,1500);assert.ok(!('details' in first.json().proposals[0]));
 const conflict=await app.inject({url:'/api/owner/catalog/proposals?exception=conflicts'});assert.equal(conflict.json().total,1);const id=conflict.json().proposals[0].id;
 const detail=await app.inject({url:'/api/owner/catalog/proposals/'+id});assert.equal(detail.statusCode,200,detail.body);assert.equal(detail.json().proposal.conflict,true);assert.equal(detail.json().proposal.currentProduct.version,1);assert.deepEqual(detail.json().proposal.provenance.issues,['Check source size']);
 const ids=new Set<string>();let cursor='';do{const r=await app.inject({url:'/api/owner/catalog/proposals?'+new URLSearchParams({limit:'100',...(cursor?{cursor}:{})})});assert.equal(r.statusCode,200,r.body);for(const p of r.json().proposals){assert.ok(!ids.has(p.id));ids.add(p.id);}cursor=r.json().nextCursor;}while(cursor);assert.equal(ids.size,3000);
 assert.equal((await app.inject({url:'/api/owner/catalog/proposals?exception=issues&cursor='+first.json().nextCursor})).statusCode,400);
 assert.equal((await app.inject({url:'/api/owner/catalog/proposals?limit=1000'})).statusCode,400);
 assert.equal((await app.inject({url:'/api/owner/catalog/proposals/'+randomUUID()})).statusCode,404);
}));
test('intake progress returns bounded source rows, complete batch counts and scoped not-found responses',()=>fixture(async(pool,app)=>{
 await pool.query("INSERT INTO catalog_intake_batches(store_id,batch_id,source_hash,manifest) VALUES($1,'scale-source',repeat('a',64),'{}')",[fixtureStore]);
 await pool.query("INSERT INTO catalog_intake_items(store_id,batch_id,source_sku,canonical_sku,input_hash,state,error) SELECT $1,'scale-source','SOURCE-'||lpad(g::text,4,'0'),'PAGE-'||lpad(g::text,4,'0'),repeat('a',64),CASE WHEN g=3000 THEN 'conflict' ELSE 'pending' END,CASE WHEN g=3000 THEN 'Version changed' ELSE NULL END FROM generate_series(1,3000) g",[fixtureStore]);
 const batches=await app.inject({url:'/api/owner/catalog/intake'});assert.equal(batches.statusCode,200,batches.body);assert.equal(batches.json().batches[0].total,3000);
 const first=await app.inject({url:'/api/owner/catalog/intake/scale-source'});assert.equal(first.statusCode,200,first.body);assert.equal(first.json().results.length,25);assert.deepEqual(first.json().counts,{pending:2999,conflict:1});assert.ok(first.json().nextCursor);
 const last=await app.inject({url:'/api/owner/catalog/intake/scale-source?cursor=SOURCE-2999'});assert.equal(last.json().results.length,1);assert.equal(last.json().results[0].error,'Version changed');assert.equal(last.json().nextCursor,null);
 assert.equal((await app.inject({url:'/api/owner/catalog/intake/foreign-batch'})).statusCode,404);assert.equal((await app.inject({url:'/api/owner/catalog/intake/scale-source?limit=101'})).statusCode,400);
}));
test('late search and product responses, stale failures and unmounts cannot replace the current editor or results',async()=>{
 const loader=latestCatalogRead(),applied:string[]=[],errors:string[]=[];
 let resolveOld!:(v:string)=>void,rejectOld!:(e:Error)=>void;
 const old=loader.run(()=>new Promise<string>(resolve=>{resolveOld=resolve;}),v=>applied.push(v),e=>errors.push(e.message));
 await loader.run(async()=>'new page and editor',v=>applied.push(v),e=>errors.push(e.message));resolveOld('old search');await old;assert.deepEqual(applied,['new page and editor']);
 const failing=loader.run(()=>new Promise<string>((_,reject)=>{rejectOld=reject;}),v=>applied.push(v),e=>errors.push(e.message));await loader.run(async()=>'current product',v=>applied.push(v),e=>errors.push(e.message));rejectOld(new Error('obsolete failure'));await failing;assert.equal(errors.length,0);
 const unmounted=loader.run(()=>new Promise<string>(resolve=>{resolveOld=resolve;}),v=>applied.push(v),e=>errors.push(e.message));loader.cancel();resolveOld('unmounted');await unmounted;assert.deepEqual(applied,['new page and editor','current product']);
});
