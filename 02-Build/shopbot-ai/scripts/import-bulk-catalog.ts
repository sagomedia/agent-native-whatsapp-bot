import pg from 'pg';
import {z} from 'zod';
import {readBulkCatalogPackage,dryRunBulkCatalog,stageBulkCatalog,bulkCatalogStatus} from '../apps/server/src/services/catalog-bulk.js';
const args=process.argv.slice(2),directory=args.find(a=>!a.startsWith('--'));
const option=(name:string)=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const batchId=option('batch');
if(!directory||!batchId)throw new Error('Usage: tsx scripts/import-bulk-catalog.ts /package/path --batch=stable-id [--apply | --status] [--chunk=25] [--max-items=100] [--after=SKU] [--offline]');
if(args.includes('--apply')&&args.includes('--status'))throw new Error('Choose apply or status.');
if(args.includes('--offline')&&(args.includes('--apply')||args.includes('--status')))throw new Error('Offline mode supports validation only.');
let pool:pg.Pool|undefined,storeId:string|undefined;
try{
 if(!args.includes('--offline')){const env=z.object({DATABASE_URL:z.string().url(),SHOPBOT_CATALOG_STORE_ID:z.uuid()}).parse(process.env);storeId=env.SHOPBOT_CATALOG_STORE_ID;pool=new pg.Pool({connectionString:env.DATABASE_URL,max:2,statement_timeout:15000,lock_timeout:5000});}
 const result=args.includes('--status')?await bulkCatalogStatus(pool!,storeId!,batchId,option('after')):args.includes('--apply')?await stageBulkCatalog(pool!,storeId!,z.string().min(3).max(200).parse(process.env.SHOPBOT_CATALOG_ACTOR),directory,{batchId,chunkSize:option('chunk')?Number(option('chunk')):undefined,maxItems:option('max-items')?Number(option('max-items')):undefined,onProgress:n=>{if(n%25===0)console.error(`${n} draft items processed`);}}):await dryRunBulkCatalog(pool,storeId,await readBulkCatalogPackage(directory),batchId);
 console.log(JSON.stringify(result,null,2));
 if('conflicts' in result&&result.conflicts||'counts' in result&&(result.counts.failed||result.counts.conflict))process.exitCode=1;
}finally{await pool?.end();}
