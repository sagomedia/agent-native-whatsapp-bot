import {Readable} from 'node:stream';
import type {ReadableStream as NodeReadableStream} from 'node:stream/web';
import {createMcpHandler} from '@modelcontextprotocol/server';
import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import type {Pool} from 'pg';
import {z} from 'zod';
import type {Config} from '../config.js';
import {catalogMcpServer} from './catalog-server.js';
import {CatalogOAuth,oauthError} from './oauth.js';

const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const shell=(body:string)=>`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ShopBot · Connect your agent</title><body><main><h1>ShopBot agent connection</h1>${body}<p id="result" role="status"></p></main><script src="/api/owner/mcp/authorize.js" defer></script></body></html>`;
const script=`const f=document.querySelector('form');if(f)f.addEventListener('submit',async e=>{e.preventDefault();const allow=e.submitter.value==='allow';for(const b of document.querySelectorAll('button'))b.disabled=true;try{const r=await fetch('/api/owner/mcp/authorize',{method:'POST',headers:{'Content-Type':'application/json','X-Shopbot-Owner':'1'},body:JSON.stringify({id:f.elements.id.value,csrf:f.elements.csrf.value,allow})});const d=await r.json();if(!r.ok)throw Error('This connection expired or sign-in is required. Restart the connection in your agent.');location.assign(d.redirect);}catch(e){document.querySelector('#result').textContent=e.message;}});for(const b of document.querySelectorAll('[data-revoke]'))b.addEventListener('click',async()=>{b.disabled=true;try{const r=await fetch('/api/owner/mcp/connections/'+b.dataset.revoke+'/revoke',{method:'POST',headers:{'Content-Type':'application/json','X-Shopbot-Owner':'1'},body:'{}'});if(!r.ok)throw Error();location.reload();}catch{b.disabled=false;document.querySelector('#result').textContent='Could not disconnect. Refresh and try again.';}});`;

