/** Synthetic SQL retrieval replay. Explicit isolated database only; no provider calls. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {discoverProducts,getCatalogMap} from '../apps/server/src/services/catalog-discovery.js';
import type {ActorContext} from '../apps/server/src/services/context.js';

const connectionString=process.env.DATABASE_URL;
if(!connectionString||process.env.CATALOG_SCALE_EVAL_ISOLATED!=='1')throw new Error('Set DATABASE_URL to an isolated database and CATALOG_SCALE_EVAL_ISOLATED=1. This script creates and drops a private schema.');
const outputIndex=process.argv.indexOf('--output'),outputPath=outputIndex<0?undefined:process.argv[outputIndex+1];
if(outputIndex>=0&&!outputPath)throw new Error('--output requires a JSON file path');
const schema='catalog_scale_eval_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString});
const report:{fixture:string;providerCalls:number;scope:string;scales:unknown[];failures:string[];limitations:string[]}={fixture:'synthetic catalog-scale-v1',providerCalls:0,scope:'isolated PostgreSQL retrieval only',scales:[],failures:[],limitations:['Synthetic text identities and typed SQL constraints; not held-out Tamil/Tanglish speech or OCR accuracy.','No merchant facts, source-family reconciliation, WhatsApp delivery, concurrency, or production latency validation.','Candidate scores are ordering weights, not confidence probabilities.']};
const name=(i:number)=>`Acme Fineline Wall Paint Model${String(i).padStart(4,'0')} 4 L`;
const sku=(i:number)=>`BASE-${String(i).padStart(4,'0')}`;
await admin.query(`CREATE SCHEMA ${schema}`);
const pool=new pg.Pool({connectionString,options:`-c search_path=${schema}`});
try{
 await setupDatabase(pool,'mock');const storeId=randomUUID();
 await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Scale evaluation',true)",[storeId]);
 await pool.query("INSERT INTO catalog_profiles(store_id,store_type) VALUES($1,'hardware')",[storeId]);
 await pool.query("INSERT INTO catalog_nodes(store_id,id,kind,label) VALUES($1,'surfaces','department','Surfaces')",[storeId]);
 await pool.query("INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,aliases) VALUES($1,'paint','surfaces','family','Wall paint','[\"wall paint\",\"paint\"]')",[storeId]);
 const c=await pool.connect(),ctx:ActorContext={storeId,conversationId:randomUUID(),actor:'catalog-scale-eval',role:'customer'};
 try{for(const count of [13,300,3000]){
  await c.query('DELETE FROM products WHERE store_id=$1',[storeId]);
  const baseCount=Math.min(count,300);
  await c.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,family_id,brand,specifications,aliases)
   SELECT $1,'BASE-'||lpad(i::text,4,'0'),'Acme Fineline Wall Paint Model'||lpad(i::text,4,'0')||' 4 L','can',0,'paint',CASE WHEN i=$2 THEN 'Rare finish brand' ELSE 'Acme' END,jsonb_build_object('size','4 L','model','Model'||lpad(i::text,4,'0')),jsonb_build_array('Fineline Model'||lpad(i::text,4,'0')) FROM generate_series(1,$2::int) i`,[storeId,baseCount]);
  if(count>baseCount)await c.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,family_id,brand,specifications,aliases)
   SELECT $1,'DISTRACTOR-'||lpad(i::text,4,'0'),'Acme Fineline Alternate Wall Paint Variant '||i||' 4 kg','bucket',0,'paint','Acme',jsonb_build_object('size','4 kg','model','Variant '||i),jsonb_build_array('Acme Fineline Wall Paint Model'||lpad((((i-1)%300)+1)::text,4,'0')||' 4 L','Fineline Model'||lpad((((i-1)%300)+1)::text,4,'0')) FROM generate_series(1,$2::int) i`,[storeId,count-baseCount]);
  await c.query('ANALYZE products');
  const durations:number[]=[],misses:string[]=[];
  let exactName=0,exactSku=0;
  for(let i=1;i<=baseCount;i++)for(const [kind,query] of [['name',name(i)],['sku',sku(i)]] as const){const started=performance.now(),r=await discoverProducts(c,ctx,query);durations.push(performance.now()-started);if(r.products[0]?.sku===sku(i)){if(kind==='name')exactName++;else exactSku++;}else misses.push(kind+':'+sku(i));assert.ok(r.products.length<=10&&r.retrievedCount<=120);}
  const scenarios:{name:string;pass:boolean}[]=[];
  const check=async(label:string,query:string,expected:string[],plan?:Parameters<typeof discoverProducts>[3])=>{const started=performance.now(),r=await discoverProducts(c,ctx,query,plan);durations.push(performance.now()-started);scenarios.push({name:label,pass:JSON.stringify(r.products.map(p=>p.sku).sort())===JSON.stringify([...expected].sort())});};
  await check('pack spelling and exact model preserved','Acme Fineline Model0001 paint 4 litres',[sku(1)]);
  await check('wrong magnitude unavailable','Acme Fineline Model0001 paint 40 litres',[]);
  await check('litre request cannot satisfy kg filter',name(1),[],{keywords:['Fineline'],specifications:{size:'4 kg'}});
  await check('brand conflict is never silently overridden',name(1),[],{keywords:['Fineline'],brand:'Unavailable brand'});
  await check('rare late brand remains reachable','paint',[sku(baseCount)],{keywords:['paint'],brand:'Rare finish brand'});
  await check('absent product remains unlisted','unlisted tungsten screwdriver',[]);
  const originalSecond=name(2);await c.query('UPDATE products SET name=$1 WHERE store_id=$2 AND sku=$3',[name(1),storeId,sku(2)]);
  await check('duplicate exact name remains ambiguous',name(1),[sku(1),sku(2)]);
  await c.query('UPDATE products SET name=$1 WHERE store_id=$2 AND sku=$3',[originalSecond,storeId,sku(2)]);
  const map=await getCatalogMap(c,ctx);assert.equal(map.productCount,count);
  durations.sort((a,b)=>a-b);const p95=durations[Math.ceil(durations.length*.95)-1];
  const result={productCount:count,exactName:{passed:exactName,total:baseCount},exactSku:{passed:exactSku,total:baseCount},scenarios,sqlDiscoveryMs:{median:Number(durations[Math.floor(durations.length*.5)].toFixed(2)),p95:Number(p95.toFixed(2)),max:Number(durations.at(-1)!.toFixed(2))},providerCalls:0,misses};
  report.scales.push(result);for(const miss of misses)report.failures.push(count+':'+miss);for(const scenario of scenarios)if(!scenario.pass)report.failures.push(count+':'+scenario.name);
  console.log(JSON.stringify(result));
 }}finally{c.release();}
}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
if(outputPath)await writeFile(outputPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({failures:report.failures,providerCalls:0,scope:report.scope}));
if(report.failures.length)process.exitCode=1;
