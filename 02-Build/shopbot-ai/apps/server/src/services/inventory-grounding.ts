import type {Interpretation,Operation} from '../../../../packages/contracts/index.js';
import type {CatalogObservation} from './agent-assistance.js';
import {ToolError} from './context.js';

export function inventoryItems(plan:Interpretation){
 const items=plan.operations.filter((op):op is Extract<Operation,{kind:'add_item'|'resolve_line'}>=>
  (op.kind==='add_item'||op.kind==='resolve_line')&&!!op.query);
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

/** A catalog-grounding pass can refine searches, never rewrite the order. */
export function validateInventoryReplan(original:Interpretation,replanned:Interpretation,observations:CatalogObservation[]):Interpretation {
 const before=original.understanding,after=replanned.understanding;
 if(!before||!after)throw new ToolError('Inventory grounding needs the original item evidence.','grounding_evidence');
 const identity=(item:typeof before.requestedItems[number])=>{
  const {query,search,...evidence}=item;return JSON.stringify(evidence);
 };
 if(before.requestedItems.length!==after.requestedItems.length||before.requestedItems.some((item,i)=>identity(item)!==identity(after.requestedItems[i])))throw new ToolError('Inventory grounding cannot change items, counts or stated attributes.','grounding_evidence');
 const edits=(value:typeof before)=>JSON.stringify(value.proposedEdits.map(({search,...edit})=>edit));
 if(edits(before)!==edits(after)||JSON.stringify(before.intents)!==JSON.stringify(after.intents)||JSON.stringify(before.keepOnly)!==JSON.stringify(after.keepOnly))throw new ToolError('Inventory grounding cannot change the customer’s cart actions.','grounding_evidence');
 for(const [index,item] of after.requestedItems.entries()){
  const observed=observations.filter(o=>o.query===itemObservationQuery(original,before.requestedItems[index]));
  const available=new Set(observed.flatMap(o=>o.products.map(p=>p.sku)));
  if(!observed.length&&(item.query!==before.requestedItems[index].query||JSON.stringify(item.search)!==JSON.stringify(before.requestedItems[index].search)))throw new ToolError('Unobserved item searches must remain unchanged.','grounding_scope');
  if(available.size&&item.query===before.requestedItems[index].query&&item.search?.identityQuery===before.requestedItems[index].search?.identityQuery&&item.search?.selectedSkus===undefined)throw new ToolError('Inventory grounding must explicitly select or reject the observed candidates.','grounding_evidence');
  if(item.search?.selectedSkus?.some(sku=>!available.has(sku)))throw new ToolError('Choose products observed for this item only.','grounding_scope');
 }
 return replanned;
}

/** Failed grounding retains descriptions; it cannot approve dubious aliases. */
export function retainUngroundedItems(plan:Interpretation,observations:CatalogObservation[]):Interpretation {
 const assessed=new Set(observations.map(o=>o.query));
 return {...plan,...(plan.next==='assist'&&plan.assistance?{assistance:{...plan.assistance,search:{keywords:plan.assistance.queries.map(q=>q.slice(0,120)),...plan.assistance.search,selectedSkus:[]}}}:{}),...(plan.next==='price'&&plan.priceQuery?{priceSearch:{keywords:[plan.priceQuery.slice(0,120)],...plan.priceSearch,selectedSkus:[]}}:{}),operations:plan.operations.map(op=>(op.kind==='add_item'||op.kind==='resolve_line')&&op.query&&assessed.has(op.query)
  ?{...op,search:{keywords:[op.query.slice(0,120)],...op.search,selectedSkus:[]}}
  :op)};
}
