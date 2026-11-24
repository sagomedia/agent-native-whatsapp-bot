// Keep provider grammar separate from the authoritative backend contracts.
// Array/numeric bounds caused INVALID_ARGUMENT on the pinned live model; the
// strict wire schemas still enforce bounds, per-kind fields and dependencies.
const text={type:'string'};
const nullableText={type:['string','null']};
const amount={type:'number'};
const array=(items:unknown)=>({type:'array',items});
const object=(properties:Record<string,unknown>,required:string[])=>({type:'object',properties,required,additionalProperties:false});
const operation=(kind:string,properties:Record<string,unknown>,required:string[])=>object({kind:{type:'string',enum:[kind]},...properties},['kind',...required]);
const filters=object({key:text,value:text},['key','value']);
const planProperties={keywords:array(text),departmentId:text,familyId:text,familyIds:array(text),brand:text,useCase:text,preferredSkus:array(text),specificationFilters:array(filters)};
const measure=object({value:amount,unit:text},['value','unit']);
const productIntent=object({kind:{type:'string',enum:['inferred','ambiguous']},sourcePhrase:text,useCase:text,question:text,alternatives:array(object({query:text,familyId:text},['query','familyId']))},['kind','sourcePhrase']);
const evidence={packSize:measure,productMeasures:array(object({value:amount,unit:text,role:{type:'string',enum:['size','diameter','length','width','height','thickness']}},['value','unit'])),requestedAmount:measure,amountMode:{type:'string',enum:['total','continuous']},supportingPhrase:text,productIntent};
const properties={
 operations:{...array({anyOf:[
  operation('add_item',{query:text,quantity:{type:['number','null']},requestedUnit:text,...evidence},['query','quantity']),
  operation('set_quantity',{reference:text,quantity:amount,supportingPhrase:text},['reference','quantity']),
  operation('increment_quantity',{reference:text,delta:amount,supportingPhrase:text},['reference','delta','supportingPhrase']),
  operation('set_amount',{reference:text,amount:measure,mode:{type:'string',enum:['total','continuous']},supportingPhrase:text},['reference','amount','supportingPhrase']),
  operation('increment_amount',{reference:text,delta:measure,supportingPhrase:text},['reference','delta','supportingPhrase']),
  operation('remove_item',{reference:text,supportingPhrase:text},['reference']),
  operation('resolve_line',{lineId:text,query:text,quantity:amount,requestedUnit:text,...evidence},['lineId']),
  operation('set_fulfillment',{method:{type:'string',enum:['pickup']}},['method']),
 ]}),description:'Preserve every requested item, including repeated categories. Merge identical items only by summing quantities; different or uncertain sizes stay separate.'},
 next:{type:'string',enum:['review','continue','price','assist']},
 priceQuery:text,priceQuantity:amount,priceUnit:text,clarifyQuestion:text,estimateRequested:{type:'boolean'},
 conversation:{type:'string',enum:['greeting','thanks','help','handoff','browse','pause','shop_question']},
 shopQuestions:array({type:'string',enum:['delivery','discount','hours','technical','availability']}),
 assistance:object({queries:array(text),rootQuery:text,lineId:text,quantity:amount,requestedUnit:text,question:text},['queries']),
 assistanceSearch:object(planProperties,['keywords']),
 searchPlans:array(object({operationIndex:{type:'integer'},...planProperties},['operationIndex','keywords'])),
};
// Request recognition before decisions so the plan is grounded in the new
// recording rather than the previous turn.
export function planningResponseSchema(audio:boolean){return object(audio?{transcript:text,...properties}:properties,audio?['transcript','operations','next']:['operations','next']);}
export function imageResponseSchema(){return object({query:nullableText,keywords:array(text),departmentId:nullableText,familyId:nullableText,brand:nullableText,specificationFilters:{type:['array','null'],items:filters},question:nullableText},['query','keywords','specificationFilters']);}

export function recognitionResponseSchema(){return object({transcript:text},['transcript']);}
