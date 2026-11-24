import type {PoolClient} from 'pg';
import type {DraftLine} from '../../../../packages/contracts/index.js';
import type {ReplyLanguage} from '../../../../packages/contracts/language.js';
import {confirmedPriceBill} from './confirmed-bill.js';
import {materializeVisualReply} from './visual-images.js';
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
  invoice_issued_at:Date|null;
  fulfillment:'ready_for_pickup'|'collected';
  updated:boolean;
};

export async function readFinalBill(client:PoolClient,storeId:string,requestId:string,revision?:number):Promise<SavedBill|undefined>{
  return (await client.query(`SELECT b.* FROM owner_final_bills b
    JOIN order_requests r ON r.id=b.request_id AND r.store_id=$1
    WHERE b.request_id=$2 AND b.revision=coalesce($3,r.effective_revision)`,[storeId,requestId,revision??null])).rows[0];
}

export function reviewedBillLines(order:BillOrder){
  const lines=order.effective_lines??order.lines,total=Number(order.effective_total_paise??order.total_paise);
  const estimate=estimateLines(lines);
  if(estimate.complete&&estimate.knownSubtotalPaise===total)return {lines,total};
}

export async function captureFinalBill(client:PoolClient,storeId:string,order:BillOrder,updated=false):Promise<SavedBill>{
  const prior=await readFinalBill(client,storeId,order.id,order.effective_revision);
  if(prior){
    if(order.fulfillment!=='collected'||prior.invoice_issued_at)return prior;
    return (await client.query(`UPDATE owner_final_bills SET invoice_issued_at=now()
      WHERE request_id=$1 AND revision=$2 RETURNING *`,[order.id,order.effective_revision])).rows[0];
  }
  const reviewed=reviewedBillLines(order);
  if(!reviewed)throw new ToolError('Review every item and its final price before issuing a bill.');
  const {lines,total}=reviewed;
  const bill=(await client.query(`INSERT INTO owner_final_bills(request_id,revision,lines,total_paise,store_name,store_address,fulfillment,updated,customer_name,invoice_issued_at)
    SELECT $1,$2,$3::jsonb,$4,s.name,s.bill_address,$6,$7,coalesce(r.counter_customer_name,w.profile_name,CASE WHEN r.source='in_store' THEN 'Walk-in customer' END),CASE WHEN $6='collected' THEN now() END
    FROM stores s JOIN order_requests r ON r.store_id=s.id AND r.id=$1
    LEFT JOIN whatsapp_conversations w ON w.conversation_id=r.conversation_id
    WHERE s.id=$5 RETURNING *`,[order.id,order.effective_revision,JSON.stringify(lines),total,storeId,order.fulfillment,updated])).rows[0];
  return {...bill,fulfillment:order.fulfillment};
}

const billReference=(id:string)=>orderReference(id).replace('Order #','');

export function finalBillFilename(bill:SavedBill){
  return `ShopBot-${billReference(bill.request_id)}-${bill.invoice_issued_at?'invoice':'pickup-bill'}-${bill.revision}.pdf`;
}

export function finalBillPdf(bill:SavedBill){
  return renderBillPdf({
    title:bill.invoice_issued_at?'Invoice':bill.updated?'Updated pickup bill':'Pickup bill',
    titleTamil:bill.invoice_issued_at?'விலைப்பட்டியல்':'பொருள் பட்டியல்',
    reference:bill.invoice_issued_at?'INV-'+billReference(bill.request_id):orderReference(bill.request_id),
    orderNumber:bill.invoice_issued_at?orderReference(bill.request_id):undefined,issuedAt:bill.invoice_issued_at??bill.issued_at,revision:bill.revision,
    storeName:bill.store_name,storeAddress:bill.store_address??undefined,customerName:bill.customer_name??undefined,
    rows:pricedBillRows(bill.lines),totalLabel:'Total',total:formatMoney(Number(bill.total_paise)),
    amountPaise:Number(bill.total_paise),
    notes:bill.invoice_issued_at?[]:['Reviewed items and prices for pickup.'],
  });
}

async function billLanguage(client:PoolClient,storeId:string,requestId:string):Promise<ReplyLanguage>{
  return (await client.query(`SELECT c.reply_language FROM order_requests r LEFT JOIN conversations c ON c.id=r.conversation_id
    WHERE r.store_id=$1 AND r.id=$2`,[storeId,requestId])).rows[0]?.reply_language??'en';
}

export async function queuePickupBill(client:PoolClient,storeId:string,bill:SavedBill,channel?:WhatsAppConfig,notify=true){
  if(!notify)return {customerNotification:'not_requested'};
  const language=await billLanguage(client,storeId,bill.request_id);
  return queueOrderNotice(client,storeId,bill.request_id,`pickup-bill-${bill.revision}`,()=>materializeVisualReply(
    confirmedPriceBill(language,bill.request_id,bill.lines,Number(bill.total_paise),bill.store_name,{
      address:bill.store_address??undefined,date:bill.issued_at.toISOString(),revision:bill.revision,
      fulfillment:'ready_for_pickup',updated:bill.updated,
    })),channel,true,{finalBill:true});
}

export async function queuePurchaseInvoice(client:PoolClient,storeId:string,bill:SavedBill,channel?:WhatsAppConfig,notify=true){
  if(!notify)return {customerNotification:'not_requested'};
  if(!bill.invoice_issued_at)throw new ToolError('Record pickup before sending an invoice.');
  const language=await billLanguage(client,storeId,bill.request_id);
  const text=say(language,'Thank you for shopping with us. Your invoice is attached.','எங்கள் கடையில் வாங்கியதற்கு நன்றி. உங்கள் விலைப்பட்டியல் இணைக்கப்பட்டுள்ளது.','Enga kadaiyila vaangiyadhukku nandri. Unga invoice attach panniyirukkom.')
    +' '+say(language,'Total','மொத்தம்','Total')+': '+formatMoney(Number(bill.total_paise));
  return queueOrderNotice(client,storeId,bill.request_id,`purchase-invoice-${bill.revision}`,textPresentation(text),channel,true,{
    finalBill:true,document:()=>finalBillPdf(bill).then(pdf=>({pdf,filename:finalBillFilename(bill)})),
  });
}

export async function supersedeFinalBillNotices(client:PoolClient,requestId:string,keepRevision?:number){
  await client.query(`WITH cancelled AS (
    UPDATE whatsapp_outbox o SET state=CASE WHEN o.state='unknown' THEN 'unknown' ELSE 'cancelled' END,last_error='bill_superseded'
    FROM messages m,request_notifications n
    WHERE n.request_id=$1 AND (n.status_key LIKE 'event:final-bill-%' OR n.status_key LIKE 'event:pickup-bill-%' OR n.status_key LIKE 'event:revised-%' OR n.status_key NOT LIKE 'event:%')
      AND ($2::integer IS NULL OR n.status_key<>('event:pickup-bill-'||$2))
      AND (m.reply_group_id=n.message_id OR m.id=n.message_id) AND o.message_id=m.id AND o.state IN ('queued','sending','unknown')
    RETURNING o.message_id,o.state
  ) UPDATE messages SET status='cancelled' WHERE id IN (SELECT message_id FROM cancelled WHERE state='cancelled')`,[requestId,keepRevision??null]);
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
  const notice=order.fulfillment==='collected'
    ?await queuePurchaseInvoice(client,storeId,bill,channel)
    :await queuePickupBill(client,storeId,bill,channel);
  return {...notice,...(order.source==='in_store'&&{confirmedConversationId:input.conversationId,customerOptedIn:true})};
}
