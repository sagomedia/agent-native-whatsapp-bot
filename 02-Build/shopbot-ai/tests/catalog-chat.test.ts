import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {Client} from '@modelcontextprotocol/client';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {createApp} from '../apps/server/src/http/app.js';
import {fixtureStore} from '../profiles/hardware.js';
import {CatalogOAuth} from '../apps/server/src/mcp/oauth.js';
import {catalogMcpServer} from '../apps/server/src/mcp/catalog-server.js';
import {catalogContext,prepareChatDraft,getChatDraft,attachChatMedia,reviewChatDraft,commitChatDraft,chatHash,type CatalogPrincipal} from '../apps/server/src/services/catalog-chat.js';
import {catalogFileUrl,publicFileAddress} from '../apps/server/src/services/catalog-file-handoff.js';
import {migrateCatalogChat} from '../apps/server/src/db/catalog-chat.js';
import {adjustStock} from '../apps/server/src/services/inventory.js';
import {catalogWrite} from '../apps/server/src/services/catalog-proposals.js';

const owner={hostname:'chat-owner.example.test',issuer:'https://fixture.cloudflareaccess.com',audience:'catalog-chat-test',email:'owner@example.test',storeId:fixtureStore};
const remote={publicUrl:'https://chat-mcp.example.test/mcp'};
const principal:CatalogPrincipal={storeId:fixtureStore,actor:'trusted-local-owner-agent',canWrite:true,canPublish:true};
const fields={name:'Fixture photographed product',unit:'piece',pricePaise:25000,priceStatus:'priced',stock:null,aliases:['garden cutter','செடி கத்தரி'],localNames:{ta:'சோதனை தயாரிப்பு','ta-Latn':'sothanai product'},brand:'Fixture',specifications:{size:'8 inch'}};
const op=()=>randomUUID();
async function photo(sku='H19'){return {id:randomUUID(),mimeType:'image/jpeg',data:(await readFile(`resources/catalog/ksmc-demo/images/${sku}.jpg`)).toString('base64')};}
async function fixture(run:(pool:pg.Pool)=>Promise<void>){
 assert.ok(process.env.DATABASE_URL);const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='chat_'+op().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema});try{await setupDatabase(pool,'mock');await run(pool);}finally{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
}
async function draft(pool:pg.Pool){let d=await prepareChatDraft(pool,principal,{operationId:op(),details:fields}) as any;const media=await attachChatMedia(pool,principal,{operationId:op(),id:d.id,version:d.version,kind:'original',matchKind:'exact',photo:await photo()}) as any;return {...d,version:media.version,assetId:media.id};}
async function review(pool:pg.Pool,d:any){return reviewChatDraft(pool,principal,{operationId:op(),id:d.id,version:d.version,assetId:d.assetId}) as Promise<any>;}
async function publishedPhotoProduct(pool:pg.Pool){
 const d=await draft(pool),r=await review(pool,d),saved=await commitChatDraft(pool,principal,{operationId:op(),reviewId:r.reviewId}) as any;
 return (await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,saved.sku])).rows[0];
}
async function authorized(pool:pg.Pool,publish=false,scope='catalog:read catalog:draft'){
 const oauth=new CatalogOAuth(pool,remote,owner),client=await oauth.register({client_name:'Synthetic owner-chat agent',redirect_uris:['https://claude.ai/oauth/callback']}),v=randomBytes(32).toString('base64url');
 const request=await oauth.prepare({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge:createHash('sha256').update(v).digest('base64url'),code_challenge_method:'S256',resource:remote.publicUrl,state:op(),scope});
 const decision=await oauth.consent({id:request.id,csrf:request.csrf,allow:true,publish});
 const token=await oauth.token({grant_type:'authorization_code',client_id:client.client_id,code:new URL(decision.redirect).searchParams.get('code'),redirect_uri:client.redirect_uris[0],code_verifier:v,resource:remote.publicUrl});
 const identity=(await oauth.authenticate('Bearer '+token.access_token))!;
 return {oauth,token,principal:{storeId:fixtureStore,actor:owner.email+'/mcp/'+identity.grantId,ownerActor:owner.email,resource:remote.publicUrl,grantId:identity.grantId,accessExpiresAt:identity.expiresAt,canWrite:identity.scopes.includes('catalog:draft'),canPublish:identity.scopes.includes('catalog:publish')} as CatalogPrincipal};
}

