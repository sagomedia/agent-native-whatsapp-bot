import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';import {setupImageDemo} from '../apps/server/src/services/demo-catalog.js';import {fixtureStore} from '../profiles/hardware.js';import {createApp} from '../apps/server/src/http/app.js';import {reviewableSuggestion,GoogleCatalogGenerator,generateCatalogDraft,catalogGenerationRate,type CatalogSuggestion,type CatalogGenerator,type CatalogDraftInput} from '../apps/server/src/services/catalog-assistant.js';import {usageEstimate,worstCaseReservation} from '../apps/server/src/services/inference-budget.js';
const owner={hostname:'quick-owner.example.test',issuer:'https://test.cloudflareaccess.com',audience:'catalog-owner-application',email:'owner@example.test',storeId:fixtureStore};
const headers={host:owner.hostname,'cf-access-jwt-assertion':'synthetic',origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json'};
const suggestion:CatalogSuggestion={name:'Cutting plier',localNames:{ta:'கட்டிங் பிளையர்','ta-Latn':'cutting plier'},aliases:['cutting plier','கட்டிங் பிளையர்'],keywords:['plier'],unit:'piece',brand:null,specifications:[],familyId:null,newType:{label:'Cutting pliers',localNames:{ta:'கட்டிங் பிளையர்','ta-Latn':'cutting plier'},departmentId:'tools'},questions:['Confirm the size if the label does not show it.']};
const product={version:0,name:'Verified cutting plier',localNames:{},aliases:['cutting plier'],keywords:['plier'],unit:'piece',pricePaise:15000,stock:null,quantityStep:1,familyId:'',brand:'',specifications:{},active:false,verified:false};
async function fixture(run:(pool:pg.Pool)=>Promise<void>){const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='quick_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});try{await setupDatabase(pool,'mock');await setupImageDemo(pool,fixtureStore);await run(pool);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
const makeApp=(pool:pg.Pool,generator?:CatalogGenerator)=>createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,host:'127.0.0.1',port:3017,mediaDir:'/tmp/quick-test',owner},pool,undefined,undefined,async token=>{if(!token)throw Error('Missing token');return {email:owner.email,subject:'owner'};},undefined,generator);
const post=(app:any,path:string,payload:object,extra={})=>app.inject({method:'POST',url:'/api/owner/catalog'+path,headers:{...headers,...extra},payload});
test('suggestions are authenticated, normalized, idempotent and read-only; generated codes and types are saved only by the owner',async()=>fixture(async pool=>{
 let calls=0;const generator:CatalogGenerator={mode:'mock',generate:async input=>{calls++;if(input.image)assert.equal(input.image.image[0],255);return {output:suggestion,usage:null,truncated:false};}};
 const app=await makeApp(pool,generator);try{
 const before=(await pool.query('SELECT count(*) FROM products')).rows[0].count;
 const id=randomUUID(),input={id,description:'ஒரு கட்டிங் பிளையர்'};
 assert.equal((await post(app,'/suggest',input,{'cf-access-jwt-assertion':''})).statusCode,403);
 assert.equal((await post(app,'/suggest',input,{origin:'https://wrong.test'})).statusCode,403);assert.equal(calls,0);
 let r=await post(app,'/suggest',input);assert.equal(r.statusCode,200,r.body);assert.deepEqual(r.json().suggestion,reviewableSuggestion(suggestion,{description:input.description,nodes:[]}));assert.equal((await post(app,'/suggest',input)).json().cached,true);assert.equal(calls,1);
 assert.equal((await post(app,'/suggest',{...input,description:'Paint'})).statusCode,409);assert.equal(calls,1);assert.equal((await pool.query('SELECT count(*) FROM products')).rows[0].count,before);
 assert.equal((await pool.query('SELECT count(*) FROM messages')).rows[0].count,'0');assert.equal((await pool.query('SELECT count(*) FROM whatsapp_outbox')).rows[0].count,'0');
 const bytes=await readFile('resources/catalog/ksmc-demo/images/H19.jpg');r=await post(app,'/suggest',{id:randomUUID(),description:'',photo:{id:randomUUID(),mimeType:'image/jpeg',data:bytes.toString('base64'),caption:''}});assert.equal(r.statusCode,200,r.body);assert.equal(calls,2);
 assert.equal((await post(app,'/suggest',{id:randomUUID(),description:'name',pricePaise:42})).statusCode,400);
 const createId=randomUUID();r=await post(app,'/products',{...product,createId,newType:suggestion.newType});assert.equal(r.statusCode,200,r.body);assert.match(r.json().sku,/^SHOP-[A-F0-9]{16}$/);const first=r.json();assert.ok(first.familyId.startsWith('type-'));
 assert.equal((await post(app,'/products',{...product,createId,newType:suggestion.newType})).statusCode,409);
 r=await post(app,'/products',{...product,createId:randomUUID()});assert.equal(r.statusCode,200,r.body);assert.notEqual(r.json().sku,first.sku);assert.equal(r.json().familyId,'owner-other');
 assert.equal((await post(app,'/products',{...product,sku:'',version:1})).statusCode,400);assert.equal((await post(app,'/products',{...product,createId:randomUUID(),active:true})).statusCode,400);
 const data=(await app.inject({url:'/api/owner/catalog',headers})).json();assert.equal(data.aiAvailable,true);
 }finally{await app.close();}
}));
test('paid suggestions share the durable budget, settle reported usage once, retain uncertain holds, and reject fabricated fields',async()=>fixture(async pool=>{
 const reserved=worstCaseReservation(catalogGenerationRate);await pool.query('INSERT INTO inference_budgets(store_id,limit_microusd) VALUES($1,$2)',[fixtureStore,reserved*4]);let calls=0;
 const input:CatalogDraftInput={description:'Cutting plier',nodes:(await pool.query('SELECT id,parent_id,kind,label FROM catalog_nodes WHERE store_id=$1',[fixtureStore])).rows};
 const generator:CatalogGenerator={mode:'live',generate:async()=>{calls++;return {output:suggestion,usage:{promptTokenCount:100,candidatesTokenCount:50,totalTokenCount:150},responseModel:catalogGenerationRate.model,truncated:false};}};
 const id=randomUUID();await generateCatalogDraft(pool,fixtureStore,id,input,generator);await generateCatalogDraft(pool,fixtureStore,id,input,generator);assert.equal(calls,1);
 let b=(await pool.query('SELECT * FROM inference_budgets WHERE store_id=$1',[fixtureStore])).rows[0];assert.equal(Number(b.held_microusd),0);assert.equal(Number(b.committed_microusd),155);
 const invalid:CatalogGenerator={...generator,generate:async()=>({output:{...suggestion,pricePaise:100},usage:{promptTokenCount:100,candidatesTokenCount:50,totalTokenCount:150},responseModel:catalogGenerationRate.model,truncated:false})};await assert.rejects(generateCatalogDraft(pool,fixtureStore,randomUUID(),input,invalid),/reliable details/);
 b=(await pool.query('SELECT * FROM inference_budgets WHERE store_id=$1',[fixtureStore])).rows[0];assert.equal(Number(b.held_microusd),0);assert.equal(Number(b.committed_microusd),310);
 const uncertainId=randomUUID(),unknown:CatalogGenerator={...generator,generate:async()=>{calls++;throw Error('simulated timeout');}};await assert.rejects(generateCatalogDraft(pool,fixtureStore,uncertainId,input,unknown),/reliable details/);await assert.rejects(generateCatalogDraft(pool,fixtureStore,uncertainId,input,unknown),/did not complete/);assert.equal(calls,2);b=(await pool.query('SELECT * FROM inference_budgets WHERE store_id=$1',[fixtureStore])).rows[0];assert.equal(Number(b.held_microusd),reserved);
 const unknownFamily:CatalogGenerator={...generator,generate:async()=>({output:{...suggestion,familyId:'nonexistent',newType:null},usage:null,truncated:false})};await assert.rejects(generateCatalogDraft(pool,fixtureStore,randomUUID(),input,unknownFamily),/reliable details/);
 assert.equal((await pool.query("SELECT count(*) FROM products WHERE catalog_origin='owner'")).rows[0].count,'0');assert.equal((await pool.query('SELECT count(*) FROM order_requests')).rows[0].count,'0');
}));
test('concurrent suggestion requests cannot double-call the model or over-reserve the allowance',async()=>fixture(async pool=>{
 const reserved=worstCaseReservation(catalogGenerationRate);await pool.query('INSERT INTO inference_budgets(store_id,limit_microusd) VALUES($1,$2)',[fixtureStore,reserved]);const input:CatalogDraftInput={description:'plier',nodes:(await pool.query('SELECT id,parent_id,kind,label FROM catalog_nodes')).rows};let release!:()=>void,started!:()=>void,calls=0;const begin=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>release=r);
 const generator:CatalogGenerator={mode:'live',generate:async()=>{calls++;started();await gate;return {output:suggestion,usage:{promptTokenCount:100,candidatesTokenCount:50,totalTokenCount:150},responseModel:catalogGenerationRate.model,truncated:false};}};
 const id=randomUUID(),first=generateCatalogDraft(pool,fixtureStore,id,input,generator);await begin;await assert.rejects(generateCatalogDraft(pool,fixtureStore,id,input,generator),/still processing/);await assert.rejects(generateCatalogDraft(pool,fixtureStore,randomUUID(),input,generator),/exhausted/);assert.equal(calls,1);release();await first;assert.equal(Number((await pool.query('SELECT held_microusd FROM inference_budgets')).rows[0].held_microusd),0);
}));

