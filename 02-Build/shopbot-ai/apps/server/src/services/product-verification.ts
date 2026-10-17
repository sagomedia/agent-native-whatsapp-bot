import {discoveryFacetChoices} from './discovery-facet-actions.js';
import {say,lineName,unitName,facetLabel,localName,safeQuestion} from '../../../../packages/contracts/language.js';
import {randomUUID} from 'node:crypto';
import type {ConversationState,DraftLine,Product,ProductCheck,ProductCard,RichReply} from '../../../../packages/contracts/index.js';
import {productConfirmed} from './product-confirmation.js';
export {productIdentity,productConfirmed,preserveConfirmation,markProductConfirmed} from './product-confirmation.js';
import {canQuoteDraft,nextCounterLine,productCheckCoversDraft} from './counter-state.js';
import {productListHash} from './visual-ordering.js';
export function makeProductCheck(state:ConversationState,sequential=false):ProductCheck|null {
  if(state.visualOrdering){
    const hash=productListHash(state);
    if(state.productReview?.hash===hash)return null;
    const active=nextCounterLine(state);
    if(active?.sku&&productConfirmed(active)&&['needs_quantity','needs_unit'].includes(active.resolution))return null;
    // Exact matches can be approved together after variant choices. A line
    // already awaiting a quantity above must still keep its focused question.
    const uncertain=state.draft.find(line=>!line.shopCheckDeferred&&(line.productIntent?.kind==='ambiguous'||!line.sku&&line.candidates?.length));
    const groups=state.draft.flatMap(line=>{const products=line.sku?line.candidates?.filter(p=>p.sku===line.sku)??[]:line.id===uncertain?.id?line.candidates?.slice(0,3)??[]:[];return products.length||line.productIntent?.kind==='ambiguous'?[{lineId:line.id,products,discovery:line.discovery}]:[];});
    const check:ProductCheck={kind:'products',id:randomUUID(),version:state.version,expiresAt:new Date(Date.now()+15*60*1000).toISOString(),groups,remaining:state.draft.filter(l=>!l.sku).length,listHash:hash};
    if(productCheckCoversDraft(state,check)&&canQuoteDraft(state))check.completeReview=true;
    return check;
  }
  const unfinished=state.draft.filter(l=>l.resolution!=='matched'||!productConfirmed(l));
  const bulk=!state.draft.some(l=>productConfirmed(l))&&unfinished.every(l=>l.resolution==='matched'&&!!l.sku&&!!l.quantity&&!l.discovery?.noExactMatch);
  const scope=sequential&&!bulk?unfinished.filter(l=>!l.shopCheckDeferred).slice(0,1):state.draft;
  const waiting=scope.filter(l=>!productConfirmed(l)&&!!l.candidates?.length);
  const groups:ProductCheck['groups']=[];let count=0;
  for(const line of waiting) {
    const products=(line.sku?line.candidates!.filter(p=>p.sku===line.sku):state.catalogDiscovery?line.candidates!.slice(0,sequential?4:6):line.candidates!).slice(0,10);
    if(!products.length)continue;
    if(groups.length===3||count+products.length>10)break;
    groups.push({lineId:line.id,products,...(line.discovery?{discovery:line.discovery}:{})});count+=products.length;
  }
  return groups.length?{kind:'products',id:randomUUID(),version:state.version,expiresAt:new Date(Date.now()+15*60*1000).toISOString(),groups,remaining:sequential&&!bulk?Math.max(0,unfinished.length-groups.length):waiting.length-groups.length}:null;
}
export function productCheckReply(state:ConversationState,question?:string):RichReply {
  const check=state.pending as ProductCheck;
  const cards:ProductCard[]=[];
  const questions=check.groups.map(group=>{
    const line=state.draft.find(l=>l.id===group.lineId)!,number=state.draft.indexOf(line)+1;
    const amount=line.requestedQuantity??line.quantity;
    const request=line.query&&line.query!==line.sku?line.query:lineName(line,state);
    const label=say(state,`Item ${number}: ${request}`,`பொருள் ${number}: ${request}`,`Porul ${number}: ${request}`);
    const quantityLabel=amount===null||amount===undefined?say(state,'Quantity to confirm','எண்ணிக்கையை உறுதி செய்ய வேண்டும்','Quantity confirm pannanum'):say(state,`Requested: ${amount} ${line.requestedUnit??line.unit??'units'}`,`கேட்டது: ${amount} ${unitName(line.requestedUnit??line.unit??'unit',state,amount)}`,`Kettathu: ${amount} ${unitName(line.requestedUnit??line.unit??'unit',state,amount)}`);
    cards.push(...group.products.map(product=>({product,requestLabel:label,quantityLabel,matchLabel:group.discovery?.rankings.find(r=>r.sku===product.sku)?.match==='related'?say(state,'Related option · please check','தொடர்புடைய பொருள் · சரிபார்க்கவும்','Thodarbudaiya porul · check pannunga'):line.sku===product.sku?say(state,'Suggested product','இந்த item-ஐ check பண்ணுங்க','Parinthuraiththa porul'):undefined,label:group.products.length===1?say(state,'Add this item','இந்தப் பொருளைச் சேர்','Intha porulai seru'):say(state,'Choose this option','இது வேணும்','Ithai choose pannu'),action:{id:randomUUID(),type:'select_product' as const,batchId:check.id,lineId:line.id,sku:product.sku}})));
    if(/^(?:cutter|கட்டர்)$/i.test(request.trim()))return say(state,'What do you need to cut? Check each product name and photo; choose only the type you need.','எதை வெட்ட கட்டர் வேண்டும்? பெயரையும் படத்தையும் பார்த்து, தேவையான வகையை மட்டும் தேர்வு செய்யுங்கள்.','Ethai vetta cutter venum? Peyaraiyum photo-vaiyum paathu thevaiyana type mattum choose pannunga.');
    const facet=group.discovery?.facets[0];
    if(facet)return say(state,`${number}. ${amount===null||amount===undefined?'':amount+' × '}${request}: which ${facet.label} did you mean—${facet.values.map(v=>v.label).join(', ')}?`,`${number}. ${amount===null||amount===undefined?'':amount+' × '}${request}: எந்த ${facetLabel(facet.key,facet.label,state)} வேண்டும் — ${facet.values.map(v=>localName(v.label,v.localNames,state)).join(', ')}?`,`${number}. ${amount===null||amount===undefined?'':amount+' × '}${request}: entha ${facetLabel(facet.key,facet.label,state)} venum — ${facet.values.map(v=>localName(v.label,v.localNames,state)).join(', ')}?`);
    return say(state,`${number}. ${amount===null||amount===undefined?'':amount+' × '}${request}: ${group.products.length===1?'is this the product you meant?':'which option did you mean?'}`,`${number}. ${amount===null||amount===undefined?'':amount+' × '}${request}: ${group.products.length===1?'நீங்கள் கேட்டது இதுதானா?':'எந்தப் பொருள் வேண்டும்?'}`,`${number}. ${amount===null||amount===undefined?'':amount+' × '}${request}: ${group.products.length===1?'Neenga kettathu ithuthaana?':'Entha porul venum?'}`);
  });
  const englishText=`Please check what I understood:\n${questions.join('\n')}\n\n${check.groups.some(g=>g.discovery?.noExactMatch)?'These are related suggestions, not an exact match. Tell me the job you need it for, or choose one if you want it instead. ':''}Check the photos and names, then add the right items. If anything is wrong, send the correct name, size or type. ${check.remaining?`${check.remaining} more item${check.remaining===1?'':'s'} to check after these. `:''}Nothing is sent to the shop yet.`;
  let text=say(state,englishText,`நான் புரிந்துகொண்டதைச் சரிபாருங்கள்:
${questions.join('\n')}

${check.groups.some(g=>g.discovery?.noExactMatch)?'இவை சரியான பொருத்தம் என்று உறுதி செய்யாத பரிந்துரைகள். என்ன வேலைக்குத் தேவை என்று சொல்லுங்கள். ':''}படத்தையும் பெயரையும் பார்த்து சரியான பொருட்களைச் சேருங்கள். தவறாக இருந்தால் பெயர், அளவு அல்லது வகையை மீண்டும் சொல்லுங்கள். ${check.remaining?`இவற்றுக்குப் பிறகு மேலும் ${check.remaining} பொருட்களைச் சரிபார்ப்போம். `:''}இன்னும் கடைக்கு அனுப்பவில்லை.`,`Naan purinjukittathai sari paarunga:
${questions.join('\n')}

${check.groups.some(g=>g.discovery?.noExactMatch)?'Ivai exact match-nu confirm pannaatha suggestions. Enna velaikku venum-nu sollunga. ':''}Photo-vum peyarum paathu sariyana porutkalai serunga. Thappaa irunthaa peyar, size illa type-ai marubadi sollunga. ${check.remaining?`Ivatrukku piragu melum ${check.remaining} porutkalai check pannalaam. `:''}Innum kadaikku anuppala.`);
  const vagueCutter=check.groups.some(group=>/^(?:cutter|கட்டர்)$/i.test((state.draft.find(l=>l.id===group.lineId)?.query??'').trim()));
  const focusedQuestion=vagueCutter?undefined:safeQuestion(question,state);if(focusedQuestion)text=focusedQuestion+'\n\n'+text;
  if(check.groups.length===1&&state.draft.length>1){
    const number=state.draft.findIndex(l=>l.id===check.groups[0].lineId)+1;
    const list=state.draft.map((line,index)=>`${index+1}. ${line.requestedQuantity??line.quantity??''}${line.requestedQuantity!=null||line.quantity!=null?' × ':''}${line.query&&line.query!==line.sku?line.query:lineName(line,state)}`).join('\n');
    const related=check.groups.some(g=>g.discovery?.noExactMatch);
    const warning=related?say(state,'These photos are related options, not a confirmed match. Choose one only if you want it instead; otherwise describe the item you need.','இந்தப் படங்கள் தொடர்புடைய பொருட்கள்; நீங்கள் கேட்ட பொருள் என்று உறுதி இல்லை. மாற்றாக வேண்டுமென்றால் மட்டும் தேர்வு செய்யுங்கள்; இல்லையெனில் வேண்டிய பொருளை விவரிக்கவும்.','Intha photos related options; neenga ketta porul-nu confirm aagala. Vera porul venumna mattum choose pannunga; illana thevaiyana porulai vivarunga.'):'';
    text=say(state,`Item ${number} of ${state.draft.length}\n${focusedQuestion??questions[0]}${warning?'\n'+warning:''}\n\nYour list:\n${list}\n\nCheck this item first; the other items are kept. Nothing has been sent to the shop.`,`பொருள் ${number} / ${state.draft.length}\n${focusedQuestion??questions[0]}${warning?'\n'+warning:''}\n\nஉங்கள் பட்டியல்:\n${list}\n\nமுதலில் இந்தப் பொருளைச் சரிபார்க்கவும்; மற்ற பொருட்கள் பட்டியலில் உள்ளன. இன்னும் கடைக்கு அனுப்பவில்லை.`,`Porul ${number} / ${state.draft.length}\n${focusedQuestion??questions[0]}${warning?'\n'+warning:''}\n\nUnga list:\n${list}\n\nMudhalil intha porulai check pannunga; matra porutkal list-la irukku. Innum kadaikku anuppala.`);
  }
  const narrowing=check.groups.find(g=>g.discovery?.facets.length);
  const facet=narrowing?.discovery?.facets[0];
  const filters=facet&&narrowing?discoveryFacetChoices(facet,state).map(v=>({label:v.label,event:{id:randomUUID(),type:'refine_search' as const,batchId:check.id,lineId:narrowing.lineId,facet:facet.key,value:v.value}})):[];
  const identified=check.groups.every(g=>g.products.length===1&&!g.discovery?.noExactMatch);
  const bulk=identified?[{label:check.groups.length===1&&check.remaining?say(state,'This item is right','இந்தப் பொருள் சரி','Intha porul sari'):say(state,'All correct','அனைத்தும் சரி','Ellaam sari'),event:{id:randomUUID(),type:'confirm_products' as const,batchId:check.id}}]:[];
  const buttons=identified?[...bulk,{label:say(state,'Change an item','மாற்றணும்','Porulai maathu'),event:{id:randomUUID(),type:'shopping_action' as const,action:'edit_list' as const,expectedVersion:state.version}},{label:say(state,'Talk to shop','உதவி வேணும்','Kadaiyila pesu'),event:{id:randomUUID(),type:'shopping_action' as const,action:'handoff' as const,expectedVersion:state.version}}]:filters.slice(0,3);
  return {version:1,kind:'product_choices',text,cards,buttons:buttons.length?buttons:undefined,presentation:cards.length===1?'single_product':cards.every(c=>c.product.imageUrl)?'carousel_preview':'list',outboundMessages:1,remainingChoices:check.remaining};
}
