import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {createApp} from '../apps/server/src/http/app.js';
import {importCatalogPackage} from '../apps/server/src/services/catalog-package.js';

// Isolated local rehearsal only. The real owner app retains Access JWT checks.
// Injected identity exists solely inside this disposable loopback harness.
const databaseUrl=process.env.DATABASE_URL,port=Number(process.env.PORT??3042);
if(!databaseUrl||!['127.0.0.1','localhost','[::1]'].includes(new URL(databaseUrl).hostname))throw new Error('Use a disposable local DATABASE_URL.');
const schema='owner_rehearsal_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:databaseUrl});await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new pg.Pool({connectionString:databaseUrl,options:`-c search_path=${schema}`});
await setupDatabase(pool,'mock');await setupImageDemo(pool);
const imported=await importCatalogPackage(pool,demoCatalogStore,'offline-owner-rehearsal',resolve('../../01-Input/catalog-100-corrected'),n=>{if(n%25===0)console.log(`${n}/100 source drafts staged`);});if(imported.failed)throw new Error('Catalog rehearsal import failed.');
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
