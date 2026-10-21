import pg from 'pg';
import {z} from 'zod';
import {readCatalogPackage,importCatalogPackage} from '../services/catalog-package.js';
const directory=process.argv[2];if(!directory)throw new Error('Usage: npm run catalog:stage -- /absolute/package/path [--apply]');
if(!process.argv.includes('--apply')){const b=await readCatalogPackage(directory);console.log(JSON.stringify({valid:true,count:b.entries.length,sourceHash:b.hash,batchId:b.batchId,published:0}));}
else{
 const config=z.object({DATABASE_URL:z.string().url(),SHOPBOT_CATALOG_STORE_ID:z.uuid(),SHOPBOT_CATALOG_ACTOR:z.string().min(3).max(200)}).parse(process.env);
 const pool=new pg.Pool({connectionString:config.DATABASE_URL,max:2,statement_timeout:15000,lock_timeout:5000});
 try{const result=await importCatalogPackage(pool,config.SHOPBOT_CATALOG_STORE_ID,config.SHOPBOT_CATALOG_ACTOR,directory,n=>{if(n%10===0)console.error(`${n}/100 draft rows processed`);});console.log(JSON.stringify(result,null,2));if(result.failed)process.exitCode=1;}finally{await pool.end();}
}
