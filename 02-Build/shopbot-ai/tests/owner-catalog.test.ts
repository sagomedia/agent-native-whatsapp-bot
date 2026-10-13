import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo} from '../apps/server/src/services/demo-catalog.js';
import {fixtureStore,fixtureConversation} from '../profiles/hardware.js';
import {createApp} from '../apps/server/src/http/app.js';
import {discoverProducts} from '../apps/server/src/services/catalog-discovery.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {productMediaUrl} from '../apps/server/src/services/whatsapp-reply.js';
import {renderVisualImage} from '../apps/server/src/services/visual-images.js';
const owner={hostname:'catalog-owner.example.test',issuer:'https://test.cloudflareaccess.com',audience:'catalog-owner-application',email:'owner@example.test',storeId:fixtureStore};
const wa={hostname:'catalog-api.example.test',storeId:fixtureStore,appId:'123456789',wabaId:'987654321',phoneId:'123987654',appSecret:'test',verifyToken:'test',accessToken:'synthetic-not-a-key',graphVersion:'v25.0',recipients:['919000000001'],defaultReplyLanguage:'ta' as const,processEnabled:false,sendEnabled:false};
const headers={host:owner.hostname,'cf-access-jwt-assertion':'synthetic',origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json'};
const product={sku:'SHOP-PLIER',version:0,name:'Acme Cutting Plier 8 inch',localNames:{ta:'அக்மி கட்டிங் பிளையர்','ta-Latn':'Acme cutting plier'},aliases:['cutting plier','கட்டிங் பிளையர்'],keywords:['plier'],unit:'piece',pricePaise:25000,stock:5,quantityStep:1,familyId:'shop-pliers',brand:'Acme',specifications:{size:'8 inch'},active:false,verified:false};
async function fixture(run:(pool:pg.Pool,app:Awaited<ReturnType<typeof createApp>>)=>Promise<void>){const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='catalog_owner_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let app;try{await setupDatabase(pool,'mock');await setupImageDemo(pool,fixtureStore);app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,host:'127.0.0.1',port:3017,mediaDir:'/tmp/test',owner,whatsapp:wa},pool,undefined,undefined,async()=>({email:owner.email,subject:'owner'}));await run(pool,app);}finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
const post=(app:any,path:string,body:unknown,extra={})=>app.inject({method:'POST',url:'/api/owner/catalog'+path,headers:{...headers,...extra},payload:JSON.stringify(body)});
async function type(app:any){const r=await post(app,'/nodes',{id:'shop-pliers',kind:'family',parentId:'tools',label:'Cutting pliers',localNames:{ta:'கட்டிங் பிளையர்'},aliases:['cutting plier','கட்டிங் பிளையர்']});assert.equal(r.statusCode,200,r.body);}
test('owner inventory is scoped, verified before publication, searchable in Tamil, and versioned across customer reviews',async()=>fixture(async(pool,app)=>{
 const dept=(await pool.query("SELECT id FROM catalog_nodes WHERE store_id=$1 AND kind='department' AND id='tools'",[fixtureStore])).rows[0];assert.ok(dept);await type(app);
 assert.equal((await post(app,'/products',{...product,active:true})).statusCode,400);
 assert.equal((await post(app,'/products',{...product,familyId:'untrusted-family'})).statusCode,400);
 let r=await post(app,'/products',product);assert.equal(r.statusCode,200,r.body);const first=r.json();
 const ctx={storeId:fixtureStore,conversationId:fixtureConversation,actor:'local-simulator',role:'customer' as const};
 let c=await pool.connect();try{assert.equal((await discoverProducts(c,ctx,'cutting plier')).products.length,0);}finally{c.release();}
 r=await post(app,'/products',{...product,version:first.version,active:true,verified:true});assert.equal(r.statusCode,200,r.body);const second=r.json();
 c=await pool.connect();try{for(const q of ['cutting plier','கட்டிங் பிளையர்'])assert.deepEqual((await discoverProducts(c,ctx,q)).products.map(p=>p.sku),[product.sku]);}finally{c.release();}
 assert.equal((await post(app,'/products',{...product,version:first.version,active:true,verified:true})).statusCode,409);
 assert.equal((await app.inject({url:'/api/owner/catalog',headers:{host:owner.hostname}})).statusCode,403);
 assert.equal((await post(app,'/products',{...product,version:second.version},{origin:'https://other.test'})).statusCode,403);
 const tools=new RetailTools(pool),inbox=new SimulatorService(pool);let state=(await inbox.snapshot()).conversation;
 state=(await tools.invoke(ctx,{name:'apply_draft_changes',args:{expectedVersion:state.version,operations:[{kind:'add_item',query:product.sku,quantity:2}]}},randomUUID())).state!;
 state=(await tools.invoke(ctx,{name:'preview_order',args:{expectedVersion:state.version}},randomUUID())).state!;assert.equal(state.pending?.kind,'products');if(state.pending?.kind!=='products')throw Error();
 const batch=state.pending;state=(await tools.invoke({...ctx,consentProductBatchId:batch.id},{name:'confirm_product_choices',args:{batchId:batch.id,choices:[{lineId:state.draft[0].id,sku:product.sku}]}},randomUUID())).state!;
 state=(await tools.invoke(ctx,{name:'preview_order',args:{expectedVersion:state.version}},randomUUID())).state!;assert.equal(state.pending?.kind,'review');if(state.pending?.kind!=='review')throw Error();const review=state.pending;
 r=await post(app,'/products',{...product,version:second.version,active:true,verified:true,pricePaise:30000});assert.equal(r.statusCode,200,r.body);
 const stale=await tools.invoke({...ctx,consentReviewId:review.id},{name:'submit_order_request',args:{reviewId:review.id}},randomUUID());assert.equal(stale.request,undefined);assert.match(stale.message,/changed.*No request submitted/i);
 assert.equal((await pool.query('SELECT count(*) FROM order_requests')).rows[0].count,'0');
 const snapshot=(await app.inject({url:'/api/owner/catalog',headers})).json();assert.equal(snapshot.products.find((p:any)=>p.sku===product.sku).origin,'owner');assert.ok(snapshot.products.find((p:any)=>p.sku===product.sku).inventoryUpdatedAt);
 const foreign=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Foreign','true')",[foreign]);await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock) VALUES($1,'SECRET','Hidden other shop','piece',1,0)",[foreign]);assert.equal((await app.inject({url:'/api/owner/catalog',headers})).json().products.some((p:any)=>p.sku==='SECRET'),false);
}));
test('owner photos are normalized, immutable, publicly store scoped only while visible, and never use customer uploads',async()=>fixture(async(pool,app)=>{
 await type(app);const created=await post(app,'/products',product);let version=created.json().version;
 const bytes=await readFile('resources/catalog/ksmc-demo/images/H19.jpg');const photo={id:randomUUID(),mimeType:'image/jpeg',data:bytes.toString('base64'),caption:''};
 let r=await post(app,'/products/SHOP-PLIER/photo',photo,{'x-product-version':String(version)});assert.equal(r.statusCode,200,r.body);const image=r.json();version=image.version;
 assert.equal((await app.inject({url:image.imageUrl,headers:{host:wa.hostname}})).statusCode,404);
 assert.equal((await app.inject({url:'/api/owner/products/SHOP-PLIER/image',headers})).statusCode,200);
 assert.equal((await post(app,'/products/SHOP-PLIER/photo',photo,{'x-product-version':String(version-1)})).statusCode,409);
 r=await post(app,'/products',{...product,version,active:true,verified:true});assert.equal(r.statusCode,200,r.body);version=r.json().version;
 r=await app.inject({url:image.imageUrl,headers:{host:wa.hostname}});assert.equal(r.statusCode,200,r.body);assert.equal(r.headers['content-type'],'image/jpeg');assert.equal(r.headers['cache-control'],'no-store');
 assert.equal(productMediaUrl(image.imageUrl,wa.hostname),'https://'+wa.hostname+image.imageUrl);
 assert.equal((await app.inject({url:image.imageUrl,headers:{host:'other-shop.test'}})).statusCode,404);
 const replacement=await post(app,'/products/SHOP-PLIER/photo',photo,{'x-product-version':String(version)});assert.equal(replacement.statusCode,200,replacement.body);version=replacement.json().version;assert.equal(replacement.json().active,false);
 assert.equal((await app.inject({url:image.imageUrl,headers:{host:wa.hostname}})).statusCode,404);assert.equal((await app.inject({url:replacement.json().imageUrl,headers:{host:wa.hostname}})).statusCode,404);
 r=await post(app,'/products',{...product,version,active:true,verified:true});assert.equal(r.statusCode,200,r.body);version=r.json().version;assert.equal((await app.inject({url:replacement.json().imageUrl,headers:{host:wa.hostname}})).statusCode,200);
 await post(app,'/products',{...product,version,active:false});assert.equal((await app.inject({url:replacement.json().imageUrl,headers:{host:wa.hostname}})).statusCode,404);
 assert.equal((await app.inject({url:'/catalog-images/custom/'+randomUUID()+'.jpg',headers:{host:wa.hostname}})).statusCode,404);
 assert.equal((await pool.query('SELECT count(*) FROM image_media')).rows[0].count,'0');
}));

test('demo initialization cannot overwrite owner-managed catalog facts',async()=>fixture(async(pool)=>{
 await pool.query("UPDATE products SET catalog_origin='owner',local_names='{}',aliases='[]',family_id='pipe-fittings',brand='Verified shop brand',specifications='{\"size\":\"Owner variant\"}' WHERE store_id=$1 AND sku='H19'",[fixtureStore]);
 const before=(await pool.query("SELECT * FROM products WHERE store_id=$1 AND sku='H19'",[fixtureStore])).rows[0];
 await pool.query("UPDATE products SET catalog_origin='owner',aliases='[]' WHERE store_id=$1 AND sku='WRENCH-10'",[fixtureStore]);
 await setupDatabase(pool,'mock');await setupImageDemo(pool,fixtureStore);
 assert.deepEqual((await pool.query("SELECT aliases FROM products WHERE store_id=$1 AND sku='WRENCH-10'",[fixtureStore])).rows[0].aliases,[]);
 const after=(await pool.query("SELECT * FROM products WHERE store_id=$1 AND sku='H19'",[fixtureStore])).rows[0];
 assert.deepEqual(after,before);
 assert.equal((await pool.query("SELECT catalog_origin FROM products WHERE store_id=$1 AND sku='H20'",[fixtureStore])).rows[0].catalog_origin,'demo');
}));

test('visual message PNGs are public on the WhatsApp host and authenticated in owner history',async()=>fixture(async(_pool,app)=>{
 const url=renderVisualImage({kind:'instruction',title:'பொருட்களைப் பாருங்க',lines:['Check every photo'],caption:'Products correct'});
 const filename=url.split('/').at(-1)!;
 const publicImage=await app.inject({url,headers:{host:wa.hostname}});
 assert.equal(publicImage.statusCode,200,publicImage.body);assert.equal(publicImage.headers['content-type'],'image/png');
 assert.ok(publicImage.rawPayload.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
 const ownerUrl='/api/owner/message-images/'+filename;
 assert.equal((await app.inject({url:ownerUrl,headers:{host:owner.hostname}})).statusCode,403);
 const ownerImage=await app.inject({url:ownerUrl,headers});assert.equal(ownerImage.statusCode,200);assert.equal(ownerImage.headers['cache-control'],'private, no-store');assert.ok(ownerImage.rawPayload.equals(publicImage.rawPayload));
 assert.equal((await app.inject({url,headers})).statusCode,404);
 assert.equal((await app.inject({url,headers:{host:'other-shop.test'}})).statusCode,404);
 assert.equal((await app.inject({method:'POST',url,headers:{host:wa.hostname}})).statusCode,404);
 assert.equal((await app.inject({url:'/catalog-images/messages/not-a-hash.png',headers:{host:wa.hostname}})).statusCode,404);
 assert.equal((await app.inject({url:'/api/owner/message-images/'+('0'.repeat(64))+'.png',headers})).statusCode,404);
}));

test('saved publication revision is immediately visible to the agent diagnostic; zero price needs an explicit status',async()=>fixture(async(pool,app)=>{
 await type(app);const before=(await app.inject({url:'/api/owner/catalog',headers})).json().revision;
 let r=await post(app,'/products',{...product,active:true,verified:true});assert.equal(r.statusCode,200,r.body);assert.ok(r.json().revision>before);
 let search=await post(app,'/diagnose',{query:'cutting plier'});assert.equal(search.statusCode,200,search.body);assert.ok(search.json().products.some((p:any)=>p.sku===product.sku));assert.equal(search.json().revision,r.json().revision);
 const version=r.json().version;r=await post(app,'/products',{...product,version,active:true,verified:true,pricePaise:0,priceStatus:'priced'});assert.equal(r.statusCode,400);
 r=await post(app,'/products',{...product,version,active:true,verified:true,pricePaise:0,priceStatus:'confirm'});assert.equal(r.statusCode,200,r.body);search=await post(app,'/diagnose',{query:'cutting plier'});assert.ok(search.json().products.find((p:any)=>p.sku===product.sku).issues.includes('Shop must confirm price'));
 assert.equal((await post(app,'/products',{...product,version:r.json().version,active:true,verified:true,unit:'litre',specifications:{weight:'10kg'}})).statusCode,400);
}));
