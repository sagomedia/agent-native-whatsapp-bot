import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo} from '../apps/server/src/services/demo-catalog.js';
import {createApp} from '../apps/server/src/http/app.js';
import {MockInterpreter} from '../apps/server/src/adapters/mock-interpreter.js';
import {geminiTextRate} from '../apps/server/src/services/inference-budget.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';

// Isolated, synthetic browser preview. Never imports keys or calls an AI/Meta API.
const databaseUrl=process.env.DATABASE_URL;if(!databaseUrl)throw new Error('Set a disposable local DATABASE_URL for the preview.');
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(databaseUrl).hostname))throw new Error('The offline preview requires a local disposable database.');
const schema='customer_preview_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:databaseUrl});
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool=new pg.Pool({connectionString:databaseUrl,options:`-c search_path=${schema}`}),mock=new MockInterpreter();
const provider:Interpreter={name:'offline-preview',mode:'live',billing:geminiTextRate,freeQuota:{scope:schema,model:geminiTextRate.model},interpret:async(input,signal)=>{
  const output=input.stage==='recommend'?{operations:[],next:'assist',assistance:input.proposal?.assistance}: (await mock.interpret(input,signal)).output;
  return {output,truncated:false,usage:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20},responseModel:geminiTextRate.model};
}};
let app:Awaited<ReturnType<typeof createApp>>;
try{await setupDatabase(pool,'mock');const store=await setupImageDemo(pool);app=await createApp({mode:'mock',databaseUrl,host:'127.0.0.1',port:Number(process.env.PORT??3041),mediaDir:'/tmp/shopbot-offline-preview'},pool,provider,store);await app.listen({host:'127.0.0.1',port:Number(process.env.PORT??3041)});console.log(`Offline customer preview: http://127.0.0.1:${process.env.PORT??3041}/native-test`);}
catch(error){await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();throw error;}
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await app.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
process.on('SIGINT',()=>{void stop();});process.on('SIGTERM',()=>{void stop();});
