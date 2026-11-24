import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {createApp} from '../apps/server/src/http/app.js';
import {fixtureStore,fixtureConversation} from '../profiles/hardware.js';
import {visibleChatPosition} from '../apps/dashboard/src/owner-chat-reading.js';

test('visible chat progress advances through visible messages but independently preserves a scrollback anchor',()=>{
 const element=(sequence:string,top:number,bottom:number)=>({dataset:{messageSequence:sequence},getBoundingClientRect:()=>({top,bottom})});
 const node={getBoundingClientRect:()=>({top:100,bottom:500}),querySelectorAll:()=>[element('10',0,90),element('11',90,180),element('12',180,550),element('13',550,800),element('0',200,300)]} as unknown as HTMLElement;
 assert.deepEqual(visibleChatPosition(node,'9'),{through:'12',anchor:'11',offset:-10});
 assert.deepEqual(visibleChatPosition(node,'20'),{through:'20',anchor:'11',offset:-10});
});

async function fixture(run:(pool:pg.Pool,app:Awaited<ReturnType<typeof createApp>>,headers:Record<string,string>)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='owner_reading_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{await setupDatabase(pool,'mock');const owner={hostname:'owner-reading.example.test',issuer:'https://offline.cloudflareaccess.com',audience:'offline',email:'owner@example.test',storeId:fixtureStore};app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/owner-reading-test',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'test'}));await run(pool,app,{host:owner.hostname,'cf-access-jwt-assertion':'offline',origin:'https://'+owner.hostname,'x-shopbot-owner':'1'});
 }finally{await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
const insertMessage=async(pool:pg.Pool,conversation=fixtureConversation,direction='inbound')=>(await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload) VALUES($1,$2,$3,'synthetic reading test','processed','{}') RETURNING sequence::text,id",[randomUUID(),conversation,direction])).rows[0];

test('order opened state binds the displayed snapshot, preserves workflow and leaves concurrent updates unread',()=>fixture(async(pool,app,headers)=>{
 const id=randomUUID();await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise) VALUES($1,$2,$3,'local-simulator',$4,'[]',0)",[id,fixtureStore,fixtureConversation,randomUUID()]);
 const get=async()=>(await app.inject({url:'/api/owner/snapshot?details=0',headers})).json();
 let snapshot=await get(),order=snapshot.requests.find((r:any)=>r.id===id);assert.equal(order.unread,true);const key=order.attention_key;
 assert.equal((await pool.query('SELECT count(*) FROM owner_order_reads')).rows[0].count,'0','GET never marks an order read');
 const seen=(attentionKey:string)=>app.inject({method:'POST',url:`/api/owner/requests/${id}/seen`,headers,payload:{attentionKey}});
 assert.equal((await seen(key)).json().seen,true);snapshot=await get();order=snapshot.requests.find((r:any)=>r.id===id);assert.equal(order.unread,false);assert.equal(order.stage,'new');
 await pool.query('UPDATE order_requests SET effective_revision=effective_revision+1 WHERE id=$1',[id]);assert.equal((await seen(key)).json().seen,false);snapshot=await get();order=snapshot.requests.find((r:any)=>r.id===id);assert.equal(order.unread,true);assert.notEqual(order.attention_key,key);
 assert.ok((await app.inject({url:'/api/owner/summary',headers})).json().attention.orders>=1);
 assert.equal((await app.inject({method:'POST',url:`/api/owner/requests/${id}/seen`,headers:{host:headers.host},payload:{attentionKey:key}})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:`/api/owner/requests/${id}/seen`,headers:{...headers,origin:'https://other.test'},payload:{attentionKey:key}})).statusCode,403);
}));

