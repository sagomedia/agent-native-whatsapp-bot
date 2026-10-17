import {estimateLines,estimateText,partialReview} from './order-estimate.js';
import {counterLine} from './counter-state.js';
import {sellingBasisIssues} from '../../../../packages/contracts/selling-basis.js';
import {createUpiAdvance,type UpiAdvanceConfig} from './upi-advance.js';
import {requestStoreAssistance} from './store-assistance.js';
import {discoverProductMeanings} from './product-meaning.js';
import {normalizeAmountEdits} from './amount-edits.js';
import {productListHash} from './visual-ordering.js';
import {amountToCount,catalogPack,catalogContent,convertAmount,explicitPurchaseCount,packSearchQuery,parsePackSize,physicalMeasure,matchesProductMeasures,protectQuantityEvidence} from './quantity-evidence.js';
import {say,lineName,unitName,productPriceText,productStockText} from '../../../../packages/contracts/language.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { toolCallSchema, type ConversationState, type DraftLine, type OrderRequest, type Product, type ToolCall,type DiscoveryPlan,type DiscoveryResult,type CatalogMap } from '../../../../packages/contracts/index.js';
import { formatMoney, lineTotal } from '../../../../packages/contracts/money.js';
import { matches, searchProducts,exactProductMatch,normalize,sameUnit,normalizeUnit,productColumns,productFromRow } from './catalog.js';
import { authorize, ToolError, withConversation, type ActorContext } from './context.js';
import {catalogEnabled} from './catalog.js';
import {getCatalogMap,discoverProducts,needsPipeType} from './catalog-discovery.js';
import {productIdentity,productConfirmed,preserveConfirmation,markProductConfirmed,makeProductCheck} from './product-verification.js';
import {nextCounterLine,productCheckCoversDraft} from './counter-state.js';

