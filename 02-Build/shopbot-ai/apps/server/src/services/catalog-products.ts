import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {sellingUnitSchema,merchantVerificationSchema,sellingPolicySchema} from '../../../../packages/contracts/selling-units.js';
const words=z.array(z.string().trim().min(1).max(120)).max(40);
const names=z.object({ta:z.string().trim().max(160).optional(),'ta-Latn':z.string().trim().max(160).optional()}).strict();
export const ownerProductSchema=z.object({sku:z.string().regex(/^(?:[A-Za-z0-9][A-Za-z0-9_-]{0,63})?$/).default(''),createId:z.uuid().optional(),newType:z.object({label:z.string().trim().min(2).max(160),localNames:names,departmentId:z.string().max(80).nullable()}).strict().optional(),version:z.number().int().nonnegative(),name:z.string().trim().min(2).max(160),localNames:names,aliases:words,keywords:words,unit:sellingUnitSchema,priceStatus:z.enum(['priced','confirm','free']).optional(),pricePaise:z.number().int().nonnegative().max(2147483647),stock:z.number().int().nonnegative().max(2147483647).nullable(),quantityStep:z.number().positive().max(100).refine(n=>Math.abs(n*1000-Math.round(n*1000))<1e-7),familyId:z.string().max(80).default(''),brand:z.string().trim().max(100),specifications:z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),z.string().trim().min(1).max(120)).refine(s=>Object.keys(s).length<=20),active:z.boolean(),verified:z.boolean(),verification:merchantVerificationSchema.optional(),sellingPolicy:sellingPolicySchema.optional()}).strict();

const invalid=(message:string)=>Object.assign(new Error(message),{statusCode:400});
export async function saveCatalogProduct(c:PoolClient,storeId:string,input:unknown){
 const p=ownerProductSchema.parse(input);
 if(p.version>0&&!p.sku)throw invalid('Reload the product before editing.');
 if(!p.sku)p.sku='SHOP-'+(p.createId??randomUUID()).replaceAll('-','').slice(0,16).toUpperCase();
 if(p.active&&(!p.verified||!p.verification||!Object.values(p.verification).every(Boolean)))throw invalid('Confirm identity, photo, selling unit, price status and stock status before publishing.');
 const priceStatus=p.priceStatus??(p.pricePaise>0?'priced':'confirm');
 if(priceStatus==='free'&&p.pricePaise!==0||priceStatus==='priced'&&p.pricePaise===0)throw invalid('Choose price to confirm or explicitly confirm this item is free.');
 const physical=Object.values(p.specifications).join(' ');
 if(p.active&&(/\d\s*kg\b/i.test(physical)&&p.unit==='litre'||/\d\s*(?:l|litres?|liters?)\b/i.test(physical)&&p.unit==='kg'))throw invalid('Pack weight and volume must agree with the selling unit.');
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
   await c.query('UPDATE products SET price_status=$1,selling_unit_verified=$2,merchant_verification=$5::jsonb,selling_policy=$6::jsonb WHERE store_id=$3 AND sku=$4',[priceStatus,p.verification?.sellingUnit===true,storeId,p.sku,JSON.stringify(p.verification??{identity:false,photo:false,sellingUnit:false,price:false,stock:false}),JSON.stringify(p.sellingPolicy??{cutAllowed:false,continuousLengthAvailable:null})]);
   const revision=(await c.query('SELECT catalog_revision FROM stores WHERE id=$1',[storeId])).rows[0].catalog_revision;
   return {...row.rows[0],active:p.active,familyId:p.familyId,revision};

}
