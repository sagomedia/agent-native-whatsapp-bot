import {needsHelpSql} from '../services/owner-mcp.js';
import {reviewOwnerOrder,completeOwnerOrder,decideOwnerOrder,fulfillOwnerOrder} from '../services/owner-order-actions.js';
import {recipientAllowed} from '../services/customer-admission.js';
import {ownerSnapshotQuery,ownerReadPageSize,ownerActiveSql,ownerStageSql,ownerSimpleStageSql,ownerSearchPattern} from '../services/owner-read-query.js';
import {messageGallery} from '../services/message-gallery.js';
import {originalEstimateSnapshot} from '../services/order-estimate.js';
import {productColumns,productFromRow} from '../services/catalog.js';
import {reserveRequest,closeRequestStock} from '../services/inventory.js';
import {ToolError} from '../services/context.js';
import {verifyManualAdvance,verifyManualRefund,confirmManualAdvanceReceipt} from '../services/upi-advance.js';
import {ownerOrderReviewSchema,prepareOwnerOrderReview,recordOwnerOrderReview} from '../services/owner-order-review.js';
import {decideAmendment} from '../services/order-amendments.js';
import {saveQuoteDraftSchema,saveQuoteDraft,quoteDraftRow} from '../services/order-quote-drafts.js';
import {orderQuoteSchema,offerOrderQuote,orderQuoteReply} from '../services/order-quotes.js';
import {queueOrderNotice} from '../services/order-notices.js';
import {customerCopy} from '../../../../packages/contracts/customer-copy.js';
import {formatMoney,lineTotal} from '../../../../packages/contracts/money.js';
import {textPresentation} from '../services/message-presentation.js';
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
import {registerOwnerImport} from './owner-import.js';
import {registerOwnerSimpleProducts} from './owner-simple-products.js';
import {registerOwnerFacts} from './owner-facts.js';
import {registerOwnerOperations} from './owner-operations.js';
import {catalogImageSize,ownerCatalogProductImage,sendOwnerCatalogImage} from '../services/catalog-image-variants.js';
import {loadImage} from '../services/image-media.js';
import {loadVoicePlayback} from '../services/voice-media.js';
import type {Config} from '../config.js';
import {createAccessVerifier,type AccessVerifier} from './access.js';
import {mcpPublicPath} from '../mcp/oauth.js';
import {geminiTextRate,rateHealth} from '../services/inference-budget.js';
import {messagingCostSummary} from '../services/messaging-cost.js';
import {runtimeReleaseMetadata,currentReleaseFingerprint} from '../services/release-manifest.js';
import type {WhatsAppChannel} from '../services/whatsapp-channel.js';

