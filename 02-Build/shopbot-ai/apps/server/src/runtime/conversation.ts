import {acceptOrderQuote} from '../services/order-quotes.js';
import {actionDeliveryReady} from '../services/review-delivery.js';
import {acknowledgementOnly,amendmentIntent,explicitNewOrder,cancellationIntent,proposeAmendment,customerAmendmentAction,amendmentReviewReply} from '../services/order-amendments.js';
import {upiAdvanceReply,claimUpiAdvance,chooseDemoPayAtShop,paymentClaimText,demoPayAtShopText,type UpiAdvanceConfig} from '../services/upi-advance.js';
import {customerCopy} from '../../../../packages/contracts/customer-copy.js';
import {discoverProducts as lookupGroundedProducts} from '../services/catalog-discovery.js';
import {validateCurrentTurn,submissionIntent,namedRemovalsExplicit} from '../services/current-turn.js';
import {bindExplicitCorrection} from '../services/shopping-corrections.js';
import {validateProductMeaningEvidence} from '../services/product-meaning.js';
import {reviewDeliveryReady} from '../services/review-delivery.js';
import {inferenceTiming,providerCallTimeout,processingLeaseSeconds} from '../services/inference-timing.js';
import {productCheckCoversDraft} from '../services/counter-state.js';
import {visualReply,returningReply,cartProgress} from '../services/visual-ordering.js';
import {materializeVisualReply} from '../services/visual-images.js';
import {protectQuantityEvidence,explicitPurchaseCount} from '../services/quantity-evidence.js';
import {namedEditLines} from '../adapters/mention-reconciliation.js';
import {additionalMention} from '../../../../packages/contracts/intent-language.js';
import {phrasingLanguage} from '../../../../packages/contracts/language.js';
import {normalizeAmountEdits} from '../services/amount-edits.js';
import {shoppingActions} from '../services/shopping-actions.js';
import {handleShoppingAction,shoppingButton} from '../services/shopping-flow.js';
import {say,canonicalShortcut,languageRequest,languageAcknowledgement,customerError,safeQuestion,unitName,draftIssueText,requestedAmountText,lineName,productName,productPriceText,productStockText} from '../../../../packages/contracts/language.js';
import {formatMoney,lineTotal} from '../../../../packages/contracts/money.js';
import {loadImage} from '../services/image-media.js';
import {loadVoice} from '../services/voice-media.js';
import {priceInquiry,quantityReply,spokenClearCommand,negatedSpokenClear,spokenWholeListChange} from '../services/shopping-language.js';
import {socialIntent,shopInquiry,shopAnswers,presentReply,plainReply} from '../services/replies.js';
import {FreeQuotaError} from '../adapters/google-interpreter.js';
import { randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { interpretationSchema, type ConversationState, type Interpretation, type SimulatorEvent, type ToolCall, type Product, type RichReply } from '../../../../packages/contracts/index.js';
import type { Interpreter,InterpretationInput } from '../adapters/interpreter.js';
import {reserveAttempt,settleAttempt,rateHealth,validateRateCard,coolDownFreeQuota} from '../services/inference-budget.js';
import {getProducts,catalogEnabled,catalogContext,sameUnit,normalizeUnit,tokens,exactProductMatch} from '../services/catalog.js';
import {getCatalogMap,refinementPlan,discoverProducts} from '../services/catalog-discovery.js';
import { loadState, RetailTools,digest,referenceLine, type ToolResult } from '../services/tools.js';
import { ToolError, withConversation, type ActorContext } from '../services/context.js';
import {loadAssistantMemory,saveAssistantMemory,observeCatalog,observationQueries,recheckQueries,isRecheck,pendingItem,assistanceReply,conversationBinding,type AssistantMemory,type CatalogObservation} from '../services/agent-assistance.js';
import {currentReleaseFingerprint} from '../services/release-manifest.js';

function quantityAnswer(state:ConversationState,lineId:string,amount:{quantity:number;unit?:string},text:string):Interpretation['operations'][number] {
 const line=state.draft.find(l=>l.id===lineId);
 if(amount.unit&&['metre','foot','litre','kg','ml','g'].includes(normalizeUnit(amount.unit)))return {kind:'set_amount',reference:lineId,amount:{value:amount.quantity,unit:amount.unit},supportingPhrase:text.slice(0,500),mode:'total'};
 if(line?.sku&&(!amount.unit||!line.unit||sameUnit(amount.unit,line.unit)))return line.resolution==='needs_unit'&&!line.requestedAmount?{kind:'resolve_line',lineId,quantity:amount.quantity,requestedUnit:amount.unit}:{kind:'set_quantity',reference:lineId,quantity:amount.quantity,supportingPhrase:text.slice(0,200)};
 return {kind:'resolve_line',lineId,quantity:amount.quantity,...(amount.unit?{requestedUnit:amount.unit}:{})};
}
type Claimed = { deadlineAt:number; id:string; token:string; event:SimulatorEvent; bindingId:string|null; state:ConversationState; catalog:Product[];catalogMap?:import('../../../../packages/contracts/index.js').CatalogMap;memory:AssistantMemory|null;displayedActions:SimulatorEvent[];displayedProducts:{event:SimulatorEvent;product:Product}[] };
class DeferredRecommendation extends Error {}
// A repeated generic noun is not evidence that a previous brand or size was
// withdrawn. Keep the more specific request unless the customer changes it.
function retainRefinementIdentity(op:Interpretation['operations'][number],state:ConversationState,text:string,map?:Claimed['catalogMap']) {
  if(op.kind!=='resolve_line'||!op.query)return op;
  const old=state.draft.find(line=>line.id===op.lineId)?.query;
  if(!old)return op;
  const previous=tokens(old),next=tokens(op.query);
  const narrowed=next.length>0&&next.length<previous.length&&next.every((word,index)=>word===previous[previous.length-next.length+index]);
  const replacement=/\b(?:change|instead|rather|different|another|any brand|forget|remove|drop)\b|brand\s+(?:doesn.?t matter|not important)|பிராண்ட்\s*வேண்டாம்|மாற்று|மாத்து|வேறு\s*பிராண்ட்/i.test(text);
  const changedBrand=op.search?.brand&&!old.toLowerCase().includes(op.search.brand.toLowerCase());
  if(replacement||changedBrand)return op;
  if(narrowed)return {...op,query:old};
  // A brand-only request can become a complete type description: Asian Paints
  // followed by wall paint still retains the named brand. Use the actual
  // taxonomy to recognize that refinement, rather than the model's omission.
  const same=(a:string[],b:string[])=>a.length===b.length&&a.every((word,index)=>word===b[index]);
  const family=map?.departments.flatMap(d=>d.families).find(f=>{
    const aliases=[f.label,...f.aliases].map(tokens);
    const known=new Set(aliases.flat());
    return aliases.some(a=>same(next,a))&&aliases.some(a=>a.length>0&&a.length<previous.length&&same(previous.slice(-a.length),a))&&previous.some(word=>!known.has(word)&&!/^\d/.test(word));
  });
  const combined=old+' '+op.query;
  return family&&combined.length<=200?{...op,query:combined}:op;
}
// A discovery follow-up may refine the old goal or start an unrelated request.
// Carry amounts across the former only; a new explicit amount always wins.
function discoverySelection(item:Extract<Interpretation['operations'][number],{kind:'add_item'}>,text:string,memory:AssistantMemory|null|undefined) {
  if(!memory)return {quantity:item.quantity??undefined,requestedUnit:item.requestedUnit};
  const words=text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}.]+/gu,' ').trim().split(/\s+/);
  const explicitAmount=item.quantity!==null&&words.some((word,index)=>{
    const amount=quantityReply(word);
    // A dimension describes the item or workpiece, not the purchase amount.
    return amount?.quantity===item.quantity&&!/^(?:inch(?:es)?|in|mm|cm|இன்ச்|இஞ்ச்)$/.test(words[index+1]??'');
  });
  const identity=(query:string)=>tokens(query).filter(word=>!/^\d/.test(word));
  const requested=identity(item.query);
  const suffix=(a:string[],b:string[])=>b.length>0&&b.length<=a.length&&b.every((word,index)=>word===a[a.length-b.length+index]);
  const sameGoal=memory.queries.some(query=>{
    const previous=identity(query);
    return suffix(requested,previous)||suffix(previous,requested);
  })||memory.observations.some(observation=>observation.products.some(product=>exactProductMatch(item.query,product)));
  if(explicitAmount)return {quantity:item.quantity!,requestedUnit:item.requestedUnit??(sameGoal?memory.requestedUnit:undefined)};
  return {quantity:sameGoal?memory.requestedQuantity:undefined,requestedUnit:item.requestedUnit??(sameGoal?memory.requestedUnit:undefined)};
}
export class ConversationRuntime {
  readonly tools:RetailTools;
  constructor(private pool:Pool,private provider:Interpreter,private options:{advance?:UpiAdvanceConfig;partialReviews?:boolean;welcomeAudio?:string;allowPaidInference?:boolean;allowFreeInference?:boolean;discoveryStages?:boolean;mediaRecommendations?:boolean;sequentialItems?:boolean;visualOrdering?:boolean;maxDraftLines?:number;queueReply?:(client:PoolClient,ctx:ActorContext,id:string,reply:RichReply)=>Promise<void>}={}) {
    if(provider.mode==='live') {
      if(!(provider.freeQuota?options.allowFreeInference:options.allowPaidInference)||!provider.billing) throw new ToolError('Live interpretation is disabled until explicitly authorized metered configuration is supplied');
      if(rateHealth(provider.billing).status==='invalid')validateRateCard(provider.billing);
    }
    this.tools=new RetailTools(pool,{advance:options.advance,sequentialItems:provider.unifiedUnderstanding?false:options.sequentialItems,maxDraftLines:options.maxDraftLines});
  }
  async processNext(ctx:ActorContext):Promise<boolean> {
    const claimed=await withConversation(this.pool,ctx,async client=>{
      const controls=await client.query('SELECT c.operator_mode,s.operator_paused FROM conversations c JOIN stores s ON s.id=c.store_id WHERE c.id=$1',[ctx.conversationId]);
      if(controls.rows[0].operator_mode==='owner'||controls.rows[0].operator_paused)return null;
      const active=await client.query("SELECT id FROM messages WHERE conversation_id=$1 AND status='processing' AND lease_until>now() LIMIT 1",[ctx.conversationId]);
      if(active.rowCount) return null;
      const row=await client.query("SELECT id,payload,binding_id FROM messages WHERE conversation_id=$1 AND (status='pending' OR (status='processing' AND lease_until<=now())) ORDER BY sequence LIMIT 1 FOR UPDATE",[ctx.conversationId]);
      if(row.rows[0]&&(await client.query("SELECT not_before>now() OR EXISTS(SELECT 1 FROM whatsapp_media WHERE message_id=$1 AND state IN ('pending','fetching')) AS waiting FROM messages WHERE id=$1",[row.rows[0].id])).rows[0].waiting)return null;
      if(!row.rows[0]) return null;
      const token=randomUUID(),m=row.rows[0];
      const claimedDeadline=await client.query("UPDATE messages SET status='processing',claim_token=$1,lease_until=clock_timestamp()+$3*interval '1 second',inference_deadline_at=coalesce(inference_deadline_at,to_timestamp($4/1000.0)) WHERE id=$2 RETURNING inference_deadline_at",[token,m.id,processingLeaseSeconds(),Date.now()+inferenceTiming.turnMs]);
      await client.query('UPDATE messages SET release_fingerprint=$1 WHERE id=$2',[currentReleaseFingerprint(),m.id]);
      if(this.options.visualOrdering!==undefined)await client.query('UPDATE conversations SET visual_ordering=$2 WHERE id=$1',[ctx.conversationId,this.options.visualOrdering]);
      if(this.options.partialReviews!==undefined)await client.query('UPDATE conversations SET partial_reviews=$2 WHERE id=$1',[ctx.conversationId,this.options.partialReviews]);
      const shown=(await client.query("SELECT payload FROM messages WHERE conversation_id=$1 AND direction='outbound' ORDER BY sequence DESC LIMIT 20",[ctx.conversationId])).rows;
      const displayedProducts=shown.flatMap(r=>[...(r.payload?.parts??[]).flatMap((p:any)=>p.cards.flatMap((c:any)=>c.kind==='product'?(c.buttons??[]).map((b:any)=>({event:b.event,product:c.product})):[])),...(r.payload?.cards??[]).flatMap((c:any)=>c.action&&c.product?[{event:c.action,product:c.product}]:[])]);
      const displayedActions=shown.flatMap(r=>[...(r.payload?.parts??[]).flatMap((p:any)=>[...(p.buttons??[]).map((b:any)=>b.event),...(p.cards??[]).flatMap((c:any)=>(c.buttons??[]).map((b:any)=>b.event))]),...(r.payload?.cards??[]).flatMap((c:any)=>c.action?[c.action]:[]),...(r.payload?.buttons??[]).map((b:any)=>b.event)]);
      return {deadlineAt:new Date(claimedDeadline.rows[0].inference_deadline_at).getTime(),id:m.id,token,event:m.payload,bindingId:m.binding_id,state:await loadState(client,ctx),catalog:await catalogEnabled(client,ctx)?await catalogContext(client,ctx):await getProducts(client,ctx),catalogMap:await catalogEnabled(client,ctx)?await getCatalogMap(client,ctx):undefined,memory:await loadAssistantMemory(client,ctx),displayedActions,displayedProducts} as Claimed;
    });
    if(!claimed) return false;
    let requestedLanguage=claimed.event.type==='change_language'?claimed.event.language:claimed.event.type==='text'?languageRequest(claimed.event.text):undefined;
    let interpretation:Interpretation|undefined;
    let failure:string|undefined;let failureReason:string|undefined;
    let voiceFailureKind:'unreadable'|'processing'|undefined;
    let deterministic:ToolCall|undefined;
    let clearConfirmation=false,changeWholeList=false;
    if(claimed.event.type==='retry_voice'){
      const retry=claimed.event;
      if(retry.expectedVersion!==claimed.state.version||!claimed.displayedActions.some(a=>digest(a)===digest(retry)))failure='That retry belongs to an earlier question. Please send your current request again.';
      else claimed.event={id:retry.id,type:'voice',mediaId:retry.mediaId};
    }
    if(!failure)try {deterministic=this.knownAction(claimed);} catch(error) {failure=error instanceof Error?error.message:'Invalid callback';}
    const quoteRecheck=claimed.event.type==='text'&&isRecheck(claimed.event.text)&&claimed.memory?.purpose==='quote'&&claimed.memory.sourceVersion===claimed.state.version;
    if(quoteRecheck)interpretation={operations:[],next:'price',priceQuery:claimed.memory!.queries[0],priceQuantity:claimed.memory!.quoteQuantity,priceUnit:claimed.memory!.quoteUnit};
    if(!deterministic&&claimed.event.type==='text'&&submissionIntent(claimed.event.text))deterministic=this.knownAction({...claimed,event:{...claimed.event,text:'send it'}});
    let social=claimed.event.type==='text'?socialIntent(claimed.event.text):undefined;
    if(claimed.state.lastRequestId&&!claimed.state.pending&&claimed.event.type==='text'&&acknowledgementOnly(claimed.event.text))social='thanks';
    if(claimed.event.type==='text'&&negatedSpokenClear(claimed.event.text))social='pause';
    if(social==='handoff')deterministic={name:'request_store_assistance',args:{expectedVersion:claimed.state.version}};
    const inquiry=claimed.event.type==='text'?shopInquiry(claimed.event.text):undefined;
    if(inquiry&&!deterministic)interpretation=inquiry;
    if(claimed.state.lastRequestId&&claimed.event.type==='text'&&(paymentClaimText(claimed.event.text)||demoPayAtShopText(claimed.event.text)))interpretation={operations:[],next:'continue'};
    if(social&&!deterministic)interpretation={operations:[],next:'continue',conversation:social};
    if(!failure&&!deterministic&&!social&&!inquiry&&!interpretation&&!requestedLanguage&&(claimed.event.type==='text'||claimed.event.type==='voice'||claimed.event.type==='image')) {
      try {interpretation=await this.interpret(ctx,claimed);}
      catch(error) {
        if(error instanceof DeferredRecommendation){
          await withConversation(this.pool,ctx,async client=>{await client.query("UPDATE messages SET status='pending',claim_token=NULL,lease_until=NULL,not_before=now()+interval '6 seconds' WHERE id=$1 AND claim_token=$2",[claimed.id,claimed.token]);});
          return true;
        }
        failureReason=error instanceof ToolError?error.code:undefined;
        if(claimed.event.type==='voice'&&!failureReason?.startsWith('interpretation_')&&!(error instanceof FreeQuotaError)&&!(error instanceof ToolError&&['stale_version','quota_unavailable','budget_unavailable'].includes(error.code)))voiceFailureKind=error instanceof ToolError&&error.code==='voice_unreadable'?'unreadable':'processing';
        failure=failureReason?.startsWith('interpretation_')?customerError(error instanceof Error?error.message:'Could not apply changes',claimed.state,failureReason):this.provider.mode==='live'?(error instanceof ToolError&&error.code==='stale_version'?error.message:error instanceof ToolError&&error.code==='quota_unavailable'?'I’m temporarily at the AI request limit. Your list is kept. Use a product button or ask the shop to help.':error instanceof FreeQuotaError?'The AI service is temporarily rate limited. Your list is kept; product buttons and catalog rechecks still work.':'I’m having trouble processing that message. Your list is kept. You can recheck the item, use the product choices, or try a new description shortly.'):error instanceof Error?error.message:'Interpretation failed. Your draft is retained.';
      }
    }
    // A current recording is a customer channel: recognized whole commands
    // share text routing and its version, delivery and review-consent checks.
    if(!failure&&!deterministic&&claimed.state.visualOrdering&&!claimed.state.lastRequestId&&
      ['text','voice'].includes(claimed.event.type)&&interpretation?.understanding?.intents.includes('clear_list')&&
      !interpretation.understanding.unresolved.includes('validation_recovery')&&
      !negatedSpokenClear(interpretation.transcript??(claimed.event.type==='text'?claimed.event.text:''))){
      // Model intent can offer a proposal, never authorize erasing the cart.
      interpretation={...interpretation,operations:[],next:'continue'};clearConfirmation=true;
    }
    if(!failure&&claimed.event.type==='voice'&&interpretation?.transcript){
      const transcript=interpretation.transcript,spokenClear=spokenClearCommand(transcript),command=spokenClear??canonicalShortcut(transcript);
      const quote=priceInquiry(transcript);
      if(quote&&!interpretation.operations.length){deterministic={name:'search_products',args:quote};interpretation={operations:[],next:'price',transcript,priceQuery:quote.query,priceQuantity:quote.quantity,priceUnit:quote.requestedUnit};}
      if(negatedSpokenClear(transcript))interpretation={operations:[],next:'continue',transcript,conversation:'pause'};
      social=socialIntent(transcript);
      if(social==='handoff')deterministic={name:'request_store_assistance',args:{expectedVersion:claimed.state.version}};
      changeWholeList=spokenWholeListChange(transcript);
      if((spokenClear||changeWholeList)&&claimed.state.visualOrdering){
        // Speech can mishear "everything" or a negative lead-in. A clear
        // proposal always waits for a displayed, version-bound button.
        interpretation={operations:[],next:'continue',transcript,...(claimed.state.lastRequestId?{conversation:'pause' as const}:{})};
        clearConfirmation=!claimed.state.lastRequestId&&claimed.state.draft.length>0;
        social=undefined;deterministic=undefined;
        if(!clearConfirmation&&!claimed.state.lastRequestId)deterministic={name:'get_draft',args:{}};
      } else if(['yes','confirm','place order','send it','review','checkout','enough','bill','estimated bill','estimate','show bill','bill evvalavu','பில் எவ்வளவு','பில் காட்டு','clear my list','clear the list','empty my list','edit my list','my orders','order status','status'].includes(command)||submissionIntent(transcript)||quantityReply(command)||/^(?:remove|drop|delete) (?:it|this|that)(?: item)?$/.test(command)){
        try{
          deterministic=this.knownAction({...claimed,event:{id:claimed.id,type:'text',text:submissionIntent(transcript)?'send it':command}});
          if(deterministic)interpretation={operations:[],next:'continue',transcript};
        }catch(error){failure=error instanceof Error?error.message:'Invalid spoken list control';}
      }
    }
    if(!deterministic&&interpretation?.conversation==='handoff'&&!interpretation.operations.length&&!interpretation.understanding?.intents.includes('estimate'))deterministic={name:'request_store_assistance',args:{expectedVersion:claimed.state.version}};
    if(!failure&&!deterministic&&claimed.event.type!=='image'&&interpretation?.understanding?.intents.includes('status')&&!interpretation.operations.length)deterministic={name:'get_order_status',args:{}};
    if(!failure&&!deterministic&&!claimed.state.lastRequestId&&claimed.state.draft.length&&!interpretation?.operations.length&&(interpretation?.understanding?.intents.includes('estimate')||interpretation?.understanding?.intents.includes('submit')))deterministic={name:'preview_order',args:{expectedVersion:claimed.state.version,allowPartial:claimed.state.allowPartialReview}};
    const explicitSend=claimed.event.type==='shopping_action'&&claimed.event.action==='finish_order'||(claimed.event.type==='text'?submissionIntent(claimed.event.text):claimed.event.type==='voice'&&!!interpretation?.transcript&&submissionIntent(interpretation.transcript));
    // A job answer during read-only exploration is still a product proposal.
    // The model cannot turn that phase into a cart write or default its amount.
    // Trusted photo choices bypass this guard through knownAction. Explicit
    // multi-line shopping lists retain the ordinary photo-confirmation flow.
    if(!claimed.state.visualOrdering&&claimed.state.requireProductConfirmation&&!claimed.state.lastRequestId&&!deterministic&&claimed.memory?.purpose==='discovery'&&claimed.memory.sourceVersion===claimed.state.version&&!claimed.state.pending&&interpretation?.operations.length===1&&interpretation.operations[0].kind==='add_item') {
      const proposal=interpretation.operations[0];
      interpretation={operations:[],next:'assist',transcript:interpretation.transcript,assistance:{rootQuery:proposal.query,queries:[proposal.query],search:proposal.search,...discoverySelection(proposal,claimed.event.type==='text'?claimed.event.text:claimed.event.type==='image'?interpretation.understanding?.observedText??'':interpretation.transcript??'',claimed.memory),question:interpretation.clarifyQuestion}};
    }
    if(claimed.state.visualOrdering&&interpretation?.operations.length)try{interpretation={...interpretation,operations:protectQuantityEvidence(validateProductMeaningEvidence(interpretation.operations,claimed.event.type==='text'?claimed.event.text:claimed.event.type==='image'?interpretation.understanding?.observedText??'':interpretation.transcript??''),claimed.event.type==='text'?claimed.event.text:claimed.event.type==='image'?interpretation.understanding?.observedText??'':interpretation.transcript??'')};}catch(error){failure=error instanceof Error?error.message:'Product meaning could not be validated.';}
    if(claimed.event.type==='voice'&&interpretation?.transcript&&interpretation.operations.length===0&&interpretation.next==='continue')requestedLanguage=languageRequest(interpretation.transcript);
    if(claimed.state.visualOrdering&&!failure&&!claimed.state.lastRequestId&&claimed.state.draft.length&&interpretation?.understanding?.intents.includes('cancel')&&!interpretation.operations.length&&!negatedSpokenClear(interpretation.transcript??(claimed.event.type==='text'?claimed.event.text:''))){
      // Unsent-list cancellation proposes choices; it is neither deletion nor
      // a human handover. No exact ASR spelling is needed for confirmation.
      clearConfirmation=true;changeWholeList=!spokenClearCommand(interpretation.transcript??(claimed.event.type==='text'?claimed.event.text:''));
      interpretation={...interpretation,conversation:undefined};social=undefined;deterministic=undefined;
    }
    await withConversation(this.pool,ctx,async client=>{
      const controls=await client.query('SELECT c.operator_mode,s.operator_paused FROM conversations c JOIN stores s ON s.id=c.store_id WHERE c.id=$1',[ctx.conversationId]);
      if(controls.rows[0].operator_mode==='owner'||controls.rows[0].operator_paused){
        await client.query("UPDATE messages SET status='pending',claim_token=NULL,lease_until=NULL WHERE id=$1 AND claim_token=$2",[claimed.id,claimed.token]);
        return;
      }
      const held=await client.query("SELECT id FROM messages WHERE id=$1 AND conversation_id=$2 AND status='processing' AND claim_token=$3 AND lease_until>clock_timestamp()",[claimed.id,ctx.conversationId,claimed.token]);
      if(!held.rowCount) return; // Another worker acquired the expired lease; old result is discarded.
      await client.query('SAVEPOINT turn_effects');
      if(Date.now()>=claimed.deadlineAt){failure='The turn deadline was reached. Your list is retained.';failureReason='turn_deadline';}
      const current=await loadState(client,ctx);
      const inferred=claimed.state.visualOrdering&&claimed.event.type==='text'?phrasingLanguage(claimed.event.text):undefined;
      if(inferred&&!requestedLanguage&&!current.languageExplicit){current.replyLanguage=inferred;await client.query('UPDATE conversations SET reply_language=$1 WHERE id=$2',[inferred,ctx.conversationId]);}
      let newListProposal:AssistantMemory['newList'];
      const turnText=claimed.event.type==='text'?claimed.event.text:interpretation?.transcript??'';
      if(current.lastRequestId&&['text','voice'].includes(claimed.event.type)&&['yes','confirm'].includes(canonicalShortcut(turnText))){
        const actionable=(await client.query("SELECT id,'confirm_amendment' AS type FROM order_amendments WHERE request_id=$1 AND conversation_id=$2 AND state='proposed' UNION ALL SELECT id,'confirm_order_quote' AS type FROM order_quotes WHERE request_id=$1 AND state='offered'",[current.lastRequestId,ctx.conversationId])).rows;
        const action=claimed.displayedActions.find(a=>['confirm_amendment','confirm_order_quote'].includes(a.type)&&'expectedVersion' in a&&a.expectedVersion===current.version&&actionable.some(row=>row.type===a.type&&row.id===('amendmentId' in a?a.amendmentId:'quoteId' in a?a.quoteId:undefined)));
        if(action){claimed.event=action;interpretation={operations:[],next:'continue'};}
      }
      const postOrderChange=!!current.lastRequestId&&!explicitNewOrder(turnText)&&(amendmentIntent(turnText)||!!interpretation?.operations.some(op=>!['add_item','set_fulfillment'].includes(op.kind)));
      if(!failure&&['text','voice'].includes(claimed.event.type)&&current.lastRequestId&&!current.pending&&(acknowledgementOnly(turnText)||interpretation?.conversation==='unrelated'&&interpretation.understanding?.intents.every(i=>['unrelated','thanks'].includes(i)))&&!interpretation?.operations.length&&!requestedLanguage){
        const proposed=await client.query("SELECT id FROM order_amendments WHERE conversation_id=$1 AND state='proposed' LIMIT 1",[ctx.conversationId]);
        if(!proposed.rowCount){await client.query("UPDATE messages SET status='processed',reply_decision=$3,claim_token=NULL,lease_until=NULL WHERE id=$1 AND claim_token=$2",[claimed.id,claimed.token,acknowledgementOnly(turnText)?'acknowledgement_only':'unrelated']);return;}
      }

      if(current.lastRequestId&&!postOrderChange&&interpretation?.operations.length&&interpretation.operations.every(op=>op.kind==='add_item')){
        const items=interpretation.operations as NonNullable<AssistantMemory['newList']>;
        if(items.length>1||explicitNewOrder(turnText))newListProposal=items;
        else{
          const first=items[0];
          interpretation={operations:[],next:'assist',transcript:interpretation.transcript,assistance:{rootQuery:first.query,queries:[first.query],search:first.search,...(first.quantity!==null?{quantity:first.quantity}:{}),requestedUnit:first.requestedUnit}};
        }
      }
      if(claimed.event.type==='voice'&&interpretation?.transcript)await client.query('UPDATE messages SET text=$1 WHERE id=$2 AND conversation_id=$3',[interpretation.transcript,claimed.id,ctx.conversationId]);
      if(failure)failure=voiceFailureKind==='unreadable'?say(current,'I could not make out the recording. Please record it again or type your request.','குரல் தெளிவாகப் புரியவில்லை.\nமீண்டும் voice அனுப்புங்க அல்லது text-ல சொல்லுங்க.','Voice theliva puriyala. Marubadi voice anuppunga illa text-la sollunga.'):voiceFailureKind==='processing'?say(current,'Could not process that voice message.\nYour list is kept.\nTry again or send text.','குரல் செய்தியைச் செயலாக்க முடியவில்லை.\nபட்டியல் அப்படியே இருக்கு.\nமீண்டும் முயலுங்க அல்லது text அனுப்புங்க.','Voice message-ai process panna mudiyala.\nList appadiye irukku.\nMarubadi try pannunga illa text anuppunga.'):customerError(failure,current);
      let replyRequest:import('../../../../packages/contracts/index.js').OrderRequest|null|undefined;
      let message=failure??'';let rich:RichReply={...plainReply(message),...(failure?{stage:'error' as const,clarificationReason:failureReason??(claimed.event.type==='voice'?'voice_processing_failed':'processing_failed')}:{})};
      // The savepoint ensures invalid dependent operations cannot partially mutate the draft.
      await client.query('SAVEPOINT turn_actions');
      try {

        if(!failure&&current.lastRequestId&&(claimed.event.type==='confirm_amendment'||claimed.event.type==='discard_amendment')){
          if(!claimed.displayedActions.some(a=>digest(a)===digest(claimed.event)))throw new ToolError('Use the displayed amendment choices.','stale_confirmation');
          if(claimed.event.type==='confirm_amendment'&&!await actionDeliveryReady(client,ctx.conversationId,claimed.event.id,true))throw new ToolError('Wait for the complete amendment review.','review_incomplete');
          rich=await customerAmendmentAction(client,ctx,current,claimed.event,claimed.id);message=rich.text;
        } else if(!failure&&current.lastRequestId&&claimed.event.type==='confirm_order_quote'){
          if(!claimed.displayedActions.some(a=>digest(a)===digest(claimed.event))||!await actionDeliveryReady(client,ctx.conversationId,claimed.event.id,true))throw new ToolError('Use the complete current quote.','stale_confirmation');
          await acceptOrderQuote(client,ctx,current,claimed.event,claimed.id);
          rich={...plainReply(say(current,'Your final bill is approved. The shop can now confirm and prepare your order.','Bill confirm ஆகியிருக்கு.\nகடை order-ஐ check பண்ணி தயார்படுத்தும்.','Bill confirm aagiyirukku.\nKadai order-ai check panni thayaarpaduththum.')),readOnly:true};message=rich.text;
        } else if(!failure&&current.lastRequestId&&claimed.event.type==='show_payment_qr'){
          if(claimed.event.expectedVersion!==current.version||claimed.event.requestId!==current.lastRequestId||!claimed.displayedActions.some(a=>digest(a)===digest(claimed.event)))throw new ToolError('Use the latest order payment button.','stale_confirmation');
          rich=(this.options.advance?await upiAdvanceReply(client,ctx,current,this.options.advance.hostname,{demoPayAtShop:this.options.advance.demoPayAtShop}):null)??{...plainReply(say(current,'This order has no pending advance. Ask for its current status.','இந்த order-க்கு advance pending இல்ல. Order status பாருங்க.','Intha order-ku advance pending illa. Order status paarunga.')),readOnly:true};message=rich.text;
        } else if(!failure&&current.lastRequestId&&(claimed.event.type==='pay_at_shop'||demoPayAtShopText(turnText))){
          if(claimed.event.type==='pay_at_shop'&&(claimed.event.expectedVersion!==current.version||claimed.event.requestId!==current.lastRequestId||!claimed.displayedActions.some(a=>digest(a)===digest(claimed.event))))throw new ToolError('Use the latest payment choice.','stale_confirmation');
          await chooseDemoPayAtShop(client,ctx,current.lastRequestId,!!this.options.advance?.demoPayAtShop);
          rich={...plainReply(customerCopy('demoPayAtShop',current)),readOnly:true};message=rich.text;
        } else if(!failure&&current.lastRequestId&&(claimed.event.type==='payment_claim'||paymentClaimText(turnText))){
          if(claimed.event.type==='payment_claim'&&(claimed.event.expectedVersion!==current.version||claimed.event.requestId!==current.lastRequestId||!claimed.displayedActions.some(a=>digest(a)===digest(claimed.event))))throw new ToolError('Use the latest payment choice.','stale_confirmation');
          const paymentState=await claimUpiAdvance(client,ctx,current.lastRequestId);
          const paymentText=['verified','refund_pending','refunded'].includes(paymentState)?say(current,paymentState==='verified'?'The shop has already verified your ₹10 advance.':paymentState==='refunded'?'The shop has recorded your ₹10 refund.':'Your advance was received for a closed order. The shop needs to arrange its refund.',paymentState==='verified'?'₹10 advance வந்திருக்குனு கடை confirm பண்ணியிருக்கு.':paymentState==='refunded'?'₹10 refund complete ஆகியிருக்குனு கடை confirm பண்ணியிருக்கு.':'இந்த order முடிஞ்சிருக்கு. வந்த ₹10 advance-ஐ கடை refund பண்ணணும்.','Advance status-ai kadai confirm panniyirukku.'):customerCopy('paymentClaimed',current);
          rich={...plainReply(paymentState==='pay_at_shop'?customerCopy('demoPayAtShop',current):paymentText),readOnly:true};message=rich.text;
        } else if(!failure&&current.lastRequestId&&(postOrderChange||cancellationIntent(turnText))){
          if(!interpretation?.operations.length&&!cancellationIntent(turnText))rich={...plainReply(customerCopy('amendmentTarget',current)),readOnly:true};
          else rich=await proposeAmendment(client,ctx,current,claimed.id,interpretation?.operations??[],this.tools,cancellationIntent(turnText));
          message=rich.text;
        } else if(requestedLanguage&&!failure) {
          current.replyLanguage=requestedLanguage;current.languageExplicit=true;
          await client.query('UPDATE conversations SET reply_language=$1,reply_language_explicit=true WHERE id=$2 AND store_id=$3 AND actor=$4',[requestedLanguage,ctx.conversationId,ctx.storeId,ctx.actor]);
          rich=presentReply({state:current,message:''},current);
          rich={...rich,text:languageAcknowledgement(requestedLanguage)+'\n\n'+rich.text};message=rich.text;
        } else if(!failure&&clearConfirmation){
          await client.query('UPDATE conversations SET pending=NULL,product_review=NULL,assistant_memory=NULL,editing_line_id=NULL,version=version+1 WHERE id=$1',[ctx.conversationId]);
          current.pending=null;current.productReview=null;current.editingLineId=null;current.version++;
          rich={...plainReply(changeWholeList?say(current,'Do you want to edit items or clear the whole saved list? Your list stays until you choose.','பொருட்களை மாற்றவா, முழு பட்டியலை காலி செய்யவா? நீங்கள் தேர்வு செய்யும் வரை பட்டியல் அப்படியே இருக்கும்.','Porutkalai maaththava, muzhu list-ai clear pannava? Neenga choose pannum varai list appadiye irukkum.'):say(current,`I heard “clear the whole list.” Remove all ${current.draft.length} items? Nothing has been sent.`,`“முழு பட்டியலையும் காலி செய்” என்று கேட்டேன். ${current.draft.length} பொருட்களையும் நீக்கவா? ஆர்டர் அனுப்பவில்லை.`,`“Muzhu list-ai clear pannu” nu ketten. ${current.draft.length} porutkalaiyum neekkava? Order anuppala.`)),stage:'identify',clarificationReason:'intent_clarification',buttons:[...(changeWholeList?[shoppingButton(current,'edit_list',say(current,'Edit items','பொருட்களை மாற்று','Porutkalai maathu'))]:[]),shoppingButton(current,'confirm_clear',say(current,'Clear all items','எல்லாம் நீக்கு','Ellam neekku')),shoppingButton(current,'keep_list',say(current,'Keep my list','பட்டியல் வை','List vaikkavum'))]};message=rich.text;
        } else if(!failure&&current.visualOrdering&&current.draft.length&&!current.lastRequestId&&!deterministic&&interpretation?.operations.length===0&&interpretation?.conversation==='greeting'){
          rich=returningReply(current);message=rich.text;
        } else if(!failure&&newListProposal){
          const observations:CatalogObservation[]=[];
          for(const [index,item] of newListProposal.slice(0,3).entries())observations.push(...await observeCatalog(client,ctx,this.tools,[item.query],`${claimed.id}:new-list-options:${index}`,item.search));
          await saveAssistantMemory(client,ctx,{purpose:'discovery',queries:newListProposal.map(item=>item.query).slice(0,3),lineId:null,sourceVersion:current.version,observations,newList:newListProposal});
          const items=newListProposal.slice(0,6).map(item=>`${item.quantity===null?'?':item.quantity} × ${item.query.slice(0,60)}`).join('\n')+(newListProposal.length>6?`\n+ ${newListProposal.length-6}`:'');
          rich={...plainReply(say(current,`For your new list:\n${items}\n\nYour previous request stays with the shop. Start this list to check each product; ? means the quantity still needs checking.`,`புதிய பட்டியலுக்குக் கேட்டவை:\n${items}\n\nமுந்தைய கோரிக்கை கடையிடம் அப்படியே உள்ளது. பட்டியலைத் தொடங்கிப் பொருட்களைச் சரிபார்க்கலாம். ? என்றால் எண்ணிக்கை சொல்ல வேண்டும்.`,`Pudhu list-ku kettathu:\n${items}\n\nMunthaya request kadaiyila appadiye irukku. List thodangi porutkalai check pannalaam. ? na quantity sollanum.`)),buttons:[shoppingButton(current,'new_list',say(current,'Start this list','பட்டியலைத் தொடங்கு','List thodangu')),shoppingButton(current,'handoff',say(current,'Talk to shop','கடையிடம் பேசு','Kadaiyila pesu'))]};
          const activeObservations=this.options.sequentialItems?observations.slice(0,1):observations;
          const preview=assistanceReply(activeObservations,current),question=safeQuestion(interpretation?.clarifyQuestion,current);
          const preferred=[...observations.map(o=>o.products[0]?.sku),...newListProposal.flatMap(item=>item.search?.preferredSkus??[])];
          const ranked=[...preferred.flatMap(sku=>preview.cards?.filter(card=>card.product.sku===sku)??[]),...preview.cards??[]];
          const cards=ranked.filter((card,index)=>ranked.findIndex(c=>c.product.sku===card.product.sku)===index).slice(0,4).map(card=>{
            const matches=newListProposal.filter(item=>observations.some(o=>o.query===item.query&&o.products.some(p=>p.sku===card.product.sku)));
            const item=matches.length===1?matches[0]:undefined;
            return {...card,quantityLabel:item?.quantity?say(current,`Requested: ${item.quantity} ${item.requestedUnit??'units'}`,`கேட்டது: ${item.quantity} ${unitName(item.requestedUnit??'unit',current,item.quantity)}`,`Kettathu: ${item.quantity} ${unitName(item.requestedUnit??'unit',current,item.quantity)}`):undefined,...(!item?{label:rich.buttons![0].label,action:rich.buttons![0].event}:{} )};
          });
          rich={...rich,...(cards?.length?{kind:'product_choices' as const,cards,presentation:cards.length===1?'single_product' as const:cards.every(c=>c.product.imageUrl)?'carousel_preview' as const:'list' as const}:{}),text:(question?question+'\n':'')+rich.text};
          message=rich.text;
        } else if(!failure&&(claimed.event.type==='edit_item'||claimed.event.type==='shopping_action'&&!['status','handoff','finish_order'].includes(claimed.event.action)||social==='handoff'&&!deterministic||(claimed.event.type==='text'&&canonicalShortcut(claimed.event.text)==='edit my list'||claimed.event.type==='voice'&&canonicalShortcut(interpretation?.transcript??'')==='edit my list'))) {
          const event=claimed.event.type==='edit_item'||claimed.event.type==='shopping_action'?claimed.event:{id:claimed.id,type:'shopping_action' as const,action:social==='handoff'?'handoff' as const:'edit_list' as const,expectedVersion:claimed.state.version};
          const proposed=event.type==='shopping_action'&&event.action==='new_list'&&current.lastRequestId&&claimed.memory?.sourceVersion===current.version?claimed.memory.newList:undefined;
          if(proposed&&(!claimed.memory||claimed.bindingId!==claimed.memory.id||!claimed.displayedActions.some(action=>digest(action)===digest(event))))throw new ToolError('Use the latest new-list button.','stale_question');
          if(event.type==='shopping_action'&&event.action==='next_item'&&!claimed.displayedActions.some(action=>digest(action)===digest(event)))throw new ToolError('Use the displayed next-item button.','stale_question');
          if(event.type==='shopping_action'&&event.action==='confirm_clear'&&!claimed.displayedActions.some(action=>digest(action)===digest(event)))throw new ToolError('Use the current clear-list confirmation. Your list is unchanged.','stale_confirmation');
          rich=await handleShoppingAction(client,ctx,current,event,claimed.catalogMap);
          if(event.type==='shopping_action'&&event.action==='continue_list'){const next=await this.tools.invokeInTransaction(client,ctx,{name:'preview_order',args:{expectedVersion:current.version}},claimed.id+':continue');rich=presentReply(next,next.state!);}
          if(proposed){
            const state=await loadState(client,ctx);
            const changed=await this.tools.invokeInTransaction(client,ctx,{name:'apply_draft_changes',args:{expectedVersion:state.version,operations:proposed}},claimed.id+':new-list');
            const reviewed=await this.tools.invokeInTransaction(client,ctx,{name:'preview_order',args:{expectedVersion:changed.state!.version}},claimed.id+':new-list-preview');
            rich=presentReply(reviewed,reviewed.state!);
          }
          message=rich.text;
        } else if(!failure) {
          if(current.version!==claimed.state.version) throw new ToolError('The draft changed during interpretation. Please resend against the current draft.','stale_version');
          const selectedCatalogProduct=claimed.displayedProducts.find(p=>digest(p.event)===digest(claimed.event))?.product;
          const selectedCatalogSku=(claimed.event.type==='choose_product'||claimed.event.type==='select_candidate')&&claimed.displayedActions.some(action=>digest(action)===digest(claimed.event))?claimed.event.sku:undefined;
          if(current.catalogDiscovery&&deterministic?.name==='apply_draft_changes'){
            for(const op of deterministic.args.operations){
              if(op.kind!=='add_item')continue;
              const observation=claimed.memory?.sourceVersion===current.version?claimed.memory.observations.find(o=>o.discovery&&o.products.some(p=>p.sku===op.query)):undefined;
              if(observation?.discovery){
                const eligible=await discoverProducts(client,ctx,observation.discovery.query,observation.discovery.plan);
                if(!eligible.products.some(p=>p.sku===op.query))throw new ToolError('That option no longer matches this search. Please describe the item again.','stale_confirmation');
              }
            }
          }
          if(current.lastRequestId&&claimed.event.type==='choose_product'&&selectedCatalogSku&&deterministic?.name==='apply_draft_changes'){
            const proposal=claimed.memory?.sourceVersion===current.version?claimed.memory.newList:undefined;
            let operations=deterministic.args.operations;
            if(proposal){
              if(claimed.bindingId!==claimed.memory!.id)throw new ToolError('Use the latest new-list product choices.','stale_question');
              const matches=proposal.map((item,index)=>claimed.memory!.observations.some(o=>o.query===item.query&&o.products.some(p=>p.sku===selectedCatalogSku))?index:-1).filter(index=>index>=0);
              if(matches.length!==1)throw new ToolError('Start the list to choose which requested item this product is for.','stale_question');
              operations=proposal.map((item,index)=>index===matches[0]?{...item,query:selectedCatalogSku,search:undefined}:item);
            }
            await handleShoppingAction(client,ctx,current,{id:claimed.id,type:'shopping_action',action:'new_list',expectedVersion:current.version});
            Object.assign(current,await loadState(client,ctx));
            deterministic={...deterministic,args:{...deterministic.args,operations,expectedVersion:current.version}};
          }
          const invoke=async(call:ToolCall)=>{if(current.visualOrdering&&(call.name==='submit_order_request'||call.name==='confirm_product_choices'&&current.pending?.kind==='products'&&(current.pending.completeReview||claimed.event.type!=='select_product'))){const binding=call.name==='submit_order_request'?call.args.reviewId:call.args.batchId;if(!await reviewDeliveryReady(client,ctx.conversationId,binding,claimed.event.type==='confirm'||claimed.event.type==='confirm_products',claimed.event.type==='confirm'||claimed.event.type==='confirm_products'?claimed.event.id:undefined))throw new ToolError('All review parts must be delivered before approval. Please ask to review again.','review_incomplete');}
          return this.tools.invokeInTransaction(client,{...ctx,...(call.name==='submit_order_request'&&(deterministic?.name==='submit_order_request'||explicitSend&&deterministic?.name==='confirm_product_choices')?{consentReviewId:call.args.reviewId}:{}),...(call.name==='confirm_product_choices'&&deterministic?.name==='confirm_product_choices'?{consentProductBatchId:call.args.batchId}:{}),...(selectedCatalogSku?{selectedCatalogSku,selectedCatalogProduct}:{})},call,claimed.id);};
          let result:ToolResult;
          let assistance:CatalogObservation[]|undefined;
          let assistanceLineId:string|undefined;let assistanceBindingId:string|undefined;
          const rechecking=claimed.event.type==='text'&&isRecheck(claimed.event.text);
          if(rechecking&&!quoteRecheck&&current.pending?.kind!=='products'||interpretation?.next==='assist') {
            const suggested=rechecking?recheckQueries(current,claimed.memory):interpretation!.assistance!.queries;
            const description=claimed.event.type==='text'?claimed.event.text:interpretation?.transcript??suggested[0];
            const queries=current.catalogDiscovery?(rechecking?[claimed.memory?.observations[0]?.query??suggested[0]]:[interpretation!.assistance!.rootQuery??observationQueries(description,current,claimed.memory)[0]]).filter(q=>!!q):suggested;
            const basePlan=rechecking?claimed.memory?.observations[0]?.discovery?.plan:interpretation?.assistance?.search;
            const search=current.catalogDiscovery?{...basePlan,keywords:[...new Set([...(basePlan?.keywords??[]),...suggested])].slice(0,8)}:undefined;
            assistanceLineId=rechecking?(claimed.memory?.sourceVersion===current.version?claimed.memory.lineId??undefined:pendingItem(current)?.id):interpretation!.assistance!.lineId;
            if(assistanceLineId&&pendingItem(current)?.id!==assistanceLineId&&!(current.pending?.kind==='products'&&current.pending.groups.some(g=>g.lineId===assistanceLineId)))throw new ToolError('That search refers to an earlier item. Please name the current item.','stale_question');
            assistance=await observeCatalog(client,ctx,this.tools,queries,`${claimed.id}:assist`,search);
            result={state:current,message:''};
            assistanceBindingId=await saveAssistantMemory(client,ctx,queries.length?{purpose:assistanceLineId?'pending':'discovery',queries,lineId:assistanceLineId??null,sourceVersion:current.version,requestedQuantity:rechecking?claimed.memory?.requestedQuantity:interpretation?.assistance?.quantity,requestedUnit:rechecking?claimed.memory?.requestedUnit:interpretation?.assistance?.requestedUnit,observations:assistance}:null);
          } else if(deterministic) {
            result=await invoke(deterministic);
            if(deterministic.name==='confirm_product_choices'||deterministic.name==='apply_draft_changes'&&(current.requireProductConfirmation||claimed.event.type==='select_candidate'||claimed.event.type==='choose_product'||(claimed.event.type==='text'&&claimed.state.pending?.kind==='question'))) result=await invoke({name:'preview_order',args:{expectedVersion:result.state!.version,...(deterministic.name==='confirm_product_choices'&&current.allowPartialReview&&(claimed.event.type==='confirm_products'||claimed.event.type==='text')?{allowPartial:true}:{})}});
            // Product identity approval presents the bill. Submission requires
            // another explicit consent bound to that current bill.

          }
          else if(interpretation) {
            if(interpretation.next==='price') result=await invoke({name:'search_products',args:{query:interpretation.priceQuery!,quantity:interpretation.priceQuantity,requestedUnit:interpretation.priceUnit}});
            else {
              let state=current;
              if(state.editingLineId&&interpretation.operations.length){
                const lineId=state.editingLineId;
                interpretation={...interpretation,operations:interpretation.operations.map(op=>{
                  if(op.kind==='add_item')return {kind:'resolve_line' as const,lineId,query:op.query,...(op.quantity!==null?{quantity:op.quantity}:{}),requestedUnit:op.requestedUnit,search:op.search,packSize:op.packSize,productMeasures:op.productMeasures,productIntent:op.productIntent,requestedAmount:op.requestedAmount,supportingPhrase:op.supportingPhrase};
                  if(op.kind==='resolve_line'&&op.lineId===lineId||('reference' in op&&op.reference===lineId))return op;
                  throw new ToolError('Please change only the selected item. Your other items are unchanged.');
                })};
              }
              const description=claimed.event.type==='text'?claimed.event.text:claimed.event.type==='image'?interpretation.understanding?.observedText??'':interpretation.transcript??'';
              interpretation={...interpretation,operations:bindExplicitCorrection(interpretation.operations,state,description)};
              interpretation={...interpretation,operations:interpretation.operations.map(op=>retainRefinementIdentity(op,state,description,claimed.catalogMap))};
              if((state.pending?.kind==='question'||state.pending?.kind==='products')&&interpretation.operations.some(op=>op.kind==='remove_item')){
                const removals=interpretation.operations.filter(op=>op.kind==='remove_item');
                const focused=state.pending.kind==='question'?[state.pending.lineId]:state.pending.groups.map(g=>g.lineId);
                const explicit=namedRemovalsExplicit(interpretation.operations,description,state);
                const clearThenAdd=/^clear my list[.!?,;: ]+(?:(?:yes|please|and|then) )*add\b/i.test(description)&&!negatedSpokenClear(description)&&removals.length===state.draft.length;
                if(!explicit&&!clearThenAdd&&(removals.length!==1||interpretation.operations.length!==1||!focused.includes(referenceLine(state,removals[0].reference).id)))throw new ToolError('Which item should I remove? Your list is unchanged.','correction_removal_target');
              }
              // Stable current line IDs and current-turn evidence govern edits; a pending
              // product question does not forbid explicit edits to other draft lines.
              if(state.visualOrdering)interpretation={...interpretation,operations:validateCurrentTurn(interpretation.operations,description,state)};
              if(interpretation.operations.length) state=(await invoke({name:'apply_draft_changes',args:{expectedVersion:current.version,operations:interpretation.operations}})).state!;
              result=interpretation.next==='review'||state.requireProductConfirmation&&interpretation.operations.length?await invoke({name:'preview_order',args:{expectedVersion:state.version}}):{state,message:'Draft saved; request review when ready.'};
            }
          } else throw new ToolError('No permitted action found. Review the draft or send a clear shopping request.');
          if(assistance)rich=assistance.length?assistanceReply(assistance,current,interpretation?.assistance?.question,rechecking,assistanceLineId,assistanceBindingId,{quantity:rechecking?claimed.memory?.requestedQuantity:interpretation?.assistance?.quantity,unit:rechecking?claimed.memory?.requestedUnit:interpretation?.assistance?.requestedUnit}):plainReply(say(current,'Which item would you like me to check again? Tell me its name or what you need it for.','எந்தப் பொருளை மீண்டும் பார்க்க வேண்டும்? பெயர் அல்லது என்ன வேலைக்குத் தேவை என்று சொல்லுங்கள்.','Entha porulai marubadi paarkkanum? Peyar illa enna velaikku venum-nu sollunga.'));
          else {
            if(result.products) {
              const query=deterministic?.name==='search_products'||deterministic?.name==='discover_products'?deterministic.args.query:interpretation?.priceQuery;
              const quantity=deterministic?.name==='search_products'?deterministic.args.quantity:interpretation?.priceQuantity,unit=deterministic?.name==='search_products'?deterministic.args.requestedUnit:interpretation?.priceUnit;
              if(query)result.discoveryBindingId=await saveAssistantMemory(client,ctx,{purpose:!!result.discovery||claimed.event.type==='browse'||interpretation?.conversation==='browse'?'discovery':'quote',queries:[query],lineId:null,sourceVersion:current.version,quoteQuantity:quantity,quoteUnit:unit,...(deterministic?.name==='discover_products'&&claimed.memory?.sourceVersion===current.version?{requestedQuantity:claimed.memory.requestedQuantity,requestedUnit:claimed.memory.requestedUnit}:{}),observations:[{tool:result.discovery?'discover_products':'search_products',query,products:result.products,totalCount:result.totalCount??result.products.length,discovery:result.discovery}]});
            }
            rich=presentReply(result,result.state??current,interpretation,claimed.event);replyRequest=result.request;if(result.request&&(deterministic?.name==='submit_order_request'||explicitSend&&deterministic?.name==='confirm_product_choices'))rich.stage='submitted';
            if(claimed.event.type==='text'&&canonicalShortcut(claimed.event.text)==='yes'&&deterministic?.name==='get_draft'&&claimed.memory?.sourceVersion===current.version) {
              if(claimed.memory.purpose==='quote')rich=plainReply(say(current,'That was a price check; nothing has been added. Use “Add to my list” or tell me which item and quantity you want.','அது விலை விவரம் மட்டுமே; பொருள் சேர்க்கவில்லை. “பட்டியலில் சேர்” என்பதைத் தேர்வு செய்யுங்கள் அல்லது பொருளையும் எண்ணிக்கையையும் சொல்லுங்கள்.','Athu price detail mattum; porul serkkala. “List-la seru” choose pannunga illa porulaiyum quantity-aiyum sollunga.'));
              else if(claimed.memory.observations.flatMap(o=>o.products).length>1)rich=plainReply(say(current,'Which of the options would you like? Choose a product or tell me its name; I haven’t changed your list.','எந்தப் பொருள் வேண்டும்? படத்தில் தேர்வு செய்யுங்கள் அல்லது பெயரைச் சொல்லுங்கள். உங்கள் பட்டியலில் மாற்றம் செய்யவில்லை.','Entha porul venum? Photo-la choose pannunga illa peyarai sollunga. Unga list-la maaththam seyyala.'));
            }
            if(result.state&&(interpretation?.operations.length||deterministic?.name==='apply_draft_changes'||deterministic?.name==='confirm_product_choices'||deterministic?.name==='preview_order')) {
              const line=pendingItem(result.state);
              if(line) {
                const queries=[line.query??line.name],observations=await observeCatalog(client,ctx,this.tools,queries,`${claimed.id}:remember`);
                await saveAssistantMemory(client,ctx,{purpose:'pending',queries,lineId:line.id,sourceVersion:result.state.version,observations});
              } else await saveAssistantMemory(client,ctx,null);
            }
          }
          if((interpretation?.next==='price'||deterministic?.name==='search_products')&&result.products?.length===1){
            const p=result.products[0],q=result.quote;
            const price=q?rich.text:`${productName(p,current)} — ${productPriceText(p,current)} | ${productStockText(p,current)}`;
            const requested=deterministic?.name==='search_products'?deterministic.args.quantity:interpretation?.priceQuantity;
            // Keep a conversion warning only for a requested amount that
            // cannot be quoted. A plain unit-price inquiry is independent of
            // the draft's pending product or quantity question.
            const text=!q&&requested!==undefined?rich.text:price;
            rich=current.visualOrdering?{...plainReply(text),readOnly:true}:{...rich,readOnly:true};
          }
          if(result.state&&interpretation?.operations.some(op=>op.kind==='set_amount'||op.kind==='increment_amount')){
            const edited=interpretation.operations.filter(op=>op.kind==='set_amount'||op.kind==='increment_amount').map(op=>result.state!.draft.find(l=>l.id===op.reference)).filter((l):l is import('../../../../packages/contracts/index.js').DraftLine=>!!l);
            rich.contextLines=edited.slice(0,2).map(l=>`${lineName(l,result.state!)}: ${requestedAmountText(l,result.state!)??''}${l.quantity!==null?` · ${l.quantity} ${unitName(l.unit??'unit',result.state!,l.quantity)}`:''}`);
          }
          if(interpretation?.estimateRequested&&result.state){
            const state=result.state,known=state.draft.filter(l=>l.resolution==='matched'&&l.quantity!==null&&l.pricePaise!==undefined),total=known.reduce((sum,l)=>sum+lineTotal(l.pricePaise!,l.quantity!),0),blocked=state.draft.find(l=>l.resolution!=='matched');
            rich.contextLines=[say(state,blocked?`Confirmed lines subtotal: ${formatMoney(total)}. The full estimate still needs checking.`:`Current estimate: ${formatMoney(total)}.`,blocked?`சரிபார்த்த பொருட்களின் கூட்டுத்தொகை: ${formatMoney(total)}. முழு பில் இன்னும் உறுதி செய்யணும்.`:`இப்போதைய உத்தேச மொத்தம்: ${formatMoney(total)}.`,blocked?`Check panna porutkal subtotal: ${formatMoney(total)}. Muzhu bill innum confirm pannanum.`:`Ippothaiya estimate: ${formatMoney(total)}.`),...(blocked?[`${lineName(blocked,state)}: ${requestedAmountText(blocked,state)??draftIssueText(blocked,state)??''}`]:[])];
          }
          if(claimed.event.type==='image'&&interpretation?.next==='assist')rich={...rich,text:(rich.cards?.length?say(current,'These are possible catalog matches for your photo. Check the brand, size and type before choosing.\n\n','உங்கள் படத்திற்கு பொருத்தமாக இருக்கக்கூடிய பொருட்கள் இவை. பிராண்ட், அளவு மற்றும் வகையைச் சரிபார்த்துத் தேர்வு செய்யுங்கள்.\n\n','Unga photo-ku poruthamaaga irukkakoodiya porutkal ivai. Brand, size, type-ai check panni choose pannunga.\n\n'):say(current,'I could not find a confirmed catalog match for this photo.\n\n','இந்தப் படத்திற்குச் சரியான பொருத்தத்தை உறுதி செய்ய முடியவில்லை.\n\n','Intha photo-ku sariyana match-ai confirm panna mudiyala.\n\n'))+rich.text};
          message=rich.text;
        }
        await client.query('RELEASE SAVEPOINT turn_actions');
      } catch(error) {
        await client.query('ROLLBACK TO SAVEPOINT turn_actions');
        message=customerError(error instanceof Error?error.message:'Action failed. Your draft is retained.',current,error instanceof ToolError?error.code:undefined);rich={...plainReply(message),stage:'error',clarificationReason:error instanceof ToolError?error.code:'action_failed'};
        if(current.visualOrdering&&error instanceof ToolError&&['stale_confirmation','review_incomplete'].includes(error.code)){const kept=await loadState(client,ctx);if(kept.draft.length&&!kept.lastRequestId){const renewed=await this.tools.invokeInTransaction(client,ctx,{name:'preview_order',args:{expectedVersion:kept.version}},claimed.id+':fresh-review');rich=presentReply(renewed,renewed.state!);}}
      }
      const finalState=await loadState(client,ctx);
      if(!failure&&finalState.version!==current.version&&finalState.editingLineId&&claimed.event.type!=='edit_item'){
        await client.query('UPDATE conversations SET editing_line_id=NULL WHERE id=$1',[ctx.conversationId]);finalState.editingLineId=null;
      }
      if(!finalState.visualOrdering&&!failure&&['text','voice'].includes(claimed.event.type)&&!finalState.lastRequestId&&claimed.state.draft.length&&finalState.version!==claimed.state.version){
        const added=finalState.draft.flatMap(line=>{const old=claimed.state.draft.find(l=>l.id===line.id),delta=(line.quantity??0)-(old?.quantity??0);return !old?[{line,quantity:line.quantity}]:delta>0?[{line,quantity:delta}]:[];});
        if(added.length){const details=added.map(({line,quantity})=>`${quantity??''} ${line.query??line.name}`.trim()).join(', ');const retained=claimed.state.draft.every(old=>finalState.draft.some(line=>line.id===old.id));const kept=retained?say(finalState,' Your earlier items are kept.',' முந்தைய பொருட்களும் பட்டியலில் உள்ளன.',' Munthaya porutkalum list-la irukku.'):'';rich={...rich,text:say(finalState,`Added: ${details}.`,`சேர்த்திருக்கிறேன்: ${details}.`,`Serthirukken: ${details}.`)+kept+'\n\n'+rich.text};}
      }
      if(failure&&claimed.event.type==='voice'&&voiceFailureKind==='processing'){rich.buttons=[{label:say(finalState,'Try again','மீண்டும் முயல்','Marubadi try'),event:{id:randomUUID(),type:'retry_voice',mediaId:claimed.event.mediaId,expectedVersion:finalState.version}},shoppingButton(finalState,'handoff',say(finalState,'Talk to shop','கடையிடம் பேசு','Kadaiyila pesu'))];}
      if(!failure&&!deterministic&&interpretation?.clarifyQuestion&&!interpretation.operations.length&&rich.stage!=='identify'&&rich.kind!=='product_choices'){const q=safeQuestion(interpretation.clarifyQuestion,finalState,interpretation.transcript??(claimed.event.type==='text'?claimed.event.text:''));if(q)rich={...plainReply(q),stage:'identify',clarificationReason:'intent_clarification'};}
      if(interpretation?.understanding?.inputKind==='handwritten_list'){rich={...rich,contextLines:[say(finalState,'I read your list. Please check every item, including lines marked for shop checking.','உங்கள் பட்டியலைப் படித்தேன். கடை சரிபார்க்க வேண்டிய வரிகள் உட்பட எல்லாப் பொருட்களையும் சரிபாருங்கள்.','Unga list-ai padithen. Kadai check panna vendiya varigal utpada ella porutkalaiyum check pannunga.'),...rich.contextLines??[]]};}
      if(finalState.visualOrdering&&interpretation?.shopQuestions?.length)rich.contextLines=[shopAnswers(finalState,interpretation.shopQuestions),...rich.contextLines??[]];
      if(!failure&&!interpretation?.operations.length&&(interpretation?.next==='price'||deterministic?.name==='search_products'||deterministic?.name==='discover_products'))rich.readOnly=true;
      const unclearTarget=!failure&&interpretation?.understanding?.unresolved.includes('cart_target')&&!finalState.lastRequestId;
      if(finalState.visualOrdering&&!failure&&!rich.readOnly&&!rich.handoffRequested&&!finalState.lastRequestId&&!clearConfirmation){
        const selected=claimed.event.type==='select_product'?finalState.draft.find(l=>l.id===(claimed.event as Extract<SimulatorEvent,{type:'select_product'}>).lineId):undefined;
        if(selected)rich.contextLines=[say(finalState,`Selected: ${lineName(selected,finalState)}${selected.quantity!==null?` · ${selected.quantity} ${unitName(selected.unit??'unit',finalState,selected.quantity)}`:''}.`,`${lineName(selected,finalState)} தேர்வு செய்யப்பட்டது${selected.quantity!==null?` · ${selected.quantity} ${unitName(selected.unit??'unit',finalState,selected.quantity)}`:''}.`,`${lineName(selected,finalState)} choose panniyachu${selected.quantity!==null?` · ${selected.quantity} ${unitName(selected.unit??'unit',finalState,selected.quantity)}`:''}.`),...rich.contextLines??[]];
        const newBulkList=!claimed.state.draft.length&&finalState.draft.length>1&&interpretation?.operations.some(op=>op.kind==='add_item');
        if(newBulkList){
          const rows=finalState.draft.map(line=>`${lineName(line,finalState)} — ${line.quantity===null?say(finalState,'count needed','எண்ணிக்கை தேவை','Count venum'):line.quantity}`);
          rich.contextLines=[say(finalState,`Noted all ${finalState.draft.length} requested items:\n${rows.join('\n')}`,`நீங்கள் சொன்ன ${finalState.draft.length} பொருட்களையும் குறித்துக்கொண்டேன்:\n${rows.join('\n')}`,`Neenga sonna ${finalState.draft.length} porutkalaiyum kurichchukkitten:\n${rows.join('\n')}`),...rich.contextLines??[]];
        }
      }
      if(unclearTarget){
        // The current turn's identity question supersedes an unrelated old
        // quantity question. A bare number must not answer that stale prompt.
        await client.query('UPDATE conversations SET pending=NULL,product_review=NULL,editing_line_id=NULL,assistant_memory=NULL,version=version+1 WHERE id=$1',[ctx.conversationId]);
        finalState.pending=null;finalState.productReview=null;finalState.editingLineId=null;finalState.version++;
        const requested=interpretation!.understanding!.requestedItems.find(item=>item.query)?.query??'';
        const words=tokens(requested).filter(word=>!/^(?:one|two|three|1|2)$/.test(word));
        const currentText=interpretation?.transcript??(claimed.event.type==='text'?claimed.event.text:'');
        const held=interpretation!.understanding!.proposedEdits.find(edit=>['set_quantity','increment_quantity'].includes(edit.kind)&&edit.quantity!==undefined&&currentText.includes(edit.sourceText)&&explicitPurchaseCount(edit.sourceText)===edit.quantity);
        const named=namedEditLines(held?.sourceText??currentText,finalState);
        const matching=named.length?named:finalState.draft.filter(line=>words.length&&words.every(word=>tokens([line.query,line.name].filter(Boolean).join(' ')).includes(word)));
        const explicitTotal=!held&&/(?:மொத்தம்|\b(?:total|moththam|mottam)\b)/i.test(currentText)?explicitPurchaseCount(currentText):undefined;
        const choices=matching.length>0&&matching.length<=2?matching.map(line=>{
          const count=held?.kind==='set_quantity'?held.quantity:held?.kind==='increment_quantity'&&additionalMention.test(held.sourceText)&&line.quantity!==null?line.quantity+held.quantity!:explicitTotal;
          return {label:lineName(line,finalState),event:count!==undefined&&count>0&&count<=100?{id:randomUUID(),type:'set_quantity' as const,lineId:line.id,quantity:count,expectedVersion:finalState.version}:{id:randomUUID(),type:'edit_item' as const,lineId:line.id,expectedVersion:finalState.version}};
        }):[shoppingButton(finalState,'edit_list',say(finalState,'Choose list item','பொருளைத் தேர்வு செய்','Porul choose pannu')),shoppingButton(finalState,'new_list',say(finalState,'Start new list','புதிய பட்டியல்','Pudhu list'))];
        const question=safeQuestion(interpretation?.clarifyQuestion,finalState,interpretation?.transcript??(claimed.event.type==='text'?claimed.event.text:''))??say(finalState,'Which item on your list did you mean?','பட்டியலில் எந்தப் பொருளைச் சொன்னீர்கள்?','List-la entha porulai sonneenga?');
        rich={...plainReply((digest(finalState.draft)!==digest(claimed.state.draft)?say(finalState,'Other clear changes are saved. ','மற்ற தெளிவான மாற்றங்கள் சேமிக்கப்பட்டன. ','Maththa thelivaana maaththangal save aachu. '):'')+question+' '+say(finalState,'Choose the item below or describe its type. Your list is kept.','கீழே தேர்வு செய்யுங்கள் அல்லது பொருளின் வகையைச் சொல்லுங்கள். பட்டியல் அப்படியே உள்ளது.','Keezhe choose pannunga illa type sollunga. List appadiye irukku.')),stage:'identify',clarificationReason:'intent_clarification',buttons:choices};
      }
      rich=unclearTarget||clearConfirmation?{...rich,replyLanguage:finalState.replyLanguage??'en'}:shoppingActions({...rich,replyLanguage:finalState.replyLanguage??'en'},finalState,claimed.catalogMap);
      if(claimed.catalogMap)rich={...rich,storeName:claimed.catalogMap.store.name};
      if(interpretation?.understanding?.unresolved.includes('validation_recovery')&&interpretation.transcript)rich.contextLines=[say(finalState,`Heard: ${interpretation.transcript.slice(0,250)}`,`கேட்டது: ${interpretation.transcript.slice(0,250)}`,`Kettathu: ${interpretation.transcript.slice(0,250)}`),...rich.contextLines??[]];
      if(replyRequest?.advanceRequired&&this.options.advance&&!rich.readOnly)rich=await upiAdvanceReply(client,ctx,finalState,this.options.advance.hostname,{demoPayAtShop:this.options.advance.demoPayAtShop,onlyOnce:true})??rich;
      rich=materializeVisualReply({...visualReply(rich,finalState,replyRequest),storeName:claimed.catalogMap?.store.name});
      message=rich.text;
      if(finalState.visualOrdering){const binding=conversationBinding(finalState,await loadAssistantMemory(client,ctx));const cancelled=await client.query("UPDATE whatsapp_outbox o SET state='cancelled',last_error='review_superseded' WHERE o.conversation_id=$1 AND o.state='queued' AND o.sender_kind='assistant' AND EXISTS(SELECT 1 FROM whatsapp_actions a WHERE a.message_id=o.message_id AND (a.source_version<>$2 OR a.binding_id IS DISTINCT FROM $3::uuid)) RETURNING o.message_id",[ctx.conversationId,finalState.version,binding]);if(cancelled.rowCount)await client.query("UPDATE messages SET status='cancelled' WHERE id=ANY($1::uuid[])",[cancelled.rows.map(r=>r.message_id)]);}
      const replyId=randomUUID();
      const parts=rich.parts??[undefined];
      for(const [index,part] of parts.entries()){
        const id=index===0?replyId:randomUUID();
        const payload=part?{...rich,text:part.text,parts:[part],groupId:replyId,partIndex:index,partCount:parts.length}:rich;
        await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,response_to,payload,reply_group_id,part_index,part_count,stage,clarification_reason) VALUES($1,$2,'outbound',$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)",[id,ctx.conversationId,payload.text,this.options.queueReply?'queued':'sent',claimed.id,JSON.stringify(payload),replyId,index,parts.length,rich.stage??null,rich.clarificationReason??null]);
        await client.query('UPDATE messages SET release_fingerprint=$1 WHERE id=$2',[currentReleaseFingerprint(),id]);
        await this.options.queueReply?.(client,ctx,id,payload);
      }

      if(rich.stage==='welcome'&&this.options.welcomeAudio){
        const queued=await client.query('UPDATE conversations SET welcome_audio_queued=true WHERE id=$1 AND NOT welcome_audio_queued RETURNING id',[ctx.conversationId]);
        if(queued.rowCount){
          const id=randomUUID(),audio:RichReply={...plainReply(customerCopy('welcome',finalState)),readOnly:true,audio:{url:this.options.welcomeAudio},replyLanguage:finalState.replyLanguage};
          await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload,stage) VALUES($1,$2,'outbound',$3,$4,$5::jsonb,'welcome')",[id,ctx.conversationId,audio.text,this.options.queueReply?'queued':'sent',JSON.stringify(audio)]);
          await client.query('UPDATE messages SET release_fingerprint=$1 WHERE id=$2',[currentReleaseFingerprint(),id]);
          await this.options.queueReply?.(client,ctx,id,audio);
        }
      }
      if(Date.now()>=claimed.deadlineAt){
        // Rendering and outbox work also consume the turn budget. Undo their
        // transaction's shopping effects; inference accounting was committed
        // separately and must remain intact.
        await client.query('ROLLBACK TO SAVEPOINT turn_effects');
        if(!(await client.query("SELECT 1 FROM messages WHERE id=$1 AND claim_token=$2 AND status='processing' AND lease_until>clock_timestamp()",[claimed.id,claimed.token])).rowCount)return;
        const retained={...plainReply(say(claimed.state,'The turn deadline was reached. Your list is retained. Please try again or ask the shop for help.','செயலாக்க நேரம் முடிந்தது. உங்கள் பட்டியல் அப்படியே உள்ளது. மீண்டும் முயலுங்கள் அல்லது கடையிடம் உதவி கேளுங்கள்.','Processing neram mudinjathu. Unga list appadiye irukku. Marubadi try pannunga illa kadaiyidam help kelunga.')),replyLanguage:claimed.state.replyLanguage??'en',stage:'error' as const,clarificationReason:'turn_deadline'};
        const id=randomUUID();
        await client.query("INSERT INTO messages(id,conversation_id,direction,text,status,response_to,payload,stage,clarification_reason) VALUES($1,$2,'outbound',$3,$4,$5,$6::jsonb,'error','turn_deadline')",[id,ctx.conversationId,retained.text,this.options.queueReply?'queued':'sent',claimed.id,JSON.stringify(retained)]);
        await client.query('UPDATE messages SET release_fingerprint=$1 WHERE id=$2',[currentReleaseFingerprint(),id]);
        await this.options.queueReply?.(client,ctx,id,retained);
      }
      await client.query("UPDATE messages SET status='processed',reply_decision='reply',claim_token=NULL,lease_until=NULL WHERE id=$1",[claimed.id]);
    });
    return true;
  }
  private knownAction(claim:Claimed):ToolCall|undefined {
    const e=claim.event,s=claim.state;
    if(e.type==='review_partial')return {name:'preview_order',args:{expectedVersion:e.expectedVersion,allowPartial:true}};
    if(e.type==='shopping_action'&&e.action==='finish_order'){if(e.expectedVersion!==s.version)throw new ToolError('Use the latest list before sending.','stale_version');return this.knownAction({...claim,event:{id:e.id,type:'text',text:'send it'}});}
    if(e.type==='shopping_action'&&e.action==='handoff')return {name:'request_store_assistance',args:{expectedVersion:e.expectedVersion}};
    if(e.type==='shopping_action'&&e.action==='status'){if(e.expectedVersion!==s.version)throw new ToolError('Use the latest request status choice.','stale_version');return {name:'get_order_status',args:{}};}
    if(e.type==='text'&&s.editingLineId){const amount=quantityReply(canonicalShortcut(e.text));if(amount)return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[quantityAnswer(s,s.editingLineId,amount,e.text)]}};}
    if(e.type==='refine_discovery'){const memory=claim.memory,result=memory?.observations.find(o=>o.discovery)?.discovery;if(!memory||memory.id!==e.memoryId||memory.sourceVersion!==s.version||!result)throw new ToolError('That search question is no longer current.','stale_question');return {name:'discover_products',args:{query:result.query,search:refinementPlan(result,e.facet,e.value)}};}
    if(e.type==='refine_search'){const check=s.pending,group=check?.kind==='products'&&check.id===e.batchId&&check.version===s.version?check.groups.find(g=>g.lineId===e.lineId):undefined;if(!group?.discovery)throw new ToolError('That category or brand question is no longer current.','stale_question');const line=s.draft.find(l=>l.id===e.lineId)!;if(line.productIntent?.kind==='ambiguous'){if(e.facet!=='family'||Date.parse(check?.kind==='products'?check.expiresAt:'')<=Date.now())throw new ToolError('Use the latest product-type choices.','stale_question');const meaning=line.productIntent.alternatives?.find(a=>a.familyId===e.value);if(!meaning)throw new ToolError('Choose one of the displayed product types.','stale_question');return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:e.lineId,query:meaning.query,search:{keywords:[meaning.query],familyId:meaning.familyId}}]}};}return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:e.lineId,query:line.query??line.name,search:refinementPlan(group.discovery,e.facet,e.value)}]}};}
    if(e.type==='select_product'||e.type==='confirm_products') {
      const pending=s.pending;
      if(pending?.kind!=='products'||pending.id!==e.batchId||pending.version!==s.version)throw new ToolError('That product check is no longer current. Review your list again.','stale_confirmation');
      if(s.visualOrdering&&e.type==='confirm_products'&&!productCheckCoversDraft(s,pending)&&!(s.allowPartialReview&&pending.groups.length&&pending.groups.every(g=>g.products.length===1&&s.draft.find(l=>l.id===g.lineId)?.sku===g.products[0].sku)))throw new ToolError('Some requested items still need checking.');
      if(e.type==='confirm_products'&&pending.groups.some(g=>g.products.length!==1&&!(s.catalogDiscovery&&s.draft.some(l=>l.id===g.lineId&&g.products.some(p=>p.sku===l.sku)))))throw new ToolError('Choose the correct option for each requested item first.');
      return {name:'confirm_product_choices',args:{batchId:e.batchId,choices:e.type==='select_product'?[{lineId:e.lineId,sku:e.sku}]:pending.groups.map(g=>({lineId:g.lineId,sku:s.catalogDiscovery?s.draft.find(l=>l.id===g.lineId)?.sku??g.products[0].sku:g.products[0].sku}))}};
    }
    if(e.type==='browse'){if(e.expectedVersion!==s.version)throw new ToolError('Your list changed. Please try again.');const department=claim.catalogMap?.departments.find(d=>d.id===e.query);const family=claim.catalogMap?.departments.flatMap(d=>d.families).find(f=>f.id===e.query);return s.catalogDiscovery?{name:'discover_products',args:{query:department?.label??family?.label??e.query,search:department?{keywords:[department.label],departmentId:department.id}:family?{keywords:[family.label],familyId:family.id}:undefined}}:{name:'search_products',args:{query:e.query}};}
    if(e.type==='quote_product'){if(e.expectedVersion!==s.version)throw new ToolError('Your list changed. Please check the current prices again.');return {name:'search_products',args:{query:e.sku,quantity:e.quantity,requestedUnit:e.requestedUnit}};}
    if(e.type==='choose_product'){
      const remembered=claim.memory?.sourceVersion===s.version&&claim.memory.purpose==='discovery'&&claim.memory.observations.some(o=>o.products.some(p=>p.sku===e.sku))&&claim.displayedActions.some(action=>digest(action)===digest(e))?claim.memory:undefined;
      return {name:'apply_draft_changes',args:{expectedVersion:e.expectedVersion,operations:[{kind:'add_item',query:e.sku,quantity:e.quantity??remembered?.requestedQuantity??null,...(remembered?.requestedUnit?{requestedUnit:remembered.requestedUnit}:{})}]}};
    }
    if(e.type==='add_item') return {name:'apply_draft_changes',args:{expectedVersion:e.expectedVersion,operations:[{kind:'add_item',query:e.sku,quantity:e.quantity}]}};
    if(e.type==='set_quantity') return {name:'apply_draft_changes',args:{expectedVersion:e.expectedVersion,operations:[e.quantity===0?{kind:'remove_item',reference:e.lineId}:{kind:'set_quantity',reference:e.lineId,quantity:e.quantity}]}};
    if(e.type==='review') return {name:'preview_order',args:{expectedVersion:e.expectedVersion}};
    if(e.type==='choose_pipe_type'){
      if(s.pending?.kind!=='question'||s.pending.id!==e.questionId||s.pending.lineId!==e.lineId||s.pending.version!==s.version||!claim.displayedActions.some(action=>digest(action)===digest(e)))throw new ToolError('Use the current pipe-type choices. Your list is kept.','stale_question');
      return {name:'apply_draft_changes',args:{expectedVersion:e.expectedVersion,operations:[{kind:'resolve_line',lineId:e.lineId,query:{pvc:'PVC pipe',hose:'garden hose',pump:'water pumping pipe'}[e.pipeType]}]}};
    }
    if(e.type==='confirm') return {name:'submit_order_request',args:{reviewId:e.reviewId}};
    if(e.type==='select_candidate') {
      const line=s.draft.find(l=>l.id===e.lineId),pending=s.pending;
      const searched=claim.memory?.lineId===e.lineId&&claim.memory.sourceVersion===s.version&&claim.memory.observations.some(o=>o.products.some(p=>p.sku===e.sku));
      if(pending?.kind==='products'&&pending.id===e.questionId&&pending.version===s.version&&pending.groups.some(g=>g.lineId===e.lineId)&&searched&&claim.displayedActions.some(action=>digest(action)===digest(e)))return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:e.lineId,query:e.sku}]}};
      if(!pending||pending.kind!=='question'||pending.id!==e.questionId||pending.version!==s.version||pending.lineId!==e.lineId||(!line?.candidates?.some(p=>p.sku===e.sku)&&!searched)) throw new ToolError('This candidate choice is stale or does not belong to the pending question.');
      return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:e.lineId,query:e.sku}]}};
    }
    if(e.type!=='text') return;
    const text=canonicalShortcut(e.text);
    if(text==='send it'&&s.visualOrdering&&!s.lastRequestId){
      if(s.pending?.kind==='products'){
        if(claim.bindingId!==s.pending.id&&!(claim.memory?.purpose==='quote'&&claim.memory.sourceVersion===s.version&&claim.bindingId===claim.memory.id)||s.pending.version!==s.version||Date.parse(s.pending.expiresAt)<=Date.now())throw new ToolError('Use the current product review before sending.','stale_confirmation');
        if(!productCheckCoversDraft(s,s.pending)){
          if(s.allowPartialReview&&s.pending.groups.length&&s.pending.groups.every(g=>g.products.length===1&&s.draft.find(l=>l.id===g.lineId)?.sku===g.products[0].sku))return {name:'confirm_product_choices',args:{batchId:s.pending.id,choices:s.pending.groups.map(g=>({lineId:g.lineId,sku:g.products[0].sku}))}};
          return {name:'preview_order',args:{expectedVersion:s.version,allowPartial:s.allowPartialReview}};
        }
        return {name:'confirm_product_choices',args:{batchId:s.pending.id,choices:s.pending.groups.map(g=>({lineId:g.lineId,sku:s.draft.find(l=>l.id===g.lineId)?.sku??g.products[0].sku}))}};
      }
      if(s.pending?.kind==='question'&&s.draft.length)return {name:'preview_order',args:{expectedVersion:s.version}};
      if(!s.pending&&s.draft.length)return {name:'preview_order',args:{expectedVersion:s.version}};
    }
    if(['bill','invoice','estimated bill','estimate','show bill','bill evvalavu','பில் எவ்வளவு','பில் காட்டு','உத்தேச பில்'].includes(text))return s.lastRequestId?{name:'get_order_status',args:{}}:{name:'estimate_order',args:{expectedVersion:s.version}};
    if(text==='edit my list')return {name:'get_draft',args:{}};
    // Text channels can select a code that the backend actually displayed.
    // Never treat an arbitrary model-proposed or stale SKU as trusted consent.
    const code=e.text.trim().toLowerCase();
    if(s.pending?.kind==='products'&&claim.bindingId===s.pending.id){
      const choices=s.pending.groups.flatMap(g=>g.products.filter(p=>p.sku.toLowerCase()===code).map(p=>({lineId:g.lineId,sku:p.sku})));
      if(choices.length===1)return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:choices[0].lineId,query:choices[0].sku}]}};
    }
    if(claim.memory?.purpose==='discovery'&&claim.memory.sourceVersion===s.version&&claim.bindingId===claim.memory.id){
      const found=[...new Map(claim.memory.observations.flatMap(o=>o.products).filter(p=>p.sku.toLowerCase()===code).map(p=>[p.sku,p])).values()];
      if(found.length===1)return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'add_item',query:found[0].sku,quantity:claim.memory.requestedQuantity??null,...(claim.memory.requestedUnit?{requestedUnit:claim.memory.requestedUnit}:{})}]}};
    }
    if(isRecheck(e.text)) {
      if(claim.bindingId&&claim.bindingId!==conversationBinding(s,claim.memory))throw new ToolError('That recheck referred to an earlier question. Please name the current item; your list is unchanged.','stale_question');
      if(claim.memory?.purpose==='quote'&&claim.memory.sourceVersion===s.version)return {name:'search_products',args:{query:claim.memory.queries[0],quantity:claim.memory.quoteQuantity,requestedUnit:claim.memory.quoteUnit}};
      if(s.pending?.kind==='products')return {name:'preview_order',args:{expectedVersion:s.version}};
      return {name:'get_draft',args:{}};
    }
    const remembered=claim.memory?.sourceVersion===s.version&&claim.memory.purpose==='discovery'?claim.memory.observations.find(o=>o.discovery)?.discovery:undefined;
    const filter=remembered?.facets[0]?.values.find(v=>v.value.toLowerCase()===text||v.label.toLowerCase()===text||Object.values(v.localNames??{}).some(n=>n?.toLowerCase()===text));
    if(filter){if(claim.bindingId!==claim.memory!.id)throw new ToolError('That filter answer was for an earlier search.','stale_question');return {name:'discover_products',args:{query:remembered!.query,search:refinementPlan(remembered!,remembered!.facets[0].key,filter.value)}};}
    const quote=priceInquiry(e.text);if(quote){
      if(/^(?:this|that|it|this item|that item|இதன்|இது|இந்த பொருள்|இந்தப் பொருள்)$/i.test(quote.query)){
        const focused=s.editingLineId??(s.pending?.kind==='question'?s.pending.lineId:undefined),lines=focused?s.draft.filter(l=>l.id===focused):s.draft.filter(l=>!!l.sku);
        if(lines.length!==1||!lines[0].sku)return;
        return {name:'search_products',args:{...quote,query:lines[0].sku}};
      }
      return {name:'search_products',args:quote};
    }
    if(['review','checkout','enough',"that's all",'view cart','cart'].includes(text)) return {name:'preview_order',args:{expectedVersion:s.version}};
    if(['my orders','order status','status'].includes(text)) return {name:'get_order_status',args:{}};
    const amount=quantityReply(text);
    const shortAnswer=!!amount||/^(?:(?:remove|drop|delete) (?:it|this|that)(?: item)?|(?:the )?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?: one)?)$/.test(text);
    if(shortAnswer&&claim.bindingId&&claim.bindingId!==conversationBinding(s,claim.memory))throw new ToolError('That answer was for an earlier question. Please answer the current product question; your list is unchanged.','stale_question');
    if(['clear my list','clear the list','empty my list'].includes(text))return s.draft.length?{name:'apply_draft_changes',args:{expectedVersion:s.version,operations:s.draft.map(l=>({kind:'remove_item',reference:l.id}))}}:{name:'get_draft',args:{}};
    if(s.pending?.kind==='products'&&['yes','confirm','add these','add these items','add this','add this item','add to my list','add to list','add to catalog','add these to my list','yes add these','yes add these items','yes add to my list','add into catalog','add into the catalog','add to the catalog'].includes(text)&&claim.bindingId!==s.pending.id&&!(claim.memory?.sourceVersion===s.version&&claim.memory.purpose!=='pending'))throw new ToolError('That answer was for an earlier product check. Please use the current choices.','stale_question');
    if(s.pending?.kind==='products'&&claim.bindingId===s.pending.id) {
      const check=s.pending;
      const matching=check.groups.flatMap(g=>(g.discovery?.facets[0]?.values??[]).filter(v=>v.value.toLowerCase()===text||v.label.toLowerCase()===text||Object.values(v.localNames??{}).some(n=>n?.toLowerCase()===text)).map(v=>({group:g,value:v})));
      if(matching.length===1){if(claim.bindingId!==check.id)throw new ToolError('That answer was for an earlier category question.','stale_question');const m=matching[0],line=s.draft.find(l=>l.id===m.group.lineId)!;return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:line.id,query:line.query??line.name,search:refinementPlan(m.group.discovery!,m.group.discovery!.facets[0].key,m.value.value)}]}};}
      if(s.visualOrdering&&['yes','confirm','add these items','add these','add to my list'].includes(text)&&!productCheckCoversDraft(s,check))throw new ToolError('Some requested items still need checking.');
      if(['yes','confirm','add these','add these items','add this','add this item','add to my list','add to list','add to catalog','add these to my list','yes add these','yes add these items','yes add to my list','add into catalog','add into the catalog','add to the catalog'].includes(text)) {
        if(claim.bindingId!==check.id)throw new ToolError('That answer was for an earlier product check. Please use the current choices.','stale_question');
        if(check.groups.some(g=>g.products.length!==1&&!(s.catalogDiscovery&&s.draft.some(l=>l.id===g.lineId&&g.products.some(p=>p.sku===l.sku)))))throw new ToolError('Which option did you mean? Please choose the product for each item from the photos. Nothing has been sent to the shop.');
        return {name:'confirm_product_choices',args:{batchId:check.id,choices:check.groups.map(g=>({lineId:g.lineId,sku:s.catalogDiscovery?s.draft.find(l=>l.id===g.lineId)?.sku??g.products[0].sku:g.products[0].sku}))}};
      }
      if(amount) {
        const targets=check.groups.filter(g=>!amount.unit||g.products.every(p=>sameUnit(amount.unit!,p.unit)||normalizeUnit(amount.unit!)==='container'&&p.sellingUnitVerified&&['can','tin','bucket','box','bottle','pack'].includes(p.unit)));
        if(targets.length!==1)throw new ToolError('Which item is that quantity for? Include the product name, or choose its photo first.');
        return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[quantityAnswer(s,targets[0].lineId,amount,e.text)]}};
      }
    }
    if(['yes','confirm','place order','send it'].includes(text)) {
      const found=[...new Map((claim.memory?.sourceVersion===s.version?claim.memory.observations:[]).flatMap(o=>o.products).map(p=>[p.sku,p])).values()];
      if(text!=='send it'&&claim.memory?.sourceVersion===s.version&&claim.memory.purpose==='quote')return {name:'get_draft',args:{}};
      if(text==='yes'&&claim.memory?.purpose==='discovery'&&found.length===1) {
        if(claim.bindingId!==claim.memory.id)throw new ToolError('That answer was for an earlier option. Please choose the current product; your list is unchanged.','stale_question');
        return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'add_item',query:found[0].sku,quantity:claim.memory.requestedQuantity??null,...(claim.memory.requestedUnit?{requestedUnit:claim.memory.requestedUnit}:{})}]}};
      }
      if(claim.memory?.sourceVersion===s.version&&claim.memory.purpose==='discovery')return {name:'get_draft',args:{}};
      if(s.pending?.kind==='review')return {name:'submit_order_request',args:{reviewId:text==='send it'&&claim.memory?.purpose==='quote'&&claim.memory.sourceVersion===s.version&&claim.bindingId===claim.memory.id?s.pending.id:claim.bindingId??'00000000-0000-4000-8000-000000000000'}};
      if(s.pending?.kind==='question'&&conversationBinding(s,claim.memory)===claim.bindingId&&s.pending.version===s.version){const pending=s.pending;const line=s.draft.find(l=>l.id===pending.lineId);
        if(text==='yes'&&line&&!line.sku&&(line.resolution==='needs_choice'||line.resolution==='unavailable')&&claim.memory?.lineId===line.id&&found.length===1)return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:line.id,query:found[0].sku}]}};
        if(claim.memory?.lineId===line?.id&&found.length>1)return {name:'get_draft',args:{}};
        if(line?.resolution==='needs_choice'&&line.candidates?.length===1)return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:line.id,query:line.candidates[0].sku}]}};
      }
      return {name:'get_draft',args:{}};
    }
    if(s.pending?.kind==='question'&&conversationBinding(s,claim.memory)===claim.bindingId&&s.pending.version===s.version&&(!claim.memory||claim.memory.purpose==='pending')) {
      const pendingQuestion=s.pending;
      const pendingLine=s.draft.find(l=>l.id===pendingQuestion.lineId);
      if(/^(?:remove|drop|delete) (?:it|this|that)(?: item)?$/.test(text))return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'remove_item',reference:pendingLine!.id}]}};
      if(amount&&pendingLine&&(pendingLine.resolution==='needs_quantity'||pendingLine.resolution==='needs_unit')) {
        if(pendingLine.resolution==='needs_unit'&&!amount.unit)return {name:'get_draft',args:{}};
        return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[quantityAnswer(s,pendingLine.id,amount,e.text)]}};
      }
      if(/^(one|two|three|four|five|six|seven|eight|nine|ten)$/.test(text)&&pendingLine?.resolution==='needs_choice')return {name:'get_draft',args:{}};
      // A bare number answers a quantity question; it is not a catalog choice.
      if(pendingLine?.resolution==='needs_quantity'&&/^\d+(?:\.\d+)?$/.test(text))return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:pendingLine.id,quantity:Number(text)}]}};
      const ordinal=/^(?:the )?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|10|[1-9])(?: one)?$/.exec(text);
      if(ordinal&&pendingLine?.resolution==='needs_choice') {
        const n=({first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,ninth:9,tenth:10} as Record<string,number>)[ordinal[1]]??Number(ordinal[1]);
        const question=s.pending;
        const line=s.draft.find(l=>l.id===question.lineId),product=line?.candidates?.[n-1];
        if(product) return {name:'apply_draft_changes',args:{expectedVersion:s.version,operations:[{kind:'resolve_line',lineId:line!.id,query:product.sku}]}};
        throw new ToolError('That numbered choice is not in the current candidate list.');
      }
    }
    if(/^(?:the )?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|10|[1-9])(?: one)?$/.test(text)) throw new ToolError('That choice is not bound to the current question. Use the current choices or describe the product.');
    return undefined;
  }
  private async interpret(ctx:ActorContext,claim:Claimed):Promise<Interpretation> {
    const recent=(await this.pool.query("SELECT direction,left(text,500) AS text FROM messages WHERE conversation_id=$1 AND created_at>=coalesce((SELECT session_started_at FROM conversations WHERE id=$1),'-infinity'::timestamptz) AND (status='processed' OR direction='outbound' AND status IN ('sent','accepted','delivered','read')) ORDER BY sequence DESC LIMIT 8",[ctx.conversationId])).rows.reverse();
    const voice=claim.event.type==='voice',image=claim.event.type==='image';
    if(image&&!this.provider.supportsImages)throw new ToolError('Image input is not configured. Please describe the item.');
    if(voice&&!this.provider.supportsAudio)throw new ToolError('Voice input is not configured. Please type your request.');
    const audio=voice?await loadVoice(this.pool,ctx,(claim.event as Extract<SimulatorEvent,{type:'voice'}>).mediaId):undefined;
    if(audio&&audio.sourceVersion!==claim.state.version)throw new ToolError('That voice note belongs to an earlier product question. Please record the current request again.','stale_version');
    const photo=image?await loadImage(this.pool,ctx,(claim.event as Extract<SimulatorEvent,{type:'image'}>).mediaId):undefined;
    if(photo&&photo.sourceVersion!==claim.state.version)throw new ToolError('That photo belongs to an earlier product question. Please send the current photo again.','stale_version');
    let transcript:string|undefined;
    if(voice&&!this.provider.unifiedUnderstanding){
      // Recognition sees only the newly received audio. Keep the validated
      // transcript in its own durable ledger stage before any shopping plan.
      let recognized:Interpretation;
      try{recognized=await this.callProvider(ctx,claim,{text:'Transcribe the new recording',audio,state:claim.state},'recognize');}
      catch(error){const status=typeof error==='object'&&error!==null&&'status' in error?error.status:undefined;if(![502,503,504].includes(Number(status)))throw error;recognized=await this.callProvider(ctx,claim,{text:'Transcribe the new recording',audio,state:claim.state},'recognize');}
      transcript=recognized.transcript?.trim();
      if(!transcript)throw new ToolError('No clear speech was recognized. Record again or type your request.','voice_unreadable');
      const command=spokenClearCommand(transcript)??canonicalShortcut(transcript);
      if(negatedSpokenClear(transcript))return {operations:[],next:'continue',transcript,conversation:'pause'};
      if(languageRequest(transcript))return {operations:[],next:'continue',transcript};
      if(submissionIntent(transcript)||['yes','confirm','send it','place order','review','checkout','enough','bill','estimated bill','estimate','show bill','bill evvalavu','பில் எவ்வளவு','பில் காட்டு'].includes(command)||socialIntent(transcript)==='handoff')return {operations:[],next:'continue',transcript};
      if(['clear my list','clear the list','empty my list','edit my list','my orders','order status','status'].includes(command)||quantityReply(command)||/^(?:remove|drop|delete) (?:it|this|that)(?: item)?$/.test(command))return {operations:[],next:'continue',transcript};
    }
    let text=claim.event.type==='text'?claim.event.text:claim.event.type==='image'?(claim.event.caption||'Find catalog products like the uploaded photo'):transcript??'Understand the current recording';
    const observations=image?[]:await withConversation(this.pool,ctx,async client=>observeCatalog(client,ctx,this.tools,observationQueries(text,claim.state,claim.memory),`${claim.id}:observe`));
    const input={history:recent,text,audio:this.provider.unifiedUnderstanding?audio:undefined,image:photo,state:claim.state,catalog:claim.catalog,catalogMap:claim.catalogMap,assistantMemory:claim.memory,observations};
    let identified=await this.callProvider(ctx,claim,input,'identify');
    if(voice){transcript=this.provider.unifiedUnderstanding?identified.transcript:transcript;if(!transcript)throw new ToolError('No clear speech was recognized. Record again or type your request.','voice_unreadable');identified={...identified,transcript};text=transcript;}
    if(image&&identified.understanding?.inputKind==='handwritten_list')text=identified.understanding.observedText??text;
    if(claim.state.visualOrdering&&(!image||identified.understanding?.inputKind==='handwritten_list'))identified=normalizeAmountEdits(identified,text,claim.state);
    if(claim.state.visualOrdering&&(!image||identified.understanding?.inputKind==='handwritten_list')&&identified.operations.length){
      let feedback:string|undefined;
      try{identified={...identified,operations:validateCurrentTurn(identified.operations,text,claim.state)};}
      catch(error){feedback=error instanceof Error?error.message:'Use exact current-message evidence.';}
      const recovery:CatalogObservation[]=[];
      // Resolve each inferred item separately after language interpretation.
      // A failed whole-paragraph search never proves an item is absent.
      if(!feedback)await withConversation(this.pool,ctx,async client=>{
        for(const op of identified.operations){
          if((op.kind!=='add_item'&&op.kind!=='resolve_line')||!op.query||op.productIntent?.kind!=='inferred'||!op.search?.familyId)continue;
          const found=await lookupGroundedProducts(client,ctx,op.query,op.search);
          if(found.products.length)continue;
          const family=claim.catalogMap?.departments.flatMap(d=>d.families).find(f=>f.id===op.search!.familyId);
          if(!family)continue;
          const candidates=await lookupGroundedProducts(client,ctx,family.label,{...op.search,keywords:[family.label]});
          if(candidates.products.length)recovery.push({tool:'discover_products',query:op.query,products:candidates.products,totalCount:candidates.totalCount,discovery:candidates});
          if(recovery.length===3)break;
        }
      });
      if(recovery.length)feedback='The inferred search wording found no SKU. The backend retrieved these real products in the proposed family with the same brand/specification filters. Repair only those search terms using the actual names/SKUs. Preserve every other item, count, explicit brand, dimensions and verbatim evidence. These are photo-check suggestions, not approval.';
      if(feedback){
        if(image)throw new ToolError('Some list details need checking. Please correct the unclear lines or ask the shop.','interpretation_evidence');
        const repaired=await this.callProvider(ctx,claim,{...input,text,audio:undefined,image:undefined,observations:recovery.length?recovery:input.observations,proposal:identified,planningFeedback:feedback,repairSourceKind:voice?'audio':'text'},'repair');
        const normalized=normalizeAmountEdits(repaired,text,claim.state);
        identified={...normalized,...(voice?{transcript}:{}),operations:validateCurrentTurn(normalized.operations,text,claim.state)};
      }
    }
    const mediaRecommendations=!!this.options.mediaRecommendations&&(voice||image);
    // Single spoken requests start with grounded choices, not an assumed cart selection.
    // Quantity corrections and multi-item lists keep their existing explicit flows.
    if(!claim.state.visualOrdering&&mediaRecommendations&&voice&&identified.operations.length===1&&identified.operations[0].kind==='add_item'&&(claim.state.lastRequestId||!claim.state.pending&&!claim.state.editingLineId)){
      const item=identified.operations[0],exploring=!claim.state.lastRequestId&&claim.memory?.purpose==='discovery'&&claim.memory.sourceVersion===claim.state.version;
      identified={operations:[],next:'assist',transcript:identified.transcript,assistance:{rootQuery:item.query,queries:[item.query],search:item.search,...discoverySelection(item,identified.transcript??'',exploring?claim.memory:null),question:identified.clarifyQuestion}};
    }
    const newList=mediaRecommendations&&claim.state.lastRequestId&&identified.operations.length>1&&identified.operations.every(op=>op.kind==='add_item')?identified.operations as NonNullable<AssistantMemory['newList']>:undefined;
    if(this.provider.unifiedUnderstanding&&(await this.pool.query('SELECT count(*)::int AS calls FROM provider_attempts WHERE message_id=$1',[claim.id])).rows[0].calls>=2)return identified;
    if(identified.next!=='assist'&&!newList||!(mediaRecommendations||(this.options.discoveryStages??(!!this.provider.freeQuota&&claim.event.type==='text'))))return identified;
    const recommendationItems=newList&&(this.options.sequentialItems)?newList.slice(0,1):newList;
    const plan=newList?{queries:recommendationItems!.slice(0,3).map(item=>item.query)}:identified.assistance!;
    const fresh=await withConversation(this.pool,ctx,async client=>{
      if(!newList)return observeCatalog(client,ctx,this.tools,plan.queries,`${claim.id}:recommend-observe`,plan.search);
      const observations:CatalogObservation[]=[];
      for(const [index,item] of recommendationItems!.slice(0,3).entries())observations.push(...await observeCatalog(client,ctx,this.tools,[item.query],`${claim.id}:recommend-list:${index}`,item.search));
      return observations;
    });
    try{
      const proposal=newList?{operations:[],next:'assist' as const,assistance:plan}:identified;
      const recommended=await this.callProvider(ctx,claim,{...input,audio:undefined,image:undefined,text:identified.transcript??text,proposal,observations:fresh},'recommend');
      if(recommended.operations.length||recommended.next!=='assist')return identified;
      const available=new Set(fresh.flatMap(o=>o.products).map(p=>p.sku));
      const selection=recommended.assistance?.search?.selectedSkus??recommended.assistance?.search?.preferredSkus;
      const skus=selection?.filter(sku=>available.has(sku)).slice(0,4);
      if(newList)return {...identified,clarifyQuestion:recommended.assistance?.question??identified.clarifyQuestion,operations:newList.map(item=>{
        const preferredSkus=skus?.filter(sku=>fresh.some(o=>o.query===item.query&&o.products.some(p=>p.sku===sku)));
        // Only constrain lines actually assessed by this stage; an empty selection
        // is an explicit rejection, not permission to repopulate the carousel.
        return preferredSkus!==undefined&&recommendationItems?.includes(item)?{...item,search:{keywords:item.search?.keywords??[item.query],...item.search,preferredSkus,selectedSkus:preferredSkus}}:item;
      })};
      return {...identified,assistance:{...plan,question:recommended.assistance?.question??plan.question,search:{keywords:plan.search?.keywords??plan.queries,...plan.search,...(skus!==undefined?{preferredSkus:skus,selectedSkus:skus}:{})}}};
    }catch(error){if(error instanceof DeferredRecommendation)throw error;return identified;}
  }
  private async callProvider(ctx:ActorContext,claim:Claimed,input:InterpretationInput,stage:'recognize'|'identify'|'repair'|'recommend'):Promise<Interpretation> {
    input={...input,stage:stage==='repair'?'identify':stage};
    const provider=stage==='recognize'?(this.provider.recognitionProviderFor?.(input)??this.provider.recognitionProvider??this.provider):this.provider;
    if(provider.mode==='live'&&!(provider.freeQuota?this.options.allowFreeInference:this.options.allowPaidInference))throw new ToolError('This inference stage is not authorized.');
    if(providerCallTimeout(input,claim.deadlineAt-Date.now())<=inferenceTiming.sdkMarginMs)throw new ToolError('The turn deadline was reached. Your list is retained.','turn_deadline');
    const prepared=provider.prepareInput?.(input);
    if(!prepared)provider.validateInput?.(input);
    // A committed reservation precedes every potentially paid invocation.
    const reservation=await withConversation(this.pool,ctx,async client=>{
      const held=await client.query("SELECT 1 FROM messages WHERE id=$1 AND status='processing' AND claim_token=$2 AND lease_until>clock_timestamp()",[claim.id,claim.token]);
      if(!held.rowCount) throw new ToolError('Work lease expired before interpretation.');
      const current=await loadState(client,ctx);
      if(current.version!==claim.state.version) throw new ToolError('Draft changed before interpretation.');
      return reserveAttempt(client,ctx,claim.id,claim.state.version,provider,stage,prepared?.admission);
    });
    if(reservation.exhausted) throw new ToolError('Interpretation attempt limit reached. Please rephrase or ask the shop.');
    if('denied' in reservation&&reservation.denied){if('defer' in reservation&&reservation.defer)throw new DeferredRecommendation();throw new ToolError('Inference budget unavailable or exhausted. Your draft is retained.',provider.freeQuota?'quota_unavailable':'budget_unavailable');}
    if(reservation.cached) return interpretationSchema.parse(reservation.cached);
    let failureCode='provider_error';
    try {
      const timeoutMs=providerCallTimeout(input,claim.deadlineAt-Date.now());
      if(timeoutMs<=inferenceTiming.sdkMarginMs){failureCode='turn_deadline';throw new ToolError('The turn deadline was reached. Your list is retained.','turn_deadline');}
      const signal=AbortSignal.timeout(timeoutMs);
      const output=await Promise.race([prepared?prepared.interpret(signal):provider.interpret(input,signal),new Promise<never>((_,reject)=>{signal.addEventListener('abort',()=>reject(new Error('Interpretation timed out; draft retained.')),{once:true});})]);
      if(output.observation)await this.pool.query('UPDATE provider_attempts SET observation=$1::jsonb WHERE id=$2 AND store_id=$3 AND conversation_id=$4',[JSON.stringify(output.observation),reservation.id,ctx.storeId,ctx.conversationId]);
      failureCode='usage_validation';
      if(!await settleAttempt(this.pool,ctx,reservation.id!,output)) throw new ToolError('Provider usage exceeded the verified limits. No changes applied.');
      if(Date.now()>=claim.deadlineAt){failureCode='turn_deadline';throw new ToolError('The turn deadline was reached. Your list is retained.','turn_deadline');}
      if(output.validationIssues?.length)await this.pool.query('UPDATE provider_attempts SET validation_issues=$1::jsonb WHERE id=$2 AND conversation_id=$3',[JSON.stringify(output.validationIssues.slice(0,6).map(i=>({path:i.path.slice(0,100),code:i.code.slice(0,40)}))),reservation.id,ctx.conversationId]);
      failureCode='truncated_or_model_mismatch';
      if(output.truncated) throw new ToolError('Interpretation was truncated. No partial list was applied.');
      failureCode=output.output===null?'invalid_json':'invalid_operations';
      let parsed=interpretationSchema.safeParse(output.output);
      if(!parsed.success||stage==='recognize'&&(parsed.data.operations.length>0||parsed.data.next!=='continue')||input.image&&!(provider.supportsImageLists&&parsed.data.understanding?.inputKind==='handwritten_list'&&parsed.data.operations.every(op=>op.kind==='add_item'))&&(parsed.data.operations.length>0||!['assist','continue'].includes(parsed.data.next))) throw new ToolError('Could not validate all requested actions. Please rephrase; no changes were applied.');
      failureCode='ledger_write';
      const valid=parsed.data;
      // A safe clarification can survive a rejected perception contract. Keep
      // the paid usage and evidence, but never cache that attempt as a success.
      const rejected=valid.understanding?.unresolved.includes('validation_recovery')===true;
      await this.pool.query("UPDATE provider_attempts SET state=$4,failure_code=$5,response=$1::jsonb,usage=$2::jsonb WHERE id=$3",[JSON.stringify(valid),JSON.stringify(output.usage),reservation.id,rejected?'failed':'succeeded',rejected?'invalid_evidence':null]);
      return valid;
    } catch(error) {
      if(provider.freeQuota&&error instanceof FreeQuotaError) await coolDownFreeQuota(this.pool,provider.freeQuota);
      await settleAttempt(this.pool,ctx,reservation.id!);
      if(failureCode==='provider_error'){
        const status=typeof error==='object'&&error!==null&&'status' in error?error.status:undefined;
        if(typeof status==='number'&&Number.isInteger(status)&&status>=400&&status<=599)failureCode=`provider_http_${status}`;
        else if(error instanceof Error&&/timeout|timed out|aborted/i.test(error.name+' '+error.message))failureCode='provider_timeout';
      }
      await this.pool.query("UPDATE provider_attempts SET state='failed',failure_code=$2 WHERE id=$1",[reservation.id,error instanceof FreeQuotaError?'rate_limited':failureCode]);
      throw error;
    }
  }
}