test('Google token modality metadata cannot block the shop budget or lose the known cost',async()=>{
 const generator=new GoogleCatalogGenerator('synthetic-not-a-key',{generateContent:async()=>({text:JSON.stringify(suggestion),modelVersion:catalogGenerationRate.model,usageMetadata:{promptTokenCount:100,candidatesTokenCount:50,totalTokenCount:150,promptTokensDetails:[{modality:'TEXT',tokenCount:100}]},candidates:[{finishReason:'STOP'}]}) as any});
 const result=await generator.generate({description:'cutting plier',nodes:[]},AbortSignal.timeout(1000));assert.deepEqual(usageEstimate(catalogGenerationRate,result),{microusd:155,violation:false});assert.deepEqual(result.output,suggestion);
});

test('generated aliases and keywords cannot turn cutting pliers into combination pliers or wheels',()=>{
 const raw={...suggestion,aliases:['cutting plier','cutting plierr','Combination Pliers','Wire Cutter','Cutting Wheel'],keywords:['plier','wire cutter','cutting wheel','hand tool']};
 const safe=reviewableSuggestion(raw as any,{description:'cutting plier',nodes:[]});assert.ok(safe.aliases.includes('cutting plier'));assert.ok(safe.aliases.includes('cutting plierr'));assert.ok(safe.aliases.includes('கட்டிங் பிளையர்'));assert.ok(!safe.aliases.some(x=>/combination|wire|wheel/i.test(x)));assert.deepEqual(safe.keywords,['plier']);
 const photoSafe=reviewableSuggestion(raw as any,{description:'Asian Paints wall paint',image:{sourceHash:'fixture'} as any,nodes:[]});assert.match(photoSafe.questions[0],/photo and description/);
});

