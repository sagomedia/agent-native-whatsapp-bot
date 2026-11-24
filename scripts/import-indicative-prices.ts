import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
import {z} from 'zod';
import {readIndicativeProposal,snapshotIndicativePrices,planIndicativePrices,applyIndicativePrices,indicativeSnapshotSchema} from '../apps/server/src/services/indicative-prices.js';
const args=process.argv.slice(2),file=args.find(a=>!a.startsWith('--'));
const option=(name:string)=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
if(!file)throw new Error('Usage: tsx scripts/import-indicative-prices.ts prices.json --snapshot=/absolute/snapshot.json [--apply]');
const snapshotPath=option('snapshot');if(!snapshotPath)throw new Error('Choose an explicit snapshot file. Default creates a snapshot; --apply reads that exact file.');
const env=z.object({DATABASE_URL:z.string().url(),OWNER_STORE_ID:z.uuid(),SHOPBOT_CATALOG_STORE_ID:z.uuid().optional()}).parse(process.env);
if(env.SHOPBOT_CATALOG_STORE_ID&&env.SHOPBOT_CATALOG_STORE_ID!==env.OWNER_STORE_ID)throw new Error('Catalog target differs from OWNER_STORE_ID.');
const {proposal,proposalHash}=await readIndicativeProposal(file),pool=new pg.Pool({connectionString:env.DATABASE_URL,max:1,statement_timeout:15000,lock_timeout:5000});
try{
 if(args.includes('--apply')){
  const snapshot=indicativeSnapshotSchema.parse(JSON.parse(await readFile(snapshotPath,'utf8')));
  console.log(JSON.stringify(await applyIndicativePrices(pool,env.OWNER_STORE_ID,z.string().min(3).max(200).parse(process.env.SHOPBOT_CATALOG_ACTOR),proposal,proposalHash,snapshot),null,2));
 }else{
  const snapshot=await snapshotIndicativePrices(pool,env.OWNER_STORE_ID,proposal,proposalHash),plan=planIndicativePrices(proposal,proposalHash,snapshot);
  await writeFile(snapshotPath,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({snapshotPath,proposalHash,updates:plan.updates.length,skipped:plan.skipped},null,2));
 }
}finally{await pool.end();}