test('partial chat drafts ask only for missing facts, preserve corrections and replay exact operations',()=>fixture(async pool=>{
 const input={operationId:op(),details:{name:'New cutter'}};let d=await prepareChatDraft(pool,principal,input) as any;assert.deepEqual(await prepareChatDraft(pool,principal,input),d);
 await assert.rejects(prepareChatDraft(pool,principal,{...input,details:{name:'Different'}}),/different content/);
 const partial=await getChatDraft(pool,principal,d.id);assert.ok(partial.missingRequired.includes('sellingUnit'));assert.ok(partial.missingRequired.includes('priceOrConfirmStatus'));assert.ok(!partial.missingRequired.includes('aliases'));
 const blocked=await reviewChatDraft(pool,principal,{operationId:op(),id:d.id,version:d.version}) as any;assert.equal(blocked.reviewId,undefined);assert.equal(blocked.nextStep.type,'ask_owner');
 d=await prepareChatDraft(pool,principal,{operationId:op(),id:d.id,version:d.version,details:{aliases:['seller corrected name'],unit:'piece',priceStatus:'confirm'}}) as any;
 await assert.rejects(prepareChatDraft(pool,principal,{operationId:op(),id:d.id,version:1,details:{name:'Stale'}}),/changed/);
 const current=await getChatDraft(pool,principal,d.id);assert.equal(current.details.name,'New cutter');assert.deepEqual(current.details.aliases,['seller corrected name']);
 const ready=await reviewChatDraft(pool,principal,{operationId:op(),id:d.id,version:d.version,withoutPhoto:true}) as any;assert.equal(ready.product.priceStatus,'confirm');assert.equal(ready.product.stock,null);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM products WHERE name='New cutter'")).rows[0].n,0);
}));

test('owner chat reviews a cleaned photo, publishes once, and preserves original bytes and multilingual names',()=>fixture(async pool=>{
 let d=await draft(pool);const original=d.assetId,source=await photo();
 const cleaned=await attachChatMedia(pool,principal,{operationId:op(),id:d.id,version:d.version,kind:'cleaned',sourceAssetId:original,matchKind:'exact',photo:await photo('H20')}) as any;d={...d,version:cleaned.version,assetId:cleaned.id};
 const r=await review(pool,d);assert.equal(r.photo.asset_kind,'cleaned');assert.equal(r.photo.source_asset_id,original);assert.match(r.sellingBasis,/1 piece/);
 const action={operationId:op(),reviewId:r.reviewId};const saved=await commitChatDraft(pool,principal,action) as any;assert.deepEqual(await commitChatDraft(pool,principal,action),saved);assert.equal(saved.authorization,'delegated_owner_grant');
 const p=(await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,saved.sku])).rows[0];assert.equal(p.price_paise,25000);assert.equal(p.stock,null);assert.ok(p.aliases.includes('செடி கத்தரி'));assert.match(p.image_path,/catalog-images\/custom/);
 assert.deepEqual((await pool.query('SELECT original FROM catalog_proposal_assets WHERE id=$1',[original])).rows[0].original,Buffer.from(source.data,'base64'));
 assert.equal((await getChatDraft(pool,principal,d.id)).state,'published');
 await assert.rejects(commitChatDraft(pool,principal,{...action,reviewId:op()}),/different content/);
 await assert.rejects(commitChatDraft(pool,principal,{operationId:op(),reviewId:r.reviewId}),/changed/);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM inventory_movements WHERE sku=$1",[saved.sku])).rows[0].n,0);
}));

