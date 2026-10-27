import {fitText} from '../../../../packages/contracts/channel-text.js';
import {randomUUID} from 'node:crypto';
import type {ConversationState,DiscoveryResult,Product,RichReply,VisualCard} from '../../../../packages/contracts/index.js';
import {discoveryMoreValue} from '../../../../packages/contracts/discovery.js';
import {localName,say} from '../../../../packages/contracts/language.js';

type Binding={memoryId?:string;lineId?:string;batchId?:string};
type Group=NonNullable<DiscoveryResult['groups']>[number];

/** Offer actual catalog groups before presenting a long list of product choices. */
export function catalogGroupReply(result:DiscoveryResult,state:ConversationState,binding:Binding):RichReply|undefined {
 if(!binding.memoryId&&!(binding.batchId&&binding.lineId))return;
 const supplied=result.groups;
 const facet=result.totalCount>10?result.facets.filter(f=>f.values.length>=2||f.values.length>0&&result.plan.facetPage?.key===f.key).sort((a,b)=>(a.key===result.plan.facetPage?.key?-1:b.key===result.plan.facetPage?.key?1:rank(a.key)-rank(b.key))).find(f=>rank(f.key)<3):undefined;
 const groups:Group[]=supplied?.length?supplied:facet?.values.map(value=>({key:facet.key,...value}))??[];
 if(!groups.length||(!supplied?.length&&groups.length<2&&!result.plan.facetPage))return;
 const pageFacet=result.facets.find(f=>f.key===groups[0].key&&f.nextOffset!==undefined);
 const shown=groups.slice(0,pageFacet?9:10);
 const event=(key:string,value:string)=>binding.batchId&&binding.lineId
  ?{id:randomUUID(),type:'refine_search' as const,batchId:binding.batchId,lineId:binding.lineId,facet:key,value}
  :{id:randomUUID(),type:'refine_discovery' as const,memoryId:binding.memoryId!,facet:key,value};
 const cards:VisualCard[]=shown.map(group=>{
  const name=localName(group.label,group.localNames,state);
  const product=group.product??result.products.find(p=>matches(p,group));
  const imageUrl=product?.imageUrl;
  const count=say(state,`${group.count} matching products`,`${group.count} பொருட்கள் பொருந்தும்`,`${group.count} matching products`);
  const example=imageUrl?say(state,'Example product photo','எடுத்துக்காட்டு பொருள் படம்','Example product photo'):undefined;
  const caption=[fitText(name,80),count,example].filter(Boolean).join('\n');
  return {kind:'instruction',title:name,lines:[count,...(example?[example]:[])],caption,...(imageUrl?{imageUrl}:{}),buttons:[{label:say(state,'Show products','பொருட்களைப் பார்','Products paaru'),event:event(group.key,group.value)}]};
 });
 if(pageFacet){const label=say(state,'More choices','மேலும் தேர்வுகள்','Melum choices');cards.push({kind:'instruction',title:label,lines:[],caption:label,buttons:[{label,event:event(pageFacet.key,discoveryMoreValue)}]});}
 const brand=groups.every(g=>g.key==='brand');
 const text=brand?say(state,'Choose a brand','பிராண்டைத் தேர்வு செய்யுங்கள்','Brand choose pannunga'):say(state,'Choose a category','வகையைத் தேர்வு செய்யுங்கள்','Vagai choose pannunga');
 return {version:1,kind:'text',text,stage:'identify',clarificationReason:'catalog_group',parts:[{id:randomUUID(),cards,text}],outboundMessages:1,presentation:cards.length===1?'single_product':'carousel_preview',replyLanguage:state.replyLanguage};
}
function rank(key:string):number{return key==='family'?0:key==='brand'?1:key.startsWith('spec:')?2:3;}
function matches(product:Product,group:Group):boolean {
 const equal=(a:string|undefined,b:string)=>a?.trim().toLocaleLowerCase()===b.trim().toLocaleLowerCase();
 if(group.key==='family')return equal(product.familyId,group.value);
 if(group.key==='brand')return equal(product.brand,group.value);
 if(group.key.startsWith('spec:'))return equal(product.specifications?.[group.key.slice(5)],group.value);
 return false;
}