export async function registerRemoteMcp(app:FastifyInstance,pool:Pool,config:Config){
 const remote=config.remoteMcp,owner=config.owner;if(!remote||!owner)return;
 const oauth=new CatalogOAuth(pool,remote,owner),host=new URL(remote.publicUrl).host;
 const limits=new Map<string,{at:number;count:number}>();let active=0;
 const identities=new WeakMap<FastifyRequest,NonNullable<Awaited<ReturnType<CatalogOAuth['authenticate']>>>>();
 function budget(key:string,max:number){const now=Math.floor(Date.now()/60000),old=limits.get(key),value=old?.at===now?old:{at:now,count:0};value.count++;limits.set(key,value);if(value.count>max)throw oauthError('temporarily_unavailable',429);}
 function publicGate(req:FastifyRequest,reply:FastifyReply){
  if(req.headers.host!==host){reply.code(404).send({error:'Not found'});return false;}
  const origin=req.headers.origin;
  if(origin&&!['https://chatgpt.com','https://claude.ai','https://gemini.google.com','https://'+owner!.hostname].includes(origin)){reply.code(403).send({error:'Invalid request origin'});return false;}
  reply.header('Cache-Control','no-store').header('Pragma','no-cache').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer');
  if(origin)reply.header('Access-Control-Allow-Origin',origin).header('Vary','Origin').header('Access-Control-Expose-Headers','WWW-Authenticate, MCP-Protocol-Version');
  return true;
 }
 async function publicJson(req:FastifyRequest,reply:FastifyReply,run:()=>Promise<unknown>){
  if(!publicGate(req,reply))return;
  try{return await run();}catch(e){const failure=e as Error&{statusCode?:number};if(failure.statusCode===429)reply.header('Retry-After','60');if(e instanceof z.ZodError)return reply.code(400).send({error:'invalid_request'});if(failure.statusCode&&failure.statusCode<500)return reply.code(failure.statusCode).send({error:failure.message});throw e;}
 }
 const handler=createMcpHandler(ctx=>{
  if(!ctx.authInfo)throw new Error('Validated MCP authentication required.');
  return catalogMcpServer(pool,{storeId:owner.storeId,actor:owner.email+'/mcp/'+ctx.authInfo.clientId,canWrite:ctx.authInfo.scopes.includes('catalog:draft'),reviewUrl:'https://'+owner.hostname+'/owner?view=catalog'});
 },{legacy:'stateless',responseMode:'auto',maxSubscriptions:0,maxRequestBodySize:3_000_000});
 app.addHook('onClose',async()=>handler.close());
 const metadata=['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'];
 for(const url of metadata)app.get(url,async(req,reply)=>{if(publicGate(req,reply))return oauth.resource();});
 for(const url of ['/.well-known/oauth-authorization-server','/.well-known/openid-configuration'])app.get(url,async(req,reply)=>{if(publicGate(req,reply))return oauth.metadata();});
 app.post('/mcp/oauth/register',{bodyLimit:16000},async(req,reply)=>publicJson(req,reply,async()=>{budget('register',10);const value=await oauth.register(req.body);reply.code(201);return value;}));
 // OAuth clients use either JSON or the standard form encoding. Keep the parser
 // scoped to these routes rather than changing webhook/owner JSON semantics.
 await app.register(async routes=>{
  routes.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string'},(_req,body,done)=>{
   const params=new URLSearchParams(String(body));if([...params.keys()].some(k=>params.getAll(k).length!==1)){done(oauthError('invalid_request'));return;}done(null,Object.fromEntries(params));
  });
  routes.post('/mcp/oauth/token',async(req,reply)=>publicJson(req,reply,async()=>{budget('token',60);return oauth.token(req.body);}));
  routes.post('/mcp/oauth/revoke',async(req,reply)=>publicJson(req,reply,async()=>{budget('revoke',30);return oauth.revoke(req.body);}));
 });
 app.options('/mcp',async(req,reply)=>{if(publicGate(req,reply))return reply.header('Access-Control-Allow-Methods','POST, GET, DELETE, OPTIONS').header('Access-Control-Allow-Headers','Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, MCP-Method, MCP-Name').code(204).send();});
 app.route({method:['GET','POST','DELETE'],url:'/mcp',bodyLimit:3_000_000,onRequest:async(req,reply)=>{
  if(!publicGate(req,reply))return;
  budget('mcp',180);
  const identity=await oauth.authenticate(typeof req.headers.authorization==='string'?req.headers.authorization:undefined);
  if(!identity)return reply.header('WWW-Authenticate',`Bearer resource_metadata="${oauth.resourceMetadata}", error="invalid_token", error_description="Connect your ShopBot merchant account"`).code(401).send({error:'invalid_token'});
  identities.set(req,identity);
 },handler:async(req,reply)=>{
  const identity=identities.get(req);if(!identity)return reply.code(401).send({error:'invalid_token'});
  if(active>=6)return reply.header('Retry-After','2').code(429).send({error:'temporarily_unavailable'});
  active++;let released=false;const release=()=>{if(!released){released=true;active--;}};
  try{
   // Preserve protocol routing and parameter headers for both MCP eras. The
   // 2026 transport cross-checks Mcp-Method / Mcp-Name against the body.
   const headers=new Headers();for(const [name,value] of Object.entries(req.headers)){if((['accept','content-type'].includes(name)||name.startsWith('mcp-'))&&typeof value==='string')headers.set(name,value);}
   const request=new Request(remote.publicUrl,{method:req.method,headers,...(req.method==='POST'?{body:JSON.stringify(req.body)}:{})});
   const response=await handler.fetch(request,{parsedBody:req.body,authInfo:{token:req.headers.authorization!.slice(7),clientId:identity.clientId,scopes:identity.scopes,expiresAt:identity.expiresAt,resource:new URL(remote.publicUrl)}});
   if(response.status>=400){
    const body=req.body as {method?:unknown}|undefined;
    const method=body&&typeof body==='object'&&['server/discover','initialize','notifications/initialized','tools/list','tools/call','ping'].includes(String(body.method))?body.method:'other';
    // No credentials, tool arguments, protocol error text or customer data.
    req.log.warn({mcp:{status:response.status,method,hasMethodHeader:headers.has('mcp-method'),hasNameHeader:headers.has('mcp-name')}},'MCP protocol request rejected');
   }
   reply.code(response.status);response.headers.forEach((value,key)=>reply.header(key,value));
   if(!response.body){release();return reply.send();}
   const stream=Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>);stream.once('close',release);stream.once('end',release);stream.once('error',release);return reply.send(stream);
  }catch(e){release();throw e;}
 }});
 app.get('/api/owner/mcp/authorize.js',async(_req,reply)=>reply.header('Cache-Control','private, no-store').type('application/javascript').send(script));
 app.get('/api/owner/mcp/authorize',async(req,reply)=>{
  try{const p=await oauth.prepare(req.query);return reply.type('text/html').send(shell(`<h2>Connect ${escape(p.name)}?</h2><p>This agent can read your shop catalog${p.scopes.includes('catalog:draft')?' and prepare unpublished product drafts and photos':''}. You review and publish products in the owner dashboard.</p><p>It cannot publish products, change live stock, access orders or payments, or send customer messages.</p><p>Return address: <strong>${escape(new URL(p.redirectUri).host)}</strong></p><form><input type="hidden" name="id" value="${p.id}"><input type="hidden" name="csrf" value="${p.csrf}"><button type="submit" value="allow">Connect this agent</button> <button type="submit" value="deny">Cancel</button></form><p><a href="/api/owner/mcp">Manage connected agents</a></p>`));}
  catch(e){if(e instanceof z.ZodError){const fields=[...new Set(e.issues.map(i=>i.path.join('.')||'request'))];return reply.code(400).type('text/html').send(shell(`<p>The agent sent a missing or invalid OAuth field: <strong>${escape(fields.join(', '))}</strong>.</p><p>Restart the connection in your agent. If this repeats, report these field names to the shop operator; do not share sign-in codes or tokens.</p>`));}if((e as {statusCode?:number}).statusCode===400){const reason=(e as Error).message;const message=reason==='invalid_scope'?'The agent requested unsupported permissions. Use catalog:read and catalog:draft.':reason==='invalid_target'?'The requested resource does not match the ShopBot MCP URL. Use the exact server URL https://demo.sagoautomation.tech/mcp.':'The registered client or return address does not match this connection. Restart it in your agent.';return reply.code(400).type('text/html').send(shell('<p>'+escape(message)+'</p>'));}throw e;}
 });
 app.post('/api/owner/mcp/authorize',async(req,reply)=>{try{return await oauth.consent(req.body);}catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:'invalid_request'});throw e;}});
 app.get('/api/owner/mcp',async(_req,reply)=>{
  const connections=await oauth.connections();return reply.type('text/html').send(shell(`<p>Use this MCP server URL in ChatGPT or Claude:</p><p><code>${escape(remote.publicUrl)}</code></p><p>Choose OAuth authentication and automatic client registration. Sign in with your existing shop owner account.</p><h2>Connected agents</h2><ul>${connections.map(c=>`<li>${escape(c.name)} · ${escape(c.scopes.join(', '))} <button type="button" data-revoke="${c.id}">Disconnect</button></li>`).join('')}</ul>${connections.length?'':'<p>No agents connected yet.</p>'}<p><a href="/owner?view=catalog">Open products</a></p>`));
 });
 app.get('/api/owner/mcp/connections',async()=>({connections:await oauth.connections()}));
 app.post<{Params:{id:string}}>('/api/owner/mcp/connections/:id/revoke',async req=>oauth.disconnect(req.params.id));
}
