import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {WhatsAppConfig} from './whatsapp-config.js';
import type {ActorContext} from './context.js';
import type {ConversationState} from '../../../../packages/contracts/index.js';
import {say} from '../../../../packages/contracts/language.js';
import {socialIntent,plainReply} from './replies.js';

export function recipientAllowed(config:Pick<WhatsAppConfig,'audience'|'recipients'>,number:string):boolean {
  return /^\d{7,15}$/.test(number)&&(config.audience==='public'||config.recipients.includes(number));
}

// A message's language, spelling, length or unknown product name is never proof
// of spam. Only repetition, a receipt-time burst, or repeated understood off-topic
// intent stops automation. Every accepted inbound remains in the owner's inbox.
export function admissionKey(text:string,version:number,binding:string|null):string {
  const normalized=text.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();
  const social=socialIntent(normalized);
  const value=social==='greeting'||social==='thanks'?`social:${social}`:`${version}:${binding??''}:${normalized}`;
  return createHash('sha256').update(value).digest('hex');
}
export const admissionLimits=Object.freeze({windowSeconds:120,burstMessages:30,repeats:3,offTopicTurns:2});

/** Caller holds the conversation lock; decisions and the inbox commit together. */
export async function admitCustomerMessage(client:PoolClient,ctx:ActorContext,input:{text?:string;version:number;binding:string|null}):Promise<'allow'|'quiet'|'owner'> {
  const control=(await client.query('SELECT operator_mode,operator_revision FROM conversations WHERE id=$1',[ctx.conversationId])).rows[0];
  await client.query('INSERT INTO whatsapp_customer_guards(conversation_id,operator_revision) VALUES($1,$2) ON CONFLICT DO NOTHING',[ctx.conversationId,control.operator_revision]);
  const old=(await client.query('SELECT *,clock_timestamp()-last_received_at>interval \'120 seconds\' AS idle,clock_timestamp()-window_started_at>=interval \'120 seconds\' AS expired FROM whatsapp_customer_guards WHERE conversation_id=$1 FOR UPDATE',[ctx.conversationId])).rows[0];
  // Resume is an explicit owner action. Its revision resets the guard rather
  // than silently replaying the messages that caused the handover.
  const reset=old.operator_revision!==control.operator_revision||old.idle;
  const key=input.text===undefined?null:admissionKey(input.text,input.version,input.binding);
  // A returning customer's greeting is a normal deterministic turn, even
  // when repeated after silence. Burst limits still apply to all messages.
  const social=input.text===undefined?undefined:socialIntent(input.text.normalize('NFKC').toLowerCase().trim());
  const harmlessSocial=social==='greeting'||social==='thanks';
  const repeat=key&&key===old.last_key&&!reset?old.repeat_count+1:1;
  const count=reset||old.expired?1:old.window_count+1;
  await client.query(`UPDATE whatsapp_customer_guards SET operator_revision=$2,
    window_started_at=CASE WHEN $3 THEN clock_timestamp() ELSE window_started_at END,
    window_count=$4,last_key=$5,repeat_count=$6,last_received_at=clock_timestamp(),
    off_topic_count=CASE WHEN $7 THEN 0 ELSE off_topic_count END,
    reason=CASE WHEN $7 THEN NULL ELSE reason END,
    last_media_key=CASE WHEN $7 THEN NULL ELSE last_media_key END,
    media_repeat_count=CASE WHEN $7 THEN 0 ELSE media_repeat_count END WHERE conversation_id=$1`,
    [ctx.conversationId,control.operator_revision,reset||old.expired,count,key,repeat,reset]);
  if(control.operator_mode==='owner')return 'owner';
  if(count>=admissionLimits.burstMessages||repeat>=admissionLimits.repeats&&!harmlessSocial){
    await handoffCustomer(client,ctx,count>=admissionLimits.burstMessages?'message_burst':'repeated_message');
    return 'owner';
  }
  // A second identical turn is saved but not sent back through the model. A
  // new quantity for a different product has a different bound state key.
  if(key&&repeat>1&&!harmlessSocial)return 'quiet';
  return 'allow';
}