export type ToolResult = { estimate?:{knownSubtotalPaise:number;complete:boolean;missingLineIds:string[];lines?:DraftLine[]}; handoffRequested?:true;state?: ConversationState; products?: Product[];discovery?:DiscoveryResult;catalogMap?:CatalogMap;discoveryBindingId?:string; request?: OrderRequest | null; totalCount?:number; quote?:{quantity:number;unit:string;totalPaise:number}; message: string };
export const toolDefinitions = [
  { name: 'search_products', purpose: 'Find actual products and variants in the verified store' },
  { name: 'get_catalog_map', purpose:'Read this store’s departments and product families without loading every SKU' },
  { name: 'discover_products', purpose:'Rank real catalog products from keywords and refine verified families, brands and specifications' },
  { name:'estimate_order',purpose:'Read the known-price subtotal and missing details without changing the list or review' },
  { name:'request_store_assistance',purpose:'Send the current customer list to the owner for checking and show an active assistance request' },
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
  const { rows } = await client.query('SELECT c.partial_reviews,c.visual_ordering,c.product_review,c.reply_language_explicit,c.reply_language,c.version,c.draft,c.pending,c.fulfillment,c.last_request_id,c.editing_line_id,c.handoff_requested,p.require_product_confirmation,cp.store_type FROM conversations c LEFT JOIN store_policies p ON p.store_id=c.store_id LEFT JOIN catalog_profiles cp ON cp.store_id=c.store_id WHERE c.id=$1 AND c.store_id=$2 AND c.actor=$3', [ctx.conversationId,ctx.storeId,ctx.actor]);
  if (!rows[0]) throw new ToolError('Conversation unavailable', 'forbidden');
  const c = rows[0];
  if(c.visual_ordering)for(const line of c.draft as DraftLine[]){
    const size=line.discovery?.plan.specifications?.size;
    if(line.packSize&&physicalMeasure(line.packSize)){
      const supported=line.supportingPhrase?protectQuantityEvidence([{kind:'add_item',query:line.query??line.name,quantity:line.quantity,supportingPhrase:line.supportingPhrase}],line.supportingPhrase)[0]:undefined;
      if(supported?.kind==='add_item')line.productMeasures??=supported.productMeasures;
      else line.productMeasures??=[line.packSize];
      delete line.packSize;
    }
    if(!line.packSize&&size){const parsed=parsePackSize(size);if(parsed&&!physicalMeasure(parsed))line.packSize=parsed;}
    if(!line.quantityEvidenceVersion&&line.requestedUnit&&(!line.unit||!sameUnit(line.requestedUnit,line.unit))&&/^(?:l|litre|liter|ml|inch|mm|cm)$/i.test(line.requestedUnit)){
      line.quantity=null;delete line.requestedQuantity;line.resolution=line.sku?'needs_quantity':line.resolution;delete line.requestedUnit;
    }
  }

  return {allowPartialReview:c.partial_reviews,visualOrdering:c.visual_ordering,productReview:c.product_review, languageExplicit:c.reply_language_explicit,replyLanguage:c.reply_language,version:c.version,draft:c.draft,pending:c.pending,fulfillment:c.fulfillment,lastRequestId:c.last_request_id,editingLineId:c.editing_line_id,handoffRequested:c.handoff_requested,...(c.store_type?{catalogDiscovery:true as const}:{}),...(c.require_product_confirmation||c.visual_ordering?{requireProductConfirmation:true as const}:{}) };
}
async function saveState(client: PoolClient, ctx: ActorContext, state: ConversationState) {
  await client.query('UPDATE conversations SET draft=$1::jsonb,version=$2,pending=$3::jsonb,fulfillment=$4,last_request_id=$5,product_review=$9::jsonb WHERE id=$6 AND store_id=$7 AND actor=$8', [JSON.stringify(state.draft),state.version,JSON.stringify(state.pending),state.fulfillment,state.lastRequestId,ctx.conversationId,ctx.storeId,ctx.actor,JSON.stringify(state.productReview??null)]);
}
function validateQuantity(product: Product, quantity: number | null) {
  if (quantity === null) return;
  const scaled = Math.round(quantity * 1000);
  const step = Math.round(product.quantityStep * 1000);
  if (scaled <= 0 || quantity > 100 || !step || scaled % step !== 0) throw new ToolError(`Use increments of ${product.quantityStep} ${product.unit} for ${product.name}.`);
}
type LineEvidence=Pick<DraftLine,'packUnitAlternative'|'budgetCountDerived'|'sourceUncertainty'|'requestedBudgetPaise'|'packSize'|'productMeasures'|'productIntent'|'requestedAmount'|'amountMode'|'supportingPhrase'|'quantityEvidenceVersion'>;
function lineEvidence(value:LineEvidence):LineEvidence {return Object.fromEntries(['packUnitAlternative','budgetCountDerived','sourceUncertainty','requestedBudgetPaise','packSize','productMeasures','productIntent','requestedAmount','amountMode','supportingPhrase','quantityEvidenceVersion'].flatMap(key=>value[key as keyof LineEvidence]===undefined?[]:[[key,value[key as keyof LineEvidence]]])) as LineEvidence;}
function resolvedLine(product: Product, quantity: number | null, query: string, id: string = randomUUID(), requestedUnit?:string,evidence:LineEvidence={}): DraftLine {
  evidence=lineEvidence(evidence);
  if(evidence.productMeasures&&!matchesProductMeasures(product,evidence.productMeasures))throw new ToolError('The shop must verify the requested product dimensions.');
  if(evidence.requestedBudgetPaise&&(quantity===null||evidence.budgetCountDerived)&&!evidence.requestedAmount){
    if(product.priceStatus==='confirm'||product.pricePaise<=0||!product.sellingUnitVerified)return {...evidence,id,query,sku:product.sku,name:product.name,quantity:null,unit:product.unit,pricePaise:product.pricePaise,productVersion:product.version,resolution:'unavailable',catalogIssue:'budget_unverified',candidates:[product]};
    const step=Math.round(product.quantityStep*1000),count=Math.floor(evidence.requestedBudgetPaise*1000/(product.pricePaise*step))*step/1000;
    if(!step||count<=0||count>100)return {...evidence,id,query,sku:product.sku,name:product.name,quantity:null,unit:product.unit,pricePaise:product.pricePaise,productVersion:product.version,resolution:'unavailable',catalogIssue:'budget_unverified',candidates:[product]};
    quantity=count;evidence.budgetCountDerived=true;
  }
  if(evidence.requestedBudgetPaise&&quantity!==null&&product.pricePaise*quantity>evidence.requestedBudgetPaise)return {...evidence,id,query,sku:product.sku,name:product.name,quantity,unit:product.unit,pricePaise:product.pricePaise,productVersion:product.version,resolution:'unavailable',catalogIssue:'budget_unverified',candidates:[product]};
  const pack=evidence.packSize??catalogPack(product);
  if(evidence.requestedAmount){
    quantity=amountToCount({...evidence} as DraftLine,product);
    if(quantity===null){
      const content=catalogContent(product),converted=content?convertAmount(evidence.requestedAmount,content.unit):null;
      const catalogIssue:DraftLine['catalogIssue']=evidence.amountMode==='continuous'?'continuous_length':content&&physicalMeasure(content)&&product.sellingUnitVerified&&converted!==null&&converted/content.value%1!==0?'cutting_required':'amount_unverified';
      return {...evidence,...(pack?{packSize:pack}:{}),id,query,sku:product.sku,name:product.name,quantity:null,unit:product.unit,pricePaise:product.pricePaise,productVersion:product.version,resolution:'needs_unit',catalogIssue,candidates:[product]};
    }
    requestedUnit=undefined;
  }
  const verifiedPack=catalogPack(product);
  if(evidence.packSize&&(!verifiedPack||!sameUnit(pack!.unit,verifiedPack.unit)))throw new ToolError('The shop must verify this pack size before it can be selected.');
  if(pack&&verifiedPack&&sameUnit(pack.unit,verifiedPack.unit)&&pack.value!==verifiedPack.value)throw new ToolError('That catalog pack has a different size. Tell me which pack size you need.');
  if(requestedUnit&&normalizeUnit(requestedUnit)==='container'&&product.sellingUnitVerified&&verifiedPack&&pack&&sameUnit(pack.unit,verifiedPack.unit)&&pack.value===verifiedPack.value&&['can','tin','bucket','box','bottle','pack'].includes(product.unit))requestedUnit=product.unit;
  if(verifiedPack&&pack&&sameUnit(pack.unit,verifiedPack.unit)&&pack.value===verifiedPack.value&&['can','tin','bucket','box'].includes(requestedUnit??'')&&['can','tin','bucket','box'].includes(product.unit))requestedUnit=product.unit;
  if(requestedUnit&&!sameUnit(requestedUnit,product.unit)) return {...evidence,...(pack?{packSize:pack}:{}),id,query,sku:product.sku,name:product.name,quantity:null,unit:product.unit,pricePaise:product.pricePaise,productVersion:product.version,requestedUnit:normalizeUnit(requestedUnit),...(quantity!==null?{requestedQuantity:quantity}:{}),resolution:'needs_unit',candidates:[product]};
  validateQuantity(product,quantity);
  if(pack&&['litre','kg'].includes(product.unit)&&(!product.sellingUnitVerified||!requestedUnit&&!evidence.requestedAmount))return {...evidence,packSize:pack,id,query,sku:product.sku,name:product.name,quantity:null,requestedQuantity:quantity??undefined,unit:product.unit,pricePaise:product.pricePaise,productVersion:product.version,resolution:'needs_unit',catalogIssue:'selling_unit_unverified',candidates:[product]};
  if(sellingBasisIssues(product).length)return {...evidence,...(pack?{packSize:pack}:{}),id,query,sku:product.sku,name:product.name,quantity:null,requestedQuantity:quantity??undefined,unit:product.unit,pricePaise:product.pricePaise,productVersion:product.version,resolution:'needs_unit',catalogIssue:'selling_unit_unverified',candidates:[product]};
  if(product.priceStatus==='confirm'||product.pricePaise===0&&product.priceStatus!=='free')return {...evidence,...(pack?{packSize:pack}:{}),id,query,sku:product.sku,name:product.name,quantity,unit:product.unit,pricePaise:product.pricePaise,productVersion:product.version,resolution:'unavailable',catalogIssue:'price_unverified',candidates:[product]};
  return {...evidence,...(pack?{packSize:pack}:{}), id,query,sku:product.sku,quantity,name:product.name,unit:product.unit,pricePaise:product.pricePaise,productVersion:product.version,
    ...(requestedUnit?{requestedUnit:normalizeUnit(requestedUnit)}:{}),...(product.stock===0?{catalogIssue:'out_of_stock' as const}:{}),resolution:quantity===null?'needs_quantity':product.stock===0?'unavailable':'matched',candidates:[product] };
}
async function resolveLine(client: PoolClient, ctx: ActorContext, query: string, quantity: number | null, id: string = randomUUID(),requestedUnit?:string,search?:DiscoveryPlan,evidence:LineEvidence={},previous?:DraftLine): Promise<DraftLine> {
  evidence=lineEvidence(evidence);
  if(evidence.sourceUncertainty?.includes('unreadable')&&!(previous&&query!==previous.query&&evidence.supportingPhrase))return {...evidence,id,query,quantity:null,name:query,resolution:'unavailable',catalogIssue:'unreadable',candidates:[]};
  if(await catalogEnabled(client,ctx)){
    let searchQuery=packSearchQuery(query,evidence.packSize);
    let discovery=evidence.productIntent?.kind==='ambiguous'?await discoverProductMeanings(client,ctx,query,evidence.productIntent):await discoverProducts(client,ctx,searchQuery,search);
    if(!discovery.products.length&&evidence.packSize&&evidence.productIntent?.kind!=='ambiguous'){
      const root=packSearchQuery(query,evidence.packSize,true);
      // Retry packaging wording only after the named product failed retrieval.
      // Real containers (watering cans, storage boxes) keep their first matches.
      if(root!==searchQuery){searchQuery=root;discovery=await discoverProducts(client,ctx,root,search);}
    }
    const oldFamily=previous?.candidates?.find(p=>p.sku===previous.sku)?.familyId;
    const proposedFamilies=new Set([...(search?.familyId?[search.familyId]:search?.familyIds??[]),...discovery.products.flatMap(p=>p.familyId?[p.familyId]:[])]);
    const replacement=!!previous&&!!oldFamily&&(proposedFamilies.size>0?!proposedFamilies.has(oldFamily):normalize(query)!==normalize(previous.query??previous.name));
    if(previous&&!replacement){const supplied=evidence;evidence={...lineEvidence(previous),...supplied};if(query!==previous.query&&!supplied.productIntent)delete evidence.productIntent;if(query!==previous.query&&supplied.supportingPhrase)delete evidence.sourceUncertainty;requestedUnit??=previous.requestedUnit;}
    if(evidence.productIntent?.kind==='ambiguous')return {...evidence,id,query,quantity,name:query,...(requestedUnit?{requestedUnit:normalizeUnit(requestedUnit)}:{}),resolution:'needs_choice',candidates:discovery.products,discovery};
    if(evidence.productMeasures){discovery.products=discovery.products.filter(p=>matchesProductMeasures(p,evidence.productMeasures!));const allowed=new Set(discovery.products.map(p=>p.sku));discovery.rankings=discovery.rankings.filter(r=>allowed.has(r.sku));if(!discovery.products.length)discovery.noExactMatch=true;}
    let retrievedProducts=[...discovery.products];
    if(evidence.packSize){
      const requested=evidence.packSize;
      discovery.products=discovery.products.filter(product=>{const verified=catalogPack(product);return verified&&sameUnit(requested.unit,verified.unit)&&requested.value===verified.value;});
      const allowed=new Set(discovery.products.map(product=>product.sku));
      discovery.rankings=discovery.rankings.filter(ranking=>allowed.has(ranking.sku));
      if(!discovery.products.length)discovery.noExactMatch=true;
    }
    if(!discovery.products.length&&evidence.packSize&&!evidence.productMeasures?.length){
      const pack=evidence.packSize;
      const strip=(text:string)=>packSearchQuery(packSearchQuery(text,parsePackSize(text),true),pack,true);
      const specifications=Object.fromEntries(Object.entries(search?.specifications??{}).filter(([,value])=>{const m=parsePackSize(value);return !m||m.value!==pack.value||!sameUnit(m.unit,pack.unit);}));
      const alternativePlan={...search,keywords:(search?.keywords??[query]).map(strip),specifications};
      const related=await discoverProducts(client,ctx,strip(query),alternativePlan);
      retrievedProducts=[...new Map([...retrievedProducts,...related.products].map(p=>[p.sku,p])).values()];
      if(related.products.length){
        const exact=related.products.filter(p=>{const actual=catalogPack(p);return actual&&sameUnit(actual.unit,pack.unit)&&actual.value===pack.value;});
        const allowed=new Set(exact.map(p=>p.sku));
        discovery={...related,products:exact,rankings:related.rankings.filter(r=>allowed.has(r.sku)),noExactMatch:!exact.length};
      }
    }
    // Keep a real identity match visible when only the pack dimension differs.
    // This is an alternative requiring a fresh customer choice, never a
    // litre/kg conversion or an automatically selected/quoted catalog item.
    if(!discovery.products.length&&evidence.packSize&&!evidence.productMeasures?.length){
      const requested=evidence.packSize;
      const alternatives=retrievedProducts.filter(product=>{const actual=catalogPack(product);return actual&&actual.value===requested.value&&!sameUnit(actual.unit,requested.unit)&&convertAmount(actual,requested.unit)===null;});
      if(alternatives.length){
        discovery={...discovery,products:alternatives,rankings:alternatives.map(p=>({sku:p.sku,score:0,match:'related' as const,reason:'Same requested product identity; pack unit differs and needs explicit selection'})),noExactMatch:true};
        return {...evidence,id,query,quantity,name:query,...(requestedUnit?{requestedUnit:normalizeUnit(requestedUnit)}:{}),resolution:'needs_choice',catalogIssue:'pack_unit_mismatch',packUnitAlternative:{requested},candidates:alternatives,discovery};
      }
    }
    const exact=discovery.products.filter(p=>exactProductMatch(searchQuery,p));
    if(!exact.length&&discovery.products.length===1&&evidence.packSize&&(!search?.familyId||search.familyId===discovery.products[0].familyId))exact.push(discovery.products[0]);
    if(exact.length===1&&!/^(?:cutter|blade|கட்டர்|பிளேடு)$/i.test(query.trim())){const line=resolvedLine(exact[0],quantity,query,id,requestedUnit,evidence);line.candidates=discovery.products;line.discovery=discovery;return line;}
    return {...evidence,id,query,quantity,name:query,...(requestedUnit?{requestedUnit:normalizeUnit(requestedUnit)}:{}),resolution:discovery.products.length?'needs_choice':'unavailable',candidates:discovery.products,discovery};
  }
  const candidates = await searchProducts(client,ctx,query);
  if(previous&&(query===previous.query||query===previous.sku||candidates.some(p=>p.sku===previous.sku)))evidence={...lineEvidence(previous),...evidence};
  if (candidates.length === 1&&exactProductMatch(query,candidates[0])&&!(candidates[0].unit==='box'&&/\d/.test(candidates[0].name)&&!/[\d½¾]/.test(query)&&normalize(query)!==normalize(candidates[0].sku))) return resolvedLine(candidates[0],quantity,query,id,requestedUnit,evidence);
  // A result set is retained, never silently reduced to the first product.
  return {...evidence, id,query,quantity,name:query,...(requestedUnit?{requestedUnit:normalizeUnit(requestedUnit)}:{}),resolution:candidates.length?'needs_choice':'unavailable',candidates:candidates.slice(0,10) };
}
export function referenceLine(state: ConversationState, reference: string): DraftLine {
  const identified=state.draft.filter(l=>l.id===reference||l.sku===reference);
  const result=identified.length?identified:state.draft.filter(l=>matches(reference,[l.name,l.query??'',...(l.candidates?.length===1?l.candidates[0].aliases:[])]));
  if (result.length!==1) throw new ToolError(result.length?'That reference matches several draft lines. Name the exact size/product.':'That item is not in the draft. No changes were applied.');
  return result[0];
}
export function renderDraft(state: ConversationState) {
  return state.draft.map((l,i) => `${i+1}. ${l.quantity===null?'':l.quantity+' × '}${lineName(l,state)}${l.resolution==='matched'&&l.pricePaise!==undefined?` — ${formatMoney(lineTotal(l.pricePaise,l.quantity!))}`:` — ${say(state,l.resolution.replaceAll('_',' '),({needs_choice:'பொருளைத் தேர்வு செய்ய வேண்டும்',needs_quantity:'எண்ணிக்கை வேண்டும்',needs_unit:'விற்பனை அலகு வேண்டும்',unavailable:'கடை சரிபார்க்க வேண்டும்'} as Record<string,string>)[l.resolution],({needs_choice:'Porulai choose pannanum',needs_quantity:'Quantity venum',needs_unit:'Virpanai unit venum',unavailable:'Kadai check pannanum'} as Record<string,string>)[l.resolution])}`}`).join('\n');
}
export function renderBill(state:ConversationState){
  return state.draft.map((line,index)=>`${index+1}. ${lineName(line,state)}\n   ${line.quantity} ${unitName(line.unit??'unit',state,line.quantity??1)} × ${formatMoney(line.pricePaise!)} = ${formatMoney(lineTotal(line.pricePaise!,line.quantity!))}`).join('\n\n');
}
function requestFromRow(row: Record<string,any>): OrderRequest {
  return {id:row.id,acceptance:row.acceptance,payment:row.payment,fulfillment:row.fulfillment,totalPaise:Number(row.effective_total_paise??row.total_paise),lines:row.effective_lines??row.lines,originalLines:row.lines,estimateComplete:row.estimate_complete,excludedLineIds:row.excluded_line_ids,advanceRequired:row.advance_required,advanceState:row.advance_state,effectiveRevision:row.effective_revision};
}

