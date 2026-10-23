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

export const variantRowSchema=z.object({id:z.uuid(),label:z.string().trim().max(55),size:z.string().trim().max(40),color:z.string().trim().max(40),
 pricePaise:z.number().int().positive().max(2147483647),stock:stock.nullable(),unit:sellingUnitSchema,
 packContents:sellingPolicySchema.shape.packContents}).strict();
export const variantLabel=(v:{label:string;size:string;color:string})=>[v.label,v.color,v.size].filter(Boolean).join(' · ');
export const variantBatchSchema=z.object({id:z.uuid(),name:z.string().trim().min(2).max(100),active:z.boolean().default(true),
 photo:imageUploadSchema.optional(),sourceProduct:z.object({sku:z.string().max(64),version:z.number().int().positive()}).strict().optional(),sourceLabel:z.string().trim().min(1).max(55).optional(),
 details:simpleProductSchema.shape.details.unwrap().default({}),variants:z.array(variantRowSchema).min(1).max(20)
}).strict().superRefine((p,ctx)=>{
 const labels=p.variants.map(variantLabel);
 if(labels.some(l=>!l||l.length>55)||new Set(labels.map(l=>l.toLowerCase().replace(/[\s·]+/g,''))).size!==labels.length||new Set(p.variants.map(v=>v.id)).size!==p.variants.length)
  ctx.addIssue({code:'custom',message:'Use unique variant labels up to 55 characters and unique row IDs.'});
});

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
  return write('catalog_product_simple',storeId,c=>saveSimpleProduct(c,storeId,p,media));
 });
 app.post('/api/owner/products/variants',{bodyLimit:3000000},async(req,reply)=>{
  const parsed=variantBatchSchema.safeParse(req.body);
  if(!parsed.success)return reply.code(400).send({error:'Check the product name and each variant’s size, price, stock and selling unit. Use distinct variant names.'});
  const p=parsed.data,inputHash=createHash('sha256').update(JSON.stringify(p)).digest('hex');
  if(!p.photo&&!p.sourceProduct)return reply.code(400).send({error:'Add a shared photo or choose an existing product photo.'});
  const media=p.photo?await normalizeImage(p.photo):undefined;
  if(media)media.variants=await prepareCatalogImageVariants(media.image);
  return write('catalog_product_variants',p.id,async c=>{
   const previous=(await c.query('SELECT input_hash,result FROM product_variant_batches WHERE store_id=$1 AND id=$2',[storeId,p.id])).rows[0];
   if(previous){if(previous.input_hash!==inputHash)throw invalid('This variant batch was already saved with different details. Reload before adding more.',409);return {...previous.result,replayed:true};}
   let source:any;
   if(p.sourceProduct){source=(await c.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2 FOR UPDATE',[storeId,p.sourceProduct.sku])).rows[0];
    if(!source||source.version!==p.sourceProduct.version)throw invalid('The source product changed. Reload before adding variants.',409);
   }
   const groupId=source?.product_group_id??p.id,groupName=source?.product_group_name??p.name;
   if(source?.product_group_id&&groupName!==p.name)throw invalid('Keep the shared product name when adding variants.',409);
   const labels=p.variants.map(v=>variantLabel(v));
   const existing=(await c.query('SELECT lower(variant_label) AS label FROM products WHERE store_id=$1 AND product_group_id=$2',[storeId,groupId])).rows;
   if(labels.some(label=>existing.some(r=>r.label.replace(/[\s·]+/g,'')===label.toLowerCase().replace(/[\s·]+/g,''))))throw invalid('A variant with this name already exists. Open it to update price or stock.',409);
   if(source&&!source.product_group_id){
    if(!p.sourceLabel)throw invalid('Enter a variant label for the existing product before adding variants.');
    if(labels.some(label=>label.toLowerCase().replace(/[\s·]+/g,'')===p.sourceLabel!.toLowerCase().replace(/[\s·]+/g,'')))throw invalid('A new variant duplicates the existing product.');
    const sourceName=groupName+' · '+p.sourceLabel;
    const localNames=Object.fromEntries(Object.entries(source.local_names??{}).filter(([,value])=>typeof value==='string'&&value).map(([lang,value])=>[lang,(value as string).slice(0,160-p.sourceLabel!.length-3)+' · '+p.sourceLabel]));
    await c.query('UPDATE products SET product_group_id=$3,product_group_name=$4,variant_label=$5,name=$6,local_names=$7,version=version+1 WHERE store_id=$1 AND sku=$2',[storeId,source.sku,groupId,groupName,p.sourceLabel,sourceName,JSON.stringify(localNames)]);
   }
   let imagePath=source?.image_path as string|undefined;
   if(media){const assetId=await saveCatalogPhoto(c,storeId,media);imagePath='/catalog-images/custom/'+assetId+'.jpg';}
   if(!imagePath||!(/^\/catalog-images\/custom\/[a-f0-9-]{36}\.jpg$/.test(imagePath)||/^\/demo-images\/H\d{2}\.jpg$/.test(imagePath)))throw invalid('Choose an exact product photo for these variants.');
   const products=[];
   for(const [i,v] of p.variants.entries()){
    const label=labels[i],specifications={...p.details.specifications};
    delete specifications.size;delete specifications.color;delete specifications.colour;
    if(v.size)specifications.size=v.size;
    if(v.color)specifications.color=v.color;
    const result=await saveSimpleProduct(c,storeId,{
     createId:v.id,name:groupName+' · '+label,pricePaise:v.pricePaise,unit:v.unit,quantityStep:1,stock:v.stock,active:p.active,
     details:{...p.details,aliases:[...new Set([groupName.slice(0,119-label.length)+' '+label,groupName.slice(0,119-label.length)+' '+label.replace(/(\d)\s+(ml|litre|liter|kg|g|mm|cm)\b/gi,'$1$2'),...(p.details.aliases??[])])].slice(0,40),localNames:Object.fromEntries(Object.entries(p.details.localNames??{}).filter(([,value])=>value).map(([lang,value])=>[lang,value!.slice(0,160-label.length-3)+' · '+label])),specifications:{...specifications,...(specifications.description?{description:(label+'. '+specifications.description).slice(0,120)}:{})},sellingPolicy:{saleMode:'pack',...(v.packContents?{packContents:v.packContents}:{}),cutAllowed:false,continuousLengthAvailable:null}}
    },undefined,imagePath);
    await c.query('UPDATE products SET product_group_id=$3,product_group_name=$4,variant_label=$5 WHERE store_id=$1 AND sku=$2',[storeId,result.sku,groupId,groupName,label]);
    products.push(result);
   }
   const result={groupId,groupName,products};
   await c.query('INSERT INTO product_variant_batches(store_id,id,input_hash,result) VALUES($1,$2,$3,$4)',[storeId,p.id,inputHash,JSON.stringify(result)]);
   return result;
  });
 });
}

async function saveSimpleProduct(c:PoolClient,storeId:string,p:z.infer<typeof simpleProductSchema>,media:Awaited<ReturnType<typeof normalizeImage>>|undefined,sharedImage?:string){
 const editing=!!p.sku,sku=p.sku??'SHOP-'+p.createId!.replaceAll('-','').slice(0,16).toUpperCase();
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
    const samePhoto=sharedImage?prior.image_path===sharedImage:!!photoId&&!!hash&&(await c.query('SELECT 1 FROM catalog_photos WHERE store_id=$1 AND id=$2 AND content_hash=$3',[storeId,photoId,hash])).rowCount===1;
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
   const imagePath=sharedImage??(media?undefined:prior?.image_path as string|undefined);
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
}
