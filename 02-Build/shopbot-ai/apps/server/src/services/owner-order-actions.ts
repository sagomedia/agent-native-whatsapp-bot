import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import type {Config} from '../config.js';
import type {OrderRequest} from '../../../../packages/contracts/index.js';
import {ToolError} from './context.js';
import {reserveRequest,closeRequestStock} from './inventory.js';
import {prepareOwnerOrderReview,recordOwnerOrderReview,type OwnerOrderReview} from './owner-order-review.js';
import {queueOrderNotice} from './order-notices.js';
import {textPresentation} from './message-presentation.js';
import {formatMoney,lineTotal} from '../../../../packages/contracts/money.js';
import {say} from '../../../../packages/contracts/language.js';
import {recipientAllowed} from './customer-admission.js';
import {requestStatusText} from './request-status.js';
import {materializeVisualReply} from './visual-images.js';
import {visualStatus} from './visual-ordering.js';
import {renderWhatsAppReply} from './whatsapp-reply.js';
import {currentReleaseFingerprint} from './release-manifest.js';
export type OrderOwner={storeId:string;actor:string};

export async function notifyOrderStatus(client:PoolClient,scope:OrderOwner,request:any,want:boolean,channel?:Config['whatsapp']){
    request={...request,lines:request.effective_lines??request.lines,total_paise:request.effective_total_paise??request.total_paise};
    const key=request.acceptance+':'+request.fulfillment;
    const obsolete=await client.query("UPDATE whatsapp_outbox o SET state='cancelled',last_error='request_status_superseded' FROM request_notifications n WHERE n.message_id=o.message_id AND n.request_id=$1 AND n.status_key<>$2 AND n.status_key NOT LIKE 'event:%' AND o.state='queued' RETURNING o.message_id",[request.id,key]);
    if(obsolete.rowCount)await client.query("UPDATE messages SET status='cancelled' WHERE id=ANY($1::uuid[])",[obsolete.rows.map(r=>r.message_id)]);
    if(!want)return {customerNotification:'not_requested'};
    const sent=(await client.query('SELECT n.message_id,o.state FROM request_notifications n JOIN whatsapp_outbox o ON o.message_id=n.message_id WHERE n.request_id=$1 AND n.status_key=$2',[request.id,key])).rows[0];
    if(sent&&!['cancelled','blocked'].includes(sent.state))return {customerNotification:sent.state==='unknown'?'outcome_unknown':'already_queued',messageId:sent.message_id};
    const c=(await client.query('SELECT c.id,c.reply_language,c.operator_revision,w.recipient,w.phone_id,w.last_inbound_at FROM conversations c LEFT JOIN whatsapp_conversations w ON w.conversation_id=c.id WHERE c.store_id=$1 AND c.id=$2 FOR UPDATE OF c',[scope.storeId,request.conversation_id])).rows[0];
    if(!channel?.sendEnabled||!c?.recipient)return {customerNotification:'not_sent',reason:'Sending is disabled or this is a preview conversation.'};
    if(c.phone_id!==channel.phoneId||!recipientAllowed(channel,c.recipient)||!c.last_inbound_at||Date.now()-new Date(c.last_inbound_at).getTime()>=24*3600000)return {customerNotification:'not_sent',reason:'Recipient is not approved or the reply window has closed. Open the conversation to follow up.'};
    const id=randomUUID(),text=requestStatusText({id:request.id,acceptance:request.acceptance,fulfillment:request.fulfillment,payment:request.payment,totalPaise:Number(request.total_paise),lines:request.lines} as OrderRequest,c.reply_language);
    const rich=channel?.visualOrdering?materializeVisualReply(visualStatus({replyLanguage:c.reply_language,visualOrdering:true,version:0,draft:request.lines,pending:null,fulfillment:'pickup',lastRequestId:request.id},{id:request.id,acceptance:request.acceptance,fulfillment:request.fulfillment,payment:request.payment,totalPaise:Number(request.total_paise),lines:request.lines})):undefined;
    await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload,stage) VALUES($1,$2,'outbound',$3,'queued',$4,$5)",[id,c.id,text,JSON.stringify(rich??{version:1,kind:'text',text,presentation:'text',outboundMessages:1}),rich?'status':null]);
    await client.query('UPDATE messages SET release_fingerprint=$1 WHERE id=$2',[currentReleaseFingerprint(),id]);
    await client.query("INSERT INTO whatsapp_outbox(message_id,conversation_id,operator_revision,sender_kind,reply_payload) VALUES($1,$2,$3,'system',$4)",[id,c.id,c.operator_revision,JSON.stringify(rich?renderWhatsAppReply(rich,id,channel.hostname).payload:{type:'text',text:{preview_url:false,body:text}})]);
    await client.query('INSERT INTO request_notifications(request_id,status_key,message_id) VALUES($1,$2,$3) ON CONFLICT(request_id,status_key) DO UPDATE SET message_id=EXCLUDED.message_id',[request.id,key,id]);return {customerNotification:'queued',messageId:id};
  }

