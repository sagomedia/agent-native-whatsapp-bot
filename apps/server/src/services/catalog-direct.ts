import {prepareCatalogUpload} from './catalog-upload.js';
import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {catalogDraftSchema,createProposal,addProposalAsset,publishProposal} from './catalog-proposals.js';
import {ownerProductSchema} from './catalog-products.js';
import {assertCatalogPermission,chatError,mutate,snapshot,type CatalogPrincipal} from './catalog-chat.js';
import {imageUploadSchema} from './image-media.js';

export const directProductDetails=catalogDraftSchema.extend({
 name:ownerProductSchema.shape.name,unit:ownerProductSchema.shape.unit,
 pricePaise:ownerProductSchema.shape.pricePaise,stock:ownerProductSchema.shape.stock.unwrap(),
 quantityStep:ownerProductSchema.shape.quantityStep.default(1)
}).superRefine((p,c)=>{
 if(p.priceStatus==='confirm'||p.pricePaise===0&&p.priceStatus!=='free'||p.priceStatus==='free'&&p.pricePaise!==0)
  c.addIssue({code:'custom',message:'Enter the actual seller price; zero requires explicit free status.'});
});
export const directProductSchema=z.object({operationId:z.uuid(),details:directProductDetails,photo:imageUploadSchema}).strict();
export const duplicateQuerySchema=z.object({name:z.string().trim().min(2).max(160),unit:ownerProductSchema.shape.unit}).strict();

/** Exact canonical-name collisions block creation; fuzzy matches are suggestions, never automatic merges. */
export async function exactProductDuplicates(c:PoolClient,storeId:string,name:string,unit:string,excludeDraft?:string){
 return (await c.query(`SELECT 'product' AS kind,sku AS id,name,active AS published FROM products
 WHERE store_id=$1 AND unit=$3 AND lower(regexp_replace(name,'[[:space:]]+',' ','g'))=lower(regexp_replace($2,'[[:space:]]+',' ','g'))
 UNION ALL SELECT 'draft',id::text,details->>'name',false FROM catalog_proposals
 WHERE store_id=$1 AND state='draft' AND ($4::uuid IS NULL OR id<>$4) AND details->>'unit'=$3
 AND lower(regexp_replace(details->>'name','[[:space:]]+',' ','g'))=lower(regexp_replace($2,'[[:space:]]+',' ','g')) LIMIT 20`,[storeId,name.trim(),unit,excludeDraft??null])).rows;
}

/** Complete owner addition is a single atomic business action, with internal staging for source retention. */
export async function addChatProduct(pool:Pool,p:CatalogPrincipal,input:unknown){
 const a=directProductSchema.parse(input);
 const check=await pool.connect();try{await assertCatalogPermission(check,p,'catalog:publish');}finally{check.release();}
 // Decoding must not hold the store write lock. Commit still rechecks the grant.
 const prepared=await prepareCatalogUpload({proposalId:a.operationId,version:1,photo:a.photo,matchKind:'exact'});
 const sourceHash=createHash('sha256').update(Buffer.from(a.photo.data,'base64')).digest('hex');
 return mutate(pool,p,'catalog:publish',a.operationId,'add_product',{details:a.details,sourceHash},async c=>{
  const duplicates=await exactProductDuplicates(c,p.storeId,a.details.name,a.details.unit);
  if(duplicates.length)throw Object.assign(chatError('duplicate_product','An item with this name and selling unit already exists. Read it and edit/restore it, or supply the distinct variant name.'),{duplicates});
  const d=await createProposal(c,p.storeId,p.actor,{id:a.operationId,batchId:'direct-owner-chat',clientItemId:a.operationId,details:a.details,provenance:{source:'Connected owner agent · direct addition',issues:[]}});
  const asset=await addProposalAsset(c,p.storeId,{...prepared.input,proposalId:d.id},prepared.media);
  const current=(await c.query('SELECT * FROM catalog_proposals WHERE store_id=$1 AND id=$2',[p.storeId,d.id])).rows[0];
  const view=await snapshot(c,p,current,asset.id);
  if(view.missingRequired.length)throw chatError('missing_facts','Complete the required product facts: '+view.missingRequired.join(', '),400);
  const saved=await publishProposal(c,p.storeId,{id:d.id,version:asset.version,product:view.data.product,assetId:asset.id});
  return {...saved,state:'published',authorization:'delegated_owner_grant',product:view.data.product,sourceAssetId:asset.id,sourceHash,
   receipt:{operationId:a.operationId,action:'add_product'},nextStep:{type:'done',message:'Published directly from chat. The product is available in the dashboard and customer catalog.'}};
 });
}
