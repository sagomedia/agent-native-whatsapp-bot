import { z } from 'zod';
import {discoveryPlanSchema,type DiscoveryPlan,type DiscoveryResult,type CatalogMap,type DiscoveryFacet} from './discovery.js';
export {discoveryPlanSchema,type DiscoveryPlan,type DiscoveryResult,type CatalogMap,type DiscoveryFacet} from './discovery.js';
export type {ReplyLanguage,LocalNames} from './language.js';
export { formatMoney } from './money.js';
const quantity = z.number().min(0.001).max(100).refine(q => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-7, 'Use at most three decimal places');
const query = z.string().trim().min(1).max(200);
export const operationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add_item'), query, quantity: quantity.nullable(), requestedUnit: query.optional(), search:discoveryPlanSchema.optional() }).strict(),
  z.object({ kind: z.literal('set_quantity'), reference: query, quantity }).strict(),
  z.object({ kind: z.literal('remove_item'), reference: query }).strict(),
  z.object({ kind: z.literal('resolve_line'), lineId: z.uuid(), query: query.optional(), quantity: quantity.optional(), requestedUnit: query.optional(), search:discoveryPlanSchema.optional() }).strict(),
  z.object({ kind: z.literal('set_fulfillment'), method: z.literal('pickup') }).strict(),
]);
export const interpretationSchema = z.object({ transcript:z.string().trim().min(1).max(4000).optional(), operations: z.array(operationSchema).max(20), next: z.enum(['review', 'continue', 'price','assist']), priceQuery: query.optional(), priceQuantity: quantity.optional(), priceUnit: query.optional(), conversation: z.enum(['greeting','thanks','help','handoff','browse','pause','shop_question']).optional(), shopQuestions: z.array(z.enum(['delivery','discount','hours','technical','availability'])).max(5).optional(), clarifyQuestion: z.string().trim().max(180).optional(), assistance:z.object({quantity:quantity.optional(),requestedUnit:query.optional(),rootQuery:query.optional(),queries:z.array(query).min(1).max(3),lineId:z.uuid().optional(),question:z.string().trim().min(1).max(180).optional(),search:discoveryPlanSchema.optional()}).strict().optional() }).strict().refine(x => x.next !== 'price' || (x.priceQuery && x.operations.length === 0), 'Price requests must be read-only').refine(x=>x.next==='assist'?!!x.assistance&&x.operations.length===0:!x.assistance,'Assistance is a read-only search plan');
export type Interpretation = z.infer<typeof interpretationSchema>;
export type Operation = z.infer<typeof operationSchema>;
export const toolCallSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('search_products'), args: z.object({ query, quantity: quantity.optional(), requestedUnit: query.optional() }).strict() }).strict(),
  z.object({name:z.literal('get_catalog_map'),args:z.object({departmentId:query.optional()}).strict()}).strict(),
  z.object({name:z.literal('discover_products'),args:z.object({query,search:discoveryPlanSchema.optional()}).strict()}).strict(),
  z.object({ name: z.literal('get_draft'), args: z.object({}).strict() }).strict(),
  z.object({ name: z.literal('apply_draft_changes'), args: z.object({ expectedVersion: z.number().int().min(0), operations: z.array(operationSchema).min(1).max(20) }).strict() }).strict(),
  z.object({ name: z.literal('preview_order'), args: z.object({ expectedVersion: z.number().int().min(0) }).strict() }).strict(),
  z.object({ name: z.literal('submit_order_request'), args: z.object({ reviewId: z.uuid() }).strict() }).strict(),
  z.object({ name: z.literal('get_order_status'), args: z.object({ requestId: z.uuid().optional() }).strict() }).strict(),
  z.object({name:z.literal('confirm_product_choices'),args:z.object({batchId:z.uuid(),choices:z.array(z.object({lineId:z.uuid(),sku:query}).strict()).min(1).max(3)}).strict()}).strict(),
]);
export type ToolCall = z.infer<typeof toolCallSchema>;
export const eventSchema = z.discriminatedUnion('type', [
  z.object({id:z.uuid(),type:z.literal('voice'),mediaId:z.uuid()}).strict(),
  z.object({id:z.uuid(),type:z.literal('image'),mediaId:z.uuid(),caption:z.string().trim().max(1000).default('')}).strict(),
  z.object({id:z.uuid(),type:z.literal('change_language'),language:z.enum(['ta','ta-Latn','en'])}).strict(),
  z.object({ id: z.uuid(), type: z.literal('text'), text: z.string().trim().min(1).max(4000) }).strict(),
  z.object({id:z.uuid(),type:z.literal('browse'),query:query,expectedVersion:z.number().int().min(0)}).strict(),
  z.object({id:z.uuid(),type:z.literal('choose_product'),sku:query,quantity:quantity.optional(),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({id:z.uuid(),type:z.literal('quote_product'),sku:query,quantity:quantity.optional(),requestedUnit:query.optional(),expectedVersion:z.number().int().min(0)}).strict(),
  z.object({ id: z.uuid(), type: z.literal('add_item'), sku: z.string().min(1).max(80), quantity: z.number().int().min(1).max(100), expectedVersion: z.number().int().min(0) }).strict(),
  z.object({ id: z.uuid(), type: z.literal('set_quantity'), lineId: z.uuid(), quantity: z.number().int().min(0).max(100), expectedVersion: z.number().int().min(0) }).strict(),
  z.object({ id: z.uuid(), type: z.literal('review'), expectedVersion: z.number().int().min(0) }).strict(),
  z.object({ id: z.uuid(), type: z.literal('confirm'), reviewId: z.uuid() }).strict(),
  z.object({ id: z.uuid(), type: z.literal('select_candidate'), questionId: z.uuid(), lineId: z.uuid(), sku: z.string().min(1).max(80) }).strict(),
  z.object({id:z.uuid(),type:z.literal('refine_discovery'),memoryId:z.uuid(),facet:query,value:query}).strict(),
  z.object({id:z.uuid(),type:z.literal('refine_search'),batchId:z.uuid(),lineId:z.uuid(),facet:query,value:query}).strict(),
  z.object({id:z.uuid(),type:z.literal('select_product'),batchId:z.uuid(),lineId:z.uuid(),sku:query}).strict(),
  z.object({id:z.uuid(),type:z.literal('confirm_products'),batchId:z.uuid()}).strict(),
]);
export type SimulatorEvent = z.infer<typeof eventSchema>;
export type Product = { sku: string; name: string; localNames?:import('./language.js').LocalNames; unit: string; pricePaise: number; stock: number | null; version: number; aliases: string[]; quantityStep: number; category?:string; imageUrl?:string;familyId?:string;brand?:string;specifications?:Record<string,string>;keywords?:string[] };
export type DraftLine = { id: string; query?: string; sku?: string; quantity: number | null; name: string; unit?: string; pricePaise?: number; productVersion?: number; requestedUnit?:string; requestedQuantity?:number; discovery?:DiscoveryResult;productConfirmation?:{sku:string;version:number;identityHash:string}; resolution: 'matched' | 'needs_choice' | 'needs_quantity' | 'needs_unit' | 'unavailable'; candidates?: Product[] };
export type ProductCheck={kind:'products';id:string;version:number;expiresAt:string;groups:{lineId:string;products:Product[];discovery?:DiscoveryResult}[];remaining:number};
export type Pending = { kind: 'question'; id: string; lineId: string; version: number } | ProductCheck | { kind: 'review'; id: string; version: number; hash: string; expiresAt: string; lines: DraftLine[]; totalPaise: number; fulfillment: 'pickup' };
export type ConversationState = { replyLanguage?:import('./language.js').ReplyLanguage; version: number; draft: DraftLine[]; pending: Pending | null; fulfillment: 'pickup'; lastRequestId: string | null;requireProductConfirmation?:true;catalogDiscovery?:true };
export type OrderRequest = { id: string; acceptance: 'awaiting_approval'; payment: 'not_requested'; fulfillment: 'awaiting_approval'; totalPaise: number; lines: DraftLine[] };
export type Snapshot = { mode: 'mock'; provider: string; catalog: Product[]; conversation: ConversationState; messages: { id: string; direction: string; text: string; status: string; createdAt?:string; voice?:{mediaId:string;durationSeconds:number}; image?:{mediaId:string}; rich?:RichReply }[]; pending: number; requests: OrderRequest[]; interpretationAttempts: number;catalogMap?:CatalogMap;discoveryBindingId?:string };

export type ProductCard={product:Product;action?:SimulatorEvent;label:string;requestLabel?:string;quantityLabel?:string;matchLabel?:string;detailLabel?:string};
export type RichReply={version:1;replyLanguage?:import('./language.js').ReplyLanguage;kind:'text'|'product_choices'|'order_review';text:string;cards?:ProductCard[];buttons?:{label:string;event:SimulatorEvent}[];presentation:'text'|'single_product'|'carousel_preview'|'list';outboundMessages:1;remainingChoices?:number};
