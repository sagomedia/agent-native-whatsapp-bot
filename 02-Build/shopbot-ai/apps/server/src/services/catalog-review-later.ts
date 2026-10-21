import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {ownerProductSchema,saveReviewLaterCatalogProduct} from './catalog-products.js';

const MAX_DRAFTS=5000;
const sourceHashSchema=z.string().regex(/^[a-f0-9]{64}$/);
const itemSchema=z.object({id:z.uuid(),version:z.number().int().positive(),sourceHash:sourceHashSchema,sku:z.string().min(1).max(64),status:z.enum(['ready','blocked']),issues:z.array(z.string()).max(100)}).strict();
export const reviewLaterSnapshotSchema=z.object({schemaVersion:z.literal(1),mode:z.literal('owner-review-later'),snapshotId:z.uuid(),storeId:z.uuid(),items:z.array(itemSchema).max(MAX_DRAFTS)}).strict();
export type ReviewLaterSnapshot=z.infer<typeof reviewLaterSnapshotSchema>;
const fail=(message:string)=>Object.assign(new Error(message),{statusCode:409});
function stable(value:unknown):unknown {if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));return value;}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const skuFor=(row:any)=>row.details.sku||'SHOP-'+row.id.replaceAll('-','').slice(0,16).toUpperCase();
const sourceHash=(row:any)=>hash({id:row.id,details:row.details,provenance:row.provenance,baseSku:row.base_sku,baseVersion:row.base_version,assets:row.assets});
const proposalSelect=`SELECT p.*,coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'sha256',a.sha256,'matchKind',a.match_kind) ORDER BY a.id) FROM catalog_proposal_assets a WHERE a.store_id=p.store_id AND a.proposal_id=p.id),'[]'::jsonb) AS assets FROM catalog_proposals p`;
function productInput(row:any){
 const d=row.details;
 // A selling unit/increment must already exist in the source. Never infer them
 // from a photograph or replace missing shop prices/stock with estimates.
 return ownerProductSchema.parse({...d,sku:skuFor(row),version:0,localNames:d.localNames??{},aliases:d.aliases??[],keywords:d.keywords??[],pricePaise:d.pricePaise??0,priceStatus:d.priceStatus??(d.pricePaise>0?'priced':'confirm'),stock:d.stock??null,familyId:d.familyId??'',brand:d.brand??'',specifications:d.specifications??{},active:true,verified:false,verification:{identity:false,photo:false,sellingUnit:false,price:false,stock:false}});
}
function validSnapshot(input:unknown,storeId:string){
 const snapshot=reviewLaterSnapshotSchema.parse(input);
 if(snapshot.storeId!==storeId)throw fail('The snapshot belongs to another shop.');
 if(new Set(snapshot.items.map(i=>i.id)).size!==snapshot.items.length)throw fail('The snapshot repeats a draft.');
 return snapshot;
}

/** Bounded, consistent, read-only snapshot of ALL current drafts in this shop. */
export async function previewReviewLater(pool:Pool,storeId:string):Promise<ReviewLaterSnapshot>{
 z.uuid().parse(storeId);const c=await pool.connect();
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  if(!(await c.query('SELECT id FROM stores WHERE id=$1',[storeId])).rowCount)throw fail('Shop not found.');
  const rows=(await c.query(proposalSelect+" WHERE p.store_id=$1 AND p.state='draft' ORDER BY p.created_at,p.id LIMIT $2",[storeId,MAX_DRAFTS+1])).rows;
  if(rows.length>MAX_DRAFTS)throw fail(`More than ${MAX_DRAFTS} drafts; split this operation into explicit snapshots.`);
  const skus=rows.map(skuFor),duplicates=new Set(skus.filter((sku,i)=>skus.indexOf(sku)!==i));
  const existing=new Set((await c.query('SELECT sku FROM products WHERE store_id=$1 AND sku=ANY($2::text[])',[storeId,skus])).rows.map(p=>p.sku));
  const families=new Set((await c.query("SELECT id FROM catalog_nodes WHERE store_id=$1 AND kind='family'",[storeId])).rows.map(p=>p.id));
  const items=rows.map(row=>{
   const issues:string[]=[];if(row.base_sku)issues.push('Existing product edits require individual owner review.');
   if(existing.has(skuFor(row)))issues.push('Product code already exists in this shop.');
   if(duplicates.has(skuFor(row)))issues.push('Multiple drafts use this product code.');
   try{const product=productInput(row);if(product.familyId&&!families.has(product.familyId))issues.push('The product type no longer exists in this shop.');}catch{issues.push('Source product details are incomplete or invalid; preserve the draft for review.');}
   return {id:row.id,version:row.version,sourceHash:sourceHash(row),sku:skuFor(row),status:issues.length?'blocked' as const:'ready' as const,issues};
  });
  await c.query('COMMIT');return {schemaVersion:1,mode:'owner-review-later',snapshotId:randomUUID(),storeId,items};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}

