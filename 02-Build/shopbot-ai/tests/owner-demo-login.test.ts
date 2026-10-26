import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {createApp} from '../apps/server/src/http/app.js';
import {hashDemoPassword} from '../apps/server/src/http/owner-demo-login.js';
import {readConfig,type Config} from '../apps/server/src/config.js';
import {CatalogOAuth} from '../apps/server/src/mcp/oauth.js';
import {fixtureStore} from '../profiles/hardware.js';
const password='synthetic-demo-password-2026';
const owner={hostname:'shopbot-preview.example.test',issuer:'https://shopbot-test.cloudflareaccess.com',audience:'test_application_audience_123',email:'owner@example.test',storeId:fixtureStore};
const headers={host:owner.hostname,origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json','cf-connecting-ip':'192.0.2.20'};
async function fixture(run:(pool:pg.Pool,app:Awaited<ReturnType<typeof createApp>>,config:Config)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='demo_login_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema});let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{await setupDatabase(pool,'mock');const config:Config={mode:'mock',host:'127.0.0.1',port:3017,databaseUrl:process.env.DATABASE_URL!,mediaDir:'/tmp/shopbot-demo-login-fixtures',owner:{...owner,demoLogin:{passwordHash:await hashDemoPassword(password),sessionHours:24}}};app=await createApp(config,pool);await run(pool,app,config);}finally{await app?.close();await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
}
const cleanHeaders=(h:Record<string,string|undefined>)=>Object.fromEntries(Object.entries(h).filter(([,v])=>v!==undefined)) as Record<string,string>;
const login=(app:Awaited<ReturnType<typeof createApp>>,value=password,next?:string,h=headers)=>app.inject({method:'POST',url:'/api/owner/session',headers:cleanHeaders(h),payload:JSON.stringify({password:value,next})});
const sessionCookie=(response:any)=>String(response.headers['set-cookie']).split(';')[0];
const rawCookie=(cookie:string)=>cookie.slice(cookie.indexOf('=')+1);

test('demo login is explicit opt-in and rejects incomplete, plaintext or unbounded configuration',async()=>{
 const base={DATABASE_URL:'postgres://localhost/test',OWNER_HOSTNAME:owner.hostname,CF_ACCESS_ISSUER:owner.issuer,CF_ACCESS_AUD:owner.audience,OWNER_EMAIL:owner.email,OWNER_STORE_ID:fixtureStore};
 assert.equal(readConfig(base).owner?.demoLogin,undefined);
 for(const values of [{OWNER_LOGIN_MODE:'password'},{OWNER_LOGIN_MODE:'demo_password'},{OWNER_LOGIN_MODE:'demo_password',OWNER_DEMO_PASSWORD_HASH:password}])assert.throws(()=>readConfig({...base,...values}));
 const hash=await hashDemoPassword(password);assert.ok(!hash.includes(password));assert.notEqual(hash,await hashDemoPassword(password));
 assert.equal(readConfig({...base,OWNER_LOGIN_MODE:'demo_password',OWNER_DEMO_PASSWORD_HASH:hash}).owner?.demoLogin?.sessionHours,24);
 assert.throws(()=>readConfig({...base,OWNER_LOGIN_MODE:'demo_password',OWNER_DEMO_PASSWORD_HASH:hash,OWNER_DEMO_SESSION_HOURS:'169'}));
 await assert.rejects(hashDemoPassword('short'));
});

test('password gate protects pages, APIs, assets and media, uses hashed expiring sessions and preserves current shop data',()=>fixture(async(pool,app)=>{
 const before=(await pool.query('SELECT sku,version,stock FROM products ORDER BY sku')).rows;
 const page=await app.inject({url:'/owner?view=catalog',headers:{host:owner.hostname}});assert.equal(page.statusCode,302);assert.match(page.headers.location!,/^\/login\?/);
 const loginPage=await app.inject({url:page.headers.location!,headers:{host:owner.hostname}});assert.equal(loginPage.statusCode,200);assert.match(loginPage.body,/Demo password/);assert.ok(!loginPage.body.includes(password));assert.match(loginPage.headers['content-security-policy']!,/script-src 'self'/);
 for(const path of ['/api/owner/summary','/api/owner/catalog','/api/owner/catalog/ai-activity','/api/owner/mcp/connections','/api/owner/conversations','/assets/private.js'])assert.equal((await app.inject({url:path,headers:{host:owner.hostname}})).statusCode,403,path);
 assert.equal((await app.inject({url:'/api/simulator',headers:{host:owner.hostname}})).statusCode,404);
 assert.equal((await app.inject({url:'/api/owner/summary',headers:{host:owner.hostname,'cf-access-jwt-assertion':'forged'}})).statusCode,403);
 assert.equal((await login(app,'incorrect-password')).statusCode,401);
 const response=await login(app,password,'/owner?view=catalog');assert.equal(response.statusCode,200);assert.equal(response.json().redirect,'/owner?view=catalog');
 const cookie=sessionCookie(response);assert.match(String(response.headers['set-cookie']),/Secure; HttpOnly; SameSite=Lax; Max-Age=86400/);assert.ok(!String(response.headers['set-cookie']).includes('Domain='));
 const session=(await pool.query('SELECT * FROM owner_demo_sessions')).rows[0];assert.equal(session.token_hash,createHash('sha256').update(rawCookie(cookie)).digest('hex'));assert.ok(!JSON.stringify(session).includes(rawCookie(cookie)));assert.equal(session.store_id,fixtureStore);
 const summary=await app.inject({url:'/api/owner/summary',headers:{host:owner.hostname,cookie}});assert.equal(summary.statusCode,200);assert.equal(summary.json().store.id,fixtureStore);assert.equal(summary.json().authMode,'demo_password');assert.ok(!summary.body.includes('passwordHash'));
 assert.equal((await app.inject({url:'/api/owner/summary',headers:{host:'wrong.example.test',cookie}})).statusCode,404);
 assert.equal((await app.inject({url:'/api/owner/summary',headers:{host:owner.hostname,cookie:cookie+'; '+cookie}})).statusCode,403);
 assert.equal((await app.inject({url:'/login?next=https://evil.example',headers:{host:owner.hostname,cookie}})).headers.location,'/owner');
 assert.equal((await login(app,password,'//evil.example')).json().redirect,'/owner');
 assert.deepEqual((await pool.query('SELECT sku,version,stock FROM products ORDER BY sku')).rows,before);
}));

test('logout revokes its session, expired cookies fail and shared-password writes keep existing CSRF protection',()=>fixture(async(pool,app)=>{
 const cookie=sessionCookie(await login(app));
 for(const origin of [undefined,'https://evil.example'])assert.equal((await app.inject({method:'POST',url:'/api/owner/logout',headers:cleanHeaders({...headers,cookie,origin}),payload:'{}'})).statusCode,403);
 const logout=await app.inject({method:'POST',url:'/api/owner/logout',headers:{...headers,cookie},payload:'{}'});assert.equal(logout.statusCode,200);assert.match(String(logout.headers['set-cookie']),/Max-Age=0/);
 assert.equal((await app.inject({url:'/api/owner/summary',headers:{host:owner.hostname,cookie}})).statusCode,403);
 const second=sessionCookie(await login(app));await pool.query("UPDATE owner_demo_sessions SET expires_at=now()-interval '1 second'");
 assert.equal((await app.inject({url:'/api/owner/summary',headers:{host:owner.hostname,cookie:second}})).statusCode,403);
}));

test('password rotation invalidates older sessions and Cloudflare mode never accepts demo cookies',()=>fixture(async(pool,app,config)=>{
 const cookie=sessionCookie(await login(app));const rotated=await createApp({...config,owner:{...config.owner!,demoLogin:{passwordHash:await hashDemoPassword('a-different-demo-password'),sessionHours:1}}},pool);
 const cloudflare=await createApp({...config,owner:{...owner}},pool,undefined,undefined,async()=>({email:owner.email,subject:'synthetic-owner'}));
 try{
  assert.equal((await rotated.inject({url:'/api/owner/summary',headers:{host:owner.hostname,cookie}})).statusCode,403);
  assert.equal((await login(rotated)).statusCode,401);
  assert.equal((await cloudflare.inject({url:'/api/owner/summary',headers:{host:owner.hostname,cookie}})).statusCode,403);
  assert.equal((await cloudflare.inject({url:'/api/owner/summary',headers:{host:owner.hostname,'cf-access-jwt-assertion':'fixture'}})).statusCode,200);
  assert.equal((await cloudflare.inject({method:'POST',url:'/api/owner/session',headers,payload:JSON.stringify({password})})).statusCode,403);
 }finally{await rotated.close();await cloudflare.close();}
}));

test('login rejects foreign origins, malformed bodies and wrong hosts without issuing sessions',()=>fixture(async(pool,app)=>{
 for(const h of [{...headers,origin:'https://evil.example'},{...headers,origin:undefined},{...headers,'x-shopbot-owner':undefined},{...headers,host:'wrong.example.test'}])assert.ok((await login(app,password,undefined,h as any)).statusCode>=400);
 assert.equal((await app.inject({method:'POST',url:'/api/owner/session',headers,payload:JSON.stringify({password,unexpected:true})})).statusCode,400);
 assert.equal((await app.inject({method:'POST',url:'/api/owner/session',headers,payload:JSON.stringify({password:'x'.repeat(5000)})})).statusCode,413);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM owner_demo_sessions')).rows[0].n,0);
}));

test('persistent per-client and global login budgets survive fresh processes without logging raw IPs',()=>fixture(async(pool,app,config)=>{
 for(let i=0;i<10;i++)assert.equal((await login(app,'wrong')).statusCode,401);
 assert.equal((await login(app)).statusCode,429);
 const fresh=await createApp(config,pool);try{assert.equal((await login(fresh)).statusCode,429);}finally{await fresh.close();}
 assert.ok(!(await pool.query('SELECT bucket FROM owner_demo_login_limits')).rows.some(r=>r.bucket.includes('192.0.2.20')));
 await pool.query("UPDATE owner_demo_login_limits SET window_started_at=now()-interval '16 minutes'");assert.equal((await login(app)).statusCode,200);
 await pool.query("UPDATE owner_demo_login_limits SET attempts=120 WHERE bucket='global'");assert.equal((await login(app,password,undefined,{...headers,'cf-connecting-ip':'192.0.2.99'})).statusCode,429);
}));


test('demo login preserves MCP authorization return paths and connected tools still require OAuth grants',()=>fixture(async(pool,app,config)=>{
 const remote={publicUrl:'https://demo-mcp.example.test/mcp'},connected=await createApp({...config,remoteMcp:remote},pool);
 try{
  const returnPath='/api/owner/mcp/authorize?client_id=fixture&state=opaque-state';
  const gate=await connected.inject({url:returnPath,headers:{host:owner.hostname}});assert.equal(gate.statusCode,302);assert.equal(new URL('https://'+owner.hostname+gate.headers.location).searchParams.get('next'),returnPath);
  const signedIn=await login(connected,password,returnPath);assert.equal(signedIn.json().redirect,returnPath);
  const cookie=sessionCookie(signedIn),mcpHeaders={host:'demo-mcp.example.test','content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'};
  assert.equal((await connected.inject({url:'/.well-known/oauth-protected-resource/mcp',headers:{host:mcpHeaders.host}})).statusCode,200);
  const payload={jsonrpc:'2.0',id:1,method:'tools/list',params:{}};
  assert.equal((await connected.inject({method:'POST',url:'/mcp',headers:{...mcpHeaders,cookie},payload})).statusCode,401);
  const oauth=new CatalogOAuth(pool,remote,config.owner!),client=await oauth.register({client_name:'Synthetic demo connection',redirect_uris:['https://chatgpt.com/connector_platform/oauth/callback']}),verifier=randomBytes(32).toString('base64url');
  const pending=await oauth.prepare({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource:remote.publicUrl,state:randomUUID(),scope:'catalog:read catalog:draft'});
  const consent=await oauth.consent({id:pending.id,csrf:pending.csrf,allow:true}),token=await oauth.token({grant_type:'authorization_code',client_id:client.client_id,code:new URL(consent.redirect).searchParams.get('code'),redirect_uri:client.redirect_uris[0],code_verifier:verifier,resource:remote.publicUrl});
  const tools=await connected.inject({method:'POST',url:'/mcp',headers:{...mcpHeaders,authorization:'Bearer '+token.access_token},payload});assert.equal(tools.statusCode,200);assert.match(tools.body,/catalog_search/);
 }finally{await connected.close();}
}));
