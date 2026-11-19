import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {DraftLine} from '../../../../packages/contracts/index.js';
import {lineTotal} from '../../../../packages/contracts/money.js';
import {sellingBasisIssues} from '../../../../packages/contracts/selling-basis.js';
import {catalogPack} from './quantity-evidence.js';
import {productColumns,productFromRow,sameUnit} from './catalog.js';
import {ToolError} from './context.js';
import {digest} from './tools.js';

const count=z.number().positive().max(100).refine(n=>Math.abs(n*1000-Math.round(n*1000))<1e-7);
const line=z.object({id:z.uuid(),sku:z.string().min(1).max(100).optional(),productVersion:z.number().int().positive().optional(),manualConfirmed:z.boolean().optional(),name:z.string().trim().min(1).max(200),quantity:count,unit:z.string().trim().min(1).max(30),saleMode:z.enum(['pack','measured']).optional(),pricePaise:z.number().int().min(0).max(100000000),free:z.boolean().optional()}).strict();
export const ownerOrderReviewSchema=z.object({id:z.uuid(),expectedRevision:z.number().int().positive(),amendmentId:z.uuid().optional(),action:z.enum(['save','revise','ready','update_ready']),lines:z.array(line).min(1).max(50),addedLineIds:z.array(z.uuid()).max(50).optional(),removedLineIds:z.array(z.uuid()).max(50).optional(),notify:z.boolean().default(true)}).strict();
export type OwnerOrderReview=z.infer<typeof ownerOrderReviewSchema>;

export const inStoreOrderSchema=z.object({
  id:z.uuid(),
  stage:z.enum(['new','completed']),
  customerName:z.string().trim().min(1).max(120).optional(),
  customerPhone:z.string().regex(/^\+[1-9][0-9]{7,14}$/).optional(),
  lines:z.array(line).min(1).max(50),
}).strict();
export type InStoreOrder=z.infer<typeof inStoreOrderSchema>;

export async function prepareOwnerOrderReview(client:PoolClient,storeId:string,requestId:string,actor:string,input:OwnerOrderReview){
  const hash=digest(input);
  const prior=(await client.query('SELECT store_id,request_id,input_hash,result FROM owner_order_reviews WHERE id=$1',[input.id])).rows[0];
  if(prior){
    if(prior.store_id!==storeId||prior.request_id!==requestId||prior.input_hash!==hash)throw new ToolError('This review action ID was already used with different details.','stale_version');
    return {replayed:true as const,result:prior.result};
  }
  const request=(await client.query('SELECT * FROM order_requests WHERE store_id=$1 AND id=$2 FOR UPDATE',[storeId,requestId])).rows[0];
  if(!request||request.acceptance==='rejected'||['collected','cancelled'].includes(request.fulfillment)||
    (request.fulfillment==='ready_for_pickup')!==(input.action==='update_ready')){
    throw new ToolError('This order moved to a different stage. Refresh it.','stale_version');
  }
  if(request.effective_revision!==input.expectedRevision)throw new ToolError('The order changed. Refresh it before saving.','stale_version');
  const amendment=(await client.query("SELECT * FROM order_amendments WHERE request_id=$1 AND state IN ('proposed','owner_pending') FOR UPDATE",[requestId])).rows[0];
  if(amendment&&(!input.amendmentId||input.amendmentId!==amendment.id||amendment.state!=='owner_pending'||amendment.kind!=='change')||input.amendmentId&&!amendment)throw new ToolError('Review the customer-confirmed change before saving this order.','stale_version');
  const old:DraftLine[]=amendment?.proposed_lines??request.effective_lines??request.lines;
  const oldIds=new Set(old.map(item=>item.id));
  const removed=new Set(input.removedLineIds);
  const added=new Set(input.addedLineIds);
  const current=new Set(input.lines.map(item=>item.id));
  if(current.size!==input.lines.length||removed.size!==(input.removedLineIds?.length??0)||added.size!==(input.addedLineIds?.length??0)||
    [...removed].some(id=>!oldIds.has(id)||current.has(id))||
    [...added].some(id=>oldIds.has(id)||!current.has(id))||
    [...oldIds].some(id=>!current.has(id)&&!removed.has(id))||
    [...current].some(id=>!oldIds.has(id)&&!added.has(id))){
    throw new ToolError('Review each item once and explicitly add or remove changed rows.');
  }
  const {lines,total}=await validateMerchantLines(client,storeId,actor,input.lines,old);
  return {replayed:false as const,request,lines,total,hash,removed:old.filter(item=>removed.has(item.id))};
}