test('changed fields, image identity, expired reviews and another actor invalidate publication',()=>fixture(async pool=>{
 let d=await draft(pool),r=await review(pool,d);
 await assert.rejects(commitChatDraft(pool,{...principal,actor:'another-agent'},{operationId:op(),reviewId:r.reviewId}),/another connection/);
 d={...d,...await prepareChatDraft(pool,principal,{operationId:op(),id:d.id,version:d.version,details:{aliases:['seller correction']}}) as any};
 await assert.rejects(commitChatDraft(pool,principal,{operationId:op(),reviewId:r.reviewId}),/changed/);
 r=await review(pool,d);await pool.query("UPDATE catalog_proposal_assets SET image_hash=repeat('f',64) WHERE id=$1",[d.assetId]);await assert.rejects(commitChatDraft(pool,principal,{operationId:op(),reviewId:r.reviewId}),/changed/);
 r=await review(pool,d);await pool.query("UPDATE catalog_chat_reviews SET expires_at=now()-interval '1 second' WHERE id=$1",[r.reviewId]);await assert.rejects(commitChatDraft(pool,principal,{operationId:op(),reviewId:r.reviewId}),/expired/);
 await assert.rejects(commitChatDraft(pool,principal,{operationId:op(),reviewId:r.reviewId,approved:true}));
}));

test('marketing/uncertain photos, wrong-store sources and fabricated approval fields cannot publish',()=>fixture(async pool=>{
 const d=await draft(pool),foreign=op();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other','true')",[foreign]);
 await assert.rejects(getChatDraft(pool,{...principal,storeId:foreign},d.id),/not found/);
 await assert.rejects(attachChatMedia(pool,principal,{operationId:op(),id:d.id,version:d.version,kind:'cleaned',sourceAssetId:op(),matchKind:'exact',photo:await photo('H20')}),/original/);
 const marketing=await attachChatMedia(pool,principal,{operationId:op(),id:d.id,version:d.version,kind:'marketing',sourceAssetId:d.assetId,matchKind:'exact',photo:await photo('H21')}) as any;
 await assert.rejects(reviewChatDraft(pool,principal,{operationId:op(),id:d.id,version:marketing.version,assetId:marketing.id}),/marketing or uncertain/);
 await assert.rejects(prepareChatDraft(pool,principal,{operationId:op(),details:{name:'Injected permission',active:true,verified:true}}));
 const uncertain=await attachChatMedia(pool,principal,{operationId:op(),id:d.id,version:marketing.version,kind:'original',matchKind:'unconfirmed',photo:await photo('H22')}) as any;
 await assert.rejects(attachChatMedia(pool,principal,{operationId:op(),id:d.id,version:uncertain.version,kind:'cleaned',sourceAssetId:uncertain.id,matchKind:'exact',photo:await photo('H23')}),/cannot establish exact identity/);
}));

test('published edits preserve identity and reject concurrent product and inventory changes',()=>fixture(async pool=>{
 const d=await draft(pool),r=await review(pool,d),saved=await commitChatDraft(pool,principal,{operationId:op(),reviewId:r.reviewId}) as any;
 let edit=await prepareChatDraft(pool,principal,{operationId:op(),base:{sku:saved.sku,version:saved.version},details:{aliases:['new alias']}}) as any;
 let checked=await reviewChatDraft(pool,principal,{operationId:op(),id:edit.id,version:edit.version}) as any;assert.equal(checked.product.sku,saved.sku);assert.equal(checked.product.pricePaise,25000);
 await catalogWrite(pool,fixtureStore,'owner','fixture_stock',op(),c=>adjustStock(c,fixtureStore,saved.sku,'owner',{id:op(),expectedVersion:1,kind:'count',quantity:10,reason:'Fixture shelf count'}));
 await assert.rejects(commitChatDraft(pool,principal,{operationId:op(),reviewId:checked.reviewId}),/changed/);
 checked=await reviewChatDraft(pool,principal,{operationId:op(),id:edit.id,version:edit.version}) as any;
 const updated=await commitChatDraft(pool,principal,{operationId:op(),reviewId:checked.reviewId}) as any;assert.equal(updated.sku,saved.sku);assert.equal(updated.version,saved.version+1);
 const p=(await pool.query('SELECT stock FROM products WHERE sku=$1',[saved.sku])).rows[0];assert.equal(Number(p.stock),10);
 edit=await prepareChatDraft(pool,principal,{operationId:op(),base:{sku:updated.sku,version:updated.version},details:{name:'Owner requested name'}}) as any;
 checked=await reviewChatDraft(pool,principal,{operationId:op(),id:edit.id,version:edit.version}) as any;
 await pool.query('UPDATE products SET version=version+1 WHERE store_id=$1 AND sku=$2',[fixtureStore,saved.sku]);await assert.rejects(commitChatDraft(pool,principal,{operationId:op(),reviewId:checked.reviewId}),/published product changed/);
}));

