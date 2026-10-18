import {turnUnderstandingSchema,type TurnUnderstanding} from './understanding.js';
import { z } from 'zod';
import {discoveryPlanSchema,type DiscoveryPlan,type DiscoveryResult,type CatalogMap,type DiscoveryFacet} from './discovery.js';
export {discoveryPlanSchema,type DiscoveryPlan,type DiscoveryResult,type CatalogMap,type DiscoveryFacet} from './discovery.js';
export type {ReplyLanguage,LocalNames} from './language.js';
export { formatMoney } from './money.js';
const quantity = z.number().min(0.001).max(100).refine(q => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-7, 'Use at most three decimal places');
export const MAX_DRAFT_LINES = 50;
const measure = z.object({value:z.number().positive().max(100000),unit:z.string().trim().min(1).max(30)}).strict();
const dimension=measure.extend({role:z.enum(['size','diameter','length','width','height','thickness']).optional()});
const query = z.string().trim().min(1).max(200);
export const productIntentSchema=z.object({
  kind:z.enum(['inferred','ambiguous']),
  sourcePhrase:z.string().trim().min(1).max(500),
  useCase:z.string().trim().min(1).max(200).optional(),
  alternatives:z.array(z.object({query,familyId:z.string().trim().min(1).max(120)}).strict()).min(2).max(3).optional(),
  question:z.string().trim().min(1).max(180).optional(),
}).strict().refine(i=>i.kind==='ambiguous'?!!i.alternatives&&!i.alternatives.some((a,n)=>i.alternatives!.slice(0,n).some(b=>b.familyId===a.familyId)):!i.alternatives,'Ambiguous product meanings require distinct catalog families');
export type ProductIntent=z.infer<typeof productIntentSchema>;
const evidence = {sourceUncertainty:z.array(z.string().trim().min(1).max(40)).max(7).optional(),requestedBudgetPaise:z.number().int().positive().max(100000000).optional(),packSize:measure.optional(),productMeasures:z.array(dimension).min(1).max(6).optional(),requestedAmount:measure.optional(),amountMode:z.enum(['total','continuous']).optional(),supportingPhrase:z.string().trim().min(1).max(500).optional(),productIntent:productIntentSchema.optional()};
export const operationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add_item'), query, quantity: quantity.nullable(), ...evidence, requestedUnit: query.optional(), search:discoveryPlanSchema.optional() }).strict(),
  z.object({ kind: z.literal('set_quantity'), reference: query, quantity, supportingPhrase:query.optional() }).strict(),
  z.object({ kind: z.literal('remove_item'), reference: query, supportingPhrase:z.string().trim().min(1).max(500).optional() }).strict(),
  z.object({ kind: z.literal('resolve_line'), lineId: z.uuid(), query: query.optional(), quantity: quantity.optional(), ...evidence, requestedUnit: query.optional(), search:discoveryPlanSchema.optional() }).strict(),
  z.object({ kind: z.literal('set_fulfillment'), method: z.literal('pickup') }).strict(),
  z.object({kind:z.literal('increment_quantity'),reference:query,delta:quantity,supportingPhrase:query}).strict(),
  z.object({kind:z.literal('set_amount'),reference:query,amount:measure,mode:z.enum(['total','continuous']).optional(),supportingPhrase:z.string().trim().min(1).max(500)}).strict(),
  z.object({kind:z.literal('increment_amount'),reference:query,delta:measure,supportingPhrase:z.string().trim().min(1).max(500)}).strict(),
]);
export const interpretationSchema = z.object({ understanding:turnUnderstandingSchema.optional(), transcript:z.string().trim().min(1).max(4000).optional(), operations: z.array(operationSchema).max(MAX_DRAFT_LINES * 2), estimateRequested:z.boolean().optional(), next: z.enum(['review', 'continue', 'price','assist']), priceQuery: query.optional(), priceQuantity: quantity.optional(), priceUnit: query.optional(), conversation: z.enum(['greeting','thanks','help','handoff','browse','pause','shop_question','unrelated']).optional(), shopQuestions: z.array(z.enum(['delivery','discount','hours','technical','availability','location'])).max(5).optional(), clarifyQuestion: z.string().trim().max(180).optional(), assistance:z.object({quantity:quantity.optional(),requestedUnit:query.optional(),rootQuery:query.optional(),queries:z.array(query).min(1).max(3),lineId:z.uuid().optional(),question:z.string().trim().min(1).max(180).optional(),search:discoveryPlanSchema.optional()}).strict().optional() }).strict().refine(x => x.next !== 'price' || (x.priceQuery && x.operations.length === 0), 'Price requests must be read-only').refine(x=>x.next==='assist'?!!x.assistance&&x.operations.length===0:!x.assistance,'Assistance is a read-only search plan');
export type Interpretation = z.infer<typeof interpretationSchema>;
export type Operation = z.infer<typeof operationSchema>;
export const toolCallSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('search_products'), args: z.object({ query, quantity: quantity.optional(), requestedUnit: query.optional() }).strict() }).strict(),
  z.object({name:z.literal('get_catalog_map'),args:z.object({departmentId:query.optional(),search:query.optional(),departmentAfter:query.optional(),familyAfter:query.optional()}).strict()}).strict(),
  z.object({name:z.literal('discover_products'),args:z.object({query,search:discoveryPlanSchema.optional()}).strict()}).strict(),
  z.object({name:z.literal('estimate_order'),args:z.object({expectedVersion:z.number().int().min(0)}).strict()}).strict(),
  z.object({name:z.literal('request_store_assistance'),args:z.object({expectedVersion:z.number().int().min(0)}).strict()}).strict(),
  z.object({ name: z.literal('get_draft'), args: z.object({}).strict() }).strict(),
  z.object({ name: z.literal('apply_draft_changes'), args: z.object({ expectedVersion: z.number().int().min(0), operations: z.array(operationSchema).min(1).max(MAX_DRAFT_LINES * 2) }).strict() }).strict(),
  z.object({ name: z.literal('preview_order'), args: z.object({ expectedVersion: z.number().int().min(0),allowPartial:z.boolean().optional() }).strict() }).strict(),
  z.object({ name: z.literal('submit_order_request'), args: z.object({ reviewId: z.uuid() }).strict() }).strict(),
  z.object({ name: z.literal('get_order_status'), args: z.object({ requestId: z.uuid().optional() }).strict() }).strict(),
  z.object({name:z.literal('confirm_product_choices'),args:z.object({batchId:z.uuid(),choices:z.array(z.object({lineId:z.uuid(),sku:query}).strict()).min(1).max(MAX_DRAFT_LINES)}).strict()}).strict(),
]);
export type ToolCall = z.infer<typeof toolCallSchema>;
export const eventSchema = z.discriminatedUnion('type', [
  z.object({id:z.uuid(),type:z.literal('resolve_keep_target'),memoryId:z.uuid(),targetIndex:z.number().int().min(0).max(49),lineId:z.uuid(),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({id:z.uuid(),type:z.literal('voice'),mediaId:z.uuid()}).strict(),
  z.object({id:z.uuid(),type:z.literal('retry_voice'),mediaId:z.uuid(),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({id:z.uuid(),type:z.literal('image'),mediaId:z.uuid(),caption:z.string().trim().max(1000).default('')}).strict(),
  z.object({id:z.uuid(),type:z.literal('change_language'),language:z.enum(['ta','ta-Latn','en'])}).strict(),
  z.object({ id: z.uuid(), type: z.literal('text'), text: z.string().trim().min(1).max(4000) }).strict(),
  z.object({id:z.uuid(),type:z.literal('browse'),query:query,expectedVersion:z.number().int().min(0)}).strict(),
  z.object({id:z.uuid(),type:z.literal('choose_product'),sku:query,quantity:quantity.optional(),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({id:z.uuid(),type:z.literal('quote_product'),sku:query,quantity:quantity.optional(),requestedUnit:query.optional(),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({ id: z.uuid(), type: z.literal('add_item'), sku: z.string().min(1).max(80), quantity: z.number().int().min(1).max(100), expectedVersion: z.number().int().min(0) }).strict(),
  z.object({ id: z.uuid(), type: z.literal('set_quantity'), lineId: z.uuid(), quantity: z.union([z.literal(0),quantity]), expectedVersion: z.number().int().min(0) }).strict(),
  z.object({id:z.uuid(),type:z.literal('shopping_action'),action:z.enum(['browse','help','handoff','edit_list','keep_list','view_products','edit_quote','confirm_clear','status','new_list','options','next_item','continue_list','finish_order']),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({id:z.uuid(),type:z.literal('edit_item'),lineId:z.uuid(),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({id:z.uuid(),type:z.literal('choose_pipe_type'),lineId:z.uuid(),questionId:z.uuid(),pipeType:z.enum(['pvc','hose','pump']),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({id:z.uuid(),type:z.literal('review_partial'),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({id:z.uuid(),type:z.literal('confirm_amendment'),amendmentId:z.uuid(),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({id:z.uuid(),type:z.literal('discard_amendment'),amendmentId:z.uuid(),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({id:z.uuid(),type:z.literal('confirm_order_quote'),quoteId:z.uuid(),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({id:z.uuid(),type:z.literal('payment_claim'),requestId:z.uuid(),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({id:z.uuid(),type:z.literal('show_payment_qr'),requestId:z.uuid(),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({id:z.uuid(),type:z.literal('pay_at_shop'),requestId:z.uuid(),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({ id: z.uuid(), type: z.literal('review'), expectedVersion: z.number().int().min(0) }).strict(),
  z.object({ id: z.uuid(), type: z.literal('confirm'), reviewId: z.uuid() }).strict(),
  z.object({ id: z.uuid(), type: z.literal('select_candidate'), questionId: z.uuid(), lineId: z.uuid(), sku: z.string().min(1).max(80) }).strict(),
  z.object({id:z.uuid(),type:z.literal('refine_discovery'),memoryId:z.uuid(),facet:query,value:query}).strict(),
  z.object({id:z.uuid(),type:z.literal('refine_search'),batchId:z.uuid(),lineId:z.uuid(),facet:query,value:query}).strict(),
  z.object({id:z.uuid(),type:z.literal('select_product'),batchId:z.uuid(),lineId:z.uuid(),sku:query}).strict(),
  z.object({id:z.uuid(),type:z.literal('confirm_products'),batchId:z.uuid()}).strict(),
]);
export type SimulatorEvent = z.infer<typeof eventSchema>;
export type Product = {indicativePrice?:import('./indicative-prices.js').IndicativePrice;sellingPolicy?:import('zod').infer<typeof import('./selling-units.js').sellingPolicySchema>; sku: string; name: string; localNames?:import('./language.js').LocalNames; unit: string; pricePaise: number;priceStatus?:'priced'|'confirm'|'free';sellingUnitVerified?:boolean; stock: number | null; stockOnHand?:number|null;stockReserved?:number;inventoryVersion?:number; version: number; aliases: string[]; quantityStep: number; category?:string; imageUrl?:string;imageReference?:boolean;familyId?:string;brand?:string;specifications?:Record<string,string>;keywords?:string[] };
export type DraftLine = {merchantConfirmed?:{actor:string;at:string;free:boolean;saleMode?:'pack'|'measured'};budgetCountDerived?:true;sourceUncertainty?:string[];requestedBudgetPaise?:number; id: string; query?: string; sku?: string; quantity: number | null; name: string; unit?: string; pricePaise?: number; productVersion?: number; requestedUnit?:string; requestedQuantity?:number;packSize?:{value:number;unit:string};productMeasures?:{value:number;unit:string;role?:'size'|'diameter'|'length'|'width'|'height'|'thickness'}[];productIntent?:ProductIntent;requestedAmount?:{value:number;unit:string};amountMode?:'total'|'continuous';supportingPhrase?:string;quantityEvidenceVersion?:1;packUnitAlternative?:{requested:{value:number;unit:string};acceptedSku?:string};catalogIssue?:'pack_unit_mismatch'|'price_unverified'|'selling_unit_unverified'|'out_of_stock'|'amount_unverified'|'cutting_required'|'continuous_length'|'insufficient_stock'|'budget_unverified'|'unreadable'; discovery?:DiscoveryResult;shopCheckDeferred?:true;productConfirmation?:{sku:string;version:number;identityHash:string}; resolution: 'matched' | 'needs_choice' | 'needs_quantity' | 'needs_unit' | 'unavailable'; candidates?: Product[] };
export type ProductCheck={kind:'products';id:string;version:number;expiresAt:string;groups:{lineId:string;products:Product[];discovery?:DiscoveryResult}[];remaining:number;completeReview?:true;listHash?:string};
export type Pending = { kind: 'question'; id: string; lineId: string; version: number } | ProductCheck | { kind: 'review'; id: string; version: number; hash: string; expiresAt: string; lines: DraftLine[]; totalPaise: number; fulfillment: 'pickup';excludedLineIds?:string[];advanceRequired?:boolean };
export type ConversationState = {allowPartialReview?:boolean;languageExplicit?:boolean; replyLanguage?:import('./language.js').ReplyLanguage; visualOrdering?:boolean;productReview?:{version:number;hash:string}|null;version: number; draft: DraftLine[]; pending: Pending | null; fulfillment: 'pickup'; lastRequestId: string | null;requireProductConfirmation?:true;catalogDiscovery?:true;editingLineId?:string|null;handoffRequested?:boolean };
export type OrderRequest = {estimateComplete?:boolean;excludedLineIds?:string[];advanceRequired?:boolean;advanceState?:string;effectiveRevision?:number;originalLines?:DraftLine[]; id: string; acceptance: 'awaiting_approval'|'accepted'|'rejected'; payment: 'not_requested'|'creating'|'pending'|'paid'|'failed'|'expired'|'cancelled'|'unknown'|'refund_pending'|'refunded'|'conflicting'; fulfillment: 'awaiting_approval'|'preparing'|'ready_for_pickup'|'collected'|'cancelled'; totalPaise: number; lines: DraftLine[] };
export type Snapshot = { mode: 'mock'; provider: string; catalog: Product[]; conversation: ConversationState; messages: { id: string; direction: string; text: string; status: string; createdAt?:string; voice?:{mediaId:string;durationSeconds:number}; image?:{mediaId:string}; rich?:RichReply }[]; pending: number; requests: OrderRequest[]; interpretationAttempts: number;catalogMap?:CatalogMap;discoveryBindingId?:string };

export type ProductCard={product:Product;action?:SimulatorEvent;label:string;requestLabel?:string;quantityLabel?:string;matchLabel?:string;detailLabel?:string};
export type RichReply={compactReview?:boolean;accessibleText?:string;audio?:{url:string};readOnly?:true;version:1;contextLines?:string[];storeName?:string;replyLanguage?:import('./language.js').ReplyLanguage;kind:'text'|'product_choices'|'order_review';text:string;cards?:ProductCard[];buttons?:{label:string;event:SimulatorEvent}[];presentation:'text'|'single_product'|'carousel_preview'|'list';outboundMessages:number;deliveryEstimate?:{category:'service';ratePaise:number;totalPaise:number;rateMicroInr?:number;totalMicroInr?:number;estimateOnly?:true};stage?:'welcome'|'identify'|'products'|'quantity'|'bill'|'correction'|'shop_check'|'submitted'|'status'|'returning'|'error';clarificationReason?:string;parts?:ReplyPart[];groupId?:string;partIndex?:number;partCount?:number;remainingChoices?:number;handoffRequested?:true};

export type VisualCard={kind:'product';lineId?:string;product:Product;caption:string;buttons?:NonNullable<RichReply['buttons']>}|{kind:'instruction'|'bill'|'status';reviewGuide?:boolean;invoiceType?:'estimate'|'quote';footer?:string;imageUrl?:string;storeName?:string;title:string;lines:string[];caption:string;buttons?:NonNullable<RichReply['buttons']>;billRows?:{name:string;packSize:string;count:string;unitPrice:string;total:string}[];total?:string;reference?:string};
export type ReplyPart={id:string;cards:VisualCard[];text:string;buttons?:NonNullable<RichReply['buttons']>};
