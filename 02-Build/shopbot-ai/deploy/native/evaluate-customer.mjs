import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

// Read credentials only on the VPS. No Meta transport or production conversations.
const root=process.argv[2];
assert.match(root??'',/^\/opt\/shopbot-vps\/releases\/preview-[a-f0-9]{12}\/app$/);
process.chdir(root);
const env=parseEnv(await readFile('/etc/shopbot-vps.env','utf8'));
const pg=createRequire(root+'/package.json')('pg');
const {setupDatabase}=await import(root+'/dist/apps/server/src/db/migrate.js');
const {setupImageDemo,demoCatalogStore}=await import(root+'/dist/apps/server/src/services/demo-catalog.js');
const {SimulatorService}=await import(root+'/dist/apps/server/src/services/simulator.js');
const {ConversationRuntime}=await import(root+'/dist/apps/server/src/runtime/conversation.js');
const {GoogleInterpreter}=await import(root+'/dist/apps/server/src/adapters/google-interpreter.js');
const {initializeBudget,geminiTextRate}=await import(root+'/dist/apps/server/src/services/inference-budget.js');
const {normalizeImage}=await import(root+'/dist/apps/server/src/services/image-media.js');
const schema='customer_eval_20261005';
const admin=new pg.Pool({connectionString:env.DATABASE_URL,max:1});
const pool=new pg.Pool({connectionString:env.DATABASE_URL,options:`-c search_path=${schema}`,max:2});
const uuid=name=>{const h=createHash('sha256').update(schema+':'+name).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
const cases=[
 {name:'tanglish-screwdriver-typo',language:'ta',text:'ennaku oru srew driver veeanum',missingScrewdriver:true},
 {name:'tamil-pipe-cutter',language:'ta',text:'பிவிசி பைப் வெட்ட கட்டர் வேணும்',family:'pipe-cutters'},
 {name:'tanglish-two-items',language:'ta-Latn',text:'rendu bottle solvent gum, moonu PTFE tape roll venum',items:2},
 {name:'tamil-missing-paint',language:'ta',text:'வெள்ளை பெயிண்ட் ஒரு லிட்டர் வேணும்',missingPaint:true},
 {name:'photo-pipe-cutter',language:'ta',photo:'H19',family:'pipe-cutters'},
 {name:'photo-hacksaw-blade',language:'ta',photo:'H16',family:'saw-blades'},
 {name:'photo-hacksaw-blade-fresh-after-unit-fix',language:'ta',photo:'H16',family:'saw-blades'}
];
const report={schema,model:geminiTextRate.model,budgetUSD:0.5,whatsAppSends:0,voiceAccuracy:'Not evaluated: no human Tamil recording supplied.',cases:[]};
let locked=false,stage='database setup';
try{
 locked=(await admin.query("SELECT pg_try_advisory_lock(hashtext('shopbot-customer-evaluation')) AS locked")).rows[0].locked;assert.ok(locked,'Another evaluation is running');
 await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);await setupDatabase(pool,'mock');await setupImageDemo(pool);
 const provider=new GoogleInterpreter({apiKey:env.GEMINI_API_KEY,model:geminiTextRate.model,allowPaidInference:true,allowMultimodal:true,budgetMicrousd:500000});
 const runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true,discoveryStages:false});
 for(const c of cases){
  const context={storeId:demoCatalogStore,conversationId:uuid(c.name),actor:'synthetic-customer-evaluation',role:'customer'};
  await pool.query('INSERT INTO conversations(id,store_id,actor,reply_language) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[context.conversationId,context.storeId,context.actor,c.language]);
  stage=c.name;await initializeBudget(pool,context,500000);const inbox=new SimulatorService(pool,context),id=uuid(c.name+'-message');
  if(c.photo){const bytes=await readFile(root+'/resources/catalog/ksmc-demo/images/'+c.photo+'.jpg');const media=await normalizeImage({id,mimeType:'image/jpeg',data:bytes.toString('base64'),caption:''});const ingest=await inbox.ingest({id,type:'image',mediaId:id,caption:'இந்த பொருள் வேணும்'},undefined,media);if(ingest.duplicate)await inbox.ingest({id:uuid(c.name+'-retrieval-recheck'),type:'text',text:'check again'});}
  else await inbox.ingest({id,type:'text',text:c.text});
  const start=Date.now();await runtime.processNext(context);const snapshot=await inbox.snapshot(),rich=snapshot.messages.at(-1)?.rich;
  const products=[...(rich?.cards??[]).map(card=>card.product),...snapshot.conversation.draft.flatMap(l=>l.candidates??[])];
  const attempts=(await pool.query('SELECT state,billing_state,usage,estimated_cost_microusd,failure_code FROM provider_attempts WHERE conversation_id=$1 ORDER BY attempt',[context.conversationId])).rows;
  const pass=attempts.length===1&&attempts[0].state==='succeeded'&&attempts[0].billing_state==='estimated'&&(c.family?products.some(p=>p.familyId===c.family):c.items?snapshot.conversation.draft.length===c.items:c.missingScrewdriver?products.length===0&&!snapshot.conversation.draft.some(l=>l.sku):c.missingPaint?!snapshot.conversation.draft.some(l=>l.sku):true)&&snapshot.requests.length===0&&rich?.replyLanguage===c.language;
  const result={name:c.name,pass,elapsedMs:Date.now()-start,language:rich?.replyLanguage,reply:rich?.text,products:[...new Set(products.map(p=>p.sku))],draftLines:snapshot.conversation.draft.length,attempts};report.cases.push(result);console.log(JSON.stringify({case:result}));
  if(attempts.some(a=>a.billing_state==='unknown'))break;
  await new Promise(resolve=>setTimeout(resolve,6500));
 }
 report.budget=(await pool.query('SELECT limit_microusd,committed_microusd,held_microusd,blocked FROM inference_budgets WHERE store_id=$1',[demoCatalogStore])).rows[0];
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM whatsapp_outbox')).rows[0].n,0);
 assert.ok(Number(report.budget.committed_microusd)+Number(report.budget.held_microusd)<=500000);
 console.log(JSON.stringify({evaluation:report}));
 if(report.cases.length!==cases.length||report.cases.some(c=>!c.pass))process.exitCode=1;
}catch(error){console.error(JSON.stringify({syntheticEvaluationFailedAt:stage,code:typeof error?.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'validation',note:'Credentials and provider errors suppressed. Inspect the retained scoped budget/attempt ledger.'}));process.exitCode=1;}
finally{await pool.end();if(locked)await admin.query("SELECT pg_advisory_unlock(hashtext('shopbot-customer-evaluation'))");await admin.end();}
