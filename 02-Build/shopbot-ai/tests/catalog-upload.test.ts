import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {Client} from '@modelcontextprotocol/client';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {catalogMcpServer} from '../apps/server/src/mcp/catalog-server.js';
import {resolveCatalogUpload,validateCatalogUpload} from '../apps/server/src/services/catalog-upload.js';
import {catalogFileUrl} from '../apps/server/src/services/catalog-file-handoff.js';
const id=()=>randomUUID();
const principal={storeId:fixtureStore,actor:'upload-test-owner',canWrite:true,canPublish:true};
const details={name:'Upload regression product',unit:'piece',pricePaise:5000,stock:30};
class Transport{peer?:Transport;onmessage?:(m:any)=>void;onclose?:()=>void;onerror?:(e:Error)=>void;async start(){}async send(m:any){queueMicrotask(()=>this.peer?.onmessage?.(m));}async close(){this.onclose?.();}}
async function connect(pool:pg.Pool,actor:string,run:(c:Client)=>Promise<void>){const server=catalogMcpServer(pool,{...principal,actor}),client=new Client({name:'upload-fixture',version:'1'}),a=new Transport(),b=new Transport();a.peer=b;b.peer=a;await server.connect(a);await client.connect(b);try{await run(client);}finally{await client.close();await server.close();}}
async function fixture(run:(pool:pg.Pool)=>Promise<void>){assert.ok(process.env.DATABASE_URL);const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='upload_'+id().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema});try{await setupDatabase(pool,'mock');await run(pool);}finally{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}}
async function photo(){return {id:id(),mimeType:'image/jpeg' as const,data:(await readFile('resources/catalog/ksmc-demo/images/H19.jpg')).toString('base64')};}

test('JPG, PNG and WebP byte signatures correct MIME labels before full decoding',async()=>{
 const original=await photo();
 for(const [codec,mimeType]of [['png','image/png'],['libwebp','image/webp']] as const){
  const converted=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-threads','1','-i','pipe:0','-frames:v','1','-f','image2pipe','-vcodec',codec,'pipe:1'],{input:Buffer.from(original.data,'base64'),maxBuffer:2097152});assert.equal(converted.status,0,converted.stderr.toString());
  const p={...original,data:converted.stdout.toString('base64')};const resolved=await resolveCatalogUpload({photo:p});assert.equal(resolved.mimeType,mimeType);assert.equal(resolved.data,p.data);
  const checked=await validateCatalogUpload({photo:p});assert.equal(checked.valid,true);assert.equal(checked.mimeType,mimeType);assert.equal(checked.previewCount,3);assert.equal(checked.persisted,false);
 }
 const checked=await validateCatalogUpload({photo:original});assert.equal(checked.mimeType,'image/jpeg');
});

test('paths, arbitrary URLs, placeholder bytes and ambiguous transfers fail clearly without fetching paths',async()=>{
 for(const url of ['file:///mnt/data/product.jpg','sandbox:/mnt/data/product.jpg','https://127.0.0.1/image.jpg','https://untrusted.example/image.jpg'])assert.throws(()=>catalogFileUrl(url),/actual file|Base64/);
 await assert.rejects(resolveCatalogUpload({photo:{id:id(),mimeType:'image/jpeg',data:Buffer.from('not a real photograph').toString('base64')}}),(e:any)=>e.code==='invalid_photo_bytes'&&/actual file/.test(e.message));
 const p=await photo();await assert.rejects(resolveCatalogUpload({photo:p,file:{download_url:'https://files.oaiusercontent.com/a',file_id:'a'}}),/exactly one/);
 await assert.rejects(resolveCatalogUpload({photo:JSON.stringify(p)}));
 await assert.rejects(validateCatalogUpload({photo:{id:id(),mimeType:'image/jpeg',data:Buffer.from([255,216,255,0]).toString('base64')}}),(e:any)=>e.code==='invalid_photo_bytes'&&/could not be read|no readable dimensions/.test(e.message));
});

test('MCP upload failure is recoverable with same operation ID, no draft, retained original and one inventory insertion',()=>fixture(async pool=>{
 const p=await photo(),operationId=id();
 await connect(pool,principal.actor,async client=>{
  const tools=(await client.listTools()).tools;for(const name of ['catalog_propose','catalog_drafts','catalog_edit_draft','catalog_stage_photo'])assert.ok(!tools.some(t=>t.name===name));
  const fileTool=tools.find(t=>t.name==='catalog_add_product')!;assert.deepEqual(fileTool._meta?.['openai/fileParams'],['file']);
  const caps=await client.callTool({name:'catalog_media_capabilities',arguments:{}});assert.equal((caps.structuredContent as any).localPathsSupported,false);
  const bad=await client.callTool({name:'catalog_add_product',arguments:{operationId,details,file:{download_url:'sandbox:/mnt/data/product.webp',file_id:'local'}}});assert.ok(bad.isError);const failure=bad.structuredContent as any;assert.equal(failure.error,'unsupported_file_handoff');assert.equal(failure.stage,'photo_upload');assert.ok(failure.referenceId);assert.match(failure.message,/Base64/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_proposals')).rows[0].n,0);
  const status=await client.callTool({name:'workflow_status',arguments:{operationId}});assert.equal((status.structuredContent as any).operation,null);assert.equal((status.structuredContent as any).failure.details.referenceId,failure.referenceId);
  await connect(pool,'different-owner-agent',async other=>{const hidden=await other.callTool({name:'workflow_status',arguments:{operationId}});assert.equal((hidden.structuredContent as any).failure,null);});
  const good=await client.callTool({name:'catalog_add_product',arguments:{operationId,details,photo:{...p,mimeType:'image/webp'}}});assert.equal(good.isError,undefined,JSON.stringify(good));const saved=good.structuredContent as any;assert.equal(saved.state,'published');
  const replay=await client.callTool({name:'catalog_add_product',arguments:{operationId,details,photo:p}});assert.deepEqual(replay.structuredContent,saved);
  const original=(await pool.query('SELECT original,mime_type FROM catalog_proposal_assets WHERE id=$1',[saved.sourceAssetId])).rows[0];assert.deepEqual(original.original,Buffer.from(p.data,'base64'));assert.equal(original.mime_type,'image/jpeg');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_movements WHERE sku=$1',[saved.sku])).rows[0].n,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM catalog_proposals WHERE state='draft'")).rows[0].n,0);
  const done=await client.callTool({name:'workflow_status',arguments:{operationId}});assert.ok((done.structuredContent as any).operation);assert.equal((done.structuredContent as any).failure,null);
  const rejected=await client.callTool({name:'catalog_prepare',arguments:{operationId:id(),details:{name:'Do not save new-product drafts'}}});assert.ok(rejected.isError);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM provider_attempts')).rows[0].n,0);assert.equal((await pool.query('SELECT count(*)::int AS n FROM whatsapp_outbox')).rows[0].n,0);
  const audit=JSON.stringify((await pool.query("SELECT details FROM owner_audit WHERE action LIKE 'mcp_catalog_failed_%'")).rows);assert.ok(!audit.includes(p.data));assert.ok(!audit.includes('download_url'));
 });
}));
