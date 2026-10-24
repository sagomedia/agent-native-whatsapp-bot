import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {createApp} from '../apps/server/src/http/app.js';

// Isolated local rehearsal only. The real owner app retains Access JWT checks.
// Injected identity exists solely inside this disposable loopback harness.
const databaseUrl=process.env.DATABASE_URL,port=Number(process.env.PORT??3042);
if(!databaseUrl||!['127.0.0.1','localhost','[::1]'].includes(new URL(databaseUrl).hostname))throw new Error('Use a disposable local DATABASE_URL.');
const schema='owner_rehearsal_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:databaseUrl});await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new pg.Pool({connectionString:databaseUrl,options:`-c search_path=${schema}`});
await setupDatabase(pool,'mock');await setupImageDemo(pool);
const chat=randomUUID(),other=randomUUID();
for(const [id,actor] of [[chat,'reading-demo'],[other,'unread-demo']])await pool.query("INSERT INTO conversations(id,store_id,actor,visual_ordering) VALUES($1,$2,$3,true)",[id,demoCatalogStore,actor]);
await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload) SELECT gen_random_uuid(),$1,CASE WHEN i%2=0 THEN 'outbound' ELSE 'inbound' END,CASE WHEN i%2=0 THEN 'Bot reply ' ELSE 'Customer message ' END||i,'processed','{}' FROM generate_series(1,360) i",[chat]);
await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload) SELECT gen_random_uuid(),$1,'inbound','Unread shopping message '||i,'processed','{}' FROM generate_series(1,5) i",[other]);
const sequences=(await pool.query('SELECT sequence FROM messages WHERE conversation_id=$1 ORDER BY messages.sequence',[chat])).rows;
await pool.query('INSERT INTO owner_chat_reads(conversation_id,read_sequence,anchor_sequence,anchor_offset) VALUES($1,$2,$3,12)',[chat,sequences[159].sequence,sequences[119].sequence]);
for(const [id,conversation] of [[randomUUID(),chat],[randomUUID(),other]])await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise) SELECT $1,$2,c.id,c.actor,$4,$5,10000 FROM conversations c WHERE c.id=$3",[id,demoCatalogStore,conversation,randomUUID(),JSON.stringify([{id:randomUUID(),name:'Sample paint',quantity:1,unit:'can',pricePaise:10000,resolution:'unavailable'}])]);
console.log(JSON.stringify({schema,chat,other,port}));
const owner={hostname:'offline-owner.example.test',issuer:'https://offline.cloudflareaccess.com',audience:'offline-only',email:'offline-owner@example.test',storeId:demoCatalogStore};
const app=await createApp({mode:'mock',databaseUrl,host:'127.0.0.1',port,mediaDir:'/tmp/shopbot-owner-rehearsal',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline-only'}));
const origin=`http://127.0.0.1:${port}`;
const server=createServer(async(req,res)=>{
 if(req.headers.host!==`127.0.0.1:${port}`||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')){res.writeHead(403).end();return;}
 if(!['GET','HEAD'].includes(req.method??'')&&req.headers.origin!==origin){res.writeHead(403).end();return;}
 const chunks:Buffer[]=[];let size=0;for await(const b of req){size+=b.length;if(size>3000000){res.writeHead(413).end();return;}chunks.push(b);}
 const response=await app.inject({method:req.method as 'GET',url:req.url??'/',headers:{...req.headers,'accept-encoding':'identity',host:owner.hostname,'cf-access-jwt-assertion':'synthetic-offline-only',...(req.headers.origin?{origin:'https://'+owner.hostname}:{})},...(chunks.length?{payload:Buffer.concat(chunks)}:{})});
 const headers={...response.headers};delete headers['content-length'];res.writeHead(response.statusCode,headers);
 if(headers['content-type']?.toString().includes('text/html'))res.end(response.body.replace('<body>','<body><div role="status" style="padding:8px;background:#fff2c6;color:#402e08;text-align:center">Offline owner rehearsal · synthetic database · no WhatsApp, AI or payments</div>'));else res.end(response.rawPayload);
});
server.listen(port,'127.0.0.1',()=>console.log(`Owner rehearsal: ${origin}/owner`));
let stopping=false;async function stop(){if(stopping)return;stopping=true;server.close();await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
process.on('SIGINT',()=>{void stop();});process.on('SIGTERM',()=>{void stop();});
