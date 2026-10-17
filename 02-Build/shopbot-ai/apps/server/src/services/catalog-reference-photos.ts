import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {saveCatalogPhoto} from './catalog-photos.js';

const MAX_PRODUCTS=5000;
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const batchIdSchema=z.string().trim().min(1).max(100);
const itemSchema=z.object({proposalId:z.uuid(),proposalVersion:z.number().int().positive(),sku:z.string().min(1).max(64),productVersion:z.number().int().positive(),productHash:digest,sourceHash:digest,assetId:z.uuid().nullable(),imageHash:digest.nullable(),status:z.enum(['ready','held','no_asset','existing_image']),issues:z.array(z.string()).max(100)}).strict();
export const referencePhotoSnapshotSchema=z.object({schemaVersion:z.literal(1),mode:z.literal('owner-reference-photos'),snapshotId:z.uuid(),storeId:z.uuid(),batchId:batchIdSchema,batchHash:digest,items:z.array(itemSchema).max(MAX_PRODUCTS)}).strict();
export type ReferencePhotoSnapshot=z.infer<typeof referencePhotoSnapshotSchema>;
type Item=z.infer<typeof itemSchema>;
const fail=(message:string)=>Object.assign(new Error(message),{statusCode:409});
function stable(value:unknown):unknown {if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));return value;}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const select=`SELECT p.*,to_jsonb(product) AS product,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'sha256',a.sha256,'imageHash',encode(sha256(a.image),'hex'),'width',a.width,'height',a.height,'bytes',octet_length(a.image),'jpeg',substring(a.image from 1 for 2)=decode('ffd8','hex'),'matchKind',a.match_kind) ORDER BY a.created_at,a.id) FROM catalog_proposal_assets a WHERE a.store_id=p.store_id AND a.proposal_id=p.id),'[]'::jsonb) AS assets,
 (SELECT to_jsonb(i) FROM catalog_intake_items i WHERE i.store_id=p.store_id AND i.batch_id=p.batch_id AND i.source_sku=p.client_item_id) AS intake
 FROM catalog_proposals p JOIN products product ON product.store_id=p.store_id AND product.sku=p.published_sku`;
const batchHash=(batch:any)=>hash({sourceHash:batch.source_hash,manifestHash:batch.manifest_hash});
async function loadBatch(c:PoolClient,storeId:string,batchId:string,full=true){
 const batch=(await c.query(`SELECT source_hash,encode(sha256(convert_to(manifest::text,'UTF8')),'hex') AS manifest_hash${full?',manifest':''} FROM catalog_intake_batches WHERE store_id=$1 AND batch_id=$2${full?'':' FOR SHARE'}`,[storeId,batchId])).rows[0];
 if(!batch)throw fail('Explicit imported catalog batch not found in this shop.');return batch;
}
const sourceHash=(row:any)=>hash({proposal:{id:row.id,batchId:row.batch_id,clientItemId:row.client_item_id,inputHash:row.input_hash,details:row.details,provenance:row.provenance,baseSku:row.base_sku,baseVersion:row.base_version,state:row.state,publishedSku:row.published_sku,version:row.version},intake:row.intake,assets:row.assets});
function eligibility(row:any,batch:any):Item {
 const issues:string[]=[];
 const entry=batch.manifest?.entries?.find((e:any)=>e.sourceSku===row.client_item_id);
 const intake=row.intake;
 if(!entry||!intake||intake.proposal_id!==row.id||intake.state!=='staged'||intake.canonical_sku!==row.published_sku||entry.canonicalSku!==row.published_sku||row.provenance?.sourceHash!==batch.source_hash)issues.push('Source is not a linked, staged catalog import item.');
 if(entry?.exclusion||intake?.state==='excluded'||batch.manifest?.mapping?.exclusions?.some((e:any)=>e.sourceSku===row.client_item_id))issues.push('Source was explicitly excluded.');
 for(const issue of row.provenance?.issues??[])if(typeof issue==='string'&&(/image\s+held\s*:/i.test(issue)||/\b(?:photo|image)\b.*\b(?:excluded|exclude|mismatch|wrong|private|customer|do not publish|do not use)\b/i.test(issue)))issues.push(issue);
 // A manifest image hash is required: a later private/customer upload attached
 // to this proposal is never eligible for this operation.
 const asset=row.assets.find((a:any)=>entry?.image&&entry.imageHash===a.sha256);
 if(asset&&(!asset.jpeg||asset.bytes<4||asset.bytes>2097152||asset.width<1||asset.height<1||asset.width>2048||asset.height>2048))issues.push('Normalized catalog image is invalid.');
 const status=row.product.image_path?'existing_image':issues.length?'held':!asset?'no_asset':'ready';
 return {proposalId:row.id,proposalVersion:row.version,sku:row.published_sku,productVersion:row.product.version,productHash:hash(row.product),sourceHash:sourceHash(row),assetId:asset?.id??null,imageHash:asset?.imageHash??null,status,issues};
}
function validated(input:unknown,storeId:string){
 const snapshot=referencePhotoSnapshotSchema.parse(input);
 if(snapshot.storeId!==storeId)throw fail('The snapshot belongs to another shop.');
 if(new Set(snapshot.items.map(i=>i.proposalId)).size!==snapshot.items.length||new Set(snapshot.items.map(i=>i.sku)).size!==snapshot.items.length)throw fail('The snapshot repeats a proposal or product.');
 return snapshot;
}

