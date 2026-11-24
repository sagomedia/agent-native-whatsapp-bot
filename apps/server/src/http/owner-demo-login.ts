import {createHash,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import type {Pool} from 'pg';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {OwnerConfig} from '../config.js';

export type DemoLoginConfig={passwordHash:string;sessionHours:number};
export const demoPasswordPattern=/^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/;
const cookieName='__Host-shopbot_demo';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const derive=(password:string,salt:Buffer)=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024},(e,value)=>e?reject(e):resolve(value)));
export async function hashDemoPassword(password:string){
 if(password.length<12||password.length>256)throw Error('Use a demo password between 12 and 256 characters.');
 const salt=randomBytes(16);return 'scrypt-v1$'+salt.toString('hex')+'$'+(await derive(password,salt)).toString('hex');
}
function sessionToken(request:FastifyRequest){
 const cookies=(request.headers.cookie??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(cookieName+'='));
 if(cookies.length!==1)return;const value=cookies[0].slice(cookieName.length+1);return /^[A-Za-z0-9_-]{43}$/.test(value)?value:undefined;
}
function destination(value:unknown,host:string){
 if(typeof value!=='string'||value.length>2048)return '/owner';
 try{const u=new URL(value,'https://'+host);if(u.origin==='https://'+host&&['/owner','/api/owner/mcp/authorize'].includes(u.pathname))return u.pathname+u.search;}catch{}
 return '/owner';
}
const loginJs=`const form=document.querySelector('form'),password=document.querySelector('#password'),message=document.querySelector('#message'),submit=form.querySelector('button[type=submit]');document.querySelector('#show').addEventListener('click',e=>{const show=password.type==='password';password.type=show?'text':'password';e.currentTarget.textContent=show?'Hide':'Show';e.currentTarget.setAttribute('aria-pressed',String(show));});form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;message.textContent='Signing in…';try{const response=await fetch('/api/owner/session',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-shopbot-owner':'1'},body:JSON.stringify({password:password.value,next:new URLSearchParams(location.search).get('next')??'/owner'})});const result=await response.json();if(!response.ok)throw Error(result.error??'Could not sign in. Please try again.');password.value='';location.replace(result.redirect);}catch(error){message.textContent=error.message;submit.disabled=false;password.focus();}});`;
const loginCss=`*{box-sizing:border-box}body{margin:0;background:#f5f7f8;color:#18242c;font:17px/1.6 system-ui,-apple-system,sans-serif}header{background:white;border-bottom:1px solid #d9e0e4;padding:20px 24px;color:#006f75;font-weight:700}main{max-width:460px;margin:clamp(32px,12vh,110px) auto;padding:0 22px}h1{font-size:32px;line-height:1.2;letter-spacing:-.03em;margin:0 0 12px}p{color:#56646e;margin:0 0 28px}label{display:block;font-weight:600;margin-bottom:8px}.field{display:flex;border:1px solid #9eacb5;border-radius:6px;background:white;overflow:hidden}.field:focus-within{outline:3px solid #b5dedf;border-color:#006f75}input{width:100%;min-width:0;border:0;outline:0;padding:14px 12px;font:inherit;background:transparent}button{font:inherit;cursor:pointer}#show{border:0;background:white;color:#006f75;padding:10px 14px;min-width:70px}button[type=submit]{margin-top:18px;width:100%;min-height:50px;background:#006f75;border:1px solid #006f75;border-radius:6px;color:white;font-weight:600}button:focus-visible{outline:3px solid #49a8ac;outline-offset:3px}button:disabled{opacity:.65;cursor:wait}#message{margin-top:16px;min-height:28px;color:#9f2626}small{display:block;margin-top:24px;color:#65747f;font-size:14px}@media(max-width:380px){h1{font-size:28px}header{padding:16px 22px}}`;
const loginHtml='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KSMC demo sign in</title><link rel="stylesheet" href="/login.css"><script src="/login.js" defer></script></head><body><header>KSMC Inventory</header><main><h1>Open the demo</h1><p>Enter the shared demo password to continue.</p><form><label for="password">Demo password</label><div class="field"><input id="password" name="password" type="password" autocomplete="current-password" autocapitalize="none" spellcheck="false" maxlength="256" required autofocus><button id="show" type="button" aria-controls="password" aria-pressed="false">Show</button></div><button type="submit">Enter dashboard</button><div id="message" role="status" aria-live="polite"></div></form><small>This password opens the existing demo dashboard. Everyone using it has the same access.</small></main></body></html>';

