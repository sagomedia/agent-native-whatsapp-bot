import type {ConversationState,DraftLine,Pending} from '../../../../packages/contracts/index.js';
import {lineName,unitName,say,indicativePriceFor} from '../../../../packages/contracts/language.js';
import {customerCopy,messageBlocks} from '../../../../packages/contracts/customer-copy.js';
import {formatMoney,lineTotal} from '../../../../packages/contracts/money.js';
import {counterLine} from './counter-state.js';
import {amountToCount} from './quantity-evidence.js';

export function estimateLines(lines:DraftLine[]) {
 const priced=lines.filter(line=>counterLine(line).canQuote||!!line.merchantConfirmed&&line.quantity!==null&&line.quantity>0&&!!line.unit&&line.pricePaise!==undefined&&(line.pricePaise>0||line.merchantConfirmed.free));
 const excluded=lines.filter(line=>!priced.includes(line));
 return {knownSubtotalPaise:priced.reduce((n,line)=>n+lineTotal(line.pricePaise!,line.quantity!),0),complete:lines.length>0&&!excluded.length,excludedLineIds:excluded.map(line=>line.id),priced,excluded};
}

/** Display-only arithmetic over explicit selling counts; never a final quote. */
export function indicativeLineEstimate(line:DraftLine) {
 const product=counterLine(line).product,price=product?indicativePriceFor(product):undefined;
 if(!product||!price||line.quantity===null||!Number.isFinite(line.quantity)||line.quantity<=0||line.quantity>100||line.unit!==product.unit||line.resolution==='needs_choice'||line.resolution==='needs_unit'||line.productIntent?.kind==='ambiguous')return;
 if(line.catalogIssue&&!['price_unverified','selling_unit_unverified'].includes(line.catalogIssue))return;
 const step=product.quantityStep||1;
 if(Math.abs(line.quantity/step-Math.round(line.quantity/step))>1e-7)return;
 // An amount expressed in another unit requires existing verified conversion,
 // not the indicative amount or a pack size inferred from a product title.
 if(line.requestedAmount&&(!product.sellingUnitVerified||amountToCount(line,product)!==line.quantity))return;
 return {pricePaise:price.pricePaise,totalPaise:lineTotal(price.pricePaise,line.quantity)};
}
export function indicativeEstimate(lines:DraftLine[]) {
 const exact=estimateLines(lines),indicative=exact.excluded.filter(line=>!!indicativeLineEstimate(line));
 return {indicative,subtotalPaise:exact.knownSubtotalPaise+indicative.reduce((sum,line)=>sum+indicativeLineEstimate(line)!.totalPaise,0),unpriced:exact.excluded.filter(line=>!indicative.includes(line))};
}

