import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {z} from 'zod';
import {previewReviewLater,applyReviewLater,reviewLaterSnapshotSchema} from '../apps/server/src/services/catalog-review-later.js';

const usage='Usage: node dist/scripts/promote-catalog-review-later.js --snapshot=/private/path/preview.json [--apply --owner-authorized]. Preview is read-only and creates the snapshot; apply requires that saved snapshot. Set DATABASE_URL, SHOPBOT_CATALOG_STORE_ID and (for apply) SHOPBOT_CATALOG_ACTOR.';
const args=process.argv.slice(2);let pool:pg.Pool|undefined;
try{
 if(args.includes('--help')){console.log(usage);}else{
  const allowed=/^(?:--snapshot=.+|--apply|--owner-authorized)$/;
  if(args.some(a=>!allowed.test(a))||args.filter(a=>a.startsWith('--snapshot=')).length!==1||new Set(args).size!==args.length)throw new Error(usage);
  const path=args.find(a=>a.startsWith('--snapshot='))!.slice('--snapshot='.length),apply=args.includes('--apply');
  if(apply&&!args.includes('--owner-authorized')||!apply&&args.includes('--owner-authorized'))throw new Error('Apply requires both --apply and --owner-authorized. '+usage);
  const env=z.object({DATABASE_URL:z.string().url(),SHOPBOT_CATALOG_STORE_ID:z.uuid()}).safeParse(process.env);
  if(!env.success)throw new Error('Explicit DATABASE_URL and SHOPBOT_CATALOG_STORE_ID are required.');
  const actor=apply?z.string().trim().min(3).max(200).safeParse(process.env.SHOPBOT_CATALOG_ACTOR):undefined;
  if(apply&&!actor?.success)throw new Error('Apply requires explicit SHOPBOT_CATALOG_ACTOR identifying the authorizing owner/operator.');
  // Load and validate before connecting. A bounded snapshot prevents accidental
  // full-table work and preserves the exact IDs/versions authorized in preview.
  let snapshot;
  if(apply){const bytes=await readFile(path);if(bytes.length>5_000_000)throw new Error('Snapshot is too large.');snapshot=reviewLaterSnapshotSchema.parse(JSON.parse(bytes.toString()));}
  pool=new pg.Pool({connectionString:env.data.DATABASE_URL,max:2,statement_timeout:15000,lock_timeout:5000});
  if(apply){const report=await applyReviewLater(pool,env.data.SHOPBOT_CATALOG_STORE_ID,actor!.data!,snapshot,{ownerAuthorized:true},n=>{if(n%25===0)console.error(`${n} drafts processed`);});console.log(JSON.stringify(report,null,2));if(report.blocked||report.conflicts)process.exitCode=1;}
  else{snapshot=await previewReviewLater(pool,env.data.SHOPBOT_CATALOG_STORE_ID);await writeFile(path,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({mode:'preview',snapshotId:snapshot.snapshotId,storeId:snapshot.storeId,total:snapshot.items.length,ready:snapshot.items.filter(i=>i.status==='ready').length,blocked:snapshot.items.filter(i=>i.status==='blocked').length,published:0,snapshotPath:path},null,2));}
 }
}catch(error){console.error(JSON.stringify({error:'catalog_review_later_failed',message:error instanceof Error&&!(error instanceof z.ZodError)&&!('code' in error)?error.message:'The operation failed. Check settings, snapshot and database availability; no failed draft was changed.'}));process.exitCode=1;}finally{await pool?.end();}