export async function handoffCustomer(client:PoolClient,ctx:ActorContext,reason:string):Promise<void> {
  const result=await client.query(`UPDATE conversations SET operator_mode='owner',handoff_requested=true,
    operator_revision=operator_revision+1 WHERE id=$1 AND operator_mode='assistant' RETURNING operator_revision,reply_language`,[ctx.conversationId]);
  if(!result.rowCount)return;
  const row=result.rows[0];
  await client.query('UPDATE whatsapp_customer_guards SET reason=$2,operator_revision=$3 WHERE conversation_id=$1',[ctx.conversationId,reason,row.operator_revision]);
  // Invalidate in-flight claims and retire the old queue, keeping its content,
  // attachments, draft, requests and paid-attempt ledger intact for the owner.
  await client.query(`UPDATE messages SET status='processed',claim_token=NULL,lease_until=NULL,reply_decision='held_for_owner'
    WHERE conversation_id=$1 AND direction='inbound' AND status IN ('pending','processing')`,[ctx.conversationId]);
  await client.query("UPDATE messages SET status='cancelled' WHERE id IN (SELECT message_id FROM whatsapp_outbox WHERE conversation_id=$1 AND state='queued')",[ctx.conversationId]);
  await client.query("UPDATE whatsapp_outbox SET state='cancelled',last_error='customer_guard_handoff' WHERE conversation_id=$1 AND state='queued'",[ctx.conversationId]);
  await client.query("INSERT INTO owner_audit(store_id,email,action,target_id,details) VALUES($1,'system:customer-admission','customer_guard_handoff',$2,$3::jsonb)",[ctx.storeId,ctx.conversationId,JSON.stringify({reason})]);
}

/** No extra classifier call: reuse the interpretation the normal turn obtained. */
export async function observeCustomerIntent(client:PoolClient,ctx:ActorContext,offTopic:boolean|null):Promise<boolean> {
  if(offTopic===null)return false;
  if(!offTopic){await client.query('UPDATE whatsapp_customer_guards SET off_topic_count=0 WHERE conversation_id=$1',[ctx.conversationId]);return false;}
  const row=(await client.query('UPDATE whatsapp_customer_guards SET off_topic_count=off_topic_count+1 WHERE conversation_id=$1 RETURNING off_topic_count',[ctx.conversationId])).rows[0];
  if(row?.off_topic_count>=admissionLimits.offTopicTurns){await handoffCustomer(client,ctx,'repeated_unrelated_intent');return true;}
  return false;
}

export async function queueHandoffNotice(client:PoolClient,ctx:ActorContext,state:ConversationState,enabled:boolean):Promise<void> {
  if(!enabled)return;
  const control=(await client.query('SELECT operator_mode,operator_revision FROM conversations WHERE id=$1',[ctx.conversationId])).rows[0];
  if(control.operator_mode!=='owner')return;
  const prior=await client.query("SELECT 1 FROM messages m JOIN whatsapp_outbox o ON o.message_id=m.id WHERE m.conversation_id=$1 AND o.operator_revision=$2 AND m.payload->>'clarificationReason'='owner_handling' LIMIT 1",[ctx.conversationId,control.operator_revision]);
  if(prior.rowCount)return;
  const id=randomUUID(),text=say(state,'Your messages are saved. I have handed this chat to the shop owner for review. They can reply here.','உங்கள் செய்திகள் சேமிக்கப்பட்டுள்ளன. இந்த உரையாடலை கடை உரிமையாளர் பார்க்க ஒப்படைத்துள்ளேன். அவர் இங்கே பதிலளிக்கலாம்.','Unga messages save panniyachu. Intha chat-ai kadai owner paarkka oppadaichirukken. Avar inge reply pannalaam.');
  const payload={...plainReply(text),stage:'status',clarificationReason:'owner_handling'};
  await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload,stage) VALUES($1,$2,'outbound',$3,'queued',$4::jsonb,'status')",[id,ctx.conversationId,text,JSON.stringify(payload)]);
  await client.query("INSERT INTO whatsapp_outbox(message_id,conversation_id,operator_revision,sender_kind,reply_payload) VALUES($1,$2,$3,'system',$4::jsonb)",[id,ctx.conversationId,control.operator_revision,JSON.stringify({type:'text',text:{preview_url:false,body:text}})]);
}

/** Re-sent identical attachments are decoded for the inbox but never sent
 * repeatedly to AI. State-bound keys preserve deliberate repeats in a new item. */
export async function admitCustomerMedia(client:PoolClient,ctx:ActorContext,key:string):Promise<'allow'|'quiet'|'owner'> {
  const control=(await client.query('SELECT operator_mode FROM conversations WHERE id=$1',[ctx.conversationId])).rows[0];
  if(control.operator_mode==='owner')return 'owner';
  const row=(await client.query("UPDATE whatsapp_customer_guards SET media_repeat_count=CASE WHEN last_media_key=$2 AND last_media_at>clock_timestamp()-interval '120 seconds' THEN media_repeat_count+1 ELSE 1 END,last_media_key=$2,last_media_at=clock_timestamp() WHERE conversation_id=$1 RETURNING media_repeat_count",[ctx.conversationId,key])).rows[0];
  if(row?.media_repeat_count>=3){await handoffCustomer(client,ctx,'repeated_attachment');return 'owner';}
  return row?.media_repeat_count>1?'quiet':'allow';
}
