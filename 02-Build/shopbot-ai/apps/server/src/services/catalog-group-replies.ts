import {buildProductCaption,fitText} from '../../../../packages/contracts/channel-text.js';
import {randomUUID} from 'node:crypto';
import type {ConversationState,DiscoveryResult,Product,RichReply,VisualCard} from '../../../../packages/contracts/index.js';
import {discoveryMoreValue,discoveryFacetValue,discoveryProductsValue} from '../../../../packages/contracts/discovery.js';
import {localName,say,measurementText,facetLabel,safeQuestion} from '../../../../packages/contracts/language.js';

type Binding={memoryId?:string;lineId?:string;batchId?:string};
type Group=NonNullable<DiscoveryResult['groups']>[number];

/** Semantics belong to the agent's observed strategy. Limits, current values,
 * continuation and click bindings belong to the channel/runtime. */
export function catalogGroupReply(result:DiscoveryResult,state:ConversationState,binding:Binding):RichReply|undefined {
 if(!binding.memoryId&&!(binding.batchId&&binding.lineId))return;
 const event=(key:string,value:string)=>binding.batchId&&binding.lineId
  ?{id:randomUUID(),type:'refine_search' as const,batchId:binding.batchId,lineId:binding.lineId,facet:key,value}
  :{id:randomUUID(),type:'refine_discovery' as const,memoryId:binding.memoryId!,facet:key,value};
 const makeReply=(cards:VisualCard[],text:string):RichReply=>({version:1,kind:'text',text,stage:'identify',clarificationReason:'catalog_group',parts:[{id:randomUUID(),cards,text}],outboundMessages:1,presentation:cards.length===1?'single_product':'carousel_preview',replyLanguage:state.replyLanguage});
 if(result.nextProductOffset!==undefined||result.plan.productOffset!==undefined){
  const cards:VisualCard[]=result.products.map(product=>({kind:'product',product,...(binding.lineId?{lineId:binding.lineId}:{}),caption:buildProductCaption(product,state.replyLanguage??'en'),buttons:[{label:say(state,'Choose this','இது வேணும்','Ithu venum'),event:binding.batchId&&binding.lineId?{id:randomUUID(),type:'select_product',batchId:binding.batchId,lineId:binding.lineId,sku:product.sku}:{id:randomUUID(),type:'choose_product',sku:product.sku,expectedVersion:state.version}}]}));
  if(result.nextProductOffset!==undefined){const label=say(state,'More products','மேலும் பொருட்கள்','Melum porutkal');cards.push({kind:'instruction',title:label,lines:[],caption:label,buttons:[{label,event:event(discoveryProductsValue,discoveryMoreValue)}]});}
  if(cards.length)return makeReply(cards,say(state,'Which one do you need?','எது வேணும்?','Ethu venum?'));
 }
 const pageKey=result.plan.facetPage?.key;
 const step=result.plan.narrowing?.find(step=>result.facets.some(f=>f.key===step.key&&(f.totalValues??f.values.length)>1));
 const facet=result.totalCount>10?result.facets.find(f=>f.key===(pageKey??step?.key)):undefined;
 const supplied=result.groups;
 // No valid agent plan is available (for example, a deterministic browse).
 // Ask which available detail to use, instead of guessing a category policy.
 if(!supplied?.length&&result.totalCount>10&&!facet&&result.facets.length){
  const offset=pageKey===discoveryFacetValue?result.plan.facetPage!.offset:0;
  const cards:VisualCard[]=result.facets.slice(offset,offset+9).map(f=>{
   const title=facetLabel(f.key,f.label,state),line=say(state,`${f.totalValues??f.values.length} choices`,`${f.totalValues??f.values.length} தேர்வுகள்`,`${f.totalValues??f.values.length} choices`);
   return {kind:'instruction',title,lines:[line],caption:title+'\n'+line,buttons:[{label:say(state,'Choose','தேர்வு','Choose'),event:event(discoveryFacetValue,f.key)}]};
  });
  if(offset+9<result.facets.length){const label=say(state,'More choices','மேலும் தேர்வுகள்','Melum choices');cards.push({kind:'instruction',title:label,lines:[],caption:label,buttons:[{label,event:event(discoveryFacetValue,discoveryMoreValue)}]});}
  if(cards.length)return makeReply(cards,say(state,'Which detail shall we choose by?','எந்த விவரத்தை வைத்து தேர்வு செய்யலாம்?','Entha detail vechu choose pannalaam?'));
 }
 const groups:Group[]=supplied?.length?supplied:facet?.values.map(value=>({key:facet.key,...value}))??[];
 if(!groups.length)return;
 const pageFacet=result.facets.find(f=>f.key===groups[0].key&&f.nextOffset!==undefined);
 const cards:VisualCard[]=groups.slice(0,pageFacet?9:10).map(group=>{
  const name=measurementText(localName(group.label,group.localNames,state),state);
  const product=group.product??result.products.find(p=>matches(p,group));
  const imageUrl=product?.imageUrl;
  const count=say(state,`${group.count} ${group.count===1?'product':'products'}`,`${group.count} பொருட்கள்`,`${group.count} porutkal`);
  const example=imageUrl?say(state,'Example photo','எடுத்துக்காட்டு படம்','Example photo'):undefined;
  return {kind:'instruction',title:name,lines:[count,...(example?[example]:[])],caption:[fitText(name,80),count,example].filter(Boolean).join('\n'),...(imageUrl?{imageUrl}:{}),buttons:[{label:say(state,'Choose','தேர்வு','Choose'),event:event(group.key,group.value)}]};
 });
 if(pageFacet){const label=say(state,'More choices','மேலும் தேர்வுகள்','Melum choices');cards.push({kind:'instruction',title:label,lines:[],caption:label,buttons:[{label,event:event(pageFacet.key,discoveryMoreValue)}]});}
 const key=groups[0].key,label=facetLabel(key,facet?.label??'product type',state);
 const question=safeQuestion(result.plan.narrowing?.find(s=>s.key===key)?.question,state)??say(state,`Which *${label}*?`,`எந்த *${label}* வேண்டும்?`,`Entha *${label}* venum?`);
 const current=binding.lineId?state.draft.find(line=>line.id===binding.lineId):undefined;
 return makeReply(cards,current?fitText(measurementText(current.query??current.name,state),60)+'\n'+question:question);
}
function matches(product:Product,group:Group):boolean {
 const equal=(a:string|undefined,b:string)=>a?.trim().toLocaleLowerCase()===b.trim().toLocaleLowerCase();
 if(group.key==='family')return equal(product.familyId,group.value);
 if(group.key==='brand')return equal(product.brand,group.value);
 if(group.key.startsWith('spec:'))return equal(product.specifications?.[group.key.slice(5)],group.value);
 if(group.key==='price'){const [low,high]=group.value.split(':').map(Number);return product.priceStatus==='priced'&&product.pricePaise>=low&&product.pricePaise<=high;}
 return false;
}