test('unread customer counts survive bot replies; visible progress is monotonic and anchors can move back',()=>fixture(async(pool,app,headers)=>{
 const a=await insertMessage(pool),b=await insertMessage(pool),bot=await insertMessage(pool,fixtureConversation,'outbound');
 const inbox=async()=>(await app.inject({url:'/api/owner/snapshot?details=0',headers})).json().conversations.find((c:any)=>c.id===fixtureConversation);
 assert.equal((await inbox()).unread_count,2);const history=(await app.inject({url:`/api/owner/conversations/${fixtureConversation}?resume=1`,headers})).json();assert.equal(history.reading.first_unread,a.sequence);assert.equal((await inbox()).unread_count,2,'loading does not mark read');
 const seen=(through:string,anchor=through)=>app.inject({method:'POST',url:`/api/owner/conversations/${fixtureConversation}/seen`,headers,payload:{through,anchor,offset:-25}});
 assert.equal((await seen(a.sequence)).statusCode,200);assert.equal((await inbox()).unread_count,1);
 const c=await insertMessage(pool);await insertMessage(pool,fixtureConversation,'outbound');await seen(bot.sequence);assert.equal((await inbox()).unread_count,1,'arrival after captured visible boundary stays unread');
 await seen(a.sequence,a.sequence);assert.equal((await inbox()).owner_read_sequence,bot.sequence,'scrolling back never lowers progress');
 const resumed=(await app.inject({url:`/api/owner/conversations/${fixtureConversation}?resume=1`,headers})).json();assert.equal(resumed.reading.anchor_sequence,a.sequence);assert.equal(resumed.reading.anchor_offset,-25);assert.equal(resumed.reading.first_unread,c.sequence);
 assert.equal((await seen('9223372036854775807')).statusCode,404,'future cursors cannot clear unseen arrivals');
 const foreign=randomUUID(),store=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'other shop','true')",[store]);await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'foreign')",[foreign,store]);const foreignMessage=await insertMessage(pool,foreign);
 assert.equal((await seen(foreignMessage.sequence)).statusCode,404,'another conversation sequence is rejected');
 assert.equal((await app.inject({method:'POST',url:`/api/owner/conversations/${foreign}/seen`,headers,payload:{through:foreignMessage.sequence,anchor:foreignMessage.sequence,offset:0}})).statusCode,404);
 assert.equal((await app.inject({url:`/api/owner/conversations/${foreign}?resume=1`,headers})).statusCode,404);
 const summary=(await app.inject({url:'/api/owner/summary',headers})).json();assert.equal(summary.attention.messages,1);assert.equal(summary.attention.chats,1);
}));

test('long histories restore around an old reading position and page forward and backward without gaps',()=>fixture(async(pool,app,headers)=>{
 await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload) SELECT gen_random_uuid(),$1,CASE WHEN i%2=0 THEN 'outbound' ELSE 'inbound' END,'synthetic history '||i,'processed','{}' FROM generate_series(1,650) i",[fixtureConversation]);
 const expected=(await pool.query('SELECT sequence::text FROM messages WHERE conversation_id=$1 ORDER BY messages.sequence',[fixtureConversation])).rows.map(r=>r.sequence);
 await app.inject({method:'POST',url:`/api/owner/conversations/${fixtureConversation}/seen`,headers,payload:{through:expected[80],anchor:expected[60],offset:12}});
 const read=async(query:string)=>{const response=await app.inject({url:`/api/owner/conversations/${fixtureConversation}${query}`,headers});assert.equal(response.statusCode,200,response.body);return response.json();};
 const first=await read('?resume=1');assert.ok(first.messages.some((m:any)=>m.sequence===expected[60]));assert.equal(first.reading.anchor_offset,12);assert.ok(first.newerCursor);assert.ok(first.olderCursor);
 const result=[...first.messages];let cursor=first.newerCursor;while(cursor){const next=await read('?after='+cursor);result.push(...next.messages);cursor=next.newerCursor;}
 cursor=first.olderCursor;while(cursor){const next=await read('?before='+cursor);result.unshift(...next.messages);cursor=next.olderCursor;}
 assert.deepEqual(result.map((m:any)=>m.sequence),expected);assert.equal(new Set(result.map((m:any)=>m.sequence)).size,650);
 assert.equal((await app.inject({url:`/api/owner/conversations/${fixtureConversation}?after=1&before=2`,headers})).statusCode,400);
}));
