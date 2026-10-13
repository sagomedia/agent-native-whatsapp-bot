import type {FastifyInstance} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import {visualStatus,visualReply,orderReference,cartProgress} from '../services/visual-ordering.js';
import {say} from '../../../../packages/contracts/language.js';
import {materializeVisualReply,readVisualImage} from '../services/visual-images.js';
import {renderWhatsAppReply} from '../services/whatsapp-reply.js';
import {z} from 'zod';
import {RetailTools,loadState} from '../services/tools.js';
import {presentReply} from '../services/replies.js';
import {conversationBinding,loadAssistantMemory} from '../services/agent-assistance.js';
import {shoppingActions} from '../services/shopping-actions.js';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {requestStatusText} from '../services/request-status.js';
import type {OrderRequest} from '../../../../packages/contracts/index.js';
import {registerOwnerCatalog} from './owner-catalog.js';
import {catalogPhoto} from '../services/catalog-photos.js';
import {loadImage} from '../services/image-media.js';
import {loadVoice} from '../services/voice-media.js';
import type {Config} from '../config.js';
import {createAccessVerifier,type AccessVerifier} from './access.js';

const uuid=z.uuid();
const revision=z.number().int().nonnegative();
import {GoogleCatalogGenerator,type CatalogGenerator} from '../services/catalog-assistant.js';
export async function registerOwner(app:FastifyInstance,pool:Pool,config:Config,verify?:AccessVerifier,catalogGenerator?:CatalogGenerator){
  const owner=config.owner;
  if(!owner)return;
  verify??=createAccessVerifier(owner);
  if(!(await pool.query('SELECT id FROM stores WHERE id=$1',[owner.storeId])).rowCount)throw new Error('Owner store must already exist');
  app.addHook('onRequest',async(request,reply)=>{
    const host=request.headers.host?.toLowerCase();
    const local=host!==undefined&&/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    const publicOwner=host===owner.hostname;
    if(config.whatsapp&&host===config.whatsapp.hostname&&request.method==='GET'&&/^\/catalog-images\/(?:H\d{2}\.jpg|custom\/[a-f0-9-]{36}\.jpg|messages\/[a-f0-9]{64}\.png)$/.test(request.url.split('?')[0]))return;
    if(config.whatsapp?.privacyPublished&&host===config.whatsapp.hostname&&request.url.split('?')[0]==='/privacy'&&request.method==='GET')return;
    if(config.whatsapp&&host===config.whatsapp.hostname&&request.url.split('?')[0]===(config.whatsapp.path??'/webhooks/whatsapp')&&['GET','POST'].includes(request.method))return;
    if(!local&&!publicOwner)return reply.code(404).send({error:'Not found'});
    const path=request.url.split('?')[0];
    if(publicOwner&&!['/','/owner'].includes(path)&&!path.startsWith('/api/owner/')&&!path.startsWith('/assets/'))return reply.code(404).send({error:'Not found'});
    if(publicOwner||path.startsWith('/api/owner/')){
      reply.header('Cache-Control','private, no-store');
      reply.header('Referrer-Policy','same-origin');
      reply.header('X-Content-Type-Options','nosniff');
      reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      const token=request.headers['cf-access-jwt-assertion'];
      try{if(typeof token!=='string')throw new Error();await verify!(token);}
      catch{return reply.code(403).send({error:'Owner sign-in required'});}
      if(!['GET','HEAD'].includes(request.method)&&(request.headers.origin!=='https://'+owner.hostname||request.headers['x-shopbot-owner']!=='1'||!request.headers['content-type']?.startsWith('application/json')))return reply.code(403).send({error:'Invalid owner request origin'});
    }
  });
  async function write(action:string,target:string,run:(client:PoolClient)=>Promise<unknown>){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      // All controls and worker turns take store, then conversation, in this order.
      await client.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE',[owner!.storeId]);
      const result=await run(client);
      await client.query('INSERT INTO owner_audit(store_id,email,action,target_id,details) VALUES($1,$2,$3,$4,$5::jsonb)',[owner!.storeId,owner!.email,action,target,JSON.stringify(result)]);
      await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  await registerOwnerCatalog(app,pool,owner.storeId,write,catalogGenerator??(config.catalogAi?new GoogleCatalogGenerator(config.catalogAi.apiKey):undefined));
  app.get('/api/owner/snapshot',async()=>{
    const client=await pool.connect();
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const store=(await client.query('SELECT id,name,synthetic,operator_paused,operator_revision FROM stores WHERE id=$1',[owner.storeId])).rows[0];
      const conversations=(await client.query(`SELECT c.id,c.actor,c.operator_mode,c.operator_revision,c.reply_language,c.draft,c.version,
        (SELECT text FROM messages WHERE conversation_id=c.id ORDER BY sequence DESC LIMIT 1) AS last_text,
        (SELECT max(created_at) FROM messages WHERE conversation_id=c.id) AS updated_at,
        (SELECT count(*)::int FROM messages WHERE conversation_id=c.id AND status IN ('pending','processing')) AS pending
        ,c.handoff_requested,(SELECT last_inbound_at FROM whatsapp_conversations WHERE conversation_id=c.id) AS last_inbound_at
        FROM conversations c WHERE store_id=$1 ORDER BY c.handoff_requested DESC,updated_at DESC NULLS LAST,id LIMIT 100`,[owner.storeId])).rows;
      const requests=(await client.query('SELECT id,conversation_id,acceptance,payment,fulfillment,total_paise,lines,created_at FROM order_requests WHERE store_id=$1 ORDER BY created_at DESC LIMIT 100',[owner.storeId])).rows;
      const usage=(await client.query(`SELECT count(*)::int AS attempts,count(*) FILTER(WHERE state='failed')::int AS failures,count(*) FILTER(WHERE state='unknown')::int AS unknown,coalesce(sum(estimated_cost_microusd),0)::text AS estimated_microusd FROM (SELECT state,estimated_cost_microusd FROM provider_attempts WHERE store_id=$1 UNION ALL SELECT state,estimated_cost_microusd FROM catalog_suggestions WHERE store_id=$1) attempts`,[owner.storeId])).rows[0];
      const budget=(await client.query('SELECT limit_microusd,committed_microusd,held_microusd,blocked FROM inference_budgets WHERE store_id=$1',[owner.storeId])).rows[0]??null;
      const audit=(await client.query('SELECT action,target_id,details,created_at FROM owner_audit WHERE store_id=$1 ORDER BY sequence DESC LIMIT 20',[owner.storeId])).rows;
      const wa=config.whatsapp?(await client.query('SELECT verified_at,last_webhook_at,last_received_at,send_blocked,last_error FROM whatsapp_channels WHERE phone_id=$1 AND store_id=$2',[config.whatsapp.phoneId,owner.storeId])).rows[0]:undefined;
      const channel={whatsapp:!wa?'not_connected':wa.send_blocked?'attention_required':wa.last_received_at?'receiving':wa.verified_at||wa.last_webhook_at?'webhook_verified':'awaiting_verification',liveSending:Boolean(wa&&config.whatsapp?.sendEnabled&&!wa.send_blocked),processing:Boolean(config.whatsapp?.processEnabled),lastReceivedAt:wa?.last_webhook_at??null,error:wa?.last_error??null,testOnly:true};
      await client.query('COMMIT');
      return {store,conversations,requests,usage,budget,audit,mode:config.mode,ownerEmail:owner.email,channel,inference:{enabled:!!(wa&&config.whatsapp?.aiEnabled&&config.whatsapp.processEnabled),paidEnabled:!!config.whatsapp?.paidEnabled},limits:{conversations:100,requests:100},generatedAt:new Date().toISOString()};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  });
  app.get<{Params:{id:string}}>('/api/owner/conversations/:id',async(request,reply)=>{
    if(!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Invalid conversation'});
    const messages=(await pool.query(`SELECT m.id,m.conversation_id,m.direction,m.text,m.status,m.created_at,m.payload,o.sender_kind,(w.conversation_id IS NOT NULL) AS whatsapp,
      CASE WHEN m.payload->>'type'='voice' THEN EXISTS(SELECT 1 FROM voice_media v WHERE v.id::text=m.payload->>'mediaId' AND v.conversation_id=c.id AND v.store_id=c.store_id AND v.actor=c.actor)
      WHEN m.payload->>'type'='image' THEN EXISTS(SELECT 1 FROM image_media i WHERE i.id::text=m.payload->>'mediaId' AND i.conversation_id=c.id AND i.store_id=c.store_id AND i.actor=c.actor)
      ELSE NULL END AS media_available
      FROM messages m JOIN conversations c ON c.id=m.conversation_id LEFT JOIN whatsapp_conversations w ON w.conversation_id=c.id LEFT JOIN whatsapp_outbox o ON o.message_id=m.id WHERE c.store_id=$1 AND c.id=$2 ORDER BY m.sequence DESC LIMIT 200`,[owner.storeId,request.params.id])).rows.reverse();
    if(!(await pool.query('SELECT id FROM conversations WHERE store_id=$1 AND id=$2',[owner.storeId,request.params.id])).rowCount)return reply.code(404).send({error:'Conversation not found'});
    return {messages,limit:200};
  });
  app.get<{Params:{hash:string}}>('/api/owner/message-images/:hash',async(request,reply)=>{
    const bytes=readVisualImage(request.params.hash);
    return bytes?reply.type('image/png').send(bytes):reply.code(404).send({error:'Image not found'});
  });
  app.get<{Params:{sku:string}}>('/api/owner/products/:sku/image',async(request,reply)=>{
    const row=(await pool.query('SELECT image_path FROM products WHERE store_id=$1 AND sku=$2',[owner.storeId,request.params.sku])).rows[0];
    const custom=/^\/catalog-images\/custom\/([a-f0-9-]{36})\.jpg$/.exec(row?.image_path??'');
    if(custom){const bytes=await catalogPhoto(pool,owner.storeId,custom[1],false);return bytes?reply.type('image/jpeg').send(bytes):reply.code(404).send({error:'Photo not found'});}
    if(!row||!/^\/demo-images\/H\d{2}\.jpg$/.test(row.image_path??''))return reply.code(404).send({error:'Photo not found'});
    try{return reply.type('image/jpeg').send(await readFile(resolve('resources/catalog/ksmc-demo/images',row.image_path.split('/').at(-1))));}catch{return reply.code(404).send({error:'Photo not found'});}
  });
  app.get<{Params:{id:string;kind:string;mediaId:string}}>('/api/owner/conversations/:id/media/:kind/:mediaId',async(request,reply)=>{
    const {id,kind,mediaId}=request.params;
    if(!uuid.safeParse(id).success||!uuid.safeParse(mediaId).success||!['image','voice'].includes(kind))return reply.code(404).send({error:'Media not found'});
    const row=(await pool.query('SELECT actor FROM conversations WHERE store_id=$1 AND id=$2',[owner.storeId,id])).rows[0];
    if(!row)return reply.code(404).send({error:'Media not found'});
    const ctx={storeId:owner.storeId,conversationId:id,actor:row.actor,role:'customer' as const};
    try{const media=kind==='image'?await loadImage(pool,ctx,mediaId):await loadVoice(pool,ctx,mediaId);return reply.type(media.mimeType).send(Buffer.from(media.data,'base64'));}catch{return reply.code(404).send({error:'Media not found'});}
  });
  app.post<{Params:{id:string}}>('/api/owner/conversations/:id/control',async(request,reply)=>{
    const input=z.object({mode:z.enum(['assistant','owner']),revision,notify:z.boolean().default(false),acknowledge:z.boolean().default(false)}).strict().safeParse(request.body);
    if(!input.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Invalid control'});
    return write('conversation_control',request.params.id,async client=>{
      const before=(await client.query('SELECT handoff_requested,reply_language,visual_ordering,draft,version,last_request_id FROM conversations WHERE store_id=$1 AND id=$2 FOR UPDATE',[owner.storeId,request.params.id])).rows[0];
      if(input.data.acknowledge&&(input.data.mode!=='owner'||!before?.handoff_requested))throw Object.assign(new Error('There is no current shop-assistance request to acknowledge.'),{statusCode:409});
      const updated=await client.query('UPDATE conversations SET operator_mode=$1,handoff_requested=false,operator_revision=operator_revision+1 WHERE store_id=$2 AND id=$3 AND operator_revision=$4 RETURNING operator_mode,operator_revision',[input.data.mode,owner.storeId,request.params.id,input.data.revision]);
      if(!updated.rowCount)throw Object.assign(new Error('Conversation changed or is unavailable. Refresh and try again.'),{statusCode:409});
      if(input.data.mode==='assistant'&&(await client.query("SELECT 1 FROM whatsapp_outbox WHERE conversation_id=$1 AND sender_kind='owner' AND state IN ('queued','sending') LIMIT 1",[request.params.id])).rowCount)throw Object.assign(new Error('Wait for the queued shop reply to finish sending before returning to the assistant.'),{statusCode:409});
      if(input.data.mode==='owner')await client.query("UPDATE messages SET status='pending',claim_token=NULL,lease_until=NULL WHERE conversation_id=$1 AND status='processing'",[request.params.id]);
      await client.query("UPDATE messages SET status='cancelled' WHERE id IN (SELECT message_id FROM whatsapp_outbox WHERE conversation_id=$1 AND state='queued')",[request.params.id]);
      await client.query("UPDATE whatsapp_outbox SET state='cancelled',last_error='owner_control_changed' WHERE conversation_id=$1 AND state='queued'",[request.params.id]);
      const notification=input.data.notify||input.data.acknowledge?await notifyControl(client,request.params.id,updated.rows[0].operator_revision,before,input.data.mode):{customerNotification:'not_requested'};
      return {...updated.rows[0],...notification};
    });
  });
  async function notifyControl(client:PoolClient,id:string,operatorRevision:number,state:any,mode:'assistant'|'owner'){
    const channel=config.whatsapp;
    const w=(await client.query('SELECT recipient,phone_id,last_inbound_at FROM whatsapp_conversations WHERE conversation_id=$1',[id])).rows[0];
    if(!channel?.sendEnabled||!w)return {customerNotification:'not_sent',reason:'Sending is disabled or this is a preview conversation.'};
    if(w.phone_id!==channel.phoneId||!channel.recipients.includes(w.recipient)||Date.now()-new Date(w.last_inbound_at).getTime()>=24*3600000)return {customerNotification:'not_sent',reason:'Recipient is not approved or the reply window has closed.'};
    // A queued greeting/request will produce the current draft's next stage.
    // Returning control must not send a second resumption card ahead of it.
    if(mode==='assistant'&&(await client.query("SELECT 1 FROM messages WHERE conversation_id=$1 AND direction='inbound' AND status IN ('pending','processing') LIMIT 1",[id])).rowCount)return {customerNotification:'combined_with_pending_reply'};
    const text=(state.last_request_id?orderReference(state.last_request_id)+'\n':'')+say(state.reply_language,mode==='owner'?'The shop is checking your list. We will reply here.':'The assistant is available again. Your list is kept; tell us what to change or ask to review.',mode==='owner'?'கடை உங்கள் பட்டியலைப் பார்க்கிறது.\nஇங்கே பதில் தருவோம்.':'மீண்டும் உதவத் தயாரா இருக்கோம்.\nபட்டியல் அப்படியே இருக்கு. மாற்றம் சொல்லுங்க அல்லது பட்டியலைக் கேளுங்க.',mode==='owner'?'Kadai unga list-ai paarkkirathu. Ingeye bathil tharuvom.':'Marubadi help panna thayaara irukkom. List appadiye irukku. Maaththam sollunga illa list-ai kelunga.');
    const ctx={storeId:owner!.storeId,conversationId:id,actor:(await client.query('SELECT actor FROM conversations WHERE id=$1',[id])).rows[0].actor,role:'customer' as const};
    let current=await loadState(client,ctx);
    let base={version:1 as const,kind:'text' as const,text,stage:'status' as const,presentation:'text' as const,outboundMessages:1};
    let prepared:import('../../../../packages/contracts/index.js').RichReply=base;
    if(mode==='assistant'&&channel.visualOrdering&&current.draft.length&&!current.lastRequestId){
      await client.query('UPDATE conversations SET product_review=NULL WHERE id=$1',[id]);
      const result=await new RetailTools(pool).invokeInTransaction(client,ctx,{name:'preview_order',args:{expectedVersion:current.version}},'resume:'+operatorRevision);
      current=result.state??current;prepared=shoppingActions(presentReply(result,current),current);
      prepared.contextLines=[say(current,'The assistant is back. Continue with these fresh choices.','மீண்டும் உதவத் தயாராக உள்ளது. இந்தப் புதிய தேர்வுகளுடன் தொடருங்கள்.','Marubadi help ready. Intha pudhu choices-oda thodarunga.'),...cartProgress(current)];
    }
    const rich=channel.visualOrdering?materializeVisualReply(visualReply(prepared,current)):undefined;
    const groupId=randomUUID(),parts=rich?.parts??[undefined];let messageId=groupId;
    for(const [index,part] of parts.entries()){
      const mid=index===0?groupId:randomUUID();
      const reply=rich?{...rich,text:part?.text??rich.text,parts:part?[part]:rich.parts,partIndex:index,partCount:parts.length,groupId}:undefined;
      const rendered=reply?renderWhatsAppReply(reply,mid,channel.hostname):undefined;
      await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload,stage,reply_group_id,part_index,part_count) VALUES($1,$2,'outbound',$3,'queued',$4::jsonb,$5,$6,$7,$8)",[mid,id,reply?.text??text,JSON.stringify(reply??base),reply?.stage??'status',groupId,index,parts.length]);
      await client.query("INSERT INTO whatsapp_outbox(message_id,conversation_id,operator_revision,sender_kind,reply_payload) VALUES($1,$2,$3,'system',$4::jsonb)",[mid,id,operatorRevision,JSON.stringify(rendered?.payload??{type:'text',text:{preview_url:false,body:text}})]);
      for(const action of rendered?.actions??[])await client.query('INSERT INTO whatsapp_actions(id,message_id,conversation_id,event,label,source_version,operator_revision,binding_id) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)',[action.id,mid,id,JSON.stringify(action.event),action.label,current.version,operatorRevision,conversationBinding(current,await loadAssistantMemory(client,ctx))]);
    }
    return {customerNotification:'queued',messageId};
  }
  app.post<{Params:{id:string}}>('/api/owner/conversations/:id/reply',async(request,reply)=>{
    const input=z.object({id:uuid,text:z.string().trim().min(1).max(4096),revision}).strict().safeParse(request.body);
    if(!input.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Invalid reply'});
    if(!config.whatsapp?.sendEnabled)return reply.code(409).send({error:'WhatsApp sending is disabled.'});
    return write('manual_reply',request.params.id,async client=>{
      const row=(await client.query(`SELECT c.operator_mode,c.operator_revision,w.recipient,w.last_inbound_at,w.phone_id FROM conversations c JOIN whatsapp_conversations w ON w.conversation_id=c.id WHERE c.store_id=$1 AND c.id=$2 FOR UPDATE OF c`,[owner.storeId,request.params.id])).rows[0];
      if(!row||row.operator_mode!=='owner'||row.operator_revision!==input.data.revision)throw Object.assign(new Error('Take over this conversation and refresh before replying.'),{statusCode:409});
      if(row.phone_id!==config.whatsapp!.phoneId||!config.whatsapp!.recipients.includes(row.recipient)||Date.now()-new Date(row.last_inbound_at).getTime()>=24*3600000)throw Object.assign(new Error('The recipient is not approved or the WhatsApp reply window has closed.'),{statusCode:409});
      const previous=(await client.query('SELECT conversation_id,text FROM messages WHERE id=$1',[input.data.id])).rows[0];
      if(previous){if(previous.conversation_id!==request.params.id||previous.text!==input.data.text)throw Object.assign(new Error('Reply ID is already used.'),{statusCode:409});return {messageId:input.data.id,duplicate:true};}
      const obsolete=await client.query("UPDATE whatsapp_outbox o SET state='cancelled',last_error='owner_replied' FROM messages m WHERE o.message_id=m.id AND o.conversation_id=$1 AND o.state='queued' AND m.payload->>'clarificationReason'='owner_handling' RETURNING o.message_id",[request.params.id]);
      if(obsolete.rowCount)await client.query("UPDATE messages SET status='cancelled' WHERE id=ANY($1::uuid[])",[obsolete.rows.map(r=>r.message_id)]);
      await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload) VALUES($1,$2,'outbound',$3,'queued',$4::jsonb)",[input.data.id,request.params.id,input.data.text,JSON.stringify({version:1,kind:'text',text:input.data.text,presentation:'text',outboundMessages:1})]);
      await client.query("INSERT INTO whatsapp_outbox(message_id,conversation_id,operator_revision,sender_kind,reply_payload) VALUES($1,$2,$3,'owner',$4::jsonb)",[input.data.id,request.params.id,row.operator_revision,JSON.stringify({type:'text',text:{preview_url:false,body:input.data.text}})]);
      await client.query('UPDATE conversations SET handoff_requested=false WHERE id=$1',[request.params.id]);
      await client.query("UPDATE messages SET status='processed',claim_token=NULL,lease_until=NULL WHERE conversation_id=$1 AND direction='inbound' AND status IN ('pending','processing')",[request.params.id]);
      return {messageId:input.data.id,queued:true};
    });
  });
  app.post('/api/owner/pause',async(request,reply)=>{
    const input=z.object({paused:z.boolean(),revision}).strict().safeParse(request.body);
    if(!input.success)return reply.code(400).send({error:'Invalid pause control'});
    return write('store_pause',owner.storeId,async client=>{
      const updated=await client.query('UPDATE stores SET operator_paused=$1,operator_revision=operator_revision+1 WHERE id=$2 AND operator_revision=$3 RETURNING operator_paused,operator_revision',[input.data.paused,owner.storeId,input.data.revision]);
      if(!updated.rowCount)throw Object.assign(new Error('Pause setting changed. Refresh and try again.'),{statusCode:409});
      if(input.data.paused)await client.query("UPDATE messages m SET status='pending',claim_token=NULL,lease_until=NULL FROM conversations c WHERE m.conversation_id=c.id AND c.store_id=$1 AND m.status='processing'",[owner.storeId]);
      return updated.rows[0];
    });
  });
  async function notifyStatus(client:PoolClient,request:any,want:boolean){
    const key=request.acceptance+':'+request.fulfillment;
    const obsolete=await client.query("UPDATE whatsapp_outbox o SET state='cancelled',last_error='request_status_superseded' FROM request_notifications n WHERE n.message_id=o.message_id AND n.request_id=$1 AND n.status_key<>$2 AND o.state='queued' RETURNING o.message_id",[request.id,key]);
    if(obsolete.rowCount)await client.query("UPDATE messages SET status='cancelled' WHERE id=ANY($1::uuid[])",[obsolete.rows.map(r=>r.message_id)]);
    if(!want)return {customerNotification:'not_requested'};
    const sent=(await client.query('SELECT n.message_id,o.state FROM request_notifications n JOIN whatsapp_outbox o ON o.message_id=n.message_id WHERE n.request_id=$1 AND n.status_key=$2',[request.id,key])).rows[0];
    if(sent&&!['cancelled','blocked'].includes(sent.state))return {customerNotification:sent.state==='unknown'?'outcome_unknown':'already_queued',messageId:sent.message_id};
    const c=(await client.query('SELECT c.id,c.reply_language,c.operator_revision,w.recipient,w.phone_id,w.last_inbound_at FROM conversations c LEFT JOIN whatsapp_conversations w ON w.conversation_id=c.id WHERE c.store_id=$1 AND c.id=$2 FOR UPDATE OF c',[owner!.storeId,request.conversation_id])).rows[0];
    if(!config.whatsapp?.sendEnabled||!c?.recipient)return {customerNotification:'not_sent',reason:'Sending is disabled or this is a preview conversation.'};
    if(c.phone_id!==config.whatsapp.phoneId||!config.whatsapp.recipients.includes(c.recipient)||!c.last_inbound_at||Date.now()-new Date(c.last_inbound_at).getTime()>=24*3600000)return {customerNotification:'not_sent',reason:'Recipient is not approved or the reply window has closed. Open the conversation to follow up.'};
    const id=randomUUID(),text=requestStatusText({id:request.id,acceptance:request.acceptance,fulfillment:request.fulfillment,payment:request.payment,totalPaise:Number(request.total_paise),lines:request.lines} as OrderRequest,c.reply_language);
    const rich=config.whatsapp?.visualOrdering?materializeVisualReply(visualStatus({replyLanguage:c.reply_language,visualOrdering:true,version:0,draft:request.lines,pending:null,fulfillment:'pickup',lastRequestId:request.id},{id:request.id,acceptance:request.acceptance,fulfillment:request.fulfillment,payment:request.payment,totalPaise:Number(request.total_paise),lines:request.lines})):undefined;
    await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload,stage) VALUES($1,$2,'outbound',$3,'queued',$4,$5)",[id,c.id,text,JSON.stringify(rich??{version:1,kind:'text',text,presentation:'text',outboundMessages:1}),rich?'status':null]);
    await client.query("INSERT INTO whatsapp_outbox(message_id,conversation_id,operator_revision,sender_kind,reply_payload) VALUES($1,$2,$3,'system',$4)",[id,c.id,c.operator_revision,JSON.stringify(rich?renderWhatsAppReply(rich,id,config.whatsapp.hostname).payload:{type:'text',text:{preview_url:false,body:text}})]);
    await client.query('INSERT INTO request_notifications(request_id,status_key,message_id) VALUES($1,$2,$3) ON CONFLICT(request_id,status_key) DO UPDATE SET message_id=EXCLUDED.message_id',[request.id,key,id]);return {customerNotification:'queued',messageId:id};
  }
  app.post<{Params:{id:string}}>('/api/owner/requests/:id/decision',async(request,reply)=>{
    const input=z.object({decision:z.enum(['accepted','rejected']),notify:z.boolean().default(false)}).strict().safeParse(request.body);
    if(!input.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Invalid request decision'});
    return write('request_decision',request.params.id,async client=>{
      const updated=await client.query("UPDATE order_requests SET acceptance=$1,fulfillment=$4 WHERE store_id=$2 AND id=$3 AND acceptance='awaiting_approval' RETURNING *",[input.data.decision,owner.storeId,request.params.id,input.data.decision==='accepted'?'preparing':'cancelled']);
      if(!updated.rowCount)throw Object.assign(new Error('Request is already decided or unavailable. Refresh the list.'),{statusCode:409});
      return {acceptance:updated.rows[0].acceptance,fulfillment:updated.rows[0].fulfillment,...await notifyStatus(client,updated.rows[0],input.data.notify)};
    });
  });
  app.post<{Params:{id:string}}>('/api/owner/requests/:id/fulfillment',async(request,reply)=>{
    const parsed=z.object({expected:z.enum(['awaiting_approval','preparing','ready_for_pickup','collected','cancelled']),status:z.enum(['ready_for_pickup','collected','cancelled']),notify:z.boolean().default(false)}).strict().safeParse(request.body);
    if(!parsed.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Invalid fulfillment update'});
    return write('request_fulfillment',request.params.id,async client=>{
      const p=parsed.data,row=(await client.query('SELECT * FROM order_requests WHERE store_id=$1 AND id=$2 FOR UPDATE',[owner.storeId,request.params.id])).rows[0];
      if(!row||row.acceptance!=='accepted')throw Object.assign(new Error('Accept the request before updating pickup status.'),{statusCode:409});
      if(row.fulfillment===p.status)return {fulfillment:p.status,duplicate:true,...await notifyStatus(client,row,p.notify)};
      if(row.fulfillment!==p.expected||!((['awaiting_approval','preparing'].includes(row.fulfillment)&&['ready_for_pickup','cancelled'].includes(p.status))||(row.fulfillment==='ready_for_pickup'&&['collected','cancelled'].includes(p.status))))throw Object.assign(new Error('Request status changed or that transition is not allowed. Refresh before updating.'),{statusCode:409});
      const changed=(await client.query('UPDATE order_requests SET fulfillment=$1 WHERE store_id=$2 AND id=$3 RETURNING *',[p.status,owner.storeId,row.id])).rows[0];
      return {fulfillment:p.status,...await notifyStatus(client,changed,p.notify)};
    });
  });
}
