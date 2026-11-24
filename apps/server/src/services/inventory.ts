import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {DraftLine} from '../../../../packages/contracts/index.js';
import {stockMilli,stockDecimal} from '../../../../packages/contracts/stock-quantity.js';
import {sellingBasisIssues} from '../../../../packages/contracts/selling-basis.js';
import {productFromRow,sameUnit} from './catalog.js';
import {ToolError} from './context.js';

const conflict=(message:string)=>new ToolError(message,'stale_version');
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function movement(c:PoolClient,storeId:string,row:any,key:string,kind:string,onHand:string|null,reserved:string,actor:string,reason:string,requestId:string|null=null,commandHash?:string){
 const inputHash=commandHash??hash({sku:row.sku,kind,onHand,reserved,requestId,actor,reason});
 const old=(await c.query('SELECT input_hash FROM inventory_movements WHERE store_id=$1 AND operation_key=$2',[storeId,key])).rows[0];
 if(old){if(old.input_hash!==inputHash)throw conflict('This stock operation ID has different details.');return;}
 const version=row.inventory_version+1;
 await c.query('UPDATE products SET stock=$3,reserved_stock=$4,inventory_version=$5,inventory_updated_at=now() WHERE store_id=$1 AND sku=$2',[storeId,row.sku,onHand,reserved,version]);
 await c.query('INSERT INTO inventory_movements(id,store_id,sku,request_id,operation_key,input_hash,kind,on_hand_before,on_hand_after,reserved_before,reserved_after,actor,reason,inventory_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[randomUUID(),storeId,row.sku,requestId,key,inputHash,kind,row.stock,onHand,row.reserved_stock,reserved,actor,reason,version]);
}

/** Call inside the existing transaction. The store lock serializes owner and bot writes. */
export async function reserveRequest(c:PoolClient,storeId:string,requestId:string,lines:DraftLine[],revision:number,actor:string,allowLegacy=false){
 await c.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE',[storeId]);
 const request=(await c.query('SELECT inventory_state FROM order_requests WHERE store_id=$1 AND id=$2 FOR UPDATE',[storeId,requestId])).rows[0];
 if(!request)throw conflict('Order not found.');
 if(request.inventory_state==='legacy'&&!allowLegacy)return {legacy:true};
 if(['consumed','released'].includes(request.inventory_state))throw conflict('Stock for this order is already closed.');
 const holds=(await c.query("SELECT * FROM inventory_reservations WHERE store_id=$1 AND request_id=$2 AND state='active'",[storeId,requestId])).rows;
 const skus=[...new Set([...lines.flatMap(l=>l.sku?[l.sku]:[]),...holds.map(h=>h.sku)])].sort();
 const rows=skus.length?(await c.query('SELECT * FROM products WHERE store_id=$1 AND sku=ANY($2::text[]) ORDER BY sku FOR UPDATE',[storeId,skus])).rows:[];
 const desired=new Map<string,bigint>(),untracked:string[]=[];
 for(const line of lines){
  if(line.quantity===null||line.quantity<=0)throw conflict(`${line.name}: confirm the quantity before accepting.`);
  const row=rows.find(p=>p.sku===line.sku);
  if(!line.sku){untracked.push(line.id);continue;}
  if(!row||!row.active)throw conflict(`${line.name}: this product is no longer published. Send a fresh quote.`);
  const product=productFromRow(row),amount=stockMilli(line.quantity),step=stockMilli(product.quantityStep);
  if(!line.unit||!sameUnit(line.unit,product.unit)||amount%step!==0n||sellingBasisIssues(product).length)throw conflict(`${line.name}: recheck the selling unit, pack and quantity increment.`);
  if(!line.merchantConfirmed&&(line.productVersion!==row.version||line.pricePaise!==row.price_paise))throw conflict(`${line.name}: catalog details changed. Send a fresh quote for customer approval.`);
  if(row.stock===null){untracked.push(line.id);continue;}
  desired.set(row.sku,(desired.get(row.sku)??0n)+amount);
 }
 for(const sku of skus){
  const row=rows.find(p=>p.sku===sku);if(!row)continue;
  const old=holds.find(h=>h.sku===sku),before=old?stockMilli(old.quantity):0n,wanted=desired.get(sku)??0n,delta=wanted-before;
  const reserved=stockMilli(row.reserved_stock)+delta;
  if(reserved<0n||row.stock!==null&&stockMilli(row.stock)<reserved)throw conflict(`${row.name}: not enough available stock. Recheck the shelf count or offer a revised order.`);
  if(delta!==0n)await movement(c,storeId,row,`order:${requestId}:${revision}:${sku}`,delta>0n?'reserve':'release',row.stock,stockDecimal(reserved),actor,`Order revision ${revision}`,requestId);
  if(wanted>0n)await c.query("INSERT INTO inventory_reservations(store_id,request_id,sku,quantity,revision,state) VALUES($1,$2,$3,$4,$5,'active') ON CONFLICT(store_id,request_id,sku) DO UPDATE SET quantity=EXCLUDED.quantity,revision=EXCLUDED.revision,state='active',updated_at=now()",[storeId,requestId,sku,stockDecimal(wanted),revision]);
  else if(old)await c.query("UPDATE inventory_reservations SET state='released',updated_at=now() WHERE store_id=$1 AND request_id=$2 AND sku=$3",[storeId,requestId,sku]);
 }
 const state=desired.size?'reserved':'untracked';
 await c.query('UPDATE order_requests SET inventory_state=$3,inventory_untracked_line_ids=$4::jsonb WHERE store_id=$1 AND id=$2',[storeId,requestId,state,JSON.stringify(untracked)]);
 return {state,untracked};
}

export async function closeRequestStock(c:PoolClient,storeId:string,requestId:string,kind:'collect'|'release',actor:string){
 await c.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE',[storeId]);
 const r=(await c.query('SELECT inventory_state FROM order_requests WHERE store_id=$1 AND id=$2 FOR UPDATE',[storeId,requestId])).rows[0];
 if(!r||['legacy','consumed','released'].includes(r.inventory_state))return;
 const holds=(await c.query("SELECT h.*,p.stock,p.reserved_stock,p.inventory_version FROM inventory_reservations h JOIN products p ON p.store_id=h.store_id AND p.sku=h.sku WHERE h.store_id=$1 AND h.request_id=$2 AND h.state='active' ORDER BY h.sku FOR UPDATE OF p",[storeId,requestId])).rows;
 for(const row of holds){
  const quantity=stockMilli(row.quantity),reserved=stockMilli(row.reserved_stock)-quantity;
  const onHand=kind==='collect'?stockDecimal(stockMilli(row.stock)-quantity):row.stock;
  await movement(c,storeId,row,`order:${requestId}:${kind}:${row.sku}`,kind,onHand,stockDecimal(reserved),actor,kind==='collect'?'Customer collected order':'Order cancelled or declined',requestId);
 }
 await c.query("UPDATE inventory_reservations SET state=$3,updated_at=now() WHERE store_id=$1 AND request_id=$2 AND state='active'",[storeId,requestId,kind==='collect'?'consumed':'released']);
 await c.query('UPDATE order_requests SET inventory_state=$3 WHERE store_id=$1 AND id=$2',[storeId,requestId,kind==='collect'?'consumed':'released']);
}

export const stockActionSchema=z.object({id:z.uuid(),expectedVersion:z.number().int().positive(),kind:z.enum(['restock','sale','count']),quantity:z.number().nonnegative().max(999999999).refine(n=>Math.abs(n*1000-Math.round(n*1000))<1e-7),reason:z.string().trim().min(3).max(240)}).strict();
export async function adjustStock(c:PoolClient,storeId:string,sku:string,actor:string,input:z.infer<typeof stockActionSchema>){
 const p=stockActionSchema.parse(input),key='manual:'+p.id,inputHash=hash({sku,actor,...p});
 await c.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE',[storeId]);
 const previous=(await c.query('SELECT * FROM inventory_movements WHERE store_id=$1 AND operation_key=$2',[storeId,key])).rows[0];
 if(previous){if(previous.input_hash!==inputHash)throw conflict('This stock operation ID has different details.');return {sku,inventoryVersion:previous.inventory_version,replayed:true};}
 const row=(await c.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2 FOR UPDATE',[storeId,sku])).rows[0];
 if(!row||row.inventory_version!==p.expectedVersion)throw conflict('Stock changed. Reload before recording this movement.');
 const quantity=stockMilli(p.quantity),reserved=stockMilli(row.reserved_stock);
 if(p.kind!=='count'&&quantity===0n||quantity%stockMilli(row.quantity_step)!==0n)throw conflict('Enter a positive quantity in the shop selling increment.');
 if(row.stock===null&&p.kind!=='count')throw conflict('Record the physical shelf count before restocking or recording a sale.');
 const before=row.stock===null?0n:stockMilli(row.stock),after=p.kind==='count'?quantity:p.kind==='restock'?before+quantity:before-quantity;
 if(after<reserved)throw conflict('This would use stock reserved for customer orders. Reconcile those orders first.');
 await movement(c,storeId,row,key,p.kind,stockDecimal(after),row.reserved_stock,actor,p.reason,null,inputHash);
 return {sku,inventoryVersion:row.inventory_version+1,onHand:Number(stockDecimal(after)),available:Number(stockDecimal(after-reserved)),replayed:false};
}

/** Catalog saves are counts too; never silently overwrite reservations from a stale draft. */
export async function catalogStock(c:PoolClient,storeId:string,sku:string,value:number|null,expected:number|undefined,version:number,actor='owner-catalog'){
 const row=(await c.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2 FOR UPDATE',[storeId,sku])).rows[0];
 if(!row)return;
 if(row.stock===null&&value===null||row.stock!==null&&value!==null&&stockMilli(row.stock)===stockMilli(value))return;
 if(row.inventory_version>1&&expected!==row.inventory_version)throw conflict('Stock changed while this product was open. Reload the physical count before saving.');
 const reserved=stockMilli(row.reserved_stock);
 if(value!==null&&stockMilli(value)%stockMilli(row.quantity_step)!==0n)throw conflict('The physical count must use the shop selling increment.');
 if(value===null&&reserved>0n||value!==null&&stockMilli(value)<reserved)throw conflict('The physical count cannot be less than reserved stock.');
 await movement(c,storeId,row,`catalog:${sku}:${version}`,row.inventory_version===1&&row.stock===null?'opening':'count',value===null?null:stockDecimal(stockMilli(value)),row.reserved_stock,actor,'Owner product count');
}