export type ReviewLaterResult={id:string;sku:string;status:'published'|'already_published'|'blocked'|'conflict';message?:string};
export type ReviewLaterReport={snapshotId:string;storeId:string;total:number;published:number;alreadyPublished:number;blocked:number;conflicts:number;results:ReviewLaterResult[]};
async function publishItem(c:PoolClient,storeId:string,actor:string,snapshot:ReviewLaterSnapshot,snapshotHash:string,item:z.infer<typeof itemSchema>):Promise<ReviewLaterResult>{
 const row=(await c.query(proposalSelect+' WHERE p.store_id=$1 AND p.id=$2 FOR UPDATE OF p',[storeId,item.id])).rows[0];
 if(!row)throw fail('Draft not found in this shop.');
 const audit=(await c.query("SELECT details FROM owner_audit WHERE store_id=$1 AND target_id=$2 AND action='catalog_review_later_publish' AND details->>'snapshotId'=$3 ORDER BY sequence DESC LIMIT 1",[storeId,item.id,snapshot.snapshotId])).rows[0]?.details;
 if(audit){
  if(audit.snapshotHash!==snapshotHash||audit.sourceVersion!==item.version||audit.sourceHash!==item.sourceHash||audit.sku!==item.sku)throw fail('The snapshot differs from the previously authorized operation.');
  if(row.state!=='published'||row.published_sku!==item.sku||!(await c.query('SELECT 1 FROM products WHERE store_id=$1 AND sku=$2',[storeId,item.sku])).rowCount)throw fail('A previously promoted draft changed; inspect its audit before retrying.');
  return {id:item.id,sku:item.sku,status:'already_published'};
 }
 if(row.state!=='draft'||row.version!==item.version||sourceHash(row)!==item.sourceHash||skuFor(row)!==item.sku)throw fail('Draft changed after the preview; create a fresh snapshot.');
 if(row.base_sku)throw fail('Existing product edits cannot use review later.');
 const saved=await saveReviewLaterCatalogProduct(c,storeId,productInput(row));
 // Original and normalized assets stay private on the proposal. No staged image
 // is an owner-approved photo, including an AI-labelled "exact" match.
 await c.query('UPDATE products SET image_path=NULL WHERE store_id=$1 AND sku=$2',[storeId,saved.sku]);
 await c.query("UPDATE catalog_proposals SET state='published',published_sku=$1,version=version+1,updated_at=now() WHERE store_id=$2 AND id=$3",[saved.sku,storeId,item.id]);
 const product=(await c.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2',[storeId,saved.sku])).rows[0];
 await c.query('INSERT INTO owner_audit(store_id,email,action,target_id,details) VALUES($1,$2,$3,$4,$5)',[storeId,actor,'catalog_review_later_publish',item.id,JSON.stringify({snapshotId:snapshot.snapshotId,snapshotHash,sourceVersion:item.version,sourceHash:item.sourceHash,sku:saved.sku,productVersion:saved.version,productFingerprint:hash(product),reviewPending:true,photosHeld:true,sourceDetails:row.details,sourceProvenance:row.provenance,assets:row.assets})]);
 return {id:item.id,sku:saved.sku,status:'published'};
}

/** Explicit owner/operator authorization only; deliberately absent from MCP. */
export async function applyReviewLater(pool:Pool,storeId:string,actor:string,input:unknown,authorization:{ownerAuthorized:true},onProgress?:(count:number)=>void):Promise<ReviewLaterReport>{
 if(authorization?.ownerAuthorized!==true)throw fail('Explicit owner authorization is required for review later.');
 z.string().trim().min(3).max(200).parse(actor);const snapshot=validSnapshot(input,storeId),snapshotHash=hash(snapshot),results:ReviewLaterResult[]=[];
 const duplicates=new Set(snapshot.items.map(i=>i.sku).filter((sku,i,all)=>all.indexOf(sku)!==i));
 for(const item of snapshot.items){
  if(item.status==='blocked'||duplicates.has(item.sku)){results.push({id:item.id,sku:item.sku,status:'blocked',message:item.issues.join(' ')||'Multiple drafts use this product code.'});continue;}
  const c=await pool.connect();
  try{
   await c.query('BEGIN');if(!(await c.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE',[storeId])).rowCount)throw fail('Shop not found.');
   const result=await publishItem(c,storeId,actor,snapshot,snapshotHash,item);await c.query('COMMIT');results.push(result);
  }catch(error){await c.query('ROLLBACK');results.push({id:item.id,sku:item.sku,status:'conflict',message:error instanceof Error&&'statusCode' in error?error.message:'This product could not be promoted; no changes were saved for this draft.'});}finally{c.release();}
  onProgress?.(results.length);
 }
 return {snapshotId:snapshot.snapshotId,storeId,total:results.length,published:results.filter(r=>r.status==='published').length,alreadyPublished:results.filter(r=>r.status==='already_published').length,blocked:results.filter(r=>r.status==='blocked').length,conflicts:results.filter(r=>r.status==='conflict').length,results};
}
