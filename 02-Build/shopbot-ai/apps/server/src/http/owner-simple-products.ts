import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {FastifyInstance} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {sellingPolicySchema,sellingUnitSchema} from '../../../../packages/contracts/selling-units.js';
import {sellingBasisIssues} from '../../../../packages/contracts/selling-basis.js';
import {saveCatalogProduct} from '../services/catalog-products.js';
import {saveCatalogPhoto} from '../services/catalog-photos.js';
import {prepareCatalogImageVariants} from '../services/catalog-image-variants.js';
import {imageUploadSchema,normalizeImage} from '../services/image-media.js';

type Write=(action:string,target:string,run:(client:PoolClient)=>Promise<unknown>)=>Promise<unknown>;
const invalid=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const words=z.array(z.string().trim().min(1).max(120)).max(40);
const names=z.object({ta:z.string().trim().max(160).optional(),'ta-Latn':z.string().trim().max(160).optional()}).strict();
const stock=z.number().nonnegative().max(999999999).refine(n=>Math.abs(n*1000-Math.round(n*1000))<1e-7);
export const simpleProductSchema=z.object({
 createId:z.uuid().optional(),sku:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/).optional(),
 version:z.number().int().positive().optional(),inventoryVersion:z.number().int().positive().optional(),
 name:z.string().trim().min(2).max(160),pricePaise:z.number().int().positive().max(2147483647),
 unit:sellingUnitSchema,quantityStep:z.number().positive().max(100).optional(),
 stock:stock.nullable().optional(),photo:imageUploadSchema.optional(),active:z.boolean().optional(),
 details:z.object({familyId:z.string().max(80).optional(),brand:z.string().trim().max(100).optional(),
  localNames:names.optional(),aliases:words.optional(),keywords:words.optional(),
  specifications:z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),z.string().trim().min(1).max(120)).refine(s=>Object.keys(s).length<=20).optional(),
  sellingPolicy:sellingPolicySchema.optional()}).strict().optional()
}).strict();

