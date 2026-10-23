import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import type {OwnerConfig} from '../config.js';

export type RemoteMcpConfig={publicUrl:string;redirectUris?:string[]};
export const mcpScopes=['catalog:read','catalog:draft'] as const;
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
export const oauthError=(error:string,statusCode=400)=>Object.assign(new Error(error),{statusCode});
export function remoteMcpConfig(value:string|undefined,owner:OwnerConfig|undefined,redirectUrisValue?:string):RemoteMcpConfig|undefined{
 if(!value)return;
 const u=new URL(value);
 if(!owner||u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/mcp'||u.port||u.hostname===owner.hostname)throw new Error('Remote MCP requires a separate HTTPS hostname, /mcp path and owner access configuration.');
 let redirectUris:string[]|undefined;
 if(redirectUrisValue!==undefined){try{
  redirectUris=z.array(z.string().max(2048).refine(value=>{try{const r=new URL(value);return r.protocol==='https:'&&!r.username&&!r.password&&!r.hash&&!r.hostname.includes('*')&&r.href===value;}catch{return false;}})).max(32).parse(JSON.parse(redirectUrisValue));
 }catch{throw new Error('Remote MCP redirect URIs must be a JSON array of at most 32 exact HTTPS URLs, without credentials, fragments or wildcards.');}}
 return {publicUrl:u.href,...(redirectUris?{redirectUris}: {})};
}
export function mcpPublicPath(config:RemoteMcpConfig|undefined,host:string|undefined,path:string){
 return !!config&&host===new URL(config.publicUrl).host&&(path==='/mcp'||['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp','/.well-known/oauth-authorization-server','/.well-known/openid-configuration','/mcp/oauth/register','/mcp/oauth/token','/mcp/oauth/revoke'].includes(path));
}
function redirectAllowed(value:string,extra:string[]=[]){
 try{const u=new URL(value);return !u.username&&!u.password&&!u.hash&&(u.protocol==='https:'&&(['chatgpt.com','chat.openai.com','claude.ai'].includes(u.hostname)||extra.includes(value))||u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname));}catch{return false;}
}
const registration=(extra:string[]=[])=>z.object({client_name:z.string().trim().min(1).max(100).default('AI catalog client'),redirect_uris:z.array(z.string().max(2048).refine(value=>redirectAllowed(value,extra))).min(1).max(8),token_endpoint_auth_method:z.literal('none').default('none'),grant_types:z.array(z.enum(['authorization_code','refresh_token'])).max(2).optional(),response_types:z.array(z.literal('code')).max(1).optional(),scope:z.string().max(200).optional()}).passthrough();
// OAuth extension parameters are permitted by RFC 6749. Only the recognized,
// validated fields below can affect authorization; extras never grant rights.
const authorization=z.object({client_id:z.string().min(1).max(200),redirect_uri:z.string().max(2048),response_type:z.literal('code'),code_challenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/),code_challenge_method:z.literal('S256'),resource:z.string().max(2048),scope:z.string().max(200).optional(),state:z.string().min(1).max(2048)}).passthrough();
type Grant={id:string;store_id:string;actor:string;client_id:string;scopes:string[];resource:string};
export class CatalogOAuth {
 readonly issuer:string;
 readonly resourceMetadata:string;
 constructor(private pool:Pool,readonly config:RemoteMcpConfig,private owner:OwnerConfig){this.issuer=new URL(config.publicUrl).origin;this.resourceMetadata=this.issuer+'/.well-known/oauth-protected-resource/mcp';}
 metadata(){return {issuer:this.issuer,authorization_endpoint:'https://'+this.owner.hostname+'/api/owner/mcp/authorize',token_endpoint:this.issuer+'/mcp/oauth/token',registration_endpoint:this.issuer+'/mcp/oauth/register',revocation_endpoint:this.issuer+'/mcp/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:mcpScopes,authorization_response_iss_parameter_supported:true};}
 resource(){return {resource:this.config.publicUrl,authorization_servers:[this.issuer],scopes_supported:mcpScopes,bearer_methods_supported:['header'],resource_name:'ShopBot merchant catalog'};}
 scopes(value?:string){const scopes=[...new Set((value?.trim()||mcpScopes.join(' ')).split(' ').filter(Boolean))];if(!scopes.includes('catalog:read')||scopes.some(s=>!mcpScopes.includes(s as typeof mcpScopes[number])))throw oauthError('invalid_scope');return scopes;}
 async register(input:unknown){
  const p=registration(this.config.redirectUris).parse(input);this.scopes(p.scope);
  // Persist a global ceiling too, so a restart does not reset abuse limits.
  const client=await this.pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(73502841)');
   if(Number((await client.query("SELECT count(*) FROM mcp_oauth_clients WHERE created_at>now()-interval '24 hours'")).rows[0].count)>=100)throw oauthError('temporarily_unavailable',429);
   const id='shopbot_'+secret();await client.query('INSERT INTO mcp_oauth_clients(client_id,name,redirect_uris) VALUES($1,$2,$3)',[id,p.client_name,JSON.stringify(p.redirect_uris)]);await client.query('COMMIT');
   return {client_id:id,client_id_issued_at:Math.floor(Date.now()/1000),client_name:p.client_name,redirect_uris:p.redirect_uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:this.scopes(p.scope).join(' ')};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 async prepare(input:unknown){
  const p=authorization.parse(input);if(p.resource!==this.config.publicUrl)throw oauthError('invalid_target');
  const client=(await this.pool.query('SELECT name,redirect_uris FROM mcp_oauth_clients WHERE client_id=$1',[p.client_id])).rows[0];
  if(!client||!client.redirect_uris.includes(p.redirect_uri)||!redirectAllowed(p.redirect_uri,this.config.redirectUris))throw oauthError('invalid_request');
  const scopes=this.scopes(p.scope),id=randomUUID(),csrf=secret();
  await this.pool.query("DELETE FROM mcp_oauth_requests WHERE expires_at<now()-interval '1 day'");
  await this.pool.query('INSERT INTO mcp_oauth_requests(id,secret_hash,client_id,redirect_uri,challenge,state,scopes,resource) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,digest(csrf),p.client_id,p.redirect_uri,p.code_challenge,p.state,scopes,p.resource]);
  return {id,csrf,name:client.name as string,redirectUri:p.redirect_uri,scopes};
 }
 async consent(input:unknown){
  const p=z.object({id:z.uuid(),csrf:z.string().regex(/^[A-Za-z0-9_-]{43}$/),allow:z.boolean()}).strict().parse(input);
  return this.transaction(async c=>{
   const request=(await c.query('DELETE FROM mcp_oauth_requests WHERE id=$1 AND secret_hash=$2 AND expires_at>now() RETURNING *',[p.id,digest(p.csrf)])).rows[0];if(!request)throw oauthError('invalid_request');
   const redirect=new URL(request.redirect_uri);redirect.searchParams.set('state',request.state);redirect.searchParams.set('iss',this.issuer);
   if(!p.allow){redirect.searchParams.set('error','access_denied');return {redirect:redirect.href};}
   const grant=randomUUID(),code=secret();
   await c.query('INSERT INTO mcp_oauth_grants(id,store_id,actor,client_id,scopes,resource) VALUES($1,$2,$3,$4,$5,$6)',[grant,this.owner.storeId,this.owner.email,request.client_id,request.scopes,request.resource]);
   await c.query('INSERT INTO mcp_oauth_codes(hash,grant_id,redirect_uri,challenge) VALUES($1,$2,$3,$4)',[digest(code),grant,request.redirect_uri,request.challenge]);
   await c.query("INSERT INTO owner_audit(store_id,email,action,target_id,details) VALUES($1,$2,'mcp_connect',$3,$4)",[this.owner.storeId,this.owner.email,grant,JSON.stringify({clientId:request.client_id,scopes:request.scopes})]);
   redirect.searchParams.set('code',code);return {redirect:redirect.href};
  });
 }
 async token(input:unknown){
  const p=z.object({grant_type:z.enum(['authorization_code','refresh_token']),client_id:z.string().min(1).max(200),code:z.string().max(200).optional(),redirect_uri:z.string().max(2048).optional(),code_verifier:z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).optional(),refresh_token:z.string().max(200).optional(),resource:z.string().max(2048),scope:z.string().max(200).optional()}).passthrough().parse(input);
  if(p.resource!==this.config.publicUrl)throw oauthError('invalid_target');
  const outcome=await this.transaction(async c=>{
   let grant:Grant;
   if(p.grant_type==='authorization_code'){
    if(!p.code||!p.redirect_uri||!p.code_verifier)throw oauthError('invalid_request');
    const code=(await c.query('SELECT * FROM mcp_oauth_codes WHERE hash=$1 AND expires_at>now() AND used_at IS NULL FOR UPDATE',[digest(p.code)])).rows[0];
    if(!code||code.redirect_uri!==p.redirect_uri||createHash('sha256').update(p.code_verifier).digest('base64url')!==code.challenge)throw oauthError('invalid_grant');
    grant=await this.grant(c,code.grant_id,p.client_id,p.resource);
    await c.query('UPDATE mcp_oauth_codes SET used_at=now() WHERE hash=$1',[digest(p.code)]);
   }else{
    if(!p.refresh_token)throw oauthError('invalid_request');
    const token=(await c.query("SELECT * FROM mcp_oauth_tokens WHERE hash=$1 AND kind='refresh' AND expires_at>now() FOR UPDATE",[digest(p.refresh_token)])).rows[0];
    if(!token)throw oauthError('invalid_grant');
    grant=await this.grant(c,token.grant_id,p.client_id,p.resource);
    if(token.used_at){await c.query('UPDATE mcp_oauth_grants SET revoked_at=now() WHERE id=$1',[grant.id]);return {compromised:true} as const;}
    if(p.scope){const requested=this.scopes(p.scope);if(requested.length!==grant.scopes.length||requested.some(s=>!grant.scopes.includes(s)))throw oauthError('invalid_scope');}
    await c.query('UPDATE mcp_oauth_tokens SET used_at=now() WHERE hash=$1',[digest(p.refresh_token)]);
   }
   const access='sbc_at_'+secret(),refresh='sbc_rt_'+secret();
   await c.query("INSERT INTO mcp_oauth_tokens(hash,grant_id,kind,expires_at) VALUES($1,$2,'access',now()+interval '15 minutes'),($3,$2,'refresh',now()+interval '30 days')",[digest(access),grant.id,digest(refresh)]);
   return {access_token:access,token_type:'Bearer',expires_in:900,refresh_token:refresh,scope:grant.scopes.join(' ')};
  });
  if('compromised' in outcome)throw oauthError('invalid_grant');
  return outcome;
 }
 private async grant(c:PoolClient,id:string,client:string,resource:string):Promise<Grant>{const row=(await c.query('SELECT * FROM mcp_oauth_grants WHERE id=$1 AND client_id=$2 AND resource=$3 AND revoked_at IS NULL AND store_id=$4 AND actor=$5 FOR UPDATE',[id,client,resource,this.owner.storeId,this.owner.email])).rows[0];if(!row)throw oauthError('invalid_grant');return row;}
 async authenticate(authorization:string|undefined){
  if(!authorization||!/^Bearer sbc_at_[A-Za-z0-9_-]{43}$/i.test(authorization))return;
  const row=(await this.pool.query("SELECT g.*,t.expires_at FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.id=t.grant_id WHERE t.hash=$1 AND t.kind='access' AND t.expires_at>now() AND g.revoked_at IS NULL AND g.resource=$2 AND g.store_id=$3 AND g.actor=$4",[digest(authorization.slice(7)),this.config.publicUrl,this.owner.storeId,this.owner.email])).rows[0];
  if(!row||!row.scopes.includes('catalog:read'))return;
  return {storeId:row.store_id as string,actor:row.actor as string,clientId:row.client_id as string,grantId:row.id as string,scopes:row.scopes as string[],expiresAt:Math.floor(new Date(row.expires_at).getTime()/1000)};
 }
 async revoke(input:unknown){const p=z.object({token:z.string().max(200),client_id:z.string().max(200),token_type_hint:z.string().max(30).optional()}).strict().parse(input);await this.pool.query('UPDATE mcp_oauth_grants SET revoked_at=now() WHERE client_id=$1 AND id IN (SELECT grant_id FROM mcp_oauth_tokens WHERE hash=$2)',[p.client_id,digest(p.token)]);return {};}
 async connections(){return (await this.pool.query('SELECT g.id,c.name,g.scopes,g.created_at FROM mcp_oauth_grants g JOIN mcp_oauth_clients c ON c.client_id=g.client_id WHERE g.store_id=$1 AND g.actor=$2 AND g.revoked_at IS NULL ORDER BY g.created_at DESC LIMIT 100',[this.owner.storeId,this.owner.email])).rows;}
 async disconnect(id:string){z.uuid().parse(id);await this.pool.query('UPDATE mcp_oauth_grants SET revoked_at=now() WHERE id=$1 AND store_id=$2 AND actor=$3',[id,this.owner.storeId,this.owner.email]);return {disconnected:true};}
 private async transaction<T>(run:(c:PoolClient)=>Promise<T>){const c=await this.pool.connect();try{await c.query('BEGIN');const result=await run(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
}
