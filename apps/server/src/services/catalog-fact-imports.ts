import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {factColumns,factLimits,type FactRow,type FactBatch,type FactChunk} from '../../../../packages/contracts/catalog-facts.js';
import {stockMilli,stockDecimal} from '../../../../packages/contracts/stock-quantity.js';
import {sellingBasisIssues} from '../../../../packages/contracts/selling-basis.js';
import {productFromRow} from './catalog.js';
import {adjustStock} from './inventory.js';
import {ownerProductPage,productPageSchema} from '../http/owner-catalog-pages.js';

const fail=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const confirmed=(value:string)=>['yes','true'].includes(value.trim().toLowerCase());
/** Decimal strings stay exact until the existing inventory API's checked number boundary. */
export function factPaise(value:string):number{
 if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw fail('Use an INR decimal with at most two decimal places.');
 const [whole,fraction='']=value.split('.'),paise=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(paise>2147483647n)throw fail('Shop price exceeds the supported INR range.');return Number(paise);
}
export function factQuantity(value:string):string{
 let milli:bigint;try{milli=stockMilli(value);}catch{throw fail('Use a non-negative count with at most three decimal places.');}
 if(milli>999999999000n)throw fail('Physical count exceeds the supported quantity range.');
 const decimal=stockDecimal(milli),numeric=Number(decimal);
 if(stockMilli(numeric)!==milli||Math.abs(numeric*1000-Math.round(numeric*1000))>=1e-7)throw fail('This physical count cannot be represented exactly by the stock ledger.');return decimal;
}
/** RFC 4180 quoted fields, including Unicode, CRLF and embedded newlines. No formulas execute. */
export function parseFactCsv(csv:string):string[][]{
 if(Buffer.byteLength(csv,'utf8')>factLimits.bytes)throw fail('Choose a CSV no larger than 2 MiB.');
 const source=csv.replace(/^\uFEFF/,''),rows:string[][]=[],row:string[]=[];let field='',quoted=false,closed=false;
 const cell=()=>{row.push(field);field='';closed=false;};
 const line=()=>{cell();rows.push(row.splice(0));if(rows.length>factLimits.rows+2)throw fail('A sheet can contain at most 3,000 product rows.');};
 for(let i=0;i<source.length;i++){
  const c=source[i];if(quoted){if(c==='"'){if(source[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c==='"'){if(field||closed)throw fail('Invalid CSV quoting. Export a fresh CSV sheet.');quoted=true;}
  else if(c===',')cell();else if(c==='\r'||c==='\n'){if(c==='\r'&&source[i+1]==='\n')i++;line();}
  else{if(closed)throw fail('Unexpected text after a quoted CSV field.');field+=c;}
 }
 if(quoted)throw fail('An unfinished quoted CSV field needs closing.');
 if(field||row.length||closed)line();
 while(rows.length&&rows.at(-1)!.every(v=>v===''))rows.pop();
 if(rows.length<2)throw fail('Include the header and at least one product row.');
 if(rows.length>factLimits.rows+1)throw fail('A sheet can contain at most 3,000 product rows.');
 if(rows[0].length!==factColumns.length||factColumns.some((name,i)=>rows[0][i]!==name))throw fail('Use the exact exported shop-facts columns in their original order.');
 return rows.slice(1);
}
export function factCsvCell(value:string):string{
 // Spreadsheet formula protection is reversible for exact read-only product context.
 const safe=/^[\s\u0000-\u001f]*[=+\-@]/.test(value)?"'"+value:value;
 return '"'+safe.replaceAll('"','""')+'"';
}
const contextMatches=(supplied:string,current:string)=>supplied===current||supplied==="'"+current&&/^[\s\u0000-\u001f]*[=+\-@]/.test(current);
export async function exportCatalogFacts(c:PoolClient,storeId:string,input:unknown){
 const raw=input as Record<string,unknown>,{skus,...query}=raw??{},selected=skus===undefined?null:new Set(String(skus).split(','));
 if(selected&&(!selected.size||selected.size>factLimits.rows||[...selected].some(s=>!s)))throw fail('Choose between 1 and 3,000 exact product SKUs.');
 const parsed=productPageSchema.omit({cursor:true,limit:true}).parse(query),records:string[][]=[];let cursor:string|undefined;
 do{const page=await ownerProductPage(c,storeId,{...parsed,cursor,limit:100});for(const p of page.products){if(selected&&!selected.has(p.sku))continue;records.push([p.sku,String(p.version),String(p.inventoryVersion),p.name,p.unit,'','','','','','']);if(records.length>factLimits.rows)throw fail('Narrow the export to at most 3,000 products.');}cursor=page.nextCursor??undefined;}while(cursor);
 if(selected&&records.length!==selected.size)throw fail('Some selected products are outside this shop or the selected filters. Refresh the selection.');
 return {total:records.length,csv:[factColumns.join(','),...records.map(r=>r.map(factCsvCell).join(','))].join('\r\n')+'\r\n'};
}
function validateRow(cells:string[],index:number,products:Map<string,any>,duplicates:Set<string>):FactRow{
 const value=Object.fromEntries(factColumns.map((key,i)=>[key,cells[i]??''])),p=products.get(value.sku),errors:string[]=[],after:FactRow['after']={};
 const row:FactRow={rowNumber:index+2,sku:value.sku,name:value.product_name,unit:value.selling_unit,before:p?{pricePaise:p.price_paise,priceStatus:p.price_status,onHand:p.stock,productVersion:p.version,inventoryVersion:p.inventory_version}:null,after,errors,state:'unchanged',note:value.note,changes:{price:false,stock:false}};
 if(cells.length!==factColumns.length)errors.push('The row does not have the exported number of columns.');
 if(!p)errors.push('Exact SKU was not found in this shop.');
 if(duplicates.has(value.sku))errors.push('Duplicate SKU: keep one row per product.');
 if(value.note.length>240)errors.push('Note must be at most 240 characters.');
 if(p){
  if(value.product_version!==String(p.version))errors.push('Product version changed. Export a fresh sheet.');
  if(!contextMatches(value.product_name,p.name)||value.selling_unit!==p.unit)errors.push('Product name or selling unit differs. Review the product and export a fresh sheet.');
 }
 const price=value.shop_price_inr.trim(),quantity=value.on_hand_quantity.trim();
 if(!price&&(value.price_status.trim()||value.confirm_price.trim()))errors.push('A price status/confirmation requires an actual supplied shop price.');
 if(!quantity&&value.confirm_stock.trim())errors.push('A stock confirmation requires an actual physical count.');
 if(price){
  try{after.pricePaise=factPaise(price);}catch(e){errors.push((e as Error).message);}
  if(!confirmed(value.confirm_price))errors.push('Confirm the actual shop price with yes or true.');
  if(!['priced','free'].includes(value.price_status))errors.push('Choose priced or explicitly free for the supplied price.');
  else after.priceStatus=value.price_status as 'priced'|'free';
  if(after.pricePaise===0&&after.priceStatus!=='free'||after.pricePaise!==undefined&&after.pricePaise>0&&after.priceStatus!=='priced')errors.push('Zero requires explicit free status; a positive price requires priced status.');
  if(p)row.changes.price=after.pricePaise!==p.price_paise||after.priceStatus!==p.price_status||p.merchant_verification?.price!==true||p.indicative_price!==null;
 }
 if(quantity){
  try{after.onHand=factQuantity(quantity);if(p&&stockMilli(after.onHand)%stockMilli(p.quantity_step)!==0n)errors.push('Physical count must use this product selling increment.');if(p&&stockMilli(after.onHand)<stockMilli(p.reserved_stock))errors.push('Physical count is below stock reserved for customer orders.');}catch(e){errors.push((e as Error).message);}
  if(!confirmed(value.confirm_stock))errors.push('Confirm the physical shelf count with yes or true.');
  if(p&&value.inventory_version!==String(p.inventory_version))errors.push('Stock version changed. Export a fresh physical-count sheet.');
  if(p)row.changes.stock=after.onHand!==undefined&&(p.stock===null||stockMilli(after.onHand)!==stockMilli(p.stock)||p.merchant_verification?.stock!==true);
 }
 if(p&&(price||quantity))errors.push(...sellingBasisIssues(productFromRow(p)));
 if(errors.length)row.state='error';else if(row.changes.price||row.changes.stock)row.state='pending';
 return row;
}
type StoredBatch={id:string;file_hash:string;filename:string|null;expires_at:Date;status:FactBatch['status'];rows:FactRow[];chunks:FactChunk[];next_row:number;error:string|null};
function batchPage(batch:StoredBatch,cursor=0,limit=25,replayed=false):FactBatch{
 const rows=batch.rows,changed=rows.filter(r=>r.changes.price||r.changes.stock).length,committed=rows.filter(r=>r.state==='committed').length;
 return {batchId:batch.id,fileHash:batch.file_hash,filename:batch.filename,expiresAt:new Date(batch.expires_at).toISOString(),status:batch.status,counts:{total:rows.length,changed,unchanged:rows.filter(r=>r.state==='unchanged').length,errors:rows.filter(r=>r.errors.length>0).length,committed,remaining:rows.slice(batch.next_row).filter(r=>r.state==='pending').length},rows:rows.slice(cursor,cursor+limit),nextCursor:cursor+limit<rows.length?String(cursor+limit):null,nextChunk:batch.chunks.length,replayed,receipt:{chunks:batch.chunks},...(batch.error?{error:batch.error}:{})};
}
async function stored(c:PoolClient,storeId:string,id:string,lock=false):Promise<StoredBatch>{const b=(await c.query(`SELECT * FROM catalog_fact_batches WHERE store_id=$1 AND id=$2${lock?' FOR UPDATE':''}`,[storeId,id])).rows[0];if(!b)throw fail('Shop-facts batch not found in this shop.',404);return b;}
export async function previewCatalogFacts(c:PoolClient,storeId:string,csv:string,filename?:string){
 const input=parseFactCsv(csv),seen=new Set<string>(),duplicates=new Set<string>();for(const row of input){if(seen.has(row[0]))duplicates.add(row[0]);seen.add(row[0]);}
 const products=new Map((await c.query('SELECT * FROM products WHERE store_id=$1 AND sku=ANY($2::text[])',[storeId,[...seen]])).rows.map(p=>[p.sku,p]));
 const rows=input.map((cells,i)=>validateRow(cells,i,products,duplicates)),status=rows.some(r=>r.errors.length)?'invalid':'preview',id=randomUUID();
 await c.query(`INSERT INTO catalog_fact_batches(id,store_id,file_hash,filename,expires_at,status,rows) VALUES($1,$2,$3,$4,now()+interval '24 hours',$5,$6::jsonb)`,[id,storeId,hash(csv),filename??null,status,JSON.stringify(rows)]);
 return batchPage(await stored(c,storeId,id));
}
export async function catalogFactsBatch(c:PoolClient,storeId:string,id:string,cursor=0,limit=25){return batchPage(await stored(c,storeId,id),cursor,limit);}
const operationId=(batchId:string,rowNumber:number)=>{const h=hash(batchId+':'+rowNumber).slice(0,32).split('');h[12]='4';h[16]='8';const s=h.join('');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;};
/** Caller uses one audited transaction. Store first, batch then sorted product locks. */
export async function applyCatalogFacts(c:PoolClient,storeId:string,actor:string,input:{batchId:string;fileHash:string;expectedChunk:number}){
 await c.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE',[storeId]);
 const batch=await stored(c,storeId,input.batchId,true);
 if(batch.file_hash!==input.fileHash)throw fail('This batch belongs to a different file. Upload a fresh preview.',409);
 if(input.expectedChunk<batch.chunks.length)return batchPage(batch,0,25,true);
 if(input.expectedChunk!==batch.chunks.length)throw fail('Chunk sequence differs. Reload this batch before applying.',409);
 if(batch.status==='complete')return batchPage(batch,0,25,true);
 if(batch.status==='invalid'||batch.status==='blocked')throw fail('This preview has errors. Correct the sheet and upload a fresh preview.',409);
 if(new Date(batch.expires_at).getTime()<=Date.now())throw fail('This preview expired after 24 hours. Upload a fresh preview.',409);
 const chunk=batch.rows.slice(batch.next_row,batch.next_row+factLimits.chunk),pending=chunk.filter(r=>r.state==='pending'),products=new Map((await c.query('SELECT * FROM products WHERE store_id=$1 AND sku=ANY($2::text[]) ORDER BY sku FOR UPDATE',[storeId,pending.map(r=>r.sku).sort()])).rows.map(p=>[p.sku,p]));
 for(const row of pending){
  const p=products.get(row.sku),errors:string[]=[];
  if(!p||p.version!==row.before!.productVersion||p.name!==row.name&&!contextMatches(row.name,p.name)||p.unit!==row.unit)errors.push('Product changed since preview. Export a fresh sheet.');
  if(p&&row.after.onHand!==undefined&&p.inventory_version!==row.before!.inventoryVersion)errors.push('Stock changed since preview. Count again and export a fresh sheet.');
  if(p&&row.after.onHand!==undefined&&stockMilli(row.after.onHand)<stockMilli(p.reserved_stock))errors.push('Physical count is below current reservations. Reconcile the orders first.');
  if(p)errors.push(...sellingBasisIssues(productFromRow(p)));
  row.errors=errors;
 }
 if(pending.some(r=>r.errors.length)){
  batch.status='blocked';batch.error='The next chunk was not applied. Earlier committed chunks remain saved. Correct stale rows in a fresh preview.';
  await c.query('UPDATE catalog_fact_batches SET rows=$3::jsonb,status=$4,error=$5,updated_at=now() WHERE store_id=$1 AND id=$2',[storeId,batch.id,JSON.stringify(batch.rows),batch.status,batch.error]);return batchPage(batch);
 }
 for(const row of pending){
  if(row.changes.stock)await adjustStock(c,storeId,row.sku,actor,{id:operationId(batch.id,row.rowNumber),expectedVersion:row.before!.inventoryVersion,kind:'count',quantity:Number(row.after.onHand!),reason:row.note.trim().length>=3?row.note.trim():`Confirmed physical count, shop-facts batch ${batch.id}`});
  if(row.changes.price)await c.query(`UPDATE products SET price_paise=$3,price_status=$4,indicative_price=NULL,merchant_verification=merchant_verification||'{"price":true}'::jsonb,version=version+1 WHERE store_id=$1 AND sku=$2`,[storeId,row.sku,row.after.pricePaise,row.after.priceStatus]);
  if(row.changes.stock)await c.query(`UPDATE products SET merchant_verification=merchant_verification||'{"stock":true}'::jsonb WHERE store_id=$1 AND sku=$2`,[storeId,row.sku]);
  row.state='committed';
 }
 batch.chunks.push({index:batch.chunks.length,fromRow:chunk[0].rowNumber,toRow:chunk.at(-1)!.rowNumber,committed:pending.length,unchanged:chunk.length-pending.length,at:new Date().toISOString()});
 batch.next_row+=chunk.length;batch.status=batch.next_row===batch.rows.length?'complete':'applying';
 await c.query('UPDATE catalog_fact_batches SET rows=$3::jsonb,chunks=$4::jsonb,next_row=$5,status=$6,updated_at=now() WHERE store_id=$1 AND id=$2',[storeId,batch.id,JSON.stringify(batch.rows),JSON.stringify(batch.chunks),batch.next_row,batch.status]);
 return batchPage(batch);
}
