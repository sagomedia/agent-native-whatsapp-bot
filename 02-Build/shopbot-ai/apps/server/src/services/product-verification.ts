import {createHash,randomUUID} from 'node:crypto';
import type {ConversationState,DraftLine,Product,ProductCheck,ProductCard,RichReply} from '../../../../packages/contracts/index.js';
export function productIdentity(product:Product) {
  return createHash('sha256').update(JSON.stringify([product.sku,product.version,product.name,product.unit,product.imageUrl??null,product.brand??null,product.familyId??null,product.specifications??null])).digest('hex');
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
    const request=line.query&&line.query!==line.sku?line.query:line.name;
    const label=`Item ${number}: ${request}`;
    const quantityLabel=amount===null||amount===undefined?'Quantity to confirm':`Requested: ${amount} ${line.requestedUnit??line.unit??'units'}`;
    cards.push(...group.products.map(product=>({product,requestLabel:label,quantityLabel,matchLabel:group.discovery?.rankings.find(r=>r.sku===product.sku)?.match==='related'?'Related option · please check':line.sku===product.sku?'Suggested product':undefined,label:group.products.length===1?'Add this item':'Choose this option',action:{id:randomUUID(),type:'select_product' as const,batchId:check.id,lineId:line.id,sku:product.sku}})));
    const facet=group.discovery?.facets[0];
    if(facet)return `${number}. ${amount??'?'} × ${request}: which ${facet.label} did you mean—${facet.values.map(v=>v.label).join(', ')}?`;
    return `${number}. ${amount??'?'} × ${request}: ${group.products.length===1?'is this the product you meant?':'which option did you mean?'}`;
  });
  const text=`Please check what I understood:\n${questions.join('\n')}\n\n${check.groups.some(g=>g.discovery?.noExactMatch)?'These are related suggestions, not an exact match. Tell me the job you need it for, or choose one if you want it instead. ':''}Check the photos and names, then add the right items. If anything is wrong, send the correct name, size or type. ${check.remaining?`${check.remaining} more item${check.remaining===1?'':'s'} to check after these. `:''}Nothing is sent to the shop yet.`;
  const narrowing=check.groups.find(g=>g.discovery?.facets.length);
  const facet=narrowing?.discovery?.facets[0];
  const buttons=facet&&narrowing?facet.values.map(v=>({label:v.label,event:{id:randomUUID(),type:'refine_search' as const,batchId:check.id,lineId:narrowing.lineId,facet:facet.key,value:v.value}})):check.groups.length>1&&check.groups.every(g=>g.products.length===1||state.catalogDiscovery&&state.draft.some(l=>l.id===g.lineId&&g.products.some(p=>p.sku===l.sku)))?[{label:check.groups.length===1?'Add this item':'Add these items',event:{id:randomUUID(),type:'confirm_products' as const,batchId:check.id}}]:undefined;
  return {version:1,kind:'product_choices',text,cards,buttons,presentation:cards.length===1?'single_product':cards.every(c=>c.product.imageUrl)?'carousel_preview':'list',outboundMessages:1,remainingChoices:check.remaining};
}