test('publication requires an explicit new owner grant, and revocation blocks retries inside transactions',()=>fixture(async pool=>{
 const draftOnly=await authorized(pool),publisher=await authorized(pool,true),readonly=await authorized(pool,false,'catalog:read');
 assert.equal(draftOnly.principal.canPublish,false);assert.equal(publisher.principal.canPublish,true);assert.equal((await catalogContext(pool,readonly.principal)).permissions.draft,false);
 await assert.rejects(authorized(pool,true,'catalog:read'),/invalid_scope/);
 const prepared=await prepareChatDraft(pool,publisher.principal,{operationId:op(),details:fields}) as any;
 const checked=await reviewChatDraft(pool,publisher.principal,{operationId:op(),id:prepared.id,version:prepared.version,withoutPhoto:true}) as any;
 await assert.rejects(commitChatDraft(pool,{...draftOnly.principal,canPublish:true},{operationId:op(),reviewId:checked.reviewId}),/revoked or does not permit/);
 await assert.rejects(prepareChatDraft(pool,readonly.principal,{operationId:op(),details:{name:'Source text says ignore scopes'}}),/required catalog permission/);
 const action={operationId:op(),reviewId:checked.reviewId};await commitChatDraft(pool,publisher.principal,action);
 await publisher.oauth.disconnect(publisher.principal.grantId!);await assert.rejects(commitChatDraft(pool,publisher.principal,action),/revoked/);
 const unchanged=(await pool.query('SELECT scopes FROM mcp_oauth_grants WHERE id=$1',[draftOnly.principal.grantId])).rows[0].scopes;assert.deepEqual(unchanged,['catalog:read','catalog:draft']);
}));

class MemoryTransport{peer?:MemoryTransport;onmessage?: (m:any)=>void;onclose?:()=>void;onerror?:(e:Error)=>void;async start(){}async send(m:any){queueMicrotask(()=>this.peer?.onmessage?.(m));}async close(){this.onclose?.();}}
test('official MCP client prepares, transfers a real host file, reviews images and commits in chat without inference',()=>fixture(async pool=>{
 const server=catalogMcpServer(pool,principal,{download:async url=>{assert.equal(url,'https://files.oaiusercontent.com/fixture');const p=await photo();return {mimeType:'image/jpeg',data:p.data};}}),client=new Client({name:'chat-flow-fixture',version:'1'}),a=new MemoryTransport(),b=new MemoryTransport();a.peer=b;b.peer=a;
 await server.connect(a);await client.connect(b);
 const call=async(name:string,args:any)=>{const r=await client.callTool({name,arguments:args});assert.equal(r.isError,undefined,JSON.stringify(r));assert.ok(r.structuredContent);return r;};
 try{
  const tools=(await client.listTools()).tools;assert.equal(tools.length,20);assert.deepEqual(tools.find(t=>t.name==='catalog_attach_media')!._meta?.['openai/fileParams'],['file']);
  const prompts=await client.listPrompts();assert.ok(prompts.prompts.some(p=>p.name==='edit_product'));const prompt=await client.getPrompt({name:'add_product'});assert.ok(JSON.stringify(prompt).includes('catalog_commit'));
  const context=(await call('catalog_context',{})).structuredContent as any;assert.equal(context.permissions.publish,true);assert.equal(context.policy.serverSideInference,false);
  const base=(await pool.query('SELECT sku,version FROM products WHERE store_id=$1 ORDER BY sku LIMIT 1',[fixtureStore])).rows[0];
  const prepared=(await call('catalog_prepare',{operationId:op(),base,details:fields})).structuredContent as any;
  const staged=(await call('catalog_attach_media',{operationId:op(),id:prepared.id,version:prepared.version,matchKind:'exact',kind:'original',file:{download_url:'https://files.oaiusercontent.com/fixture',file_id:'fixture-file'}})).structuredContent as any;
  const read=await call('catalog_get_edit',{id:prepared.id});assert.ok(read.content.some((c:any)=>c.type==='image'));
  const checked=await call('catalog_review',{operationId:op(),id:prepared.id,version:staged.version,assetId:staged.id});assert.ok(checked.content.some((c:any)=>c.type==='image'));
  const saved=(await call('catalog_commit',{operationId:op(),reviewId:(checked.structuredContent as any).reviewId})).structuredContent as any;assert.ok(saved.sku);
  const edited=(await call('catalog_prepare',{operationId:op(),base:{sku:saved.sku,version:saved.version},details:{aliases:['owner corrected alias']}})).structuredContent as any;
  const existing=await call('catalog_get_edit',{id:edited.id});assert.ok(existing.content.some((c:any)=>c.type==='image'));
  const kept=await call('catalog_review',{operationId:op(),id:edited.id,version:edited.version});assert.ok(kept.content.some((c:any)=>c.type==='image'));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM provider_attempts')).rows[0].n,0);
 }finally{await client.close();await server.close();}
}));

