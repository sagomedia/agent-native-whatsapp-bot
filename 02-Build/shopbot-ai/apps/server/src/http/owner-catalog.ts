import type {FastifyInstance} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {loadSuggestionPhoto} from '../services/catalog-photos.js';
import {z} from 'zod';
import {imageUploadSchema,normalizeImage} from '../services/image-media.js';
import {catalogDraftDetailsSchema,generateCatalogDraft,type CatalogGenerator} from '../services/catalog-assistant.js';
import {discoverProducts,getCatalogMap} from '../services/catalog-discovery.js';
import {productColumns,productFromRow} from '../services/catalog.js';

type Write=(action:string,target:string,run:(client:PoolClient)=>Promise<unknown>)=>Promise<unknown>;
const words=z.array(z.string().trim().min(1).max(120)).max(40);
const names=z.object({ta:z.string().trim().max(160).optional(),'ta-Latn':z.string().trim().max(160).optional()}).strict();
export const ownerProductSchema=z.object({sku:z.string().regex(/^(?:[A-Za-z0-9][A-Za-z0-9_-]{0,63})?$/).default(''),createId:z.uuid().optional(),newType:z.object({label:z.string().trim().min(2).max(160),localNames:names,departmentId:z.string().max(80).nullable()}).strict().optional(),version:z.number().int().nonnegative(),name:z.string().trim().min(2).max(160),localNames:names,aliases:words,keywords:words,unit:z.enum(['piece','box','pack','pair','roll','bottle','can','metre','foot','kg','litre']),priceStatus:z.enum(['priced','confirm','free']).optional(),pricePaise:z.number().int().nonnegative().max(2147483647),stock:z.number().int().nonnegative().max(2147483647).nullable(),quantityStep:z.number().positive().max(100).refine(n=>Math.abs(n*1000-Math.round(n*1000))<1e-7),familyId:z.string().max(80).default(''),brand:z.string().trim().max(100),specifications:z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),z.string().trim().min(1).max(120)).refine(s=>Object.keys(s).length<=20),active:z.boolean(),verified:z.boolean()}).strict();
export async function registerOwnerCatalog(app:FastifyInstance,pool:Pool,storeId:string,write:Write,generator?:CatalogGenerator){
 app.get('/api/owner/catalog',async()=>{
  const client=await pool.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const rows=(await client.query(`SELECT ${productColumns},active,catalog_origin,inventory_updated_at FROM products WHERE store_id=$1 ORDER BY name,sku`,[storeId])).rows;
   const nodes=(await client.query('SELECT id,parent_id,kind,label,local_names,aliases FROM catalog_nodes WHERE store_id=$1 ORDER BY kind,label',[storeId])).rows;
   const revision=(await client.query('SELECT catalog_revision FROM stores WHERE id=$1',[storeId])).rows[0].catalog_revision;
   await client.query('COMMIT');return {revision,aiAvailable:!!generator,products:rows.map(p=>({...productFromRow(p),active:p.active,origin:p.catalog_origin,inventoryUpdatedAt:p.inventory_updated_at})),nodes};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 });
 app.post('/api/owner/catalog/diagnose',async(req,reply)=>{
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
  const image=parsed.data.photo?await normalizeImage(parsed.data.photo):stored;
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
  return write('catalog_product',storeId,async c=>{
   if(p.newType&&p.familyId)throw Object.assign(new Error('Choose one product type.'),{statusCode:400});
   if(!p.familyId){
    let departmentId=p.newType?.departmentId??'owner-general';
    if(p.newType?.departmentId){if(!(await c.query("SELECT 1 FROM catalog_nodes WHERE store_id=$1 AND id=$2 AND kind='department'",[storeId,departmentId])).rowCount)throw Object.assign(new Error('Choose a valid department.'),{statusCode:400});}
    else await c.query("INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,local_names,aliases) VALUES($1,'owner-general',NULL,'department','Shop products','{}','[]') ON CONFLICT DO NOTHING",[storeId]);
    if(p.newType){
     const existing=(await c.query("SELECT id FROM catalog_nodes WHERE store_id=$1 AND parent_id=$2 AND kind='family' AND lower(label)=lower($3) ORDER BY id LIMIT 1",[storeId,departmentId,p.newType.label])).rows[0];
     p.familyId=existing?.id??'type-'+randomUUID().slice(0,12);
     if(!existing)await c.query("INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,local_names,aliases) VALUES($1,$2,$3,'family',$4,$5,$6)",[storeId,p.familyId,departmentId,p.newType.label,JSON.stringify(p.newType.localNames),JSON.stringify([p.newType.label,...Object.values(p.newType.localNames).filter(Boolean)])]);
    }else{p.familyId='owner-other';await c.query("INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,local_names,aliases) VALUES($1,'owner-other','owner-general','family','Other products','{}','[]') ON CONFLICT DO NOTHING",[storeId]);}
   }
   if(!(await c.query("SELECT 1 FROM catalog_nodes WHERE store_id=$1 AND id=$2 AND kind='family'",[storeId,p.familyId])).rowCount)throw Object.assign(new Error('Choose a valid product type.'),{statusCode:400});
   const params=[storeId,p.sku,p.name,p.unit,p.pricePaise,p.stock,JSON.stringify(p.localNames),JSON.stringify([...new Set([...p.aliases,...Object.values(p.localNames).filter(Boolean)])]),p.quantityStep,p.familyId,p.brand||null,JSON.stringify(p.specifications),JSON.stringify(p.keywords),p.active];
   let row;
   if(p.version===0)row=await c.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,stock,local_names,aliases,quantity_step,family_id,brand,specifications,keywords,active,catalog_origin,inventory_updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'owner',now()) ON CONFLICT DO NOTHING RETURNING sku,version`,params);
   else row=await c.query(`UPDATE products SET name=$3,unit=$4,price_paise=$5,stock=$6,local_names=$7,aliases=$8,quantity_step=$9,family_id=$10,brand=$11,specifications=$12,keywords=$13,active=$14,catalog_origin='owner',inventory_updated_at=now(),version=version+1 WHERE store_id=$1 AND sku=$2 AND version=$15 RETURNING sku,version`,[...params,p.version]);
   if(!row.rowCount)throw Object.assign(new Error('This product changed or its code already exists. Reload before saving.'),{statusCode:409});
   await c.query('INSERT INTO store_policies(store_id,require_product_confirmation) VALUES($1,true) ON CONFLICT(store_id) DO UPDATE SET require_product_confirmation=true',[storeId]);
   await c.query("INSERT INTO catalog_profiles(store_id,store_type) VALUES($1,'general retail') ON CONFLICT DO NOTHING",[storeId]);
   await c.query('UPDATE products SET price_status=$1,selling_unit_verified=$2 WHERE store_id=$3 AND sku=$4',[priceStatus,p.verified,storeId,p.sku]);
   const revision=(await c.query('SELECT catalog_revision FROM stores WHERE id=$1',[storeId])).rows[0].catalog_revision;
   return {...row.rows[0],active:p.active,familyId:p.familyId,revision};
  });
 });
 app.post<{Params:{sku:string}}>('/api/owner/catalog/products/:sku/photo',{bodyLimit:2900000},async(req,reply)=>{
  const parsed=imageUploadSchema.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'Choose a JPG, PNG or WebP photo under 2 MB.'});
  const version=Number(req.headers['x-product-version']);if(!Number.isInteger(version)||version<1)return reply.code(400).send({error:'Reload the product before adding a photo.'});
  // Validate access before decoding; normalized photos are versioned immutable public assets.
  if(!(await pool.query('SELECT 1 FROM products WHERE store_id=$1 AND sku=$2 AND version=$3',[storeId,req.params.sku,version])).rowCount)return reply.code(409).send({error:'Product changed. Reload before adding a photo.'});
  const media=await normalizeImage(parsed.data),assetId=randomUUID();
  return write('catalog_photo',storeId,async c=>{
   const path='/catalog-images/custom/'+assetId+'.jpg';
   const row=await c.query('UPDATE products SET image_path=$1,active=false,inventory_updated_at=now(),version=version+1 WHERE store_id=$2 AND sku=$3 AND version=$4 RETURNING version',[path,storeId,req.params.sku,version]);
   if(!row.rowCount)throw Object.assign(new Error('Product changed. Reload before adding a photo.'),{statusCode:409});
   await c.query('INSERT INTO catalog_photos(id,store_id,image,width,height) VALUES($1,$2,$3,$4,$5)',[assetId,storeId,media.image,media.width,media.height]);return {sku:req.params.sku,version:row.rows[0].version,imageUrl:path,active:false};
  });
 });
}
