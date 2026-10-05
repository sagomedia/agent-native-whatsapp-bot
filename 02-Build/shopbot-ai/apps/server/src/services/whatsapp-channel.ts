import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import {MockInterpreter} from '../adapters/mock-interpreter.js';
import type {Interpreter} from '../adapters/interpreter.js';
import {ConversationRuntime} from '../runtime/conversation.js';
import {loadState} from './tools.js';
import {loadAssistantMemory,conversationBinding} from './agent-assistance.js';
import type {ActorContext} from './context.js';
import type {WhatsAppConfig} from './whatsapp-config.js';

const id=z.string().min(1).max(512),digits=z.string().regex(/^\d{7,15}$/),timestamp=z.string().regex(/^\d{1,12}$/);
const incoming=z.object({id,from:digits,timestamp,type:z.string().max(40),text:z.object({body:z.string().min(1).max(4096)}).optional()});
const status=z.object({id,recipient_id:digits,timestamp,status:z.enum(['sent','delivered','read','failed']),biz_opaque_callback_data:z.uuid().optional(),errors:z.array(z.object({code:z.number().int()})).max(10).optional()});
export const webhookSchema=z.object({object:z.literal('whatsapp_business_account'),entry:z.array(z.object({id:z.string(),changes:z.array(z.object({field:z.string(),value:z.object({metadata:z.object({phone_number_id:z.string()}).optional(),messages:z.array(incoming).max(100).optional(),statuses:z.array(status).max(100).optional()})})).max(20)})).max(20)});
type Webhook=z.infer<typeof webhookSchema>;
export type WhatsAppFetch=typeof fetch;

