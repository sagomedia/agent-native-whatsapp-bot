import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import pg from 'pg';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {createApp} from '../apps/server/src/http/app.js';
import {fixtureStore} from '../profiles/hardware.js';
import {catalogWrite,createProposal,updateProposal,publishProposal,prepareProposalAsset,addProposalAsset,listProposals} from '../apps/server/src/services/catalog-proposals.js';
import {importCatalogPackage} from '../apps/server/src/services/catalog-package.js';
import {discoverProducts} from '../apps/server/src/services/catalog-discovery.js';
const owner={hostname:'draft-owner.example.test',issuer:'https://test.cloudflareaccess.com',audience:'draft-test',email:'merchant@example.test',storeId:fixtureStore};
const headers={host:owner.hostname,'cf-access-jwt-assertion':'synthetic',origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json'};
const verification={identity:true,photo:true,sellingUnit:true,price:true,stock:true};
const finalProduct={sku:'APPROVED-PLIER',version:0,name:'Fixture exact cutting plier',localNames:{ta:'சோதனை பிளையர்'},aliases:['fixture plier'],keywords:['plier'],unit:'piece',priceStatus:'priced',pricePaise:15000,stock:4,quantityStep:1,familyId:'',brand:'Fixture',specifications:{size:'8 inch'},active:true,verified:true,verification};
async function fixture(run:(pool:pg.Pool,schema:string)=>Promise<void>){const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='proposal_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});try{await setupDatabase(pool,'mock');await run(pool,schema);}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
const input=()=>({id:randomUUID(),batchId:'test-import',clientItemId:'item-1',details:{name:'Unverified plier'},provenance:{source:'test fixture',issues:['Merchant must verify']}});
const write=<T>(pool:pg.Pool,id:string,fn:Parameters<typeof catalogWrite<T>>[5])=>catalogWrite(pool,fixtureStore,'synthetic-test','proposal_test',id,fn);
const post=(app:Awaited<ReturnType<typeof createApp>>,path:string,payload:unknown,h=headers)=>app.inject({method:'POST',url:'/api/owner/catalog'+path,headers:h,payload:JSON.stringify(payload)});

test('partial drafts are idempotent, stay unpublished and reject conflicting retries, stale edits and foreign-shop access',()=>fixture(async pool=>{
 const p=input();let r=await write(pool,p.id,c=>createProposal(c,fixtureStore,'test',p));assert.equal(r.version,1);
 assert.equal((await write(pool,p.id,c=>createProposal(c,fixtureStore,'test',p))).replayed,true);
 assert.equal((await pool.query('SELECT count(*) FROM products WHERE sku=$1',[finalProduct.sku])).rows[0].count,'0');
 await assert.rejects(write(pool,p.id,c=>createProposal(c,fixtureStore,'test',{...p,details:{name:'Different'}})),/different content/);
 await assert.rejects(write(pool,p.id,c=>createProposal(c,fixtureStore,'test',{...p,clientItemId:'other',details:{name:'Bypass',active:true,verified:true}})));
 r=await write(pool,p.id,c=>updateProposal(c,fixtureStore,{id:p.id,version:1,details:{name:'Reviewed plier',unit:'can'}}));assert.equal(r.version,2);
 await assert.rejects(write(pool,p.id,c=>updateProposal(c,fixtureStore,{id:p.id,version:1,details:{name:'Stale'}})),/changed/);
 const foreign=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other','true')",[foreign]);
 await assert.rejects(catalogWrite(pool,foreign,'other','test',p.id,c=>updateProposal(c,foreign,{id:p.id,version:2,details:{name:'Intrusion'}})),/not found/);
 assert.equal((await pool.query('SELECT count(*) FROM owner_audit WHERE action=$1',['proposal_test'])).rows[0].count,'3');
}));

test('owner approval checks each fact, publishes atomically and keeps original source photos private',()=>fixture(async pool=>{
 const app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,host:'127.0.0.1',port:3017,mediaDir:'/tmp/test',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'owner'}));
 try{
  const p=input();assert.equal((await post(app,'/proposals',p,{...headers,origin:'https://other.test'})).statusCode,403);assert.equal((await post(app,'/proposals',p)).statusCode,200);
  const bytes=await readFile('resources/catalog/ksmc-demo/images/H19.jpg'),photo={id:randomUUID(),mimeType:'image/jpeg',data:bytes.toString('base64'),caption:''};
  let staged=await post(app,'/proposals/photo',{proposalId:p.id,version:1,photo,matchKind:'family_only'});assert.equal(staged.statusCode,200,staged.body);let version=staged.json().version;const asset=staged.json().id;
  const privateImage='/api/owner/catalog/proposals/'+p.id+'/photos/'+asset;
  assert.equal((await app.inject({url:privateImage,headers:{host:owner.hostname}})).statusCode,403);
  const original=await app.inject({url:privateImage+'?original=1',headers});assert.ok(original.rawPayload.equals(bytes));assert.equal(original.headers['cache-control'],'private, no-store');
  assert.equal((await post(app,'/proposals/publish',{id:p.id,version,product:finalProduct,assetId:asset})).statusCode,400);
  for(const key of Object.keys(verification))assert.equal((await post(app,'/proposals/publish',{id:p.id,version,product:{...finalProduct,verification:{...verification,[key]:false}},withoutPhoto:true})).statusCode,400,key);
  assert.equal((await pool.query('SELECT count(*) FROM products WHERE sku=$1',[finalProduct.sku])).rows[0].count,'0');
  const published=await post(app,'/proposals/publish',{id:p.id,version,product:finalProduct,withoutPhoto:true});assert.equal(published.statusCode,200,published.body);
  const c=await pool.connect();try{assert.ok((await discoverProducts(c,{storeId:fixtureStore,conversationId:fixtureStore,role:'customer',actor:'test'},'சோதனை பிளையர்')).products.some(p=>p.sku===finalProduct.sku));}finally{c.release();}
  assert.equal((await post(app,'/proposals/publish',{id:p.id,version,product:finalProduct,withoutPhoto:true})).statusCode,409);
  const saved=(await pool.query('SELECT * FROM products WHERE sku=$1',[finalProduct.sku])).rows[0];assert.equal(saved.image_path,null);assert.deepEqual(saved.merchant_verification,verification);
  const edit={...input(),id:randomUUID(),clientItemId:'edit-1',base:{sku:finalProduct.sku,version:saved.version},details:{name:'Draft replacement'}};assert.equal((await post(app,'/proposals',edit)).statusCode,200);assert.equal((await pool.query('SELECT name,active,version FROM products WHERE sku=$1',[finalProduct.sku])).rows[0].name,finalProduct.name);
  await pool.query('UPDATE products SET version=version+1 WHERE sku=$1',[finalProduct.sku]);assert.equal((await post(app,'/proposals/publish',{id:edit.id,version:1,product:{...finalProduct,version:saved.version}})).statusCode,409);
  assert.equal((await pool.query("SELECT state FROM catalog_proposals WHERE id=$1",[edit.id])).rows[0].state,'draft');
  let hidden=await post(app,'/products/'+finalProduct.sku+'/hide',{version:saved.version});assert.equal(hidden.statusCode,409);hidden=await post(app,'/products/'+finalProduct.sku+'/hide',{version:saved.version+1});assert.equal(hidden.statusCode,200,hidden.body);assert.equal(hidden.json().active,false);
  assert.equal((await post(app,'/proposals/reject',{id:edit.id,version:1})).statusCode,200);assert.equal((await pool.query('SELECT state FROM catalog_proposals WHERE id=$1',[edit.id])).rows[0].state,'rejected');
 }finally{await app.close();}
}));