const uuid=z.uuid();
const revision=z.number().int().nonnegative();
import {GoogleCatalogGenerator,type CatalogGenerator} from '../services/catalog-assistant.js';
export async function registerOwner(app:FastifyInstance,pool:Pool,config:Config,verify?:AccessVerifier,catalogGenerator?:CatalogGenerator,whatsapp?:WhatsAppChannel){
  const owner=config.owner;
  if(!owner)return;
  const needsReplySql=needsHelpSql;
  verify??=createAccessVerifier(owner);
  if(!(await pool.query('SELECT id FROM stores WHERE id=$1',[owner.storeId])).rowCount)throw new Error('Owner store must already exist');
  app.addHook('onRequest',async(request,reply)=>{
    if(mcpPublicPath(config.remoteMcp,request.headers.host,request.url.split('?')[0]))return;
    const host=request.headers.host?.toLowerCase();
    const local=host!==undefined&&/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    const publicOwner=host===owner.hostname;
    if(config.whatsapp&&host===config.whatsapp.hostname&&request.method==='GET'&&/^\/catalog-images\/(?:H\d{2}\.jpg|(?:custom|reference)\/[a-f0-9-]{36}\.jpg|messages\/[a-f0-9]{64}\.png)$/.test(request.url.split('?')[0]))return;
    if(config.whatsapp&&host===config.whatsapp.hostname&&request.method==='GET'&&(/^\/pay\/[a-f0-9-]{36}$/.test(request.url.split('?')[0])||/^\/welcome-audio\/[a-f0-9]{64}\.ogg$/.test(request.url.split('?')[0])))return;
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
  app.addHook('onSend',async(request,reply,payload)=>{
    if(request.headers.host===owner.hostname&&request.url.split('?')[0].startsWith('/assets/')&&[200,304].includes(reply.statusCode))reply.header('Cache-Control','private, max-age=31536000, immutable');
    return payload;
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
    }catch(error){await client.query('ROLLBACK');if(error instanceof ToolError)Object.assign(error,{statusCode:error.code==='forbidden'?403:409});throw error;}finally{client.release();}
  }
  registerOwnerFacts(app,pool,owner.storeId,write);
  registerOwnerOperations(app,pool,owner.storeId);
  await registerOwnerCatalog(app,pool,owner.storeId,write,catalogGenerator??(config.catalogAi?new GoogleCatalogGenerator(config.catalogAi.apiKey):undefined));
  registerOwnerSimpleProducts(app,pool,owner.storeId,write);
  registerOwnerImport(app,pool,owner.storeId,owner.email);
  const release=runtimeReleaseMetadata();
  // The navigation shell needs a shop name and help count, not order lines,
  // conversation drafts, media metadata, and audit records on every refresh.
  app.get('/api/owner/summary',async()=>{
    const result=await pool.query(`SELECT s.id,s.name,s.synthetic,s.operator_paused,s.operator_revision,s.inventory_policy,
      (SELECT count(*)::int FROM conversations c WHERE c.store_id=s.id) AS total,
      (SELECT count(*)::int FROM conversations c WHERE c.store_id=s.id AND ${needsReplySql}) AS help
      FROM stores s WHERE s.id=$1`,[owner.storeId]);
    const {total,help,...store}=result.rows[0];
    return {store,conversationCounts:{total,help}};
  });
  app.get<{Querystring:{language?:string}}>('/api/owner/message-gallery',async(req,reply)=>{
    const language=z.enum(['ta','ta-Latn','en']).safeParse(req.query.language??'ta');
    if(!language.success)return reply.code(400).send({error:'Choose Tamil, Tanglish or English.'});
    return {synthetic:true,readOnly:true,entries:await messageGallery(language.data)};
  });
  app.get<{Params:{sku:string}}>('/api/owner/message-gallery/products/:sku/image',async(req,reply)=>{
    if(!/^H(?:0[1-9]|[12][0-9]|30)$/.test(req.params.sku))return reply.code(404).send();
    return reply.type('image/jpeg').send(await readFile(resolve('resources/catalog/ksmc-demo/images',req.params.sku+'.jpg')));
  });
  app.get('/api/owner/release' ,async()=>({...release,features:{transcriptionModel:process.env.GEMINI_TRANSCRIPTION_MODEL||null,visualOrdering:!!config.whatsapp?.visualOrdering,unifiedUnderstanding:process.env.GEMINI_UNIFIED_UNDERSTANDING_ENABLED==='true',imageLists:process.env.GEMINI_HANDWRITTEN_LISTS_ENABLED==='true',processing:!!config.whatsapp?.processEnabled,sending:!!config.whatsapp?.sendEnabled,payments:!!config.whatsapp?.advance,demoPayAtShop:!!config.whatsapp?.advance?.demoPayAtShop,paymentVerification:config.whatsapp?.advance?'owner_checked':'disabled',partialReviews:!!config.whatsapp?.partialReviews,inventoryPolicy:'reserve_on_accept'}}));
  app.get<{Params:{id:string}}>('/api/owner/conversations/:id/observations',async(req,reply)=>{
   if(!uuid.safeParse(req.params.id).success)return reply.code(400).send({error:'Invalid conversation'});
   if(!(await pool.query('SELECT id FROM conversations WHERE store_id=$1 AND id=$2',[owner.storeId,req.params.id])).rowCount)return reply.code(404).send({error:'Conversation not found'});
   return {attempts:(await pool.query('SELECT id,message_id,stage,state,failure_code,validation_issues,observation FROM provider_attempts WHERE store_id=$1 AND conversation_id=$2 AND observation IS NOT NULL ORDER BY created_at DESC LIMIT 5',[owner.storeId,req.params.id])).rows,limit:5};
  });
  app.get('/api/owner/snapshot',async(request,reply)=>{
    const selectedConversation=ownerSnapshotQuery.safeParse(request.query);
    if(!selectedConversation.success)return reply.code(400).send({error:'Invalid owner read query'});
    const read=selectedConversation.data,fullDetails=read.details==='1';
    const client=await pool.connect();
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const store=(await client.query('SELECT id,name,synthetic,operator_paused,operator_revision,inventory_policy FROM stores WHERE id=$1',[owner.storeId])).rows[0];
      const conversationQuery=`SELECT c.id,c.actor,w.profile_name AS customer_name,w.recipient AS customer_phone,c.operator_mode,c.operator_revision,c.reply_language,c.draft,c.version,
        ${needsReplySql} AS needs_reply,
        CASE WHEN c.pending->>'kind'='review' THEN jsonb_build_object('reviewId',c.pending->>'id','expiresAt',c.pending->>'expiresAt','totalPaise',c.pending->'totalPaise','itemCount',jsonb_array_length(c.draft)) ELSE NULL END AS checkout,
        (SELECT text FROM messages WHERE conversation_id=c.id ORDER BY sequence DESC LIMIT 1) AS last_text,
        (SELECT max(created_at) FROM messages WHERE conversation_id=c.id) AS updated_at,
        (SELECT count(*)::int FROM messages WHERE conversation_id=c.id AND status IN ('pending','processing')) AS pending
        ,c.handoff_requested,(SELECT last_inbound_at FROM whatsapp_conversations WHERE conversation_id=c.id) AS last_inbound_at
        FROM conversations c LEFT JOIN whatsapp_conversations w ON w.conversation_id=c.id WHERE c.store_id=$1`;
      const inboxFilter=` AND ($2::boolean=false OR ${needsReplySql}) AND ($3::text='' OR c.id::text ILIKE $4 OR c.actor ILIKE $4 OR EXISTS(SELECT 1 FROM whatsapp_conversations iw WHERE iw.conversation_id=c.id AND (iw.profile_name ILIKE $4 OR ('+'||iw.recipient) ILIKE $4)) OR EXISTS(SELECT 1 FROM messages im WHERE im.conversation_id=c.id AND im.text ILIKE $4))`;
      const inboxValues=[owner.storeId,read.inboxHelp==='1',read.inboxSearch,ownerSearchPattern(read.inboxSearch)];
      const inboxTotal=Number((await client.query('SELECT count(*)::int AS total FROM conversations c WHERE c.store_id=$1'+inboxFilter,inboxValues)).rows[0].total);
      const inboxPaged=read.inboxPage!==undefined||!!read.inboxSearch||read.inboxHelp==='1',inboxLimit=inboxPaged?ownerReadPageSize:100,inboxOffset=((read.inboxPage??1)-1)*inboxLimit;
      const conversations=(await client.query(conversationQuery+inboxFilter+' ORDER BY c.handoff_requested DESC,updated_at DESC NULLS LAST,c.id LIMIT $5 OFFSET $6',[...inboxValues,inboxLimit,inboxOffset])).rows;
      const inboxPage={number:read.inboxPage??1,size:inboxLimit,total:inboxTotal,ids:conversations.map(c=>c.id),hasNext:inboxOffset+inboxLimit<inboxTotal};
      // Deep links from shop-wide operations can refer to a conversation outside
      // the recent inbox. Keep all recent rows and append its guarded metadata.
      const selectedId=selectedConversation.data.conversation;
      if(selectedId&&!conversations.some(c=>c.id===selectedId))conversations.push(...(await client.query(conversationQuery+' AND c.id=$2',[owner.storeId,selectedId])).rows);
      const deliveries=(await client.query(`SELECT c.id,count(m.id)::int AS total,count(*) FILTER(WHERE o.state IN ('delivered','read'))::int AS delivered,bool_or(o.state IN ('failed','unknown','blocked','cancelled')) AS issue
        FROM conversations c JOIN LATERAL (SELECT m.reply_group_id FROM messages m JOIN whatsapp_actions a ON a.message_id=m.id WHERE m.conversation_id=c.id AND a.binding_id::text=c.pending->>'id' AND a.event->>'type'='confirm' ORDER BY m.sequence DESC LIMIT 1) g ON true
        JOIN messages m ON m.reply_group_id=g.reply_group_id LEFT JOIN whatsapp_outbox o ON o.message_id=m.id
        WHERE c.store_id=$1 AND c.pending->>'kind'='review' GROUP BY c.id`,[owner.storeId])).rows;
      for(const conversation of conversations){if(conversation.checkout){const delivery=deliveries.find(d=>d.id===conversation.id);conversation.checkout.state=Date.parse(conversation.checkout.expiresAt)<=Date.now()?'expired':delivery?.issue?'delivery_issue':delivery&&delivery.delivered<delivery.total?'invoice_arriving':'awaiting_customer';}}
      const requestQuery=`SELECT r.id,r.conversation_id,c.actor,w.profile_name AS customer_name,w.recipient AS customer_phone,r.acceptance,r.payment,r.fulfillment,
        ${ownerSimpleStageSql} AS stage,
        r.lines AS original_lines,r.total_paise AS original_total_paise,coalesce(r.effective_total_paise,r.total_paise) AS total_paise,coalesce(r.effective_lines,r.lines) AS lines,r.created_at,r.estimate_complete,r.excluded_line_ids,r.advance_required,r.effective_revision,r.inventory_state,r.inventory_untracked_line_ids,r.packed_revision,a.state AS advance_state,a.amount_paise AS advance_amount_paise,a.claimed_at AS advance_claimed_at,a.verified_at AS advance_verified_at,a.verified_by AS advance_verified_by FROM order_requests r JOIN conversations c ON c.id=r.conversation_id AND c.store_id=r.store_id LEFT JOIN whatsapp_conversations w ON w.conversation_id=c.id LEFT JOIN order_advances a ON a.request_id=r.id WHERE r.store_id=$1`;
      const orderFilter=` AND ($2::text IS NULL OR $2='all' OR (CASE WHEN $2 IN ('new','ready','completed','cancelled') THEN (${ownerSimpleStageSql}) ELSE (${ownerStageSql}) END)=$2) AND ($3::text='' OR r.id::text ILIKE $4 OR replace(r.id::text,'-','') ILIKE $4 OR r.conversation_id::text ILIKE $4 OR EXISTS(SELECT 1 FROM whatsapp_conversations ow WHERE ow.conversation_id=r.conversation_id AND (ow.profile_name ILIKE $4 OR ('+'||ow.recipient) ILIKE $4)) OR coalesce(r.effective_lines,r.lines)::text ILIKE $4)`;
      const orderValues=[owner.storeId,read.orderStage??null,read.orderSearch,ownerSearchPattern(read.orderSearch)];
      const orderTotal=Number((await client.query('SELECT count(*)::int AS total FROM order_requests r WHERE r.store_id=$1'+orderFilter,orderValues)).rows[0].total);
      const orderLimit=read.orderStage?ownerReadPageSize:100,orderOffset=(read.orderPage-1)*orderLimit;
      const requests=(await client.query(requestQuery+orderFilter+` ORDER BY CASE WHEN ${ownerActiveSql} THEN 0 ELSE 1 END,r.created_at DESC,r.id LIMIT $5 OFFSET $6`,[...orderValues,orderLimit,orderOffset])).rows;
      const orderPage={number:read.orderPage,size:orderLimit,total:orderTotal,ids:requests.map(r=>r.id),hasNext:orderOffset+orderLimit<orderTotal};
      if(read.order&&!requests.some(r=>r.id===read.order))requests.push(...(await client.query(requestQuery+' AND r.id=$2',[owner.storeId,read.order])).rows);
      for(const request of requests)request.original_estimate=originalEstimateSnapshot(request.original_lines);
      const requestSkus=[...new Set(requests.flatMap(r=>(r.lines as OrderRequest['lines']).flatMap(l=>l.sku?[l.sku]:[])))];
      const stockProducts=requestSkus.length?(await client.query(`SELECT ${productColumns} FROM products WHERE store_id=$1 AND sku=ANY($2::text[])`,[owner.storeId,requestSkus])).rows.map(productFromRow):[];
      const reservations=requests.length?(await client.query("SELECT request_id,sku,quantity FROM inventory_reservations WHERE store_id=$1 AND request_id=ANY($2::uuid[]) AND state='active'",[owner.storeId,requests.map(r=>r.id)])).rows:[];
      for(const r of requests)r.inventory=stockProducts.filter(p=>(r.lines as OrderRequest['lines']).some(l=>l.sku===p.sku)).map(p=>({sku:p.sku,name:p.name,unit:p.unit,onHand:p.stockOnHand,reserved:p.stockReserved,available:p.stock,held:Number(reservations.find(h=>h.request_id===r.id&&h.sku===p.sku)?.quantity??0),version:p.version,hasPhoto:!!p.imageUrl}));
      const requestCounts=(await client.query(`SELECT count(*) FILTER(WHERE ${ownerActiveSql})::int AS active,count(*) FILTER(WHERE NOT ${ownerActiveSql})::int AS history,
        count(*) FILTER(WHERE (${ownerStageSql})='review')::int AS review,count(*) FILTER(WHERE (${ownerStageSql})='customer')::int AS customer,count(*) FILTER(WHERE (${ownerStageSql})='ready')::int AS ready,
        count(*) FILTER(WHERE r.acceptance IN ('awaiting_approval','accepted') AND r.fulfillment NOT IN ('ready_for_pickup','collected','cancelled'))::int AS new,
        count(*) FILTER(WHERE r.acceptance='accepted' AND r.fulfillment='ready_for_pickup')::int AS ready_for_pickup,
        count(*) FILTER(WHERE r.fulfillment='collected')::int AS completed FROM order_requests r WHERE r.store_id=$1`,[owner.storeId])).rows[0];
      const conversationCounts=(await client.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE ${needsReplySql})::int AS help,count(*) FILTER(WHERE c.pending->>'kind'='review')::int AS checkouts FROM conversations c WHERE c.store_id=$1`,[owner.storeId])).rows[0];
      const requestIds=requests.map(r=>r.id);
      const amendments=(await client.query("SELECT id,request_id,conversation_id,kind,summary,proposed_lines,state,expected_revision,known_subtotal_paise,estimate_complete,created_at FROM order_amendments WHERE store_id=$1 AND request_id=ANY($2::uuid[]) AND state IN ('owner_pending','proposed') ORDER BY created_at",[owner.storeId,requestIds])).rows;
      const quotes=(await client.query("SELECT id,request_id,state,expected_revision,total_paise,lines,created_at FROM order_quotes WHERE store_id=$1 AND request_id=ANY($2::uuid[]) AND state='offered' ORDER BY created_at",[owner.storeId,requestIds])).rows;
      const usage=fullDetails?(await client.query(`SELECT count(*)::int AS attempts,count(*) FILTER(WHERE state='failed')::int AS failures,count(*) FILTER(WHERE state='unknown')::int AS unknown,coalesce(sum(estimated_cost_microusd),0)::text AS estimated_microusd FROM (SELECT state,estimated_cost_microusd FROM provider_attempts WHERE store_id=$1 UNION ALL SELECT state,estimated_cost_microusd FROM catalog_suggestions WHERE store_id=$1) attempts`,[owner.storeId])).rows[0]:null;
      const budget=(await client.query('SELECT limit_microusd,committed_microusd,held_microusd,blocked FROM inference_budgets WHERE store_id=$1',[owner.storeId])).rows[0]??null;
      const audit=fullDetails?(await client.query('SELECT action,target_id,details,created_at FROM owner_audit WHERE store_id=$1 ORDER BY sequence DESC LIMIT 20',[owner.storeId])).rows:[];
      const wa=config.whatsapp?(await client.query('SELECT verified_at,last_webhook_at,last_received_at,send_blocked,last_error FROM whatsapp_channels WHERE phone_id=$1 AND store_id=$2',[config.whatsapp.phoneId,owner.storeId])).rows[0]:undefined;
      const channel={whatsapp:!wa?'not_connected':wa.send_blocked?'attention_required':wa.last_received_at?'receiving':wa.verified_at||wa.last_webhook_at?'webhook_verified':'awaiting_verification',liveSending:Boolean(wa&&config.whatsapp?.sendEnabled&&!wa.send_blocked),processing:Boolean(config.whatsapp?.processEnabled),lastReceivedAt:wa?.last_webhook_at??null,error:wa?.last_error??null,testOnly:config.whatsapp?.audience!=='public'};
      const messaging=fullDetails&&config.whatsapp&&config.whatsapp.storeId===owner.storeId?{...await messagingCostSummary(client,{storeId:owner.storeId,phoneId:config.whatsapp.phoneId,accountTimezone:config.whatsapp.accountTimezone,rateCard:config.whatsapp.pricingRateCard}),analyticsAvailable:Boolean(config.whatsapp.accountTimezone&&config.whatsapp.accountCurrency&&config.whatsapp.businessPhoneNumber)}:null;
      await client.query('COMMIT');
      return {detailsIncluded:fullDetails,store,conversations,conversationCounts,inboxPage,requests,requestCounts,orderPage,amendments,quotes,usage,budget,audit,messaging,mode:config.mode,ownerEmail:owner.email,channel,inference:{enabled:!!(wa&&config.whatsapp?.aiEnabled&&config.whatsapp.processEnabled),paidEnabled:!!config.whatsapp?.paidEnabled,rateHealth:rateHealth(geminiTextRate)},limits:{conversations:100,requests:100},generatedAt:new Date().toISOString()};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  });
  app.post('/api/owner/pricing/refresh',async(request,reply)=>{
    const input=z.object({month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)}).strict().safeParse(request.body);
    if(!input.success)return reply.code(400).send({error:'Choose a billing month in YYYY-MM format.'});
    if(!whatsapp||config.whatsapp?.storeId!==owner.storeId)return reply.code(409).send({error:'Messaging pricing is unavailable for this shop.'});
    // Fetch before acquiring the owner's store write lock. The channel scopes
    // and validates the response before its own short ledger transaction.
    try{const result=await whatsapp.refreshPricingAnalytics(input.data.month);return await write('pricing_analytics_refresh',owner.storeId,async()=>({phoneId:whatsapp.config.phoneId,...result}));}
    catch{return reply.code(502).send({error:'Could not refresh pricing analytics. Check the Messaging account timezone, currency, business phone and analytics permissions. Existing records are retained.'});}
  });
  app.get<{Params:{id:string};Querystring:{before?:string}}>('/api/owner/conversations/:id',async(request,reply)=>{
    if(!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Invalid conversation'});
    const page=z.object({before:z.string().regex(/^[1-9]\d{0,18}$/).refine(value=>/^[1-9]\d{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n).optional()}).strict().safeParse(request.query);
    if(!page.success)return reply.code(400).send({error:'Invalid message page. Return to the latest messages.'});
    const rows=(await pool.query(`SELECT m.sequence,m.id,m.conversation_id,m.direction,m.text,m.status,m.created_at,m.payload,m.release_fingerprint,o.sender_kind,(w.conversation_id IS NOT NULL) AS whatsapp,
      CASE WHEN m.payload->>'type'='voice' THEN (EXISTS(SELECT 1 FROM voice_media v WHERE v.id::text=m.payload->>'mediaId' AND v.conversation_id=c.id AND v.store_id=c.store_id AND v.actor=c.actor) OR EXISTS(SELECT 1 FROM whatsapp_media a WHERE a.message_id=m.id AND a.message_id::text=m.payload->>'mediaId' AND a.kind='voice' AND a.original_audio IS NOT NULL))
      WHEN m.payload->>'type'='image' THEN EXISTS(SELECT 1 FROM image_media i WHERE i.id::text=m.payload->>'mediaId' AND i.conversation_id=c.id AND i.store_id=c.store_id AND i.actor=c.actor)
      ELSE NULL END AS media_available,wm.state AS media_state,wm.last_error AS media_error
      FROM messages m JOIN conversations c ON c.id=m.conversation_id LEFT JOIN whatsapp_conversations w ON w.conversation_id=c.id LEFT JOIN whatsapp_outbox o ON o.message_id=m.id LEFT JOIN whatsapp_media wm ON wm.message_id=m.id WHERE c.store_id=$1 AND c.id=$2 AND ($3::bigint IS NULL OR m.sequence<$3) ORDER BY m.sequence DESC LIMIT 201`,[owner.storeId,request.params.id,page.data.before??null])).rows;
    if(!(await pool.query('SELECT id FROM conversations WHERE store_id=$1 AND id=$2',[owner.storeId,request.params.id])).rowCount)return reply.code(404).send({error:'Conversation not found'});
    const messages=rows.slice(0,200).reverse();
    return {messages,limit:200,olderCursor:rows.length>200?String(messages[0].sequence):null};
  });
  app.get<{Params:{hash:string}}>('/api/owner/message-images/:hash',async(request,reply)=>{
    const bytes=readVisualImage(request.params.hash);
    return bytes?reply.type('image/png').send(bytes):reply.code(404).send({error:'Image not found'});
  });
  app.get<{Params:{sku:string};Querystring:{size?:string}}>('/api/owner/products/:sku/image',async(request,reply)=>{
    const bytes=await ownerCatalogProductImage(pool,owner.storeId,request.params.sku,catalogImageSize(request.query.size));
    return bytes?sendOwnerCatalogImage(request,reply,bytes):reply.code(404).send({error:'Photo not found'});
  });
  app.get<{Params:{id:string;kind:string;mediaId:string}}>('/api/owner/conversations/:id/media/:kind/:mediaId',async(request,reply)=>{
    const {id,kind,mediaId}=request.params;
    if(!uuid.safeParse(id).success||!uuid.safeParse(mediaId).success||!['image','voice'].includes(kind))return reply.code(404).send({error:'Media not found'});
    const row=(await pool.query('SELECT actor FROM conversations WHERE store_id=$1 AND id=$2',[owner.storeId,id])).rows[0];
    if(!row)return reply.code(404).send({error:'Media not found'});
    const ctx={storeId:owner.storeId,conversationId:id,actor:row.actor,role:'customer' as const};
    try{const media=kind==='image'?await loadImage(pool,ctx,mediaId):await loadVoicePlayback(pool,ctx,mediaId);return reply.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').type(media.mimeType).send(Buffer.from(media.data,'base64'));}catch{return reply.code(404).send({error:'Media not found'});}
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
    if(w.phone_id!==channel.phoneId||!recipientAllowed(channel,w.recipient)||Date.now()-new Date(w.last_inbound_at).getTime()>=24*3600000)return {customerNotification:'not_sent',reason:'Recipient is not approved or the reply window has closed.'};
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
      if(row.phone_id!==config.whatsapp!.phoneId||!recipientAllowed(config.whatsapp!,row.recipient)||Date.now()-new Date(row.last_inbound_at).getTime()>=24*3600000)throw Object.assign(new Error('The recipient is not approved or the WhatsApp reply window has closed.'),{statusCode:409});
      const previous=(await client.query('SELECT conversation_id,text FROM messages WHERE id=$1',[input.data.id])).rows[0];
      if(previous){if(previous.conversation_id!==request.params.id||previous.text!==input.data.text)throw Object.assign(new Error('Reply ID is already used.'),{statusCode:409});return {messageId:input.data.id,duplicate:true};}
      const obsolete=await client.query("UPDATE whatsapp_outbox o SET state='cancelled',last_error='owner_replied' FROM messages m WHERE o.message_id=m.id AND o.conversation_id=$1 AND o.state='queued' AND m.payload->>'clarificationReason'='owner_handling' RETURNING o.message_id",[request.params.id]);
      if(obsolete.rowCount)await client.query("UPDATE messages SET status='cancelled' WHERE id=ANY($1::uuid[])",[obsolete.rows.map(r=>r.message_id)]);
      await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload) VALUES($1,$2,'outbound',$3,'queued',$4::jsonb)",[input.data.id,request.params.id,input.data.text,JSON.stringify({version:1,kind:'text',text:input.data.text,presentation:'text',outboundMessages:1})]);
      await client.query('UPDATE messages SET release_fingerprint=$1 WHERE id=$2',[currentReleaseFingerprint(),input.data.id]);
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
  app.post<{Params:{id:string}}>('/api/owner/requests/:id/review',async(request,reply)=>{
    const parsed=ownerOrderReviewSchema.safeParse(request.body);
    if(!parsed.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Review each item with its current quantity, selling unit, and price.'});
    return write('order_review',request.params.id,client=>reviewOwnerOrder(client,{storeId:owner.storeId,actor:owner.email},request.params.id,parsed.data,config.whatsapp));
  });
  app.post<{Params:{id:string}}>('/api/owner/requests/:id/complete',async(request,reply)=>{
    const parsed=z.object({expectedRevision:z.number().int().positive()}).strict().safeParse(request.body);
    if(!parsed.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Refresh the ready order before completing it.'});
    return write('order_complete',request.params.id,client=>completeOwnerOrder(client,{storeId:owner.storeId,actor:owner.email},request.params.id,parsed.data));
  });
  app.post<{Params:{id:string}}>('/api/owner/requests/:id/decision',async(request,reply)=>{
    const input=z.object({decision:z.enum(['accepted','rejected']),notify:z.boolean().default(false)}).strict().safeParse(request.body);
    if(!input.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Invalid request decision'});
    return write('request_decision',request.params.id,client=>decideOwnerOrder(client,{storeId:owner.storeId,actor:owner.email},request.params.id,input.data,config.whatsapp));
  });
  app.post<{Params:{id:string}}>('/api/owner/requests/:id/fulfillment',async(request,reply)=>{
    const parsed=z.object({expected:z.enum(['awaiting_approval','preparing','ready_for_pickup','collected','cancelled']),status:z.enum(['ready_for_pickup','collected','cancelled']),packedChecked:z.boolean().optional(),expectedRevision:revision.optional(),reason:z.literal('not_picked_up').optional(),notify:z.boolean().default(false)}).strict().refine(p=>!p.reason||(p.status==='cancelled'&&p.expected==='ready_for_pickup'&&p.expectedRevision!==undefined),'Not picked up only applies to cancellation of a ready order.').safeParse(request.body);
    if(!parsed.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Invalid fulfillment update'});
    return write('request_fulfillment',request.params.id,client=>fulfillOwnerOrder(client,{storeId:owner.storeId,actor:owner.email},request.params.id,parsed.data,config.whatsapp));
  });
  app.post<{Params:{id:string}}>('/api/owner/requests/:id/inventory/reconcile',async(request,reply)=>{
    if(!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Invalid order'});
    const p=z.object({expectedRevision:z.number().int().positive(),checked:z.literal(true)}).strict().safeParse(request.body);
    if(!p.success)return reply.code(400).send({error:'Confirm the current physical order before reconciling.'});
    return write('inventory_reconcile',request.params.id,async c=>{
      const r=(await c.query('SELECT * FROM order_requests WHERE store_id=$1 AND id=$2 FOR UPDATE',[owner.storeId,request.params.id])).rows[0];
      if(!r||r.acceptance!=='accepted'||['collected','cancelled'].includes(r.fulfillment)||r.effective_revision!==p.data.expectedRevision)throw new ToolError('Refresh this open accepted order before reconciling.');
      return reserveRequest(c,owner.storeId,r.id,r.effective_lines??r.lines,r.effective_revision,owner.email,true);
    });
  });
  app.post<{Params:{id:string}}>('/api/owner/requests/:id/advance/verify',async(request,reply)=>{
    const p=z.object({reference:z.string().trim().min(6).max(80),notify:z.boolean().default(true)}).strict().safeParse(request.body);
    if(!p.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Enter the bank/UPI transaction reference.'});
    return write('advance_verify',request.params.id,async client=>{
      const result=await verifyManualAdvance(client,owner.storeId,request.params.id,owner.email,p.data.reference);
      const r=(await client.query('SELECT r.*,c.reply_language FROM order_requests r JOIN conversations c ON c.id=r.conversation_id WHERE r.id=$1 AND r.store_id=$2',[request.params.id,owner.storeId])).rows[0];
      const text=result.refundRequired?customerCopy('refundNeeded',{replyLanguage:r.reply_language}):customerCopy('advanceReceived',{replyLanguage:r.reply_language},{reference:r.id.replaceAll('-','').slice(0,8).toUpperCase()});
      return {...result,...await queueOrderNotice(client,owner.storeId,r.id,'advance-verified',textPresentation(text),config.whatsapp,p.data.notify)};
    });
  });
  app.post<{Params:{id:string}}>('/api/owner/requests/:id/advance/confirm',async(request,reply)=>{
    const parsed=z.object({received:z.literal(true),expectedState:z.enum(['requested','claimed','pay_at_shop']),notify:z.boolean().default(false)}).strict().safeParse(request.body);
    if(!parsed.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Confirm the ₹10 receipt after checking your bank or UPI app.'});
    return write('advance_confirm',request.params.id,async client=>{
      const result=await confirmManualAdvanceReceipt(client,owner.storeId,request.params.id,owner.email,parsed.data.expectedState);
      const row=(await client.query('SELECT r.id,c.reply_language FROM order_requests r JOIN conversations c ON c.id=r.conversation_id WHERE r.store_id=$1 AND r.id=$2',[owner.storeId,request.params.id])).rows[0];
      const text=customerCopy('advanceReceived',{replyLanguage:row.reply_language},{reference:row.id.replaceAll('-','').slice(0,8).toUpperCase()});
      return {...result,...await queueOrderNotice(client,owner.storeId,row.id,'advance-verified',textPresentation(text),config.whatsapp,parsed.data.notify)};
    });
  });
  app.post<{Params:{id:string}}>('/api/owner/requests/:id/advance/refund',async(request,reply)=>{
    const p=z.object({reference:z.string().trim().min(6).max(80),notify:z.boolean().default(true)}).strict().safeParse(request.body);
    if(!p.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Enter the actual refund reference.'});
    return write('advance_refund',request.params.id,async client=>{
      const result=await verifyManualRefund(client,owner.storeId,request.params.id,p.data.reference);
      const r=(await client.query('SELECT c.reply_language FROM order_requests r JOIN conversations c ON c.id=r.conversation_id WHERE r.id=$1 AND r.store_id=$2',[request.params.id,owner.storeId])).rows[0];
      const text=customerCopy('refundComplete',{replyLanguage:r.reply_language});
      return {...result,...await queueOrderNotice(client,owner.storeId,request.params.id,'advance-refunded',textPresentation(text),config.whatsapp,p.data.notify)};
    });
  });
  app.get<{Params:{id:string}}>('/api/owner/requests/:id/quote-draft',async(request,reply)=>{
    if(!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Invalid order.'});
    if(!(await pool.query('SELECT 1 FROM order_requests WHERE store_id=$1 AND id=$2',[owner.storeId,request.params.id])).rowCount)return reply.code(404).send({error:'Order not found.'});
    const row=(await pool.query('SELECT * FROM order_quote_drafts WHERE store_id=$1 AND request_id=$2',[owner.storeId,request.params.id])).rows[0];
    return {draft:row?quoteDraftRow(row):null};
  });
  app.post<{Params:{id:string}}>('/api/owner/requests/:id/quote-draft',async(request,reply)=>{
    const p=saveQuoteDraftSchema.safeParse(request.body);
    if(!p.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Check the quote draft fields.'});
    return write('quote_draft',request.params.id,c=>saveQuoteDraft(c,owner.storeId,request.params.id,owner.email,p.data));
  });
  app.post<{Params:{id:string}}>('/api/owner/requests/:id/quote/notify',async(request,reply)=>{
    const p=z.object({quoteId:uuid,expectedRevision:z.number().int().positive(),notify:z.literal(true)}).strict().safeParse(request.body);
    if(!p.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Choose the current quote and enable WhatsApp notification.'});
    return write('order_quote_notice',request.params.id,async client=>{
      const row=(await client.query("SELECT q.id,q.created_at FROM order_quotes q JOIN order_requests r ON r.id=q.request_id WHERE q.store_id=$1 AND r.store_id=$1 AND q.request_id=$2 AND q.id=$3 AND q.state='offered' AND q.expected_revision=r.effective_revision AND r.effective_revision=$4 AND r.acceptance<>'rejected' AND r.fulfillment NOT IN ('collected','cancelled') FOR UPDATE OF q,r",[owner.storeId,request.params.id,p.data.quoteId,p.data.expectedRevision])).rows[0];
      if(!row||Date.now()-new Date(row.created_at).getTime()>=24*3600000)throw new ToolError('The quote changed or expired. Review the order and send a fresh quote.','stale_version');
      if((await client.query("SELECT 1 FROM order_amendments WHERE request_id=$1 AND state IN ('proposed','owner_pending')",[request.params.id])).rowCount)throw new ToolError('Review the customer change before notifying them about a quote.');
      return {quoteId:row.id,...await queueOrderNotice(client,owner.storeId,request.params.id,'quote-'+row.id,await orderQuoteReply(client,owner.storeId,row.id),config.whatsapp,true)};
    });
  });
  app.post<{Params:{id:string}}>('/api/owner/requests/:id/quote',async(request,reply)=>{
    const p=orderQuoteSchema.extend({notify:z.boolean().default(true)}).safeParse(request.body);
    if(!p.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Provide a price, quantity, and selling unit for every requested line.'});
    return write('order_quote',request.params.id,async client=>{
      const {notify,...details}=p.data,result=await offerOrderQuote(client,owner.storeId,request.params.id,owner.email,details);
      const rich=await orderQuoteReply(client,owner.storeId,result.quote.id);
      return {quoteId:result.quote.id,replayed:result.replayed,...await queueOrderNotice(client,owner.storeId,request.params.id,'quote-'+result.quote.id,rich,config.whatsapp,notify)};
    });
  });
  app.post<{Params:{id:string}}>('/api/owner/amendments/:id/decision',async(request,reply)=>{
    const p=z.object({decision:z.enum(['accepted','rejected']),notify:z.boolean().default(true)}).strict().safeParse(request.body);
    if(!p.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Choose accept or reject.'});
    return write('order_amendment',request.params.id,async client=>{
      const result=await decideAmendment(client,owner.storeId,request.params.id,owner.email,p.data.decision);
      const language=(await client.query('SELECT reply_language FROM conversations WHERE id=$1',[result.row.conversation_id])).rows[0].reply_language;
      const text=customerCopy(p.data.decision==='accepted'?'amendmentAccepted':'amendmentRejected',{replyLanguage:language},{items:result.row.kind==='cancel'?say({replyLanguage:language},'Order cancelled. Any advance refund is handled separately.','Order cancel ஆகியிருக்கு. Advance refund-ஐ தனியா கடை check பண்ணும்.','Order cancel aagiyirukku. Advance refund-ai thaniyaa kadai check pannum.'):result.row.summary});
      return {amendmentId:result.row.id,state:result.row.state,replayed:result.replayed,...await queueOrderNotice(client,owner.storeId,result.row.request_id,'amendment-'+result.row.id+'-'+p.data.decision,textPresentation(text),config.whatsapp,p.data.notify)};
    });
  });

}
