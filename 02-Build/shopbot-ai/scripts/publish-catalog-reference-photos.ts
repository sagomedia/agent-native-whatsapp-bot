import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {z} from 'zod';
import {previewReferencePhotos,applyReferencePhotos,referencePhotoSnapshotSchema} from '../apps/server/src/services/catalog-reference-photos.js';

const usage='Usage: node dist/scripts/publish-catalog-reference-photos.js --batch=import-batch --snapshot=/private/path/reference-photos.json [--apply --owner-authorized]. Preview is read-only and creates a private snapshot. Apply uses the same saved batch/snapshot and publishes normalized catalog reference photos without confirming identity. Set DATABASE_URL, SHOPBOT_CATALOG_STORE_ID and (for apply) SHOPBOT_CATALOG_ACTOR.';
const args=process.argv.slice(2);let pool:pg.Pool|undefined;
try{
 if(args.length===1&&args[0]==='--help'){console.log(usage);}else{
  if(args.some(a=>!/^(?:--batch=.+|--snapshot=.+|--apply|--owner-authorized)$/.test(a))||args.filter(a=>a.startsWith('--batch=')).length!==1||args.filter(a=>a.startsWith('--snapshot=')).length!==1||new Set(args).size!==args.length)throw new Error(usage);
  const path=args.find(a=>a.startsWith('--snapshot='))!.slice('--snapshot='.length),batchId=z.string().trim().min(1).max(100).parse(args.find(a=>a.startsWith('--batch='))!.slice('--batch='.length)),apply=args.includes('--apply');
  if(apply!==args.includes('--owner-authorized'))throw new Error('Apply requires both --apply and --owner-authorized. '+usage);
  const env=z.object({DATABASE_URL:z.string().url(),SHOPBOT_CATALOG_STORE_ID:z.uuid()}).safeParse(process.env);
  if(!env.success)throw new Error('Explicit DATABASE_URL and SHOPBOT_CATALOG_STORE_ID are required.');
  const actor=apply?z.string().trim().min(3).max(200).safeParse(process.env.SHOPBOT_CATALOG_ACTOR):undefined;
  if(apply&&!actor?.success)throw new Error('Apply requires explicit SHOPBOT_CATALOG_ACTOR identifying the authorizing owner/operator.');
  let snapshot;
  if(apply){const bytes=await readFile(path);if(bytes.length>5_000_000)throw new Error('Snapshot is too large.');snapshot=referencePhotoSnapshotSchema.parse(JSON.parse(bytes.toString()));if(snapshot.batchId!==batchId)throw new Error('The snapshot belongs to a different import batch.');}
  pool=new pg.Pool({connectionString:env.data.DATABASE_URL,max:2,statement_timeout:15000,lock_timeout:5000});
  if(apply){const report=await applyReferencePhotos(pool,env.data.SHOPBOT_CATALOG_STORE_ID,actor!.data!,snapshot,{ownerAuthorized:true},n=>{if(n%25===0)console.error(`${n} products processed`);});console.log(JSON.stringify(report,null,2));if(report.conflicts)process.exitCode=1;}
  else{snapshot=await previewReferencePhotos(pool,env.data.SHOPBOT_CATALOG_STORE_ID,batchId);await writeFile(path,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({mode:'preview',snapshotId:snapshot.snapshotId,storeId:snapshot.storeId,batchId,total:snapshot.items.length,ready:snapshot.items.filter(i=>i.status==='ready').length,held:snapshot.items.filter(i=>i.status==='held').length,noAsset:snapshot.items.filter(i=>i.status==='no_asset').length,existingImage:snapshot.items.filter(i=>i.status==='existing_image').length,published:0,snapshotPath:path},null,2));}
 }
}catch(error){console.error(JSON.stringify({error:'catalog_reference_photos_failed',message:error instanceof Error&&!(error instanceof z.ZodError)&&!('code' in error)?error.message:'The operation failed. Check settings, snapshot and database availability; no failed product was changed.'}));process.exitCode=1;}finally{await pool?.end();}