export function registerOwnerSimpleProducts(app:FastifyInstance,_pool:Pool,storeId:string,write:Write){
 app.post('/api/owner/store/details',async(req,reply)=>{
  const parsed=z.object({name:z.string().trim().min(2).max(120),expectedName:z.string().min(1).max(120)}).strict().safeParse(req.body);
  if(!parsed.success)return reply.code(400).send({error:'Enter a shop name between 2 and 120 characters.'});
  return write('store_details',storeId,async c=>{
   const row=(await c.query('UPDATE stores SET name=$2 WHERE id=$1 AND name=$3 RETURNING name',[storeId,parsed.data.name,parsed.data.expectedName])).rows[0];
   if(!row)throw invalid('The shop name changed. Reload before saving.',409);
   return {name:row.name};
  });
 });
 app.post('/api/owner/products/simple',{bodyLimit:2904000},async(req,reply)=>{
  const parsed=simpleProductSchema.safeParse(req.body);
  if(!parsed.success)return reply.code(400).send({error:'Add a product photo, name, selling unit and price. Check the entered fields.'});
  const p=parsed.data,editing=!!p.sku;
  if(editing!==!!p.version||!editing&&!p.createId)return reply.code(400).send({error:'Reload the product before editing, or use a new product ID.'});
  if(!editing&&!p.photo)return reply.code(400).send({error:'Add an exact product photo before saving.'});
  if(editing&&Object.hasOwn(p,'stock')&&!p.inventoryVersion)return reply.code(400).send({error:'Reload the stock count before changing it.'});
  // Decoding and resizing happen before the transaction. Only normalized bytes
  // reach the public catalog; arbitrary URLs or filenames are never fetched.
  const media=p.photo?await normalizeImage(p.photo):undefined;
  if(media)media.variants=await prepareCatalogImageVariants(media.image);
  const sku=p.sku??'SHOP-'+p.createId!.replaceAll('-','').slice(0,16).toUpperCase();
  return write('catalog_product_simple',storeId,async c=>{
   const prior=(await c.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2 FOR UPDATE',[storeId,sku])).rows[0];
   if(editing&&(!prior||prior.version!==p.version))throw invalid('This product changed. Reload before saving.',409);
   if(!editing&&prior){
    const same=prior.catalog_origin==='owner'&&prior.name===p.name&&prior.price_paise===p.pricePaise&&prior.unit===p.unit&&Number(prior.quantity_step)===(p.quantityStep??1)&&prior.active===(p.active??true)&&
     (!Object.hasOwn(p,'stock')||prior.stock===null&&p.stock===null||prior.stock!==null&&Number(prior.stock)===p.stock)&&
     (!p.details?.familyId||prior.family_id===p.details.familyId)&&(!Object.hasOwn(p.details??{},'brand')||(prior.brand??'')===p.details?.brand)&&
     (!p.details?.specifications||isDeepStrictEqual(prior.specifications,p.details.specifications))&&
     (!p.details?.localNames||isDeepStrictEqual(prior.local_names,p.details.localNames))&&
     (!p.details?.aliases||isDeepStrictEqual(prior.aliases,[...new Set([...p.details.aliases,...Object.values(p.details.localNames??{}).filter(Boolean)])]))&&
     (!p.details?.keywords||isDeepStrictEqual(prior.keywords,p.details.keywords))&&
     (!p.details?.sellingPolicy||isDeepStrictEqual(prior.selling_policy,p.details.sellingPolicy));
    const photoId=/^\/catalog-images\/custom\/([a-f0-9-]{36})\.jpg$/.exec(prior.image_path??'')?.[1];
    const hash=media&&createHash('sha256').update(media.image).digest('hex');
    const samePhoto=!!photoId&&!!hash&&(await c.query('SELECT 1 FROM catalog_photos WHERE store_id=$1 AND id=$2 AND content_hash=$3',[storeId,photoId,hash])).rowCount===1;
    if(same&&samePhoto)return {sku,version:prior.version,inventoryVersion:prior.inventory_version,active:prior.active,
     stock:prior.stock===null?null:Number(prior.stock),imageUrl:prior.image_path,replayed:true};
    throw invalid('This product was already created with different details. Reload it before saving.',409);
   }
   if(prior&&Object.hasOwn(p,'stock')&&prior.inventory_version!==p.inventoryVersion)throw invalid('Stock changed. Reload the count before saving.',409);
   const details=p.details??{},active=p.active??(prior?.active??true);
   const policy=details.sellingPolicy??prior?.selling_policy??{cutAllowed:false,continuousLengthAvailable:null};
   const specifications=details.specifications??prior?.specifications??{};
   const issues=sellingBasisIssues({name:p.name,unit:p.unit,specifications,sellingPolicy:policy});
   if(issues.length)throw invalid(issues.join(' '));
   const imagePath=media?undefined:prior?.image_path as string|undefined;
   const exactPhoto=!!media||!!imagePath&&(/^\/catalog-images\/custom\/[a-f0-9-]{36}\.jpg$/.test(imagePath)||/^\/demo-images\/H\d{2}\.jpg$/.test(imagePath));
   if(active&&!exactPhoto)throw invalid('Choose an exact product photo before showing this item in the shop.');
   const onHand=Object.hasOwn(p,'stock')?p.stock!:prior?.stock===null?null:prior?Number(prior.stock):null;
   const verification={identity:true,photo:exactPhoto,sellingUnit:true,price:true,stock:true};
   const saved=await saveCatalogProduct(c,storeId,{
    sku,createId:p.createId,version:p.version??0,inventoryVersion:p.inventoryVersion??(prior?.inventory_version??1),
    name:p.name,localNames:details.localNames??prior?.local_names??{},
    aliases:details.aliases??prior?.aliases??[],keywords:details.keywords??prior?.keywords??[],
    unit:p.unit,priceStatus:'priced',pricePaise:p.pricePaise,stock:onHand,quantityStep:p.quantityStep??Number(prior?.quantity_step??1),
    familyId:details.familyId??prior?.family_id??'',brand:details.brand??prior?.brand??'',
    specifications,active,verified:active&&exactPhoto,verification,sellingPolicy:policy
   });
   let finalImagePath=imagePath??null;
   if(media){const assetId=await saveCatalogPhoto(c,storeId,media);finalImagePath='/catalog-images/custom/'+assetId+'.jpg';
    await c.query('UPDATE products SET image_path=$3 WHERE store_id=$1 AND sku=$2',[storeId,sku,finalImagePath]);}
   const row=(await c.query('SELECT sku,version,inventory_version,active,stock FROM products WHERE store_id=$1 AND sku=$2',[storeId,sku])).rows[0];
   return {sku:row.sku,version:row.version,inventoryVersion:row.inventory_version,active:row.active,
    stock:row.stock===null?null:Number(row.stock),imageUrl:finalImagePath,revision:saved.revision};
  });
 });
}
