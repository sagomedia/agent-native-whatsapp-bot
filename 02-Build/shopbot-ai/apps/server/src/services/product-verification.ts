import {say,lineName,unitName,facetLabel,localName} from '../../../../packages/contracts/language.js';
import {createHash,randomUUID} from 'node:crypto';
import type {ConversationState,DraftLine,Product,ProductCheck,ProductCard,RichReply} from '../../../../packages/contracts/index.js';
export function productIdentity(product:Product) {
  return createHash('sha256').update(JSON.stringify([product.sku,product.version,product.name,product.unit,product.localNames??null,product.imageUrl??null,product.brand??null,product.familyId??null,product.specifications??null])).digest('hex');
}
export function productConfirmed(line:DraftLine,product=line.candidates?.find(p=>p.sku===line.sku)) {
  return !!product&&line.productConfirmation?.sku===product.sku&&line.productConfirmation.version===product.version&&line.productConfirmation.identityHash===productIdentity(product);
}
export function preserveConfirmation(old:DraftLine,next:DraftLine) {
  const product=next.candidates?.find(p=>p.sku===next.sku);
  if(product&&productConfirmed(old,product))next.productConfirmation=old.productConfirmation;
  return next;
}
export function markProductConfirmed(line:DraftLine,product:Product) {
  line.productConfirmation={sku:product.sku,version:product.version,identityHash:productIdentity(product)};
}
export function makeProductCheck(state:ConversationState):ProductCheck|null {
  const waiting=state.draft.filter(l=>!productConfirmed(l)&&!!l.candidates?.length);
  const groups:ProductCheck['groups']=[];let count=0;
  for(const line of waiting) {
    const products=(state.catalogDiscovery?line.candidates!.slice(0,3):line.sku?line.candidates!.filter(p=>p.sku===line.sku):line.candidates!).slice(0,10);
    if(!products.length)continue;
    if(groups.length===3||count+products.length>10)break;
    groups.push({lineId:line.id,products,...(line.discovery?{discovery:line.discovery}:{})});count+=products.length;
  }
  return groups.length?{kind:'products',id:randomUUID(),version:state.version,expiresAt:new Date(Date.now()+15*60*1000).toISOString(),groups,remaining:waiting.length-groups.length}:null;
}
export function productCheckReply(state:ConversationState):RichReply {
  const check=state.pending as ProductCheck;
  const cards:ProductCard[]=[];
  const questions=check.groups.map(group=>{
    const line=state.draft.find(l=>l.id===group.lineId)!,number=state.draft.indexOf(line)+1;
    const amount=line.requestedQuantity??line.quantity;
    const request=line.query&&line.query!==line.sku?line.query:lineName(line,state);
    const label=say(state,`Item ${number}: ${request}`,`பொருள் ${number}: ${request}`,`Porul ${number}: ${request}`);
    const quantityLabel=amount===null||amount===undefined?say(state,'Quantity to confirm','எண்ணிக்கையை உறுதி செய்ய வேண்டும்','Quantity confirm pannanum'):say(state,`Requested: ${amount} ${line.requestedUnit??line.unit??'units'}`,`கேட்டது: ${amount} ${unitName(line.requestedUnit??line.unit??'unit',state,amount)}`,`Kettathu: ${amount} ${unitName(line.requestedUnit??line.unit??'unit',state,amount)}`);
    cards.push(...group.products.map(product=>({product,requestLabel:label,quantityLabel,matchLabel:group.discovery?.rankings.find(r=>r.sku===product.sku)?.match==='related'?say(state,'Related option · please check','தொடர்புடைய பொருள் · சரிபார்க்கவும்','Thodarbudaiya porul · check pannunga'):line.sku===product.sku?say(state,'Suggested product','பரிந்துரைக்கப்பட்ட பொருள்','Parinthuraiththa porul'):undefined,label:group.products.length===1?say(state,'Add this item','இந்தப் பொருளைச் சேர்','Intha porulai seru'):say(state,'Choose this option','இதைத் தேர்வு செய்','Ithai choose pannu'),action:{id:randomUUID(),type:'select_product' as const,batchId:check.id,lineId:line.id,sku:product.sku}})));
    const facet=group.discovery?.facets[0];
    if(facet)return say(state,`${number}. ${amount??'?'} × ${request}: which ${facet.label} did you mean—${facet.values.map(v=>v.label).join(', ')}?`,`${number}. ${amount??'?'} × ${request}: எந்த ${facetLabel(facet.key,facet.label,state)} வேண்டும் — ${facet.values.map(v=>localName(v.label,v.localNames,state)).join(', ')}?`,`${number}. ${amount??'?'} × ${request}: entha ${facetLabel(facet.key,facet.label,state)} venum — ${facet.values.map(v=>localName(v.label,v.localNames,state)).join(', ')}?`);
    return say(state,`${number}. ${amount??'?'} × ${request}: ${group.products.length===1?'is this the product you meant?':'which option did you mean?'}`,`${number}. ${amount??'?'} × ${request}: ${group.products.length===1?'நீங்கள் கேட்டது இதுதானா?':'எந்தப் பொருள் வேண்டும்?'}`,`${number}. ${amount??'?'} × ${request}: ${group.products.length===1?'Neenga kettathu ithuthaana?':'Entha porul venum?'}`);
  });
  const englishText=`Please check what I understood:\n${questions.join('\n')}\n\n${check.groups.some(g=>g.discovery?.noExactMatch)?'These are related suggestions, not an exact match. Tell me the job you need it for, or choose one if you want it instead. ':''}Check the photos and names, then add the right items. If anything is wrong, send the correct name, size or type. ${check.remaining?`${check.remaining} more item${check.remaining===1?'':'s'} to check after these. `:''}Nothing is sent to the shop yet.`;
  const text=say(state,englishText,`நான் புரிந்துகொண்டதைச் சரிபாருங்கள்:
${questions.join('\n')}

${check.groups.some(g=>g.discovery?.noExactMatch)?'இவை சரியான பொருத்தம் என்று உறுதி செய்யாத பரிந்துரைகள். என்ன வேலைக்குத் தேவை என்று சொல்லுங்கள். ':''}படத்தையும் பெயரையும் பார்த்து சரியான பொருட்களைச் சேருங்கள். தவறாக இருந்தால் பெயர், அளவு அல்லது வகையை மீண்டும் சொல்லுங்கள். ${check.remaining?`இவற்றுக்குப் பிறகு மேலும் ${check.remaining} பொருட்களைச் சரிபார்ப்போம். `:''}இன்னும் கடைக்கு அனுப்பவில்லை.`,`Naan purinjukittathai sari paarunga:
${questions.join('\n')}

${check.groups.some(g=>g.discovery?.noExactMatch)?'Ivai exact match-nu confirm pannaatha suggestions. Enna velaikku venum-nu sollunga. ':''}Photo-vum peyarum paathu sariyana porutkalai serunga. Thappaa irunthaa peyar, size illa type-ai marubadi sollunga. ${check.remaining?`Ivatrukku piragu melum ${check.remaining} porutkalai check pannalaam. `:''}Innum kadaikku anuppala.`);
  const narrowing=check.groups.find(g=>g.discovery?.facets.length);
  const facet=narrowing?.discovery?.facets[0];
  const buttons=facet&&narrowing?facet.values.map(v=>({label:localName(v.label,v.localNames,state),event:{id:randomUUID(),type:'refine_search' as const,batchId:check.id,lineId:narrowing.lineId,facet:facet.key,value:v.value}})):check.groups.length>1&&check.groups.every(g=>g.products.length===1||state.catalogDiscovery&&state.draft.some(l=>l.id===g.lineId&&g.products.some(p=>p.sku===l.sku)))?[{label:check.groups.length===1?say(state,'Add this item','இந்தப் பொருளைச் சேர்','Intha porulai seru'):say(state,'Add these items','இந்தப் பொருட்களைச் சேர்','Intha porutkalai seru'),event:{id:randomUUID(),type:'confirm_products' as const,batchId:check.id}}]:undefined;
  return {version:1,kind:'product_choices',text,cards,buttons,presentation:cards.length===1?'single_product':cards.every(c=>c.product.imageUrl)?'carousel_preview':'list',outboundMessages:1,remainingChoices:check.remaining};
}
