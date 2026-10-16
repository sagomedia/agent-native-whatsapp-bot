import {randomUUID} from 'node:crypto';
import type {ConversationState,DraftLine,RichReply} from '../../../../packages/contracts/index.js';
import {say,unitName} from '../../../../packages/contracts/language.js';
import {formatMoney,lineTotal} from '../../../../packages/contracts/money.js';
import {messageBlocks} from '../../../../packages/contracts/customer-copy.js';
import {estimateLines} from './order-estimate.js';
import {visualBill,orderReference} from './visual-ordering.js';

export type QuotePresentation={id:string;requestId:string;version:number;lines:DraftLine[];totalPaise:number;previousLines:DraftLine[];previousTotalPaise:number;advancePaise:number;storeName?:string};
export function finalQuotePresentation(language:ConversationState['replyLanguage'],quote:QuotePresentation):RichReply {
 const state:ConversationState={replyLanguage:language,version:quote.version,draft:quote.lines,pending:null,lastRequestId:quote.requestId,fulfillment:'pickup',visualOrdering:true};
 const estimate=estimateLines(quote.lines);
 if(!estimate.complete||estimate.knownSubtotalPaise!==quote.totalPaise)throw new Error('A final quote must contain every priced line and the matching total.');
 const changes=quote.lines.flatMap(line=>{
  const old=quote.previousLines.find(l=>l.id===line.id);
  if(old&&old.name===line.name&&old.quantity===line.quantity&&old.unit===line.unit&&old.pricePaise===line.pricePaise&&!old.catalogIssue)return [];
  const before=old?.pricePaise!==undefined&&old.quantity!==null&&!old.catalogIssue?formatMoney(lineTotal(old.pricePaise,old.quantity)):say(state,'not priced','விலை சேர்க்கல','Vilai serkkala');
  const after=formatMoney(lineTotal(line.pricePaise!,line.quantity!));
  const basis=old&&(old.quantity!==line.quantity||old.unit!==line.unit)?`${old.quantity??old.requestedQuantity??'?'} ${old.unit??old.requestedUnit??'?'} → ${line.quantity} ${line.unit}; `:'';
  return [`${line.name}: ${basis}${before} → ${after}`];
 });
 const difference=quote.totalPaise-quote.previousTotalPaise;
 const previousKnown=estimateLines(quote.previousLines).priced.length>0;
 const summary=messageBlocks(previousKnown?say(state,`Earlier known subtotal: ${formatMoney(quote.previousTotalPaise)}`,`முந்தைய தெரிந்த விலை: ${formatMoney(quote.previousTotalPaise)}`,`Munthaya therintha vilai: ${formatMoney(quote.previousTotalPaise)}`):say(state,'Earlier prices were still pending.','முந்தைய list-க்கு விலை இன்னும் வரல.','Munthaya list-ku vilai innum varala.'),changes.length?say(state,`${changes.length} items checked/changed. Difference: ${difference<0?'−':'+'}${formatMoney(Math.abs(difference))}.`,`${changes.length} items check பண்ணி update ஆகியிருக்கு. மாற்றம்: ${difference<0?'−':'+'}${formatMoney(Math.abs(difference))}.`,`${changes.length} items check panni update aagiyirukku. Maaththam: ${difference<0?'−':'+'}${formatMoney(Math.abs(difference))}.`):say(state,'Items and prices are unchanged.','Items-ம் விலையும் மாறல.','Items-um vilaiyum maarala.'));
 const paid=quote.advancePaise,balance=quote.totalPaise-paid;
 const payment=[say(state,`Verified advance: ${formatMoney(paid)}`,`வந்த advance: ${formatMoney(paid)}`,`Vantha advance: ${formatMoney(paid)}`),balance>=0?say(state,`Remaining balance: ${formatMoney(balance)}`,`இன்னும் தர வேண்டியது: ${formatMoney(balance)}`,`Innum thara vendiyathu: ${formatMoney(balance)}`):say(state,`Excess advance: ${formatMoney(-balance)}. The shop must arrange its refund.`,`Advance-ல ${formatMoney(-balance)} மீதி இருக்கு. கடை refund check பண்ணணும்.`,`Advance-la ${formatMoney(-balance)} meethi irukku. Kadai refund check pannanum.`)];
 const controls:NonNullable<RichReply['buttons']>=[{label:say(state,'Bill is correct','Bill சரி','Bill sari'),event:{id:randomUUID(),type:'confirm_order_quote',quoteId:quote.id,expectedVersion:quote.version}},{label:say(state,'Change the bill','Bill மாற்றணும்','Bill maathanum'),event:{id:randomUUID(),type:'shopping_action',action:'edit_quote',expectedVersion:quote.version}}];
 const visibleChanges:string[]=[];let space=540;
 for(const change of changes){const length=Array.from(change).length;if(length>space)break;visibleChanges.push(change);space-=length+2;}
 const fullText=messageBlocks(say(state,'Final shop quote','கடை check பண்ணிய bill','Kadai check pannina bill'),summary,...changes,...quote.lines.map((l,i)=>`${i+1}. ${l.name}\n${l.quantity} ${unitName(l.unit!,state,l.quantity!)} × ${formatMoney(l.pricePaise!)} = ${formatMoney(lineTotal(l.pricePaise!,l.quantity!))}`),`${say(state,'Total','மொத்தம்','Moththam')}: ${formatMoney(quote.totalPaise)}`,...payment,say(state,'Is this final quote correct?','இந்த bill சரியா?','Intha bill sariyaa?'));
 const invoice=visualBill(state),lastIndex=invoice.parts!.length-1;
 const parts=invoice.parts!.map((part,index)=>{
  const final=index===lastIndex,caption=say(state,`Shop quote ${index+1} / ${lastIndex+1}`,`கடை Bill ${index+1} / ${lastIndex+1}`,`Kadai Bill ${index+1} / ${lastIndex+1}`);
  return {...part,text:messageBlocks(caption,final?summary:undefined,...(final?visibleChanges:[]),final&&visibleChanges.length<changes.length?say(state,'More changed items are shown in the invoice.','மத்த changes-ம் Bill-ல இருக்கு.','Maththa changes-um Bill-la irukku.'):undefined,final?`${say(state,'Total','மொத்தம்','Moththam')}: ${formatMoney(quote.totalPaise)}`:undefined,final?say(state,'Check the invoice, then approve this bill or request a change.','Bill-ஐ பாருங்க. சரின்னா confirm பண்ணுங்க; இல்லனா மாற்றம் சொல்லலாம்.','Bill-ai paarunga. Sarinna confirm pannunga; illana maaththam sollalaam.'):undefined),cards:part.cards.map(card=>card.kind==='product'?card:{...card,kind:'bill' as const,invoiceType:'quote' as const,title:say(state,'Final shop quote','கடை Bill','Kadai Bill'),reference:orderReference(quote.requestId)+' · Quote #'+quote.id.slice(0,8).toUpperCase(),lines:[caption,...(final?[...summary.split(/\n\n/),...payment]:[])],total:final?`${say(state,'Total','மொத்தம்','Moththam')}: ${formatMoney(quote.totalPaise)}`:undefined,caption,footer:say(state,'Shop quote · approve these items, quantities and prices.','கடை Bill · Items, count, விலை சரியா பார்த்து confirm பண்ணுங்க.','Kadai Bill · Items, count, vilai sariyaa paathu confirm pannunga.'),buttons:final?controls:[]})};
 });
 return {...invoice,readOnly:true,storeName:quote.storeName,replyLanguage:language,parts,text:fullText,accessibleText:fullText,buttons:controls};
}
