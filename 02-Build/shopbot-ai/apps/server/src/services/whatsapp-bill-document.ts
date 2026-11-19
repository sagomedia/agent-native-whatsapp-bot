import type {RichReply,VisualCard} from '../../../../packages/contracts/index.js';
import {renderBillPdf} from './order-bill-pdf.js';
import {fitText,renderWhatsAppReply} from './whatsapp-reply.js';

type BillCard=Exclude<VisualCard,{kind:'product'}>;
function billCards(reply:RichReply):BillCard[]|undefined{
 if(!reply.parts?.length||reply.parts.some(part=>!part.cards.length||part.cards.some(card=>card.kind==='product'||!card.billRows?.length)))return;
 return reply.parts.flatMap(part=>part.cards) as BillCard[];
}

/** Combine only itemized pages. Browsing cards and mixed replies keep their own presentation. */
export function singleBillDocument(reply:RichReply):RichReply{
 const cards=billCards(reply);
 if(!cards)return reply;
 const final=reply.parts!.at(-1)!,last=cards.at(-1)!;
 const lines=final.text.split('\n');
 if(lines[0]===last.caption&&lines.length>1)lines.shift();
 return {...reply,parts:[{...final,text:lines.join('\n'),cards}],outboundMessages:1};
}

export async function renderWhatsAppOutgoing(reply:RichReply,id:string,hostname:string,shop?:{name:string;address?:string;customer?:string}){
 const cards=billCards(reply);
 if(!cards)return {...renderWhatsAppReply(reply,id,hostname),pdf:undefined};
 const last=cards.at(-1)!,linked=reply.parts!.at(-1)!;
 const title=last.invoiceType==='quote'?'SHOP QUOTE':last.invoiceType==='confirmed'?'CONFIRMED PRICE BILL':'ESTIMATE';
 const reference=last.reference??'Estimate '+id.slice(0,8).toUpperCase();
 const filename=`ShopBot-${title.toLowerCase().replaceAll(' ','-')}-${id.slice(0,8)}.pdf`;
 const [label,...totalParts]=(last.total??'').split(':');
 const notes=[...(last.lines??[]).filter(line=>line!==last.caption),last.footer].filter((line):line is string=>!!line);
 const pdf=await renderBillPdf({
  title,reference,issuedAt:new Date(),storeName:reply.storeName??shop?.name??'Shop',storeAddress:shop?.address,customerName:shop?.customer,
  rows:cards.flatMap(card=>card.billRows!.map(row=>({
   description:row.name,detail:[row.packSize,row.unitPrice==='—'&&row.total!=='—'?row.total:''].filter(Boolean).join(' · '),
   rate:row.unitPrice,quantity:row.count,amount:row.unitPrice==='—'?'—':row.total,
  }))),
  totalLabel:label||'Total',total:totalParts.join(':').trim(),notes,
 });
 const buttons=(last.buttons??linked.buttons??reply.buttons??[]).slice(0,3);
 const text=fitText(linked.text,1024);
 if(!buttons.length)return {payload:{type:'document',document:{filename,caption:text}},actions:[],pdf};
 const bound=renderWhatsAppReply({...reply,text,parts:undefined,presentation:'text',cards:[],buttons},id,hostname);
 const interactive=bound.payload.interactive as Record<string,unknown>;
 return {payload:{...bound.payload,interactive:{...interactive,header:{type:'document',document:{filename}}}},actions:bound.actions,pdf};
}
