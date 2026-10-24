import {naturalCatalogQuery} from './catalog-request.js';
import {canonicalMeasurementUnit} from '../../../../packages/contracts/measurements.js';
import type { PoolClient } from 'pg';
import {availableStock,stockMilli,stockDecimal} from '../../../../packages/contracts/stock-quantity.js';
import type { Product } from '../../../../packages/contracts/index.js';
import type { ActorContext } from './context.js';
import {normalize,tokens,oneEdit} from '../../../../packages/contracts/catalog-text.js';
export {normalize,tokens,oneEdit} from '../../../../packages/contracts/catalog-text.js';
export function matches(query: string, values: string[]) {
  const needles = tokens(query),haystack = new Set(values.flatMap(tokens));
  // Product words are often split/joined by customers or source catalogs.
  // Only alphabetic compounds are joined; sizes and packaging stay distinct.
  for(const value of values){const ts=tokens(value);for(let i=0;i<ts.length-1;i++)if(/^[a-z]+$/.test(ts[i]+ts[i+1]))haystack.add(ts[i]+ts[i+1]);}
  const covered=(i:number):boolean=>i===needles.length||haystack.has(needles[i])&&covered(i+1)||i+1<needles.length&&/^[a-z]+$/.test(needles[i]+needles[i+1])&&haystack.has(needles[i]+needles[i+1])&&covered(i+2);
  return needles.length > 0 && covered(0);
}
const values=(p:Product)=>[p.name,p.unit,p.category??'',p.brand??'',...Object.values(p.localNames??{}),...Object.values(p.specifications??{}),...p.aliases];
export function exactProductMatch(query:string,p:Product){return normalize(query)===normalize(p.sku)||matches(naturalCatalogQuery(query),values(p));}
export const productColumns='sku,name,local_names,unit,price_paise,stock,version,aliases,quantity_step,category,image_path,family_id,brand,specifications,keywords,price_status,indicative_price,selling_unit_verified,selling_policy,reserved_stock,inventory_version,product_group_id,product_group_name,variant_label';
export function productFromRow(p:any):Product {
 return {...(p.selling_policy?.saleMode||p.selling_policy?.packContents||p.selling_policy?.cutAllowed||p.selling_policy?.continuousLengthAvailable?{sellingPolicy:p.selling_policy}:{}),sku:p.sku,name:p.name,...(p.product_group_id?{productGroup:{id:p.product_group_id,name:p.product_group_name,label:p.variant_label}}:{}),localNames:p.local_names,unit:p.unit,pricePaise:p.price_paise,priceStatus:p.price_status,...(p.indicative_price?{indicativePrice:p.indicative_price}:{}),sellingUnitVerified:p.selling_unit_verified,stock:availableStock(p.stock,p.reserved_stock??0),stockOnHand:p.stock===null?null:Number(p.stock),stockReserved:Number(p.reserved_stock??0),inventoryVersion:p.inventory_version??1,version:p.version,aliases:p.aliases,quantityStep:Number(p.quantity_step),...(p.category?{category:p.category}:{}),...(p.image_path?{imageUrl:p.image_path,...(/^\/catalog-images\/reference\/[a-f0-9-]{36}\.jpg$/.test(p.image_path)?{imageReference:true}:{})}:{}),...(p.family_id?{familyId:p.family_id}:{}),...(p.brand?{brand:p.brand}:{}),...(p.specifications&&Object.keys(p.specifications).length?{specifications:p.specifications}:{}),...(p.keywords?.length?{keywords:p.keywords}:{})};
}
/** Only the trusted amendment scratch pass supplies the customer's existing hold. */
export function productForContext(row:any,ctx:ActorContext):Product {
 const product=productFromRow(row),held=ctx.amendmentHolds?.[row.sku];
 if(held&&row.stock!==null)product.stock=availableStock(row.stock,stockDecimal(stockMilli(row.reserved_stock??0)-stockMilli(held)));
 return product;
}
export async function catalogEnabled(client:PoolClient,ctx:ActorContext) {return !!(await client.query('SELECT 1 FROM catalog_profiles WHERE store_id=$1',[ctx.storeId])).rowCount;}
export async function catalogContext(client:PoolClient,ctx:ActorContext) {
 return (await client.query(`SELECT ${productColumns} FROM products WHERE store_id=$1 AND active=true ORDER BY sku LIMIT (SELECT CASE WHEN count(*)<=40 THEN 40 ELSE 24 END FROM products WHERE store_id=$1 AND active=true)`,[ctx.storeId])).rows.map(p=>productForContext(p,ctx));
}
export async function getProducts(client: PoolClient, context: ActorContext): Promise<Product[]> {
  const result=await client.query(`SELECT ${productColumns} FROM products WHERE store_id=$1 AND active=true ORDER BY sku`,[context.storeId]);
  return result.rows.map(p=>productForContext(p,context));
}
export async function searchProducts(client: PoolClient, context: ActorContext, query: string): Promise<Product[]> {
  const identifiedRows=await client.query(`SELECT ${productColumns} FROM products WHERE store_id=$1 AND active=true AND lower(sku)=lower($2) LIMIT 1`,[context.storeId,query.trim()]);
  if(identifiedRows.rowCount)return identifiedRows.rows.map(p=>productForContext(p,context));
  if(await catalogEnabled(client,context)){
    const ts=tokens(query).slice(0,12);
    if(!ts.length)return [];
    const parameters:unknown[]=[context.storeId];
    const clauses=ts.map(t=>{parameters.push('%'+t.replace(/[\\%_]/g,'\\$&')+'%');return `search_text ILIKE $${parameters.length} ESCAPE '\\'`;});
    const result=await client.query(`SELECT ${productColumns} FROM products WHERE store_id=$1 AND active=true AND (${clauses.join(' AND ')}) ORDER BY sku LIMIT 100`,parameters);
    const exact=result.rows.map(p=>productForContext(p,context)).filter(p=>exactProductMatch(query,p));
    if(exact.length)return exact;
    const fuzzy=await client.query(`SELECT ${productColumns} FROM products WHERE store_id=$1 AND active=true AND $2 OPERATOR(public.<%) search_text ORDER BY public.word_similarity($2,search_text) DESC,sku LIMIT 30`,[context.storeId,normalize(query)]);
    return fuzzy.rows.map(p=>productForContext(p,context)).filter(p=>ts.every(t=>values(p).flatMap(tokens).some(h=>oneEdit(t,h))));
  }
  const rows = await getProducts(client,context);
  // Catalog identities must never compete with text/alias matches. Refreshing
  // an existing line by SKU cannot change its product or packaging.
  const identified=rows.filter(p=>p.sku.toLowerCase()===query.trim().toLowerCase());
  if(identified.length)return identified;
  const exact=rows.filter(p=>exactProductMatch(query,p));
  if(exact.length)return exact;
  const needles=tokens(query);
  return rows.filter(p=>{const hay=values(p).flatMap(tokens);return needles.length>0&&needles.every(t=>hay.some(h=>oneEdit(t,h)));});
}