test('real stdio MCP handshake creates a draft and photo but exposes no publication tool; merchant publishes through the same service',()=>fixture(async(pool,schema)=>{
 const db=new URL(process.env.DATABASE_URL!);db.searchParams.set('options','-c search_path='+schema);
 const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','apps/server/src/mcp/stdio.ts'],cwd:process.cwd(),env:{PATH:process.env.PATH!,SHOPBOT_MCP_DATABASE_URL:db.toString(),SHOPBOT_MCP_STORE_ID:fixtureStore,SHOPBOT_MCP_ACTOR:'codex-synthetic-test'},stderr:'pipe'});
 const client=new Client({name:'shopbot-integration-test',version:'1.0.0'});
 try{
  await client.connect(transport);const tools=(await client.listTools()).tools.map(t=>t.name);assert.deepEqual(tools.sort(),['catalog_import_guide','catalog_import_preview','catalog_get_product','catalog_check_duplicates','workflow_status','catalog_drafts','catalog_edit_draft','catalog_inventory','catalog_propose','catalog_search','catalog_stage_photo','catalog_context','catalog_get_draft','catalog_prepare','catalog_attach_media','catalog_review'].sort());
  const inventory=await client.callTool({name:'catalog_inventory',arguments:{limit:1}});const page=JSON.parse((inventory.content[0] as {text:string}).text);assert.equal(page.products.length,1);assert.ok(page.nextCursor);
  const second=await client.callTool({name:'catalog_inventory',arguments:{limit:1,afterSku:page.nextCursor}});assert.notEqual(JSON.parse((second.content[0] as {text:string}).text).products[0].sku,page.products[0].sku);
  const p=input(),created=await client.callTool({name:'catalog_propose',arguments:p});assert.equal(created.isError,undefined);const result=JSON.parse((created.content[0] as {text:string}).text);assert.equal(result.id,p.id);
  const bytes=await readFile('resources/catalog/ksmc-demo/images/H19.jpg');const staged=await client.callTool({name:'catalog_stage_photo',arguments:{proposalId:p.id,version:1,photo:{id:randomUUID(),mimeType:'image/jpeg',data:bytes.toString('base64'),caption:''},matchKind:'exact'}});assert.equal(staged.isError,undefined);const image=JSON.parse((staged.content[0] as {text:string}).text);
  await assert.rejects(client.callTool({name:'catalog_publish',arguments:{id:p.id}}));
  const unapproved=await client.callTool({name:'catalog_search',arguments:{query:finalProduct.sku}});assert.equal(JSON.parse((unapproved.content[0] as {text:string}).text).products.length,0);
  await write(pool,p.id,c=>publishProposal(c,fixtureStore,{id:p.id,version:image.version,product:finalProduct,assetId:image.id}));
  const search=await client.callTool({name:'catalog_search',arguments:{query:finalProduct.sku}});assert.equal(JSON.parse((search.content[0] as {text:string}).text).products[0].sku,finalProduct.sku);
  assert.equal((await pool.query('SELECT sha256 FROM catalog_proposal_assets WHERE proposal_id=$1',[p.id])).rows[0].sha256,createHash('sha256').update(bytes).digest('hex'));
 }finally{await client.close();}
}));