export async function reviewOwnerOrder(client:PoolClient,scope:OrderOwner,requestId:string,input:OwnerOrderReview,channel?:Config['whatsapp']){
      const prepared=await prepareOwnerOrderReview(client,scope.storeId,requestId,scope.actor,input);
      if(prepared.replayed)return {...prepared.result,replayed:true};
      const {request:current,lines,total,hash}=prepared;
      // Retire any holds made by the previous workflow before switching this order
      // to advisory inventory. This releases reserved quantity without decrementing shelf stock.
      if((await client.query("SELECT 1 FROM inventory_reservations WHERE store_id=$1 AND request_id=$2 AND state='active'",[scope.storeId,current.id])).rowCount){
        await closeRequestStock(client,scope.storeId,current.id,'release',scope.actor);
        if((await client.query("SELECT 1 FROM inventory_reservations WHERE store_id=$1 AND request_id=$2 AND state='active'",[scope.storeId,current.id])).rowCount)throw new ToolError('Could not release the older stock hold. Refresh this order.');
      }
      // A revised bill is an informational owner notice. The customer has already placed this order.
      await client.query("UPDATE order_quotes SET state='superseded' WHERE request_id=$1 AND state='offered'",[current.id]);
      await client.query('DELETE FROM order_quote_drafts WHERE request_id=$1',[current.id]);
      const changed=(await client.query(`UPDATE order_requests SET effective_lines=$1::jsonb,effective_total_paise=$2,
        effective_revision=effective_revision+1,estimate_complete=true,excluded_line_ids='[]'::jsonb,
        acceptance=CASE WHEN $3='ready' THEN 'accepted' ELSE acceptance END,
        fulfillment=CASE WHEN $3='ready' THEN 'ready_for_pickup' ELSE fulfillment END,
        packed_revision=CASE WHEN $3='ready' THEN effective_revision+1 ELSE NULL END,
        inventory_state=CASE WHEN inventory_state IN ('pending','untracked','released') THEN 'untracked' ELSE inventory_state END,
        inventory_untracked_line_ids=$4::jsonb WHERE store_id=$5 AND id=$6 RETURNING *`,[JSON.stringify(lines),total,input.action,JSON.stringify(lines.map(line=>line.id)),scope.storeId,current.id])).rows[0];
      if(input.amendmentId)await client.query("UPDATE order_amendments SET state='accepted',decided_by=$1,decided_at=now(),updated_at=now() WHERE id=$2 AND request_id=$3 AND state='owner_pending'",[scope.actor,input.amendmentId,current.id]);
      await client.query('UPDATE conversations SET draft=$1::jsonb,version=version+1 WHERE id=$2 AND last_request_id=$3',[JSON.stringify(lines),current.conversation_id,current.id]);
      let notice:any={customerNotification:'not_requested'};
      if(input.action==='revise'){
        const language=(await client.query('SELECT reply_language FROM conversations WHERE id=$1',[current.conversation_id])).rows[0]?.reply_language??'en';
        const list=lines.map(line=>`${line.quantity} ${line.unit} × ${formatMoney(line.pricePaise!)} · ${line.name} · ${formatMoney(lineTotal(line.pricePaise!,line.quantity!))}`).join('\n');
        const text=say({replyLanguage:language},`Updated bill for order #${current.id.replaceAll('-','').slice(0,8).toUpperCase()}:\n${list}\nTotal: ${formatMoney(total)}\nThe shop will tell you when it is ready for pickup.`,`Order #${current.id.replaceAll('-','').slice(0,8).toUpperCase()} புதிய பில்:\n${list}\nமொத்தம்: ${formatMoney(total)}\nபெற தயாரானதும் கடை தெரிவிக்கும்.`,`Order #${current.id.replaceAll('-','').slice(0,8).toUpperCase()} pudhu bill:\n${list}\nTotal: ${formatMoney(total)}\nReady aanathum kadai sollum.`);
        notice=await queueOrderNotice(client,scope.storeId,current.id,`revised-${changed.effective_revision}`,textPresentation(text),channel,input.notify);
      }else if(input.action==='ready')notice=await notifyOrderStatus(client,scope,changed,input.notify,channel);
      const result={requestId:current.id,stage:input.action==='ready'?'ready':'new',effectiveRevision:changed.effective_revision,totalPaise:total,...notice,replayed:false};
      await recordOwnerOrderReview(client,scope.storeId,current.id,input,hash,result);
      return result;
}

