import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo} from '../apps/server/src/services/demo-catalog.js';
import {fixtureStore} from '../profiles/hardware.js';
import {createApp} from '../apps/server/src/http/app.js';

const owner={hostname:'simple-product.example.test',issuer:'https://test.cloudflareaccess.com',audience:'owner-app',email:'owner@example.test',storeId:fixtureStore};
const headers={host:owner.hostname,'cf-access-jwt-assertion':'synthetic',origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json'};
async function fixture(run:(pool:pg.Pool,app:Awaited<ReturnType<typeof createApp>>)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='simple_product_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let app;
 try{await setupDatabase(pool,'mock');await setupImageDemo(pool,fixtureStore);
  app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,host:'127.0.0.1',port:3017,mediaDir:'/tmp/test',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'owner'}));
  await run(pool,app);
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
const post=(app:any,body:unknown)=>app.inject({method:'POST',url:'/api/owner/products/simple',headers,payload:JSON.stringify(body)});

test('one action publishes a photographed product while unknown stock remains advisory, and retries do not duplicate it',()=>fixture(async(pool,app)=>{
 const image=await readFile('resources/catalog/ksmc-demo/images/H19.jpg');
 const request={createId:randomUUID(),name:'Red handled cutting plier',pricePaise:25000,unit:'piece',quantityStep:1,
  details:{localNames:{ta:'சிவப்பு இடுக்கி'},aliases:['cutting tool'],specifications:{material:'steel',colour:'red'}},
  photo:{id:randomUUID(),mimeType:'image/jpeg',data:image.toString('base64'),caption:''}};
 let response=await post(app,request);assert.equal(response.statusCode,200,response.body);
 const created=response.json();assert.equal(created.active,true);assert.equal(created.stock,null);
 assert.match(created.imageUrl,/^\/catalog-images\/custom\//);
 assert.equal((await pool.query('SELECT count(*) FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,created.sku])).rows[0].count,'1');
 response=await post(app,{...request,details:{...request.details,specifications:{colour:'red',material:'steel'}}});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().replayed,true);
 assert.equal((await pool.query('SELECT count(*) FROM inventory_movements WHERE store_id=$1 AND sku=$2',[fixtureStore,created.sku])).rows[0].count,'0');
 const list=(await app.inject({url:'/api/owner/catalog?q=Red%20handled',headers})).json();
 assert.equal(list.products[0].sku,created.sku);assert.equal(list.products[0].pricePaise,25000);
 response=await post(app,{sku:created.sku,version:created.version,name:request.name,unit:'piece',pricePaise:27500});
 assert.equal(response.statusCode,200,response.body);assert.equal(response.json().stock,null);
 const changed=(await pool.query('SELECT aliases,local_names,image_path FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,created.sku])).rows[0];
 assert.ok(changed.aliases.includes('cutting tool'));assert.equal(changed.local_names.ta,'சிவப்பு இடுக்கி');
 assert.equal(changed.image_path,created.imageUrl);
 response=await post(app,{...request,name:'Different plier'});assert.equal(response.statusCode,409);
}));

test('stock edits require current inventory version and cannot erase order reservations',()=>fixture(async(pool,app)=>{
 const image=await readFile('resources/catalog/ksmc-demo/images/H19.jpg');
 const initial={createId:randomUUID(),name:'Steel cutting plier',pricePaise:30000,unit:'piece',stock:8,
  photo:{id:randomUUID(),mimeType:'image/jpeg',data:image.toString('base64'),caption:''}};
 let response=await post(app,initial);assert.equal(response.statusCode,200,response.body);const created=response.json();
 await pool.query('UPDATE products SET reserved_stock=3,inventory_version=inventory_version+1 WHERE store_id=$1 AND sku=$2',[fixtureStore,created.sku]);
 const edit={sku:created.sku,version:created.version,inventoryVersion:created.inventoryVersion,name:initial.name,
  pricePaise:initial.pricePaise,unit:'piece',stock:2};
 response=await post(app,edit);assert.equal(response.statusCode,409,response.body);
 response=await post(app,{...edit,inventoryVersion:created.inventoryVersion+1});assert.equal(response.statusCode,409,response.body);
 const after=(await pool.query('SELECT stock,reserved_stock,version FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,created.sku])).rows[0];
 assert.equal(Number(after.stock),8);assert.equal(Number(after.reserved_stock),3);assert.equal(after.version,created.version);
 response=await post(app,{...edit,inventoryVersion:created.inventoryVersion+1,stock:7});assert.equal(response.statusCode,200,response.body);
 assert.equal(response.json().stock,7);
 const low=(await app.inject({url:'/api/owner/catalog?q=Steel%20cutting&stock=low',headers})).json();
 assert.equal(low.products[0].sku,created.sku);assert.equal(low.products[0].stock,4);
}));

test('shop name changes only after matching the name the owner saw',()=>fixture(async(pool,app)=>{
 const current=(await pool.query('SELECT name FROM stores WHERE id=$1',[fixtureStore])).rows[0].name as string;
 const postName=(name:string,expectedName:string)=>app.inject({method:'POST',url:'/api/owner/store/details',headers,payload:JSON.stringify({name,expectedName})});
 let response=await postName('New shop name',current);assert.equal(response.statusCode,200,response.body);
 response=await postName('Stale overwrite',current);assert.equal(response.statusCode,409,response.body);
 assert.equal((await pool.query('SELECT name FROM stores WHERE id=$1',[fixtureStore])).rows[0].name,'New shop name');
}));


test('a basic product edit preserves its measured selling increment',()=>fixture(async(pool,app)=>{
 await pool.query("UPDATE products SET quantity_step=0.1 WHERE store_id=$1 AND sku='H08'",[fixtureStore]);
 const prior=(await pool.query("SELECT * FROM products WHERE store_id=$1 AND sku='H08'",[fixtureStore])).rows[0];
 const response=await post(app,{sku:prior.sku,version:prior.version,name:prior.name,unit:prior.unit,pricePaise:Number(prior.price_paise)+100});
 assert.equal(response.statusCode,200,response.body);
 const after=(await pool.query('SELECT quantity_step FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,prior.sku])).rows[0];
 assert.equal(Number(after.quantity_step),0.1);
}));

test('variants are atomic, searchable individual SKUs with shared photo, distinct stock and durable retries',()=>fixture(async(pool,app)=>{
 const photo={id:randomUUID(),mimeType:'image/jpeg',data:(await readFile('resources/catalog/ksmc-demo/images/H19.jpg')).toString('base64'),caption:''};
 const row=(size:string,color:string,stock:number)=>({id:randomUUID(),label:'',size,color,pricePaise:20000,stock,unit:'tin',packContents:{value:Number(size.split(' ')[0]),unit:'ml'}});
 const payload={id:randomUUID(),name:'Fixture wall paint',photo,details:{localNames:{ta:'சுவர் பெயிண்ட்','ta-Latn':'suvar paint'},aliases:['wall paint','suvar paint','சுவர் பெயிண்ட்'],keywords:['paint'],specifications:{description:'Wall paint'}},variants:[row('500 ml','Pink',5),row('1000 ml','Pink',9),row('500 ml','White',3),row('1500 ml','Pink',7)]};
 const batch=(body:unknown,extra={})=>app.inject({method:'POST',url:'/api/owner/products/variants',headers:{...headers,...extra},payload:JSON.stringify(body)});
 assert.equal((await batch(payload,{'cf-access-jwt-assertion':''})).statusCode,403);
 let r=await batch(payload);assert.equal(r.statusCode,200,r.body);const result=r.json();assert.equal(result.products.length,4);assert.equal(new Set(result.products.map((p:any)=>p.sku)).size,4);
 const saved=(await pool.query('SELECT * FROM products WHERE store_id=$1 AND product_group_id=$2 ORDER BY name',[fixtureStore,result.groupId])).rows;
 assert.equal(saved.length,4);assert.equal(new Set(saved.map(p=>p.image_path)).size,1);assert.ok(saved.every(p=>p.product_group_name===payload.name&&p.name.startsWith(payload.name+' · ')));
 assert.ok(saved.every(p=>p.local_names.ta.includes(p.variant_label)));assert.ok(saved.every(p=>p.specifications.description.includes(p.variant_label)));
 const pink=result.products[0],white=result.products[2];
 for(const q of ['pink paint 500 ml','500ml pink paint','suvar paint pink 500 ml','சுவர் பெயிண்ட் Pink 500 ml']){r=await app.inject({url:'/api/owner/catalog?q='+encodeURIComponent(q),headers});assert.equal(r.statusCode,200,r.body);assert.deepEqual(r.json().products.map((p:any)=>p.sku),[pink.sku],q);assert.equal(r.json().products[0].productGroup.id,result.groupId);}
 const movement=()=>pool.query('SELECT count(*)::int AS n FROM inventory_movements WHERE store_id=$1 AND sku=$2',[fixtureStore,pink.sku]);const before=(await movement()).rows[0].n;
 await pool.query('UPDATE products SET reserved_stock=2 WHERE store_id=$1 AND sku=$2',[fixtureStore,pink.sku]);
 const restock={id:randomUUID(),expectedVersion:pink.inventoryVersion,kind:'restock',quantity:20,reason:'Received new tins'};
 const adjust=(body:unknown)=>app.inject({method:'POST',url:'/api/owner/catalog/products/'+pink.sku+'/stock',headers,payload:JSON.stringify(body)});
 r=await adjust(restock);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().onHand,25);assert.equal(r.json().available,23);
 assert.equal((await adjust(restock)).statusCode,200);assert.equal((await movement()).rows[0].n,before+1);
 assert.equal((await adjust({...restock,id:randomUUID()})).statusCode,409);
 r=await batch(payload);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().replayed,true);assert.equal(Number((await pool.query('SELECT stock FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,pink.sku])).rows[0].stock),25);
 assert.equal(Number((await pool.query('SELECT stock FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,white.sku])).rows[0].stock),3);
 assert.equal((await batch({...payload,name:'Changed name'})).statusCode,409);
 assert.equal((await batch({...payload,id:randomUUID(),sourceProduct:{sku:pink.sku,version:pink.version},photo:undefined,variants:[{...payload.variants[0],id:randomUUID()}]})).statusCode,409);
 const bad={...payload,id:randomUUID(),variants:[row('250 ml','Blue',1),{...row('750 ml','Blue',1),unit:'litre'}]};r=await batch(bad);assert.equal(r.statusCode,400,r.body);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM products WHERE store_id=$1 AND product_group_name=$2',[fixtureStore,payload.name])).rows[0].n,4);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM whatsapp_outbox')).rows[0].n,0);
 // Add to an existing group without changing any sibling's price, stock or photo.
 r=await batch({...payload,id:randomUUID(),photo:undefined,sourceProduct:{sku:pink.sku,version:pink.version},variants:[row('250 ml','Blue',11)]});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().groupId,result.groupId);
 const additional=r.json().products[0];assert.equal(additional.imageUrl,pink.imageUrl);
 // The same image can be overridden for one child through the ordinary guarded product editor.
 const change=await post(app,{sku:additional.sku,version:additional.version,name:'Fixture wall paint · Blue · 250 ml',unit:'tin',pricePaise:21000,photo:{...photo,id:randomUUID()}});assert.equal(change.statusCode,200,change.body);
}));

test('adding variants to an existing standalone product preserves its SKU and validates the source version and shop',()=>fixture(async(pool,app)=>{
 const source=(await pool.query("SELECT * FROM products WHERE store_id=$1 AND sku='H19'",[fixtureStore])).rows[0];
 const payload={id:randomUUID(),name:'Fixture pliers',sourceProduct:{sku:source.sku,version:source.version},sourceLabel:'Original',details:{},variants:[{id:randomUUID(),label:'Red handle',color:'',size:'',unit:'piece',pricePaise:30000,stock:8}]};
 const batch=(body:unknown)=>app.inject({method:'POST',url:'/api/owner/products/variants',headers,payload:JSON.stringify(body)});
 assert.equal((await batch({...payload,sourceProduct:{sku:'FOREIGN',version:1}})).statusCode,409);
 assert.equal((await batch({...payload,sourceProduct:{sku:source.sku,version:source.version+1}})).statusCode,409);
 let r=await batch(payload);assert.equal(r.statusCode,200,r.body);
 const current=(await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,source.sku])).rows[0];
 assert.equal(current.sku,source.sku);assert.equal(current.price_paise,source.price_paise);assert.equal(current.stock,source.stock);assert.equal(current.image_path,source.image_path);assert.equal(current.product_group_id,r.json().groupId);assert.equal(current.name,'Fixture pliers · Original');
 r=await batch(payload);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().replayed,true);
}));
