import {prepareCatalogUpload} from './catalog-upload.js';
import {catalogEnrichmentInstructions,catalogEnrichmentVersion} from '../../../../packages/contracts/catalog-enrichment.js';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {catalogDraftSchema,catalogWrite,createProposal,updateProposal,prepareProposalAsset,addProposalAsset,publishProposal} from './catalog-proposals.js';
import {ownerProductSchema} from './catalog-products.js';
import {productFromRow} from './catalog.js';
import {sellingBasisIssues,sellingBasisPreview} from '../../../../packages/contracts/selling-basis.js';
import {imageUploadSchema} from './image-media.js';

export type CatalogPrincipal={storeId:string;actor:string;canWrite?:boolean;canPublish?:boolean;canReadOwner?:boolean;canManageOrders?:boolean;grantId?:string;ownerActor?:string;resource?:string;accessExpiresAt?:number};
export const chatError=(code:string,message:string,statusCode=409)=>Object.assign(new Error(message),{code,statusCode});
const uuid=z.uuid(),revision=z.number().int().positive();
export const chatPrepareSchema=z.object({operationId:uuid,id:uuid.optional(),version:revision.optional(),batchId:z.string().min(1).max(100).default('owner-chat'),clientItemId:z.string().min(1).max(100).optional(),details:catalogDraftSchema,base:z.object({sku:z.string().min(1).max(64),version:revision}).strict().optional()}).strict();
export const chatReadSchema=z.object({id:uuid}).strict();
export const chatReviewSchema=z.object({operationId:uuid,id:uuid,version:revision,assetId:uuid.optional(),withoutPhoto:z.boolean().default(false).describe('Legacy new proposals only. Existing-product edits preserve their saved photo automatically; omit this flag. Photo removal is not supported through MCP.')}).strict();
export const chatCommitSchema=z.object({operationId:uuid,reviewId:uuid}).strict();
export const chatMediaSchema=z.object({operationId:uuid,id:uuid,version:revision,kind:z.enum(['original','cleaned','marketing']).default('original'),sourceAssetId:uuid.optional(),matchKind:z.enum(['exact','family_only','unconfirmed']),photo:imageUploadSchema}).strict();
function canonical(value:any):any{return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])])):value;}
export const chatHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** Credentials and grants are adapter-owned, never MCP tool parameters. */
export async function assertCatalogPermission(c:PoolClient,p:CatalogPrincipal,permission:'catalog:read'|'catalog:draft'|'catalog:publish'|'owner:read'|'orders:write'){
 if(permission==='owner:read'&&!p.canReadOwner||permission==='orders:write'&&(!p.canReadOwner||!p.canManageOrders))throw chatError('insufficient_scope','Reconnect this agent with the required owner permission.',403);
 if(permission==='catalog:draft'&&p.canWrite===false||permission==='catalog:publish'&&!p.canPublish)throw chatError('insufficient_scope','Reconnect this agent with the required catalog permission.',403);
 if(p.accessExpiresAt!==undefined&&p.accessExpiresAt<=Date.now()/1000)throw chatError('unauthorized','The connection expired. Refresh its authorization.',401);
 if(p.grantId){
  const grant=(await c.query('SELECT store_id,actor,scopes,resource FROM mcp_oauth_grants WHERE id=$1 AND revoked_at IS NULL FOR SHARE',[p.grantId])).rows[0];
  if(!grant||grant.store_id!==p.storeId||grant.actor!==p.ownerActor||grant.resource!==p.resource||!grant.scopes.includes(permission))throw chatError('insufficient_scope','The connection was revoked or does not permit this action.',403);
 }
}
export async function mutate<T>(pool:Pool,p:CatalogPrincipal,permission:'catalog:draft'|'catalog:publish'|'orders:write',operationId:string,action:string,input:unknown,run:(c:PoolClient)=>Promise<T>):Promise<T>{
 return catalogWrite(pool,p.storeId,p.actor,'mcp_chat_'+action,operationId,async c=>{
  await assertCatalogPermission(c,p,permission);
  const hash=chatHash(input),old=(await c.query('SELECT * FROM catalog_chat_operations WHERE store_id=$1 AND id=$2',[p.storeId,operationId])).rows[0];
  if(old){if(old.actor!==p.actor||old.action!==action||old.input_hash!==hash)throw chatError('idempotency_conflict','This operation ID was already used with different content.');return old.result as T;}
  const result=await run(c);
  await c.query('INSERT INTO catalog_chat_operations(store_id,id,actor,action,input_hash,result) VALUES($1,$2,$3,$4,$5,$6)',[p.storeId,operationId,p.actor,action,hash,JSON.stringify(result)]);
  return result;
 });
}
async function readDraft(c:PoolClient,p:CatalogPrincipal,id:string,version?:number){
 const draft=(await c.query('SELECT * FROM catalog_proposals WHERE store_id=$1 AND id=$2 FOR UPDATE',[p.storeId,id])).rows[0];
 if(!draft)throw chatError('not_found','Product draft not found in this shop.',404);
 if(version!==undefined&&(draft.version!==version||draft.state!=='draft'))throw chatError('stale_revision','This product draft changed. Reload and reconcile before continuing.');
 return draft;
}
function productInput(row:any){return {sku:row.sku,name:row.name,localNames:row.local_names,aliases:row.aliases,keywords:row.keywords,unit:row.unit,priceStatus:row.price_status,pricePaise:row.price_paise,stock:row.stock==null?null:Number(row.stock),inventoryVersion:row.inventory_version,quantityStep:Number(row.quantity_step),familyId:row.family_id??'',brand:row.brand??'',specifications:row.specifications,sellingPolicy:row.selling_policy};}
export async function snapshot(c:PoolClient,p:CatalogPrincipal,d:any,assetId?:string,withoutPhoto=false){
 if(d.base_sku&&withoutPhoto)throw chatError('photo_removal_not_supported','Existing-product edits preserve the saved photo automatically. Omit withoutPhoto; no re-upload is needed for name, alias, price or stock changes.',400);
 const before=d.base_sku?(await c.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2',[p.storeId,d.base_sku])).rows[0]:undefined;
 if(d.state==='draft'&&d.base_sku&&before?.version!==d.base_version)throw chatError('stale_product','The published product changed. Start a fresh edit from its current version.');
 // Product and inventory versions are distinct; capture both for the final check.
 const fields={...(before?productInput(before):{}),...d.details};
 const missing:string[]=[];
 for(const key of ['name','unit'])if(!fields[key])missing.push(key==='unit'?'sellingUnit':key);
 if(fields.pricePaise===undefined&&fields.priceStatus===undefined)missing.push('priceOrConfirmStatus');
 if(fields.priceStatus==='priced'&&!(fields.pricePaise>0))missing.push('price');
 if(assetId&&withoutPhoto)throw chatError('invalid_input','Choose a photo or explicitly continue without one.',400);
 const asset=assetId?(await c.query('SELECT id,sha256,image_hash,match_kind,asset_kind,source_asset_id FROM catalog_proposal_assets WHERE store_id=$1 AND proposal_id=$2 AND id=$3',[p.storeId,d.id,assetId])).rows[0]:undefined;
 if(assetId&&(!asset||asset.match_kind!=='exact'||asset.asset_kind==='marketing'))throw chatError('photo_not_exact','Select an exact original or cleaned product photograph, not a marketing or uncertain image.',400);
 if(!asset&&!withoutPhoto&&!d.base_sku)missing.push('productPhotoOrExplicitOmission');
 const candidate={createId:d.id,name:fields.name,localNames:{},aliases:[],keywords:[],stock:null,quantityStep:1,familyId:'',brand:'',specifications:{},...fields,sku:d.base_sku??fields.sku??'SHOP-'+d.id.replaceAll('-','').slice(0,16).toUpperCase(),version:d.base_version??0,pricePaise:fields.pricePaise??0,priceStatus:fields.priceStatus??(fields.pricePaise>0?'priced':'confirm'),active:true,verified:true,verification:{identity:true,photo:true,sellingUnit:true,price:true,stock:true}};
 const parsed=ownerProductSchema.safeParse(candidate);
 if(!parsed.success)for(const issue of parsed.error.issues)missing.push(issue.path.join('.')||'productDetails');
 const issues=parsed.success?sellingBasisIssues(parsed.data):[];
 if(issues.length)missing.push('sellingBasis');
 const data={proposalId:d.id,proposalVersion:d.version,product:parsed.success?parsed.data:candidate,baseInventoryVersion:before?.inventory_version??null,baseImagePath:before?.image_path??null,asset:asset??null,withoutPhoto};
 return {data,before:before?productFromRow(before):null,missingRequired:[...new Set(missing)],issues};
}
function next(missing:string[]){return missing.length?{type:'ask_owner',fields:missing,question:missing.includes('sellingUnit')?'Do you sell this per piece, pack, or another selling unit?':missing.includes('priceOrConfirmStatus')?'What is the selling price, or should customers confirm the price with you?':'Please confirm the remaining product details: '+missing.join(', ')}:{type:'review_in_chat',message:'Show the product and chosen photo. Keep corrections, then commit only as requested by the owner.'};}
export async function catalogContext(pool:Pool,p:CatalogPrincipal){
 const c=await pool.connect();try{await assertCatalogPermission(c,p,'catalog:read');return {shop:(await c.query('SELECT id,name FROM stores WHERE id=$1',[p.storeId])).rows[0],enrichment:{version:catalogEnrichmentVersion,instructions:catalogEnrichmentInstructions},permissions:{read:true,draft:p.canWrite!==false,publish:p.canPublish===true},policy:{directAddition:{tool:'catalog_add_product',required:['photo','name','pricePaise','stock','unit'],newProductDrafts:false,incompleteAction:'Ask for missing facts in chat; retry catalog_add_product when complete.',existingProductEdits:'catalog_prepare then catalog_get_edit, catalog_review and catalog_commit',enrichmentRules:'catalog://owner/enrichment'},photoTransfer:{clientMode:'unknown',preflightTool:'catalog_validate_photo',metadataEditsNeedUpload:false,existingPhotoDefault:'preserve',photoRemovalSupported:false},approvalLocation:'chat',authorization:'delegated_owner_grant',clientConfirmation:'Follow the host client confirmation controls; never claim a model Boolean proves human approval.',media:'Host-generated edits retain an original source. Marketing images cannot be primary.',unknownPrice:'Ask for seller price or explicit price-to-confirm status.',stock:'Unknown stays unknown. Never overwrite a stale inventory version.',serverSideInference:false},taxonomy:(await c.query('SELECT id,parent_id,kind,label FROM catalog_nodes WHERE store_id=$1 ORDER BY kind,label',[p.storeId])).rows};}finally{c.release();}
}
export async function getChatDraft(pool:Pool,p:CatalogPrincipal,id:string){
 const c=await pool.connect();try{await c.query('BEGIN');await assertCatalogPermission(c,p,'catalog:read');const d=await readDraft(c,p,id);
  const assets=(await c.query('SELECT id,sha256,match_kind,asset_kind,source_asset_id,image_hash FROM catalog_proposal_assets WHERE store_id=$1 AND proposal_id=$2 ORDER BY created_at,id',[p.storeId,id])).rows;
  const view:{missingRequired:string[]}=d.state==='draft'?await snapshot(c,p,d,assets.find(a=>a.match_kind==='exact'&&a.asset_kind==='original')?.id):{missingRequired:[]};
  await c.query('COMMIT');return {dashboardPath:'/owner?view=catalog&drafts=1&draft='+d.id,id:d.id,version:d.version,state:d.state,details:d.details,publishedSku:d.published_sku,provenance:d.provenance,base:d.base_sku?{sku:d.base_sku,version:d.base_version}:null,assets,missingRequired:view.missingRequired,nextStep:d.state==='draft'?next(view.missingRequired):{type:'done',state:d.state,sku:d.published_sku}};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function prepareChatDraft(pool:Pool,p:CatalogPrincipal,input:unknown){
 const a=chatPrepareSchema.parse(input);
 return mutate(pool,p,'catalog:draft',a.operationId,'prepare',a,async c=>{
  let result;
  if(a.id){if(a.version===undefined||a.base)throw chatError('invalid_input','Supply the current draft version; an edit target cannot change.',400);const old=await readDraft(c,p,a.id,a.version);result=await updateProposal(c,p.storeId,{id:a.id,version:a.version,details:{...old.details,...a.details}});}
  else{if(a.version!==undefined)throw chatError('invalid_input','A new draft has no draft version.',400);result=await createProposal(c,p.storeId,p.actor,{id:randomUUID(),batchId:a.batchId,clientItemId:a.clientItemId??a.operationId,details:a.details,provenance:{source:'Owner chat via connected agent',issues:[]},...(a.base?{base:a.base}:{})});}
  return {...result,nextStep:{type:'read_draft',tool:'catalog_get_edit',id:result.id}};
 });
}
export async function attachChatMedia(pool:Pool,p:CatalogPrincipal,input:unknown){
 const a=chatMediaSchema.parse(input);
 const c=await pool.connect();try{await assertCatalogPermission(c,p,'catalog:draft');}finally{c.release();}
 // Bound and decode before taking the store write lock. No model call is made.
 const prepared=await prepareCatalogUpload({proposalId:a.id,version:a.version,photo:a.photo,matchKind:a.matchKind});
 const {photo,...action}=a;
 return mutate(pool,p,'catalog:draft',a.operationId,'media',{...action,sourceHash:createHash('sha256').update(Buffer.from(photo.data,'base64')).digest('hex')},async c=>{
  await readDraft(c,p,a.id,a.version);
  if(a.kind!=='original'){
   const source=a.sourceAssetId&&(await c.query("SELECT match_kind FROM catalog_proposal_assets WHERE store_id=$1 AND proposal_id=$2 AND id=$3 AND asset_kind='original'",[p.storeId,a.id,a.sourceAssetId])).rows[0];
   if(!source)throw chatError('missing_original','A cleaned or marketing image must reference this draft’s original photo.',400);
   if(a.kind==='cleaned'&&a.matchKind==='exact'&&source.match_kind!=='exact')throw chatError('identity_unconfirmed','Cleaning cannot establish exact identity from an uncertain or family-only source photo.',400);
  }else if(a.sourceAssetId)throw chatError('invalid_input','An original photograph cannot reference an edited source.',400);
  const saved=await addProposalAsset(c,p.storeId,prepared.input,prepared.media);
  const prior=(await c.query('SELECT asset_kind,source_asset_id FROM catalog_proposal_assets WHERE id=$1',[saved.id])).rows[0];
  if(saved.replayed&&(prior.asset_kind!==a.kind||prior.source_asset_id!==(a.sourceAssetId??null)))throw chatError('image_provenance_conflict','These bytes already have a different source or image classification.');
  await c.query('UPDATE catalog_proposal_assets SET asset_kind=$1,source_asset_id=$2 WHERE id=$3',[a.kind,a.sourceAssetId??null,saved.id]);
  return {...saved,kind:a.kind,sourceAssetId:a.sourceAssetId??null,nextStep:{type:'review_in_chat',tool:'catalog_review',id:a.id}};
 });
}
export async function reviewChatDraft(pool:Pool,p:CatalogPrincipal,input:unknown){
 const a=chatReviewSchema.parse(input);
 return mutate(pool,p,'catalog:draft',a.operationId,'review',a,async c=>{
  const d=await readDraft(c,p,a.id,a.version),view=await snapshot(c,p,d,a.assetId,a.withoutPhoto);
  if(view.missingRequired.length)return {id:d.id,version:d.version,missingRequired:view.missingRequired,issues:view.issues,nextStep:next(view.missingRequired)};
  const id=randomUUID();await c.query('INSERT INTO catalog_chat_reviews(id,store_id,proposal_id,proposal_version,actor,input_hash,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,p.storeId,d.id,d.version,p.actor,chatHash(view.data),JSON.stringify(view.data)]);
  return {reviewId:id,id:d.id,version:d.version,before:view.before,product:view.data.product,photo:view.data.asset,photoAction:view.data.asset?'replace':view.data.baseImagePath?'preserve':'remain_without_photo',withoutPhoto:a.withoutPhoto,sellingBasis:sellingBasisPreview(view.data.product),expiresInSeconds:1800,missingRequired:[],authorization:'agent_action_under_owner_publish_grant',nextStep:p.canPublish?{type:'owner_review_then_commit',tool:'catalog_commit',message:'Show the exact changes in chat and state whether the saved photo is preserved or explicitly replaced. No upload is needed for metadata-only edits. Apply corrections before committing.'}:{type:'authorize_publish',requiredScope:'catalog:publish',message:'This connection can prepare existing-product edits. Reconnect with catalog:publish to add or publish products in chat.'}};
 });
}
export async function commitChatDraft(pool:Pool,p:CatalogPrincipal,input:unknown){
 const a=chatCommitSchema.parse(input);
 return mutate(pool,p,'catalog:publish',a.operationId,'commit',a,async c=>{
  const review=(await c.query('SELECT * FROM catalog_chat_reviews WHERE id=$1 AND store_id=$2 AND actor=$3 AND expires_at>now() FOR UPDATE',[a.reviewId,p.storeId,p.actor])).rows[0];
  if(!review)throw chatError('review_expired','This review expired or belongs to another connection. Review the current draft again.');
  const stored=review.snapshot,d=await readDraft(c,p,review.proposal_id,review.proposal_version),view=await snapshot(c,p,d,stored.asset?.id,stored.withoutPhoto);
  if(view.missingRequired.length||chatHash(view.data)!==review.input_hash)throw chatError('stale_review','Product details, inventory or selected image changed. Review the current version again.');
  const saved=await publishProposal(c,p.storeId,{id:d.id,version:d.version,product:stored.product,...(stored.asset?{assetId:stored.asset.id}:{}),withoutPhoto:stored.withoutPhoto});
  const image=(await c.query('SELECT image_path FROM products WHERE store_id=$1 AND sku=$2',[p.storeId,saved.sku])).rows[0]?.image_path??null;
  if(!stored.asset&&image!==(stored.baseImagePath??null))throw chatError('photo_preservation_failed','The saved photo changed during a metadata-only edit. The transaction was rolled back.');
  const photoAction=stored.asset?'replaced':image?'preserved':'remained_without_photo';
  return {...saved,reviewId:review.id,photoAction,authorization:'delegated_owner_grant',nextStep:{type:'done',message:'The product was saved. Photo: '+photoAction+'.'}};
 });
}
export async function chatDraftImages(pool:Pool,p:CatalogPrincipal,id:string,assetIds?:string[]){
 const c=await pool.connect();try{await assertCatalogPermission(c,p,'catalog:read');const rows=(await c.query(`SELECT a.id,a.asset_kind,coalesce(v.image,a.image) AS image FROM catalog_proposal_assets a LEFT JOIN catalog_image_variants v ON v.store_id=a.store_id AND v.source_hash=a.image_hash AND v.max_side=256 WHERE a.store_id=$1 AND a.proposal_id=$2 AND ($3::uuid[] IS NULL OR a.id=ANY($3::uuid[])) ORDER BY a.created_at,a.id LIMIT 5`,[p.storeId,id,assetIds??null])).rows;return rows.map(r=>({type:'image' as const,mimeType:'image/jpeg',data:(r.image as Buffer).toString('base64')}));}finally{c.release();}
}

/** Existing-product image preview uses only this shop's saved asset or whitelisted demo image. */
export async function chatExistingImage(pool:Pool,p:CatalogPrincipal,base:{sku:string;version:number}|null){
 if(!base)return [];
 const c=await pool.connect();try{
  await assertCatalogPermission(c,p,'catalog:read');
  const row=(await c.query('SELECT image_path,version FROM products WHERE store_id=$1 AND sku=$2',[p.storeId,base.sku])).rows[0];
  if(!row||row.version!==base.version)throw chatError('stale_product','The existing product changed. Read its current version again.');
  if(!row.image_path)return [];
  const saved=/^\/catalog-images\/(?:custom|reference)\/([a-f0-9-]{36})\.jpg$/.exec(row.image_path);
  let bytes:Buffer|undefined;
  if(saved)bytes=(await c.query('SELECT coalesce(v.image,f.image) AS image FROM catalog_photos f LEFT JOIN catalog_image_variants v ON v.store_id=f.store_id AND v.source_hash=f.content_hash AND v.max_side=256 WHERE f.store_id=$1 AND f.id=$2',[p.storeId,saved[1]])).rows[0]?.image;
  else if(/^\/demo-images\/H\d{2}\.jpg$/.test(row.image_path))bytes=await readFile('resources/catalog/ksmc-demo/images/'+row.image_path.split('/').at(-1));
  return bytes?[{type:'image' as const,mimeType:'image/jpeg',data:bytes.toString('base64')}]:[];
 }finally{c.release();}
}
