/** Strictly read-only capacity report; no application startup or migration. */
import pg from 'pg';
import {catalogCapacity,capacityFilesystem} from '../apps/server/src/services/catalog-capacity.js';

function positive(name:string,optional=false){
 const raw=process.env[name];if(optional&&raw===undefined)return undefined;
 if(!raw||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1)throw Error(`Set ${name} to a positive integer`);
 return Number(raw);
}
async function main(){
 const connectionString=process.env.DATABASE_URL,storeId=process.env.STORE_ID,path=process.env.CAPACITY_PATH;
 if(!connectionString||!storeId||!path)throw Error('DATABASE_URL, STORE_ID and CAPACITY_PATH are required; no defaults are used');
 const sampleBytes=positive('CAPACITY_SAMPLE_BYTES',true),sampleCount=positive('CAPACITY_SAMPLE_COUNT',true);
 if((sampleBytes===undefined)!==(sampleCount===undefined))throw Error('Set CAPACITY_SAMPLE_BYTES and CAPACITY_SAMPLE_COUNT together');
 const targetProducts=positive('CAPACITY_TARGET_PRODUCTS',true),reserveBytes=positive('CAPACITY_RESERVE_BYTES',true);
 const filesystem=await capacityFilesystem(path),pool=new pg.Pool({connectionString,max:1,connectionTimeoutMillis:5000});
 try{
  const report=await catalogCapacity(pool,{storeId,filesystem,targetProducts,reserveBytes,...(sampleBytes!==undefined&&sampleCount!==undefined?{sample:{bytes:sampleBytes,count:sampleCount}}:{})});
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.projection.status!=='projected_space_available')process.exitCode=2;
 }finally{await pool.end();}
}
try{await main();}catch{
 // Database, volume and connection errors may contain private paths or credentials.
 process.stderr.write(JSON.stringify({error:'catalog_capacity_failed',message:'Read-only capacity inspection failed. Verify explicit DATABASE_URL, STORE_ID, CAPACITY_PATH, numeric settings and schema access.'})+'\n');
 process.exitCode=1;
}
