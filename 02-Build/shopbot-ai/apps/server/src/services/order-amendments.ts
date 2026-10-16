import {reserveRequest,closeRequestStock} from './inventory.js';
import {searchProducts} from './catalog.js';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {ConversationState,Operation,RichReply,SimulatorEvent} from '../../../../packages/contracts/index.js';
import {customerCopy} from '../../../../packages/contracts/customer-copy.js';
import {say,lineName,unitName} from '../../../../packages/contracts/language.js';
import {operationSchema} from '../../../../packages/contracts/index.js';
import {z} from 'zod';
import {ToolError,type ActorContext} from './context.js';
import {RetailTools,digest} from './tools.js';
import {estimateLines,estimateText} from './order-estimate.js';
import {textPresentation} from './message-presentation.js';

export const acknowledgementOnly=(text:string)=>/^(?:(?:yes|confirm|aama|aamam|ஆம்|ஆமாம்|ok(?:ay)?|thanks?|thank you|thank ?you so much|சரி|நன்றி|sari|nandri|romba nandri|ரொம்ப நன்றி)[\s.!🙏👍🙂😊]*)+$/iu.test(text.trim())||/^[🙏👍🙂😊\s]+$/u.test(text.trim());
export const explicitNewOrder=(text:string)=>/\b(?:new|another|separate|pudhu|pudu|puthu)\s+(?:order|list)\b|(?:புது|புதிய|வேறொரு|வேற ஒரு)\s*(?:order|ஆர்டர்|லிஸ்ட்|பட்டியல்)/iu.test(text);
export const amendmentIntent=(text:string)=>!explicitNewOrder(text)&&/\b(?:add|extra|more|change|replace|remove|cancel|maath(?:u|tha)|ser(?:u|unga)|innum|innam)\b|மாத்த|மாற்ற|சேர்க்க|சேரு|சேர்த்த|நீக்க|வேணாம்|வேண்டாம்|இன்னும்|இன்னம்|cancel\s*பண்ண/iu.test(text);
export const cancellationIntent=(text:string)=>/\b(?:cancel (?:my |the |this )?order|cancel pann|order cancel)\b|(?:order|ஆர்டர்).*cancel|ஆர்டர்.*ரத்து/iu.test(text)&&!/don't|dont|do not|பண்ணாத|செய்யாத|வேண்டாம்|வேணாம்|pannath|pannaath/iu.test(text);
const reference=(id:string)=>'Order #'+id.replaceAll('-','').slice(0,8).toUpperCase();
function lineSummary(lines:ConversationState['draft'],state:ConversationState) {
 return lines.map((line,index)=>`${index+1}. ${lineName(line,state)} — ${line.quantity===null?say(state,'quantity to check','Count check பண்ணணும்','Count check pannanum'):`${line.quantity} ${unitName(line.unit??line.requestedUnit??'unit',state,line.quantity)}`}`).join('\n');
}

/** Compute a proposal through the existing validated draft tool, then roll
 * back the scratch writes. Only the separate proposal is persisted. */