test('auto-fill reads lower form fields and a versioned saved photo without changing the product',async()=>fixture(async pool=>{
 const details={name:'PVC pipe cuter',localNames:{ta:'பைப் கட்டர்','ta-Latn':''},brand:'Owner supplied',unit:'pair' as const,type:'Pipe cutters',specifications:[{key:'capacity',value:'42mm'}]};let calls=0;const inputs:CatalogDraftInput[]=[];
 const generator:CatalogGenerator={mode:'mock',generate:async input=>{calls++;inputs.push(input);return {output:suggestion,usage:null,truncated:false};}},app=await makeApp(pool,generator);
 try{
 let r=await post(app,'/suggest',{id:randomUUID(),details});assert.equal(r.statusCode,200,r.body);assert.deepEqual(inputs.at(-1)?.details,details);assert.equal(r.json().suggestion.unit,'pair');assert.equal(inputs.at(-1)?.description,'');assert.equal(inputs.at(-1)?.image,undefined);
 const p=(await pool.query("SELECT * FROM products WHERE store_id=$1 AND sku='H19'",[fixtureStore])).rows[0];const id=randomUUID(),payload={id,details,existingProduct:{sku:p.sku,version:p.version}};
 r=await post(app,'/suggest',payload);assert.equal(r.statusCode,200,r.body);assert.ok(inputs.at(-1)?.image?.image.length);assert.deepEqual(inputs.at(-1)?.details,details);assert.equal((await post(app,'/suggest',payload)).json().cached,true);assert.equal(calls,2);
 assert.equal((await post(app,'/suggest',{...payload,details:{...details,brand:'Changed'}})).statusCode,409);assert.equal(calls,2);
 assert.equal((await post(app,'/suggest',{...payload,id:randomUUID(),existingProduct:{sku:p.sku,version:p.version+1}})).statusCode,409);assert.equal((await post(app,'/suggest',{...payload,id:randomUUID(),existingProduct:{sku:'OTHER-SHOP-SKU',version:1}})).statusCode,404);assert.equal(calls,2);
 assert.deepEqual((await pool.query("SELECT * FROM products WHERE store_id=$1 AND sku='H19'",[fixtureStore])).rows[0],p);
 assert.equal((await post(app,'/suggest',{id:randomUUID(),details:{...details,pricePaise:150}})).statusCode,400);
 }finally{await app.close();}
}));
test('auto-fill uses a saved custom photo on hidden products and a replacement overrides its old photo',async()=>fixture(async pool=>{
 let last:CatalogDraftInput|undefined;const generator:CatalogGenerator={mode:'mock',generate:async input=>{last=input;return {output:suggestion,usage:null,truncated:false};}},app=await makeApp(pool,generator);
 try{
 const created=await post(app,'/products',{...product,createId:randomUUID()});assert.equal(created.statusCode,200,created.body);const saved=created.json();const photo={id:randomUUID(),mimeType:'image/jpeg',data:(await readFile('resources/catalog/ksmc-demo/images/H19.jpg')).toString('base64'),caption:''};const uploaded=await post(app,'/products/'+saved.sku+'/photo',photo,{'x-product-version':String(saved.version)});assert.equal(uploaded.statusCode,200,uploaded.body);
 const version=uploaded.json().version;const r=await post(app,'/suggest',{id:randomUUID(),existingProduct:{sku:saved.sku,version},description:'pipe cutter'});assert.equal(r.statusCode,200,r.body);assert.ok(last?.image?.image.length);assert.equal((await pool.query('SELECT active FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,saved.sku])).rows[0].active,false);
 await pool.query('UPDATE products SET image_path=$1 WHERE store_id=$2 AND sku=$3',['/catalog-images/custom/'+randomUUID()+'.jpg',fixtureStore,saved.sku]);
 const override=await post(app,'/suggest',{id:randomUUID(),existingProduct:{sku:saved.sku,version},photo,description:'replacement'});assert.equal(override.statusCode,200,override.body);assert.ok(last?.image?.image.length);assert.equal(last?.description,'replacement');
 assert.equal((await pool.query('SELECT count(*) FROM whatsapp_outbox')).rows[0].count,'0');
 }finally{await app.close();}
}));