test('public HTTP owner consent grants chat publication explicitly while old draft and read scopes stay limited',()=>fixture(async pool=>{
 const app=await createApp({mode:'mock',host:'127.0.0.1',port:3049,databaseUrl:process.env.DATABASE_URL!,mediaDir:'/tmp/chat-fixture-media',owner,remoteMcp:remote},pool,undefined,undefined,async token=>{if(token!=='owner-fixture')throw Error();return {email:owner.email,subject:'owner'};});
 const rpc=async(token:string,name:string,args:any={})=>{const response=await app.inject({method:'POST',url:'/mcp',headers:{host:'chat-mcp.example.test',authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},payload:{jsonrpc:'2.0',id:1,method:name==='tools/list'?'tools/list':'tools/call',params:name==='tools/list'?{}:{name,arguments:args}}});assert.equal(response.statusCode,200,response.body);return JSON.parse(response.body.startsWith('event:')?response.body.split('\n').find(s=>s.startsWith('data: '))!.slice(6):response.body);};
 try{
  const publisher=await authorized(pool,true),old=await authorized(pool),read=await authorized(pool,false,'catalog:read');
  const yes=await rpc(publisher.token.access_token,'tools/list'),no=await rpc(old.token.access_token,'tools/list');assert.ok(yes.result.tools.some((t:any)=>t.name==='catalog_commit'));assert.ok(!no.result.tools.some((t:any)=>t.name==='catalog_commit'));
  const denied=await rpc(read.token.access_token,'catalog_prepare',{operationId:op(),details:{name:'Should fail'}});assert.ok(denied.error);
  const base=(await pool.query('SELECT sku,version FROM products WHERE store_id=$1 ORDER BY sku LIMIT 1',[fixtureStore])).rows[0];
  const p=(await rpc(publisher.token.access_token,'catalog_prepare',{operationId:op(),base,details:fields})).result.structuredContent;
  const r=(await rpc(publisher.token.access_token,'catalog_review',{operationId:op(),id:p.id,version:p.version})).result.structuredContent;
  const final=await rpc(publisher.token.access_token,'catalog_commit',{operationId:op(),reviewId:r.reviewId});assert.ok(final.result.structuredContent.sku);
  const unauthorized=await app.inject({method:'POST',url:'/api/owner/mcp/authorize',headers:{host:owner.hostname,'content-type':'application/json'},payload:{id:op(),csrf:'a'.repeat(43),allow:true,publish:true}});assert.equal(unauthorized.statusCode,403);
 }finally{await app.close();}
}));

