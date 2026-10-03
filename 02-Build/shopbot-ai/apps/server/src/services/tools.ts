import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { toolCallSchema, type ConversationState, type DraftLine, type OrderRequest, type Product, type ToolCall } from '../../../../packages/contracts/index.js';
import { formatMoney, lineTotal } from '../../../../packages/contracts/money.js';
import { matches, searchProducts,exactProductMatch,normalize,sameUnit,normalizeUnit } from './catalog.js';
import { authorize, ToolError, withConversation, type ActorContext } from './context.js';
import {productIdentity,productConfirmed,preserveConfirmation,markProductConfirmed,makeProductCheck} from './product-verification.js';

export type ToolResult = { state?: ConversationState; products?: Product[]; request?: OrderRequest | null; totalCount?:number; quote?:{quantity:number;unit:string;totalPaise:number}; message: string };
export const toolDefinitions = [
  { name: 'search_products', purpose: 'Find actual products and variants in the verified store' },
  { name: 'get_draft', purpose: 'Read resolved and unresolved customer draft lines' },
  { name: 'apply_draft_changes', purpose: 'Apply a validated operation batch at one expected draft version' },
  { name: 'preview_order', purpose: 'Clarify unresolved lines or create a bound review from current facts' },
  { name: 'confirm_product_choices', purpose: 'Accept only products displayed in the current customer product check' },
  { name: 'submit_order_request', purpose: 'Submit exactly one explicitly confirmed current review for staff approval' },
  { name: 'get_order_status', purpose: 'Read only this customer’s submitted requests' },
] as const;
function canonical(value: any): any { return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value; }
export function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
export async function loadState(client: PoolClient, ctx: ActorContext): Promise<ConversationState> {
  const { rows } = await client.query('SELECT c.version,c.draft,c.pending,c.fulfillment,c.last_request_id,p.require_product_confirmation FROM conversations c LEFT JOIN store_policies p ON p.store_id=c.store_id WHERE c.id=$1 AND c.store_id=$2 AND c.actor=$3', [ctx.conversationId,ctx.storeId,ctx.actor]);
  if (!rows[0]) throw new ToolError('Conversation unavailable', 'forbidden');
  const c = rows[0];
  return { version:c.version,draft:c.draft,pending:c.pending,fulfillment:c.fulfillment,lastRequestId:c.last_request_id,...(c.require_product_confirmation?{requireProductConfirmation:true as const}:{}) };
}
async function saveState(client: PoolClient, ctx: ActorContext, state: ConversationState) {
  await client.query('UPDATE conversations SET draft=$1::jsonb,version=$2,pending=$3::jsonb,fulfillment=$4,last_request_id=$5 WHERE id=$6 AND store_id=$7 AND actor=$8', [JSON.stringify(state.draft),state.version,JSON.stringify(state.pending),state.fulfillment,state.lastRequestId,ctx.conversationId,ctx.storeId,ctx.actor]);
}
function validateQuantity(product: Product, quantity: number | null) {
  if (quantity === null) return;
  const scaled = Math.round(quantity * 1000);
  const step = Math.round(product.quantityStep * 1000);
  if (scaled <= 0 || quantity > 100 || !step || scaled % step !== 0) throw new ToolError(`Use increments of ${product.quantityStep} ${product.unit} for ${product.name}.`);
}
function resolvedLine(product: Product, quantity: number | null, query: string, id: string = randomUUID(), requestedUnit?:string): DraftLine {
  if(requestedUnit&&!sameUnit(requestedUnit,product.unit)) return {id,query,sku:product.sku,name:product.name,quantity:null,unit:product.unit,pricePaise:product.pricePaise,productVersion:product.version,requestedUnit:normalizeUnit(requestedUnit),...(quantity!==null?{requestedQuantity:quantity}:{}),resolution:'needs_unit',candidates:[product]};
  validateQuantity(product,quantity);
  return { id,query,sku:product.sku,quantity,name:product.name,unit:product.unit,pricePaise:product.pricePaise,productVersion:product.version,
    ...(requestedUnit?{requestedUnit:normalizeUnit(requestedUnit)}:{}),resolution:quantity===null?'needs_quantity':product.stock===0?'unavailable':'matched',candidates:[product] };
}
async function resolveLine(client: PoolClient, ctx: ActorContext, query: string, quantity: number | null, id: string = randomUUID(),requestedUnit?:string): Promise<DraftLine> {
  const candidates = await searchProducts(client,ctx,query);
  if (candidates.length === 1&&exactProductMatch(query,candidates[0])&&!(candidates[0].unit==='box'&&/\d/.test(candidates[0].name)&&!/[\d½¾]/.test(query)&&normalize(query)!==normalize(candidates[0].sku))) return resolvedLine(candidates[0],quantity,query,id,requestedUnit);
  // A result set is retained, never silently reduced to the first product.
  return { id,query,quantity,name:query,...(requestedUnit?{requestedUnit:normalizeUnit(requestedUnit)}:{}),resolution:candidates.length?'needs_choice':'unavailable',candidates:candidates.slice(0,10) };
}
function referenceLine(state: ConversationState, reference: string): DraftLine {
  const identified=state.draft.filter(l=>l.id===reference||l.sku===reference);
  const result=identified.length?identified:state.draft.filter(l=>matches(reference,[l.name,l.query??'',...(l.candidates?.length===1?l.candidates[0].aliases:[])]));
  if (result.length!==1) throw new ToolError(result.length?'That reference matches several draft lines. Name the exact size/product.':'That item is not in the draft. No changes were applied.');
  return result[0];
}
export function renderDraft(state: ConversationState) {
  return state.draft.map((l,i) => `${i+1}. ${l.quantity??'?'} × ${l.name}${l.resolution==='matched'&&l.pricePaise!==undefined?` — ${formatMoney(lineTotal(l.pricePaise,l.quantity!))}`:` — ${l.resolution.replaceAll('_',' ')}`}`).join('\n');
}
function requestFromRow(row: Record<string,any>): OrderRequest {
  return {id:row.id,acceptance:row.acceptance,payment:row.payment,fulfillment:row.fulfillment,totalPaise:Number(row.total_paise),lines:row.lines};
}