export function ownerDemoLogin(app:FastifyInstance,pool:Pool,owner:OwnerConfig,config:DemoLoginConfig){
 if(!demoPasswordPattern.test(config.passwordHash))throw Error('Invalid demo password hash.');
 const [,salt,expected]=config.passwordHash.split('$'),passwordVersion=digest(config.passwordHash),sessions=new WeakMap<FastifyRequest,{hash:string;expiresAt:Date}>();let inFlight=0;
 const sameOrigin=(r:FastifyRequest)=>r.headers.host===owner.hostname&&r.headers.origin==='https://'+owner.hostname&&r.headers['x-shopbot-owner']==='1'&&r.headers['content-type']?.startsWith('application/json');
 const cookie=(value:string,seconds:number)=>`${cookieName}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
 const publicPath=(path:string,method:string)=>method==='GET'&&['/login','/login.js','/login.css'].includes(path)||method==='POST'&&path==='/api/owner/session';
 async function authenticated(request:FastifyRequest){
  const token=sessionToken(request);if(!token)return false;const hash=digest(token);
  const row=(await pool.query('SELECT expires_at FROM owner_demo_sessions WHERE token_hash=$1 AND store_id=$2 AND hostname=$3 AND password_version=$4 AND expires_at>clock_timestamp()',[hash,owner.storeId,owner.hostname,passwordVersion])).rows[0];
  if(!row)return false;sessions.set(request,{hash,expiresAt:row.expires_at});return true;
 }
 async function attempt(bucket:string,limit:number){
  const r=(await pool.query(`INSERT INTO owner_demo_login_limits(store_id,bucket,attempts) VALUES($1,$2,1) ON CONFLICT(store_id,bucket) DO UPDATE SET attempts=CASE WHEN owner_demo_login_limits.window_started_at<clock_timestamp()-interval '15 minutes' THEN 1 ELSE owner_demo_login_limits.attempts+1 END,window_started_at=CASE WHEN owner_demo_login_limits.window_started_at<clock_timestamp()-interval '15 minutes' THEN clock_timestamp() ELSE owner_demo_login_limits.window_started_at END RETURNING attempts`,[owner.storeId,bucket])).rows[0];return r.attempts<=limit;
 }
 app.get('/login',async(request,reply)=>{
  if(request.headers.host!==owner.hostname)return reply.code(404).send();
  if(await authenticated(request))return reply.redirect(destination((request.query as {next?:string}).next,owner.hostname));
  return reply.header('Cache-Control','no-store').type('text/html').send(loginHtml);
 });
 app.get('/login.js',async(_request,reply)=>reply.header('Cache-Control','no-store').type('application/javascript').send(loginJs));
 app.get('/login.css',async(_request,reply)=>reply.header('Cache-Control','no-store').type('text/css').send(loginCss));
 app.post('/api/owner/session',{bodyLimit:4096},async(request,reply)=>{
  if(!sameOrigin(request))return reply.code(403).send({error:'Invalid sign-in request.'});
  const parsed=z.object({password:z.string().min(1).max(256),next:z.string().max(2048).optional()}).strict().safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:'Enter the demo password.'});
  if(inFlight>=2)return reply.header('Retry-After','2').code(429).send({error:'Another sign-in is being checked. Please try again.'});
  inFlight++;
  try{
   if(!await attempt('global',120))return reply.header('Retry-After','900').code(429).send({error:'Too many sign-in attempts. Please try again in 15 minutes.'});
   const cf=request.headers['cf-connecting-ip'],ip=typeof cf==='string'&&isIP(cf)?cf:request.ip;
   if(!await attempt('ip:'+digest(ip),10))return reply.header('Retry-After','900').code(429).send({error:'Too many sign-in attempts. Please try again in 15 minutes.'});
   const actual=await derive(parsed.data.password,Buffer.from(salt,'hex'));
   if(!timingSafeEqual(actual,Buffer.from(expected,'hex')))return reply.code(401).send({error:'Incorrect demo password. Please try again.'});
   const token=randomBytes(32).toString('base64url'),seconds=config.sessionHours*3600;
   await pool.query("DELETE FROM owner_demo_sessions WHERE store_id=$1 AND (expires_at<clock_timestamp() OR password_version<>$2)",[owner.storeId,passwordVersion]);
   await pool.query("DELETE FROM owner_demo_login_limits WHERE store_id=$1 AND window_started_at<clock_timestamp()-interval '1 day'",[owner.storeId]);
   await pool.query("INSERT INTO owner_demo_sessions(token_hash,store_id,hostname,password_version,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+$5*interval '1 second')",[digest(token),owner.storeId,owner.hostname,passwordVersion,seconds]);
   return reply.header('Set-Cookie',cookie(token,seconds)).send({redirect:destination(parsed.data.next,owner.hostname)});
  }finally{inFlight--;}
 });
 app.post('/api/owner/logout',async(request,reply)=>{
  const session=sessions.get(request);if(!sameOrigin(request)||!session)return reply.code(403).send({error:'Owner sign-in required'});
  await pool.query('DELETE FROM owner_demo_sessions WHERE token_hash=$1 AND store_id=$2',[session.hash,owner.storeId]);
  return reply.header('Set-Cookie',cookie('',0)).send({signedOut:true});
 });
 return {authenticated,publicPath,session:(request:FastifyRequest)=>sessions.get(request),loginUrl:(url:string)=>'/login?'+new URLSearchParams({next:destination(url,owner.hostname)})};
}