test('alias-only edits preserve saved photos and reject both new and previously issued removal reviews',()=>fixture(async pool=>{
 const before=await publishedPhotoProduct(pool);
 assert.ok(before.image_path);
 const aliases=[...before.aliases,'ரச மட்டம்','ரசமட்டம்','rasa mattam','rasamattam'];
 const edit=await prepareChatDraft(pool,principal,{operationId:op(),base:{sku:before.sku,version:before.version},details:{aliases}}) as any;
 await assert.rejects(reviewChatDraft(pool,principal,{operationId:op(),id:edit.id,version:edit.version,withoutPhoto:true}),(e:any)=>e.code==='photo_removal_not_supported');
 const checked=await review(pool,edit);assert.equal(checked.photoAction,'preserve');assert.equal(checked.photo,null);
 // Reproduce a pre-upgrade review that explicitly requested image omission.
 const historical=(await pool.query('SELECT snapshot FROM catalog_chat_reviews WHERE id=$1',[checked.reviewId])).rows[0].snapshot;
 historical.withoutPhoto=true;
 await pool.query('UPDATE catalog_chat_reviews SET snapshot=$1,input_hash=$2 WHERE id=$3',[JSON.stringify(historical),chatHash(historical),checked.reviewId]);
 await assert.rejects(commitChatDraft(pool,principal,{operationId:op(),reviewId:checked.reviewId}),(e:any)=>e.code==='photo_removal_not_supported');
 assert.equal((await pool.query('SELECT image_path FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,before.sku])).rows[0].image_path,before.image_path);
 const fresh=await review(pool,edit),action={operationId:op(),reviewId:fresh.reviewId};
 const saved=await commitChatDraft(pool,principal,action) as any;assert.equal(saved.photoAction,'preserved');assert.deepEqual(await commitChatDraft(pool,principal,action),saved);
 const after=(await pool.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,before.sku])).rows[0];
 assert.deepEqual(after.aliases,aliases);
 for(const key of ['image_path','name','price_paise','stock','unit','inventory_version'])assert.deepEqual(after[key],before[key],key);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM catalog_proposal_assets WHERE proposal_id=$1',[edit.id])).rows[0].n,0);
}));

test('a product already missing a photo can receive metadata edits without an upload or omission flag',()=>fixture(async pool=>{
 const before=await publishedPhotoProduct(pool);
 const base=(await pool.query('UPDATE products SET image_path=NULL WHERE store_id=$1 AND sku=$2 RETURNING sku,version',[fixtureStore,before.sku])).rows[0];
 const edit=await prepareChatDraft(pool,principal,{operationId:op(),base,details:{aliases:['seller correction']}}) as any;
 const checked=await review(pool,edit);assert.deepEqual(checked.missingRequired,[]);assert.equal(checked.photoAction,'remain_without_photo');
 const saved=await commitChatDraft(pool,principal,{operationId:op(),reviewId:checked.reviewId}) as any;assert.equal(saved.photoAction,'remained_without_photo');
 assert.equal((await pool.query('SELECT image_path FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,base.sku])).rows[0].image_path,null);
}));

test('requested photo replacement succeeds, while a concurrent photo change invalidates an older metadata review',()=>fixture(async pool=>{
 const base=await publishedPhotoProduct(pool);
 const edit=await prepareChatDraft(pool,principal,{operationId:op(),base:{sku:base.sku,version:base.version},details:{aliases:['requested replacement']}}) as any;
 const source=await photo('H20');
 const attached=await attachChatMedia(pool,principal,{operationId:op(),id:edit.id,version:edit.version,kind:'original',matchKind:'exact',photo:source}) as any;
 const checked=await review(pool,{...edit,version:attached.version,assetId:attached.id});assert.equal(checked.photoAction,'replace');
 const saved=await commitChatDraft(pool,principal,{operationId:op(),reviewId:checked.reviewId}) as any;assert.equal(saved.photoAction,'replaced');
 const current=(await pool.query('SELECT sku,version,image_path,aliases FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,base.sku])).rows[0];assert.notEqual(current.image_path,base.image_path);
 assert.deepEqual((await pool.query('SELECT original FROM catalog_proposal_assets WHERE id=$1',[attached.id])).rows[0].original,Buffer.from(source.data,'base64'));
 const metadata=await prepareChatDraft(pool,principal,{operationId:op(),base:{sku:current.sku,version:current.version},details:{aliases:['stale change']}}) as any;
 const stale=await review(pool,metadata);
 await pool.query("UPDATE products SET image_path='/demo-images/H19.jpg' WHERE store_id=$1 AND sku=$2",[fixtureStore,base.sku]);
 await assert.rejects(commitChatDraft(pool,principal,{operationId:op(),reviewId:stale.reviewId}),(e:any)=>e.code==='stale_review');
 const after=(await pool.query('SELECT aliases,image_path FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,base.sku])).rows[0];assert.deepEqual(after.aliases,current.aliases);assert.equal(after.image_path,'/demo-images/H19.jpg');
}));

test('metadata publication rolls back if a storage-side update unexpectedly clears the saved photo',()=>fixture(async pool=>{
 const original=await publishedPhotoProduct(pool);
 const before=(await pool.query('SELECT sku,version,image_path,aliases FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,original.sku])).rows[0];assert.ok(before.image_path);
 const edit=await prepareChatDraft(pool,principal,{operationId:op(),base:{sku:before.sku,version:before.version},details:{aliases:['must roll back']}}) as any;
 const checked=await review(pool,edit);
 await pool.query("CREATE FUNCTION fixture_clear_photo() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.image_path:=NULL; RETURN NEW; END $$; CREATE TRIGGER fixture_photo_loss BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fixture_clear_photo();");
 await assert.rejects(commitChatDraft(pool,principal,{operationId:op(),reviewId:checked.reviewId}),(e:any)=>e.code==='photo_preservation_failed');
 const after=(await pool.query('SELECT sku,version,image_path,aliases FROM products WHERE store_id=$1 AND sku=$2',[fixtureStore,before.sku])).rows[0];assert.deepEqual(after,before);
 assert.equal((await pool.query('SELECT state FROM catalog_proposals WHERE id=$1',[edit.id])).rows[0].state,'draft');
}));

test('migration upgrades schema 46 without losing catalog records and rejects a conflicting version',()=>fixture(async pool=>{
 const products=(await pool.query('SELECT store_id,sku,price_paise FROM products ORDER BY store_id,sku')).rows;
 await pool.query('DROP TABLE catalog_chat_operations,catalog_chat_reviews');await pool.query('ALTER TABLE catalog_proposal_assets DROP COLUMN asset_kind,DROP COLUMN source_asset_id,DROP CONSTRAINT catalog_asset_identity');await pool.query('DELETE FROM schema_migrations WHERE version=47');
 await setupDatabase(pool,'mock');assert.deepEqual((await pool.query('SELECT store_id,sku,price_paise FROM products ORDER BY store_id,sku')).rows,products);await setupDatabase(pool,'mock');
 await pool.query('DROP TABLE catalog_chat_reviews');const c=await pool.connect();try{await assert.rejects(migrateCatalogChat(c),/collision/);}finally{c.release();}
}));

test('file handoff rejects private targets, hostile hosts and credentials',()=>{
 assert.equal(catalogFileUrl('https://files.oaiusercontent.com/photo?signature=fixture').hostname,'files.oaiusercontent.com');
 for(const url of ['https://127.0.0.1/x','file:///etc/hosts','http://files.oaiusercontent.com/x','https://files.oaiusercontent.com.evil.test/x','https://user:pass@files.oaiusercontent.com/x'])assert.throws(()=>catalogFileUrl(url));
 for(const ip of ['127.0.0.1','169.254.169.254','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1'])assert.equal(publicFileAddress(ip),false,ip);assert.equal(publicFileAddress('8.8.8.8'),true);assert.equal(publicFileAddress('2606:4700::1111'),true);
});

test('the dedicated draft SQL role can review existing photos without gaining product-write access',()=>fixture(async pool=>{
 const d=await draft(pool),checked=await review(pool,d),saved=await commitChatDraft(pool,principal,{operationId:op(),reviewId:checked.reviewId}) as any;
 const schema=(await pool.query('SELECT current_schema() AS schema')).rows[0].schema,role='draft_'+op().replaceAll('-','');
 let limited:pg.Pool|undefined;
 try{
  await pool.query(`CREATE ROLE ${role} NOLOGIN; GRANT USAGE ON SCHEMA ${schema} TO ${role}; GRANT SELECT ON stores,products,catalog_nodes,catalog_profiles,catalog_photos,catalog_image_variants TO ${role}; GRANT UPDATE(catalog_revision) ON stores TO ${role}; GRANT SELECT,INSERT,UPDATE ON catalog_proposals,catalog_proposal_assets TO ${role}; GRANT SELECT,INSERT ON catalog_chat_operations,catalog_chat_reviews TO ${role}; GRANT INSERT ON owner_audit TO ${role}; GRANT USAGE ON SEQUENCE owner_audit_sequence_seq TO ${role}`);
  limited=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema} -c role=${role}`});
  const actor={...principal,actor:'dedicated-draft-process',canPublish:false};
  const edit=await prepareChatDraft(limited,actor,{operationId:op(),base:{sku:saved.sku,version:saved.version},details:{aliases:['seller alternate name']}}) as any;
  const current=await getChatDraft(limited,actor,edit.id);assert.equal(current.details.aliases[0],'seller alternate name');
  const r=await reviewChatDraft(limited,actor,{operationId:op(),id:edit.id,version:edit.version}) as any;assert.equal(r.nextStep.type,'authorize_publish');
  const privilege=(await pool.query("SELECT has_table_privilege($1,'products','UPDATE') AS writable",[role])).rows[0];assert.equal(privilege.writable,false);
  await assert.rejects(commitChatDraft(limited,actor,{operationId:op(),reviewId:r.reviewId}),/required catalog permission/);
 }finally{await limited?.end();await pool.query(`DROP OWNED BY ${role}; DROP ROLE ${role}`);}
}));


test('public HTTP MCP recovers an attachment failure and publishes directly with corrected MIME bytes',()=>fixture(async pool=>{
 const app=await createApp({mode:'mock',host:'127.0.0.1',port:3049,databaseUrl:process.env.DATABASE_URL!,mediaDir:'/tmp/chat-upload-fixture',owner,remoteMcp:remote},pool,undefined,undefined,async()=>({email:owner.email,subject:'fixture'}));
 try{
  const publisher=await authorized(pool,true),operationId=op();
  const call=async(name:string,args:any)=>{const response=await app.inject({method:'POST',url:'/mcp',headers:{host:'chat-mcp.example.test',authorization:'Bearer '+publisher.token.access_token,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});assert.equal(response.statusCode,200,response.body);const body=JSON.parse(response.body.startsWith('event:')?response.body.split('\n').find(s=>s.startsWith('data: '))!.slice(6):response.body);return body.result;};
  const details={...fields,stock:30},original=await photo();
  const failed=await call('catalog_add_product',{operationId,details,file:{download_url:'sandbox:/mnt/data/product.jpg',file_id:'local'}});assert.equal(failed.structuredContent.error,'unsupported_file_handoff');
  const status=await call('workflow_status',{operationId});assert.equal(status.structuredContent.failure.details.operationId,operationId);
  const saved=await call('catalog_add_product',{operationId,details,photo:{...original,mimeType:'image/webp'}});assert.equal(saved.isError,undefined,JSON.stringify(saved));assert.equal(saved.structuredContent.state,'published');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM catalog_proposals WHERE state='draft'")).rows[0].n,0);
  const replay=await call('catalog_add_product',{operationId,details,photo:original});assert.deepEqual(replay.structuredContent,saved.structuredContent);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM inventory_movements WHERE sku=$1',[saved.structuredContent.sku])).rows[0].n,1);
 }finally{await app.close();}
}));