export async function proposeAmendment(client:PoolClient,ctx:ActorContext,state:ConversationState,sourceId:string,operations:Operation[],tools:RetailTools,cancel=false):Promise<RichReply> {
 if(!state.lastRequestId)throw new ToolError('Choose an existing order first.');
 const request=(await client.query('SELECT * FROM order_requests WHERE store_id=$1 AND id=$2 AND conversation_id=$3 AND actor=$4 FOR UPDATE',[ctx.storeId,state.lastRequestId,ctx.conversationId,ctx.actor])).rows[0];
 if(!request)throw new ToolError('This order is not available to this customer.','forbidden');
 if(['collected','cancelled'].includes(request.fulfillment)||request.acceptance==='rejected')throw new ToolError(say(state,'This order is closed. Say “new order” to start another list.','இந்த order முடிஞ்சிருக்கு. புது order வேணும்னா “new order”னு சொல்லுங்க.','Intha order mudinjirukku. Puthu order venumna “new order”nu sollunga.'));
 const source=(await client.query("SELECT id FROM messages WHERE id=$1 AND conversation_id=$2 AND direction='inbound'",[sourceId,ctx.conversationId])).rows[0];
 if(!source)throw new ToolError('An amendment needs its customer message.','forbidden');
 const prior=(await client.query('SELECT * FROM order_amendments WHERE source_message_id=$1',[sourceId])).rows[0];
 if(prior)return amendmentReviewReply(prior,state);
 const outstanding=(await client.query("SELECT id FROM order_amendments WHERE request_id=$1 AND state IN ('proposed','owner_pending')",[request.id])).rows[0];
 if(outstanding)throw new ToolError(say(state,'An amendment is already awaiting a decision. Ask the shop to finish it before changing this order again.','இந்த order-க்கு ஒரு change இன்னும் pending-ல இருக்கு.\nகடை அதை confirm பண்ணின பிறகு அடுத்த change செய்யலாம்.','Intha order-ku oru change innum pending-la irukku.\nKadai athai confirm pannina piragu adutha change seyyalaam.'));
 let lines=request.effective_lines??request.lines;
 if(!cancel){
  z.array(operationSchema).min(1).max(100).parse(operations);
  await client.query('SAVEPOINT amendment_scratch');
  try{
   await client.query('UPDATE conversations SET last_request_id=NULL,draft=$1::jsonb,pending=NULL,editing_line_id=NULL WHERE id=$2',[JSON.stringify(lines),ctx.conversationId]);
   const result=await tools.invokeInTransaction(client,ctx,{name:'apply_draft_changes',args:{expectedVersion:state.version,operations}},sourceId+':amendment');
   lines=structuredClone(result.state!.draft);
  }finally{await client.query('ROLLBACK TO SAVEPOINT amendment_scratch');await client.query('RELEASE SAVEPOINT amendment_scratch');}
  if(!lines.length)throw new ToolError('Use an explicit order cancellation request to remove the entire order.');
  if(digest(lines)===digest(request.effective_lines??request.lines))throw new ToolError('No order change was found. Tell me what should change.');
 }
 await client.query("UPDATE order_quotes SET state='superseded' WHERE request_id=$1 AND state='offered'",[request.id]);
 await client.query('UPDATE conversations SET version=version+1 WHERE id=$1',[ctx.conversationId]);state.version++;
 const estimate=estimateLines(lines),id=randomUUID();
 const summary=cancel?say(state,'Cancel this order','இந்த order-ஐ cancel பண்ணணும்','Intha order-ai cancel pannanum'):estimateText(state,lines,false,false);
 const row=(await client.query("INSERT INTO order_amendments(id,store_id,request_id,conversation_id,source_message_id,source_version,expected_revision,kind,operations,proposed_lines,known_subtotal_paise,estimate_complete,summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13) RETURNING *",[id,ctx.storeId,request.id,ctx.conversationId,sourceId,state.version,request.effective_revision,cancel?'cancel':'change',JSON.stringify(operations),JSON.stringify(lines),estimate.knownSubtotalPaise,estimate.complete,summary])).rows[0];
 return amendmentReviewReply(row,state);
}
export function amendmentReviewReply(row:any,state:ConversationState):RichReply {
 const text=customerCopy('amendmentReview',state,{reference:reference(row.request_id),items:row.summary});
 return textPresentation(text,[{label:say(state,'Send amendment','அனுப்பு','Anuppu'),event:{id:randomUUID(),type:'confirm_amendment',amendmentId:row.id,expectedVersion:state.version}},{label:say(state,'Keep original','வேண்டாம்','Vendaam'),event:{id:randomUUID(),type:'discard_amendment',amendmentId:row.id,expectedVersion:state.version}}]);
}
export async function customerAmendmentAction(client:PoolClient,ctx:ActorContext,state:ConversationState,event:Extract<SimulatorEvent,{type:'confirm_amendment'|'discard_amendment'}>,sourceMessageId=event.id):Promise<RichReply> {
 if(event.expectedVersion!==state.version)throw new ToolError('Use the latest order amendment choices.','stale_version');
 const row=(await client.query('SELECT a.*,r.effective_revision FROM order_amendments a JOIN order_requests r ON r.id=a.request_id WHERE a.id=$1 AND a.store_id=$2 AND a.conversation_id=$3 AND r.actor=$4 FOR UPDATE OF a',[event.amendmentId,ctx.storeId,ctx.conversationId,ctx.actor])).rows[0];
 if(!row||row.source_version!==state.version||row.expected_revision!==row.effective_revision||row.request_id!==state.lastRequestId)throw new ToolError('That amendment is no longer current.','stale_confirmation');
 if(row.state==='owner_pending'&&event.type==='confirm_amendment')return textPresentation(customerCopy('amendmentPending',state));
 if(row.state!=='proposed')throw new ToolError('That amendment already has a decision.','stale_confirmation');
 const status=event.type==='confirm_amendment'?'owner_pending':'withdrawn';
 await client.query('UPDATE order_amendments SET state=$1,customer_message_id=$2,updated_at=now() WHERE id=$3',[status,sourceMessageId,row.id]);
 return textPresentation(status==='owner_pending'?customerCopy('amendmentPending',state):say(state,'The proposed amendment was withdrawn. Your order is unchanged.','Change வேண்டாம்.\nஉங்க order அப்படியே இருக்கு.','Change vendaam.\nUnga order appadiye irukku.'));
}
export async function decideAmendment(client:PoolClient,storeId:string,amendmentId:string,actor:string,decision:'accepted'|'rejected') {
 const row=(await client.query('SELECT a.*,r.effective_revision,r.fulfillment,r.advance_required,r.acceptance,r.inventory_state FROM order_amendments a JOIN order_requests r ON r.id=a.request_id AND r.store_id=a.store_id WHERE a.id=$1 AND a.store_id=$2 FOR UPDATE OF a,r',[amendmentId,storeId])).rows[0];
 if(!row)throw new ToolError('Order amendment not found.');
 if(row.state===decision)return {row,replayed:true};
 if(row.state!=='owner_pending')throw new ToolError('The customer must confirm this amendment before a shop decision.');
 if(row.expected_revision!==row.effective_revision)throw new ToolError('The order changed. Ask the customer to review a fresh amendment.','stale_version');
 if(decision==='accepted'){
  if(['collected','cancelled'].includes(row.fulfillment))throw new ToolError('This order is closed. Discuss a new request with the customer.');
  if(row.kind==='cancel'){
   await closeRequestStock(client,storeId,row.request_id,'release',actor);
   await client.query("UPDATE order_requests SET fulfillment='cancelled',acceptance=CASE WHEN acceptance='awaiting_approval' THEN 'rejected' ELSE acceptance END,effective_revision=effective_revision+1 WHERE id=$1",[row.request_id]);
   await client.query("UPDATE order_advances SET state='refund_pending',updated_at=now() WHERE request_id=$1 AND state='verified'",[row.request_id]);
  }else{
   // Unresolved identities/prices need a shop quote, not an implicit approval.
   if(!row.estimate_complete)throw new ToolError('Resolve the item details and agree a final quote with the customer before accepting this amendment.');
   for(const line of row.proposed_lines as ConversationState['draft']){
    if(line.merchantConfirmed)continue;
    const [product]=line.sku?await searchProducts(client,{storeId} as ActorContext,line.sku):[];
    if(!product||product.version!==line.productVersion||product.pricePaise!==line.pricePaise||line.quantity===null)throw new ToolError('Catalog price or availability changed. Send a fresh quote for customer approval.');
   }
   if(row.acceptance==='accepted')await reserveRequest(client,storeId,row.request_id,row.proposed_lines,row.effective_revision+1,actor);
   await client.query("UPDATE order_requests SET fulfillment=CASE WHEN fulfillment='ready_for_pickup' THEN 'preparing' ELSE fulfillment END,packed_revision=NULL,effective_lines=$1::jsonb,effective_total_paise=$2,effective_revision=effective_revision+1 WHERE id=$3",[JSON.stringify(row.proposed_lines),row.known_subtotal_paise,row.request_id]);
   await client.query('UPDATE conversations SET draft=$1::jsonb,version=version+1 WHERE id=$2 AND last_request_id=$3',[JSON.stringify(row.proposed_lines),row.conversation_id,row.request_id]);
  }
 }
 await client.query('UPDATE order_amendments SET state=$1,decided_by=$2,decided_at=now(),updated_at=now() WHERE id=$3',[decision,actor,row.id]);
 return {row:{...row,state:decision},replayed:false};
}
