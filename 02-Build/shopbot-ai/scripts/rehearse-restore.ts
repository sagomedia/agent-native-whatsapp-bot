import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore,fixtureConversation} from '../profiles/hardware.js';
import {catalogWrite,createProposal,prepareProposalAsset,addProposalAsset} from '../apps/server/src/services/catalog-proposals.js';
import {initializeBudget,reserveAttempt,geminiTextRate} from '../apps/server/src/services/inference-budget.js';
import {withConversation} from '../apps/server/src/services/context.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import {stageBulkCatalog} from '../apps/server/src/services/catalog-bulk.js';
import {saveCatalogPhoto} from '../apps/server/src/services/catalog-photos.js';
import {saveCatalogAudit,applyCatalogAudit,recordConversationAudit} from '../apps/server/src/services/catalog-audit.js';
import {adjustStock} from '../apps/server/src/services/inventory.js';

const container=process.env.SHOPBOT_RESTORE_CONTAINER,pgBin=process.env.SHOPBOT_RESTORE_PG_BIN,connection=process.env.DATABASE_URL,output=process.argv[2];
if((!container&&!pgBin)||(container&&!/^shopbot-[a-z0-9-]*test[a-z0-9-]*$/.test(container))||!connection||!output||!['localhost','127.0.0.1'].includes(new URL(connection).hostname))throw new Error('Set the explicitly disposable ShopBot test container, local DATABASE_URL and output path.');
const suffix=randomUUID().replaceAll('-','').slice(0,10),source='restore_source_'+suffix+'_test',target='restore_target_'+suffix+'_test';
function docker(args:string[],input?:Buffer){const u=new URL(connection!);const native=args.slice(1).map((v,i)=>args[i]==='-U'?decodeURIComponent(u.username):v);const r=spawnSync(pgBin?resolve(pgBin,args[0]):'docker',pgBin?native:['exec','-i',container!,...args],{input,env:{...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGPASSWORD:decodeURIComponent(u.password)},maxBuffer:100*1024*1024,timeout:60000});if(r.status!==0)throw new Error('Disposable restore command failed: '+r.stderr?.toString().slice(0,500));return r.stdout;}
const sql=(query:string)=>docker(['psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',query]);
const url=(name:string)=>{const u=new URL(connection);u.pathname='/'+name;return u.toString();};
const tables=['schema_migrations','stores','products','conversations','messages','provider_attempts','inference_budgets','order_requests','order_quotes','order_amendments','order_advances','payment_quotes','payment_attempts','payment_events','inventory_movements','inventory_reservations','whatsapp_outbox','catalog_nodes','catalog_proposals','catalog_proposal_assets','catalog_photos','catalog_intake_batches','catalog_intake_items','owner_audit','runtime_releases','catalog_chat_operations','catalog_audit_runs','catalog_audit_findings','catalog_audit_reviews','catalog_change_events','conversation_audit_events'];
async function snapshot(pool:pg.Pool){const rows:Record<string,{count:number;sha256:string}>={};for(const table of tables){const data=(await pool.query('SELECT to_jsonb(t) AS row FROM '+table+' t ORDER BY to_jsonb(t)::text')).rows.map(r=>r.row);rows[table]={count:data.length,sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')};}return rows;}
let a:pg.Pool|undefined,b:pg.Pool|undefined,bundleDirectory:string|undefined;
try{
 sql('CREATE DATABASE '+source);sql('CREATE DATABASE '+target);a=new pg.Pool({connectionString:url(source)});await setupDatabase(a,'mock');
 const id=randomUUID(),proposal={id,batchId:'restore-fixture',clientItemId:'one',details:{name:'Unpublished restore fixture'},provenance:{source:'synthetic restore test',issues:['Not merchant approved']}};
 await catalogWrite(a,fixtureStore,'test','restore_draft',id,c=>createProposal(c,fixtureStore,'test',proposal));
 const original=await readFile('resources/catalog/ksmc-demo/images/H19.jpg'),prepared=await prepareProposalAsset({proposalId:id,version:1,photo:{id:randomUUID(),mimeType:'image/jpeg',data:original.toString('base64'),caption:''},matchKind:'unconfirmed'});
 await catalogWrite(a,fixtureStore,'test','restore_asset',id,c=>addProposalAsset(c,fixtureStore,prepared.input,prepared.media));
 const photoId=await catalogWrite(a,fixtureStore,'test','restore_published_photo',id,c=>saveCatalogPhoto(c,fixtureStore,prepared.media));
 const reusedPhotoId=await catalogWrite(a,fixtureStore,'test','restore_reused_photo',id,c=>saveCatalogPhoto(c,fixtureStore,prepared.media));
 if(photoId!==reusedPhotoId)throw new Error('Identical normalized photo did not reuse its immutable asset.');
 bundleDirectory=await mkdtemp(resolve(tmpdir(),'shopbot-restore-bulk-'));
 await writeFile(resolve(bundleDirectory,'products.json'),JSON.stringify({schemaVersion:2,currency:'INR',products:[{sourceSku:'RESTORE-SOURCE',details:{name:'Unpublished bulk restore fixture',familyId:'restore-source-family'},provenance:{source:'Synthetic restore fixture',issues:['Merchant confirmation pending']}}]}));
 await writeFile(resolve(bundleDirectory,'canonical-map.json'),JSON.stringify({schemaVersion:1,skus:[{sourceSku:'RESTORE-SOURCE',canonicalSku:'RESTORE-CANONICAL'}],families:[{sourceFamilyId:'restore-source-family',canonicalFamilyId:'restore-family'}],exclusions:[]}));
 await writeFile(resolve(bundleDirectory,'catalog-map.json'),JSON.stringify({schemaVersion:1,nodes:[{id:'restore-department',parentId:null,kind:'department',label:'Restore fixtures',localNames:{},aliases:[]},{id:'restore-family',parentId:'restore-department',kind:'family',label:'Synthetic restore products',localNames:{},aliases:[]}]}));
 const intake=await stageBulkCatalog(a,fixtureStore,'test',bundleDirectory,{batchId:'restore-intake'});
 if(intake.counts.staged!==1)throw new Error('Bulk restore fixture did not stage.');
 await a.query("UPDATE products SET catalog_origin='owner',version=7 WHERE store_id=$1 AND sku='WRENCH-10'",[fixtureStore]);
 const currentStock=(await a.query("SELECT inventory_version FROM products WHERE store_id=$1 AND sku='WRENCH-10'",[fixtureStore])).rows[0];
 await catalogWrite(a,fixtureStore,'test','restore_stock',id,c=>adjustStock(c,fixtureStore,'WRENCH-10','test',{id:randomUUID(),expectedVersion:currentStock.inventory_version,kind:'count',quantity:8,reason:'Synthetic restore count'}));
 const inbox=new SimulatorService(a),messageId=randomUUID();await inbox.ingest({id:messageId,type:'text',text:'Synthetic hold fixture'});await initializeBudget(a,simulatorContext,5000000);
 const provider:Interpreter={name:'restore-fixture',mode:'live',billing:geminiTextRate,interpret:async()=>{throw new Error('Never called');}};
 await withConversation(a,simulatorContext,c=>reserveAttempt(c,simulatorContext,messageId,0,provider));await a.query("UPDATE provider_attempts SET state='unknown',billing_state='unknown'");
 await a.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise) VALUES($1,$2,$3,$4,$5,'[]',12345)",[randomUUID(),fixtureStore,fixtureConversation,simulatorContext.actor,randomUUID()]);
 const auditId=randomUUID(),findingId=randomUUID(),evidenceId=randomUUID(),principal={storeId:fixtureStore,actor:'restore-owner',canReadOwner:true,canWrite:true,canPublish:true},range={since:new Date(Date.now()-3600000).toISOString(),until:new Date(Date.now()+1000).toISOString()};
 await a.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload) VALUES($1,$2,'inbound','restore local elbow name','processed','{}')",[evidenceId,fixtureConversation]);
 await saveCatalogAudit(a,principal,{operationId:randomUUID(),auditId,title:'Restore audit fixture',range,reviewedMessageIds:[evidenceId],findings:[{id:findingId,category:'alias_gap',sku:'PVC-ELBOW-050',wording:'restore local elbow name',explanation:'Synthetic owner reviewed alias.',patch:{aliases:{add:['restore local elbow name']}},evidence:[{conversationId:fixtureConversation,messageIds:[evidenceId]}]},{id:randomUUID(),category:'insufficient_evidence',wording:'restore local elbow name',explanation:'Synthetic unresolved review.',evidence:[{conversationId:fixtureConversation,messageIds:[evidenceId]}]}]});
 await applyCatalogAudit(a,principal,{operationId:randomUUID(),auditId,findingIds:[findingId]});
 const trace=await a.connect();try{await recordConversationAudit(trace,fixtureStore,fixtureConversation,evidenceId,{version:0},{version:1,draft:[]},{stage:'identify'});}finally{trace.release();}
 const before=await snapshot(a),dump=docker(['pg_dump','-U','postgres','--format=custom',source]);
 docker(['pg_restore','-U','postgres','--exit-on-error','--no-owner','--dbname='+target],dump);
 b=new pg.Pool({connectionString:url(target)});await setupDatabase(b,'mock');await setupDatabase(b,'mock');const after=await snapshot(b);
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Restored/migrated data differs from the populated source.');
 const restoredIntake=(await b.query("SELECT state,proposal_id FROM catalog_intake_items WHERE store_id=$1 AND batch_id='restore-intake'",[fixtureStore])).rows[0];
 if(restoredIntake?.state!=='staged'||!restoredIntake.proposal_id)throw new Error('Intake resume state was lost.');
 const restoredPhoto=(await b.query('SELECT content_hash FROM catalog_photos WHERE id=$1',[photoId])).rows[0];
 if(restoredPhoto?.content_hash!==createHash('sha256').update(prepared.media.image).digest('hex'))throw new Error('Published photo content hash was lost.');
 // Exercise SQL used by the previous pickup runtime against the additive DB.
 await b.query('SELECT sku,name,unit,price_paise,stock,version FROM products WHERE store_id=$1 AND active=true',[fixtureStore]);await b.query('SELECT id,acceptance,payment,fulfillment,total_paise,lines FROM order_requests WHERE store_id=$1',[fixtureStore]);
 const databaseVersion=Number((await b.query('SELECT max(version) AS version FROM schema_migrations')).rows[0].version);
 await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(output,JSON.stringify({status:'restore_verified',databaseVersion,dumpBytes:dump.length,dumpSha256:createHash('sha256').update(dump).digest('hex'),tables:after,checks:['custom pg_dump and actual pg_restore','idempotent migrations after restore','original and normalized photos preserved','published photo hashes and reuse preserved','bulk source hash, row/proposal link and resume state preserved','stock movement ledger preserved','unknown inference hold preserved','owner product version and request preserved','previous pickup SQL remains compatible','audit findings, review membership, term receipts, connected activity and turn traces preserved'],limitation:'Local disposable database rehearsal; production backup restoration and previous executable rollback must also be checked on the target host. Empty payment/outbox tables establish schema preservation only, not populated live payment/delivery recovery.'},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'restore_verified',output:resolve(output),tables:tables.length}));
}finally{await a?.end();await b?.end();if(bundleDirectory)await rm(bundleDirectory,{recursive:true,force:true});sql('DROP DATABASE IF EXISTS '+source);sql('DROP DATABASE IF EXISTS '+target);}
