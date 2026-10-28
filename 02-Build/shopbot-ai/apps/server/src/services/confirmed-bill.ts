import type {ConversationState,DraftLine,RichReply} from '../../../../packages/contracts/index.js';
import {say,unitName} from '../../../../packages/contracts/language.js';
import {formatMoney,lineTotal} from '../../../../packages/contracts/money.js';
import {messageBlocks} from '../../../../packages/contracts/customer-copy.js';
import {estimateLines} from './order-estimate.js';
import {INVOICE_ROWS_PER_PAGE} from './visual-images.js';
import {orderReference,visualBill} from './visual-ordering.js';

/** A shop-confirmed price notice, not a payment receipt or request for approval. */
export function confirmedPriceBill(language:ConversationState['replyLanguage'],orderId:string,lines:DraftLine[],totalPaise:number,storeName?:string):RichReply {
 const state:ConversationState={replyLanguage:language,version:0,draft:lines,pending:null,lastRequestId:orderId,fulfillment:'pickup',visualOrdering:true};
 const estimate=estimateLines(lines);
 if(!estimate.complete||estimate.knownSubtotalPaise!==totalPaise)throw new Error('Confirmed bill requires all prices and a matching total.');
 const title=say(state,'Confirmed price bill','உறுதி செய்த விலை Bill','Confirm panna vilai Bill');
 const ready=say(state,'The shop will tell you when the order is ready for pickup.','Order தயாரானதும் கடை தெரிவிக்கும்.','Order ready aanathum kadai sollum.');
 const total=`${say(state,'Total','மொத்தம்','Total')}: ${formatMoney(totalPaise)}`;
 const fullText=messageBlocks(`${title} · ${orderReference(orderId)}`,...lines.map((line,i)=>`${i+1}. ${line.name}\n${line.quantity} ${unitName(line.unit!,state,line.quantity!)} × ${formatMoney(line.pricePaise!)} = ${formatMoney(lineTotal(line.pricePaise!,line.quantity!))}`),total,ready);
 const invoice=visualBill(state),last=invoice.parts!.length-1;
 const parts=invoice.parts!.map((part,index)=>{
  const final=index===last,caption=last?say(state,`${title} · Page ${index+1}/${last+1}`,`${title} · பக்கம் ${index+1}/${last+1}`,`${title} · Page ${index+1}/${last+1}`):title;
  return {...part,buttons:[],text:messageBlocks(caption,orderReference(orderId),final?total:undefined,final?ready:undefined),cards:part.cards.map(card=>card.kind==='product'?card:{...card,kind:'bill' as const,invoiceType:'confirmed' as const,title,reference:orderReference(orderId),lines:last?[caption]:[],billRows:card.billRows?.map((row,rowIndex)=>{const line=lines[index*INVOICE_ROWS_PER_PAGE+rowIndex];return {...row,name:line.name,count:`${line.quantity} ${unitName(line.unit!,state,line.quantity!)}`,unitPrice:formatMoney(line.pricePaise!),total:formatMoney(lineTotal(line.pricePaise!,line.quantity!))};}),total:final?total:undefined,caption,footer:ready,buttons:[]})};
 });
 return {...invoice,kind:'text',stage:'status',readOnly:true,replyLanguage:language,storeName,parts,text:fullText,accessibleText:fullText,buttons:[]};
}
