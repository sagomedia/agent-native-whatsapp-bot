import type {ConversationState,DraftLine,ProductCheck} from '../../../../packages/contracts/index.js';
import {needsPipeType} from './catalog-discovery.js';
import {productConfirmed,productIdentity} from './product-confirmation.js';

export type CounterBlocker='specification'|'variant'|'product_confirmation'|'quantity'|'unit'|'shop_check';

/** A view of existing facts, never another persisted order state. */
export function counterLine(line:DraftLine) {
  const product=line.candidates?.find(p=>p.sku===line.sku);
  const blockers:CounterBlocker[]=[];
  if(line.productIntent?.kind==='ambiguous'||!line.sku&&needsPipeType(line.query??line.name))blockers.push('specification');
  else if(!product)blockers.push(line.candidates?.length?'variant':'shop_check');
  if(line.resolution==='unavailable'||line.catalogIssue)blockers.push(line.resolution==='needs_unit'?'unit':'shop_check');
  if(product&&!productConfirmed(line,product))blockers.push('product_confirmation');
  if(line.quantity===null||!Number.isFinite(line.quantity)||line.quantity<=0)blockers.push('quantity');
  if(line.resolution==='needs_unit')blockers.push('unit');
  const priced=!!product&&product.priceStatus!=='confirm'&&(product.pricePaise>0||product.priceStatus==='free');
  const current=!!product&&line.productVersion===product.version&&line.pricePaise===product.pricePaise&&line.unit===product.unit;
  const enough=!!product&&(product.stock===null||line.quantity!==null&&product.stock>=line.quantity);
  const step=product?.quantityStep??1;
  const validCount=line.quantity!==null&&Number.isFinite(line.quantity)&&line.quantity>0&&line.quantity<=100&&Number.isFinite(step)&&step>0&&Math.abs(line.quantity/step-Math.round(line.quantity/step))<1e-7;
  if(!validCount&&!blockers.includes('quantity'))blockers.push('quantity');
  const canQuote=line.resolution==='matched'&&priced&&current&&enough&&!line.catalogIssue&&validCount;
  if(product&&!canQuote&&line.resolution==='matched'&&!blockers.includes('quantity'))blockers.push('shop_check');
  return {product,blockers:[...new Set(blockers)],canQuote,ready:canQuote&&productConfirmed(line,product)};
}

export function nextCounterLine(state:ConversationState) {
  const ready=(line:DraftLine)=>{const facts=counterLine(line);return facts.canQuote&&(!state.requireProductConfirmation||facts.ready);};
  const active=state.editingLineId??(state.pending?.kind==='question'?state.pending.lineId:undefined);
  return state.draft.find(line=>line.id===active&&!line.shopCheckDeferred&&!ready(line))
    ??state.draft.find(line=>!line.shopCheckDeferred&&!ready(line))
    ??state.draft.find(line=>!ready(line));
}

/** Product identity consent is distinct from a complete priced bill. */
export function productCheckCoversDraft(state:ConversationState,check:ProductCheck) {
  return state.draft.length>0&&check.groups.length===state.draft.length
    &&new Set(check.groups.map(g=>g.lineId)).size===state.draft.length
    &&state.draft.every(line=>{
      const group=check.groups.find(g=>g.lineId===line.id),product=counterLine(line).product;
      return !!product&&line.resolution!=='unavailable'&&line.productIntent?.kind!=='ambiguous'
        &&group?.products.length===1&&productIdentity(group.products[0])===productIdentity(product);
    });
}

export function canQuoteDraft(state:ConversationState) {
  return state.draft.length>0&&state.draft.every(line=>counterLine(line).canQuote);
}
