import {randomUUID} from 'node:crypto';
import type {ConversationState,DiscoveryResult,RichReply,SimulatorEvent} from '../../../../packages/contracts/index.js';
export function discoveryPresentation(result:DiscoveryResult,state:ConversationState,memoryId?:string,lineId?:string):RichReply {
 const facet=result.facets[0];
 const text=result.products.length?(result.noExactMatch?'These are related suggestions. What will you use the item for? Choose one only if you want that item instead.':'Let’s check the item you mean.')+(facet?` Which ${facet.label}—${facet.values.map(v=>v.label).join(', ')}?`:' Check the photos and names. Which one fits what you need?'):'What will you use it for? Tell me the size, type or brand, and I’ll help identify the item. Your request is kept; the shop can check it.';
 const cards=result.products.map(product=>({product,matchLabel:result.rankings.find(r=>r.sku===product.sku)?.match==='related'?'Related option · please check':undefined,label:lineId?'Use for this item':'Choose this',action:lineId?{id:randomUUID(),type:'select_candidate' as const,questionId:state.pending!.id,lineId,sku:product.sku}:{id:randomUUID(),type:'choose_product' as const,sku:product.sku,expectedVersion:state.version}}));
 const buttons=facet&&memoryId&&!lineId?facet.values.map(v=>({label:v.label,event:{id:randomUUID(),type:'refine_discovery' as const,memoryId,facet:facet.key,value:v.value} as SimulatorEvent})):undefined;
 return {version:1,kind:cards.length?'product_choices':'text',text,cards,buttons,presentation:cards.length===1?'single_product':cards.length&&cards.every(c=>c.product.imageUrl)?'carousel_preview':cards.length?'list':'text',outboundMessages:1};
}
