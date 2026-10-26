import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../apps/server/src/http/app.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore,fixtureConversation} from '../profiles/hardware.js';
const owner={hostname:'performance.example.test',issuer:'https://performance.cloudflareaccess.com',audience:'performance_test_audience',email:'owner@example.test',storeId:fixtureStore};
test('scoped reads preserve order facts and inbox metadata while omitting unrelated records; legacy snapshot stays complete',async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='perf_scopes_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{await setupDatabase(pool,'mock');const id=randomUUID();await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise) VALUES($1,$2,$3,'local-simulator',$4,'[]',0)",[id,fixtureStore,fixtureConversation,randomUUID()]);
 app=await createApp({mode:'mock',host:'127.0.0.1',port:3017,databaseUrl:process.env.DATABASE_URL!,mediaDir:'/tmp/shopbot-performance-media',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'performance-test'}));
 const headers={host:owner.hostname,'cf-access-jwt-assertion':'isolated-test'},read=async(query:string)=>{const r=await app!.inject({url:'/api/owner/snapshot?'+query,headers});assert.equal(r.statusCode,200,r.body);return r.json();};
 const full=await read('details=1'),orders=await read('details=0&scope=orders&orderStage=new'),inbox=await read('details=0&scope=inbox&inboxPage=1'),settings=await read('details=1&scope=settings');
 assert.ok(full.conversations.length);assert.ok(full.requests.some((r:any)=>r.id===id));assert.deepEqual(orders.conversations,[]);assert.deepEqual(inbox.requests,[]);assert.deepEqual(inbox.amendments,[]);assert.deepEqual(settings.requests,[]);assert.deepEqual(settings.conversations,[]);assert.deepEqual(settings.audit,[]);assert.ok(!('draft' in inbox.conversations[0]));
 const expected=full.requests.find((r:any)=>r.id===id),actual=orders.requests.find((r:any)=>r.id===id);assert.deepEqual(actual,expected);assert.equal(inbox.conversations[0].id,full.conversations[0].id);assert.equal(settings.store.id,full.store.id);assert.deepEqual(settings.budget,full.budget);assert.deepEqual(settings.usage,full.usage);
 const invalid=await app.inject({url:'/api/owner/snapshot?scope=invalid',headers});assert.equal(invalid.statusCode,400);
 const denied=await app.inject({url:'/api/owner/snapshot?scope=inbox',headers:{host:owner.hostname}});assert.equal(denied.statusCode,403);
 const catalog=(await app.inject({url:'/api/owner/catalog?limit=2',headers})).json(),compact=(await app.inject({url:'/api/owner/catalog?limit=2&metadata=compact',headers})).json();assert.deepEqual(compact.products,catalog.products);assert.equal(compact.total,catalog.total);assert.ok(compact.nodes.every((n:any)=>Object.keys(n).every(k=>['id','kind','label'].includes(k))));
 if(catalog.nextCursor){const next=await app.inject({url:'/api/owner/catalog?'+new URLSearchParams({limit:'2',cursor:catalog.nextCursor,metadata:'compact'}),headers});assert.equal(next.statusCode,200,next.body);}
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM owner_audit')).rows[0].n,0);
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
