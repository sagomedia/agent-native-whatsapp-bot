import type { PoolClient } from 'pg';
import type { Product } from '../../../../packages/contracts/index.js';
import type { ActorContext } from './context.js';
export function normalize(text: string): string {
  return text.toLowerCase().replace(/½|1\/2|half[- ]inch/g, '0.5 inch').replace(/¾|3\/4/g, '0.75 inch').replace(/one[- ]inch/g, '1 inch').replace(/ten[- ]inch/g, '10 inch').normalize('NFKC').replace(/[^\p{L}\p{N}.]+/gu,' ').trim();
}
function tokens(text: string) { return normalize(text).split(/\s+/).filter(t => t && !['the','a','an','of','inch','inches','some'].includes(t)).map(t => t==='boxes'?'box':/^[a-z]+s$/.test(t) ? t.slice(0,-1) : t); }
export function matches(query: string, values: string[]) {
  const needles = tokens(query),haystack = new Set(values.flatMap(tokens));
  // Product words are often split/joined by customers or source catalogs.
  // Only alphabetic compounds are joined; sizes and packaging stay distinct.
  for(const value of values){const ts=tokens(value);for(let i=0;i<ts.length-1;i++)if(/^[a-z]+$/.test(ts[i]+ts[i+1]))haystack.add(ts[i]+ts[i+1]);}
  const covered=(i:number):boolean=>i===needles.length||haystack.has(needles[i])&&covered(i+1)||i+1<needles.length&&/^[a-z]+$/.test(needles[i]+needles[i+1])&&haystack.has(needles[i]+needles[i+1])&&covered(i+2);
  return needles.length > 0 && covered(0);
}
function oneEdit(a:string,b:string) {
  if(a===b)return true;if(a.length<4||b.length<4||!/^[a-z]+$/.test(a+b)||Math.abs(a.length-b.length)>1)return false;
  // A single edit or adjacent transposition. Numeric specifications are never fuzzy.
  if(a.length===b.length){const d=[...a].map((c,i)=>c===b[i]?-1:i).filter(i=>i>=0);return d.length===1||(d.length===2&&d[1]===d[0]+1&&a[d[0]]===b[d[1]]&&a[d[1]]===b[d[0]]);}
  const longer=a.length>b.length?a:b,shorter=a.length>b.length?b:a;let i=0;while(i<shorter.length&&longer[i]===shorter[i])i++;return longer.slice(i+1)===shorter.slice(i);
}
const values=(p:Product)=>[p.name,p.unit,p.category??'',...p.aliases];
export function exactProductMatch(query:string,p:Product){return normalize(query)===normalize(p.sku)||matches(query,values(p));}
export async function getProducts(client: PoolClient, context: ActorContext): Promise<Product[]> {
  const result = await client.query('SELECT sku,name,unit,price_paise,stock,version,aliases,quantity_step,category,image_path FROM products WHERE store_id=$1 AND active=true ORDER BY sku', [context.storeId]);
  return result.rows.map(p => ({sku:p.sku,name:p.name,unit:p.unit,pricePaise:p.price_paise,stock:p.stock,version:p.version,aliases:p.aliases,quantityStep:Number(p.quantity_step),...(p.category?{category:p.category}:{}),...(p.image_path?{imageUrl:p.image_path}:{})}));
}
export async function searchProducts(client: PoolClient, context: ActorContext, query: string): Promise<Product[]> {
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
  const units:Record<string,string>={pieces:'piece',pcs:'piece',pc:'piece',nos:'piece',each:'piece',units:'piece',unit:'piece',boxes:'box',rolls:'roll',feet:'foot',ft:'foot',meters:'metre',meter:'metre',metres:'metre',m:'metre',kilograms:'kg',kilogram:'kg',kilos:'kg',litres:'litre',liter:'litre',liters:'litre',bottles:'bottle',packs:'pack',pairs:'pair'};
  return units[v]??v;
}
export function sameUnit(a:string,b:string){return normalizeUnit(a)===normalizeUnit(b);}
