import type {ConversationState,DraftLine,RichReply} from '../../../../packages/contracts/index.js';
import {say,unitName} from '../../../../packages/contracts/language.js';
import {formatMoney,lineTotal} from '../../../../packages/contracts/money.js';
import {messageBlocks} from '../../../../packages/contracts/customer-copy.js';
import {estimateLines} from './order-estimate.js';
import {INVOICE_ROWS_PER_PAGE} from './visual-images.js';
import {orderReference,visualBill} from './visual-ordering.js';

type FinalBillDetails={date:string;address?:string;revision:number;updated:boolean;fulfillment:'ready_for_pickup'|'collected'};

const billDate=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});

/** A shop-confirmed price notice, not a payment receipt or request for approval. */
export function confirmedPriceBill(language:ConversationState['replyLanguage'],orderId:string,lines:DraftLine[],totalPaise:number,storeName?:string,details?:FinalBillDetails):RichReply {
 const state:ConversationState={replyLanguage:language,version:0,draft:lines,pending:null,lastRequestId:orderId,fulfillment:'pickup',visualOrdering:true};
 const estimate=estimateLines(lines);
 if(!estimate.complete||estimate.knownSubtotalPaise!==totalPaise)throw new Error('Confirmed bill requires all prices and a matching total.');
 const title=details
  ? details.updated?say(state,'Updated final bill','திருத்திய இறுதி பில்','Updated final bill')
    :details.fulfillment==='collected'?say(state,'Final bill','இறுதி பில்','Final bill'):say(state,'Final pickup bill','இறுதி பில்','Final pickup bill')
  : say(state,'Confirmed price bill','உறுதி செய்த விலை Bill','Confirm panna vilai Bill');
 const ready=details
  ? details.fulfillment==='collected'
    ? say(state,'The shop has checked your items and prices.','பொருட்களையும் விலைகளையும் கடை சரிபார்த்துவிட்டது.','Items-um vilaiyum kadai check panniyachu.')
    : say(state,'The shop has checked your items and prices. Your order is ready for pickup.','பொருட்களையும் விலைகளையும் கடை சரிபார்த்துவிட்டது. உங்கள் ஆர்டர் எடுத்துச் செல்லத் தயார்.','Items-um vilaiyum kadai check panniyachu. Unga order pickup-ku ready.')
  : say(state,'The shop will tell you when the order is ready for pickup.','Order தயாரானதும் கடை தெரிவிக்கும்.','Order ready aanathum kadai sollum.');
 const total=`${say(state,details?'Final total':'Total','மொத்தம்','Total')}: ${formatMoney(totalPaise)}`;
 const reference=orderReference(orderId);
 const header=details?{
  address:details.address,date:billDate.format(new Date(details.date)),
  details:details.updated?[say(state,`Revision ${details.revision}`,`பதிப்பு ${details.revision}`,`Revision ${details.revision}`)]:undefined,
 }:undefined;
 const replaces=details?.updated?say(state,'This bill replaces the previous one.','முந்தைய பில்லுக்கு பதிலாக இந்த பில்லைப் பயன்படுத்துங்கள்.','Munnaadi anuppina bill-ku badhila idhai use pannunga.'):undefined;
 const fullText=messageBlocks(`${title} · ${orderReference(orderId)}`,...lines.map((line,i)=>`${i+1}. ${line.name}\n${line.quantity} ${unitName(line.unit!,state,line.quantity!)} × ${formatMoney(line.pricePaise!)} = ${formatMoney(lineTotal(line.pricePaise!,line.quantity!))}`),total,ready,replaces);
 const invoice=visualBill(state),last=invoice.parts!.length-1;
 const parts=invoice.parts!.map((part,index)=>{
  const final=index===last,page=last?say(state,`Page ${index+1}/${last+1}`,`பக்கம் ${index+1}/${last+1}`,`Page ${index+1}/${last+1}`):undefined,caption=last?say(state,`${title} · Page ${index+1}/${last+1}`,`${title} · பக்கம் ${index+1}/${last+1}`,`${title} · Page ${index+1}/${last+1}`):title;
  return {...part,buttons:[],text:messageBlocks(caption,reference,final?ready:undefined,final?total:undefined,final?replaces:undefined),cards:part.cards.map(card=>card.kind==='product'?card:{...card,kind:'bill' as const,invoiceType:'confirmed' as const,title,reference,billHeader:header?{...header,page}:undefined,lines:!header&&last?[caption]:final&&replaces?[replaces]:[],billRows:card.billRows?.map((row,rowIndex)=>{const line=lines[index*INVOICE_ROWS_PER_PAGE+rowIndex];return {...row,name:line.name,count:`${line.quantity} ${unitName(line.unit!,state,line.quantity!)}`,unitPrice:formatMoney(line.pricePaise!),total:formatMoney(lineTotal(line.pricePaise!,line.quantity!))};}),total:final?total:undefined,caption:details?'':caption,footer:ready,buttons:[]})};
 });
 return {...invoice,kind:'text',stage:'status',readOnly:true,replyLanguage:language,storeName,parts,text:fullText,accessibleText:fullText,buttons:[]};
}