export async function completeOwnerOrder(client:PoolClient,scope:OrderOwner,requestId:string,input:{expectedRevision:number}){
      const row=(await client.query('SELECT * FROM order_requests WHERE store_id=$1 AND id=$2 FOR UPDATE',[scope.storeId,requestId])).rows[0];
      if(!row||row.effective_revision!==input.expectedRevision||row.fulfillment!=='ready_for_pickup'||row.acceptance!=='accepted')throw new ToolError('Refresh this ready order before recording collection.','stale_version');
      await closeRequestStock(client,scope.storeId,row.id,'collect',scope.actor);
      await client.query("UPDATE order_requests SET fulfillment='collected' WHERE id=$1",[row.id]);
      return {requestId:row.id,stage:'completed',effectiveRevision:row.effective_revision};
}

export async function decideOwnerOrder(client:PoolClient,scope:OrderOwner,requestId:string,input:{decision:'accepted'|'rejected';notify:boolean},channel?:Config['whatsapp']){
      if(input.decision==='accepted'){
        const current=(await client.query('SELECT r.*,a.state AS advance_state FROM order_requests r JOIN conversations c ON c.id=r.conversation_id AND c.store_id=r.store_id LEFT JOIN whatsapp_conversations w ON w.conversation_id=c.id LEFT JOIN order_advances a ON a.request_id=r.id WHERE r.id=$1 AND r.store_id=$2 FOR UPDATE OF r',[requestId,scope.storeId])).rows[0];
        if(!current||current.acceptance!=='awaiting_approval')throw Object.assign(new Error('Request is already decided or unavailable.'),{statusCode:409});
        if(current?.advance_required&&current.advance_state!=='verified')throw Object.assign(new Error('Check the ₹10 advance in your bank/UPI app and record its reference before accepting.'),{statusCode:409});
        if((await client.query("SELECT 1 FROM order_quotes WHERE request_id=$1 AND state='offered'",[requestId])).rowCount)throw Object.assign(new Error('Wait for the customer to approve the offered final bill.'),{statusCode:409});
        if(current?.estimate_complete===false)throw Object.assign(new Error('Quote the unresolved items and get the customer’s final-bill approval before accepting.'),{statusCode:409});
        if((await client.query("SELECT 1 FROM order_amendments WHERE request_id=$1 AND state='owner_pending'",[requestId])).rowCount)throw Object.assign(new Error('Resolve the pending amendment before accepting the request.'),{statusCode:409});
        await reserveRequest(client,scope.storeId,current.id,current.effective_lines??current.lines,current.effective_revision,scope.actor,true);
      }else await closeRequestStock(client,scope.storeId,requestId,'release',scope.actor);
      const updated=await client.query("UPDATE order_requests SET acceptance=$1,fulfillment=$4 WHERE store_id=$2 AND id=$3 AND acceptance='awaiting_approval' RETURNING *",[input.decision,scope.storeId,requestId,input.decision==='accepted'?'preparing':'cancelled']);
      if(!updated.rowCount)throw Object.assign(new Error('Request is already decided or unavailable. Refresh the list.'),{statusCode:409});
      if(input.decision==='rejected')await client.query("UPDATE order_advances SET state='refund_pending',updated_at=now() WHERE request_id=$1 AND state='verified'",[requestId]);
      return {acceptance:updated.rows[0].acceptance,fulfillment:updated.rows[0].fulfillment,...await notifyOrderStatus(client,scope,updated.rows[0],input.notify,channel)};
}

