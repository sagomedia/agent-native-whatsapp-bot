import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {createApp} from '../apps/server/src/http/app.js';
import {reserveRequest,closeRequestStock} from '../apps/server/src/services/inventory.js';
import type {DraftLine} from '../packages/contracts/index.js';

// Isolated local rehearsal only. The real owner app retains Access JWT checks.
// Injected identity exists solely inside this disposable loopback harness.
const databaseUrl=process.env.DATABASE_URL,port=Number(process.env.PORT??3043);
if(!databaseUrl||!['127.0.0.1','localhost','[::1]'].includes(new URL(databaseUrl).hostname))throw new Error('Use a disposable local DATABASE_URL.');
const schema='owner_usability_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:databaseUrl});if((await admin.query('SHOW server_encoding')).rows[0].server_encoding!=='UTF8'){await admin.end();throw new Error('Use a UTF8 disposable PostgreSQL database for Tamil preview data.');}await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new pg.Pool({connectionString:databaseUrl,options:`-c search_path=${schema}`});
await setupDatabase(pool,'mock');await setupImageDemo(pool);
// Synthetic conversations and orders cover daily task stages without channel credentials.
const catalog=(await pool.query("SELECT sku,name,unit,price_paise,version FROM products WHERE store_id=$1 AND sku IN ('H01','H20')",[demoCatalogStore])).rows;
const example=(sku:string):DraftLine=>{const product=catalog.find(row=>row.sku===sku)!;return {id:randomUUID(),query:product.name,name:product.name,sku,productVersion:product.version,quantity:sku==='H01'?2:1,unit:product.unit,pricePaise:product.price_paise,resolution:'matched'};};
for(let index=0;index<6;index++){
 const conversation=randomUUID(),order=randomUUID();
 await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language,handoff_requested) VALUES($1,$2,$3,'ta',$4)",[conversation,demoCatalogStore,'preview-shopper-'+(index+1),index===0]);
 await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status) VALUES($1,$2,'inbound',$3,'processed')",[randomUUID(),conversation,index===0?'Can the shop help me check this list?':'Please prepare two PVC pipes and one measuring tape.']);
 const complete=index>=3;
 const lines:DraftLine[]=[example('H01'),...(!complete?[{id:randomUUID(),query:'socket',name:'Socket — check size in store',quantity:2,unit:'piece',resolution:'unavailable' as const}]:[]),example('H20')];
 const total=lines.reduce((sum,line)=>sum+(line.pricePaise??0)*(line.quantity??0),0);
 await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise,estimate_complete,acceptance,fulfillment,packed_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",[order,demoCatalogStore,conversation,'preview-shopper-'+(index+1),randomUUID(),JSON.stringify(lines),total,complete,index>=4?'accepted':'awaiting_approval',index===4?'ready_for_pickup':index===5?'collected':'awaiting_approval',index>=4?1:null]);
 if(index>=4){const client=await pool.connect();try{await client.query('BEGIN');await reserveRequest(client,demoCatalogStore,order,lines,1,'synthetic-owner');if(index===5)await closeRequestStock(client,demoCatalogStore,order,'collect','synthetic-owner');await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}

}
const owner={hostname:'offline-owner.example.test',issuer:'https://offline.cloudflareaccess.com',audience:'offline-only',email:'offline-owner@example.test',storeId:demoCatalogStore};
const app=await createApp({mode:'mock',databaseUrl,host:'127.0.0.1',port,mediaDir:'/tmp/shopbot-owner-usability-preview',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline-only'}));
const origin=`http://127.0.0.1:${port}`;
const server=createServer(async(req,res)=>{
 if(req.headers.host!==`127.0.0.1:${port}`||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')){res.writeHead(403).end();return;}
 if(!['GET','HEAD'].includes(req.method??'')&&req.headers.origin!==origin){res.writeHead(403).end();return;}
 const chunks:Buffer[]=[];let size=0;for await(const b of req){size+=b.length;if(size>3000000){res.writeHead(413).end();return;}chunks.push(b);}
 const response=await app.inject({method:req.method as 'GET',url:req.url??'/',headers:{...req.headers,host:owner.hostname,'cf-access-jwt-assertion':'synthetic-offline-only',...(req.headers.origin?{origin:'https://'+owner.hostname}:{})},...(chunks.length?{payload:Buffer.concat(chunks)}:{})});
 const headers={...response.headers};delete headers['content-length'];res.writeHead(response.statusCode,headers);
 if(headers['content-type']?.toString().includes('text/html'))res.end(response.body.replace('<body>','<body><div class="owner-preview-note" role="status">Local preview · synthetic data</div>'));else res.end(response.rawPayload);
});
server.listen(port,'127.0.0.1',()=>console.log(`Dashboard usability preview: ${origin}/owner`));
let stopping=false;async function stop(){if(stopping)return;stopping=true;server.close();await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
process.on('SIGINT',()=>{void stop();});process.on('SIGTERM',()=>{void stop();});
