import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {createApp} from '../apps/server/src/http/app.js';
import {reserveRequest,closeRequestStock} from '../apps/server/src/services/inventory.js';
import type {DraftLine} from '../packages/contracts/index.js';

// Disposable loopback integration fixture; production Access checks remain intact.
const databaseUrl=process.env.DATABASE_URL,port=Number(process.env.PORT??3048);
if(!databaseUrl||!['127.0.0.1','localhost','[::1]'].includes(new URL(databaseUrl).hostname))throw new Error('Use a disposable local DATABASE_URL.');
const schema='redesign_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:databaseUrl});
if((await admin.query('SHOW server_encoding')).rows[0].server_encoding!=='UTF8')throw new Error('A UTF8 database is required.');
await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new pg.Pool({connectionString:databaseUrl,options:`-c search_path=${schema}`});
await setupDatabase(pool,'mock');await setupImageDemo(pool);
await pool.query('UPDATE stores SET name=$2 WHERE id=$1',[demoCatalogStore,'Murugan Hardware']);
await pool.query("UPDATE products SET price_status='priced',stock=40 WHERE store_id=$1",[demoCatalogStore]);
await pool.query("UPDATE products SET stock=0 WHERE store_id=$1 AND sku='H02'",[demoCatalogStore]);
await pool.query("INSERT INTO whatsapp_channels(phone_id,store_id,app_id,waba_id,verified_at,last_received_at) VALUES('redesign-local',$1,'fixture','fixture',now(),now())",[demoCatalogStore]);
const catalog=(await pool.query("SELECT sku,name,unit,price_paise,version FROM products WHERE store_id=$1 AND sku IN ('H01','H20')",[demoCatalogStore])).rows;
const example=(sku:string):DraftLine=>{const product=catalog.find(row=>row.sku===sku)!;return {id:randomUUID(),query:product.name,name:product.name,sku,productVersion:product.version,quantity:sku==='H01'?2:1,unit:product.unit,pricePaise:product.price_paise,resolution:'matched'};};
const fixtures:Record<string,string>={schema};
for(const [index,name] of ['Ramesh Kumar','Priya Stores','Senthil Electric','Lakshmi Builders','Arun Kumar'].entries()){
 const conversation=randomUUID(),order=randomUUID(),review=randomUUID(),lines=[example('H01'),example('H20')];
 await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language,handoff_requested) VALUES($1,$2,$3,'en',$4)",[conversation,demoCatalogStore,'whatsapp',index===0]);
 await pool.query("INSERT INTO whatsapp_conversations(conversation_id,phone_id,recipient,last_inbound_at,profile_name) VALUES($1,'redesign-local',$2,now(),$3)",[conversation,'91900000000'+index,name]);
 await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status) VALUES($1,$2,'inbound',$3,'processed')",[randomUUID(),conversation,index===0?'Can you prepare two PVC pipes and one measuring tape? I will collect this evening.':'Please check these items for pickup.']);
 await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status) VALUES($1,$2,'outbound',$3,'sent')",[randomUUID(),conversation,'Your list is with the shop. We will let you know when it is ready.']);
 const ready=index===2,completed=index===3;
 await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise,estimate_complete,acceptance,fulfillment,packed_revision,advance_required) VALUES($1,$2,$3,'whatsapp',$4,$5,$6,true,$7,$8,$9,$10)",[order,demoCatalogStore,conversation,review,JSON.stringify(lines),lines.reduce((n,l)=>n+l.pricePaise!*l.quantity!,0),ready||completed?'accepted':'awaiting_approval',ready?'ready_for_pickup':completed?'collected':'awaiting_approval',ready||completed?1:null,index===1]);
 if(ready||completed){const c=await pool.connect();try{await c.query('BEGIN');await reserveRequest(c,demoCatalogStore,order,lines,1,'fixture-owner');if(completed)await closeRequestStock(c,demoCatalogStore,order,'collect','fixture-owner');await c.query('COMMIT');}finally{c.release();}}
 if(index===1)await pool.query("INSERT INTO order_advances(id,store_id,request_id,payee_vpa,payee_name,upi_uri,review_id,state,amount_paise,claimed_at) VALUES($1,$2,$3,'fixture@invalid','Murugan Hardware','upi://pay?pa=fixture%40invalid&am=10',$4,'claimed',1000,now())",[randomUUID(),demoCatalogStore,order,review]);
 fixtures[index===0?'newOrder':index===1?'advanceOrder':index===2?'readyOrder':index===3?'completedOrder':'extraOrder']=order;
 fixtures['conversation'+index]=conversation;
}
const owner={hostname:'redesign-owner.example.test',issuer:'https://offline.cloudflareaccess.com',audience:'offline-only',email:'murugan.owner@example.test',storeId:demoCatalogStore};
const app=await createApp({mode:'mock',databaseUrl,host:'127.0.0.1',port,mediaDir:'/tmp/shopbot-redesign-preview',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline-only'}));
const origin=`http://127.0.0.1:${port}`;
const server=createServer(async(req,res)=>{
 if(req.headers.host!==`127.0.0.1:${port}`||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')){res.writeHead(403).end();return;}
 if(!['GET','HEAD'].includes(req.method??'')&&req.headers.origin!==origin){res.writeHead(403).end();return;}
 const chunks:Buffer[]=[];let size=0;for await(const b of req){size+=b.length;if(size>3000000){res.writeHead(413).end();return;}chunks.push(b);}
 const response=await app.inject({method:req.method as 'GET',url:req.url??'/',headers:{...req.headers,host:owner.hostname,'cf-access-jwt-assertion':'synthetic-offline-only',...(req.headers.origin?{origin:'https://'+owner.hostname}:{})},...(chunks.length?{payload:Buffer.concat(chunks)}:{})});
 const headers={...response.headers};delete headers['content-length'];res.writeHead(response.statusCode,headers);res.end(response.rawPayload);
});
const output=process.env.REDESIGN_EVIDENCE_DIR??'/home/gk-pc/shopbot-redesign/03-Output/minimal-owner-redesign-20261022/evidence';await mkdir(output,{recursive:true});await writeFile(output+'/fixture.json',JSON.stringify({...fixtures,origin,synthetic:true},null,2));
server.listen(port,'127.0.0.1',()=>console.log(`Redesign integration preview: ${origin}/owner (schema ${schema})`));
let stopping=false;async function stop(){if(stopping)return;stopping=true;server.close();await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
process.on('SIGINT',()=>{void stop();});process.on('SIGTERM',()=>{void stop();});
