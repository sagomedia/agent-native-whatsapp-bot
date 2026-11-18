import {isDeepStrictEqual} from 'node:util';
import type {Interpretation,Operation,DiscoveryPlan,Product} from '../../../../packages/contracts/index.js';
import type {PoolClient} from 'pg';
import type {ActorContext} from './context.js';
import {productColumns,productForContext} from './catalog.js';
import type {CatalogObservation} from './agent-assistance.js';
import {ToolError} from './context.js';
import {observeCatalog} from './agent-assistance.js';
import type {RetailTools} from './tools.js';
import {normalize,oneEdit,tokens} from '../../../../packages/contracts/catalog-text.js';
import {catalogMeasurements,catalogMeasurementSqlPattern,withoutCatalogMeasurements} from '../../../../packages/contracts/catalog-measurements.js';
import {catalogMeasurementSourceSql,catalogSpecificationSql,discoveryIdentityQuery,namedObjectPhrase,naturalCatalogQuery} from './catalog-request.js';

export const inventoryObservationLimit=5;

/** The same bounded facts can ground a normal plan or its single evidence
 * repair. Neither path needs an extra unmetered model request. */
export async function observeInventory(client:PoolClient,ctx:ActorContext,tools:RetailTools,items:{query:string;search?:DiscoveryPlan}[],key:string):Promise<CatalogObservation[]> {
 const found:CatalogObservation[]=[];
 for(const [index,item] of items.slice(0,inventoryObservationLimit).entries()){
  const current=(await observeCatalog(client,ctx,tools,[item.query],`${key}:${index}`,item.search))[0];
  if(item.search?.selectedSkus!==undefined){found.push(current);continue;}
  const brand=item.search?.brand;
  if(brand&&(current.products.some(p=>normalize(p.brand??'')===normalize(brand))||
   (await client.query('SELECT 1 FROM products WHERE store_id=$1 AND active=true AND lower(brand)=lower($2) LIMIT 1',[ctx.storeId,brand])).rowCount)){
   current.exactRequestedBrand=brand;
  }
  if(current.discovery?.matchStatus==='needs_detail'||current.totalCount>10){found.push(current);continue;}
  if(!current.products.length){
   const identity=discoveryIdentityQuery(item.query,item.search?.identityQuery);
   const alternatives=candidateTerms(identity,item.search?.keywords).slice(1,3);
   for(const [hintIndex,keyword] of alternatives.entries()){
    const extra=(await observeCatalog(client,ctx,tools,[item.query],`${key}:${index}:hint:${hintIndex}`,{...item.search,keywords:[keyword],identityQuery:discoveryIdentityQuery(identity,keyword),allowAlternatives:false}))[0];
    current.products=[...new Map([...current.products,...extra.products].map(p=>[p.sku,p])).values()].slice(0,10);
    current.totalCount=Math.max(current.totalCount,extra.totalCount,current.products.length);
    if(!current.discovery?.products.length&&extra.totalCount>10&&extra.discovery){current.discovery=extra.discovery;break;}
   }
  }
  if(current.products.length<10&&current.totalCount<=10&&!['sku','name'].includes(current.discovery?.diagnostics?.identity??'none')){
   const search=item.search&&{...item.search,brand:current.exactRequestedBrand};
   const facts=await inventoryCandidateFacts(client,ctx,item.query,search,current.products.length>0);
   current.products=[...new Map([...current.products,...facts].map(p=>[p.sku,p])).values()].slice(0,10);
   current.totalCount=Math.max(current.totalCount,current.products.length);
  }
  found.push(current);
 }
 return found;
}

function candidateTerms(identity:string,keywords:string[]=[]):string[]{
 const term=(phrase:string)=>normalize(withoutCatalogMeasurements(namedObjectPhrase(naturalCatalogQuery(phrase))));
 const primary=term(identity),words=new Set(tokens(primary));
 const hints=keywords.map(term).filter(hint=>{
  const hintWords=new Set(tokens(hint));
  // A shorter fragment such as "pipe" cannot widen "PVC pipe".
  return hintWords.size&&!(hintWords.size<words.size&&[...hintWords].every(word=>words.has(word)));
 });
 return [...new Set([primary,...hints])].filter(Boolean).slice(0,8);
}

/** Retrieval facts for semantic review, including names filed under a wrong
 * family. These bounded rows are never customer-facing without validation. */
