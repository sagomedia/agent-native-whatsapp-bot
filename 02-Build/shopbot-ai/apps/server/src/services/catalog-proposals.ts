import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {ownerProductSchema,saveCatalogProduct} from './catalog-products.js';
import {imageUploadSchema,normalizeImage,type ImageMedia} from './image-media.js';
import {saveCatalogPhoto} from './catalog-photos.js';

// Missing shop facts remain missing in drafts. The draft contract cannot carry
// active/verified flags or grant publication rights to an AI client.
export const catalogDraftSchema=ownerProductSchema.omit({version:true,active:true,verified:true,verification:true,createId:true}).partial();
export const proposalProvenanceSchema=z.object({source:z.string().trim().min(1).max(200),sourceHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),issues:z.array(z.string().max(500)).max(100).default([])}).strict();
export const createProposalSchema=z.object({id:z.uuid(),batchId:z.string().min(1).max(100),clientItemId:z.string().min(1).max(100),details:catalogDraftSchema,provenance:proposalProvenanceSchema,base:z.object({sku:z.string().min(1).max(64),version:z.number().int().positive()}).strict().optional()}).strict();
export const updateProposalSchema=z.object({id:z.uuid(),version:z.number().int().positive(),details:catalogDraftSchema}).strict();
export const proposalAssetSchema=z.object({proposalId:z.uuid(),version:z.number().int().positive(),photo:imageUploadSchema,matchKind:z.enum(['exact','family_only','unconfirmed'])}).strict();
export const publishProposalSchema=z.object({id:z.uuid(),version:z.number().int().positive(),product:ownerProductSchema,assetId:z.uuid().optional(),withoutPhoto:z.boolean().default(false)}).strict();
const fail=(message:string,statusCode=409)=>Object.assign(new Error(message),{statusCode});
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

