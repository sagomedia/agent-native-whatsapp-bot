import type {PoolClient} from 'pg';
import type {DraftLine} from '../../../../packages/contracts/index.js';
import type {ReplyLanguage} from '../../../../packages/contracts/language.js';
import {formatMoney} from '../../../../packages/contracts/money.js';
import {recipientAllowed} from './customer-admission.js';
import {ToolError} from './context.js';
import {orderReference} from './visual-ordering.js';
import {renderBillPdf,pricedBillRows} from './order-bill-pdf.js';
import {say} from '../../../../packages/contracts/language.js';
import {textPresentation} from './message-presentation.js';
import {estimateLines} from './order-estimate.js';
import {queueOrderNotice} from './order-notices.js';
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
  customer_name:string|null;
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
  const bill=(await client.query(`INSERT INTO owner_final_bills(request_id,revision,lines,total_paise,store_name,store_address,fulfillment,updated,customer_name)
    SELECT $1,$2,$3::jsonb,$4,s.name,s.bill_address,$6,$7,coalesce(r.counter_customer_name,w.profile_name,CASE WHEN r.source='in_store' THEN 'Walk-in customer' END)
    FROM stores s JOIN order_requests r ON r.store_id=s.id AND r.id=$1
    LEFT JOIN whatsapp_conversations w ON w.conversation_id=r.conversation_id
    WHERE s.id=$5 RETURNING *`,[order.id,order.effective_revision,JSON.stringify(lines),total,storeId,order.fulfillment,updated])).rows[0];
  return {...bill,fulfillment:order.fulfillment};
}

export function finalBillFilename(bill:SavedBill){
  return `ShopBot-${orderReference(bill.request_id).slice(1)}-bill-${bill.revision}.pdf`;
}

export function finalBillPdf(bill:SavedBill){
  return renderBillPdf({
    title:bill.updated?'UPDATED FINAL BILL':bill.fulfillment==='ready_for_pickup'?'FINAL PICKUP BILL':'FINAL BILL',
    reference:'Order '+orderReference(bill.request_id),issuedAt:bill.issued_at,revision:bill.revision,
    storeName:bill.store_name,storeAddress:bill.store_address??undefined,customerName:bill.customer_name??undefined,
    rows:pricedBillRows(bill.lines),totalLabel:'Final total',total:formatMoney(Number(bill.total_paise)),
    notes:['Items and prices checked by the shop.'],
  });
}

export async function queueFinalBill(client:PoolClient,storeId:string,bill:SavedBill,channel?:WhatsAppConfig,notify=true,stillReady=bill.fulfillment==='ready_for_pickup'){
  if(!notify)return {customerNotification:'not_requested'};
  const language:ReplyLanguage=(await client.query(`SELECT c.reply_language FROM order_requests r LEFT JOIN conversations c ON c.id=r.conversation_id
    WHERE r.store_id=$1 AND r.id=$2`,[storeId,bill.request_id])).rows[0]?.reply_language??'en';
  const ready=stillReady
    ?say(language,'Your order is ready for pickup.','உங்கள் ஆர்டர் எடுத்துச் செல்லத் தயார்.','Unga order pickup-ku ready.')
    :'';
  const text=[
    say(language,'The shop has checked your items and prices.','பொருட்களையும் விலைகளையும் கடை சரிபார்த்துவிட்டது.','Items-um vilaiyum kadai check panniyachu.'),
    ready,
    say(language,'Final total','இறுதி மொத்தம்','Final total')+': '+formatMoney(Number(bill.total_paise)),
    bill.updated?say(language,'This bill replaces the previous one.','முந்தைய பில்லுக்கு பதிலாக இந்த பில்லைப் பயன்படுத்துங்கள்.','Munnaadi anuppina bill-ku badhila idhai use pannunga.'):'',
  ].filter(Boolean).join(' ');
  return queueOrderNotice(client,storeId,bill.request_id,`final-bill-${bill.revision}`,textPresentation(text),channel,true,{
    finalBill:true,document:()=>finalBillPdf(bill).then(pdf=>({pdf,filename:finalBillFilename(bill)})),
  });
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
  const notice=await queueFinalBill(client,storeId,bill,channel,true,order.fulfillment==='ready_for_pickup');
  return {...notice,...(order.source==='in_store'&&{confirmedConversationId:input.conversationId,customerOptedIn:true})};
}
