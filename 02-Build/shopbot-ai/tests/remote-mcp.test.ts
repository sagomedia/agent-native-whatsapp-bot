import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import pg from 'pg';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {createApp} from '../apps/server/src/http/app.js';
import {CatalogOAuth,remoteMcpConfig,type RemoteMcpConfig} from '../apps/server/src/mcp/oauth.js';
import {fixtureStore} from '../profiles/hardware.js';

const owner={hostname:'mcp-owner.example.test',issuer:'https://example.cloudflareaccess.com',audience:'test-audience-mcp',email:'merchant@example.test',storeId:fixtureStore};
const remote={publicUrl:'https://mcp.example.test/mcp'},publicHost='mcp.example.test';
const ownerHeaders={host:owner.hostname,'cf-access-jwt-assertion':'synthetic',origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json'};
const verifier=()=>randomBytes(32).toString('base64url');
const challenge=(s:string)=>createHash('sha256').update(s).digest('base64url');
async function fixture(run:(pool:pg.Pool,oauth:CatalogOAuth,app:Awaited<ReturnType<typeof createApp>>)=>Promise<void>,remoteConfig:RemoteMcpConfig=remote){
 assert.ok(process.env.DATABASE_URL,'An explicit disposable DATABASE_URL is required.');
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='remote_mcp_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema});let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{await setupDatabase(pool,'mock');app=await createApp({mode:'mock',host:'127.0.0.1',port:3017,databaseUrl:process.env.DATABASE_URL!,mediaDir:'/tmp/mcp-fixture',owner,remoteMcp:remoteConfig},pool,undefined,undefined,async token=>{if(token!=='synthetic')throw Error();return {email:owner.email,subject:'test-owner'};});await app.ready();await run(pool,new CatalogOAuth(pool,remoteConfig,owner),app);}
 finally{await app?.close();await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
}
async function authorize(oauth:CatalogOAuth,scope='catalog:read catalog:draft'){
 const client=await oauth.register({client_name:'Synthetic Claude client',redirect_uris:['https://claude.ai/api/mcp/auth_callback'],token_endpoint_auth_method:'none'}),v=verifier();
 const params={client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge:challenge(v),code_challenge_method:'S256',resource:remote.publicUrl,scope,state:randomUUID()};
 const pending=await oauth.prepare(params),decision=await oauth.consent({id:pending.id,csrf:pending.csrf,allow:true});
 const redirect=new URL(decision.redirect);assert.equal(redirect.searchParams.get('state'),params.state);assert.equal(redirect.searchParams.get('iss'),'https://mcp.example.test');
 return {params,pending,tokenInput:{grant_type:'authorization_code',client_id:client.client_id,code:redirect.searchParams.get('code')!,redirect_uri:params.redirect_uri,code_verifier:v,resource:remote.publicUrl}};
}
function rpc(app:Awaited<ReturnType<typeof createApp>>,token:string,method:string,params:unknown={},id=1){return app.inject({method:'POST',url:'/mcp',headers:{host:publicHost,authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},payload:JSON.stringify({jsonrpc:'2.0',id,method,params})});}
function result(body:string){return JSON.parse(body.startsWith('event:')?body.split('\n').find(v=>v.startsWith('data: '))!.slice(6):body);}

test('remote MCP configuration, public metadata, host/origin restrictions and owner consent remain fail closed',()=>fixture(async(_pool,oauth,app)=>{
 assert.throws(()=>remoteMcpConfig('http://example.test/mcp',owner));assert.throws(()=>remoteMcpConfig(remote.publicUrl,undefined));assert.throws(()=>remoteMcpConfig('https://'+owner.hostname+'/mcp',owner));
 const metadata=await app.inject({url:'/.well-known/oauth-protected-resource/mcp',headers:{host:publicHost}});assert.equal(metadata.statusCode,200);assert.equal(metadata.json().resource,remote.publicUrl);
 const as=await app.inject({url:'/.well-known/oauth-authorization-server',headers:{host:publicHost}});assert.equal(as.json().authorization_response_iss_parameter_supported,true);assert.equal(as.json().authorization_endpoint,'https://'+owner.hostname+'/api/owner/mcp/authorize');
 assert.equal((await app.inject({url:'/.well-known/oauth-protected-resource',headers:{host:'evil.example'}})).statusCode,404);
 const missing=await app.inject({method:'POST',url:'/mcp',headers:{host:publicHost,'content-type':'application/json'},payload:'{}'});assert.equal(missing.statusCode,401);assert.match(String(missing.headers['www-authenticate']),/resource_metadata/);assert.equal(missing.headers['cache-control'],'no-store');
 assert.equal((await app.inject({url:'/mcp',headers:{host:publicHost,origin:'https://evil.example'}})).statusCode,403);
 assert.equal((await app.inject({url:'/api/owner/snapshot',headers:{host:publicHost}})).statusCode,404);
 assert.equal((await app.inject({url:'/api/owner/mcp',headers:{host:owner.hostname}})).statusCode,403);
 await assert.rejects(oauth.register({redirect_uris:['https://evil.example/callback']}));await assert.rejects(oauth.register({redirect_uris:['https://chatgpt.com.evil.example/callback']}));
 const a=await authorize(oauth);
 assert.equal((await app.inject({method:'POST',url:'/api/owner/mcp/authorize',headers:{...ownerHeaders,origin:'https://evil.example'},payload:JSON.stringify({id:a.pending.id,csrf:a.pending.csrf,allow:true})})).statusCode,403);
 await assert.rejects(oauth.consent({id:a.pending.id,csrf:a.pending.csrf,allow:true}),/invalid_request/);
}));

test('OAuth codes bind client, redirect, resource, PKCE and consent; refresh rotates and revocation blocks both token kinds',()=>fixture(async(pool,oauth)=>{
 const a=await authorize(oauth);
 await assert.rejects(oauth.token({...a.tokenInput,code_verifier:verifier()}),/invalid_grant/);
 await assert.rejects(oauth.token({...a.tokenInput,client_id:'wrong'}),/invalid_grant/);
 await assert.rejects(oauth.token({...a.tokenInput,redirect_uri:'https://claude.ai/wrong'}),/invalid_grant/);
 await assert.rejects(oauth.token({...a.tokenInput,resource:'https://other.test/mcp'}),/invalid_target/);
 const t=await oauth.token(a.tokenInput);assert.ok(await oauth.authenticate('Bearer '+t.access_token));await assert.rejects(oauth.token(a.tokenInput),/invalid_grant/);
 const raw=await pool.query('SELECT hash FROM mcp_oauth_tokens');assert.ok(raw.rows.every(r=>/^[a-f0-9]{64}$/.test(r.hash)));assert.ok(!JSON.stringify(raw.rows).includes(t.access_token));
 const refresh={grant_type:'refresh_token',client_id:a.params.client_id,resource:remote.publicUrl,refresh_token:t.refresh_token};
 const rotated=await oauth.token(refresh);assert.notEqual(rotated.refresh_token,t.refresh_token);
 await assert.rejects(oauth.token(refresh),/invalid_grant/);assert.equal(await oauth.authenticate('Bearer '+rotated.access_token),undefined);assert.equal(await oauth.authenticate('Bearer '+t.access_token),undefined);
 await assert.rejects(oauth.token({...refresh,refresh_token:rotated.refresh_token}),/invalid_grant/);
 const fresh=await authorize(oauth),freshToken=await oauth.token(fresh.tokenInput);await oauth.revoke({token:freshToken.refresh_token,client_id:fresh.params.client_id});assert.equal(await oauth.authenticate('Bearer '+freshToken.access_token),undefined);
 const expired=await authorize(oauth);await pool.query("UPDATE mcp_oauth_codes SET expires_at=now()-interval '1 second'");await assert.rejects(oauth.token(expired.tokenInput),/invalid_grant/);
}));

test('HTTP MCP prepares replay-safe existing edits, rejects new-product drafts and respects tenant and publication scopes',()=>fixture(async(pool,oauth,app)=>{
 const a=await authorize(oauth),t=await oauth.token(a.tokenInput);
 const listed=await rpc(app,t.access_token,'tools/list');assert.equal(listed.statusCode,200,listed.body);assert.equal(result(listed.body).result.tools.length,14);
 const foreign=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other','true')",[foreign]);await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise) VALUES($1,'FOREIGN-SECRET','Other shop secret','piece',1)",[foreign]);
 const inventory=await rpc(app,t.access_token,'tools/call',{name:'catalog_inventory',arguments:{limit:100}});assert.ok(!inventory.body.includes('FOREIGN-SECRET'));
 const base=(await pool.query('SELECT sku,version FROM products WHERE store_id=$1 ORDER BY sku LIMIT 1',[fixtureStore])).rows[0];
 const p={operationId:randomUUID(),base,details:{name:'Synthetic remote MCP edit'}};
 const created=await rpc(app,t.access_token,'tools/call',{name:'catalog_prepare',arguments:p});assert.equal(created.statusCode,200,created.body);assert.equal(result(created.body).result.isError,undefined);assert.ok(result(created.body).result.structuredContent.id);
 const replay=await rpc(app,t.access_token,'tools/call',{name:'catalog_prepare',arguments:p});assert.deepEqual(result(replay.body).result.structuredContent,result(created.body).result.structuredContent);assert.equal(Number((await pool.query('SELECT count(*) FROM catalog_proposals')).rows[0].count),1);
 assert.equal(Number((await pool.query("SELECT count(*) FROM products WHERE name='Synthetic remote MCP edit'")).rows[0].count),0);
 const intrusion=await rpc(app,t.access_token,'tools/call',{name:'catalog_prepare',arguments:{...p,storeId:foreign}});assert.ok(result(intrusion.body).error||result(intrusion.body).result?.isError);
 const publish=await rpc(app,t.access_token,'tools/call',{name:'catalog_publish',arguments:{id:p.operationId}});assert.ok(result(publish.body).error);
 const read=await authorize(oauth,'catalog:read'),readToken=await oauth.token(read.tokenInput),readList=await rpc(app,readToken.access_token,'tools/list');assert.equal(result(readList.body).result.tools.length,11);
 const denied=await rpc(app,readToken.access_token,'tools/call',{name:'catalog_prepare',arguments:p});assert.ok(result(denied.body).error);
 await pool.query("UPDATE mcp_oauth_tokens SET expires_at=now()-interval '1 second' WHERE kind='access'");assert.equal((await rpc(app,t.access_token,'tools/list')).statusCode,401);
}));

test('standard HTTP registration and form token exchange work through the protected owner consent page',()=>fixture(async(_pool,_oauth,app)=>{
 const client=await app.inject({method:'POST',url:'/mcp/oauth/register',headers:{host:publicHost,'content-type':'application/json'},payload:JSON.stringify({client_name:'ChatGPT synthetic fixture',redirect_uris:['https://chatgpt.com/connector_platform/oauth/callback'],token_endpoint_auth_method:'none'})});assert.equal(client.statusCode,201,client.body);
 const v=verifier(),params={client_id:client.json().client_id,redirect_uri:'https://chatgpt.com/connector_platform/oauth/callback',response_type:'code',code_challenge:challenge(v),code_challenge_method:'S256',resource:remote.publicUrl,state:randomUUID()};
 const consent=await app.inject({url:'/api/owner/mcp/authorize?'+new URLSearchParams(params),headers:ownerHeaders});assert.equal(consent.statusCode,200,consent.body);assert.match(consent.body,/Connect this agent/);
 const id=/name="id" value="([^"]+)"/.exec(consent.body)![1],csrf=/name="csrf" value="([^"]+)"/.exec(consent.body)![1];
 const decision=await app.inject({method:'POST',url:'/api/owner/mcp/authorize',headers:ownerHeaders,payload:JSON.stringify({id,csrf,allow:true})});assert.equal(decision.statusCode,200,decision.body);
 const code=new URL(decision.json().redirect).searchParams.get('code')!;
 const token=await app.inject({method:'POST',url:'/mcp/oauth/token',headers:{host:publicHost,'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams({grant_type:'authorization_code',client_id:params.client_id,code,code_verifier:v,redirect_uri:params.redirect_uri,resource:remote.publicUrl}).toString()});assert.equal(token.statusCode,200,token.body);assert.equal(token.json().token_type,'Bearer');
 const malformed=await app.inject({method:'POST',url:'/mcp/oauth/token',headers:{host:publicHost,'content-type':'application/x-www-form-urlencoded'},payload:'client_id=one&client_id=two'});assert.equal(malformed.statusCode,400);
 const list=await app.inject({url:'/api/owner/mcp/connections',headers:ownerHeaders});assert.equal(list.json().connections.length,1);
 const revoke=await app.inject({method:'POST',url:'/api/owner/mcp/connections/'+list.json().connections[0].id+'/revoke',headers:ownerHeaders,payload:'{}'});assert.equal(revoke.statusCode,200);
 assert.equal((await rpc(app,token.json().access_token,'tools/list')).statusCode,401);
}));

test('official MCP HTTP client negotiates the deployed SDK protocol and calls catalog tools',()=>fixture(async(_pool,oauth,app)=>{
 const a=await authorize(oauth),t=await oauth.token(a.tokenInput);
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();assert.ok(address&&typeof address!=='string');
 const client=new Client({name:'shopbot-http-integration',version:'1.0.0'});
 // Model the public HTTPS tunnel's Host forwarding with an actual HTTP proxy.
 const proxy=createServer((req,res)=>{const upstream=httpRequest({hostname:'127.0.0.1',port:address.port,path:req.url,method:req.method,headers:{...req.headers,host:publicHost}},response=>{res.writeHead(response.statusCode!,response.headers);response.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);});
 await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));const proxyAddress=proxy.address();assert.ok(proxyAddress&&typeof proxyAddress!=='string');
 const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${proxyAddress.port}/mcp`),{requestInit:{headers:{authorization:'Bearer '+t.access_token}}});
 try{await client.connect(transport);const tools=await client.listTools();assert.equal(tools.tools.length,14);const inventory=await client.callTool({name:'catalog_inventory',arguments:{limit:1}});assert.equal(inventory.isError,undefined);assert.equal(JSON.parse((inventory.content[0] as {text:string}).text).products.length,1);}finally{await client.close();await new Promise<void>((resolve,reject)=>proxy.close(e=>e?reject(e):resolve()));}
}));

test('OAuth accepts extension fields and blank default scopes without weakening resource, PKCE or callback binding',()=>fixture(async(_pool,oauth,app)=>{
 const client=await oauth.register({client_name:'ChatGPT',redirect_uris:['https://chatgpt.com/connector_platform_oauth_redirect'],scope:''}),v=verifier();
 const params={client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge:challenge(v),code_challenge_method:'S256',resource:remote.publicUrl,scope:'',state:randomUUID(),response_mode:'query',prompt:'consent',access_type:'offline'};
 const pending=await oauth.prepare(params);assert.deepEqual(pending.scopes,['catalog:read','catalog:draft']);
 const decision=await oauth.consent({id:pending.id,csrf:pending.csrf,allow:true}),code=new URL(decision.redirect).searchParams.get('code');
 const token=await oauth.token({grant_type:'authorization_code',client_id:client.client_id,code,redirect_uri:params.redirect_uri,code_verifier:v,resource:remote.publicUrl,client_secret:'',custom_extension:'ignored'});assert.equal(token.scope,'catalog:read catalog:draft');
 await assert.rejects(oauth.prepare({...params,code_challenge_method:'plain'}));await assert.rejects(oauth.prepare({...params,resource:'https://other.test/mcp'}),/invalid_target/);await assert.rejects(oauth.prepare({...params,scope:'catalog:read orders:write'}),/invalid_scope/);
 const incomplete={...params} as Record<string,string>;delete incomplete.resource;const error=await app.inject({url:'/api/owner/mcp/authorize?'+new URLSearchParams(incomplete),headers:ownerHeaders});assert.equal(error.statusCode,400);assert.match(error.body,/invalid OAuth field/);assert.match(error.body,/resource/);assert.ok(!error.body.includes(params.state));assert.ok(!error.body.includes(params.code_challenge));
}));

test('2026 MCP discovery preserves method/name headers and legacy initialization still works',()=>fixture(async(_pool,oauth,app)=>{
 const a=await authorize(oauth),t=await oauth.token(a.tokenInput);
 const headers={host:publicHost,authorization:'bearer '+t.access_token,'content-type':'application/json',accept:'application/json, text/event-stream'};
 for(const version of ['2024-11-05','2025-03-26','2025-06-18','2025-11-25']){
  const r=await app.inject({method:'POST',url:'/mcp',headers,payload:{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:version,capabilities:{},clientInfo:{name:'legacy-fixture',version:'1'}}}});assert.equal(r.statusCode,200,r.body);assert.equal(result(r.body).result.protocolVersion,version);
 }
 const modernHeaders={...headers,'mcp-protocol-version':'2026-07-28','mcp-method':'tools/list'};
 const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'modern-fixture',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}};
 const discovery=await app.inject({method:'POST',url:'/mcp',headers:{...modernHeaders,'mcp-method':'server/discover'},payload:{jsonrpc:'2.0',id:5,method:'server/discover',params:{_meta:meta}}});assert.equal(discovery.statusCode,200,discovery.body);assert.equal(discovery.json().result._meta['io.modelcontextprotocol/serverInfo'].name,'shopbot-owner-catalog');
 const payload={jsonrpc:'2.0',id:2,method:'tools/list',params:{_meta:meta}};
 const r=await app.inject({method:'POST',url:'/mcp',headers:modernHeaders,payload});assert.equal(r.statusCode,200,r.body);assert.equal(result(r.body).result.tools.length,14);
 const missing=await app.inject({method:'POST',url:'/mcp',headers:{...headers,'mcp-protocol-version':'2026-07-28'},payload});assert.equal(missing.statusCode,400);assert.equal(missing.json().error.code,-32020);
 const wrong=await app.inject({method:'POST',url:'/mcp',headers:{...modernHeaders,'mcp-method':'tools/call'},payload});assert.equal(wrong.statusCode,400);
 const call=await app.inject({method:'POST',url:'/mcp',headers:{...modernHeaders,'mcp-method':'tools/call','mcp-name':'catalog_inventory'},payload:{jsonrpc:'2.0',id:3,method:'tools/call',params:{_meta:meta,name:'catalog_inventory',arguments:{limit:1}}}});assert.equal(call.statusCode,200,call.body);assert.equal(result(call.body).result.isError,undefined);
 const mismatch=await app.inject({method:'POST',url:'/mcp',headers:{...modernHeaders,'mcp-method':'tools/call','mcp-name':'catalog_search'},payload:{jsonrpc:'2.0',id:4,method:'tools/call',params:{_meta:meta,name:'catalog_inventory',arguments:{limit:1}}}});assert.equal(mismatch.statusCode,400);
 const preflight=await app.inject({method:'OPTIONS',url:'/mcp',headers:{host:publicHost,origin:'https://chatgpt.com'}});assert.match(preflight.headers['access-control-allow-headers']!,/MCP-Method/);
}));

test('reviewed exact third-party callbacks bind registration, consent and token exchange without allowing neighboring URLs',async()=>{
 const callback='https://backend.composio.dev/api/v1/auth-apps/add';
 const config=remoteMcpConfig(remote.publicUrl,owner,JSON.stringify([callback]))!;
 assert.deepEqual(config.redirectUris,[callback]);
 for(const value of ['not-json','{}','["http://example.test/callback"]','["https://user:secret@example.test/callback"]','["https://example.test/callback#fragment"]','["https://*.example.test/callback"]'])assert.throws(()=>remoteMcpConfig(remote.publicUrl,owner,value),/Remote MCP redirect URIs/);
 await fixture(async(_pool,oauth,app)=>{
  const registration={client_name:'Composio compatibility fixture',redirect_uris:[callback],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'catalog:read catalog:draft'};
  const client=await app.inject({method:'POST',url:'/mcp/oauth/register',headers:{host:publicHost,'content-type':'application/json'},payload:registration});assert.equal(client.statusCode,201,client.body);assert.equal(client.json().redirect_uris[0],callback);
  const v=verifier(),params={client_id:client.json().client_id,redirect_uri:callback,response_type:'code',code_challenge:challenge(v),code_challenge_method:'S256',resource:remote.publicUrl,scope:registration.scope,state:randomUUID()};
  for(const bad of [callback+'/',callback+'?unapproved=1','https://backend.composio.dev/api/v1/auth-apps/other','https://backend.composio.dev.evil.test/api/v1/auth-apps/add']){
   await assert.rejects(oauth.register({...registration,redirect_uris:[bad]}));await assert.rejects(oauth.prepare({...params,redirect_uri:bad}),/invalid_request/);
  }
  const page=await app.inject({url:'/api/owner/mcp/authorize?'+new URLSearchParams(params),headers:ownerHeaders});assert.equal(page.statusCode,200,page.body);assert.match(page.body,/backend.composio.dev/);
  const id=/name="id" value="([^"]+)"/.exec(page.body)![1],csrf=/name="csrf" value="([^"]+)"/.exec(page.body)![1];
  const decision=await app.inject({method:'POST',url:'/api/owner/mcp/authorize',headers:ownerHeaders,payload:{id,csrf,allow:true}});assert.equal(decision.statusCode,200,decision.body);
  const redirect=new URL(decision.json().redirect);assert.equal(redirect.origin+redirect.pathname,callback);assert.equal(redirect.searchParams.get('state'),params.state);
  const tokenInput={grant_type:'authorization_code',client_id:params.client_id,code:redirect.searchParams.get('code')!,redirect_uri:callback,code_verifier:v,resource:remote.publicUrl};
  await assert.rejects(oauth.token({...tokenInput,redirect_uri:callback+'/'}),/invalid_grant/);
  const token=await app.inject({method:'POST',url:'/mcp/oauth/token',headers:{host:publicHost,'content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams(tokenInput).toString()});assert.equal(token.statusCode,200,token.body);
  const listed=await rpc(app,token.json().access_token,'tools/list');assert.equal(listed.statusCode,200,listed.body);assert.equal(result(listed.body).result.tools.length,14);
  const refreshed=await oauth.token({grant_type:'refresh_token',client_id:params.client_id,resource:remote.publicUrl,refresh_token:token.json().refresh_token});assert.ok(await oauth.authenticate('Bearer '+refreshed.access_token));
  const stricter=new CatalogOAuth(_pool,remote,owner);await assert.rejects(stricter.prepare(params),/invalid_request/);
 },config);
});

test('Gemini user-bound callbacks are configured exactly and the Gemini web origin can discover MCP metadata',()=>{
 const callback='https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-fixture-demo_sagoautomation_tech';
 const config=remoteMcpConfig(remote.publicUrl,owner,JSON.stringify([callback]))!;
 return fixture(async(_pool,oauth,app)=>{
  const client=await oauth.register({client_name:'Gemini compatibility fixture',redirect_uris:[callback],token_endpoint_auth_method:'none'}),v=verifier();
  const params={client_id:client.client_id,redirect_uri:callback,response_type:'code',code_challenge:challenge(v),code_challenge_method:'S256',resource:remote.publicUrl,state:randomUUID()};
  const p=await oauth.prepare(params);const d=await oauth.consent({id:p.id,csrf:p.csrf,allow:true});const redirect=new URL(d.redirect);assert.equal(redirect.origin+redirect.pathname,callback);assert.equal(redirect.searchParams.get('iss'),new URL(remote.publicUrl).origin);
  const token=await oauth.token({grant_type:'authorization_code',client_id:client.client_id,code:redirect.searchParams.get('code'),redirect_uri:callback,code_verifier:v,resource:remote.publicUrl});assert.ok(await oauth.authenticate('Bearer '+token.access_token));
  await assert.rejects(oauth.register({redirect_uris:[callback.replace('fixture','another-user')]}));
  const metadata=await app.inject({url:'/.well-known/oauth-protected-resource/mcp',headers:{host:publicHost,origin:'https://gemini.google.com'}});assert.equal(metadata.statusCode,200);assert.equal(metadata.headers['access-control-allow-origin'],'https://gemini.google.com');
 },config);
});