export async function createProposal(c:PoolClient,storeId:string,actor:string,input:unknown){
 const p=createProposalSchema.parse(input),inputHash=hash({...p,id:undefined});
 const existing=(await c.query('SELECT id,input_hash,version,state FROM catalog_proposals WHERE store_id=$1 AND batch_id=$2 AND client_item_id=$3',[storeId,p.batchId,p.clientItemId])).rows[0];
 if(existing){if(existing.input_hash!==inputHash)throw fail('That draft key already has different content. Choose a new key.');return {id:existing.id,version:existing.version,state:existing.state,replayed:true};}
 if(p.base&&!(await c.query('SELECT 1 FROM products WHERE store_id=$1 AND sku=$2 AND version=$3',[storeId,p.base.sku,p.base.version])).rowCount)throw fail('The published product changed. Reload it before preparing an edit.');
 const r=await c.query(`INSERT INTO catalog_proposals(id,store_id,batch_id,client_item_id,input_hash,details,provenance,actor,base_sku,base_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,version,state`,[p.id,storeId,p.batchId,p.clientItemId,inputHash,JSON.stringify(p.details),JSON.stringify(p.provenance),actor,p.base?.sku??null,p.base?.version??null]);return {...r.rows[0],replayed:false};
}
export async function listProposals(c:PoolClient,storeId:string,state='draft',limit=100){
 return (await c.query(`SELECT p.id,p.batch_id,p.client_item_id,p.details,p.provenance,p.base_sku,p.base_version,p.version,p.state,p.published_sku,p.created_at,p.updated_at,coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'sha256',a.sha256,'matchKind',a.match_kind,'width',a.width,'height',a.height) ORDER BY a.created_at,a.id) FROM catalog_proposal_assets a WHERE a.store_id=p.store_id AND a.proposal_id=p.id),'[]'::jsonb) AS assets FROM catalog_proposals p WHERE p.store_id=$1 AND p.state=$2 ORDER BY p.created_at,p.id LIMIT $3`,[storeId,state,Math.max(1,Math.min(200,limit))])).rows;
}
async function draft(c:PoolClient,storeId:string,id:string,version:number){
 const p=(await c.query("SELECT * FROM catalog_proposals WHERE store_id=$1 AND id=$2 FOR UPDATE",[storeId,id])).rows[0];
 if(!p)throw fail('Draft not found in this shop.',404);
 if(p.version!==version||p.state!=='draft')throw fail('This draft changed or was already reviewed. Reload before saving.');
 return p;
}
export async function updateProposal(c:PoolClient,storeId:string,input:unknown){
 const p=updateProposalSchema.parse(input);await draft(c,storeId,p.id,p.version);
 return (await c.query('UPDATE catalog_proposals SET details=$1,version=version+1,updated_at=now() WHERE store_id=$2 AND id=$3 RETURNING id,version,state',[JSON.stringify(p.details),storeId,p.id])).rows[0];
}
// Decode before taking the store lock. Original bytes and their hash survive
// normalization, publication and rejection for owner inspection and recovery.
export async function prepareProposalAsset(input:unknown){const p=proposalAssetSchema.parse(input);return {input:p,media:await normalizeImage(p.photo)};}
export async function addProposalAsset(c:PoolClient,storeId:string,p:z.infer<typeof proposalAssetSchema>,media:ImageMedia){
 await draft(c,storeId,p.proposalId,p.version);const bytes=Buffer.from(p.photo.data,'base64'),sha=createHash('sha256').update(bytes).digest('hex');
 const prior=(await c.query('SELECT id,match_kind FROM catalog_proposal_assets WHERE store_id=$1 AND proposal_id=$2 AND sha256=$3',[storeId,p.proposalId,sha])).rows[0];
 if(prior){if(prior.match_kind!==p.matchKind)throw fail('This image was already staged with a different identity assessment. Upload the exact product photo instead.');return {id:prior.id,version:p.version,replayed:true};}
 const count=(await c.query('SELECT count(*)::int AS n FROM catalog_proposal_assets WHERE store_id=$1 AND proposal_id=$2',[storeId,p.proposalId])).rows[0].n;if(count>=5)throw fail('Keep at most five photos in a product draft.',400);
 const id=randomUUID();await c.query('INSERT INTO catalog_proposal_assets(id,store_id,proposal_id,original,mime_type,sha256,image,width,height,match_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,storeId,p.proposalId,bytes,p.photo.mimeType,sha,media.image,media.width,media.height,p.matchKind]);
 const version=(await c.query('UPDATE catalog_proposals SET version=version+1,updated_at=now() WHERE store_id=$1 AND id=$2 RETURNING version',[storeId,p.proposalId])).rows[0].version;return {id,version,replayed:false};
}
export async function publishProposal(c:PoolClient,storeId:string,input:unknown){
 const p=publishProposalSchema.parse(input),row=await draft(c,storeId,p.id,p.version);
 if(!p.product.active)throw fail('Publishing requires an explicit visible product.',400);
 if(row.base_sku){if(p.product.sku!==row.base_sku||p.product.version!==row.base_version)throw fail('This edit must replace its original product version.');}
 else if(p.product.version!==0)throw fail('A new draft cannot overwrite an existing product.');
 if(p.assetId&&p.withoutPhoto)throw fail('Choose the exact photo or publish without a photo.',400);
 let asset;
 if(p.assetId){asset=(await c.query('SELECT * FROM catalog_proposal_assets WHERE store_id=$1 AND proposal_id=$2 AND id=$3',[storeId,p.id,p.assetId])).rows[0];if(!asset||asset.match_kind!=='exact')throw fail('Only an exact product photo from this draft can be published.',400);}
 else if(!row.base_sku&&!p.withoutPhoto)throw fail('Choose an exact photo or explicitly publish without a photo.',400);
 const saved=await saveCatalogProduct(c,storeId,p.product);
 if(asset){const id=await saveCatalogPhoto(c,storeId,asset);await c.query('UPDATE products SET image_path=$1 WHERE store_id=$2 AND sku=$3',['/catalog-images/custom/'+id+'.jpg',storeId,saved.sku]);}
 else if(p.withoutPhoto)await c.query('UPDATE products SET image_path=NULL WHERE store_id=$1 AND sku=$2',[storeId,saved.sku]);
 await c.query("UPDATE catalog_proposals SET state='published',published_sku=$1,version=version+1,updated_at=now() WHERE store_id=$2 AND id=$3",[saved.sku,storeId,p.id]);
 const revision=(await c.query('SELECT catalog_revision FROM stores WHERE id=$1',[storeId])).rows[0].catalog_revision;
 return {...saved,revision,proposalId:p.id,proposalVersion:p.version+1};
}
export async function rejectProposal(c:PoolClient,storeId:string,id:string,version:number){await draft(c,storeId,id,version);return (await c.query("UPDATE catalog_proposals SET state='rejected',version=version+1,updated_at=now() WHERE store_id=$1 AND id=$2 RETURNING id,version,state",[storeId,id])).rows[0];}

export async function catalogWrite<T>(pool:Pool,storeId:string,actor:string,action:string,targetId:string,run:(c:PoolClient)=>Promise<T>):Promise<T>{
 const c=await pool.connect();try{await c.query('BEGIN');if(!(await c.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE',[storeId])).rowCount)throw fail('Shop not found.',404);const result=await run(c);await c.query('INSERT INTO owner_audit(store_id,email,action,target_id,details) VALUES($1,$2,$3,$4,$5)',[storeId,actor,action,targetId,JSON.stringify(result)]);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
