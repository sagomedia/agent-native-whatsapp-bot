import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import pg from 'pg';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {createApp} from '../apps/server/src/http/app.js';
import {CatalogOAuth,remoteMcpConfig} from '../apps/server/src/mcp/oauth.js';
import {fixtureStore} from '../profiles/hardware.js';

const owner={hostname:'mcp-owner.example.test',issuer:'https://example.cloudflareaccess.com',audience:'test-audience-mcp',email:'merchant@example.test',storeId:fixtureStore};
const remote={publicUrl:'https://mcp.example.test/mcp'},publicHost='mcp.example.test';
const ownerHeaders={host:owner.hostname,'cf-access-jwt-assertion':'synthetic',origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json'};
const verifier=()=>randomBytes(32).toString('base64url');
const challenge=(s:string)=>createHash('sha256').update(s).digest('base64url');
async function fixture(run:(pool:pg.Pool,oauth:CatalogOAuth,app:Awaited<ReturnType<typeof createApp>>)=>Promise<void>){
 assert.ok(process.env.DATABASE_URL,'An explicit disposable DATABASE_URL is required.');
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='remote_mcp_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema});let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{await setupDatabase(pool,'mock');app=await createApp({mode:'mock',host:'127.0.0.1',port:3017,databaseUrl:process.env.DATABASE_URL!,mediaDir:'/tmp/mcp-fixture',owner,remoteMcp:remote},pool,undefined,undefined,async token=>{if(token!=='synthetic')throw Error();return {email:owner.email,subject:'test-owner'};});await app.ready();await run(pool,new CatalogOAuth(pool,remote,owner),app);}
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

test('HTTP MCP creates replay-safe unpublished drafts, respects read-only scopes and rejects foreign shop or publication arguments',()=>fixture(async(pool,oauth,app)=>{
 const a=await authorize(oauth),t=await oauth.token(a.tokenInput);
 const listed=await rpc(app,t.access_token,'tools/list');assert.equal(listed.statusCode,200,listed.body);assert.equal(result(listed.body).result.tools.length,6);
 const foreign=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other','true')",[foreign]);await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise) VALUES($1,'FOREIGN-SECRET','Other shop secret','piece',1)",[foreign]);
 const inventory=await rpc(app,t.access_token,'tools/call',{name:'catalog_inventory',arguments:{limit:100}});assert.ok(!inventory.body.includes('FOREIGN-SECRET'));
 const p={id:randomUUID(),batchId:'http-test',clientItemId:'row-1',details:{name:'Synthetic remote MCP draft'},provenance:{source:'test fixture',issues:['Unpublished test']}};
 const created=await rpc(app,t.access_token,'tools/call',{name:'catalog_propose',arguments:p});assert.equal(created.statusCode,200,created.body);assert.equal(result(created.body).result.isError,undefined);assert.match(created.body,/reviewUrl/);
 const replay=await rpc(app,t.access_token,'tools/call',{name:'catalog_propose',arguments:p});assert.match(replay.body,/replayed/);assert.equal(Number((await pool.query('SELECT count(*) FROM catalog_proposals')).rows[0].count),1);
 assert.equal(Number((await pool.query("SELECT count(*) FROM products WHERE name='Synthetic remote MCP draft'")).rows[0].count),0);
 const intrusion=await rpc(app,t.access_token,'tools/call',{name:'catalog_propose',arguments:{...p,storeId:foreign}});assert.ok(result(intrusion.body).error||result(intrusion.body).result?.isError);
 const publish=await rpc(app,t.access_token,'tools/call',{name:'catalog_publish',arguments:{id:p.id}});assert.ok(result(publish.body).error);
 const read=await authorize(oauth,'catalog:read'),readToken=await oauth.token(read.tokenInput),readList=await rpc(app,readToken.access_token,'tools/list');assert.equal(result(readList.body).result.tools.length,3);
 const denied=await rpc(app,readToken.access_token,'tools/call',{name:'catalog_propose',arguments:p});assert.ok(result(denied.body).error);
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
 try{await client.connect(transport);const tools=await client.listTools();assert.equal(tools.tools.length,6);const inventory=await client.callTool({name:'catalog_inventory',arguments:{limit:1}});assert.equal(inventory.isError,undefined);assert.equal(JSON.parse((inventory.content[0] as {text:string}).text).products.length,1);}finally{await client.close();await new Promise<void>((resolve,reject)=>proxy.close(e=>e?reject(e):resolve()));}
}));