export class RetailTools {
  constructor(private pool: Pool,private options:{advance?:UpiAdvanceConfig;sequentialItems?:boolean;maxDraftLines?:number}={}) {}
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
    if(call.name==='estimate_order'){
      if(state.version!==call.args.expectedVersion)throw new ToolError('Your list changed. Please ask for the current estimate.','stale_version');
      const products=new Map((await client.query(`SELECT ${productColumns} FROM products WHERE store_id=$1 AND active=true AND sku=ANY($2::text[])`,[ctx.storeId,state.draft.flatMap(l=>l.sku?[l.sku]:[])])).rows.map(r=>{const p=productFromRow(r);return [p.sku,p] as const;}));
      let knownSubtotalPaise=0;const missingLineIds:string[]=[];
      for(const line of state.draft){const product=line.sku?products.get(line.sku):undefined;if(product&&sameUnit(product.unit,line.unit??'')&&line.quantity!==null&&product.priceStatus!=='confirm'&&(product.pricePaise>0||product.priceStatus==='free'))knownSubtotalPaise+=lineTotal(product.pricePaise,line.quantity);else missingLineIds.push(line.id);}
      const complete=state.draft.length>0&&!missingLineIds.length;
      const lines=state.draft.map(line=>{const product=line.sku?products.get(line.sku):undefined;return product?{...line,pricePaise:product.pricePaise,productVersion:product.version,candidates:[product]}:{...line,candidates:[]};});
      return {state,estimate:{knownSubtotalPaise,complete,missingLineIds,lines},message:say(state,complete?`Estimated total: ${formatMoney(knownSubtotalPaise)}.`:`Known-price subtotal: ${formatMoney(knownSubtotalPaise)}. ${missingLineIds.length} item(s) still need a price or quantity. You can send the list to the store for checking.`,complete?`உத்தேச மொத்தம்: ${formatMoney(knownSubtotalPaise)}.`:`தெரிந்த விலைகளின் கூட்டுத்தொகை: ${formatMoney(knownSubtotalPaise)}. ${missingLineIds.length} பொருட்களுக்கு விலை அல்லது எண்ணிக்கை தேவை. சரிபார்க்கப் பட்டியலைக் கடைக்கு அனுப்பலாம்.`,complete?`Estimate moththam: ${formatMoney(knownSubtotalPaise)}.`:`Therintha vilaikal subtotal: ${formatMoney(knownSubtotalPaise)}. ${missingLineIds.length} porutkalukku vilai illa count venum. List-ai kadaikku check panna anuppalaam.`)};
    }
    if(call.name==='request_store_assistance')return requestStoreAssistance(client,ctx,state,call.args.expectedVersion);
    if(call.name==='get_catalog_map')return {catalogMap:await getCatalogMap(client,ctx,call.args.departmentId,call.args),message:'Store departments and product families.'};
    if(call.name==='discover_products'){const discovery=await discoverProducts(client,ctx,call.args.query,call.args.search);return {discovery,products:discovery.products,totalCount:discovery.totalCount,message:'Check these catalog suggestions.'};}
    if(call.name==='search_products') {
      const products=await searchProducts(client,ctx,call.args.query);
      const product=products.length===1&&exactProductMatch(call.args.query,products[0])?products[0]:undefined;
      let quote:ToolResult['quote'];
      if(product&&product.priceStatus!=='confirm'&&(product.pricePaise>0||product.priceStatus==='free')&&call.args.quantity!==undefined){
        const count=!call.args.requestedUnit||sameUnit(call.args.requestedUnit,product.unit)?call.args.quantity:amountToCount({requestedAmount:{value:call.args.quantity,unit:call.args.requestedUnit}} as DraftLine,product);
        if(count!==null){validateQuantity(product,count);quote={quantity:count,unit:product.unit,totalPaise:lineTotal(product.pricePaise,count)};}
      }
      const mismatch=product&&call.args.requestedUnit&&!sameUnit(call.args.requestedUnit,product.unit)?` This item is priced per ${product.unit}, not ${call.args.requestedUnit}; the shop must confirm any conversion.`:'';
      return {quote,totalCount:products.length,products:products.slice(0,10),message:products.length?products.slice(0,5).map(p=>`${p.name}: ${productPriceText(p,'en')}. ${productStockText(p,'en')}.`).join('\n'):'No catalog match. Try a size or a more specific name.',...(mismatch?{message:`${product!.name}: ${formatMoney(product!.pricePaise)} / ${product!.unit}.${mismatch}`}:{})};
    }
    if(call.name==='get_draft') return {state,message:renderDraft(state)||'Your draft is empty.'};
    if(call.name==='get_order_status') {
      const id=call.args.requestId??state.lastRequestId;
      if(!id) return {request:null,message:'No submitted request in this conversation.'};
      const row=await client.query('SELECT r.*,(SELECT state FROM order_advances a WHERE a.request_id=r.id) AS advance_state FROM order_requests r WHERE r.id=$1 AND r.store_id=$2 AND r.conversation_id=$3 AND r.actor=$4',[id,ctx.storeId,ctx.conversationId,ctx.actor]);
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
        if(state.catalogDiscovery&&old.discovery){
          const eligible=await discoverProducts(client,ctx,old.discovery.query,old.discovery.plan);
          if(!eligible.products.some(p=>p.sku===choice.sku))throw new ToolError('That option no longer matches the requested item. Review the latest choices.','stale_confirmation');
        }
        const alternative=old.packUnitAlternative&&!old.packUnitAlternative.acceptedSku;
        const evidence=alternative?{...old,packSize:catalogPack(product)}:old;
        const line=resolvedLine(product,old.requestedQuantity??old.quantity,old.query??product.name,old.id,old.requestedUnit,evidence);
        if(old.packUnitAlternative)line.packUnitAlternative={...old.packUnitAlternative,acceptedSku:product.sku};
        markProductConfirmed(line,product);state.draft[index]=line;
      }
      state.version++;
      if(state.visualOrdering&&productCheckCoversDraft(state,pending)&&call.args.choices.length===state.draft.length){state.productReview={version:state.version,hash:productListHash(state)};}
      state.pending=null;await saveState(client,ctx,state);
      return {state,message:'Product choices accepted. Nothing has been sent to the shop.'};
    }
    if(call.name==='apply_draft_changes') {
      if(state.lastRequestId) throw new ToolError('This conversation has a submitted request. Ask the shop for an amendment; the submitted snapshot cannot be edited.');
      if(call.args.expectedVersion!==state.version) throw new ToolError('The draft changed. Review it and try the action again.','stale_version');
      for(const op of call.args.operations) {
        if(op.kind==='set_fulfillment') { state.fulfillment=op.method; continue; }
        if(op.kind==='add_item') {
          const line=await resolveLine(client,ctx,op.query,op.quantity,undefined,op.requestedUnit,op.search,{sourceUncertainty:op.sourceUncertainty,requestedBudgetPaise:op.requestedBudgetPaise,packSize:op.packSize,productMeasures:op.productMeasures,productIntent:op.productIntent,requestedAmount:op.requestedAmount,amountMode:op.amountMode,supportingPhrase:op.supportingPhrase,quantityEvidenceVersion:state.visualOrdering?1:undefined});
          if(ctx.selectedCatalogSku===line.sku&&line.candidates?.some(p=>p.sku===line.sku)&&ctx.selectedCatalogProduct&&productIdentity(ctx.selectedCatalogProduct)===productIdentity(line.candidates.find(p=>p.sku===line.sku)!))markProductConfirmed(line,line.candidates.find(p=>p.sku===line.sku)!);
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
          if(state.catalogDiscovery&&old.discovery&&op.query&&old.candidates?.some(p=>p.sku===op.query)){
            const eligible=await discoverProducts(client,ctx,old.query??old.name,old.discovery.plan);
            if(!eligible.products.some(p=>p.sku===op.query))throw new ToolError('That option no longer matches the requested item. Review the latest choices.','stale_confirmation');
          }
          if(old.resolution==='needs_unit'&&op.quantity!==undefined&&!op.requestedUnit)throw new ToolError(`Please include the unit, for example 2 ${old.unit??'units'}. I can’t convert ${old.requestedUnit??'the requested amount'} without a verified pack size or length.`);
          const next=await resolveLine(client,ctx,op.query??old.sku??old.query??old.name,op.quantity??old.requestedQuantity??old.quantity,old.id,op.requestedUnit??(!op.query?old.requestedUnit:undefined),op.search??(!op.query?old.discovery?.plan:undefined),{sourceUncertainty:op.sourceUncertainty,requestedBudgetPaise:op.requestedBudgetPaise,packSize:op.packSize,productMeasures:op.productMeasures,productIntent:op.productIntent,requestedAmount:op.requestedAmount,amountMode:op.amountMode,supportingPhrase:op.supportingPhrase,quantityEvidenceVersion:state.visualOrdering?1:undefined},old);
          if(!op.query)next.query=old.query??old.name;
          state.draft[index]=preserveConfirmation(old,next);
          if(ctx.selectedCatalogSku===next.sku&&next.candidates?.some(p=>p.sku===next.sku)&&ctx.selectedCatalogProduct&&productIdentity(ctx.selectedCatalogProduct)===productIdentity(next.candidates.find(p=>p.sku===next.sku)!))markProductConfirmed(next,next.candidates.find(p=>p.sku===next.sku)!);
        } else {
          const line=referenceLine(state,op.reference);
          if(op.kind==='remove_item') state.draft=state.draft.filter(l=>l.id!==line.id);
          else if(op.kind==='set_amount'||op.kind==='increment_amount'){
            const [product]=line.sku?await searchProducts(client,ctx,line.sku):[];
            let amount=op.kind==='set_amount'?op.amount:op.delta;
            if(op.kind==='increment_amount'){
              const content=product?catalogContent(product):undefined;
              const current=line.requestedAmount??(content&&product?.sellingUnitVerified&&line.quantity!==null?{value:content.value*line.quantity,unit:content.unit}:undefined);
              const base=current?convertAmount(current,op.delta.unit):null;
              if(base===null)throw new ToolError('Tell me the total requested amount first. The selling basis is not verified.','amount_unknown');
              amount={value:Math.round((base+op.delta.value)*1000000)/1000000,unit:op.delta.unit};
            }
            if(amount.value>100000)throw new ToolError('Tell the shop about this large requested amount.','quantity_limit');
            const evidence:LineEvidence={...lineEvidence(line),requestedAmount:amount,amountMode:op.kind==='set_amount'?op.mode??'total':line.amountMode??'total',supportingPhrase:op.supportingPhrase,quantityEvidenceVersion:1};
            // Amount-only edits preserve the matched SKU and its specifications.
            // A legacy unbound line is re-matched without its old mistaken length.
            const next=product?resolvedLine(product,null,line.query??line.name,line.id,undefined,evidence):await resolveLine(client,ctx,line.query??line.name,null,line.id,undefined,undefined,{requestedAmount:amount,amountMode:evidence.amountMode,supportingPhrase:op.supportingPhrase,quantityEvidenceVersion:1});
            delete line.requestedQuantity;delete line.requestedUnit;delete line.catalogIssue;
            if(!product){delete line.productMeasures;delete line.packSize;delete line.productIntent;delete line.discovery;delete line.sku;delete line.productConfirmation;}
            state.draft[state.draft.findIndex(l=>l.id===line.id)]=preserveConfirmation(line,next);
          }
          else {
            delete line.budgetCountDerived;
            if(line.resolution==='needs_unit'&&!line.requestedAmount)throw new ToolError('Please state the quantity and catalog unit together before changing this item.');
            const nextQuantity=op.kind==='increment_quantity'?line.quantity===null?undefined:Math.round((line.quantity+op.delta)*1000)/1000:op.quantity;
            if(nextQuantity===undefined)throw new ToolError('Tell me the total quantity for this item first.','quantity_unknown');
            if(nextQuantity>100)throw new ToolError('The resulting quantity exceeds 100. Tell the shop the required amount.','quantity_limit');
            if(line.sku) {
              const [product]=await searchProducts(client,ctx,line.sku);
              if(!product) throw new ToolError('The product is no longer available in the catalog.');
              if(line.requestedAmount){delete line.requestedAmount;delete line.amountMode;delete line.requestedUnit;delete line.requestedQuantity;delete line.catalogIssue;}
              const updated=preserveConfirmation(line,resolvedLine(product,nextQuantity,line.query??line.name,line.id,line.requestedUnit,line));
              delete line.productConfirmation;Object.assign(line,updated);
            } else { line.quantity=nextQuantity; }
          }
        }
      }
      const limit=state.visualOrdering?(this.options.maxDraftLines??50):state.requireProductConfirmation?20:10;
      if(state.draft.length>limit) throw new ToolError(`Maximum ${limit} distinct lines. Split the request; no partial list was applied.`);
      if(state.visualOrdering){const questionLineId=state.pending?.kind==='question'?state.pending.lineId:undefined;const answeringCount=!!questionLineId&&call.args.operations.every(op=>(op.kind==='resolve_line'&&!op.query&&op.lineId===questionLineId)||(op.kind==='set_quantity'&&op.reference===questionLineId));if(!answeringCount)state.productReview=null;}
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
        if(line.quantity===null&&!line.sourceUncertainty?.includes('quantity')&&!line.requestedAmount&&['needs_quantity','needs_choice'].includes(line.resolution)&&line.supportingPhrase){
          const count=explicitPurchaseCount(line.supportingPhrase);if(count!==undefined){line.quantity=count;refreshed=true;}
        }
        if(!line.sku) {
          if(line.resolution==='unavailable'&&line.productMeasures?.length&&line.supportingPhrase&&/\b(?:this|that|indha|intha)\b|இந்த|இது/i.test(line.supportingPhrase)){
            const previous=(await client.query(`SELECT card->'product'->>'sku' AS sku FROM
              (SELECT payload,sequence FROM messages WHERE conversation_id=$1 AND direction='outbound' ORDER BY sequence DESC LIMIT 20) m
              CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(m.payload->'parts')='array' THEN m.payload->'parts' ELSE '[]'::jsonb END) part
              CROSS JOIN LATERAL jsonb_array_elements(part->'cards') card
              WHERE card->>'kind'='product' AND card->>'lineId'=$2 ORDER BY m.sequence DESC LIMIT 1`,[ctx.conversationId,line.id])).rows[0];
            const [known]=previous?await searchProducts(client,ctx,previous.sku):[];
            if(known){
              const bound={...line,sku:known.sku,candidates:[known]};
              const plan=normalizeAmountEdits({next:'review',operations:[{kind:'resolve_line',lineId:line.id,query:line.query,productMeasures:line.productMeasures,supportingPhrase:line.supportingPhrase}]},line.supportingPhrase,{...state,draft:state.draft.map(l=>l.id===line.id?bound:l)});
              const op=plan.operations[0];
              if(op.kind==='set_amount'){
                const recovered=resolvedLine(known,null,line.query??line.name,line.id,undefined,{requestedAmount:op.amount,amountMode:op.mode,supportingPhrase:op.supportingPhrase,quantityEvidenceVersion:1});
                state.draft[state.draft.findIndex(l=>l.id===line.id)]=recovered;refreshed=true;continue;
              }
            }
          }
          if(state.requireProductConfirmation){const next=await resolveLine(client,ctx,line.query??line.name,line.quantity,line.id,line.requestedUnit,line.discovery?.plan,line);if(line.shopCheckDeferred&&next.resolution!=='matched')next.shopCheckDeferred=true;if(digest(next)!==digest(line)){delete line.shopCheckDeferred;Object.assign(line,next);refreshed=true;}}
          continue;
        }
        const [product]=await searchProducts(client,ctx,line.sku);
        if(!product) { if(line.resolution!=='unavailable'||line.candidates?.length||line.productConfirmation) {line.resolution='unavailable';line.candidates=[];delete line.productConfirmation;refreshed=true;} continue; }
        const current=preserveConfirmation(line,resolvedLine(product,line.requestedQuantity??line.quantity,line.query??line.name,line.id,line.requestedUnit,line));
        if(state.catalogDiscovery&&!productConfirmed(line,product)){const discovery=await discoverProducts(client,ctx,line.query??line.name,line.discovery?.plan);current.candidates=discovery.products;current.discovery=discovery;}
        if(product.stock!==null&&current.quantity!==null&&product.stock<current.quantity){current.resolution='unavailable';current.catalogIssue=product.stock===0?'out_of_stock':'insufficient_stock';}
        if(line.shopCheckDeferred&&current.resolution!=='matched')current.shopCheckDeferred=true;
        if(digest(current)!==digest(line)) {state.draft[state.draft.findIndex(l=>l.id===line.id)]=current;refreshed=true;}
      }
      if(refreshed) state.version++;
      if(call.args.allowPartial){
        if(!state.allowPartialReview)throw new ToolError('Partial order review is not enabled for this conversation.');
        const unconfirmed=!!state.requireProductConfirmation&&state.draft.some(line=>counterLine(line).product&&!productConfirmed(line));
        if(unconfirmed){
          const check=makeProductCheck(state,!!this.options.sequentialItems);
          if(check){state.pending=check;await saveState(client,ctx,state);return {state,message:'Check the product photos before reviewing the estimate.'};}
          throw new ToolError('Check the product photos before reviewing the estimate.');
        }
        const estimate=estimateLines(state.draft);
        const snapshot={lines:state.draft,fulfillment:state.fulfillment,totalPaise:estimate.knownSubtotalPaise,excludedLineIds:estimate.excludedLineIds,...(this.options.advance?{advanceRequired:true}:{} )};
        state.pending={kind:'review',id:randomUUID(),version:state.version,hash:digest(snapshot),expiresAt:new Date(Date.now()+15*60*1000).toISOString(),...snapshot};
        await saveState(client,ctx,state);
        return {state,message:estimateText(state,state.draft,!!this.options.advance)};
      }

      // A missing pipe type cannot be settled by approving the current PVC
      // photos. Ask for that type before showing any product-review batch.
      const active=state.visualOrdering?nextCounterLine(state):undefined;
      const pipeTypeLine=state.visualOrdering
        ?active&&!active.sku&&active.productIntent?.kind!=='ambiguous'&&needsPipeType(active.query??active.name)?active:undefined
        :state.draft.find(l=>!l.sku&&l.productIntent?.kind!=='ambiguous'&&needsPipeType(l.query??l.name));
      const missingCount=state.visualOrdering&&!pipeTypeLine&&!state.draft.some(l=>!l.sku&&!l.shopCheckDeferred&&l.candidates?.length||l.productIntent?.kind==='ambiguous')
        ?state.draft.find(l=>l.sku&&!l.shopCheckDeferred&&l.resolution==='needs_quantity'&&l.quantity===null&&l.requestedQuantity===undefined&&!l.requestedAmount):undefined;
      if(missingCount){
        state.pending={kind:'question',id:randomUUID(),lineId:missingCount.id,version:state.version};await saveState(client,ctx,state);
        return {state,message:say(state,`How many ${missingCount.unit??'packs'} of ${lineName(missingCount,state)}?`,`${lineName(missingCount,state)} — எத்தனை ${unitName(missingCount.unit??'unit',state)} வேணும்?`,`${lineName(missingCount,state)} — eththanai ${missingCount.unit??'packs'} venum?`)};
      }
      if(state.requireProductConfirmation&&!pipeTypeLine) {
        const check=makeProductCheck(state,!!this.options.sequentialItems);
        if(check){state.pending=check;await saveState(client,ctx,state);return {state,message:'Check the products before adding them to your list.'};}
      }
      const unresolved=pipeTypeLine??(state.visualOrdering?active:undefined)??state.draft.find(l=>l.resolution!=='matched'&&!l.shopCheckDeferred)??state.draft.find(l=>l.resolution!=='matched');
      if(unresolved) {
        state.pending={kind:'question',id:randomUUID(),lineId:unresolved.id,version:state.version};
        await saveState(client,ctx,state);
        const question=!unresolved.sku&&needsPipeType(unresolved.query??unresolved.name)?`Which kind of pipe do you mean for “${unresolved.query??unresolved.name}”? Tell me its material or use (for example rigid PVC versus a flexible water pump hose), diameter and length if known. I have kept your requested quantity; the shop must check availability.`:unresolved.resolution==='needs_quantity'?`How many ${unresolved.unit??'units'} of ${unresolved.name}?`:unresolved.resolution==='needs_choice'?`Choose the exact product for “${unresolved.query}”:\n${(unresolved.candidates??[]).map((p,i)=>`${i+1}. ${p.name} — ${formatMoney(p.pricePaise)}`).join('\n')}`:`“${unresolved.name}” is unavailable or unmatched. Give another specification or remove this line.`;
        return {state,message:`${renderDraft(state)}\n\n${question} Other lines are retained. No request submitted.`};
      }
      const totalPaise=state.draft.reduce((sum,l)=>sum+lineTotal(l.pricePaise!,l.quantity!),0);
      const snapshot={lines:state.draft,fulfillment:state.fulfillment,totalPaise,...(this.options.advance?{advanceRequired:true}:{} )};
      state.pending={kind:'review',id:randomUUID(),version:state.version,hash:digest(snapshot),expiresAt:new Date(Date.now()+15*60*1000).toISOString(),...snapshot};
      await saveState(client,ctx,state);
      return {state,message:`${refreshed?'Catalog facts changed; please review the updated request.\n':''}${renderDraft(state)}\nTotal: ${formatMoney(totalPaise)}. Pickup.\nShall I send this request to the shop? Reply yes or confirm this review. Availability needs shop approval; stock is not reserved.`};
    }
    // Only this tool can create a request. No staff/payment/readiness action exists in this customer registry.
    if(call.name!=='submit_order_request')throw new ToolError('Unsupported customer tool.');
    const pending=state.pending;
    if(state.visualOrdering&&!partialReview(state.pending)&&state.productReview?.hash!==productListHash(state))throw new ToolError('Check the complete product list again.','stale_confirmation');
    if(!pending||pending.kind!=='review'||pending.id!==call.args.reviewId||pending.version!==state.version||Date.parse(pending.expiresAt)<=Date.now()) throw new ToolError('There is no current unexpired review for that confirmation. Review the draft first.','stale_confirmation');
    if(digest({lines:state.draft,fulfillment:state.fulfillment,totalPaise:pending.totalPaise,...(pending.excludedLineIds?{excludedLineIds:pending.excludedLineIds}:{}),...(pending.advanceRequired?{advanceRequired:true}:{})})!==pending.hash) throw new ToolError('Review snapshot changed; review again.','stale_confirmation');
    if(pending.advanceRequired&&!this.options.advance)throw new ToolError('Advance payment configuration changed. Review the list again.');
    for(const line of state.draft) {
      if(pending.excludedLineIds?.includes(line.id)){
        if(line.sku){const [current]=await searchProducts(client,ctx,line.sku);if(!current||current.version!==line.productVersion||state.requireProductConfirmation&&!productConfirmed(line,current))throw new ToolError('Product details changed. Review the list again.','stale_confirmation');}
        continue;
      }
      const [product]=await searchProducts(client,ctx,line.sku!);
      if(line.resolution!=='matched'||!product||sellingBasisIssues(product).length||(state.requireProductConfirmation&&!productConfirmed(line,product))||product.version!==line.productVersion||product.pricePaise!==line.pricePaise||(product.stock!==null&&product.stock<line.quantity!)) {
        state.pending=null; await saveState(client,ctx,state);
        return {state,message:'Price or availability changed after the review. No request submitted. Review the draft again.'};
      }
    }
    const id=randomUUID();
    const row=await client.query('INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise,pickup_method) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *',[id,ctx.storeId,ctx.conversationId,ctx.actor,pending.id,JSON.stringify(pending.lines),pending.totalPaise,pending.fulfillment]);
    await client.query('UPDATE order_requests SET estimate_complete=$1,excluded_line_ids=$2::jsonb WHERE id=$3',[!pending.excludedLineIds?.length,JSON.stringify(pending.excludedLineIds??[]),id]);
    if(pending.advanceRequired&&this.options.advance)await createUpiAdvance(client,ctx,id,pending.id,this.options.advance);
    state.pending=null;state.lastRequestId=id;state.version++;
    await saveState(client,ctx,state);
    return {state,request:requestFromRow((await client.query('SELECT * FROM order_requests WHERE id=$1',[id])).rows[0]),message:`Request ${id} received. Waiting for the shop to confirm. Payment has not been requested; packing and readiness require shop actions.`};
  }
}
