import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore,fixtureConversation} from '../profiles/hardware.js';
import {catalogWrite,createProposal,prepareProposalAsset,addProposalAsset} from '../apps/server/src/services/catalog-proposals.js';
import {initializeBudget,reserveAttempt,geminiTextRate} from '../apps/server/src/services/inference-budget.js';
import {withConversation} from '../apps/server/src/services/context.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';

const container=process.env.SHOPBOT_RESTORE_CONTAINER,connection=process.env.DATABASE_URL,output=process.argv[2];
if(!container||!/^shopbot-[a-z0-9-]*test[a-z0-9-]*$/.test(container)||!connection||!output||!['localhost','127.0.0.1'].includes(new URL(connection).hostname))throw new Error('Set the explicitly disposable ShopBot test container, local DATABASE_URL and output path.');
const suffix=randomUUID().replaceAll('-','').slice(0,10),source='restore_source_'+suffix+'_test',target='restore_target_'+suffix+'_test';
function docker(args:string[],input?:Buffer){const r=spawnSync('docker',['exec','-i',container!,...args],{input,maxBuffer:100*1024*1024,timeout:60000});if(r.status!==0)throw new Error('Disposable restore command failed: '+r.stderr?.toString().slice(0,500));return r.stdout;}
const sql=(query:string)=>docker(['psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',query]);
const url=(name:string)=>{const u=new URL(connection);u.pathname='/'+name;return u.toString();};
const tables=['stores','products','conversations','messages','provider_attempts','inference_budgets','order_requests','catalog_proposals','catalog_proposal_assets','owner_audit','runtime_releases'];
async function snapshot(pool:pg.Pool){const rows:Record<string,{count:number;sha256:string}>={};for(const table of tables){const data=(await pool.query('SELECT to_jsonb(t) AS row FROM '+table+' t ORDER BY to_jsonb(t)::text')).rows.map(r=>r.row);rows[table]={count:data.length,sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')};}return rows;}
let a:pg.Pool|undefined,b:pg.Pool|undefined;
try{
 sql('CREATE DATABASE '+source);sql('CREATE DATABASE '+target);a=new pg.Pool({connectionString:url(source)});await setupDatabase(a,'mock');
 const id=randomUUID(),proposal={id,batchId:'restore-fixture',clientItemId:'one',details:{name:'Unpublished restore fixture'},provenance:{source:'synthetic restore test',issues:['Not merchant approved']}};
 await catalogWrite(a,fixtureStore,'test','restore_draft',id,c=>createProposal(c,fixtureStore,'test',proposal));
 const original=await readFile('resources/catalog/ksmc-demo/images/H19.jpg'),prepared=await prepareProposalAsset({proposalId:id,version:1,photo:{id:randomUUID(),mimeType:'image/jpeg',data:original.toString('base64'),caption:''},matchKind:'unconfirmed'});
 await catalogWrite(a,fixtureStore,'test','restore_asset',id,c=>addProposalAsset(c,fixtureStore,prepared.input,prepared.media));
 await a.query("UPDATE products SET catalog_origin='owner',version=7 WHERE store_id=$1 AND sku='WRENCH-10'",[fixtureStore]);
 const inbox=new SimulatorService(a),messageId=randomUUID();await inbox.ingest({id:messageId,type:'text',text:'Synthetic hold fixture'});await initializeBudget(a,simulatorContext,5000000);
 const provider:Interpreter={name:'restore-fixture',mode:'live',billing:geminiTextRate,interpret:async()=>{throw new Error('Never called');}};
 await withConversation(a,simulatorContext,c=>reserveAttempt(c,simulatorContext,messageId,0,provider));await a.query("UPDATE provider_attempts SET state='unknown',billing_state='unknown'");
 await a.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise) VALUES($1,$2,$3,$4,$5,'[]',12345)",[randomUUID(),fixtureStore,fixtureConversation,simulatorContext.actor,randomUUID()]);
 const before=await snapshot(a),dump=docker(['pg_dump','-U','postgres','--format=custom',source]);
 docker(['pg_restore','-U','postgres','--exit-on-error','--no-owner','--dbname='+target],dump);
 b=new pg.Pool({connectionString:url(target)});await setupDatabase(b,'mock');await setupDatabase(b,'mock');const after=await snapshot(b);
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Restored/migrated data differs from the populated source.');
 // Exercise SQL used by the previous pickup runtime against the additive DB.
 await b.query('SELECT sku,name,unit,price_paise,stock,version FROM products WHERE store_id=$1 AND active=true',[fixtureStore]);await b.query('SELECT id,acceptance,payment,fulfillment,total_paise,lines FROM order_requests WHERE store_id=$1',[fixtureStore]);
 await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(output,JSON.stringify({status:'restore_verified',databaseVersion:31,dumpBytes:dump.length,dumpSha256:createHash('sha256').update(dump).digest('hex'),tables:after,checks:['custom pg_dump and actual pg_restore','idempotent migrations after restore','original and normalized photos preserved','unknown inference hold preserved','owner product version and request preserved','previous pickup SQL remains compatible'],limitation:'Local disposable database rehearsal; production backup restoration and previous executable rollback must also be checked on the target host.'},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'restore_verified',output:resolve(output),tables:tables.length}));
}finally{await a?.end();await b?.end();sql('DROP DATABASE IF EXISTS '+source);sql('DROP DATABASE IF EXISTS '+target);}
