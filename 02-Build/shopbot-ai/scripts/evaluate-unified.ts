import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {z} from 'zod';
import pg from 'pg';
import {GoogleInterpreter,readNativeSettings} from '../apps/server/src/adapters/google-interpreter.js';
import {GEMINI_MODEL_ID} from '../packages/contracts/model-policy.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {initializeBudget} from '../apps/server/src/services/inference-budget.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {normalizeVoice,voiceUploadSchema} from '../apps/server/src/services/voice-media.js';
import {normalizeImage,imageUploadSchema} from '../apps/server/src/services/image-media.js';
const message=z.object({kind:z.enum(['text','audio','image']),text:z.string().max(4000).optional(),path:z.string().optional(),mimeType:z.string().optional()}).strict();
const casesSchema=z.object({cases:z.array(z.object({id:z.string().min(1),messages:z.array(message).min(1).max(20),expected:z.object({draftCount:z.number().int().min(0).max(50).optional(),counts:z.array(z.number().nullable()).optional(),orders:z.number().int().min(0).optional()}).strict().optional()}).strict()).min(1).max(100)}).strict();
async function main(){
 const settings={...readNativeSettings(),unifiedUnderstanding:true,allowImageLists:true,allowMultimodal:true};
 if(settings.freeQuota)throw new Error('Use an explicitly metered evaluation allowance; no free-tier spacing bypass.');
 if(process.argv.includes('--preflight')){console.log(JSON.stringify({configured:true,model:GEMINI_MODEL_ID,budgetMicrousd:settings.budgetMicrousd,networkCalls:0,unifiedUnderstanding:true,handwrittenLists:true}));return;}
 const path=process.argv[process.argv.indexOf('--fixtures')+1];if(!process.argv.includes('--fixtures')||!path)throw new Error('Provide --fixtures /absolute/path/to/cases.json');
 const databaseUrl=process.env.DATABASE_URL;if(process.env.APP_MODE!=='mock'||!databaseUrl)throw new Error('APP_MODE=mock and a dedicated local DATABASE_URL are required');
 const url=new URL(databaseUrl);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw new Error('Evaluation requires a dedicated local database ending in _test');
 const cases=casesSchema.parse(JSON.parse(await readFile(path,'utf8'))).cases;
 const admin=new pg.Pool({connectionString:databaseUrl});await admin.query('CREATE SCHEMA IF NOT EXISTS flash_lite_evaluation');await admin.end();
 const pool=new pg.Pool({connectionString:databaseUrl,options:'-c search_path=flash_lite_evaluation'});
 const results:unknown[]=[];let failed=0;
 try{
  await setupDatabase(pool,'mock');await setupImageDemo(pool);
  for(const c of cases){
   const id=randomUUID(),actor='flash-lite-evaluation';await pool.query('INSERT INTO conversations(id,store_id,actor,reply_language) VALUES($1,$2,$3,$4)',[id,demoCatalogStore,actor,'ta']);
   const inbox=new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor,role:'customer'});
   // The fixed evaluation schema/store retains its cumulative budget across runs.
   await initializeBudget(pool,inbox.context,settings.budgetMicrousd);
   const runtime=new ConversationRuntime(pool,new GoogleInterpreter(settings),{allowPaidInference:true,visualOrdering:true});const started=Date.now();
   try{
    for(const m of c.messages){const mid=randomUUID();
     if(m.kind==='text'){if(!m.text)throw new Error('Text is required');await inbox.ingest({id:mid,type:'text',text:m.text});}
     else {if(!m.path||!m.mimeType)throw new Error('Media path and MIME type are required');const data=(await readFile(resolve(dirname(path),m.path))).toString('base64');
      if(m.kind==='audio'){const media=await normalizeVoice(voiceUploadSchema.parse({id:mid,mimeType:m.mimeType,data}));await inbox.ingest({id:mid,type:'voice',mediaId:mid},media);}
      else {const upload=imageUploadSchema.parse({id:mid,mimeType:m.mimeType,data,caption:m.text??''});await inbox.ingest({id:mid,type:'image',mediaId:mid,caption:upload.caption},undefined,await normalizeImage(upload,{maxSide:2048}));}
     }
     await runtime.processNext(inbox.context);
    }
    const s=await inbox.snapshot(),errors=s.messages.filter(m=>m.direction==='outbound'&&m.rich?.stage==='error');
    const checks=[!errors.length,c.expected?.draftCount===undefined||s.conversation.draft.length===c.expected.draftCount,c.expected?.counts===undefined||JSON.stringify(s.conversation.draft.map(l=>l.quantity))===JSON.stringify(c.expected.counts),c.expected?.orders===undefined||s.requests.length===c.expected.orders];
    const status=!checks.every(Boolean)?'failed':c.expected?'passed':'observed';if(status==='failed')failed++;
    const attempts=(await pool.query('SELECT stage,state,response,validation_issues FROM provider_attempts WHERE conversation_id=$1 ORDER BY created_at',[id])).rows;
    results.push({id:c.id,status,elapsedMs:Date.now()-started,draft:s.conversation.draft,requests:s.requests,messages:s.messages,attempts});
   }catch(error){failed++;results.push({id:c.id,status:'failed',error:error instanceof Error?error.message:'Evaluation failed'});}
  }
  const budget=(await pool.query('SELECT limit_microusd,held_microusd,committed_microusd,blocked FROM inference_budgets WHERE store_id=$1',[demoCatalogStore])).rows[0];
  const output=resolve(process.env.EVALUATION_REPORT??'artifacts/unified-evaluation/report.json');await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({model:GEMINI_MODEL_ID,recordedAt:new Date().toISOString(),results,budget},null,2)+'\n');console.log(JSON.stringify({cases:cases.length,failed,report:output}));if(failed)process.exitCode=1;
 }finally{await pool.end();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Evaluation failed');process.exitCode=1;});
