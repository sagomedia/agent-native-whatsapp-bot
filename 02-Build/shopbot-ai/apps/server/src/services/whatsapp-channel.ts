import {recipientAllowed,admitCustomerMessage,admitCustomerMedia,observeCustomerIntent,queueHandoffNotice} from './customer-admission.js';
import {recoverReviewQueue} from './review-queue-recovery.js';
import {refreshOrderListChoice} from './order-list-choice.js';
import {normalizeVoice} from './voice-media.js';
import {reviewDeliveryReady} from './review-delivery.js';
import {whatsappSendError} from './whatsapp-send-error.js';
import {catalogPhoto} from './catalog-photos.js';
import {createHash,randomUUID} from 'node:crypto';
import {eventSchema,type SimulatorEvent} from '../../../../packages/contracts/index.js';
import {say} from '../../../../packages/contracts/language.js';
import {renderWhatsAppReply} from './whatsapp-reply.js';
import {plainReply} from './replies.js';
import {shoppingButton} from './shopping-flow.js';
import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import {MockInterpreter} from '../adapters/mock-interpreter.js';
import type {Interpreter} from '../adapters/interpreter.js';
import {ConversationRuntime} from '../runtime/conversation.js';
import {loadState} from './tools.js';
import {loadAssistantMemory,conversationBinding} from './agent-assistance.js';
import type {ActorContext} from './context.js';
import type {WhatsAppConfig} from './whatsapp-config.js';
import {recordDeliveryPricing,monthRange,savePricingAnalytics} from './messaging-cost.js';
import {downloadWhatsAppMedia,mediaFailureCode} from './whatsapp-media.js';

const id=z.string().min(1).max(512),digits=z.string().regex(/^\d{7,15}$/),timestamp=z.string().regex(/^\d{1,12}$/);
const incoming=z.object({id,from:digits,timestamp,type:z.string().max(40),text:z.object({body:z.string().min(1).max(4096)}).optional(),image:z.object({id,caption:z.string().trim().max(1000).optional()}).optional(),audio:z.object({id}).optional(),context:z.object({id}).optional(),button:z.object({payload:id,text:z.string().max(200)}).optional(),interactive:z.object({type:z.string(),button_reply:z.object({id,title:z.string().max(200)}).optional(),list_reply:z.object({id,title:z.string().max(200)}).optional()}).optional()});
const status=z.object({id,recipient_id:digits,timestamp,status:z.enum(['sent','delivered','read','failed']),biz_opaque_callback_data:z.uuid().optional(),errors:z.array(z.object({code:z.number().int()})).max(10).optional(),pricing:z.unknown().optional()});
// A malformed optional contact must not discard an otherwise valid message.
const contact=z.object({wa_id:digits,profile:z.object({name:z.string().max(512).optional().catch(undefined)}).optional().catch(undefined)}).optional().catch(undefined);
function profileName(value:string|undefined){
  const cleaned=value?.replace(/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,' ').replace(/\s+/gu,' ').trim();
  return cleaned?Array.from(cleaned).slice(0,200).join(''):null;
}
export const webhookSchema=z.object({object:z.literal('whatsapp_business_account'),entry:z.array(z.object({id:z.string(),changes:z.array(z.object({field:z.string(),value:z.object({metadata:z.object({phone_number_id:z.string()}).optional(),contacts:z.array(contact).max(100).optional(),messages:z.array(incoming).max(100).optional(),statuses:z.array(status).max(100).optional()})})).max(20)})).max(20)});
type Webhook=z.infer<typeof webhookSchema>;
export type WhatsAppFetch=typeof fetch;

