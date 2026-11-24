import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import {indicativePriceSchema} from '../../../../packages/contracts/indicative-prices.js';
import {sellingBasisIssues} from '../../../../packages/contracts/selling-basis.js';

/** Explicit demo preparation only. Never called by migrations or ordinary catalog reads. */
export async function prepareDemoPrices(pool:Pool,storeId:string,actor:string,options:{apply?:boolean;expectedPlanHash?:string}={}){
 z.uuid().parse(storeId);z.string().trim().min(3).max(200).parse(actor);
 if(options.apply&&!z.string().regex(/^[a-f0-9]{64}$/).safeParse(options.expectedPlanHash).success)throw new Error('Applying demo prices requires the hash from a dry run.');
 const c=await pool.connect();
 try{
  await c.query(options.apply?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const store=(await c.query('SELECT id,synthetic FROM stores WHERE id=$1'+(options.apply?' FOR UPDATE':''),[storeId])).rows[0];
  if(!store||store.synthetic!=='true')throw new Error('Demo prices require the exact synthetic OWNER_STORE_ID target.');
  const rows=(await c.query("SELECT sku,name,unit,price_paise,price_status,version,indicative_price,specifications,selling_policy FROM products WHERE store_id=$1 AND price_paise=0 AND price_status='confirm' AND indicative_price IS NOT NULL ORDER BY sku"+(options.apply?' FOR UPDATE':''),[storeId])).rows;
  const updates:{sku:string;version:number;pricePaise:number;unit:string;source:unknown}[]=[],skipped:{sku:string;reason:string}[]=[];
  for(const row of rows){
   const price=indicativePriceSchema.safeParse(row.indicative_price);
   if(!price.success||price.data.unit!==row.unit){skipped.push({sku:row.sku,reason:'invalid_or_mismatched_price_unit'});continue;}
   if(sellingBasisIssues({name:row.name,unit:row.unit,specifications:row.specifications,sellingPolicy:row.selling_policy}).length){skipped.push({sku:row.sku,reason:'selling_basis_needs_checking'});continue;}
   updates.push({sku:row.sku,version:row.version,pricePaise:price.data.pricePaise,unit:row.unit,source:row.indicative_price});
  }
  const planHash=createHash('sha256').update(JSON.stringify({storeId,rows})).digest('hex');
  if(options.apply&&planHash!==options.expectedPlanHash)throw new Error('Demo price plan changed. Run the preview again before applying.');
  if(options.apply){
   for(const item of updates){
    const result=await c.query("UPDATE products SET price_paise=$4,price_status='priced',version=version+1 WHERE store_id=$1 AND sku=$2 AND version=$3 AND price_paise=0 AND price_status='confirm'",[storeId,item.sku,item.version,item.pricePaise]);
    if(result.rowCount!==1)throw new Error('Demo product changed while applying prices. Run the preview again.');
   }
   await c.query("INSERT INTO owner_audit(store_id,email,action,target_id,details) VALUES($1,$2,'demo_prices_prepare',$1,$3::jsonb)",[storeId,actor,JSON.stringify({planHash,updates,skipped,purpose:'Synthetic demo prices; merchant verification unchanged'})]);
  }
  await c.query('COMMIT');return {storeId,applied:!!options.apply,planHash,updated:options.apply?updates.length:0,planned:updates.length,updates,skipped};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