export async function inventoryCandidateFacts(client:PoolClient,ctx:ActorContext,query:string,plan?:DiscoveryPlan,namesOnly=false):Promise<Product[]> {
 const identity=discoveryIdentityQuery(query,plan?.identityQuery),terms=candidateTerms(identity,plan?.keywords);
 if(!terms.length)return [];
 const parameters:unknown[]=[ctx.storeId,terms],bind=(value:unknown)=>{parameters.push(value);return `$${parameters.length}`;};
 const scope=['p.store_id=$1','p.active=true'];
 if(plan?.brand)scope.push(`lower(p.brand)=lower(${bind(plan.brand)})`);
 if(plan?.familyId)scope.push(`p.family_id=${bind(plan.familyId)}`);
 if(plan?.departmentId)scope.push(`p.family_id IN (SELECT id FROM catalog_nodes WHERE store_id=$1 AND parent_id=${bind(plan.departmentId)})`);
 if(plan?.priceRange)scope.push(`p.price_status='priced' AND p.selling_unit_verified=true AND p.price_paise BETWEEN ${bind(plan.priceRange.minPaise)} AND ${bind(plan.priceRange.maxPaise)}`);
 for(const [key,value] of Object.entries(plan?.specifications??{}))scope.push(catalogSpecificationSql(key,value,bind));
 for(const measure of catalogMeasurements(namedObjectPhrase(identity)))scope.push(`${catalogMeasurementSourceSql} ~* ${bind(catalogMeasurementSqlPattern(measure))}`);
 const nameVector=`to_tsvector('simple',p.name)`;
 const result=await client.query(`WITH terms AS (
  SELECT plainto_tsquery('simple',term) AS q,priority FROM unnest($2::text[]) WITH ORDINALITY AS hints(term,priority)
 )
 SELECT ${productColumns.split(',').map(c=>'p.'+c).join(',')} FROM products p
 WHERE ${scope.join(' AND ')} AND EXISTS(SELECT 1 FROM terms WHERE p.search_vector @@ q ${namesOnly?`AND ${nameVector} @@ q`:''})
 ORDER BY (SELECT min(priority) FROM terms WHERE ${nameVector} @@ q) NULLS LAST,
 (SELECT min(priority) FROM terms WHERE p.search_vector @@ q),
 (SELECT max(ts_rank_cd(p.search_vector,q)) FROM terms) DESC,p.sku LIMIT 10`,parameters);
 return result.rows.map(row=>productForContext(row,ctx));
}

export function inventoryItems(plan:Interpretation){
 const items=plan.operations.filter((op):op is Extract<Operation,{kind:'add_item'|'resolve_line'}>=>
  (op.kind==='add_item'||op.kind==='resolve_line')&&!!op.query&&!op.sourceUncertainty?.includes('product_identity'));
 if(items.length)return items;
 if(plan.next==='assist'&&plan.assistance)return plan.assistance.queries.map(query=>({kind:'add_item' as const,query,quantity:null,search:plan.assistance!.search}));
 if(plan.next==='price'&&plan.priceQuery)return [{kind:'add_item' as const,query:plan.priceQuery,quantity:null,search:plan.priceSearch}];
 return items;
}

/** Match a source item to the actual search, including extracted attributes. */
export function itemObservationQuery(plan:Interpretation,item:NonNullable<Interpretation['understanding']>['requestedItems'][number]):string|null {
 const operation=plan.operations.find(op=>(op.kind==='add_item'||op.kind==='resolve_line')&&op.supportingPhrase===item.sourceText&&op.query);
 if(operation&&(operation.kind==='add_item'||operation.kind==='resolve_line'))return operation.query??item.query;
 const index=plan.understanding?.requestedItems.findIndex(before=>before.ordinal===item.ordinal)??-1;
 return plan.assistance?.queries[index]??plan.priceQuery??item.query;
}

/** Canonicalize a near spelling only when the grounded wording and every
 * selected SKU agree on one brand in the current item's observations. */
