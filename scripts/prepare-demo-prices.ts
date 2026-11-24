import pg from 'pg';
import {z} from 'zod';
import {prepareDemoPrices} from '../apps/server/src/services/demo-prices.js';
const args=process.argv.slice(2);
if(args.includes('--help')){console.log('Prepare ordinary demo prices from valid matching-unit indicative values in one synthetic store. Dry run by default. Set DATABASE_URL, OWNER_STORE_ID and SHOPBOT_CATALOG_ACTOR explicitly. Apply the reviewed plan with --apply --hash=SHA256. Existing priced products and merchant verification stay unchanged; original source metadata is saved in the owner audit.');process.exit(0);}
const env=z.object({DATABASE_URL:z.url(),OWNER_STORE_ID:z.uuid(),SHOPBOT_CATALOG_ACTOR:z.string().min(3).max(200)}).parse(process.env);
const pool=new pg.Pool({connectionString:env.DATABASE_URL,max:1,statement_timeout:15000,lock_timeout:5000});
try{console.log(JSON.stringify(await prepareDemoPrices(pool,env.OWNER_STORE_ID,env.SHOPBOT_CATALOG_ACTOR,{apply:args.includes('--apply'),expectedPlanHash:args.find(a=>a.startsWith('--hash='))?.slice(7)}),null,2));}
finally{await pool.end();}