export class WhatsAppChannel {
  readonly runtime:ConversationRuntime;
  constructor(private pool:Pool,readonly config:WhatsAppConfig,private request:WhatsAppFetch=fetch,provider?:Interpreter){
    if(config.aiEnabled&&(!provider?.freeQuota||provider.mode!=='live'))throw new Error('WhatsApp AI requires the configured free-tier interpreter');
    if(!config.aiEnabled&&provider)throw new Error('WhatsApp AI has not been enabled');
    this.runtime=new ConversationRuntime(pool,provider??new MockInterpreter(),{allowFreeInference:!!config.aiEnabled,queueReply:async(client,ctx,messageId,rich)=>{
      const revision=(await client.query('SELECT operator_revision FROM conversations WHERE id=$1',[ctx.conversationId])).rows[0].operator_revision;
      // A single text reply is the initial test format; no paid templates or fan-out.
      const body=Array.from(rich.text+(rich.cards?.length?'\n\n'+rich.cards.map(c=>`${c.product.sku}: ${c.product.name} · ${c.product.unit} · ₹${(c.product.pricePaise/100).toFixed(2)}`).join('\n')+'\n\nReply with the product code to choose an option. Catalog availability is subject to the shop’s confirmation.':'')).slice(0,4096).join('');
      await client.query('UPDATE messages SET text=$1 WHERE id=$2',[body,messageId]);
      await client.query('INSERT INTO whatsapp_outbox(message_id,conversation_id,operator_revision) VALUES($1,$2,$3)',[messageId,ctx.conversationId,revision]);
    }});
  }
  async setup(){
    const c=this.config;
    const old=(await this.pool.query('SELECT store_id,app_id,waba_id FROM whatsapp_channels WHERE phone_id=$1',[c.phoneId])).rows[0];
    if(old&&(old.store_id!==c.storeId||old.app_id!==c.appId||old.waba_id!==c.wabaId))throw new Error('WhatsApp sender is already bound to another channel; explicit migration required');
    await this.pool.query('INSERT INTO whatsapp_channels(phone_id,store_id,app_id,waba_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[c.phoneId,c.storeId,c.appId,c.wabaId]);
  }
  async receive(payload:Webhook){
    const c=this.config,client=await this.pool.connect();
    let accepted=0;
    try{
      await client.query('BEGIN');
      // Serialize channel identity creation and keep the owner/worker lock order.
      await client.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE',[c.storeId]);
      await client.query('UPDATE whatsapp_channels SET last_webhook_at=now() WHERE phone_id=$1',[c.phoneId]);
      for(const entry of payload.entry){
        if(entry.id!==c.wabaId)continue;
        for(const change of entry.changes){
          const v=change.value;
          if(change.field!=='messages'||v.metadata?.phone_number_id!==c.phoneId)continue;
          for(const m of v.messages??[]){
            if(!c.recipients.includes(m.from))continue;
            const seconds=Number(m.timestamp);
            if(!Number.isSafeInteger(seconds)||seconds<1||seconds>Date.now()/1000+300)continue;
            if((await client.query('SELECT 1 FROM whatsapp_inbound WHERE phone_id=$1 AND provider_id=$2',[c.phoneId,m.id])).rowCount)continue;
            let mapped=(await client.query('SELECT conversation_id FROM whatsapp_conversations WHERE phone_id=$1 AND recipient=$2',[c.phoneId,m.from])).rows[0];
            const actor='whatsapp:'+createHash('sha256').update(c.phoneId+':'+m.from).digest('hex').slice(0,24);
            if(!mapped){
              mapped={conversation_id:randomUUID()};
              await client.query('INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,$3)',[mapped.conversation_id,c.storeId,actor]);
              await client.query('INSERT INTO whatsapp_conversations(conversation_id,phone_id,recipient,last_inbound_at) VALUES($1,$2,$3,to_timestamp($4))',[mapped.conversation_id,c.phoneId,m.from,seconds]);
            }else{
              await client.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE',[mapped.conversation_id]);
              await client.query('UPDATE whatsapp_conversations SET last_inbound_at=greatest(last_inbound_at,to_timestamp($1)) WHERE conversation_id=$2',[seconds,mapped.conversation_id]);
            }
            const ctx:ActorContext={storeId:c.storeId,conversationId:mapped.conversation_id,actor,role:'customer'},messageId=randomUUID();
            const supported=m.type==='text'&&m.text;
            const text=supported?m.text!.body:`[${m.type} message received; this connection currently supports text only]`;
            const state=await loadState(client,ctx),memory=await loadAssistantMemory(client,ctx);
            await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload,binding_id,created_at) VALUES($1,$2,'inbound',$3,$4,$5::jsonb,$6,to_timestamp($7))",[messageId,ctx.conversationId,text,supported?'pending':'processed',JSON.stringify({id:messageId,type:'text',text}),conversationBinding(state,memory),seconds]);
            await client.query('INSERT INTO whatsapp_inbound(phone_id,provider_id,message_id) VALUES($1,$2,$3)',[c.phoneId,m.id,messageId]);
            if(!supported){
              const replyId=randomUUID();
              await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,response_to) VALUES($1,$2,'outbound','This WhatsApp test currently supports text. Please type your request.','queued',$3)",[replyId,ctx.conversationId,messageId]);
              await client.query('INSERT INTO whatsapp_outbox(message_id,conversation_id,operator_revision) SELECT $1,id,operator_revision FROM conversations WHERE id=$2',[replyId,ctx.conversationId]);
            }
            accepted++;
          }
          for(const s of v.statuses??[]){
            if(!c.recipients.includes(s.recipient_id))continue;
            await client.query('INSERT INTO whatsapp_statuses(phone_id,provider_id,recipient,state,provider_timestamp,callback_id,error_code) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[c.phoneId,s.id,s.recipient_id,s.status,Number(s.timestamp),s.biz_opaque_callback_data??null,s.errors?.[0]?.code??null]);
          }
          await client.query('UPDATE whatsapp_channels SET last_received_at=now() WHERE phone_id=$1',[c.phoneId]);
        }
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    await this.reconcile();
    return {accepted};
  }
  async verified(){await this.pool.query('UPDATE whatsapp_channels SET verified_at=now() WHERE phone_id=$1',[this.config.phoneId]);}
  async reconcile(){
    // Status callbacks can precede the send HTTP response. Keep them durable.
    await this.pool.query(`WITH latest AS (
      SELECT DISTINCT ON(o.message_id) o.message_id,s.provider_id,s.state,s.error_code
      FROM whatsapp_outbox o JOIN whatsapp_conversations c ON c.conversation_id=o.conversation_id
      JOIN whatsapp_statuses s ON s.phone_id=c.phone_id AND s.recipient=c.recipient AND (s.provider_id=o.provider_id OR s.callback_id=o.message_id)
      WHERE c.phone_id=$1 AND o.state IN ('sending','unknown','accepted','delivered','read','failed')
      ORDER BY o.message_id,CASE s.state WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'failed' THEN 2 ELSE 1 END DESC,s.provider_timestamp DESC
    ), updated AS (
      UPDATE whatsapp_outbox o SET provider_id=l.provider_id,state=CASE l.state WHEN 'sent' THEN 'accepted' ELSE l.state END,last_error=CASE WHEN l.error_code IS NULL THEN NULL ELSE 'meta_'||l.error_code::text END
      FROM latest l WHERE o.message_id=l.message_id AND (o.state NOT IN ('read','delivered') OR l.state='read') RETURNING o.message_id,o.state
    ) UPDATE messages m SET status=u.state FROM updated u WHERE m.id=u.message_id`,[this.config.phoneId]);
  }
  async processNext(){
    if(!this.config.processEnabled)return false;
    const row=(await this.pool.query(`SELECT c.id,c.actor FROM whatsapp_conversations w JOIN conversations c ON c.id=w.conversation_id JOIN stores s ON s.id=c.store_id JOIN messages m ON m.conversation_id=c.id
      WHERE w.phone_id=$1 AND c.store_id=$2 AND NOT s.operator_paused AND c.operator_mode='assistant' AND (m.status='pending' OR m.status='processing' AND m.lease_until<=now()) ORDER BY m.sequence LIMIT 1`,[this.config.phoneId,this.config.storeId])).rows[0];
    return row?this.runtime.processNext({storeId:this.config.storeId,conversationId:row.id,actor:row.actor,role:'customer'}):false;
  }
  async sendNext(){
    const c=this.config;
    if(!c.sendEnabled)return false;
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT id FROM stores WHERE id=$1 FOR SHARE',[c.storeId]);
      const channel=(await client.query('SELECT send_blocked FROM whatsapp_channels WHERE phone_id=$1',[c.phoneId])).rows[0];
      if(channel?.send_blocked){await client.query('COMMIT');return false;}
      // Recovered in-flight sends are ambiguous: never automatically resend them.
      await client.query("UPDATE messages SET status='unknown' WHERE id IN (SELECT o.message_id FROM whatsapp_outbox o JOIN whatsapp_conversations w ON w.conversation_id=o.conversation_id WHERE w.phone_id=$1 AND o.state='sending' AND o.started_at<now()-interval '1 minute')",[c.phoneId]);
      await client.query("UPDATE whatsapp_outbox o SET state='unknown',last_error='interrupted_send' FROM whatsapp_conversations w WHERE w.conversation_id=o.conversation_id AND w.phone_id=$1 AND o.state='sending' AND o.started_at<now()-interval '1 minute'",[c.phoneId]);
      const row=(await client.query(`SELECT o.*,m.text,w.recipient,w.last_inbound_at,c.operator_mode,c.operator_revision AS current_revision,s.operator_paused
        FROM whatsapp_outbox o JOIN whatsapp_conversations w ON w.conversation_id=o.conversation_id JOIN conversations c ON c.id=w.conversation_id JOIN stores s ON s.id=c.store_id JOIN messages m ON m.id=o.message_id
        WHERE w.phone_id=$1 AND c.store_id=$2 AND o.state='queued' AND o.next_attempt_at<=now() AND NOT s.operator_paused AND c.operator_mode='assistant' ORDER BY o.created_at LIMIT 1 FOR UPDATE OF o,c SKIP LOCKED`,[c.phoneId,c.storeId])).rows[0];
      if(!row){await client.query('COMMIT');return false;}
      if(row.operator_paused||row.operator_mode==='owner'){await client.query('COMMIT');return false;}
      if(row.operator_revision!==row.current_revision||!c.recipients.includes(row.recipient)||Date.now()-new Date(row.last_inbound_at).getTime()>=24*3600000){
        await this.setDelivery(client,row.message_id,'blocked','stale_reply_or_closed_window');await client.query('COMMIT');return true;
      }
      await client.query("UPDATE whatsapp_outbox SET state='sending',attempts=attempts+1,started_at=now() WHERE message_id=$1",[row.message_id]);
      await client.query("UPDATE messages SET status='sending' WHERE id=$1",[row.message_id]);
      await client.query('COMMIT');
      // Reacquire owner locks after durably recording the attempt. No owner pause
      // can return success while this bounded HTTP request is still in progress.
      await client.query('BEGIN');
      await client.query('SELECT id FROM stores WHERE id=$1 FOR SHARE',[c.storeId]);
      const controls=(await client.query('SELECT c.operator_mode,c.operator_revision,s.operator_paused FROM conversations c JOIN stores s ON s.id=c.store_id WHERE c.id=$1 FOR UPDATE OF c',[row.conversation_id])).rows[0];
      if(controls.operator_paused||controls.operator_mode==='owner'||controls.operator_revision!==row.current_revision){await this.setDelivery(client,row.message_id,'cancelled','owner_control_changed');await client.query('COMMIT');return true;}
      try{
        const response=await this.request(`https://graph.facebook.com/${c.graphVersion}/${c.phoneId}/messages`,{method:'POST',headers:{authorization:'Bearer '+c.accessToken,'content-type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:row.recipient,type:'text',text:{preview_url:false,body:row.text},biz_opaque_callback_data:row.message_id}),signal:AbortSignal.timeout(8000)});
        const data=await response.json().catch(()=>null) as any;
        if(response.ok&&typeof data?.messages?.[0]?.id==='string'){
          await client.query("UPDATE whatsapp_outbox SET provider_id=$1,state='accepted',last_error=NULL WHERE message_id=$2",[data.messages[0].id,row.message_id]);
          await client.query("UPDATE messages SET status='accepted' WHERE id=$1",[row.message_id]);
        }else if(response.status===429&&row.attempts<2){
          await client.query("UPDATE whatsapp_outbox SET state='queued',next_attempt_at=now()+interval '60 seconds',last_error='meta_rate_limit' WHERE message_id=$1",[row.message_id]);
          await client.query("UPDATE messages SET status='queued' WHERE id=$1",[row.message_id]);
        }else{
          const code=Number.isInteger(data?.error?.code)?data.error.code:response.status;
          await this.setDelivery(client,row.message_id,response.ok||response.status>=500?'unknown':'failed','meta_'+code);
          if(response.status===401||response.status===403||code===190||code===10||code===200)await client.query("UPDATE whatsapp_channels SET send_blocked=true,last_error='authentication_or_permission' WHERE phone_id=$1",[c.phoneId]);
        }
      }catch{
        await this.setDelivery(client,row.message_id,'unknown','network_outcome_unknown');
      }
      await client.query('COMMIT');
      await this.reconcile();return true;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  private async setDelivery(client:PoolClient,id:string,state:string,error:string){
    await client.query('UPDATE whatsapp_outbox SET state=$1,last_error=$2 WHERE message_id=$3',[state,error,id]);
    await client.query('UPDATE messages SET status=$1 WHERE id=$2',[state,id]);
  }
}