export function groundedVoiceBrand(
 item:NonNullable<Interpretation['understanding']>['requestedItems'][number],
 prior:Interpretation,
 observations:CatalogObservation[],
 catalog:Product[],
):string|undefined {
 const original=prior.understanding?.requestedItems.find(candidate=>candidate.ordinal===item.ordinal);
 const heard=normalize(original?.brand??'');
 const selectedSkus=item.search?.selectedSkus;
 if(!original||heard.length<5||normalize(item.brand??'')!==heard||!selectedSkus?.length)return;
 const query=itemObservationQuery(prior,original);
 const observed=observations.filter(observation=>observation.query===query);
 if(observed.some(observation=>normalize(observation.exactRequestedBrand??'')===heard))return;
 const products=observed.flatMap(observation=>observation.products);
 const brands=selectedSkus.map(sku=>products.find(product=>product.sku===sku)?.brand);
 const brand=brands[0],canonical=normalize(brand??'');
 if(!brand||canonical.length<5||canonical===heard||!oneEdit(heard,canonical)||brands.some(value=>normalize(value??'')!==canonical))return;
 const mentioned=[item.query,item.search?.identityQuery].some(phrase=>(' '+normalize(phrase??'')+' ').includes(' '+canonical+' '));
 if(!mentioned)return;
 const conflictingBrand=[...catalog,...observations.flatMap(observation=>observation.products)]
  .some(product=>{const value=normalize(product.brand??'');return value!==canonical&&oneEdit(heard,value);});
 return conflictingBrand?undefined:brand;
}

/** A catalog-grounding pass can refine searches, never rewrite the order. */
export function validateInventoryReplan(original:Interpretation,replanned:Interpretation,observations:CatalogObservation[]):Interpretation {
 const before=original.understanding,after=replanned.understanding;
 if(!before||!after)throw new ToolError('Inventory grounding needs the original item evidence.','grounding_evidence');
 const identity=(item:typeof before.requestedItems[number])=>{
  const {query,search,...evidence}=item;return evidence;
 };
 if(before.requestedItems.length!==after.requestedItems.length||before.requestedItems.some((item,i)=>!isDeepStrictEqual(identity(item),identity(after.requestedItems[i]))))throw new ToolError('Inventory grounding cannot change items, counts or stated attributes.','grounding_evidence');
 const edits=(value:typeof before)=>value.proposedEdits.map(({search,...edit})=>edit);
 if(!isDeepStrictEqual(edits(before),edits(after))||!isDeepStrictEqual(before.intents,after.intents)||!isDeepStrictEqual(before.keepOnly,after.keepOnly))throw new ToolError('Inventory grounding cannot change the customer’s cart actions.','grounding_evidence');
 for(const [index,item] of after.requestedItems.entries()){
  const observed=observations.filter(o=>o.query===itemObservationQuery(original,before.requestedItems[index]));
  const available=new Set(observed.flatMap(o=>o.products.map(p=>p.sku)));
  if(!observed.length&&(item.query!==before.requestedItems[index].query||!isDeepStrictEqual(item.search,before.requestedItems[index].search)))throw new ToolError('Unobserved item searches must remain unchanged.','grounding_scope');
  if(available.size&&item.query===before.requestedItems[index].query&&item.search?.identityQuery===before.requestedItems[index].search?.identityQuery&&item.search?.selectedSkus===undefined&&!item.search?.narrowing?.length&&!item.search?.browseAll)throw new ToolError('Inventory grounding must explicitly select or reject the observed candidates.','grounding_evidence');
  if(item.search?.narrowing){const keys=new Set(observed.flatMap(o=>o.discovery?.facets.map(f=>f.key)??[]));if(item.search.selectedSkus!==undefined||item.search.narrowing.some(step=>!keys.has(step.key)))throw new ToolError('Choose narrowing attributes observed for this item only.','grounding_scope');}
  if(item.search?.selectedSkus?.some(sku=>!available.has(sku)))throw new ToolError('Choose products observed for this item only.','grounding_scope');
 }
 for(const [index,edit] of after.proposedEdits.entries()){
  const prior=before.proposedEdits[index],observed=observations.filter(o=>o.query===prior.query);
  if(!observed.length&&!isDeepStrictEqual(edit.search,prior.search))throw new ToolError('Unobserved replacement searches must remain unchanged.','grounding_scope');
  const available=new Set(observed.flatMap(o=>o.products.map(p=>p.sku)));
  if(edit.search?.selectedSkus?.some(sku=>!available.has(sku)))throw new ToolError('Choose products observed for this replacement only.','grounding_scope');
 }
 return replanned;
}
