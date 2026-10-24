import {z} from 'zod';
import type {Pool} from 'pg';
import {mutate,chatError,type CatalogPrincipal} from './catalog-chat.js';
import {reviewOwnerOrder,completeOwnerOrder,decideOwnerOrder,fulfillOwnerOrder} from './owner-order-actions.js';
import {ownerOrderReviewSchema} from './owner-order-review.js';
import {saveQuoteDraftSchema,saveQuoteDraft} from './order-quote-drafts.js';
import {orderQuoteSchema,offerOrderQuote} from './order-quotes.js';
import {decideAmendment} from './order-amendments.js';
import {adjustStock,stockActionSchema} from './inventory.js';
import {saveCatalogProduct} from './catalog-products.js';
const envelope={operationId:z.uuid(),orderId:z.uuid()};
export const orderReviewInput=z.object({...envelope,review:ownerOrderReviewSchema.omit({id:true,notify:true}),physicalCheckConfirmed:z.boolean().default(false)}).strict().refine(v=>v.review.action!=='ready'||v.physicalCheckConfirmed,'Ask the seller to confirm the physical items before marking ready.');
export const orderDecisionInput=z.object({...envelope,expectedRevision:z.number().int().positive(),decision:z.enum(['accepted','rejected'])}).strict();
export const orderFulfillmentInput=z.object({...envelope,expectedRevision:z.number().int().positive(),expected:z.enum(['awaiting_approval','preparing','ready_for_pickup','collected','cancelled']),status:z.enum(['ready_for_pickup','collected','cancelled']),physicalCheckConfirmed:z.boolean().default(false),reason:z.literal('not_picked_up').optional()}).strict().refine(v=>v.status!=='ready_for_pickup'||v.physicalCheckConfirmed,'Ask the seller to confirm the physical items before marking ready.').refine(v=>!v.reason||(v.status==='cancelled'&&v.expected==='ready_for_pickup'),'Not picked up only applies to a ready order.');
export const orderCompleteInput=z.object({...envelope,expectedRevision:z.number().int().positive()}).strict();
export const quoteSaveInput=z.object({...envelope,draft:saveQuoteDraftSchema}).strict();
export const quoteOfferInput=z.object({...envelope,quote:orderQuoteSchema.omit({id:true})}).strict();
export const amendmentInput=z.object({operationId:z.uuid(),amendmentId:z.uuid(),expectedRevision:z.number().int().positive(),decision:z.enum(['accepted','rejected'])}).strict();
export async function ownerOrderAction(pool:Pool,p:CatalogPrincipal,action:'review'|'decision'|'fulfillment'|'complete'|'quote_save'|'quote_offer'|'amendment',input:any){
 const schemas={review:orderReviewInput,decision:orderDecisionInput,fulfillment:orderFulfillmentInput,complete:orderCompleteInput,quote_save:quoteSaveInput,quote_offer:quoteOfferInput,amendment:amendmentInput};
 const a=schemas[action].parse(input) as any;
 return mutate(pool,p,'orders:write',a.operationId,'owner_order_'+action,a,async c=>{
  const scope={storeId:p.storeId,actor:p.actor};let requestId=a.orderId;
  if(action==='amendment'){
   const row=(await c.query('SELECT request_id FROM order_amendments WHERE store_id=$1 AND id=$2',[p.storeId,a.amendmentId])).rows[0];if(!row)throw chatError('not_found','Amendment not found in this shop.',404);requestId=row.request_id;
  }
  const r=(await c.query('SELECT effective_revision FROM order_requests WHERE store_id=$1 AND id=$2 FOR UPDATE',[p.storeId,requestId])).rows[0];if(!r)throw chatError('not_found','Order not found in this shop.',404);
  const expected=a.expectedRevision??a.review?.expectedRevision??a.draft?.expectedRevision??a.quote?.expectedRevision;
  if(r.effective_revision!==expected)throw chatError('stale_version','The order changed. Read orders_get and reconcile before retrying.');
  let result:unknown;
  if(action==='review')result=await reviewOwnerOrder(c,scope,requestId,{...a.review,id:a.operationId,notify:false});
  if(action==='decision')result=await decideOwnerOrder(c,scope,requestId,{decision:a.decision,notify:false});
  if(action==='fulfillment')result=await fulfillOwnerOrder(c,scope,requestId,{...a,packedChecked:a.physicalCheckConfirmed,notify:false});
  if(action==='complete')result=await completeOwnerOrder(c,scope,requestId,a);
  if(action==='quote_save')result=await saveQuoteDraft(c,p.storeId,requestId,p.actor,a.draft);
  if(action==='quote_offer'){const offered=await offerOrderQuote(c,p.storeId,requestId,p.actor,{...a.quote,id:a.operationId});result={quoteId:offered.quote.id,replayed:offered.replayed};}
  if(action==='amendment'){const amended=await decideAmendment(c,p.storeId,a.amendmentId,p.actor,a.decision);result={amendmentId:amended.row.id,state:amended.row.state,replayed:amended.replayed};}
  return {operationId:a.operationId,orderId:requestId,result,customerNotification:'not_requested',note:'No customer message was sent. Notification and payment actions remain separate dashboard workflows.'};
 });
}
export const stockInput=z.object({operationId:z.uuid(),sku:z.string().min(1).max(64),movement:stockActionSchema.omit({id:true})}).strict();
export async function ownerStockAction(pool:Pool,p:CatalogPrincipal,input:unknown){const a=stockInput.parse(input);return mutate(pool,p,'catalog:publish',a.operationId,'stock',a,c=>adjustStock(c,p.storeId,a.sku,p.actor,{...a.movement,id:a.operationId}));}
export const visibilityInput=z.object({operationId:z.uuid(),sku:z.string().min(1).max(64),expectedVersion:z.number().int().positive(),active:z.boolean()}).strict();
export async function ownerProductVisibility(pool:Pool,p:CatalogPrincipal,input:unknown){const a=visibilityInput.parse(input);return mutate(pool,p,'catalog:publish',a.operationId,'visibility',a,async c=>{
 const row=(await c.query('SELECT * FROM products WHERE store_id=$1 AND sku=$2 FOR UPDATE',[p.storeId,a.sku])).rows[0];if(!row)throw chatError('not_found','Product not found in this shop.',404);if(row.version!==a.expectedVersion)throw chatError('stale_version','The product changed. Read catalog_get_product before retrying.');
 if(a.active){return saveCatalogProduct(c,p.storeId,{sku:row.sku,version:row.version,inventoryVersion:row.inventory_version,name:row.name,unit:row.unit,pricePaise:row.price_paise,priceStatus:row.price_status,stock:row.stock===null?null:Number(row.stock),localNames:row.local_names,aliases:row.aliases,keywords:row.keywords,quantityStep:Number(row.quantity_step),familyId:row.family_id??'',brand:row.brand??'',specifications:row.specifications,active:true,verified:true,verification:row.merchant_verification,sellingPolicy:row.selling_policy});}
 return (await c.query('UPDATE products SET active=false,version=version+1,inventory_updated_at=now() WHERE store_id=$1 AND sku=$2 RETURNING sku,version,active',[p.storeId,a.sku])).rows[0];
 });}
