import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {Client} from '@modelcontextprotocol/client';
import {catalogMcpServer} from '../apps/server/src/mcp/catalog-server.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {importManifestSchema,importExample} from '../packages/contracts/catalog-import.js';
import {applyCatalogImportItem,previewCatalogImport,catalogImportGuide} from '../apps/server/src/services/catalog-import.js';
import {ownerProductPage,productPageSchema} from '../apps/server/src/http/owner-catalog-pages.js';
import {createApp} from '../apps/server/src/http/app.js';
const principal={storeId:fixtureStore,actor:'fixture-owner',canWrite:true,canPublish:true};
async function fixture(run:(pool:pg.Pool)=>Promise<void>){const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='import_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema});try{await setupDatabase(pool,'mock');await run(pool);}finally{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}}
const photo=async()=>({id:randomUUID(),mimeType:'image/jpeg',data:(await readFile('resources/catalog/ksmc-demo/images/H19.jpg')).toString('base64')});
test('agent import format rejects fabricated flags, paths, missing commercial facts, duplicate item IDs and over 200 rows',()=>{
 assert.ok(importManifestSchema.safeParse(importExample).success);
 for(const change of [{price:null},{quantity:null},{price:1.234},{image:'../tap.jpg'},{image:'https://example.test/tap.jpg'},{active:true},{unit:'length'}])assert.equal(importManifestSchema.safeParse({...importExample,products:[{...importExample.products[0],...change}]}).success,false,JSON.stringify(change));
 assert.equal(importManifestSchema.safeParse({...importExample,products:[importExample.products[0],importExample.products[0]]}).success,false);
 assert.equal(importManifestSchema.safeParse({...importExample,products:Array.from({length:201},(_,i)=>({...importExample.products[0],id:String(i),name:'Fixture '+i}))}).success,false);
 assert.ok(catalogImportGuide().agentPrompt.includes('integer paise'));
});
test('import adds canonical products directly, preserves originals, retries once, checks duplicates and isolates shops',()=>fixture(async pool=>{
 const item=importManifestSchema.parse(importExample).products[0],args={batchId:'test-batch',item,photo:await photo()};
 const preview=await previewCatalogImport(pool,principal,{...importExample,products:[item]});assert.equal(preview.rows[0].duplicates.length,0);
 const saved=await applyCatalogImportItem(pool,principal,args);assert.equal(saved.state,'published');assert.equal(saved.product.pricePaise,12000);assert.equal(saved.product.stock,20);
 assert.deepEqual(await applyCatalogImportItem(pool,principal,{...args,photo:{...args.photo,id:randomUUID()}}),saved);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,saved.sku])).rows[0].n,1);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM catalog_proposals WHERE store_id=$1 AND state='draft'",[fixtureStore])).rows[0].n,0);
 assert.deepEqual((await pool.query('SELECT original FROM catalog_proposal_assets WHERE id=$1',[saved.sourceAssetId])).rows[0].original,Buffer.from(args.photo.data,'base64'));
 assert.ok((await previewCatalogImport(pool,principal,{...importExample,products:[item]})).rows[0].duplicates.some(r=>r.id===saved.sku));
 await assert.rejects(()=>applyCatalogImportItem(pool,principal,{...args,item:{...item,price:121}}),/already used/);
 await assert.rejects(()=>applyCatalogImportItem(pool,principal,{...args,batchId:'different-batch'}),/already exists/);
 await assert.rejects(()=>applyCatalogImportItem(pool,{...principal,canPublish:false},args),/permission/);
 const c=await pool.connect();try{const before=await ownerProductPage(c,fixtureStore,productPageSchema.parse({stock:'attention'}));assert.ok(!before.products.some(p=>p.sku===saved.sku));await pool.query('UPDATE products SET stock=NULL WHERE store_id=$1 AND sku=$2',[fixtureStore,saved.sku]);const after=await ownerProductPage(c,fixtureStore,productPageSchema.parse({stock:'attention'}));assert.ok(after.products.some(p=>p.sku===saved.sku));const out=await ownerProductPage(c,fixtureStore,productPageSchema.parse({stock:'out'}));assert.ok(!out.products.some(p=>p.sku===saved.sku));}finally{c.release();}
}));
test('dashboard import is authenticated, rejects wrong origin, previews and adds without a draft stop',()=>fixture(async pool=>{
 const owner={hostname:'owner.example.test',issuer:'https://fixture.cloudflareaccess.com',audience:'fixture',email:'owner@example.test',storeId:fixtureStore};
 const app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,host:'127.0.0.1',port:3017,mediaDir:'/tmp/import-test',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'fixture'}));
 const headers={host:owner.hostname,'cf-access-jwt-assertion':'fixture',origin:'https://'+owner.hostname,'x-shopbot-owner':'1'};
 try{assert.equal((await app.inject({url:'/api/owner/catalog/import/guide',headers:{host:owner.hostname}})).statusCode,403);
 const guide=await app.inject({url:'/api/owner/catalog/import/guide',headers});assert.equal(guide.statusCode,200);assert.ok(guide.json().agentPrompt.includes('products.json'));
 const preview=await app.inject({method:'POST',url:'/api/owner/catalog/import/preview',headers,payload:importExample});assert.equal(preview.statusCode,200,preview.body);
 assert.equal((await app.inject({method:'POST',url:'/api/owner/catalog/import/preview',headers:{...headers,origin:'https://evil.test'},payload:importExample})).statusCode,403);
 const args={batchId:'owner-import',item:importExample.products[0],photo:await photo()};
 const saved=await app.inject({method:'POST',url:'/api/owner/catalog/import/item',headers,payload:args});assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().state,'published');
 const changed=await app.inject({method:'POST',url:'/api/owner/catalog/import/item',headers,payload:{...args,item:{...args.item,quantity:null}}});assert.equal(changed.statusCode,400);
 }finally{await app.close();}
}));

class MemoryTransport{peer?:MemoryTransport;onmessage?:(m:any)=>void;onclose?:()=>void;onerror?:(e:Error)=>void;async start(){}async send(m:any){queueMicrotask(()=>this.peer?.onmessage?.(m));}async close(){this.onclose?.();}}
test('MCP import guide, preview and actual host file handoff complete the direct import workflow',()=>fixture(async pool=>{
 const original=await photo(),server=catalogMcpServer(pool,principal,{download:async()=>({mimeType:'image/jpeg',data:original.data})}),client=new Client({name:'import-fixture',version:'1'}),a=new MemoryTransport(),b=new MemoryTransport();a.peer=b;b.peer=a;await server.connect(a);await client.connect(b);
 try{const tools=(await client.listTools()).tools;assert.equal(tools.length,17);assert.deepEqual(tools.find(t=>t.name==='catalog_import_item')!._meta?.['openai/fileParams'],['file']);
 const guide=await client.callTool({name:'catalog_import_guide',arguments:{}});assert.equal(guide.isError,undefined);assert.ok((guide.structuredContent as any).agentPrompt.includes('products.json'));
 const preview=await client.callTool({name:'catalog_import_preview',arguments:importExample});assert.equal(preview.isError,undefined,JSON.stringify(preview));
 const args={batchId:importExample.batchId,item:importExample.products[0],file:{download_url:'https://files.oaiusercontent.com/fixture',file_id:'fixture'}};
 const added=await client.callTool({name:'catalog_import_item',arguments:args});assert.equal(added.isError,undefined,JSON.stringify(added));assert.equal((added.structuredContent as any).state,'published');assert.deepEqual((await client.callTool({name:'catalog_import_item',arguments:args})).structuredContent,added.structuredContent);
 }finally{await client.close();await server.close();}
}));
