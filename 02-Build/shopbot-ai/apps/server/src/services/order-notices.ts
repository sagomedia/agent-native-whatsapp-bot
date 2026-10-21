import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {RichReply} from '../../../../packages/contracts/index.js';
import type {WhatsAppConfig} from './whatsapp-config.js';
import {renderWhatsAppReply} from './whatsapp-reply.js';
import {conversationBinding,loadAssistantMemory} from './agent-assistance.js';
import {loadState} from './tools.js';
import {currentReleaseFingerprint} from './release-manifest.js';

/** Called inside an authenticated, store-locked owner transaction. */
export async function queueOrderNotice(client:PoolClient,storeId:string,requestId:string,key:string,rich:RichReply,config?:WhatsAppConfig,notify=true) {
 if(!notify)return {customerNotification:'not_requested'};
 const previous=(await client.query('SELECT n.message_id,o.state FROM request_notifications n JOIN whatsapp_outbox o ON o.message_id=n.message_id WHERE n.request_id=$1 AND n.status_key=$2',[requestId,'event:'+key])).rows[0];
 if(previous&&!['cancelled','blocked'].includes(previous.state))return {customerNotification:previous.state==='unknown'?'outcome_unknown':'already_queued',messageId:previous.message_id};
 const row=(await client.query('SELECT c.*,w.recipient,w.phone_id,w.last_inbound_at,s.operator_paused FROM order_requests r JOIN conversations c ON c.id=r.conversation_id AND c.store_id=r.store_id JOIN stores s ON s.id=c.store_id LEFT JOIN whatsapp_conversations w ON w.conversation_id=c.id WHERE r.id=$1 AND r.store_id=$2 FOR UPDATE OF c',[requestId,storeId])).rows[0];
 if(!row||!config?.sendEnabled||row.operator_paused||row.operator_mode==='owner'||row.phone_id!==config.phoneId||!config.recipients.includes(row.recipient)||!row.last_inbound_at||Date.now()-new Date(row.last_inbound_at).getTime()>=24*3600000)return {customerNotification:'not_sent',reason:'Sending is unavailable, the owner is handling this conversation, or the reply window is closed.'};
 const ctx={storeId,conversationId:row.id,actor:row.actor,role:'customer' as const};
 const state=await loadState(client,ctx),binding=conversationBinding(state,await loadAssistantMemory(client,ctx));
 const groupId=randomUUID(),parts=rich.parts??[undefined];
 for(const [index,part] of parts.entries()){
  const id=index===0?groupId:randomUUID(),payload=part?{...rich,text:part.text,parts:[part],groupId,partIndex:index,partCount:parts.length}:rich;
  const rendered=renderWhatsAppReply(payload,id,config.hostname);
  await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload,reply_group_id,part_index,part_count,stage,release_fingerprint) VALUES($1,$2,'outbound',$3,'queued',$4::jsonb,$5,$6,$7,$8,$9)",[id,row.id,payload.text,JSON.stringify(payload),groupId,index,parts.length,payload.stage??'status',currentReleaseFingerprint()]);
  await client.query("INSERT INTO whatsapp_outbox(message_id,conversation_id,operator_revision,sender_kind,reply_payload) VALUES($1,$2,$3,'system',$4::jsonb)",[id,row.id,row.operator_revision,JSON.stringify(rendered.payload)]);
  for(const action of rendered.actions)await client.query('INSERT INTO whatsapp_actions(id,message_id,conversation_id,event,label,source_version,operator_revision,binding_id) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)',[action.id,id,row.id,JSON.stringify(action.event),action.label,state.version,row.operator_revision,binding]);
 }
 await client.query('INSERT INTO request_notifications(request_id,status_key,message_id) VALUES($1,$2,$3) ON CONFLICT(request_id,status_key) DO UPDATE SET message_id=EXCLUDED.message_id',[requestId,'event:'+key,groupId]);
 return {customerNotification:'queued',messageId:groupId};
}
