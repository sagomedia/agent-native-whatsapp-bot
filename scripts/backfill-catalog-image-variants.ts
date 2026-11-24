import pg from 'pg';
import {z} from 'zod';
import {backfillCatalogImageVariants} from '../apps/server/src/services/catalog-image-variants.js';

const args=process.argv.slice(2),option=(name:string)=>args.find(arg=>arg.startsWith('--'+name+'='))?.slice(name.length+3);
let pool:pg.Pool|undefined;
try{
 if(args.includes('--help')){
  console.log('Catalog image previews: --store=UUID --limit=25 --after=CURSOR [--apply --owner-authorized]. Preview is read-only. Explicit DATABASE_URL and --store (or SHOPBOT_CATALOG_STORE_ID) required. Apply writes only precomputed 128/256/640 JPEG previews and image hashes, never product facts. Each run handles at most 100 sources. Resume with the returned nextCursor; on failure it stays before the failed source. Running again without --after safely fills missing previews. Run the database migration first.');
 }else{
  if(args.includes('--apply')&&!args.includes('--owner-authorized'))throw Error('Applying image previews requires both --apply and --owner-authorized.');
  const storeId=option('store')??process.env.SHOPBOT_CATALOG_STORE_ID;
  if(!z.url().safeParse(process.env.DATABASE_URL).success||!z.uuid().safeParse(storeId).success)throw Error('Explicit DATABASE_URL and --store (or SHOPBOT_CATALOG_STORE_ID) are required.');
  const limit=Number(option('limit')??25);if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Choose a backfill limit from 1 to 100.');
  pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,statement_timeout:15000,lock_timeout:5000});
  const report=await backfillCatalogImageVariants(pool,storeId!,{limit,after:option('after'),apply:args.includes('--apply'),processingTimeoutMs:30000});
  console.log(JSON.stringify(report));if(report.failures.length)process.exitCode=1;
 }
}catch(error){console.error(JSON.stringify({error:'catalog_image_variants_failed',message:error instanceof Error&&/^(Applying image|Explicit DATABASE|Choose a backfill|Invalid image backfill|Shop not found)/.test(error.message)?error.message:'Image preview backfill failed. Check the database migration and decoder; rerun from the last successful cursor.'}));process.exitCode=1;}
finally{await pool?.end();}
