import {createHash,randomUUID} from 'node:crypto';
import type {ConversationState,DraftLine,Product,ProductCheck,ProductCard,RichReply} from '../../../../packages/contracts/index.js';
export function productIdentity(product:Product) {
  return createHash('sha256').update(JSON.stringify([product.sku,product.version,product.name,product.unit,product.imageUrl??null])).digest('hex');
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
    const products=(line.sku?line.candidates!.filter(p=>p.sku===line.sku):line.candidates!).slice(0,10);
    if(!products.length)continue;
    if(groups.length===3||count+products.length>10)break;
    groups.push({lineId:line.id,products});count+=products.length;
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
    cards.push(...group.products.map(product=>({product,requestLabel:label,quantityLabel,label:group.products.length===1?'Add this item':'Choose this option',action:{id:randomUUID(),type:'select_product' as const,batchId:check.id,lineId:line.id,sku:product.sku}})));
    return `${number}. ${amount??'?'} × ${request}: ${group.products.length===1?'is this the product you meant?':'which option did you mean?'}`;
  });
  const text=`Please check what I understood:\n${questions.join('\n')}\n\nCheck the photos and names, then add the right items. If anything is wrong, send the correct name, size or type. ${check.remaining?`${check.remaining} more item${check.remaining===1?'':'s'} to check after these. `:''}Nothing is sent to the shop yet.`;
  const buttons=check.groups.length>1&&check.groups.every(g=>g.products.length===1)?[{label:check.groups.length===1?'Add this item':'Add these items',event:{id:randomUUID(),type:'confirm_products' as const,batchId:check.id}}]:undefined;
  return {version:1,kind:'product_choices',text,cards,buttons,presentation:cards.length===1?'single_product':cards.every(c=>c.product.imageUrl)?'carousel_preview':'list',outboundMessages:1,remainingChoices:check.remaining};
}
