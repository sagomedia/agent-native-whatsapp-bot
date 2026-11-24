import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {indicativePriceSchema,type IndicativePrice} from '../../../../packages/contracts/indicative-prices.js';
import {sellingUnitSchema} from '../../../../packages/contracts/selling-units.js';
import {sellingBasisIssues} from '../../../../packages/contracts/selling-basis.js';
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const amount=z.number().int().positive().max(2147483647).nullable();
const itemSchema=z.object({sku:z.string().min(1).max(64),sourceVersion:z.number().int().positive(),unit:z.string().min(1).max(30),pricePaise:amount,lowPaise:amount,highPaise:amount,basis:z.enum(['official_anchor','category_estimate','needs_unit_check']),sourceUrls:z.array(z.url().refine(s=>s.startsWith('https://'))).max(30),note:z.string().max(2000)}).strict().superRefine((p,ctx)=>{
 const amounts=[p.pricePaise,p.lowPaise,p.highPaise];
 if(amounts.every(a=>a===null)){if(p.basis!=='needs_unit_check')ctx.addIssue({code:'custom',message:'Null prices require a unit-check reason.'});return;}
 if(amounts.some(a=>a===null)||p.lowPaise!>p.pricePaise!||p.pricePaise!>p.highPaise!)ctx.addIssue({code:'custom',message:'Positive prices must satisfy low <= price <= high.'});
});
export const indicativeProposalSchema=z.object({kind:z.literal('indicative_demo_not_shop_verified'),currency:z.literal('INR'),asOf:z.iso.date(),generation:z.object({model:z.string().min(1).max(100),requestedModel:z.literal('gpt-6-luna').optional(),effort:z.literal('low'),inputHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),items:z.array(itemSchema).min(1).max(5000),sources:z.array(z.unknown()).max(1000)}).strict().refine(p=>new Set(p.items.map(i=>i.sku)).size===p.items.length,'Each SKU must occur once.');
export type IndicativeProposal=z.infer<typeof indicativeProposalSchema>;
export async function readIndicativeProposal(path:string){
 const bytes=await readFile(path);if(bytes.length>5*1024*1024)throw new Error('Indicative proposal exceeds 5 MB.');
 return {proposal:indicativeProposalSchema.parse(JSON.parse(bytes.toString())),proposalHash:createHash('sha256').update(bytes).digest('hex')};
}
const snapshotRowSchema=z.object({sku:z.string(),name:z.string(),unit:z.string(),version:z.number().int().positive(),pricePaise:z.number().int().nonnegative(),priceStatus:z.string(),merchantPriceVerified:z.boolean(),sellingPolicy:z.unknown(),specifications:z.unknown(),indicativePrice:z.unknown()}).strict();
export const indicativeSnapshotSchema=z.object({schemaVersion:z.literal(1),storeId:z.uuid(),proposalHash:z.string().regex(/^[a-f0-9]{64}$/),inputHash:z.string().regex(/^[a-f0-9]{64}$/),rows:z.array(snapshotRowSchema).min(1).max(5000)}).strict().refine(s=>new Set(s.rows.map(r=>r.sku)).size===s.rows.length,'Snapshot SKU duplicated.');
export type IndicativeSnapshot=z.infer<typeof indicativeSnapshotSchema>;
const snapshotRow=(row:any):z.infer<typeof snapshotRowSchema>=>({sku:row.sku,name:row.name,unit:row.unit,version:row.version,pricePaise:row.price_paise,priceStatus:row.price_status,merchantPriceVerified:row.merchant_verification?.price===true,sellingPolicy:row.selling_policy??null,specifications:row.specifications??{},indicativePrice:row.indicative_price??null});
async function target(c:PoolClient,storeId:string,lock=false){
 const store=(await c.query('SELECT id,synthetic FROM stores WHERE id=$1'+(lock?' FOR UPDATE':''),[z.uuid().parse(storeId)])).rows[0];
 if(!store||store.synthetic!=='true')throw new Error('Indicative prices require the exact synthetic OWNER_STORE_ID target.');
}
async function rowsFor(c:PoolClient,storeId:string,skus:string[],lock=false){
 const rows=(await c.query('SELECT * FROM products WHERE store_id=$1 AND sku=ANY($2::text[]) ORDER BY sku'+(lock?' FOR UPDATE':''),[storeId,skus])).rows;
 if(rows.length!==skus.length)throw new Error('Proposal SKU is missing from the target store.');return rows;
}
export async function snapshotIndicativePrices(pool:Pool,storeId:string,proposal:IndicativeProposal,proposalHash:string):Promise<IndicativeSnapshot>{
 const p=indicativeProposalSchema.parse(proposal),c=await pool.connect();
 try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await target(c,storeId);const rows=await rowsFor(c,storeId,p.items.map(i=>i.sku));
  const snapshot=indicativeSnapshotSchema.parse({schemaVersion:1,storeId,proposalHash,inputHash:p.generation.inputHash,rows:rows.map(snapshotRow)});await c.query('COMMIT');return snapshot;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
export function planIndicativePrices(proposal:IndicativeProposal,proposalHash:string,snapshot:IndicativeSnapshot){
 const p=indicativeProposalSchema.parse(proposal),s=indicativeSnapshotSchema.parse(snapshot);
 if(s.proposalHash!==proposalHash||s.inputHash!==p.generation.inputHash||s.rows.length!==p.items.length||p.items.some(i=>!s.rows.some(r=>r.sku===i.sku)))throw new Error('Proposal and snapshot do not match.');
 const updates:{sku:string;version:number;indicativePrice:IndicativePrice}[]=[],skipped:{sku:string;reason:string}[]=[];
 for(const item of p.items){const row=s.rows.find(r=>r.sku===item.sku)!;
  let reason:string|undefined;
  if(row.pricePaise!==0||row.priceStatus!=='confirm')reason='existing_shop_price';
  else if(row.version!==item.sourceVersion||row.unit!==item.unit)throw new Error(`${item.sku}: source version or selling unit changed.`);
  else if(item.pricePaise===null||item.basis==='needs_unit_check'||!sellingUnitSchema.safeParse(item.unit).success||sellingBasisIssues({name:row.name,unit:row.unit,sellingPolicy:row.sellingPolicy as any,specifications:row.specifications as any}).length)reason='selling_unit_to_check';
  if(reason){skipped.push({sku:item.sku,reason});continue;}
  updates.push({sku:item.sku,version:row.version,indicativePrice:indicativePriceSchema.parse({pricePaise:item.pricePaise,lowPaise:item.lowPaise,highPaise:item.highPaise,unit:item.unit,currency:'INR',asOf:p.asOf,source:'model-low-indicative',basis:item.basis,sourceUrls:item.sourceUrls,note:item.note,generation:{...p.generation,requestedModel:p.generation.requestedModel??'gpt-6-luna',proposalHash}})});
 }
 return {updates,skipped};
}
export async function applyIndicativePrices(pool:Pool,storeId:string,actor:string,proposal:IndicativeProposal,proposalHash:string,snapshot:IndicativeSnapshot){
 z.string().min(3).max(200).parse(actor);if(snapshot.storeId!==storeId)throw new Error('Snapshot does not target OWNER_STORE_ID.');
 const plan=planIndicativePrices(proposal,proposalHash,snapshot),snapshotHash=hash(snapshot),c=await pool.connect();
 try{await c.query('BEGIN');await target(c,storeId,true);const rows=await rowsFor(c,storeId,snapshot.rows.map(r=>r.sku),true);
  const prior=(await c.query("SELECT details FROM owner_audit WHERE store_id=$1 AND action='indicative_price_import' AND details->>'proposalHash'=$2 ORDER BY sequence DESC LIMIT 1",[storeId,proposalHash])).rows[0];
  if(prior&&prior.details.snapshotHash!==snapshotHash)throw new Error('This proposal was already applied with a different snapshot.');
  for(const before of snapshot.rows){const actual=snapshotRow(rows.find(r=>r.sku===before.sku)),update=plan.updates.find(u=>u.sku===before.sku);
   const expected=prior&&update?{...before,version:before.version+1,indicativePrice:update.indicativePrice}:before;
   if(hash(actual)!==hash(expected))throw new Error(`${before.sku}: catalog snapshot changed; take a fresh snapshot and proposal.`);
  }
  if(prior){await c.query('COMMIT');return {...prior.details,replayed:true};}
  for(const update of plan.updates)await c.query('UPDATE products SET indicative_price=$1::jsonb,version=version+1 WHERE store_id=$2 AND sku=$3 AND version=$4',[JSON.stringify(update.indicativePrice),storeId,update.sku,update.version]);
  const details={proposalHash,snapshotHash,inputHash:proposal.generation.inputHash,generation:proposal.generation,asOf:proposal.asOf,updated:plan.updates.length,skipped:plan.skipped,skus:plan.updates.map(u=>u.sku),sources:proposal.sources};
  await c.query("INSERT INTO owner_audit(store_id,email,action,target_id,details) VALUES($1,$2,'indicative_price_import',$1,$3::jsonb)",[storeId,actor,JSON.stringify(details)]);
  await c.query('COMMIT');return {...details,replayed:false};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