export async function validateMerchantLines(client:PoolClient,storeId:string,actor:string,items:z.infer<typeof line>[],previous:DraftLine[]=[]){
  if(new Set(items.map(item=>item.id)).size!==items.length)throw new ToolError('Each item must have a unique row.');
  const skus=[...new Set(items.flatMap(l=>l.sku?[l.sku]:[]))];
  const products=skus.length?(await client.query(`SELECT ${productColumns},active FROM products WHERE store_id=$1 AND sku=ANY($2::text[]) ORDER BY sku FOR SHARE`,[storeId,skus])).rows:[];
  const at=new Date().toISOString();
  const lines:DraftLine[]=items.map(item=>{
    const original=previous.find(o=>o.id===item.id);
    if(item.pricePaise===0&&!item.free)throw new ToolError(`${item.name}: enter the price or mark this item free.`);
    let product;
    let historicalIdentity=false;
    if(item.sku){
      const row=products.find(p=>p.sku===item.sku);
      const sameIdentity=!!original&&item.sku===original.sku&&item.name===original.name&&sameUnit(item.unit,original.unit??'');
      if(!row?.active&&!sameIdentity)throw new ToolError(`${item.name}: this catalog product is not current. Select it again.`,'stale_version');
      // Keep the identity the customer saw when later catalog edits change its name or selling basis.
      // Selecting a different identity still requires current catalog facts and version.
      historicalIdentity=sameIdentity&&(!row?.active||item.name!==row.name||!sameUnit(item.unit,row.unit));
      product=historicalIdentity?original?.candidates?.find(p=>p.sku===item.sku&&p.name===item.name&&sameUnit(p.unit,item.unit)):productFromRow(row);
      if(!sameIdentity&&row.version!==item.productVersion)throw new ToolError(`${item.name}: catalog details changed. Select the current product again.`,'stale_version');
      if(!historicalIdentity&&(item.name!==product!.name||!sameUnit(item.unit,product!.unit)))throw new ToolError(`${item.name}: use the product’s name and selling unit, or choose a store item.`);
      const step=Math.round((product?.quantityStep??0.001)*1000);
      if(!step||Math.round(item.quantity*1000)%step)throw new ToolError(`${item.name}: use increments of ${product!.quantityStep} ${item.unit}.`);
      if(product?.priceStatus==='confirm'&&!item.manualConfirmed)throw new ToolError(`${item.name}: confirm this product’s actual price before saving.`);
    }else if(!item.manualConfirmed)throw new ToolError(`${item.name}: confirm this store item before saving.`);
    const saleMode=item.saleMode??original?.merchantConfirmed?.saleMode??product?.sellingPolicy?.saleMode;
    const issues=sellingBasisIssues({name:item.name,unit:item.unit,specifications:product?.specifications,sellingPolicy:{...(product?.sellingPolicy??{cutAllowed:false,continuousLengthAvailable:null}),...(saleMode?{saleMode}:{})}});
    if(issues.length)throw new ToolError(`${item.name}: ${issues.join(' ')}`);
    return {...original,id:item.id,sku:item.sku,productVersion:historicalIdentity?original?.productVersion:product?.version,candidates:product?[product]:[],name:item.name,quantity:item.quantity,unit:item.unit,pricePaise:item.pricePaise,packSize:historicalIdentity?original?.packSize:product?catalogPack(product):undefined,resolution:'matched',catalogIssue:undefined,requestedUnit:undefined,requestedAmount:undefined,merchantConfirmed:{actor,at,free:!!item.free,...(saleMode?{saleMode}:{})}};
  });
  const total=lines.reduce((sum,item)=>sum+lineTotal(item.pricePaise!,item.quantity!),0);
  return {lines,total};
}

export async function recordOwnerOrderReview(client:PoolClient,storeId:string,requestId:string,input:OwnerOrderReview,hash:string,result:unknown){
  await client.query('INSERT INTO owner_order_reviews(id,store_id,request_id,input_hash,result) VALUES($1,$2,$3,$4,$5::jsonb)',[input.id,storeId,requestId,hash,JSON.stringify(result)]);
}