export class WhatsAppChannel {
  readonly runtime:ConversationRuntime;
  private readonly planningConversations=new Set<string>();
  constructor(private pool:Pool,readonly config:WhatsAppConfig,private request:WhatsAppFetch=fetch,private provider?:Interpreter){
    if(config.aiEnabled&&(!provider||provider.mode!=='live'||!provider.freeQuota&&(!config.paidEnabled||!config.budgetMicrousd||config.budgetMicrousd>5000000)))throw new Error('WhatsApp AI requires the configured free-tier or explicitly budgeted interpreter');
    if(!config.aiEnabled&&provider)throw new Error('WhatsApp AI has not been enabled');
    this.runtime=new ConversationRuntime(pool,provider??new MockInterpreter(),{observeTurn:config.audience==='public'?async(client,ctx,offTopic)=>{
      if(!await observeCustomerIntent(client,ctx,offTopic))return false;
      await queueHandoffNotice(client,ctx,await loadState(client,ctx),config.sendEnabled);return true;
    }:undefined,allowFreeInference:!!config.aiEnabled,allowPaidInference:!!config.aiEnabled&&!!config.paidEnabled,discoveryStages:!!config.discoveryStages,mediaRecommendations:!!config.mediaRecommendations,sequentialItems:!!config.sequentialItems,visualOrdering:!!config.visualOrdering,maxDraftLines:config.maxDraftLines,advance:config.advance,partialReviews:config.partialReviews,welcomeAudio:config.welcomeAudio,queueReply:async(client,ctx,messageId,rich)=>{
      const rateMicroInr=config.serviceRateMicroInr??(config.serviceRatePaise===undefined?undefined:config.serviceRatePaise*10000);
      if(rateMicroInr!==undefined&&Number.isSafeInteger(rateMicroInr)&&rateMicroInr>=0&&Number.isSafeInteger(rateMicroInr*rich.outboundMessages)){
        rich.deliveryEstimate={category:'service',ratePaise:rateMicroInr/10000,totalPaise:rateMicroInr*rich.outboundMessages/10000,rateMicroInr,totalMicroInr:rateMicroInr*rich.outboundMessages,estimateOnly:true};
        await client.query('UPDATE messages SET payload=$1::jsonb WHERE id=$2',[JSON.stringify(rich),messageId]);
      }
      const revision=(await client.query('SELECT operator_revision FROM conversations WHERE id=$1',[ctx.conversationId])).rows[0].operator_revision;
      const state=await loadState(client,ctx),memory=await loadAssistantMemory(client,ctx);
      let rendered;
      try{rendered=renderWhatsAppReply(rich,messageId,config.hostname);}
      catch{
        // Do not leave consent live for a review which was never displayed.
        if(rich.kind==='order_review'||rich.parts)await client.query('UPDATE conversations SET pending=NULL WHERE id=$1',[ctx.conversationId]);
        const fallback=plainReply(say(state,'Your list is kept, but this reply has too many details to show safely in one message. Tell me which item to edit or remove, then review the list again.','உங்கள் பட்டியல் உள்ளது. ஒரே செய்தியில் காட்ட விவரங்கள் அதிகமாக உள்ளன. மாற்ற அல்லது நீக்க வேண்டிய பொருளைச் சொல்லுங்கள்; பிறகு பட்டியலை மீண்டும் பார்க்கலாம்.','Unga list irukku. Ore message-la kaatta details adhigam. Edit illa remove panna porulai sollunga; piragu list-ai marubadi paarunga.'));
        fallback.replyLanguage=state.replyLanguage;
        await client.query('UPDATE messages SET text=$1,payload=$2::jsonb WHERE id=$3',[fallback.text,JSON.stringify(fallback),messageId]);
        rendered=renderWhatsAppReply(fallback,messageId,config.hostname);
      }
      await client.query('INSERT INTO whatsapp_outbox(message_id,conversation_id,operator_revision,reply_payload,sender_kind) VALUES($1,$2,$3,$4::jsonb,$5)',[messageId,ctx.conversationId,revision,JSON.stringify(rendered.payload),rich.handoffRequested?'system':'assistant']);
      for(const action of rendered.actions)await client.query('INSERT INTO whatsapp_actions(id,message_id,conversation_id,event,label,source_version,operator_revision,binding_id) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)',[action.id,messageId,ctx.conversationId,JSON.stringify(action.event),action.label,state.version,revision,conversationBinding(state,memory)]);
    }});
  }
  async catalogPhoto(id:string,kind:'custom'|'reference'='custom'){return catalogPhoto(this.pool,this.config.storeId,id,true,kind);}
  async hasCatalogImage(filename:string){return !!(await this.pool.query('SELECT 1 FROM products WHERE store_id=$1 AND active=true AND image_path=$2',[this.config.storeId,'/demo-images/'+filename])).rowCount;}
  async setup(){
    const c=this.config;
    const old=(await this.pool.query('SELECT store_id,app_id,waba_id FROM whatsapp_channels WHERE phone_id=$1',[c.phoneId])).rows[0];
    if(old&&(old.store_id!==c.storeId||old.app_id!==c.appId||old.waba_id!==c.wabaId))throw new Error('WhatsApp sender is already bound to another channel; explicit migration required');
    await this.pool.query('INSERT INTO whatsapp_channels(phone_id,store_id,app_id,waba_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[c.phoneId,c.storeId,c.appId,c.wabaId]);
    if(c.aiEnabled&&c.paidEnabled&&!this.provider?.freeQuota){
      await this.pool.query('INSERT INTO inference_budgets(store_id,limit_microusd) VALUES($1,$2) ON CONFLICT DO NOTHING',[c.storeId,c.budgetMicrousd]);
      const budget=(await this.pool.query('SELECT limit_microusd FROM inference_budgets WHERE store_id=$1',[c.storeId])).rows[0];
      if(Number(budget.limit_microusd)!==c.budgetMicrousd)throw new Error('Stored WhatsApp budget differs; an explicit reviewed budget change is required');
    }
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
            if(!recipientAllowed(c,m.from))continue;
            const seconds=Number(m.timestamp);
            if(!Number.isSafeInteger(seconds)||seconds<1||seconds>Date.now()/1000+300)continue;
            if((await client.query('SELECT 1 FROM whatsapp_inbound WHERE phone_id=$1 AND provider_id=$2',[c.phoneId,m.id])).rowCount)continue;
            let mapped=(await client.query('SELECT conversation_id FROM whatsapp_conversations WHERE phone_id=$1 AND recipient=$2',[c.phoneId,m.from])).rows[0];
            const name=profileName(v.contacts?.find(contact=>contact?.wa_id===m.from)?.profile?.name);
            const actor='whatsapp:'+createHash('sha256').update(c.phoneId+':'+m.from).digest('hex').slice(0,24);
            if(!mapped){
              mapped={conversation_id:randomUUID()};
              await client.query('INSERT INTO conversations(id,store_id,actor,reply_language) VALUES($1,$2,$3,$4)',[mapped.conversation_id,c.storeId,actor,c.defaultReplyLanguage??'ta']);
              await client.query('INSERT INTO whatsapp_conversations(conversation_id,phone_id,recipient,last_inbound_at) VALUES($1,$2,$3,to_timestamp($4))',[mapped.conversation_id,c.phoneId,m.from,seconds]);
            }else{
              await client.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE',[mapped.conversation_id]);
              await client.query('UPDATE whatsapp_conversations SET last_inbound_at=greatest(last_inbound_at,to_timestamp($1)) WHERE conversation_id=$2',[seconds,mapped.conversation_id]);
            }
            // Do not erase a known name when a webhook omits contacts, or let an
            // older delayed message replace a newer profile. Names are display-only.
            if(name)await client.query(`UPDATE whatsapp_conversations SET profile_name=$1,profile_updated_at=to_timestamp($2)
              WHERE conversation_id=$3 AND (profile_updated_at IS NULL OR profile_updated_at<=to_timestamp($2))`,[name,seconds,mapped.conversation_id]);
            const ctx:ActorContext={storeId:c.storeId,conversationId:mapped.conversation_id,actor,role:'customer'},messageId=randomUUID();
            if(c.visualOrdering)await client.query('UPDATE conversations SET visual_ordering=true WHERE id=$1',[ctx.conversationId]);
            const state=await loadState(client,ctx),memory=await loadAssistantMemory(client,ctx);
            let event:SimulatorEvent|undefined=m.type==='text'&&m.text?{id:messageId,type:'text',text:m.text.body}:undefined;
            const media=this.config.mediaEnabled?(m.type==='image'&&m.image&&this.provider?.supportsImages?{id:m.image.id,kind:'image' as const}:m.type==='audio'&&m.audio&&this.provider?.supportsAudio?{id:m.audio.id,kind:'voice' as const}:undefined):undefined;
            if(media)event=media.kind==='image'?{id:messageId,type:'image',mediaId:messageId,caption:m.image?.caption??''}:{id:messageId,type:'voice',mediaId:messageId};
            let text=event?.type==='text'?event.text:`[${m.type} message]`,binding=conversationBinding(state,memory);
            const interactive=m.type==='interactive'?m.interactive:undefined;
            let invoiceArriving=false,staleListChoice=false;
            let staleContext=false;
            if(event?.type==='text'&&m.context){
              const quoted=(await client.query(`SELECT a.binding_id,a.source_version FROM whatsapp_actions a JOIN whatsapp_outbox o ON o.message_id=a.message_id WHERE o.provider_id=$1 AND a.conversation_id=$2 AND o.state IN ('accepted','delivered','read') LIMIT 1`,[m.context.id,ctx.conversationId])).rows[0];
              if(quoted){binding=quoted.binding_id;if(quoted.source_version!==state.version||binding!==conversationBinding(state,memory)){event=undefined;staleContext=true;}}
            }
            // Carousel quick replies use the button callback shape; ordinary
            // session buttons and list choices use interactive replies.
            const tapped=m.type==='button'&&m.button?{id:m.button.payload,title:m.button.text}:interactive?.type==='button_reply'?interactive.button_reply:interactive?.type==='list_reply'?interactive.list_reply:undefined;
            if(tapped){
              // IDs and events come from our outbox, never a customer's button title.
              const action=(await client.query(`SELECT a.*,o.provider_id,o.state AS delivery_state,c.operator_revision AS current_revision
                FROM whatsapp_actions a JOIN whatsapp_outbox o ON o.message_id=a.message_id JOIN conversations c ON c.id=a.conversation_id
                WHERE a.id=$1 AND a.conversation_id=$2 AND a.expires_at>now()`,[tapped.id,ctx.conversationId])).rows[0];
              const parsed=eventSchema.safeParse(action?.event);
              staleListChoice=!!(state.visualOrdering&&state.lastRequestId&&memory?.purpose==='list_choice'&&memory.sourceVersion!==state.version&&action&&parsed.success&&parsed.data.type==='shopping_action'&&['new_list','continue_list'].includes(parsed.data.action)&&action.binding_id===memory.id&&action.source_version!==state.version&&action.operator_revision===action.current_revision&&['accepted','delivered','read'].includes(action.delivery_state)&&(!m.context||m.context.id===action.provider_id));
              const complete=parsed.success&&(parsed.data.type==='confirm'||parsed.data.type==='confirm_products')?await reviewDeliveryReady(client,ctx.conversationId,action?.binding_id??binding,true,parsed.data.id):true;
              invoiceArriving=!complete&&!!action&&action.source_version===state.version&&action.binding_id===binding;
              if(complete&&action&&parsed.success&&action.source_version===state.version&&action.operator_revision===action.current_revision&&action.binding_id===binding&&['accepted','delivered','read'].includes(action.delivery_state)&&(!m.context||m.context.id===action.provider_id)){
                event=parsed.data;text=action.label;binding=action.binding_id;
              }
            }
            await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload,binding_id,created_at) VALUES($1,$2,'inbound',$3,$4,$5::jsonb,$6,to_timestamp($7))",[messageId,ctx.conversationId,text,event?'pending':'processed',JSON.stringify(event??{id:messageId,type:'text',text}),binding,seconds]);
            await client.query('INSERT INTO whatsapp_inbound(phone_id,provider_id,message_id) VALUES($1,$2,$3)',[c.phoneId,m.id,messageId]);
            if(media)await client.query('INSERT INTO whatsapp_media(message_id,media_id,kind,source_version) VALUES($1,$2,$3,$4)',[messageId,media.id,media.kind,state.version]);
            if(c.audience==='public'){
              const decision=await admitCustomerMessage(client,ctx,{text:event?.type==='text'?event.text:undefined,version:state.version,binding});
              if(decision!=='allow'){
                await client.query("UPDATE messages SET status='processed',reply_decision=$2 WHERE id=$1",[messageId,decision==='quiet'?'duplicate_suppressed':'held_for_owner']);
                await queueHandoffNotice(client,ctx,state,c.sendEnabled);accepted++;continue;
              }
            }
            if(event&&c.sendEnabled){
              const control=(await client.query('SELECT operator_mode,operator_revision FROM conversations WHERE id=$1',[ctx.conversationId])).rows[0];
              const already=(await client.query("SELECT 1 FROM messages m JOIN whatsapp_outbox o ON o.message_id=m.id WHERE m.conversation_id=$1 AND o.operator_revision=$2 AND m.payload->>'clarificationReason'='owner_handling' LIMIT 1",[ctx.conversationId,control.operator_revision])).rowCount;
              if(control.operator_mode==='owner'&&!already){
                const rid=randomUUID(),waiting={...plainReply(say(state,'Your message is saved. The shop is handling this chat and will reply here. The assistant will continue when the shop returns control.','உங்கள் தகவல் சேமிக்கப்பட்டது. இந்த உரையாடலை இப்போது கடை கவனிக்கிறது; இங்கே பதில் தரும். கடை மீண்டும் ஒப்படைத்ததும் உதவியாளர் தொடரும்.','Unga message save panniyachu. Ippo kadai intha chat-ai paarkkirathu; inge reply pannum. Kadai control thiruppi koduththathum assistant thodarum.')),stage:'status' as const,clarificationReason:'owner_handling'};
                await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload,stage) VALUES($1,$2,'outbound',$3,'queued',$4::jsonb,'status')",[rid,ctx.conversationId,waiting.text,JSON.stringify(waiting)]);
                await client.query("INSERT INTO whatsapp_outbox(message_id,conversation_id,operator_revision,sender_kind,reply_payload) VALUES($1,$2,$3,'system',$4::jsonb)",[rid,ctx.conversationId,control.operator_revision,JSON.stringify({type:'text',text:{preview_url:false,body:waiting.text}})]);
              }
            }
            if(!event){
              const replyId=randomUUID();let reply=plainReply(tapped||staleContext?say(state,'That choice has expired. Please use the latest product choices or review your list. Your list is unchanged.','இந்தத் தேர்வு காலாவதியானது. தற்போதைய படங்களில் தேர்வு செய்யுங்கள் அல்லது பட்டியலைப் பாருங்கள். பட்டியல் மாறவில்லை.','Intha choice expired. Latest photos-la choose pannunga illa list-ai paarunga. List maarala.'):say(state,'Please type your request or use the product buttons.','உங்கள் கோரிக்கையை எழுதுங்கள் அல்லது பொருள் பொத்தான்களைப் பயன்படுத்துங்கள்.','Unga request-ai type pannunga illa product buttons use pannunga.'));
              if(invoiceArriving){reply.text=say(state,'The full bill is still arriving. Wait a moment, then use Send order to shop on the latest bill. No order has been sent yet.','Bill முழுசா இன்னும் வந்து சேரல. கொஞ்சம் wait பண்ணிட்டு, latest bill-ல கடைக்கு அனுப்பு அழுத்துங்க. Order இன்னும் அனுப்பல.','Bill muzhusa innum vandhu serala. Konjam wait pannittu latest bill-la kadaikku anuppu press pannunga. Order innum anuppala.');reply.clarificationReason='invoice_delivery_pending';}
              if(tapped||staleContext)reply.buttons=[state.lastRequestId?{label:say(state,'Request status','கோரிக்கை நிலை','Request status'),event:{id:randomUUID(),type:'shopping_action',action:'status',expectedVersion:state.version}}:{label:say(state,'Review list','பட்டியலைப் பார்','List paaru'),event:{id:randomUUID(),type:'review',expectedVersion:state.version}}];
              if(staleListChoice&&memory)reply=await refreshOrderListChoice(client,ctx,state,memory);
              const replyBinding=conversationBinding(state,staleListChoice?await loadAssistantMemory(client,ctx):memory);
              const rendered=renderWhatsAppReply(reply,replyId,c.hostname);
              await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,response_to,payload) VALUES($1,$2,'outbound',$3,'queued',$4,$5::jsonb)",[replyId,ctx.conversationId,reply.text,messageId,JSON.stringify(reply)]);
              await client.query('INSERT INTO whatsapp_outbox(message_id,conversation_id,operator_revision,reply_payload) SELECT $1,id,operator_revision,$3::jsonb FROM conversations WHERE id=$2',[replyId,ctx.conversationId,JSON.stringify(rendered.payload)]);
              for(const action of rendered.actions)await client.query('INSERT INTO whatsapp_actions(id,message_id,conversation_id,event,label,source_version,operator_revision,binding_id) SELECT $1,$2,id,$3::jsonb,$4,$5,operator_revision,$6 FROM conversations WHERE id=$7',[action.id,replyId,JSON.stringify(action.event),action.label,state.version,replyBinding,ctx.conversationId]);
            }
            accepted++;
          }
          for(const s of v.statuses??[]){
            await recordDeliveryPricing(client,{storeId:c.storeId,phoneId:c.phoneId,accountTimezone:c.accountTimezone,accountCurrency:c.accountCurrency,rateCard:c.pricingRateCard},s);
            if(!recipientAllowed(c,s.recipient_id))continue;
            await client.query('INSERT INTO whatsapp_statuses(phone_id,provider_id,recipient,state,provider_timestamp,callback_id,error_code,pricing) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(phone_id,provider_id,state,provider_timestamp) DO UPDATE SET pricing=coalesce(whatsapp_statuses.pricing,excluded.pricing)',[c.phoneId,s.id,s.recipient_id,s.status,Number(s.timestamp),s.biz_opaque_callback_data??null,s.errors?.[0]?.code??null,JSON.stringify(s.pricing??null)]);
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
  async processMediaNext(){
    if(!this.config.processEnabled||!this.config.mediaEnabled)return false;
    const client=await this.pool.connect();let row:any;
    try{
      await client.query('BEGIN');
      row=(await client.query(`SELECT a.*,m.conversation_id,m.reply_decision,c.actor,c.operator_revision FROM whatsapp_media a JOIN messages m ON m.id=a.message_id JOIN conversations c ON c.id=m.conversation_id JOIN whatsapp_conversations w ON w.conversation_id=c.id WHERE c.store_id=$1 AND w.phone_id=$2 AND (a.state='pending' OR a.state='fetching' AND a.lease_until<=now()) AND (m.reply_decision='held_for_owner' OR m.id=(SELECT head.id FROM messages head WHERE head.conversation_id=c.id AND head.status IN ('pending','processing') ORDER BY head.sequence LIMIT 1)) ORDER BY m.sequence LIMIT 1 FOR UPDATE OF a SKIP LOCKED`,[this.config.storeId,this.config.phoneId])).rows[0];
      if(row)row.claimLease=(await client.query("UPDATE whatsapp_media SET state='fetching',lease_until=now()+interval '120 seconds' WHERE message_id=$1 RETURNING lease_until::text AS lease",[row.message_id])).rows[0].lease;
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    if(!row)return false;
    let media:Awaited<ReturnType<typeof downloadWhatsAppMedia>>|undefined,mediaError:string|null=null;
    let receivedHash=row.original_audio?createHash('sha256').update(row.original_mime_type).update(row.original_audio).digest('hex'):undefined;
    try{
      if(row.kind==='voice'&&row.original_audio&&row.original_mime_type){
        media=await normalizeVoice({id:row.message_id,mimeType:row.original_mime_type,data:row.original_audio.toString('base64')});
      }else media=await downloadWhatsAppMedia(this.config,this.request,row.media_id,row.kind,row.message_id,async source=>{
        receivedHash=createHash('sha256').update(source.mimeType).update(source.audio).digest('hex');
        const saved=await this.pool.query("UPDATE whatsapp_media SET original_audio=$1,original_mime_type=$2,downloaded_at=now() WHERE message_id=$3 AND state='fetching' AND lease_until=$4::timestamptz AND lease_until>now()",[source.audio,source.mimeType,row.message_id,row.claimLease]);
        if(!saved.rowCount)throw new Error('Media work lease expired before saving the downloaded recording');
      });
    }catch(error){mediaError=mediaFailureCode(error);}
    const ctx:ActorContext={storeId:this.config.storeId,conversationId:row.conversation_id,actor:row.actor,role:'customer'};
    const held=await this.pool.connect();
    try{
      await held.query('BEGIN');await held.query('SELECT id FROM stores WHERE id=$1 FOR SHARE',[ctx.storeId]);await held.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE',[ctx.conversationId]);
      const claim=await held.query("SELECT message_id FROM whatsapp_media WHERE message_id=$1 AND state='fetching' AND lease_until=$2::timestamptz AND lease_until>now() FOR UPDATE",[row.message_id,row.claimLease]);
      if(!claim.rowCount){await held.query('COMMIT');return false;}
      if(media&&'image' in media)await held.query('INSERT INTO image_media(id,store_id,conversation_id,actor,source_hash,image,width,height,source_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING',[row.message_id,ctx.storeId,ctx.conversationId,ctx.actor,media.sourceHash,media.image,media.width,media.height,row.source_version]);
      else if(media&&'audio' in media)await held.query('INSERT INTO voice_media(id,store_id,conversation_id,actor,source_hash,audio,duration_seconds,source_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[row.message_id,ctx.storeId,ctx.conversationId,ctx.actor,media.sourceHash,media.audio,media.durationSeconds,row.source_version]);
      await held.query("UPDATE whatsapp_media SET state=$1,lease_until=NULL,last_error=$2 WHERE message_id=$3",[media?'ready':'failed',media?null:mediaError,row.message_id]);
      let mediaDecision:'allow'|'quiet'|'owner'='allow';
      const attachmentHash=media?.sourceHash??receivedHash;
      if(attachmentHash&&this.config.audience==='public'&&row.reply_decision!=='held_for_owner'){
        const decision=mediaDecision=await admitCustomerMedia(held,ctx,`${row.kind}:${row.source_version}:${attachmentHash}`);
        if(decision!=='allow'){
          await held.query("UPDATE messages SET status='processed',claim_token=NULL,lease_until=NULL,reply_decision=$2 WHERE id=$1",[row.message_id,decision==='quiet'?'duplicate_suppressed':'held_for_owner']);
          await queueHandoffNotice(held,ctx,await loadState(held,ctx),this.config.sendEnabled);
        }
      }
      if(!media&&row.reply_decision!=='held_for_owner'&&mediaDecision==='allow'){
        await held.query("UPDATE messages SET status='processed' WHERE id=$1",[row.message_id]);
        const state=await loadState(held,ctx),memory=await loadAssistantMemory(held,ctx),reply=plainReply(row.kind==='voice'?say(state,mediaError==='media_duration_invalid'?'Please send a voice note up to 90 seconds; your list is kept.':mediaError==='media_decode_timeout'?'Audio processing took too long. Your list is kept. Please try a shorter voice note or send text.':'That voice note did not open; your list is kept.',mediaError==='media_duration_invalid'?'90 seconds-க்குள்ள voice அனுப்புங்க. உங்க list அப்படியே இருக்கு.':mediaError==='media_decode_timeout'?'Voice process பண்ண நேரம் ஆகிடுச்சு. உங்க list அப்படியே இருக்கு. சின்ன voice அல்லது text அனுப்புங்க.':'Voice-ஐ open பண்ண முடியல. உங்க list அப்படியே இருக்கு.',mediaError==='media_duration_invalid'?'90 seconds-kulla voice anuppunga. Unga list appadiye irukku.':mediaError==='media_decode_timeout'?'Voice process panna neram aagiduchu. Unga list appadiye irukku. Chinna voice illa text anuppunga.':'Voice-ai open panna mudiyala. Unga list appadiye irukku.'):say(state,'That photo did not open; your list is kept.','அந்தப் படத்தைத் திறக்க முடியவில்லை; உங்கள் பட்டியல் உள்ளது.','Antha photo-ai thirakka mudiyala; unga list irukku.')),replyId=randomUUID();
        reply.replyLanguage=state.replyLanguage;
        reply.buttons=[shoppingButton(state,'browse',say(state,'Browse items','பொருட்களைப் பார்','Porutkal paaru')),shoppingButton(state,'handoff',say(state,'Talk to shop','கடையிடம் பேசு','Kadaiyila pesu'))];
        const rendered=renderWhatsAppReply(reply,replyId,this.config.hostname);
        await held.query("INSERT INTO messages(id,conversation_id,direction,text,status,response_to,payload) VALUES($1,$2,'outbound',$3,'queued',$4,$5::jsonb)",[replyId,ctx.conversationId,reply.text,row.message_id,JSON.stringify(reply)]);
        await held.query("INSERT INTO whatsapp_outbox(message_id,conversation_id,operator_revision,sender_kind,reply_payload) SELECT $1,id,operator_revision,'system',$3::jsonb FROM conversations WHERE id=$2",[replyId,ctx.conversationId,JSON.stringify(rendered.payload)]);
        for(const action of rendered.actions)await held.query('INSERT INTO whatsapp_actions(id,message_id,conversation_id,event,label,source_version,operator_revision,binding_id) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)',[action.id,replyId,ctx.conversationId,JSON.stringify(action.event),action.label,state.version,row.operator_revision,conversationBinding(state,memory)]);
      }
      await held.query('COMMIT');
    }catch(error){await held.query('ROLLBACK');throw error;}finally{held.release();}
    return true;
  }
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
  async refreshPricingAnalytics(month:string){
    const c=this.config;
    if(!c.accountTimezone||!c.accountCurrency||!c.businessPhoneNumber)throw new Error('Configure the Messaging account timezone, billing currency and business phone number before requesting analytics.');
    const range=monthRange(month,c.accountTimezone),end=Math.min(range.end,Math.floor(Date.now()/1000));
    if(end<=range.start)throw new Error('Future messaging analytics cannot be requested.');
    const url=new URL(`https://graph.facebook.com/${c.graphVersion}/${c.wabaId}`);
    url.searchParams.set('fields',`pricing_analytics.start(${range.start}).end(${end}).granularity(DAILY).phone_numbers(${c.businessPhoneNumber}).dimensions(PHONE,COUNTRY,PRICING_CATEGORY,PRICING_TYPE).metric_types(COST,VOLUME)`);
    const response=await this.request(url,{headers:{authorization:'Bearer '+c.accessToken},signal:AbortSignal.timeout(10000),redirect:'error'});
    if(!response.ok)throw new Error('Messaging pricing analytics could not be retrieved. Existing estimates are retained.');
    const reader=response.body?.getReader();
    if(!reader)throw new Error('Messaging pricing analytics response is empty.');
    const chunks:Uint8Array[]=[];let bytes=0;
    try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>1048576){await reader.cancel();throw new Error('Messaging pricing analytics response is too large.');}chunks.push(chunk.value);}}finally{reader.releaseLock();}
    const text=Buffer.concat(chunks).toString('utf8');
    const client=await this.pool.connect();
    try{await client.query('BEGIN');const result=await savePricingAnalytics(client,{storeId:c.storeId,phoneId:c.phoneId,accountTimezone:c.accountTimezone,rateCard:c.pricingRateCard},{wabaId:c.wabaId,businessPhone:c.businessPhoneNumber,currency:c.accountCurrency,start:range.start,end},JSON.parse(text));await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async processNext(options:{skipMedia?:boolean}={}){
    if(!this.config.processEnabled)return false;
    if(this.config.typingEnabled&&this.config.sendEnabled){
      const c=this.config;
      const indicated=await this.pool.query(`WITH candidate AS (SELECT m.id,i.provider_id FROM messages m JOIN conversations v ON m.conversation_id=v.id JOIN whatsapp_conversations w ON v.id=w.conversation_id JOIN whatsapp_inbound i ON i.message_id=m.id JOIN stores s ON v.store_id=s.id WHERE s.id=$1 AND w.phone_id=$2 AND ($4::boolean OR w.recipient=ANY($3::text[])) AND NOT s.operator_paused AND v.operator_mode='assistant' AND w.last_inbound_at>now()-interval '24 hours' AND m.status='pending' AND m.typing_indicated_at IS NULL AND (m.not_before IS NULL OR m.not_before<=now()) AND m.id=(SELECT oldest.id FROM messages oldest WHERE oldest.conversation_id=v.id AND oldest.status='pending' ORDER BY oldest.sequence LIMIT 1) ORDER BY m.sequence LIMIT 1 FOR UPDATE OF m SKIP LOCKED) UPDATE messages m SET typing_indicated_at=now() FROM candidate c WHERE m.id=c.id RETURNING c.provider_id`,[c.storeId,c.phoneId,c.recipients,c.audience==='public']);
      for(const row of indicated.rows.slice(0,1)){try{await this.request(`https://graph.facebook.com/${c.graphVersion}/${c.phoneId}/messages`,{method:'POST',headers:{authorization:'Bearer '+c.accessToken,'content-type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',status:'read',message_id:row.provider_id,typing_indicator:{type:'text'}}),signal:AbortSignal.timeout(1500)});}catch{}}
    }
    if(!options.skipMedia)await this.processMediaNext();
    // Select only each conversation's oldest unfinished message. A delayed or
    // undecoded first message must never let a later turn overtake it. Excluding
    // active leases lets other chats advance while a provider call is in flight.
    // The bounded candidate batch handles simultaneous local selectors; runtime
    // locking and claim tokens still protect competing processes and restarts.
    const candidates=(await this.pool.query(`SELECT c.id,c.actor FROM whatsapp_conversations w JOIN conversations c ON c.id=w.conversation_id JOIN stores s ON s.id=c.store_id
      JOIN LATERAL (SELECT id,sequence,not_before,status,lease_until FROM messages WHERE conversation_id=c.id AND status IN ('pending','processing') ORDER BY sequence LIMIT 1) m ON true
      WHERE w.phone_id=$1 AND c.store_id=$2 AND NOT s.operator_paused AND c.operator_mode='assistant' AND NOT(c.id=ANY($3::uuid[]))
      AND NOT EXISTS(SELECT 1 FROM messages active WHERE active.conversation_id=c.id AND active.status='processing' AND active.lease_until>now())
      AND (m.status='pending' OR m.lease_until<=now()) AND (m.not_before IS NULL OR m.not_before<=now())
      AND NOT EXISTS(SELECT 1 FROM whatsapp_media a WHERE a.message_id=m.id AND a.state IN ('pending','fetching')) ORDER BY m.sequence LIMIT 10`,[this.config.phoneId,this.config.storeId,[...this.planningConversations]])).rows;
    const row=candidates.find(candidate=>!this.planningConversations.has(candidate.id));
    if(!row)return false;
    this.planningConversations.add(row.id);
    try{return await this.runtime.processNext({storeId:this.config.storeId,conversationId:row.id,actor:row.actor,role:'customer'});}
    finally{this.planningConversations.delete(row.id);}
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
      await recoverReviewQueue(client,c.storeId,c.phoneId);
      // Current invoice pages must arrive in order. An uncertain obsolete review
      // can release a later customer turn only after its action page was explicitly
      // superseded; the uncertain page itself is neither retried nor marked sent.
      const row=(await client.query(`SELECT o.*,m.text,w.recipient,w.last_inbound_at,c.operator_mode,c.operator_revision AS current_revision,s.operator_paused
        FROM whatsapp_outbox o JOIN whatsapp_conversations w ON w.conversation_id=o.conversation_id JOIN conversations c ON c.id=w.conversation_id JOIN stores s ON s.id=c.store_id JOIN messages m ON m.id=o.message_id
        WHERE w.phone_id=$1 AND c.store_id=$2 AND o.state='queued' AND o.next_attempt_at<=now() AND NOT EXISTS(
          SELECT 1 FROM messages earlier JOIN whatsapp_outbox pending ON pending.message_id=earlier.id
          WHERE earlier.conversation_id=m.conversation_id AND earlier.sequence<m.sequence AND pending.operator_revision=o.operator_revision AND pending.state IN ('queued','sending','unknown')
          AND NOT(pending.state='unknown' AND pending.sender_kind='assistant'
            AND earlier.reply_group_id IS NOT NULL AND m.reply_group_id IS DISTINCT FROM earlier.reply_group_id
            AND (o.sender_kind='assistant' AND EXISTS(SELECT 1 FROM messages old_turn JOIN messages new_turn ON new_turn.id=m.response_to
              WHERE old_turn.id=earlier.response_to AND old_turn.conversation_id=m.conversation_id AND new_turn.conversation_id=m.conversation_id
              AND old_turn.direction='inbound' AND new_turn.direction='inbound' AND new_turn.sequence>old_turn.sequence)
             OR o.sender_kind='system' AND EXISTS(SELECT 1 FROM messages resolved
              JOIN whatsapp_outbox delivered ON delivered.message_id=resolved.id
              JOIN messages new_turn ON new_turn.id=resolved.response_to AND new_turn.conversation_id=m.conversation_id AND new_turn.direction='inbound'
              JOIN messages old_turn ON old_turn.id=earlier.response_to AND old_turn.conversation_id=m.conversation_id AND old_turn.direction='inbound'
              WHERE resolved.conversation_id=m.conversation_id AND resolved.sequence>earlier.sequence AND resolved.sequence<m.sequence
               AND new_turn.sequence>old_turn.sequence AND delivered.sender_kind='assistant'
               AND delivered.operator_revision=o.operator_revision AND delivered.state IN ('delivered','read')))
            AND EXISTS(SELECT 1 FROM messages stale JOIN whatsapp_outbox cancelled ON cancelled.message_id=stale.id
              WHERE stale.conversation_id=m.conversation_id AND stale.reply_group_id=earlier.reply_group_id
              AND cancelled.state='cancelled' AND cancelled.last_error='review_superseded'))
        ) AND NOT EXISTS(SELECT 1 FROM messages prior JOIN whatsapp_outbox po ON po.message_id=prior.id WHERE prior.reply_group_id=m.reply_group_id AND prior.part_index<m.part_index AND po.state NOT IN ('delivered','read')) AND
        (o.sender_kind='owner' AND c.operator_mode='owner' OR o.sender_kind='system' OR o.sender_kind='assistant' AND NOT s.operator_paused AND c.operator_mode='assistant') ORDER BY m.sequence LIMIT 1 FOR UPDATE OF o,c SKIP LOCKED`,[c.phoneId,c.storeId])).rows[0];
      if(!row){await client.query('COMMIT');return false;}
      if(row.sender_kind==='assistant'&&(row.operator_paused||row.operator_mode==='owner')){await client.query('COMMIT');return false;}
      if(row.operator_revision!==row.current_revision||!recipientAllowed(c,row.recipient)||Date.now()-new Date(row.last_inbound_at).getTime()>=24*3600000){
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
      if(controls.operator_revision!==row.current_revision||row.sender_kind==='assistant'&&(controls.operator_paused||controls.operator_mode==='owner')||row.sender_kind==='owner'&&controls.operator_mode!=='owner'){await this.setDelivery(client,row.message_id,'cancelled','owner_control_changed');await client.query('COMMIT');return true;}
      let response:Response|undefined,data:any,networkError:unknown;
      try{
        response=await this.request(`https://graph.facebook.com/${c.graphVersion}/${c.phoneId}/messages`,{method:'POST',headers:{authorization:'Bearer '+c.accessToken,'content-type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:row.recipient,...(row.reply_payload??{type:'text',text:{preview_url:false,body:row.text}}),biz_opaque_callback_data:row.message_id}),signal:AbortSignal.timeout(8000),redirect:'error'});
        data=await response.json().catch(()=>null);
      }catch(error){networkError=error;}
      if(!response){
        const failure=whatsappSendError(networkError);
        if(failure.retryable&&row.attempts<2){
          await client.query("UPDATE whatsapp_outbox SET state='queued',next_attempt_at=now()+$2::integer*interval '10 seconds',last_error=$3 WHERE message_id=$1",[row.message_id,row.attempts+1,failure.code]);
          await client.query("UPDATE messages SET status='queued' WHERE id=$1",[row.message_id]);
        }else await this.setDelivery(client,row.message_id,failure.retryable?'failed':'unknown',failure.code);
      }else{
        if(response.ok&&typeof data?.messages?.[0]?.id==='string'){
          await client.query("UPDATE whatsapp_outbox SET provider_id=$1,state='accepted',last_error=NULL WHERE message_id=$2",[data.messages[0].id,row.message_id]);
          await client.query("UPDATE messages SET status='accepted' WHERE id=$1",[row.message_id]);
        }else if(response.status===429&&row.attempts<2){
          await client.query("UPDATE whatsapp_outbox SET state='queued',next_attempt_at=now()+interval '60 seconds',last_error='meta_rate_limit' WHERE message_id=$1",[row.message_id]);
          await client.query("UPDATE messages SET status='queued' WHERE id=$1",[row.message_id]);
        }else{
          const code=Number.isInteger(data?.error?.code)?data.error.code:response.status;
          await this.setDelivery(client,row.message_id,response.ok||response.status>=500?'unknown':'failed',response.ok?'meta_invalid_response':'meta_'+code);
          if(!response.ok&&(response.status===401||response.status===403||code===190||code===10||code===200))await client.query("UPDATE whatsapp_channels SET send_blocked=true,last_error='authentication_or_permission' WHERE phone_id=$1",[c.phoneId]);
        }
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