// Packaging and measurements are compared without inferring conversions.
export function normalizeUnit(value:string) {
  const v=normalize(value);
  const units:Record<string,string>={'எண்ணம்':'piece','பீஸ்':'piece','பெட்டி':'box','பெட்டிகள்':'box','பாக்ஸ்':'box','பாட்டில்':'bottle','பாட்டில்கள்':'bottle','ரோல்':'roll','ரோல்கள்':'roll','அடி':'foot','மீட்டர்':'metre','கிலோ':'kg','ஜோடி':'pair','பேக்':'pack','லிட்டர்':'litre',ennam:'piece',petti:'box',pettigal:'box',adi:'foot',jodi:'pair',kilo:'kg',pieces:'piece',pcs:'piece',pc:'piece',nos:'piece',each:'piece',units:'piece',unit:'piece',boxes:'box',rolls:'roll',feet:'foot',ft:'foot',meters:'metre',meter:'metre',metres:'metre',m:'metre',kilograms:'kg',kilogram:'kg',kilos:'kg',litres:'litre',liter:'litre',liters:'litre',bottles:'bottle',cans:'can',tins:'tin',buckets:'bucket','கேன்':'can','வாளி':'bucket',packs:'pack',pairs:'pair'};
  const measured=canonicalMeasurementUnit(v);
  return /^(?:dabba|dappa|டப்பா|டப்பாக்கள்)$/.test(v)?'container':units[v]??(measured==='m'?'metre':measured);
}
export function sameUnit(a:string,b:string){return normalizeUnit(a)===normalizeUnit(b);}
