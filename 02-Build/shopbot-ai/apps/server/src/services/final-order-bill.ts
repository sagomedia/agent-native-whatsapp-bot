import type {PoolClient} from 'pg';
import type {DraftLine,RichReply} from '../../../../packages/contracts/index.js';
import type {ReplyLanguage} from '../../../../packages/contracts/language.js';
import {formatMoney} from '../../../../packages/contracts/money.js';
import {recipientAllowed} from './customer-admission.js';
import {ToolError} from './context.js';
import {confirmedPriceBill} from './confirmed-bill.js';
import {estimateLines} from './order-estimate.js';
import {queueOrderNotice} from './order-notices.js';
import {materializeVisualReply} from './visual-images.js';
import type {WhatsAppConfig} from './whatsapp-config.js';

type BillOrder={
  id:string;
  effective_revision:number;
  fulfillment:string;
  lines:DraftLine[];
  total_paise:string|number;
  effective_lines:DraftLine[]|null;
  effective_total_paise:string|number|null;
};
export type SavedBill={
  request_id:string;
  revision:number;
  lines:DraftLine[];
  total_paise:string;
  store_name:string;
  store_address:string|null;
  issued_at:Date;
  fulfillment:'ready_for_pickup'|'collected';
  updated:boolean;
};

export async function readFinalBill(client:PoolClient,storeId:string,requestId:string,revision?:number):Promise<SavedBill|undefined>{
  return (await client.query(`SELECT b.* FROM owner_final_bills b
    JOIN order_requests r ON r.id=b.request_id AND r.store_id=$1
    WHERE b.request_id=$2 AND b.revision=coalesce($3,r.effective_revision)`,[storeId,requestId,revision??null])).rows[0];
}

export async function captureFinalBill(client:PoolClient,storeId:string,order:BillOrder,updated=false):Promise<SavedBill>{
  const prior=await readFinalBill(client,storeId,order.id,order.effective_revision);
  if(prior)return prior;
  const lines=order.effective_lines??order.lines,total=Number(order.effective_total_paise??order.total_paise);
  const estimate=estimateLines(lines);
  if(!estimate.complete||estimate.knownSubtotalPaise!==total)throw new ToolError('Review every item and its final price before issuing a bill.');
  const bill=(await client.query(`INSERT INTO owner_final_bills(request_id,revision,lines,total_paise,store_name,store_address,fulfillment,updated)
    SELECT $1,$2,$3::jsonb,$4,name,bill_address,$6,$7 FROM stores WHERE id=$5 RETURNING *`,[order.id,order.effective_revision,JSON.stringify(lines),total,storeId,order.fulfillment,updated])).rows[0];
  return {...bill,fulfillment:order.fulfillment};
}

export function finalBillReply(bill:SavedBill,language:ReplyLanguage='en'){
  return confirmedPriceBill(language,bill.request_id,bill.lines,Number(bill.total_paise),bill.store_name,{
    address:bill.store_address??undefined,date:bill.issued_at.toISOString(),revision:bill.revision,fulfillment:bill.fulfillment,updated:bill.updated,
  });
}

function textBill(bill:RichReply):RichReply{
  return {...bill,parts:bill.parts?.map(part=>({...part,cards:[],text:[part.text,...part.cards.flatMap(card=>
    card.kind==='product'?[]:(card.billRows??[]).map(row=>`${row.count} × ${row.name} · ${row.unitPrice} = ${row.total}`))].join('\n')}))};
}

export async function queueFinalBill(client:PoolClient,storeId:string,bill:SavedBill,channel?:WhatsAppConfig,notify=true){
  if(!notify)return {customerNotification:'not_requested'};
  const language=(await client.query(`SELECT c.reply_language FROM order_requests r LEFT JOIN conversations c ON c.id=r.conversation_id
    WHERE r.store_id=$1 AND r.id=$2`,[storeId,bill.request_id])).rows[0]?.reply_language;
  return queueOrderNotice(client,storeId,bill.request_id,`final-bill-${bill.revision}`,()=>{
    const rich=finalBillReply(bill,language??'en');
    if(!channel?.visualOrdering)return textBill(rich);
    try{return materializeVisualReply(rich);}catch{return textBill(rich);}
  },channel,true,{finalBill:true});
}

export async function supersedeFinalBillNotices(client:PoolClient,requestId:string,keepRevision?:number){
  await client.query(`WITH cancelled AS (
    UPDATE whatsapp_outbox o SET state='cancelled',last_error='bill_superseded'
    FROM messages m,request_notifications n
    WHERE n.request_id=$1 AND (n.status_key LIKE 'event:final-bill-%' OR n.status_key LIKE 'event:revised-%' OR n.status_key NOT LIKE 'event:%')
      AND ($2::integer IS NULL OR n.status_key<>('event:final-bill-'||$2))
      AND (m.reply_group_id=n.message_id OR m.id=n.message_id) AND o.message_id=m.id AND o.state='queued'
    RETURNING o.message_id
  ) UPDATE messages SET status='cancelled' WHERE id IN (SELECT message_id FROM cancelled)`,[requestId,keepRevision??null]);
}

