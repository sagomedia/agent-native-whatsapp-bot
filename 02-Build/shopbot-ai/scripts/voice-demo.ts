// Disposable local UI and controlled transcripts; no external AI or WhatsApp sends.
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo} from '../apps/server/src/services/demo-catalog.js';
import {createApp} from '../apps/server/src/http/app.js';
import {geminiTextRate} from '../apps/server/src/services/inference-budget.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
const url=process.env.DATABASE_URL!;if(new URL(url).hostname!=='127.0.0.1')throw Error('Disposable local DB only');
const schema='voice_demo_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:url});await admin.query(`CREATE SCHEMA ${schema}`);const pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`});await setupDatabase(pool,'mock');const store=await setupImageDemo(pool);
process.env.LOCAL_VISUAL_ORDERING_ENABLED='true';process.env.VISUAL_MEDIA_DIR='artifacts/voice-operations/images';
const provider:Interpreter={name:'Offline fixture · controlled transcript',mode:'live',supportsAudio:true,billing:geminiTextRate,freeQuota:{scope:schema,model:geminiTextRate.model},interpret:async input=>{
 const output=input.stage==='recognize'?{operations:[],next:'continue',transcript:'கடைக்கு அனுப்புங்க'}:!input.state.draft.length?{operations:[{kind:'add_item',query:'H13',quantity:1},{kind:'add_item',query:'H05',quantity:1}],next:'review'}:{operations:[],next:'continue'};
 return {output,truncated:false,usage:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20},responseModel:geminiTextRate.model};
}};
const app=await createApp({mode:'mock',databaseUrl:url,host:'127.0.0.1',port:3056,mediaDir:'/tmp/shopbot-voice-demo'},pool,provider,store);await app.listen({host:'127.0.0.1',port:3056});
const owner={hostname:'owner.example.test',issuer:'https://offline.test',audience:'offline-only',email:'owner@example.test',storeId:store};
const ownerApp=await createApp({mode:'mock',databaseUrl:url,host:'127.0.0.1',port:3057,mediaDir:'/tmp/shopbot-voice-demo',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:"offline-owner"}));await ownerApp.listen({host:'127.0.0.1',port:3057});
console.log('Controlled fixture: customer 3056, owner 3057. No external sends.');
let stopping=false;async function close(){if(stopping)return;stopping=true;await app.close();await ownerApp.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();process.exit(0);}process.on('SIGINT',close);process.on('SIGTERM',close);
