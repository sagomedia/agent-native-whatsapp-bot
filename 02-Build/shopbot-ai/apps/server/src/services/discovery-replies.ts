import {differenceLabel,catalogQuestion} from './catalog-differences.js';
import {discoveryFacetChoices} from './discovery-facet-actions.js';
import {say,facetLabel,localName,safeQuestion,unitName} from '../../../../packages/contracts/language.js';
import {randomUUID} from 'node:crypto';
import type {ConversationState,DiscoveryResult,RichReply,SimulatorEvent} from '../../../../packages/contracts/index.js';
export function discoveryPresentation(result:DiscoveryResult,state:ConversationState,memoryId?:string,lineId?:string,question?:string,selection?:{quantity?:number;unit?:string}):RichReply {
 result={...result,products:result.products.slice(0,4)};
 const facet=result.facets[0];
 const line=lineId?state.draft.find(l=>l.id===lineId):undefined;
 const measures=line?.productMeasures??[];
 const knownDimension=(dimension:'size'|'diameter'|'length')=>measures.some(measure=>measure.role===dimension||dimension==='size'&&!measure.role);
 const proposedQuestion=catalogQuestion(question,state,result.products);
 const requestedDimensions:('size'|'diameter'|'length')[]=proposedQuestion?[
  ...(/\bdiameter\b|விட்டம்|\bvittam\b/i.test(proposedQuestion)?['diameter' as const]:[]),
  ...(/\blength\b|நீளம்|\bneelam\b/i.test(proposedQuestion)?['length' as const]:[]),
  ...(/\bsize\b|அளவு|\balavu\b/i.test(proposedQuestion)?['size' as const]:[])
 ]:[];
 const asksOtherDetail=!!proposedQuestion&&/\b(?:brand|type|kind|material|colour|color|use|job)\b|பிராண்ட்|வகை|நிறம்|வேலை|\b(?:vagai|brand|velai|colour|color)\b/i.test(proposedQuestion);
 const questionText=requestedDimensions.length===1&&knownDimension(requestedDimensions[0])&&!asksOtherDetail?undefined:proposedQuestion;
 const facetDimension=facet?.key.replace(/^spec:/,'');
 const facetIsKnownDimension=(facetDimension==='size'||facetDimension==='diameter'||facetDimension==='length')&&knownDimension(facetDimension);
 const askFacet=!!facet?.values.length&&!facetIsKnownDimension;
 const nextQuestion=questionText??(askFacet?say(state,`Which ${facet.label}: ${facet.values.map(v=>v.label).join(', ')}?`,`எந்த ${facetLabel(facet.key,facet.label,state)} வேண்டும்: ${facet.values.map(v=>localName(v.label,v.localNames,state)).join(', ')}?`,`Entha ${facetLabel(facet.key,facet.label,state)} venum: ${facet.values.map(v=>localName(v.label,v.localNames,state)).join(', ')}?`):say(state,'Which photo shows the item you need?','எந்தப் படத்தில் நீங்கள் கேட்ட பொருள் இருக்கு?','Entha photo-la neenga ketta porul irukku?'));
 const relatedWarning=result.noExactMatch?say(state,'These are related catalog items. Choose one only if you want that item instead.','இவை தொடர்புடைய பட்டியல் பொருட்கள். இதில் உள்ள பொருள் வேண்டுமென்றால் மட்டும் தேர்வு செய்யுங்கள்.','Ivai thodarbudaiya catalog porutkal. Ithil ulla porul venumna mattum choose pannunga.'):undefined;
 const photoStep=say(state,'Choose a photo, or reply with the item name or type if none fits.','படத்தில் தேர்வு செய்யுங்கள்; பொருந்தவில்லை என்றால் பொருள் பெயர் அல்லது வகையைச் சொல்லுங்கள்.','Photo-la choose pannunga; porunthalana porul peyar illa type sollunga.');
 let text=result.products.length?questionText?[questionText,[relatedWarning,photoStep].filter(Boolean).join(' ')].join('\n'):[relatedWarning,nextQuestion,photoStep].filter(Boolean).join(' '):'';
 if(!result.products.length){
  const amount=selection?.quantity?say(state,` (${selection.quantity} ${selection.unit??'units'})`,` (${selection.quantity} ${unitName(selection.unit??'unit',state,selection.quantity)})`,` (${selection.quantity} ${unitName(selection.unit??'unit',state,selection.quantity)})`):'';
  const saved=!!lineId&&state.draft.some(l=>l.id===lineId);
  const intro=saved?say(state,`“${result.query}”${amount} is on your list.`,`“${result.query}”${amount} உங்கள் பட்டியலில் உள்ளது.`,`“${result.query}”${amount} unga list-la irukku.`):say(state,`I found no catalog match for “${result.query}”${amount}.`,`“${result.query}”${amount} பட்டியலில் பொருந்தும் பதிவு கிடைக்கவில்லை.`,`“${result.query}”${amount} catalog-la matching listing kidaikkala.`);
  const descriptiveRequest=result.query.trim().split(/\s+/).length>=3;
  const redundantQuestion=descriptiveRequest&&!!questionText&&/\b(?:size|brand|type|use|job)\b|அளவு|பிராண்ட்|வகை|வேலை|\b(?:alavu|brand|vagai|velai)\b/i.test(questionText);
  const next=redundantQuestion?undefined:questionText??(descriptiveRequest?undefined:/^(?:paint|பெயிண்ட்|பெயின்ட்)$/i.test(result.query.trim())?say(state,'What are you painting: walls, wood or metal?','சுவர், மரம் அல்லது உலோகம் — எதற்குப் பெயிண்ட் வேண்டும்?','Suvar, maram illa metal — ethukku paint venum?'):knownDimension('size')?say(state,'What will you use it for?','என்ன வேலைக்குத் தேவை?','Enna velaikku venum?'):say(state,'What will you use it for? Include a size or type if you know it.','என்ன வேலைக்குத் தேவை? அளவு அல்லது வகை தெரிந்தால் சேர்த்துச் சொல்லுங்கள்.','Enna velaikku venum? Size illa type therinja serththu sollunga.'));
  text=[intro,saved?say(state,'I’ve kept your request. You can send it to the shop to check.','உங்கள் கோரிக்கையை வைத்துள்ளேன். சரிபார்க்க கடைக்கு அனுப்பலாம்.','Unga request-ai vechchirukken. Check panna kadaikku anuppalaam.'):say(state,'You can send this description to the shop to check.','இந்த விவரத்தை சரிபார்க்க கடைக்கு அனுப்பலாம்.','Intha vivarathai check panna kadaikku anuppalaam.'),next??say(state,'You can correct the description or ask the shop to check.','விவரத்தைத் திருத்தலாம் அல்லது கடையிடம் சரிபார்க்கச் சொல்லலாம்.','Vivarathai thiruththalaam illa kadaiyila check panna sollalaam.')].join(' ');
 }
 const cards=result.products.map(product=>({product,quantityLabel:selection?.quantity?say(state,`Requested: ${selection.quantity} ${selection.unit??'units'}`,`கேட்டது: ${selection.quantity} ${unitName(selection.unit??'unit',state,selection.quantity)}`,`Kettathu: ${selection.quantity} ${unitName(selection.unit??'unit',state,selection.quantity)}`):undefined,detailLabel:[product.brand,...Object.values(product.specifications??{})].filter(Boolean).join(' · '),matchLabel:differenceLabel(result,product.sku,state)??(result.rankings.find(r=>r.sku===product.sku)?.match==='related'?say(state,'Related option · please check','தொடர்புடைய பொருள் · சரிபார்க்கவும்','Thodarbudaiya porul · check pannunga'):undefined),label:lineId?say(state,'Use for this item','இந்தப் பொருளை பயன்படுத்து','Intha porulai use pannu'):say(state,'Choose this','இது வேணும்','Ithai choose pannu'),action:lineId?{id:randomUUID(),type:'select_candidate' as const,questionId:state.pending!.id,lineId,sku:product.sku}:{id:randomUUID(),type:'choose_product' as const,sku:product.sku,expectedVersion:state.version}}));
 const buttons=facet&&memoryId&&!lineId?discoveryFacetChoices(facet,state).map(v=>({label:v.label,event:{id:randomUUID(),type:'refine_discovery' as const,memoryId,facet:facet.key,value:v.value} as SimulatorEvent})):undefined;
 return {version:1,kind:cards.length?'product_choices':'text',text,cards,buttons,presentation:cards.length===1?'single_product':cards.length&&cards.every(c=>c.product.imageUrl)?'carousel_preview':cards.length?'list':'text',outboundMessages:1};
}
