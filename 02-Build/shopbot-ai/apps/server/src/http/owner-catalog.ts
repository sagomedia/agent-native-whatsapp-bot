import {adjustStock,stockActionSchema} from '../services/inventory.js';
import type {FastifyInstance} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {loadSuggestionPhoto,saveCatalogPhoto} from '../services/catalog-photos.js';
import {z} from 'zod';
import {imageUploadSchema,normalizeCatalogImage} from '../services/image-media.js';
import {catalogDraftDetailsSchema,generateCatalogDraft,type CatalogGenerator} from '../services/catalog-assistant.js';
import {discoverProducts,getCatalogMap} from '../services/catalog-discovery.js';
import {productPageSchema,proposalPageSchema,ownerProductPage,ownerProposalPage,selectedOwnerProduct,selectedOwnerProposal} from './owner-catalog-pages.js';
import {bulkCatalogStatus} from '../services/catalog-bulk.js';
import {createProposalSchema,updateProposalSchema,publishProposalSchema,createProposal,updateProposal,prepareProposalAsset,addProposalAsset,publishProposal,rejectProposal} from '../services/catalog-proposals.js';

type Write=(action:string,target:string,run:(client:PoolClient)=>Promise<unknown>)=>Promise<unknown>;
import {ownerProductSchema,saveCatalogProduct} from '../services/catalog-products.js';
import {catalogImageSize,prepareCatalogImageVariants,sendOwnerCatalogImage} from '../services/catalog-image-variants.js';
export {ownerProductSchema} from '../services/catalog-products.js';
const words=z.array(z.string().trim().min(1).max(120)).max(40);
const names=z.object({ta:z.string().trim().max(160).optional(),'ta-Latn':z.string().trim().max(160).optional()}).strict();
export async function registerOwnerCatalog(app:FastifyInstance,pool:Pool,storeId:string,write:Write,generator?:CatalogGenerator){
 async function read<T>(run:(c:PoolClient)=>Promise<T>){const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await run(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 app.get('/api/owner/catalog/proposals',async(req,reply)=>{const parsed=proposalPageSchema.safeParse(req.query);if(!parsed.success)return reply.code(400).send({error:'Check the draft search and page size (1–100).'});return read(c=>ownerProposalPage(c,storeId,parsed.data));});
 app.get<{Params:{id:string}}>('/api/owner/catalog/proposals/:id',async(req,reply)=>{if(!z.uuid().safeParse(req.params.id).success)return reply.code(404).send({error:'Draft not found.'});return read(async c=>({proposal:await selectedOwnerProposal(c,storeId,req.params.id)}));});
 app.get<{Params:{sku:string}}>('/api/owner/catalog/products/:sku',async req=>read(async c=>({product:await selectedOwnerProduct(c,storeId,req.params.sku)})));
 app.get('/api/owner/catalog/intake',async()=>({batches:(await pool.query('SELECT b.batch_id,b.source_hash,b.created_at,(SELECT count(*)::int FROM catalog_intake_items i WHERE i.store_id=b.store_id AND i.batch_id=b.batch_id) AS total FROM catalog_intake_batches b WHERE b.store_id=$1 ORDER BY b.created_at DESC,b.batch_id LIMIT 25',[storeId])).rows,limit:25}));
 app.get<{Params:{batch:string};Querystring:{cursor?:string;limit?:string}}>('/api/owner/catalog/intake/:batch',async(req,reply)=>{const parsed=z.object({cursor:z.string().max(100).default(''),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict().safeParse(req.query);if(!parsed.success)return reply.code(400).send({error:'Check the intake page size (1–100).'});if(!(await pool.query('SELECT 1 FROM catalog_intake_batches WHERE store_id=$1 AND batch_id=$2',[storeId,req.params.batch])).rowCount)return reply.code(404).send({error:'Import batch not found in this shop.'});return bulkCatalogStatus(pool,storeId,req.params.batch,parsed.data.cursor,parsed.data.limit);});
 app.post('/api/owner/catalog/proposals',async(req,reply)=>{const p=createProposalSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:'Check the draft fields.'});return write('catalog_draft',p.data.id,c=>createProposal(c,storeId,'owner-dashboard',p.data));});
 app.post('/api/owner/catalog/proposals/update',async(req,reply)=>{const p=updateProposalSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:'Check the draft and its version.'});return write('catalog_draft_edit',p.data.id,c=>updateProposal(c,storeId,p.data));});
 app.post('/api/owner/catalog/proposals/photo',{bodyLimit:2904000},async(req,reply)=>{let prepared;try{prepared=await prepareProposalAsset(req.body);}catch{return reply.code(400).send({error:'Choose a valid draft and JPG, PNG or WebP photo under 2 MB.'});}return write('catalog_draft_photo',prepared.input.proposalId,c=>addProposalAsset(c,storeId,prepared.input,prepared.media));});
 app.get<{Params:{id:string;asset:string};Querystring:{original?:string;size?:string}}>('/api/owner/catalog/proposals/:id/photos/:asset',async(req,reply)=>{
  if(!z.uuid().safeParse(req.params.id).success||!z.uuid().safeParse(req.params.asset).success)return reply.code(404).send();
  const size=catalogImageSize(req.query.size),original=req.query.original==='1';
  // Select one representation; preview requests never retrieve original bytes.
  const row=original?(await pool.query('SELECT original AS image,mime_type FROM catalog_proposal_assets WHERE store_id=$1 AND proposal_id=$2 AND id=$3',[storeId,req.params.id,req.params.asset])).rows[0]
   :(await pool.query(`SELECT COALESCE(v.image,a.image) AS image FROM catalog_proposal_assets a LEFT JOIN catalog_image_variants v ON v.store_id=a.store_id AND v.source_hash=a.image_hash AND v.max_side=$4 WHERE a.store_id=$1 AND a.proposal_id=$2 AND a.id=$3`,[storeId,req.params.id,req.params.asset,size??null])).rows[0];
  if(!row)return reply.code(404).send();
  // Uploaded originals can retain private source metadata; only normalized previews revalidate.
  if(original)return reply.header('Cache-Control','private, no-store').type(row.mime_type).send(row.image);
  return sendOwnerCatalogImage(req,reply,row.image);
 });
 app.post('/api/owner/catalog/proposals/publish',async(req,reply)=>{const p=publishProposalSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:'Complete the product fields and merchant confirmations.'});return write('catalog_publish',p.data.id,c=>publishProposal(c,storeId,p.data));});
 app.post('/api/owner/catalog/proposals/reject',async(req,reply)=>{const p=z.object({id:z.uuid(),version:z.number().int().positive()}).strict().safeParse(req.body);if(!p.success)return reply.code(400).send({error:'Reload the draft before rejecting it.'});return write('catalog_reject',p.data.id,c=>rejectProposal(c,storeId,p.data.id,p.data.version));});
 app.get('/api/owner/catalog',async(req,reply)=>{const parsed=productPageSchema.safeParse(req.query);if(!parsed.success)return reply.code(400).send({error:'Check the product search, filters and page size (1–100).'});return read(async c=>{const page=await ownerProductPage(c,storeId,parsed.data);const nodes=(await c.query(parsed.data.metadata==='compact'?'SELECT id,kind,label FROM catalog_nodes WHERE store_id=$1 ORDER BY kind,label':'SELECT id,parent_id,kind,label,local_names,aliases FROM catalog_nodes WHERE store_id=$1 ORDER BY kind,label',[storeId])).rows;return {...page,aiAvailable:!!generator,nodes};});});
 app.post<{Params:{sku:string}}>('/api/owner/catalog/products/:sku/stock',async(req,reply)=>{
  const p=stockActionSchema.safeParse(req.body);if(!p.success)return reply.code(400).send({error:'Enter a stock action, quantity, reason and current stock version.'});
  return write('inventory_'+p.data.kind,storeId,c=>adjustStock(c,storeId,req.params.sku,'owner-dashboard',p.data));
 });
 app.get<{Params:{sku:string}}>('/api/owner/catalog/products/:sku/stock',async(req)=>({movements:(await pool.query('SELECT id,kind,on_hand_before,on_hand_after,reserved_before,reserved_after,actor,reason,request_id,inventory_version,created_at FROM inventory_movements WHERE store_id=$1 AND sku=$2 ORDER BY created_at DESC,id DESC LIMIT 50',[storeId,req.params.sku])).rows}));
 app.post('/api/owner/catalog/diagnose' ,async(req,reply)=>{
  const input=z.object({query:z.string().trim().min(1).max(200)}).strict().safeParse(req.body);
  if(!input.success)return reply.code(400).send({error:'Enter a short customer product phrase.'});
  const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const ctx={storeId,conversationId:storeId,actor:'owner-diagnostic',role:'customer' as const};
   const [map,result]=await Promise.all([getCatalogMap(c,ctx),discoverProducts(c,ctx,input.data.query)]);
   const hidden=(await c.query('SELECT sku,name FROM products WHERE store_id=$1 AND active=false AND (name ILIKE $2 OR aliases::text ILIKE $2) LIMIT 5',[storeId,'%'+input.data.query+'%'])).rows;
   await c.query('COMMIT');return {revision:map.revision,query:result.query,products:result.products.map(p=>({...p,issues:[...(p.stock===0?['No stock recorded']:[]),...(p.priceStatus==='confirm'?['Shop must confirm price']:[]),...(!p.sellingUnitVerified&&/\d\s*(?:l|litre|liter|kg)\b/i.test(p.name)?['Verify selling unit and pack size']:[])]})),hidden,noExactMatch:result.noExactMatch,totalCount:result.totalCount};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 });
 app.post('/api/owner/catalog/nodes' ,async(req,reply)=>{
  const parsed=z.object({id:z.string().regex(/^[a-z][a-z0-9-]{1,79}$/),kind:z.enum(['department','family']),parentId:z.string().max(80).nullable(),label:z.string().trim().min(2).max(120),localNames:names,aliases:words}).strict().safeParse(req.body);
  if(!parsed.success)return reply.code(400).send({error:'Check the category name and aliases.'});const n=parsed.data;
  if(n.kind==='department'&&n.parentId||n.kind==='family'&&!n.parentId)return reply.code(400).send({error:'Choose a department for the product type.'});
  return write('catalog_category',storeId,async c=>{
   if(n.kind==='family'&&!(await c.query("SELECT 1 FROM catalog_nodes WHERE store_id=$1 AND id=$2 AND kind='department'",[storeId,n.parentId])).rowCount)throw Object.assign(new Error('Department not found.'),{statusCode:400});
   const r=await c.query('INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,local_names,aliases) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id',[storeId,n.id,n.parentId,n.kind,n.label,JSON.stringify(n.localNames),JSON.stringify(n.aliases)]);
   if(!r.rowCount)throw Object.assign(new Error('That category code already exists.'),{statusCode:409});
   await c.query("INSERT INTO catalog_profiles(store_id,store_type) VALUES($1,'general retail') ON CONFLICT DO NOTHING",[storeId]);return {id:n.id};
  });
 });
 app.post('/api/owner/catalog/suggest',{bodyLimit:2904000},async(req,reply)=>{
  if(!generator)return reply.code(503).send({error:'AI suggestions are not connected. You can enter the product manually.'});
  const parsed=z.object({id:z.uuid(),description:z.string().trim().max(1200).default(''),details:catalogDraftDetailsSchema.optional(),existingProduct:z.object({sku:z.string().min(1).max(64),version:z.number().int().positive()}).strict().optional(),photo:imageUploadSchema.optional()}).strict().safeParse(req.body);
  if(!parsed.success||!parsed.data.description&&!parsed.data.details?.name&&!parsed.data.existingProduct&&!parsed.data.photo)return reply.code(400).send({error:'Add a name, short description or exact product photo.'});
  // Resolve only a product belonging to this authenticated shop; never fetch a client URL.
  const stored=parsed.data.existingProduct?await loadSuggestionPhoto(pool,storeId,parsed.data.existingProduct.sku,parsed.data.existingProduct.version,!parsed.data.photo):undefined;
  const image=parsed.data.photo?await normalizeCatalogImage(parsed.data.photo):stored;
  if(!image&&!parsed.data.description&&!parsed.data.details?.name)return reply.code(400).send({error:'Add a product name or photo before auto-filling.'});
  const nodes=(await pool.query('SELECT id,parent_id,kind,label FROM catalog_nodes WHERE store_id=$1 ORDER BY kind,id',[storeId])).rows;
  return generateCatalogDraft(pool,storeId,parsed.data.id,{description:parsed.data.description,details:parsed.data.details,image,nodes},generator);
 });
 app.post('/api/owner/catalog/products',async(req,reply)=>{
  const parsed=ownerProductSchema.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'Check the product fields, price and quantity step.'});const p=parsed.data;if(p.version>0&&!p.sku)return reply.code(400).send({error:'Reload the product before editing.'});if(!p.sku)p.sku='SHOP-'+(p.createId??randomUUID()).replaceAll('-','').slice(0,16).toUpperCase();
  if(p.active&&!p.verified)return reply.code(400).send({error:'Verify the product name, unit, price and photo before publishing.'});
  const priceStatus=p.priceStatus??(p.pricePaise>0?'priced':'confirm');
  if(priceStatus==='free'&&p.pricePaise!==0||priceStatus==='priced'&&p.pricePaise===0)return reply.code(400).send({error:'Choose price to confirm or explicitly confirm this item is free.'});
  const physical=Object.values(p.specifications).join(' ');
  if(p.active&&(/\d\s*kg\b/i.test(physical)&&p.unit==='litre'||/\d\s*(?:l|litres?|liters?)\b/i.test(physical)&&p.unit==='kg'))return reply.code(400).send({error:'Pack weight and volume must agree with the selling unit.'});
  return write('catalog_product',storeId,c=>saveCatalogProduct(c,storeId,p));
 });
 app.post<{Params:{sku:string}}>('/api/owner/catalog/products/:sku/hide',async(req,reply)=>{
  const p=z.object({version:z.number().int().positive()}).strict().safeParse(req.body);if(!p.success)return reply.code(400).send({error:'Reload the product before hiding it.'});
  return write('catalog_hide',storeId,async c=>{const row=(await c.query('UPDATE products SET active=false,version=version+1,inventory_updated_at=now() WHERE store_id=$1 AND sku=$2 AND version=$3 RETURNING sku,version,active',[storeId,req.params.sku,p.data.version])).rows[0];if(!row)throw Object.assign(new Error('The product changed. Reload it before hiding.'),{statusCode:409});return row;});
 });
 app.post<{Params:{sku:string}}>('/api/owner/catalog/products/:sku/photo',{bodyLimit:2900000},async(req,reply)=>{
  const parsed=imageUploadSchema.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'Choose a JPG, PNG or WebP photo under 2 MB.'});
  const version=Number(req.headers['x-product-version']);if(!Number.isInteger(version)||version<1)return reply.code(400).send({error:'Reload the product before adding a photo.'});
  // Validate access before decoding; normalized photos are versioned immutable public assets.
  if(!(await pool.query('SELECT 1 FROM products WHERE store_id=$1 AND sku=$2 AND version=$3',[storeId,req.params.sku,version])).rowCount)return reply.code(409).send({error:'Product changed. Reload before adding a photo.'});
  const media=await normalizeCatalogImage(parsed.data);
  media.variants=await prepareCatalogImageVariants(media.image);
  return write('catalog_photo',storeId,async c=>{
   const assetId=await saveCatalogPhoto(c,storeId,media);
   const path='/catalog-images/custom/'+assetId+'.jpg';
   const row=await c.query("UPDATE products SET image_path=$1,active=false,merchant_verification=jsonb_set(merchant_verification,'{photo}','false'),inventory_updated_at=now(),version=version+1 WHERE store_id=$2 AND sku=$3 AND version=$4 RETURNING version",[path,storeId,req.params.sku,version]);
   if(!row.rowCount)throw Object.assign(new Error('Product changed. Reload before adding a photo.'),{statusCode:409});
   return {sku:req.params.sku,version:row.rows[0].version,imageUrl:path,active:false};
  });
 });
}