const htmlEscape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));

export function printableFinalBill(bill:SavedBill,printNonce?:string){
  const reply=finalBillReply(bill),total=formatMoney(Number(bill.total_paise));
  const pages=reply.parts!.flatMap(part=>part.cards.flatMap(card=>{
    if(card.kind==='product')return [];
    const rows=card.billRows!.map(row=>`<tr><td>${htmlEscape(row.name)}</td><td>${htmlEscape(row.count)}</td><td>${htmlEscape(row.unitPrice)}</td><td>${htmlEscape(row.total)}</td></tr>`).join('');
    return [`<section><h1>${htmlEscape(card.title)}</h1><h2>${htmlEscape(bill.store_name)}</h2>
      <p>${htmlEscape(bill.store_address??'')}</p><p>Order ${htmlEscape(card.reference??'')} · ${htmlEscape(card.billHeader!.date)} · Revision ${bill.revision}</p>
      <table><thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Price each</th><th scope="col">Amount</th></tr></thead><tbody>${rows}</tbody></table>
      ${card.total?`<p class="total">Final total <strong>${htmlEscape(total)}</strong></p>`:''}<p>${htmlEscape(card.billHeader?.page??'')}</p></section>`];
  })).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>ShopBot bill</title><style>body{font:16px system-ui,sans-serif;color:#202b30;margin:32px auto;padding:0 24px;max-width:760px}
    h1,.total{background:#eef6f3;color:#16665b;padding:14px}h2,p{margin:8px 0}table{border-collapse:collapse;width:100%;margin:24px 0}
    th,td{padding:12px 8px;border-bottom:1px solid #dce2e3;text-align:right}th:first-child,td:first-child{text-align:left}
    .total{display:flex;justify-content:space-between}section+section{break-before:page;margin-top:32px}tr{break-inside:avoid}</style>
    <body>${pages}${printNonce?`<script nonce="${printNonce}">window.addEventListener('load',()=>window.print())</script>`:''}</body></html>`;
}


export async function finalBillRecipient(client:PoolClient,storeId:string,orderId:string,expected:{
  phone?:string;conversationId?:string;
},channel?:WhatsAppConfig){
  if(!channel)return;
  return (await client.query(`SELECT c.id,c.actor,w.recipient,w.profile_name,w.last_inbound_at
    FROM order_requests r JOIN conversations c ON c.store_id=r.store_id
    JOIN whatsapp_conversations w ON w.conversation_id=c.id AND w.phone_id=$3
    WHERE r.store_id=$1 AND r.id=$2
      AND (r.conversation_id=c.id OR (r.conversation_id IS NULL AND r.source='in_store'
        AND ($4::text IS NOT NULL OR $5::uuid IS NOT NULL)
        AND (r.counter_customer_phone IS NULL OR r.counter_customer_phone='+'||w.recipient)))
      AND ($4::text IS NULL OR $4='+'||w.recipient) AND ($5::uuid IS NULL OR c.id=$5)`,
    [storeId,orderId,channel.phoneId,expected.phone??null,expected.conversationId??null])).rows[0];
}

export async function sendSavedOrderBill(client:PoolClient,storeId:string,orderId:string,input:{
  expectedRevision:number;conversationId?:string;customerOptedIn?:boolean;
},channel?:WhatsAppConfig){
  const order=(await client.query('SELECT * FROM order_requests WHERE id=$1 AND store_id=$2 FOR UPDATE',[orderId,storeId])).rows[0];
  if(!order||order.effective_revision!==input.expectedRevision||!['ready_for_pickup','collected'].includes(order.fulfillment)){
    throw new ToolError('Refresh the order before sending its final bill.','stale_version');
  }
  const bill=await captureFinalBill(client,storeId,order);
  if(order.source==='in_store'){
    if(!input.conversationId||!input.customerOptedIn)throw new ToolError('Confirm the customer’s WhatsApp chat and permission to send the bill.');
    const contact=await finalBillRecipient(client,storeId,orderId,{conversationId:input.conversationId},channel);
    if(!contact||!channel?.sendEnabled||!recipientAllowed(channel,contact.recipient)){
      return {customerNotification:'not_sent',reason:'No eligible WhatsApp chat was found for this customer.'};
    }
    if(Date.now()-new Date(contact.last_inbound_at).getTime()>=24*3600000){
      return {customerNotification:'not_sent',reason:'The 24-hour WhatsApp reply window is closed. Print or download the bill for the customer.'};
    }
    if(!order.conversation_id){
      await client.query('UPDATE order_requests SET conversation_id=$1,actor=$2 WHERE id=$3',[contact.id,contact.actor,orderId]);
    }
  }
  await supersedeFinalBillNotices(client,orderId,bill.revision);
  const notice=await queueFinalBill(client,storeId,{...bill,fulfillment:order.fulfillment},channel);
  return {...notice,...(order.source==='in_store'&&{confirmedConversationId:input.conversationId,customerOptedIn:true})};
}