/** The next missing fact for each excluded line, never a fabricated price. */
export function estimatePendingReason(line:DraftLine):'product'|'unit'|'quantity'|'price'|'details' {
 const facts=counterLine(line);
 if(!facts.product||line.productIntent?.kind==='ambiguous'||line.resolution==='needs_choice')return 'product';
 if(facts.blockers.includes('unit'))return 'unit';
 if(facts.blockers.includes('quantity'))return 'quantity';
 if(facts.product.priceStatus==='confirm'||facts.product.pricePaise===0&&facts.product.priceStatus!=='free')return 'price';
 return 'details';
}
export function estimatePendingSummary(state:ConversationState,lines:DraftLine[]=state.draft):string|undefined {
 const counts=new Map<ReturnType<typeof estimatePendingReason>,number>();
 for(const line of indicativeEstimate(lines).unpriced){const reason=estimatePendingReason(line);counts.set(reason,(counts.get(reason)??0)+1);}
 if(!counts.size)return;
 return [...counts].map(([reason,count])=>({
  product:say(state,`${count} product choices pending`,`${count} பொருள் தேர்வு தேவை`,`${count} product choice venum`),
  unit:say(state,`${count} selling units to check`,`${count} விற்பனை அளவு சரிபார்க்கணும்`,`${count} selling unit check pannanum`),
  quantity:say(state,`${count} quantities needed`,`${count} எண்ணிக்கை சொல்லணும்`,`${count} count sollanum`),
  price:say(state,`${count} prices pending`,`${count} விலை சரிபார்க்கணும்`,`${count} vilai check pannanum`),
  details:say(state,`${count} item details to check`,`${count} பொருள் விவரம் சரிபார்க்கணும்`,`${count} item details check pannanum`),
 }[reason])).join(' · ');
}
export function estimateTotalText(state:ConversationState,lines:DraftLine[]=state.draft):string {
 const estimate=estimateLines(lines),display=indicativeEstimate(lines);
 if(display.indicative.length)return say(state,`Approximate ${display.unpriced.length?'subtotal':'total'}: ${formatMoney(display.subtotalPaise)}`,`சுமார்: ${formatMoney(display.subtotalPaise)}`,`Sumaar: ${formatMoney(display.subtotalPaise)}`);
 if(!estimate.priced.length)return say(state,'The shop will confirm prices.','விலையை கடையில் சரிபார்த்து சொல்றோம்.','Vilaiyai kadaiyil check panni solrom.');
 return say(state,`${estimate.complete?'Estimated total':'Known subtotal'}: ${formatMoney(estimate.knownSubtotalPaise)}`,`${estimate.complete?'Estimate':'தெரிஞ்ச விலை'}: ${formatMoney(estimate.knownSubtotalPaise)}`,`${estimate.complete?'Estimate':'Therinja vilai'}: ${formatMoney(estimate.knownSubtotalPaise)}`);
}
export function estimateText(state:ConversationState,lines=state.draft,advance=false,review=true) {
 const estimate=estimateLines(lines),display=indicativeEstimate(lines),blocks=lines.map((line,index)=>{
  const priced=estimate.priced.includes(line),indicative=indicativeLineEstimate(line),requestedCount=line.quantity??line.requestedQuantity;
  const count=line.requestedAmount?`${line.requestedAmount.value} ${line.requestedAmount.unit}`:requestedCount!==undefined&&requestedCount!==null?`${requestedCount} ${unitName(line.requestedUnit??line.unit??'unit',state,requestedCount)}`:say(state,'quantity to check','Count இன்னும் சொல்லணும்','Count innum sollanum');
  const name=`${index+1}. ${(line.merchantConfirmed?line.name:lineName(line,state))} — ${count}`;
  return priced?`${name}\n   ${formatMoney(line.pricePaise!)} / ${unitName(line.unit??'unit',state)}\n   ${say(state,'This item','இந்த item','Intha item')}: ${formatMoney(lineTotal(line.pricePaise!,line.quantity!))}`:indicative?`${name}\n   ${say(state,'Approx.','சுமார்','Sumaar')} ${formatMoney(indicative.pricePaise)} / ${unitName(line.unit!,state)}\n   ${say(state,'Approx. amount','உத்தேச தொகை','Uththesa thogai')}: ${formatMoney(indicative.totalPaise)}`:`${name}\n   ${say(state,'Shop needs to confirm product, unit or price. Price excluded.','கடை check பண்ணணும். விலை இன்னும் confirm ஆகல.','Kadai check pannanum. Vilai innum confirm aagala.')}`;
 });
 return messageBlocks(`*${customerCopy('estimate',state)}*`,...blocks,display.indicative.length?`*${estimateTotalText(state,lines)}*`:estimate.priced.length?`*${customerCopy(estimate.complete?'completeEstimate':'knownSubtotal',state,{amount:formatMoney(estimate.knownSubtotalPaise)})}*`:customerCopy('noEstimate',state),display.indicative.length?say(state,'Indicative prices; the shop confirms the final bill.','உத்தேச விலை · இறுதி விலையை கடை உறுதி செய்யும்.','Uththesa vilai · final vilaiyai kadai confirm pannum.'):undefined,display.unpriced.length?customerCopy('excluded',state,{items:say(state,`${display.unpriced.length} item${display.unpriced.length===1?'':'s'}`,`${display.unpriced.length} items`,`${display.unpriced.length} items`)}):undefined,review?customerCopy(advance?'advanceReview':'review',state):undefined);
}
export function partialReview(pending:Pending|null):pending is Extract<Pending,{kind:'review'}>&{excludedLineIds:string[]} {
 return pending?.kind==='review'&&!!pending.excludedLineIds?.length;
}