export class RetailTools {
  constructor(private pool: Pool) {}
  // All surfaces (simulator, future channel/owner adapters) share this boundary.
  async invoke(ctx: ActorContext, input: unknown, operationKey: string): Promise<ToolResult> {
    const call=toolCallSchema.parse(input);
    return withConversation(this.pool,ctx,client=>this.invokeInTransaction(client,ctx,call,operationKey));
  }
  // Caller must hold the verified conversation lock. Used to commit tool effects
  // together with the runtime's reply and processed inbox marker.
  async invokeInTransaction(client: PoolClient, ctx: ActorContext, input: unknown, operationKey: string): Promise<ToolResult> {
    await authorize(client,ctx);
    const call=toolCallSchema.parse(input);
    if(call.name==='submit_order_request'&&ctx.consentReviewId!==call.args.reviewId) throw new ToolError('Submission requires explicit customer confirmation from the trusted channel handler.','confirmation_required');
    if(call.name==='confirm_product_choices'&&ctx.consentProductBatchId!==call.args.batchId) throw new ToolError('Product acceptance requires the current customer product check.','confirmation_required');
    const hash=digest(call);
    const previous=await client.query('SELECT args_hash,result FROM tool_receipts WHERE store_id=$1 AND conversation_id=$2 AND operation_key=$3 AND tool_name=$4 AND actor=$5',[ctx.storeId,ctx.conversationId,operationKey,call.name,ctx.actor]);
    if(previous.rows[0]) {
      if(previous.rows[0].args_hash!==hash) throw new ToolError('Operation key was already used for different arguments','conflicting_replay');
      return previous.rows[0].result;
    }
    const result=await this.execute(client,ctx,call);
    await client.query('INSERT INTO tool_receipts(store_id,conversation_id,actor,operation_key,tool_name,args_hash,result) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[ctx.storeId,ctx.conversationId,ctx.actor,operationKey,call.name,hash,JSON.stringify(result)]);
    return result;
  }
  private async execute(client: PoolClient, ctx: ActorContext, call: ToolCall): Promise<ToolResult> {
    const state=await loadState(client,ctx);
    if(call.name==='search_products') {
      const products=await searchProducts(client,ctx,call.args.query);
      const product=products.length===1&&exactProductMatch(call.args.query,products[0])?products[0]:undefined;
      let quote:ToolResult['quote'];
      if(product&&call.args.quantity!==undefined&&(!call.args.requestedUnit||sameUnit(call.args.requestedUnit,product.unit))){validateQuantity(product,call.args.quantity);quote={quantity:call.args.quantity,unit:product.unit,totalPaise:lineTotal(product.pricePaise,call.args.quantity)};}
      const mismatch=product&&call.args.requestedUnit&&!sameUnit(call.args.requestedUnit,product.unit)?` This item is priced per ${product.unit}, not ${call.args.requestedUnit}; the shop must verify any conversion.`:'';
      return {quote,totalCount:products.length,products:products.slice(0,10),message:products.length?products.slice(0,5).map(p=>`${p.name}: ${formatMoney(p.pricePaise)} / ${p.unit}${p.stock===null?' (stock needs staff confirmation)':''}`).join('\n'):'No catalog match. Try a size or a more specific name.',...(mismatch?{message:`${product!.name}: ${formatMoney(product!.pricePaise)} / ${product!.unit}.${mismatch}`}:{})};
    }
    if(call.name==='get_draft') return {state,message:renderDraft(state)||'Your draft is empty.'};
    if(call.name==='get_order_status') {
      const id=call.args.requestId??state.lastRequestId;
      if(!id) return {request:null,message:'No submitted request in this conversation.'};
      const row=await client.query('SELECT * FROM order_requests WHERE id=$1 AND store_id=$2 AND conversation_id=$3 AND actor=$4',[id,ctx.storeId,ctx.conversationId,ctx.actor]);
      if(!row.rows[0]) throw new ToolError('Request is not accessible to this customer','forbidden');
      const request=requestFromRow(row.rows[0]);
      return {request,message:`Request ${request.id}: waiting for shop approval. Payment has not been requested; items are not ready for pickup.`};
    }
    if(call.name==='confirm_product_choices') {
      const pending=state.pending;
      if(state.lastRequestId||pending?.kind!=='products'||pending.id!==call.args.batchId||pending.version!==state.version||Date.parse(pending.expiresAt)<=Date.now()) throw new ToolError('Those product choices are no longer current. Review your list again.','stale_confirmation');
      if(new Set(call.args.choices.map(c=>c.lineId)).size!==call.args.choices.length)throw new ToolError('Choose one product per requested item.');
      for(const choice of call.args.choices) {
        const displayed=pending.groups.find(g=>g.lineId===choice.lineId)?.products.find(p=>p.sku===choice.sku);
        const index=state.draft.findIndex(l=>l.id===choice.lineId);
        if(!displayed||index<0)throw new ToolError('That product was not shown for this requested item.');
        const [product]=await searchProducts(client,ctx,choice.sku);
        if(!product||productIdentity(product)!==productIdentity(displayed))throw new ToolError('The product details changed. Review the latest photo and name before adding it.','stale_confirmation');
        const old=state.draft[index];
        const line=resolvedLine(product,old.requestedQuantity??old.quantity,old.query??product.name,old.id,old.requestedUnit);
        markProductConfirmed(line,product);state.draft[index]=line;
      }
      state.version++;state.pending=null;await saveState(client,ctx,state);
      return {state,message:'Product choices accepted. Nothing has been sent to the shop.'};
    }
    if(call.name==='apply_draft_changes') {
      if(state.lastRequestId) throw new ToolError('This conversation has a submitted request. Ask the shop for an amendment; the submitted snapshot cannot be edited.');
      if(call.args.expectedVersion!==state.version) throw new ToolError('The draft changed. Review it and try the action again.','stale_version');
      for(const op of call.args.operations) {
        if(op.kind==='set_fulfillment') { state.fulfillment=op.method; continue; }
        if(op.kind==='add_item') {
          const line=await resolveLine(client,ctx,op.query,op.quantity,undefined,op.requestedUnit);
          if(ctx.selectedCatalogSku===line.sku&&line.candidates?.length===1)markProductConfirmed(line,line.candidates[0]);
          const same=line.resolution==='matched'?state.draft.find(l=>l.sku===line.sku&&l.resolution==='matched'):undefined;
          if(same&&same.quantity!==null&&line.quantity!==null) {
            const total=Math.round((same.quantity+line.quantity)*1000)/1000;
            validateQuantity(line.candidates![0],total);
            const updated=preserveConfirmation(same,{...line,id:same.id,quantity:total});
            delete same.productConfirmation;Object.assign(same,updated);
          } else state.draft.push(line);
        } else if(op.kind==='resolve_line') {
          const index=state.draft.findIndex(l=>l.id===op.lineId);
          if(index<0) throw new ToolError('The referenced draft line is no longer current.');
          const old=state.draft[index];
          if(old.resolution==='needs_unit'&&op.quantity!==undefined&&!op.requestedUnit)throw new ToolError(`Please include the unit, for example 2 ${old.unit??'units'}. I can’t convert ${old.requestedUnit??'the requested amount'} without a verified pack size or length.`);
          const next=await resolveLine(client,ctx,op.query??old.sku??old.query??old.name,op.quantity??old.requestedQuantity??old.quantity,old.id,op.requestedUnit??old.requestedUnit);
          if(!op.query)next.query=old.query??old.name;
          state.draft[index]=preserveConfirmation(old,next);
          if(ctx.selectedCatalogSku===next.sku&&next.candidates?.length===1)markProductConfirmed(next,next.candidates[0]);
        } else {
          const line=referenceLine(state,op.reference);
          if(op.kind==='remove_item') state.draft=state.draft.filter(l=>l.id!==line.id);
          else {
            if(line.resolution==='needs_unit')throw new ToolError('Please state the quantity and catalog unit together before changing this item.');
            if(line.sku) {
              const [product]=await searchProducts(client,ctx,line.sku);
              if(!product) throw new ToolError('The product is no longer available in the catalog.');
              const updated=preserveConfirmation(line,resolvedLine(product,op.quantity,line.query??line.name,line.id,line.requestedUnit));
              delete line.productConfirmation;Object.assign(line,updated);
            } else { line.quantity=op.quantity; }
          }
        }
      }
      const limit=state.requireProductConfirmation?20:10;
      if(state.draft.length>limit) throw new ToolError(`Maximum ${limit} distinct lines. Split the request; no partial list was applied.`);
      state.version++; state.pending=null;
      await saveState(client,ctx,state);
      return {state,message:`Draft updated.\n${renderDraft(state)}`};
    }
    if(call.name==='preview_order') {
      if(call.args.expectedVersion!==state.version) throw new ToolError('The draft changed. Refresh the review.','stale_version');
      if(state.lastRequestId) throw new ToolError('The request is already submitted; check its status or contact the shop for an amendment.');
      if(!state.draft.length) return {state,message:'Your draft is empty. Add items first.'};
      let refreshed=false;
      for(const line of state.draft) {
        if(!line.sku) {
          if(state.requireProductConfirmation){const next=await resolveLine(client,ctx,line.query??line.name,line.quantity,line.id,line.requestedUnit);if(digest(next)!==digest(line)){Object.assign(line,next);refreshed=true;}}
          continue;
        }
        const [product]=await searchProducts(client,ctx,line.sku);
        if(!product) { if(line.resolution!=='unavailable'||line.candidates?.length||line.productConfirmation) {line.resolution='unavailable';line.candidates=[];delete line.productConfirmation;refreshed=true;} continue; }
        const current=preserveConfirmation(line,resolvedLine(product,line.requestedQuantity??line.quantity,line.query??line.name,line.id,line.requestedUnit));
        if(product.stock!==null&&line.quantity!==null&&product.stock<line.quantity) current.resolution='unavailable';
        if(digest(current)!==digest(line)) {delete line.productConfirmation;Object.assign(line,current);refreshed=true;}
      }
      if(refreshed) state.version++;
      if(state.requireProductConfirmation) {
        const check=makeProductCheck(state);
        if(check){state.pending=check;await saveState(client,ctx,state);return {state,message:'Check the products before adding them to your list.'};}
      }
      const unresolved=state.draft.find(l=>l.resolution!=='matched');
      if(unresolved) {
        state.pending={kind:'question',id:randomUUID(),lineId:unresolved.id,version:state.version};
        await saveState(client,ctx,state);
        const question=unresolved.resolution==='needs_quantity'?`How many ${unresolved.unit??'units'} of ${unresolved.name}?`:unresolved.resolution==='needs_choice'?`Choose the exact product for “${unresolved.query}”:\n${(unresolved.candidates??[]).map((p,i)=>`${i+1}. ${p.name} — ${formatMoney(p.pricePaise)}`).join('\n')}`:`“${unresolved.name}” is unavailable or unmatched. Give another specification or remove this line.`;
        return {state,message:`${renderDraft(state)}\n\n${question} Other lines are retained. No request submitted.`};
      }
      const totalPaise=state.draft.reduce((sum,l)=>sum+lineTotal(l.pricePaise!,l.quantity!),0);
      const snapshot={lines:state.draft,fulfillment:state.fulfillment,totalPaise};
      state.pending={kind:'review',id:randomUUID(),version:state.version,hash:digest(snapshot),expiresAt:new Date(Date.now()+15*60*1000).toISOString(),...snapshot};
      await saveState(client,ctx,state);
      return {state,message:`${refreshed?'Catalog facts changed; please review the updated request.\n':''}${renderDraft(state)}\nTotal: ${formatMoney(totalPaise)}. Pickup.\nShall I send this request to the shop? Reply yes or confirm this review. Availability needs shop approval; stock is not reserved.`};
    }
    // Only this tool can create a request. No staff/payment/readiness action exists in this customer registry.
    const pending=state.pending;
    if(!pending||pending.kind!=='review'||pending.id!==call.args.reviewId||pending.version!==state.version||Date.parse(pending.expiresAt)<=Date.now()) throw new ToolError('There is no current unexpired review for that confirmation. Review the draft first.','stale_confirmation');
    if(digest({lines:state.draft,fulfillment:state.fulfillment,totalPaise:pending.totalPaise})!==pending.hash) throw new ToolError('Review snapshot changed; review again.','stale_confirmation');
    for(const line of state.draft) {
      const [product]=await searchProducts(client,ctx,line.sku!);
      if(line.resolution!=='matched'||!product||(state.requireProductConfirmation&&!productConfirmed(line,product))||product.version!==line.productVersion||product.pricePaise!==line.pricePaise||(product.stock!==null&&product.stock<line.quantity!)) {
        state.pending=null; await saveState(client,ctx,state);
        return {state,message:'Price or availability changed after the review. No request submitted. Review the draft again.'};
      }
    }
    const id=randomUUID();
    const row=await client.query('INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise,pickup_method) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *',[id,ctx.storeId,ctx.conversationId,ctx.actor,pending.id,JSON.stringify(pending.lines),pending.totalPaise,pending.fulfillment]);
    state.pending=null;state.lastRequestId=id;state.version++;
    await saveState(client,ctx,state);
    return {state,request:requestFromRow(row.rows[0]),message:`Request ${id} received. Waiting for the shop to confirm. Payment has not been requested; packing and readiness require shop actions.`};
  }
}
