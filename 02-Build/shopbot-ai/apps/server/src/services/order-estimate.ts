import type {ConversationState,DraftLine,Pending} from '../../../../packages/contracts/index.js';
import {lineName,unitName,say} from '../../../../packages/contracts/language.js';
import {customerCopy,messageBlocks} from '../../../../packages/contracts/customer-copy.js';
import {formatMoney,lineTotal} from '../../../../packages/contracts/money.js';
import {counterLine} from './counter-state.js';

export function estimateLines(lines:DraftLine[]) {
 const priced=lines.filter(line=>counterLine(line).canQuote||!!line.merchantConfirmed&&line.quantity!==null&&line.quantity>0&&!!line.unit&&line.pricePaise!==undefined&&(line.pricePaise>0||line.merchantConfirmed.free));
 const excluded=lines.filter(line=>!priced.includes(line));
 return {knownSubtotalPaise:priced.reduce((n,line)=>n+lineTotal(line.pricePaise!,line.quantity!),0),complete:lines.length>0&&!excluded.length,excludedLineIds:excluded.map(line=>line.id),priced,excluded};
}
export function estimateText(state:ConversationState,lines=state.draft,advance=false,review=true) {
 const estimate=estimateLines(lines),blocks=lines.map((line,index)=>{
  const priced=estimate.priced.includes(line),count=line.requestedAmount?`${line.requestedAmount.value} ${line.requestedAmount.unit}`:line.quantity!==null?`${line.quantity} ${unitName(line.requestedUnit??line.unit??'unit',state,line.quantity)}`:say(state,'quantity to check','Count இன்னும் சொல்லணும்','Count innum sollanum');
  const name=`${index+1}. ${(line.merchantConfirmed?line.name:lineName(line,state))} — ${count}`;
  return priced?`${name}\n   ${formatMoney(line.pricePaise!)} / ${unitName(line.unit??'unit',state)}\n   ${say(state,'This item','இந்த item','Intha item')}: ${formatMoney(lineTotal(line.pricePaise!,line.quantity!))}`:`${name}\n   ${say(state,'Shop needs to confirm product, unit or price. Price excluded.','கடை check பண்ணணும். விலை இன்னும் confirm ஆகல.','Kadai check pannanum. Vilai innum confirm aagala.')}`;
 });
 return messageBlocks(`*${customerCopy('estimate',state)}*`,...blocks,estimate.priced.length?`*${customerCopy(estimate.complete?'completeEstimate':'knownSubtotal',state,{amount:formatMoney(estimate.knownSubtotalPaise)})}*`:customerCopy('noEstimate',state),estimate.excluded.length?customerCopy('excluded',state,{items:estimate.excluded.map(l=>lineName(l,state)).join(', ')}):undefined,review?customerCopy(advance?'advanceReview':'review',state):undefined);
}
export function partialReview(pending:Pending|null):pending is Extract<Pending,{kind:'review'}>&{excludedLineIds:string[]} {
 return pending?.kind==='review'&&!!pending.excludedLineIds?.length;
}