/** Read-only snapshot of one explicitly imported batch, including held/skipped rows. */
export async function previewReferencePhotos(pool:Pool,storeId:string,batchId:string):Promise<ReferencePhotoSnapshot>{
 z.uuid().parse(storeId);batchId=batchIdSchema.parse(batchId);const c=await pool.connect();
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const batch=await loadBatch(c,storeId,batchId);
  const rows=(await c.query(select+" WHERE p.store_id=$1 AND p.batch_id=$2 AND p.state='published' AND product.active=true ORDER BY p.created_at,p.id LIMIT $3",[storeId,batchId,MAX_PRODUCTS+1])).rows;
  if(rows.length>MAX_PRODUCTS)throw fail(`More than ${MAX_PRODUCTS} products; split the import batch.`);
  const items=rows.map(row=>eligibility(row,batch));
  const counts=new Map<string,number>();for(const item of items)counts.set(item.sku,(counts.get(item.sku)??0)+1);
  for(const item of items)if(counts.get(item.sku)!==1){item.status='held';item.issues.push('Multiple published proposals refer to this product.');}
  // Keep the operation bounded and unambiguous, even for historical imports.
  const seen=new Set<string>(),unique=items.filter(item=>{if(seen.has(item.sku))return false;seen.add(item.sku);return true;});
  await c.query('COMMIT');return {schemaVersion:1,mode:'owner-reference-photos',snapshotId:randomUUID(),storeId,batchId,batchHash:batchHash(batch),items:unique};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
export type ReferencePhotoResult={proposalId:string;sku:string;status:'published'|'already_published'|'held'|'no_asset'|'existing_image'|'conflict';message?:string;imagePath?:string};
export type ReferencePhotoReport={snapshotId:string;storeId:string;batchId:string;total:number;published:number;alreadyPublished:number;held:number;noAsset:number;existingImage:number;conflicts:number;results:ReferencePhotoResult[]};
async function publishItem(c:PoolClient,storeId:string,actor:string,snapshot:ReferencePhotoSnapshot,snapshotHash:string,item:Item,batchCache:{value?:any}):Promise<ReferencePhotoResult>{
 const audit=(await c.query("SELECT details FROM owner_audit WHERE store_id=$1 AND target_id=$2 AND action='catalog_reference_photo_publish' AND details->>'snapshotId'=$3 ORDER BY sequence DESC LIMIT 1",[storeId,item.proposalId,snapshot.snapshotId])).rows[0]?.details;
 if(audit){
  if(audit.snapshotHash!==snapshotHash||audit.sourceHash!==item.sourceHash||audit.productHashBefore!==item.productHash||audit.assetId!==item.assetId)throw fail('Snapshot differs from the previously authorized operation.');
  // A replay never touches the product, even after later owner edits/removal.
  return {proposalId:item.proposalId,sku:item.sku,status:'already_published',imagePath:audit.imagePath};
 }
 if(!batchCache.value)batchCache.value=await loadBatch(c,storeId,snapshot.batchId);
 const fingerprint=await loadBatch(c,storeId,snapshot.batchId,false);if(batchHash(fingerprint)!==snapshot.batchHash||batchHash(batchCache.value)!==snapshot.batchHash)throw fail('Import batch changed after preview.');
 const batch=batchCache.value;
 const row=(await c.query(select+' WHERE p.store_id=$1 AND p.batch_id=$2 AND p.id=$3 FOR UPDATE OF p,product',[storeId,snapshot.batchId,item.proposalId])).rows[0];
 if(!row||row.state!=='published'||!row.product.active||row.published_sku!==item.sku||row.version!==item.proposalVersion||row.product.version!==item.productVersion||hash(row.product)!==item.productHash||sourceHash(row)!==item.sourceHash)throw fail('Product or source changed after preview; create a fresh snapshot.');
 const current=eligibility(row,batch);
 if(current.status!=='ready'||current.assetId!==item.assetId||current.imageHash!==item.imageHash)throw fail('Source image is no longer eligible.');
 const asset=(await c.query('SELECT image,width,height FROM catalog_proposal_assets WHERE store_id=$1 AND proposal_id=$2 AND id=$3 FOR SHARE',[storeId,item.proposalId,item.assetId])).rows[0];
 if(!asset||createHash('sha256').update(asset.image).digest('hex')!==item.imageHash)throw fail('Normalized source image changed after preview.');
 const photoId=await saveCatalogPhoto(c,storeId,asset),imagePath='/catalog-images/reference/'+photoId+'.jpg';
 const saved=(await c.query("UPDATE products SET image_path=$1,version=version+1,merchant_verification=jsonb_set(merchant_verification,'{photo}','false'::jsonb) WHERE store_id=$2 AND sku=$3 AND version=$4 AND (image_path IS NULL OR image_path='') RETURNING to_jsonb(products) AS product",[imagePath,storeId,item.sku,item.productVersion])).rows[0]?.product;
 if(!saved)throw fail('Product changed or already has an image.');
 await c.query('INSERT INTO owner_audit(store_id,email,action,target_id,details) VALUES($1,$2,$3,$4,$5)',[storeId,actor,'catalog_reference_photo_publish',item.proposalId,JSON.stringify({snapshotId:snapshot.snapshotId,snapshotHash,batchId:snapshot.batchId,batchHash:snapshot.batchHash,sku:item.sku,sourceVersion:item.proposalVersion,sourceHash:item.sourceHash,assetId:item.assetId,normalizedImageHash:item.imageHash,photoId,imagePath,productVersionBefore:item.productVersion,productVersionAfter:saved.version,productHashBefore:item.productHash,productHashAfter:hash(saved),imagePathBefore:row.product.image_path,referenceOnly:true,photoVerified:false})]);
 return {proposalId:item.proposalId,sku:item.sku,status:'published',imagePath};
}
/** Explicit owner authorization; intentionally unavailable through agent tools/MCP. */
export async function applyReferencePhotos(pool:Pool,storeId:string,actor:string,input:unknown,authorization:{ownerAuthorized:true},onProgress?:(count:number)=>void):Promise<ReferencePhotoReport>{
 if(authorization?.ownerAuthorized!==true)throw fail('Explicit owner authorization is required for reference photos.');
 z.string().trim().min(3).max(200).parse(actor);const snapshot=validated(input,storeId),snapshotHash=hash(snapshot),results:ReferencePhotoResult[]=[];
 const batchCache:{value?:any}={};
 for(const item of snapshot.items){
  if(item.status!=='ready'){results.push({proposalId:item.proposalId,sku:item.sku,status:item.status,message:item.issues.join(' ')||undefined});continue;}
  const c=await pool.connect();try{
   await c.query('BEGIN');if(!(await c.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE',[storeId])).rowCount)throw fail('Shop not found.');
   const result=await publishItem(c,storeId,actor,snapshot,snapshotHash,item,batchCache);await c.query('COMMIT');results.push(result);
  }catch(error){await c.query('ROLLBACK');results.push({proposalId:item.proposalId,sku:item.sku,status:'conflict',message:error instanceof Error&&'statusCode' in error?error.message:'Photo could not be published; no changes saved for this product.'});}finally{c.release();}
  onProgress?.(results.length);
 }
 const count=(status:ReferencePhotoResult['status'])=>results.filter(r=>r.status===status).length;
 return {snapshotId:snapshot.snapshotId,storeId,batchId:snapshot.batchId,total:results.length,published:count('published'),alreadyPublished:count('already_published'),held:count('held'),noAsset:count('no_asset'),existingImage:count('existing_image'),conflicts:count('conflict'),results};
}