test('the supplied 100-product package passes app intake, retains 100 originals and replays without publishing or inventing merchant prices',{timeout:240000},()=>fixture(async pool=>{
 const path=resolve('../../01-Input/catalog-100-corrected');const result=await importCatalogPackage(pool,fixtureStore,'catalog100-test',path);assert.equal(result.failed,0,JSON.stringify(result.results.filter(r=>r.error)));assert.equal(result.staged,100);assert.equal(result.published,0);
 assert.equal((await pool.query('SELECT count(*) FROM catalog_proposal_assets')).rows[0].count,'100');
 const c=await pool.connect();try{const rows=await listProposals(c,fixtureStore);assert.equal(rows.length,100);assert.ok(rows.find(r=>r.details.sku==='CAT100-002')?.provenance.issues.some((i:string)=>i.includes('SIZE-MAPPING CONFLICT')));for(const row of rows){assert.equal(row.state,'draft');assert.equal(row.details.pricePaise,0);assert.equal(row.details.stock,null);assert.equal(row.details.priceStatus,'confirm');assert.equal(row.details.active,undefined);assert.equal(row.assets.length,1);}assert.equal((await discoverProducts(c,{storeId:fixtureStore,conversationId:fixtureStore,role:'customer',actor:'test'},'CAT100-001')).products.length,0);}finally{c.release();}
 const replay=await importCatalogPackage(pool,fixtureStore,'catalog100-test',path);assert.equal(replay.failed,0);assert.equal(replay.replayed,100);assert.equal((await pool.query('SELECT count(*) FROM catalog_proposals')).rows[0].count,'100');assert.equal((await pool.query('SELECT count(*) FROM catalog_proposal_assets')).rows[0].count,'100');
}));
