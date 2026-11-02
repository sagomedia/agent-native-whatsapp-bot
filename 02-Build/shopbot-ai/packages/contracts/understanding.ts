import {z} from 'zod';
const quantity=z.number().positive().max(100).refine(n=>Math.abs(n*1000-Math.round(n*1000))<1e-7);
const text=z.string().trim().min(1).max(200);
const phrase=z.string().trim().min(1).max(500);
const measure=z.object({value:z.number().positive().max(100000),unit:z.string().trim().min(1).max(30)}).strict();
const uncertainty=z.enum(['identity','brand','variant','quantity','unit','budget','unreadable']);
// Search language is a hypothesis grounded in this item, separate from the
// verbatim evidence. Store IDs are validated against the current inventory.
export const itemSearchSchema=z.object({
 keywords:z.array(z.string().trim().min(1).max(120)).min(1).max(8),
 identityQuery:text.optional(),familyIds:z.array(z.string().trim().min(1).max(120)).min(1).max(6).optional(),
 selectedSkus:z.array(z.string().trim().min(1).max(120)).max(6).optional(),
 useCase:text.optional(),
 clarifyType:z.boolean().optional(),
}).strict();
const countEvidence=z.object({sourceText:phrase,value:quantity,mode:z.enum(['total','additional','decrement'])}).strict();
export const understandingItemSchema=z.object({
 ordinal:z.number().int().min(0).max(49),sourceText:phrase,query:text.nullable(),
 targetLineId:z.uuid().optional(),sameItemOrdinal:z.number().int().min(0).max(49).optional(),requestMode:z.enum(['set','additional']).optional(),
 purchaseCount:quantity.nullable(),requestedContainer:text.optional(),
 brand:text.optional(),colour:text.optional(),material:text.optional(),
 packSize:measure.optional(),dimensions:z.array(measure.extend({role:z.enum(['size','diameter','length','width','height','thickness'])})).max(6).optional(),
 requestedAmount:measure.optional(),amountMode:z.enum(['total','continuous']).optional(),
 requestedBudgetPaise:z.number().int().positive().max(100000000).optional(),
 unresolved:z.array(uncertainty).max(7),crossedOut:z.boolean().optional(),
 search:itemSearchSchema.optional(),countEvidence:countEvidence.optional(),
 attributeEvidence:z.array(z.object({field:z.enum(['brand','colour','material']),value:text,sourceText:phrase}).strict()).max(3).optional(),
}).strict();
const edit=z.object({kind:z.enum(['set_quantity','increment_quantity','decrement_quantity','remove_item','replace','set_amount','increment_amount']),targetLineId:z.uuid(),sourceText:phrase,targetQuery:text.optional(),quantity:quantity.optional(),query:text.optional(),amount:measure.optional(),mode:z.enum(['total','continuous']).optional(),search:itemSearchSchema.optional(),countEvidence:countEvidence.optional()}).strict();
const keepTarget=z.object({sourceText:phrase,query:text,targetLineId:z.uuid().optional(),duplicateSourceText:phrase.optional()}).strict();
export const keepOnlySchema=z.object({sourceText:phrase,complete:z.boolean(),targets:z.array(keepTarget).min(1).max(50)}).strict();
export const turnUnderstandingSchema=z.object({
 schemaVersion:z.literal(2),inputKind:z.enum(['text','audio','product_photo','handwritten_list','unknown_image']),
 transcript:z.string().trim().max(4000).optional(),observedText:z.string().trim().max(8000).optional(),
 intents:z.array(z.enum(['lookup','price','add','edit','view_list','estimate','submit','status','store_info','help','cancel','clear_list','pause','greeting','thanks','unrelated'])).min(1).max(8),
 requestedItems:z.array(understandingItemSchema).max(50),proposedEdits:z.array(edit).max(100),
 keepOnly:keepOnlySchema.optional(),
 keepOnlyAnswer:keepTarget.optional(),
 cartTargetAnswer:keepTarget.optional(),
 shopQuestions:z.array(z.enum(['delivery','discount','hours','technical','availability','location'])).max(6),
 unresolved:z.array(z.string().trim().min(1).max(180)).max(10),
 clarifyQuestion:z.string().trim().min(1).max(180).optional(),explicitLanguageRequest:z.enum(['ta','ta-Latn','en']).optional(),
}).strict().refine(t=>new Set(t.requestedItems.map(i=>i.ordinal)).size===t.requestedItems.length,'Duplicate source lines');
export type TurnUnderstanding=z.infer<typeof turnUnderstandingSchema>;