export async function fulfillOwnerOrder(client:PoolClient,scope:OrderOwner,requestId:string,input:{expected:string;status:'ready_for_pickup'|'collected'|'cancelled';packedChecked?:boolean;expectedRevision?:number;reason?:'not_picked_up';notify:boolean},channel?:Config['whatsapp']){
      const p=input,row=(await client.query('SELECT * FROM order_requests WHERE store_id=$1 AND id=$2 FOR UPDATE',[scope.storeId,requestId])).rows[0];
      if(!row||row.acceptance!=='accepted')throw Object.assign(new Error('Accept the request before updating pickup status.'),{statusCode:409});
      if(p.expectedRevision!==undefined&&row.effective_revision!==p.expectedRevision)throw Object.assign(new Error('This order changed. Refresh it before updating pickup status.'),{statusCode:409});
      if(['ready_for_pickup','collected'].includes(p.status)&&((await client.query("SELECT 1 FROM order_quotes WHERE request_id=$1 AND state='offered'",[row.id])).rowCount||(await client.query("SELECT 1 FROM order_amendments WHERE request_id=$1 AND state='owner_pending'",[row.id])).rowCount))throw Object.assign(new Error('Resolve the pending customer quote or amendment before marking ready or collected.'),{statusCode:409});
      if(p.status==='ready_for_pickup'&&p.packedChecked!==true&&row.packed_revision!==row.effective_revision)throw Object.assign(new Error('Check the physical products, quantities and pack sizes before marking ready.'),{statusCode:409});
      if(p.status==='collected'&&row.packed_revision!==row.effective_revision)throw Object.assign(new Error('Recheck this order and mark it ready before recording collection.'),{statusCode:409});
      if(p.status==='ready_for_pickup'&&p.packedChecked===true)await client.query('UPDATE order_requests SET packed_revision=effective_revision WHERE id=$1',[row.id]);
      if(row.fulfillment===p.status)return {fulfillment:p.status,duplicate:true,...(p.reason?{reason:p.reason}:{}),...await notifyOrderStatus(client,scope,row,p.notify,channel)};
      if(row.fulfillment!==p.expected||!((['awaiting_approval','preparing'].includes(row.fulfillment)&&['ready_for_pickup','cancelled'].includes(p.status))||(row.fulfillment==='ready_for_pickup'&&['collected','cancelled'].includes(p.status))))throw Object.assign(new Error('Request status changed or that transition is not allowed. Refresh before updating.'),{statusCode:409});
      if(p.status==='cancelled')await client.query("UPDATE order_advances SET state='refund_pending',updated_at=now() WHERE request_id=$1 AND state='verified'",[requestId]);
      if(p.status==='collected'||p.status==='cancelled')await closeRequestStock(client,scope.storeId,row.id,p.status==='collected'?'collect':'release',scope.actor);
      const changed=(await client.query('UPDATE order_requests SET fulfillment=$1 WHERE store_id=$2 AND id=$3 RETURNING *',[p.status,scope.storeId,row.id])).rows[0];
      return {fulfillment:p.status,...(p.reason?{reason:p.reason}:{}),packedChecked:p.packedChecked??false,...await notifyOrderStatus(client,scope,changed,p.notify,channel)};
}
