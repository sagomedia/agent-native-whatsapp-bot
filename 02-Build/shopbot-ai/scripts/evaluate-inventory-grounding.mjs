// Explicit, bounded live-model evaluation. Never instantiate WhatsApp transport.
// Copy public catalog facts into a separate schema; preserve its cumulative ledger.
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
assert.ok(process.argv.includes('--allow-paid-evaluation'),'Explicit evaluation flag required');
const root=await realpath(process.argv[2]);
assert.match(root,/^\/opt\/shopbot-vps\/releases\/preview-[a-f0-9]{12}\/app$/);
process.chdir(root);
const env=parseEnv(await readFile('/etc/shopbot-vps.env','utf8'));
assert.equal(env.ALLOW_PAID_INFERENCE,'true');
const cap=500000;
assert.ok(Number(env.AI_BUDGET_USD)>=cap/1000000,'Existing configured allowance must cover the evaluation cap');
const pg=createRequire(root+'/package.json')('pg');
const moduleAt=path=>import(pathToFileURL(root+'/dist/'+path).href);
const {setupDatabase}=await moduleAt('apps/server/src/db/migrate.js');
const {GoogleInterpreter}=await moduleAt('apps/server/src/adapters/google-interpreter.js');
const {initializeBudget,geminiTextRate}=await moduleAt('apps/server/src/services/inference-budget.js');
const {ConversationRuntime}=await moduleAt('apps/server/src/runtime/conversation.js');
const {SimulatorService}=await moduleAt('apps/server/src/services/simulator.js');
const {productColumns}=await moduleAt('apps/server/src/services/catalog.js');
const {convertAmount}=await moduleAt('apps/server/src/services/quantity-evidence.js');
const schema='inventory_decisions_eval_20261102',sourceStoreId=env.WHATSAPP_STORE_ID,storeId='41b2f4fe-35d6-411b-80f4-a591e00d2026';
assert.match(sourceStoreId??'',/^[a-f0-9-]{36}$/);
const admin=new pg.Pool({connectionString:env.DATABASE_URL,max:1});
const pool=new pg.Pool({connectionString:env.DATABASE_URL,options:`-c search_path=${schema}`,max:2});
const report={schema,model:geminiTextRate.model,capMicrousd:cap,whatsAppSends:0,actualVoiceRecognition:'Not evaluated: these are text inputs to the shared understanding path.',cases:[]};
let locked=false,phase='isolation setup';
try{
 locked=(await admin.query("SELECT pg_try_advisory_lock(hashtext('shopbot-inventory-decision-evaluation')) AS locked")).rows[0].locked;
 assert.ok(locked,'An evaluation is already running');
 await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
 await setupDatabase(pool,'mock');
 await pool.query("INSERT INTO stores(id,name,synthetic) SELECT $2,name,true FROM public.stores WHERE id=$1 ON CONFLICT DO NOTHING",[sourceStoreId,storeId]);
 assert.equal((await pool.query('SELECT synthetic FROM stores WHERE id=$1',[storeId])).rows[0]?.synthetic,'true');
 await pool.query("INSERT INTO catalog_profiles(store_id,store_type) SELECT $2,store_type FROM public.catalog_profiles WHERE store_id=$1 ON CONFLICT DO NOTHING",[sourceStoreId,storeId]);
 await pool.query("INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,aliases,local_names) SELECT $2,id,parent_id,kind,label,aliases,local_names FROM public.catalog_nodes WHERE store_id=$1 ON CONFLICT DO NOTHING",[sourceStoreId,storeId]);
 const columns=productColumns.split(',').filter(c=>!['product_group_id','product_group_name','variant_label'].includes(c)).join(',');
 await pool.query(`INSERT INTO products(store_id,${columns},active) SELECT $2,${columns},active FROM public.products WHERE store_id=$1 ON CONFLICT DO NOTHING`,[sourceStoreId,storeId]);
 await pool.query('INSERT INTO store_policies(store_id,require_product_confirmation) VALUES($1,true) ON CONFLICT DO NOTHING',[storeId]);
 const provider=new GoogleInterpreter({apiKey:env.GEMINI_API_KEY,model:geminiTextRate.model,allowPaidInference:true,allowMultimodal:true,unifiedUnderstanding:true,budgetMicrousd:cap});
 const runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true,inventoryGrounding:true,visualOrdering:true});
 const makeInbox=async()=>{
  const ctx={storeId,conversationId:randomUUID(),actor:'isolated-inventory-evaluation',role:'customer'};
  await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language,visual_ordering) VALUES($1,$2,$3,'en',true)",[ctx.conversationId,storeId,ctx.actor]);
  await initializeBudget(pool,ctx,cap);return new SimulatorService(pool,ctx);
 };
 const send=async(inbox,name,text,check)=>{
  phase=name;const id=randomUUID(),started=Date.now();await inbox.ingest({id,type:'text',text});await runtime.processNext(inbox.context);
  const s=await inbox.snapshot(),last=s.messages.at(-1)?.rich;
  const attempts=(await pool.query('SELECT stage,state,billing_state,estimated_cost_microusd,failure_code,validation_issues FROM provider_attempts WHERE message_id=$1 ORDER BY attempt',[id])).rows;
  const pass=last?.stage!=='error'&&s.requests.length===0&&check(s);
  const result={name,pass,elapsedMs:Date.now()-started,reply:last?.text,stage:last?.stage,draft:s.conversation.draft.map(l=>({query:l.query,quantity:l.quantity,requestedQuantity:l.requestedQuantity,packSize:l.packSize,requestedAmount:l.requestedAmount,requestedUnit:l.requestedUnit,candidates:l.candidates?.map(p=>({sku:p.sku,name:p.name}))})),attempts};
  report.cases.push(result);console.log(JSON.stringify({case:result}));
  assert.ok(!attempts.some(a=>a.billing_state==='unknown'),'Stop on unknown provider billing');return s;
 };
 const enamel=await makeInbox();
 await send(enamel,'noisy-enamel-query','I need two enamel letter paint cans',s=>s.conversation.draft.some(l=>(l.quantity??l.requestedQuantity)===2&&l.candidates?.some(p=>/enamel/i.test(p.name))));
 const white=await makeInbox();
 await send(white,'four-litre-evidence','நாலு லிட்டர் ஒயிட் பெயிண்ட் வேணும்',s=>s.conversation.draft.some(l=>(l.packSize&&convertAmount(l.packSize,'litre')===4||l.requestedAmount&&convertAmount(l.requestedAmount,'litre')===4)));
 const level=await makeInbox();
 await send(level,'level-not-water-pipe','I need two spirit levels',s=>s.conversation.draft.some(l=>(l.quantity??l.requestedQuantity)===2&&l.candidates?.some(p=>/spirit|box level/i.test(p.name))&&!l.candidates?.some(p=>/water.*pipe/i.test(p.name))));
 await send(level,'semantic-total-edit','Make the spirit level quantity four in total',s=>s.conversation.draft.length===1&&(s.conversation.draft[0].quantity??s.conversation.draft[0].requestedQuantity)===4);
 await send(level,'alternate-removal-verb','Take the spirit level off my list',s=>s.conversation.draft.length===0);
 report.budget=(await pool.query('SELECT limit_microusd,committed_microusd,held_microusd,blocked FROM inference_budgets WHERE store_id=$1',[storeId])).rows[0];
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM whatsapp_outbox')).rows[0].n,0);
 assert.ok(Number(report.budget.committed_microusd)+Number(report.budget.held_microusd)<=cap);
 console.log(JSON.stringify({evaluation:report}));
 if(report.cases.some(c=>!c.pass))process.exitCode=1;
}catch(error){console.error(JSON.stringify({evaluationFailed:true,phase,code:typeof error?.code==='string'?error.code:'validation',note:'Credentials and provider errors suppressed; inspect the isolated evaluation ledger.'}));process.exitCode=1;}
finally{await pool.end();if(locked)await admin.query("SELECT pg_advisory_unlock(hashtext('shopbot-inventory-decision-evaluation'))");await admin.end();}