/** Optional search hints may use empty/null absence. An explicit empty SKU
 * selection is a rejection and must survive normalization. */
export function normalizeSearchAbsence(value:unknown):unknown {
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 const next={...value} as Record<string,unknown>;
 for(const field of ['identityQuery','familyIds','selectedSkus','useCase','clarifyType'])if(next[field]===null||next[field]==='')delete next[field];
 if(Array.isArray(next.familyIds)&&next.familyIds.length===0)delete next.familyIds;
 return next;
}

// Normalize only absence representations for known optional fields. Required
// counts/queries/arrays and all unknown keys still undergo strict validation.
export function normalizeUnderstandingAbsence(value:unknown):unknown {
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 const clean=(v:Record<string,unknown>,fields:string[])=>{const next={...v};for(const field of fields)if(next[field]===null||next[field]==='')delete next[field];return next;};
 const result=clean(value as Record<string,unknown>,['transcript','observedText','clarifyQuestion','explicitLanguageRequest','keepOnly','keepOnlyAnswer','cartTargetAnswer']);
 if(result.cartTargetAnswer&&typeof result.cartTargetAnswer==='object'&&!Array.isArray(result.cartTargetAnswer))result.cartTargetAnswer=clean(result.cartTargetAnswer as Record<string,unknown>,['targetLineId']);
 if(result.keepOnlyAnswer&&typeof result.keepOnlyAnswer==='object'&&!Array.isArray(result.keepOnlyAnswer))result.keepOnlyAnswer=clean(result.keepOnlyAnswer as Record<string,unknown>,['targetLineId']);
 if(result.keepOnly&&typeof result.keepOnly==='object'&&!Array.isArray(result.keepOnly)){
  const keep={...result.keepOnly} as Record<string,unknown>;
  if(Array.isArray(keep.targets))keep.targets=keep.targets.map(v=>v&&typeof v==='object'&&!Array.isArray(v)?clean(v,['targetLineId']):v);
  result.keepOnly=keep;
 }
 if(Array.isArray(result.requestedItems))result.requestedItems=result.requestedItems.map(v=>{
  if(!v||typeof v!=='object'||Array.isArray(v))return v;
  const item=clean(v,['targetLineId','sameItemOrdinal','requestMode','requestedContainer','brand','colour','material','packSize','dimensions','requestedAmount','amountMode','requestedBudgetPaise','crossedOut','search','countEvidence','attributeEvidence']);
  if(item.targetLineId==='00000000-0000-0000-0000-000000000000')delete item.targetLineId;
  if(item.requestedBudgetPaise===0)delete item.requestedBudgetPaise;
  if(item.purchaseCount===null)delete item.countEvidence;
  for(const field of ['dimensions','attributeEvidence'])if(Array.isArray(item[field])&&item[field].length===0)delete item[field];
  if(item.search!==undefined)item.search=normalizeSearchAbsence(item.search);
  return item;
 });
 if(Array.isArray(result.proposedEdits))result.proposedEdits=result.proposedEdits.map(v=>{
  if(!v||typeof v!=='object'||Array.isArray(v))return v;
  const edit=clean(v,['targetQuery','quantity','query','amount','mode','search','countEvidence']);
  if(edit.search!==undefined)edit.search=normalizeSearchAbsence(edit.search);
  return edit;
 });
 return result;
}
