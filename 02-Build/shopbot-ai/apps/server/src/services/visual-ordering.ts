import {catalogGroupReply} from './catalog-group-replies.js';
import {differenceLabel,catalogQuestion} from './catalog-differences.js';
import {buildProductCaption} from '../../../../packages/contracts/channel-text.js';
import type {Product} from '../../../../packages/contracts/index.js';
import {customerCopy} from '../../../../packages/contracts/customer-copy.js';
import {checkoutNextStep,estimateLines,estimateText,estimatePendingReason,estimatePendingSummary,estimateTotalText,indicativeLineEstimate,indicativeEstimate} from './order-estimate.js';
import {textPresentation} from './message-presentation.js';
import {randomUUID,createHash} from 'node:crypto';
import type {ConversationState,RichReply,ReplyPart,VisualCard,ProductCheck,OrderRequest} from '../../../../packages/contracts/index.js';
import {say,lineName,unitName,productName,safeQuestion,localName,draftIssueText,requestedAmountText,measurementText,productPriceText,productStockText,referencePhotoLabel} from '../../../../packages/contracts/language.js';
import {formatMoney,lineTotal} from '../../../../packages/contracts/money.js';
import {productIdentity} from './product-confirmation.js';
import {counterLine,nextCounterLine,productCheckCoversDraft} from './counter-state.js';
import {fitText,productMediaUrl} from './whatsapp-reply.js';
import {requestStatusText} from './request-status.js';
import {catalogPack,catalogContent} from './quantity-evidence.js';
import {INVOICE_ROWS_PER_PAGE} from './visual-images.js';
import {planReply} from './reply-plan.js';

type Button=NonNullable<RichReply['buttons']>[number];
export const orderReference=(id:string)=>'Order #'+id.replaceAll('-','').slice(0,8).toUpperCase();
export function productListHash(state:ConversationState):string {return createHash('sha256').update(JSON.stringify(state.draft.map(l=>[l.id,l.sku,l.query,l.packSize,l.productMeasures,l.productIntent,l.candidates?.find(p=>p.sku===l.sku)?productIdentity(l.candidates.find(p=>p.sku===l.sku)!):null]))).digest('hex');}
const action=(state:ConversationState,a:'edit_list'|'handoff'|'continue_list'|'new_list'|'browse'|'view_products',label:string):Button=>({label,event:{id:randomUUID(),type:'shopping_action',action:a,expectedVersion:state.version}});
const instruction=(title:string,lines:string[],caption:string,buttons:Button[]=[]):VisualCard=>({kind:'instruction',title,lines,caption,buttons});
function reply(stage:RichReply['stage'],parts:ReplyPart[],reason?:string):RichReply {return {version:1,kind:stage==='bill'?'order_review':'text',text:parts.map(p=>p.text).filter(Boolean).join('\n\n'),stage,clarificationReason:reason,parts,outboundMessages:parts.length,presentation:parts.some(p=>p.cards.length>1)?'carousel_preview':'single_product'};}
const part=(cards:VisualCard[],text:string,buttons?:Button[]):ReplyPart=>({id:randomUUID(),cards,text,buttons});
const change=(state:ConversationState)=>action(state,'edit_list',say(state,'Change items','மாற்றணும்','Maathanum'));
const shop=(state:ConversationState)=>action(state,'handoff',say(state,'Talk to shop','உதவி வேணும்','Kadaiyila pesu'));
const editHint=(state:ConversationState)=>say(state,'Message or voice note to add, remove or change items.','சேர்க்க, நீக்க அல்லது மாற்ற மெசேஜ் அல்லது வாய்ஸ் நோட் அனுப்புங்க.','Serkka, neekka illa maatha message allathu voice note anuppunga.');
const showBill=(state:ConversationState):Button=>({
 label:say(state,'Show bill','பில் காட்டு','Bill kaattu'),
 event:{id:randomUUID(),type:'show_bill',expectedVersion:state.version},
});
export function cartProgress(state:ConversationState):string[] {
 if(!state.draft.length||state.lastRequestId)return [];
 const priced=state.draft.filter(l=>counterLine(l).canQuote);
 const pending=state.draft.filter(l=>!priced.includes(l));
 const total=priced.reduce((sum,l)=>sum+lineTotal(l.pricePaise!,l.quantity!),0);
 const details=pending.slice(0,3).map(l=>{
  const {blockers}=counterLine(l);
  const status=blockers.includes('specification')||blockers.includes('variant')?say(state,'type/brand choice needed','வகை/பிராண்ட் தேர்வு தேவை','Type/brand choose pannanum')
   :blockers.includes('shop_check')?say(state,'shop check needed','கடை சரிபார்க்க வேண்டும்','Kadai check pannanum')
   :blockers.includes('unit')?say(state,'selling basis needs checking','விற்பனை அலகு சரிபார்க்க வேண்டும்','Virpanai unit check pannanum')
   :say(state,'quantity needed','எண்ணிக்கை தேவை','Count venum');
  return `${lineName(l,state)}: ${status}`;
 });
 const subtotal=priced.length?[say(state,pending.length?`Known catalog subtotal: ${formatMoney(total)} (${priced.length} items). Pending items are excluded.`:`Catalog estimate: ${formatMoney(total)}. Shop price and availability need confirmation.`,pending.length?`தெரிந்த விலை கூட்டுத்தொகை: ${formatMoney(total)} (${priced.length} பொருட்கள்). தெரியாத விவரங்கள் இதில் சேர்க்கப்படவில்லை.`:`உத்தேச விலை: ${formatMoney(total)}. கடை விலை/இருப்பை உறுதி செய்ய வேண்டும்.`,pending.length?`Therintha vilai subtotal: ${formatMoney(total)} (${priced.length} porutkal). Pending items ithil serkkala.`:`Estimate vilai: ${formatMoney(total)}. Kadai vilai/iruppai confirm pannanum.`)]:[];
 return [...subtotal,...details,...(pending.length>3?[say(state,`${pending.length-3} more items need checking.`,`${pending.length-3} பொருட்களையும் சரிபார்க்க வேண்டும்.`,`${pending.length-3} porutkalaiyum check pannalaam.`)]:[])];
}
function budgetText(line:ConversationState['draft'][number],state:ConversationState):string|undefined {
 if(!line.requestedBudgetPaise)return;
 const used=line.quantity!==null&&line.resolution==='matched'&&line.pricePaise!==undefined?lineTotal(line.pricePaise,line.quantity):null;
 return say(state,`Budget ${formatMoney(line.requestedBudgetPaise)}${used!==null?`; unspent ${formatMoney(Math.max(0,line.requestedBudgetPaise-used))}`:''}`,`கேட்ட தொகை ${formatMoney(line.requestedBudgetPaise)}${used!==null?`; மீதி ${formatMoney(Math.max(0,line.requestedBudgetPaise-used))}`:''}`,`Ketta thogai ${formatMoney(line.requestedBudgetPaise)}${used!==null?`; meethi ${formatMoney(Math.max(0,line.requestedBudgetPaise-used))}`:''}`);
}
function draftReviewCards(state:ConversationState,showOptions=false):VisualCard[]{
 return state.draft.flatMap((line,index)=>{
  const edit:Button={label:say(state,'Change this','இதை மாற்று','Ithai maathu'),event:{id:randomUUID(),type:'edit_item',lineId:line.id,expectedVersion:state.version}};
  const product=line.candidates?.find(p=>p.sku===line.sku);
  if(!line.sku&&showOptions&&line.resolution==='needs_choice'&&!line.shopCheckDeferred){
   const option=line.candidates?.find(candidate=>productMediaUrl(candidate.imageUrl));
   if(option){
    const possible=say(state,'Possible match · check type','சாத்தியமான பொருள்','Possible match · vagai check');
    const requested=say(state,`Requested: ${lineName(line,state)}`,`கேட்டது: ${lineName(line,state)}`,`Kettathu: ${lineName(line,state)}`);
    return [{kind:'product',lineId:line.id,product:option,caption:productCaption(option,state,[possible,requested],index+1),buttons:[edit]}];
   }
  }
  if(!product)return [instruction(lineName(line,state),[line.sourceUncertainty?.includes('product_identity')||line.catalogIssue==='catalog_check_pending'?draftIssueText(line,state)!:say(state,'Request awaiting shop checking · price pending','கடை சரிபார்க்க வேண்டிய கோரிக்கை · விலை இன்னும் வரல','Kadai check panna vendiya request · vilai innum varala'),line.quantity===null?say(state,'Count to check','Count check பண்ணணும்','Count check pannanum'):`${line.quantity} ${unitName(line.unit??line.requestedUnit??'unit',state,line.quantity)}`],lineName(line,state),[edit])];
  const pack=line.packSize??catalogPack(product),size=pack?`${pack.value} ${pack.unit}`:product.specifications?.size;
  const content=catalogContent(product),amount=line.requestedAmount;
  const count=line.quantity===null?line.requestedQuantity!==undefined?`${line.requestedQuantity} ${unitName(line.requestedUnit??'unit',state,line.requestedQuantity)}`:amount?requestedAmountText(line,state):say(state,'Count: to check','எண்ணிக்கை: சொல்ல வேண்டும்','Count: sollanum'):`${line.quantity} ${unitName(product.unit,state,line.quantity)}`;
  const conversion=amount&&content&&line.quantity!==null&&!['metre','foot','litre','kg'].includes(product.unit)?`${content.value} ${content.unit} × ${line.quantity} = ${amount.value} ${amount.unit}`:undefined;
  return [{kind:'product',lineId:line.id,product,caption:productCaption(product,state,[count,measurementText(size??'',state),budgetText(line,state),conversion?measurementText(conversion,state):undefined],index+1),buttons:[edit]}];
 });
}

/** View the whole current list without replacing its pending question or goal. */
export function visualListView(state:ConversationState):RichReply {
 if(!state.draft.length)return {...textPresentation(say(state,'Your list is empty. Tell me what you need.','உங்கள் பட்டியல் காலியாக இருக்கு. என்ன பொருள் வேணும் சொல்லுங்க.','Unga list kaaliya irukku. Enna porul venum sollunga.'),[],'status'),readOnly:true,replyLanguage:state.replyLanguage};
 if(!state.lastRequestId&&state.pending?.kind==='products'&&state.pending.version===state.version&&Date.parse(state.pending.expiresAt)>Date.now()&&productCheckCoversDraft(state,state.pending))return {...visualProductReview(state),readOnly:true,replyLanguage:state.replyLanguage};
 const cards=draftReviewCards(state,!state.lastRequestId);
 if(state.lastRequestId)for(const card of cards)card.buttons=[{label:say(state,'Order status','Order நிலை','Order status'),event:{id:randomUUID(),type:'shopping_action',action:'status',expectedVersion:state.version}}];
 const title=say(state,`Your list · ${state.draft.length} items`,`உங்கள் பட்டியல் · ${state.draft.length} பொருட்கள்`,`Unga list · ${state.draft.length} porutkal`);
 const parts:ReplyPart[]=[];
 for(let offset=0;offset<cards.length;offset+=10)parts.push(part(cards.slice(offset,offset+10),offset===0?title:say(state,'More items in your list','பட்டியலில் உள்ள மற்ற பொருட்கள்','List-la ulla maththa porutkal')));
 return {...reply('products',parts),readOnly:true,replyLanguage:state.replyLanguage};
}

/** Resume the visual list after a saved edit without asking for consent to an unseen bill. */
export function visualCartMutation(state:ConversationState,contextLines?:string[]):RichReply|undefined {
 if(!state.draft.length)return {
  ...textPresentation(say(state,'Your list is empty. What would you like to add?','பட்டியலில் பொருள் எதுவும் இல்லை. என்ன சேர்க்கணும்?','List-la porul edhuvum illa. Enna serkkanum?'),[],'status'),
  replyLanguage:state.replyLanguage,
 };
 if(state.pending?.kind==='products'){
  const review=visualProductReview(state);
  if(review.stage==='products'||review.stage==='shop_check')return withContext({...review,replyLanguage:state.replyLanguage},contextLines);
 }
 if(state.pending?.kind==='review'){
  const showBill:Button={label:showBillLabel(state),event:state.pending.excludedLineIds
   ?{id:randomUUID(),type:'review_partial',expectedVersion:state.version}
   :{id:randomUUID(),type:'review',expectedVersion:state.version}};
  const parts=cartReviewPages(state,draftReviewCards(state),showBill,cartReviewTitle(state));
  return withContext({...reply('products',parts),replyLanguage:state.replyLanguage},contextLines);
 }
}

function showBillLabel(state:ConversationState) {return say(state,'Show bill','பில் காட்டு','Bill kaattu');}
function cartReviewTitle(state:ConversationState) {
 const count=state.draft.length;
 return say(state,`Your list · ${count} ${count===1?'item':'items'}`,`பட்டியல் · ${count} ${count===1?'பொருள்':'பொருட்கள்'}`,`Unga list · ${count} ${count===1?'porul':'porutkal'}`);
}
function cartReviewPages(state:ConversationState,cards:VisualCard[],primary:Button|undefined,firstText:string,guide?:VisualCard):ReplyPart[] {
 const showGuide=guide&&cards.length>1&&cards.every(card=>(card.buttons?.length??1)===1);
 const reviewCards=showGuide?[guide,...cards]:cards;
 const pages=Math.ceil(reviewCards.length/10);
 const hasBillAction=primary?.label===showBillLabel(state);
 const parts:ReplyPart[]=[];
 for(let offset=0;offset<reviewCards.length;offset+=10){
  const page=offset/10+1,final=page===pages;
  const group=reviewCards.slice(offset,offset+10).map(card=>{
   const buttons=card.buttons??[change(state)];
   return {...card,buttons:final&&primary&&buttons.length===1?[primary,...buttons]:buttons.slice(0,2)};
  });
  if(group.length>1&&group.some(card=>card.buttons.length===2)){
   for(const card of group)if(card.buttons.length===1)card.buttons.push(change(state));
  }
  const pageNumber=say(state,`Items · ${page}/${pages}`,`பொருட்கள் · ${page}/${pages}`,`Porutkal · ${page}/${pages}`);
  const next=final&&page>1&&hasBillAction?say(state,'Tap Show bill when ready.','பில் காட்டு என்பதைத் தட்டுங்க.','Bill kaattu-ai thattunga.'):undefined;
  parts.push(part(group,[page===1?firstText:undefined,pages>1?pageNumber:undefined,next].filter(Boolean).join('\n')));
 }
 return parts;
}

export function visualProductReview(state:ConversationState,compact=false,clarifyQuestion?:string):RichReply {
 const check=state.pending as ProductCheck;
 for(const group of check.groups){if(group.discovery){const grouped=catalogGroupReply(group.discovery,state,{lineId:group.lineId,batchId:check.id});if(grouped)return grouped;}}
 const meaning=check.groups.find(g=>state.draft.find(l=>l.id===g.lineId)?.productIntent?.kind==='ambiguous');
 if(meaning){
  const line=state.draft.find(l=>l.id===meaning.lineId)!,intent=line.productIntent!;
  const question=safeQuestion(intent.question,state)??say(state,'Which product type do you mean?','எந்த வகைப் பொருள் வேணும்?','Entha vagai porul venum?');
  const cards:VisualCard[]=intent.alternatives!.map(a=>{
   const product=meaning.products.find(p=>p.familyId===a.familyId),family=meaning.discovery?.facets.find(f=>f.key==='family')?.values.find(v=>v.value===a.familyId);
   const select:Button={label:say(state,'This type','இந்த வகை','Intha vagai'),event:{id:randomUUID(),type:'refine_search',batchId:check.id,lineId:line.id,facet:'family',value:a.familyId}};
   const caption=family?localName(family.label,family.localNames,state):a.query;
   return product?{kind:'product',lineId:line.id,product,caption:productCaption(product,state,[caption,product.specifications?.size]),buttons:[select]}:instruction(caption,[say(state,'Shop needs to check this type','இந்த வகையை கடை சரிபார்க்கணும்','Intha vagai kadai check pannanum')],caption,[select]);
  });
  return reply('identify',[part(cards,question)],'product_meaning');
 }
 const ambiguous=check.groups.find(g=>g.products.length>0&&(g.products.length>1||!state.draft.find(l=>l.id===g.lineId)?.sku)),missing=state.draft.filter(l=>!l.sku&&!l.candidates?.length||l.resolution==='unavailable');
 const identified=productCheckCoversDraft(state,check);
 const noListings=state.draft.length>0&&state.draft.every(line=>!line.sku&&!line.candidates?.length);
 const confirmShown=identified||!!state.allowPartialReview&&check.groups.length>0&&check.groups.every(g=>g.products.length===1&&state.draft.find(l=>l.id===g.lineId)?.sku===g.products[0].sku);
 const needsCount=state.draft.some(line=>line.sku&&line.quantity===null&&!line.shopCheckDeferred);
 const estimateButton=showBill(state);
 const approve:Button={label:needsCount?say(state,'Items correct','பொருட்கள் சரி','Porutkal sari'):estimateButton.label,event:{id:randomUUID(),type:'confirm_products',batchId:check.id}};
 const edit=change(state);
 if(ambiguous){
  const line=state.draft.find(l=>l.id===ambiguous.lineId)!;
  const alternative=line.packUnitAlternative&&!line.packUnitAlternative.acceptedSku;
  const choices:VisualCard[]=ambiguous.products.slice(0,10).map(product=>({kind:'product',lineId:line.id,product,caption:productCaption(product,state,[line.quantity!==null?say(state,`Requested: ${line.quantity} ${line.requestedUnit??line.unit??'units'}`,`கேட்டது: ${line.quantity} ${unitName(line.requestedUnit??line.unit??'unit',state,line.quantity)}`,`Kettathu: ${line.quantity} ${line.requestedUnit??line.unit??'units'}`):undefined,differenceLabel(line.discovery,product.sku,state),product.brand,measurementText(product.specifications?.size??product.specifications?.weight??'',state)]),buttons:[{label:alternative?say(state,'Use this pack','இந்த pack வேணும்','Intha pack venum'):say(state,'Choose this','இது வேணும்','Ithu venum'),event:{id:randomUUID(),type:'select_product',batchId:check.id,lineId:line.id,sku:product.sku}}]}));
  // The model's clarification can target a different line or the next step.
  // Never ask for count while the displayed buttons choose a product.
  const proposed=catalogQuestion(clarifyQuestion,state,ambiguous.products);
  const choiceQuestion=proposed&&!/\b(?:how many|how much|quantity|count|number of|eththanai|ethanai|evvalavu|evlo)\b|எத்தன|எவ்வளவு|எவ்ளோ|எண்ணிக்கை/iu.test(proposed)?proposed:undefined;
  const question=choiceQuestion??(line.discovery?.matchStatus==='alternatives'?say(state,'These options differ from your request. Choose one only if you want it instead.','இவை நீங்கள் கேட்ட விவரத்திலிருந்து வேறுபடும். மாற்றாக வேண்டுமென்றால் மட்டும் தேர்வு செய்யுங்கள்.','Ivai neenga ketta vivarathilirunthu maarupadum. Maaththa venumna mattum choose pannunga.'):alternative?say(state,`You asked for ${line.packUnitAlternative!.requested.value} ${line.packUnitAlternative!.requested.unit}. This product is in the catalog with a different pack unit. Check the photo and pack label. Would you like this pack?`,`${line.packUnitAlternative!.requested.value} ${unitName(line.packUnitAlternative!.requested.unit,state)} கேட்டீங்க.\nஇந்த பெயர்ல கடைல இருக்குற pack-ஐ காட்டுறேன்.\nPhoto-வும் pack அளவும் பாருங்க. இது வேணுமா?`,`${line.packUnitAlternative!.requested.value} ${line.packUnitAlternative!.requested.unit} ketteenga. Intha peyarla kadaiyila irukkura pack-ai kaatturen. Photo-vum pack size-um paarunga. Ithu venumaa?`):say(state,`Which ${lineName(line,state)} do you need?`,`${lineName(line,state)} — எது வேணும்?`,`${lineName(line,state)} — ethu venum?`));
  return reply('identify',[part(choices,state.draft.length>1?say(state,`Item ${state.draft.indexOf(line)+1}/${state.draft.length} — check one item at a time.\n${question}`,`பொருள் ${state.draft.indexOf(line)+1}/${state.draft.length} — ஒவ்வொன்றாகச் சரிபார்ப்போம்.\n${question}`,`Porul ${state.draft.indexOf(line)+1}/${state.draft.length} — ovvondraaga check pannalaam.\n${question}`):question)],alternative?'pack_unit_alternative':'product_or_specification');
 }
 const cards=draftReviewCards(state).map(card=>{
  // A separate unlisted request must not prevent selecting a known product.
  // Individual selection confirms only this displayed SKU, never the full list.
  if(!confirmShown&&card.kind==='product'&&check.groups.some(group=>group.lineId===card.lineId&&group.products.some(product=>product.sku===card.product.sku))&&!state.draft.find(line=>line.id===card.lineId)?.productConfirmation)return {...card,buttons:[{label:say(state,'This item is right','இந்தப் பொருள் சரி','Intha porul sari'),event:{id:randomUUID(),type:'select_product' as const,batchId:check.id,lineId:card.lineId!,sku:card.product.sku}},...(card.buttons??[])]};
  return card;
 });
 const total=[estimateTotalText(state),estimatePendingSummary(state)].filter(Boolean).join('\n');
 const primary=confirmShown?approve:estimateButton;
 const unclearIdentity=state.draft.find(line=>line.sourceUncertainty?.includes('product_identity'));
 const pendingCatalog=state.draft.find(line=>line.catalogIssue==='catalog_check_pending');
 const title=noListings&&pendingCatalog?say(state,`I kept your list. The catalog check for “${lineName(pendingCatalog,state)}” is still pending.`,`பட்டியல் அப்படியே உள்ளது. “${lineName(pendingCatalog,state)}” இன்னும் சரிபார்க்க வேண்டும்.`,`List appadiye irukku. “${lineName(pendingCatalog,state)}” innum catalog-la check pannanum.`):noListings&&unclearIdentity?say(state,`What do you need “${lineName(unclearIdentity,state)}” for?`,`“${lineName(unclearIdentity,state)}” எதற்குத் தேவை?`,`“${lineName(unclearIdentity,state)}” ethukku venum?`):noListings?say(state,'No matching catalog listing. The shop can check.','பட்டியலில் பொருத்தம் இல்லை. கடை சரிபார்க்கும்.','Catalog-la match illa. Kadai check pannum.'):cartReviewTitle(state);
 const nextStep=confirmShown
  ?needsCount?say(state,'If the photos are right, tap Items correct.','படங்கள் சரி என்றால் பொருட்கள் சரி என்பதைத் தட்டுங்க.','Photos sari-na Items correct-ai thattunga.')
   :say(state,'If the photos are right, tap Show bill.','படங்கள் சரி என்றால் பில் காட்டு என்பதைத் தட்டுங்க.','Photos sari-na Bill kaattu-ai thattunga.')
  :say(state,'Tap Show bill to see prices and items still to check.','விலையையும் சரிபார்க்க வேண்டிய பொருட்களையும் பார்க்க பில் காட்டு என்பதைத் தட்டுங்க.','Vilaiyum check panna vendiya porutkalaiyum paakka Bill kaattu-ai thattunga.');
 const summary=():VisualCard=>({
  kind:'instruction',reviewGuide:true,title:say(state,'Your list','உங்கள் பட்டியல்','Unga list'),
  reference:String(state.draft.length),lines:[total],caption:say(state,'Swipe to check the items.','பொருட்களை நகர்த்திப் பாருங்க.','Porutkalai nagarththi paarunga.'),buttons:[edit],
 });
 const billGuide=():VisualCard=>instruction(primary.label,[total],nextStep,[primary]);
 const focused=compact?cards.filter(c=>c.kind==='product'&&state.draft.some(l=>l.id===c.lineId&&l.requestedAmount&&['needs_unit','unavailable'].includes(l.resolution))):[];
 if(compact&&!focused.length){
  const controls=[primary,edit,action(state,'view_products',say(state,'Show products','பொருட்களைப் பார்','Porutkal paaru'))];
  const guide=summary();
  return reply(missing.length?'shop_check':'products',[part([{...guide,caption:nextStep,buttons:controls}],[title,editHint(state),nextStep].join('\n'))]);
 }

 const reviewCards=compact?focused:cards;
 const groups:VisualCard[][]=[];
 if(reviewCards.length===1){
  const [card]=reviewCards;
  groups.push([{...card,buttons:[primary,...(card.buttons??[]).slice(0,2)]}]);
 }else if(reviewCards.length<10){
  groups.push([billGuide(),...reviewCards]);
 }else{
  // Reserve space at the front of the final carousel for the next action.
  // Keep the opening guide where it fits without creating a third message.
  const pageCount=Math.ceil((reviewCards.length+1)/10);
  const items=reviewCards.length+2<=pageCount*10?[summary(),...reviewCards]:reviewCards;
  const finalStart=Math.min(items.length-1,(pageCount-1)*10);
  for(let offset=0;offset<finalStart;offset+=10)groups.push(items.slice(offset,Math.min(offset+10,finalStart)));
  groups.push([billGuide(),...items.slice(finalStart)]);
 }

 const question=catalogQuestion(clarifyQuestion,state,check.groups.flatMap(g=>g.products));
 const missingCount=noListings&&state.draft.length===1&&state.draft[0].quantity===null&&state.draft[0].discovery?.matchStatus!=='needs_detail';
 const countAction=missingCount?say(state,'How many do you need? Reply with a number.','எத்தனை வேணும்? எண்ணிக்கையை reply பண்ணுங்க.','Eththanai venum? Count-ai reply pannunga.'):undefined;
 const parts=groups.map((group,index)=>{
  const final=index===groups.length-1;
  // A carousel needs equal button counts. Use a bill preview only on rows
  // that need a second action to sit beside an individual approval button.
  if(group.length>1&&group.some(card=>card.buttons?.length===2)){
   for(const card of group){
    if(card.buttons?.length===1)card.buttons=[...card.buttons,card.buttons[0]===primary?edit:estimateButton];
   }
  }
  const text=index===0
   ?[title,editHint(state),question??countAction,final?nextStep:undefined].filter(Boolean).join('\n')
   :final?nextStep:say(state,'Swipe to check the next items.','அடுத்த பொருட்களை நகர்த்திப் பாருங்க.','Adutha porutkalai nagarththi paarunga.');
  return part(group,text);
 });
 return reply(missing.length?'shop_check':'products',parts,missing.length?missing.find(l=>l.catalogIssue)?.catalogIssue??'catalog_missing':undefined);
}
export function visualBill(state:ConversationState):RichReply {
 const lines=state.draft,estimate=estimateLines(lines),display=indicativeEstimate(lines);
 const buttons:Button[]=state.pending?.kind==='review'?[{label:say(state,'Send to store','கடைக்கு அனுப்பு','Kadaikku anuppu'),event:{id:randomUUID(),type:'confirm',reviewId:state.pending.id}},change(state)]:[];
 const cards:Exclude<VisualCard,{kind:'product'}>[]=[],pages=Math.ceil(lines.length/INVOICE_ROWS_PER_PAGE);
 for(let offset=0;offset<lines.length;offset+=INVOICE_ROWS_PER_PAGE){
  const page=offset/INVOICE_ROWS_PER_PAGE+1,final=page===pages;
  const rows=lines.slice(offset,offset+INVOICE_ROWS_PER_PAGE).map(line=>{
   const product=line.candidates?.find(p=>p.sku===line.sku),pack=line.packSize??(product?catalogPack(product):undefined),priced=estimate.priced.includes(line),indicative=indicativeLineEstimate(line);
   const reason=estimatePendingReason(line);
   const pendingTotal=reason==='quantity'?say(state,'Count needed','எண்ணிக்கை தேவை','Count venum'):reason==='product'?say(state,'Product to check','பொருள் சரிபார்க்கணும்','Porul check pannanum'):reason==='unit'?say(state,'Unit to check','அளவு சரிபார்க்கணும்','Unit check pannanum'):reason==='price'?say(state,'Price pending','விலை இன்னும் வரல','Vilai innum varala'):say(state,'Details to check','விவரம் சரிபார்க்கணும்','Details check pannanum');
   return {name:lineName(line,state),packSize:measurementText(pack?`${pack.value} ${pack.unit}`:product?.specifications?.size??'',state)+(line.requestedAmount?` · ${requestedAmountText(line,state)}`:''),count:line.quantity===null?line.requestedQuantity!==undefined?`${line.requestedQuantity} ${unitName(line.requestedUnit??'unit',state,line.requestedQuantity)}`:'—':`${line.quantity} ${unitName(line.requestedUnit??line.unit??'unit',state,line.quantity)}`,unitPrice:priced?formatMoney(line.pricePaise!):indicative?'~'+formatMoney(indicative.pricePaise):'—',total:priced?formatMoney(lineTotal(line.pricePaise!,line.quantity!)):indicative?'~'+formatMoney(indicative.totalPaise):pendingTotal};
  });
  const total=estimateTotalText(state,lines),pending=estimatePendingSummary(state,lines);
  cards.push({kind:'bill',title:say(state,'Estimated invoice','Estimate Bill','Estimate Bill'),reference:state.pending?.kind==='review'?'Estimate #'+state.pending.id.slice(0,8).toUpperCase():undefined,lines:[...(pages>1?[say(state,`Page ${page} / ${pages}`,`பக்கம் ${page} / ${pages}`,`Page ${page} / ${pages}`)]:[]),pending??say(state,'Final availability is checked by the shop','கடை stock-ஐ check பண்ணி confirm பண்ணும்','Kadai stock-ai check panni confirm pannum')],...(display.indicative.length?{footer:say(state,'Indicative prices (~) · the shop confirms the final bill.','~ உத்தேச விலை · இறுதி விலையை கடை உறுதி செய்யும்.','~ Uththesa vilai · final vilaiyai kadai confirm pannum.')} :{}),billRows:rows,total:final?total:undefined,caption:pages>1?say(state,`Estimate · ${page}/${pages}`,`உத்தேச பில் · ${page}/${pages}`,`Uththesa bill · ${page}/${pages}`):total,buttons:final?buttons:[change(state)]});
 }
 const text=estimateText(state,lines,false,buttons.length>0);
 // Each page is one native image. Consent travels with the final invoice page;
 // earlier pages must be delivered before its buttons become available.
 const pending=estimatePendingSummary(state,lines);
 const parts=cards.map((card,index)=>{
  const caption=index===cards.length-1
   ?[pages>1?card.caption:undefined,estimate.priced.length||display.indicative.length||!pending?card.total:undefined,pending,buttons.length?editHint(state):undefined].filter(Boolean).join('\n')
   :card.caption;
  return part([{...card,caption}],caption);
 });
 return {...reply('bill',parts),text,accessibleText:text};
}
function blockedCheckout(state:ConversationState,line:ConversationState['draft'][number]){
 const name=fitText(lineName(line,state),65);
 return {
  text:say(state,`Before sending, the shop needs to check “${name}”. Edit the item or ask the shop to check your list.`,`அனுப்பும் முன் “${name}” கடை சரிபார்க்க வேண்டும். பொருளை மாற்றுங்கள் அல்லது கடையிடம் கேளுங்கள்.`,`Anuppum mun “${name}” kadai check pannanum. Porulai maathunga illa kadaiyila kelunga.`),
  buttons:[
   {label:say(state,'Edit this item','பொருளை மாற்று','Porulai maathu'),event:{id:randomUUID(),type:'edit_item' as const,lineId:line.id,expectedVersion:state.version}},
   shop(state),
  ],
 };
}

export function visualCheckoutBlocker(state:ConversationState):RichReply|undefined {
 if(!state.visualOrdering||state.lastRequestId||state.pending?.kind==='review')return;
 const next=checkoutNextStep(state);
 if(next.kind!=='shop_check')return;
 const {text,buttons}=blockedCheckout(state,next.line);
 return {...textPresentation(text,buttons,'shop_check'),clarificationReason:'checkout_shop_check',readOnly:true};
}

export function visualEstimate(state:ConversationState,lines:ConversationState['draft']):RichReply {
 const invoice=visualBill({...state,draft:lines,pending:null}),next=checkoutNextStep({...state,draft:lines});
 const blocked=next.kind==='shop_check'?blockedCheckout(state,next.line):undefined;
 const buttons:Button[]=blocked?.buttons??[{
  label:next.kind==='check_products'?say(state,'Check products','பொருட்களைச் சரிபார்','Porutkalai check pannu'):next.kind==='partial_review'?say(state,'Review with shop check','கடை சரிபார்க்கும் பில்','Kadai check bill'):say(state,'Continue checkout','Order தொடரலாம்','Order thodaralaam'),
  event:next.kind==='partial_review'?{id:randomUUID(),type:'review_partial',expectedVersion:state.version}:{id:randomUUID(),type:'review',expectedVersion:state.version},
 }];
 if(!blocked)buttons.push(change(state));
 const nextItem=next.kind==='check_products'?fitText(lineName(next.line,state),65):undefined;
 const guide=blocked?.text??(nextItem?say(state,`Check “${nextItem}” next.`,`அடுத்து “${nextItem}” சரிபார்க்கவும்.`,`Aduthu “${nextItem}” check pannunga.`):undefined);
 const parts=invoice.parts!.map((p,index)=>index===invoice.parts!.length-1?{...p,text:guide?`${p.text}\n${guide}`:p.text,cards:p.cards.map(c=>({...c,buttons}))}:{...p,cards:p.cards.map(c=>({...c,buttons:[change(state)]}))});
 const text=estimateText(state,lines,false,false)+(guide?'\n\n'+guide:'');
 return {...invoice,readOnly:true,text,accessibleText:text,parts,buttons};
}

export function visualReply(base:RichReply,state:ConversationState,request?:OrderRequest|null):RichReply {
 const plan=planReply(base,state,request);
 if(!state.visualOrdering||plan.purpose==='read_only')return base;
 if(base.clarificationReason==='purchase_total')return nativeReply(base,state);
 if(base.clarificationReason==='catalog_group'&&base.parts?.length)return base;
 if(plan.purpose==='error'){
  if(base.clarificationReason?.startsWith('interpretation_')&&state.draft.length&&!state.lastRequestId){
   const question=say(state,'I kept your list. Choose the item to correct.','பட்டியல் அப்படியே இருக்கு. மாற்ற வேண்டிய பொருளைத் தேர்வு செய்யுங்க.','List appadiye irukku. Maatha vendiya porulai choose pannunga.');
   const picker=visualEditPicker(state);return {...picker,stage:'error',text:question,parts:picker.parts?.map(part=>({...part,text:question})),clarificationReason:base.clarificationReason,replyLanguage:state.replyLanguage};
  }
  return nativeReply(base,state);
 }
 if(['cart_edit_target','intent_clarification','keep_only_target'].includes(base.clarificationReason??''))return visualTargetQuestion(base,state);
 if(base.handoffRequested)return nativeReply({...base,stage:'status',handoffRequested:true},state);
 if(request){return {...(base.stage==='submitted'?visualSubmitted(state,request):visualStatus(state,request)),replyLanguage:state.replyLanguage};}
 if(base.stage==='returning')return base;
 if(base.buttons?.length&&base.buttons.every(b=>b.event.type==='browse')){
  const categories=base.buttons;
  const cards=categories.map(b=>instruction(b.label,[],b.label,[{...b,label:say(state,'Open category','வகையைப் பார்','Vagai paaru')}]));
  const parts:ReplyPart[]=[];for(let offset=0;offset<cards.length;offset+=10)parts.push(part(cards.slice(offset,offset+10),say(state,'Swipe and choose a category','பக்கமாக நகர்த்தி வகையைத் தேர்வு செய்யுங்க','Pakkamaaga nagarththi vagai choose pannunga')));
  return {...reply('identify',parts),replyLanguage:state.replyLanguage};
 }

 if(base.buttons?.length&&base.buttons.every(b=>b.event.type==='edit_item'))return visualEditPicker(state);
 const activeLine=nextCounterLine(state);
 const stalled=activeLine&&(activeLine.clarification?.unproductiveTurns??0)>=2&&!activeLine.sku&&!activeLine.shopCheckDeferred&&!activeLine.candidates?.length?activeLine:undefined;
 if(stalled&&state.pending&&state.pending.kind!=='review'&&!base.readOnly&&base.stage!=='error'&&base.stage!=='status'&&base.clarificationReason!=='intent_clarification'&&!(base.stage==='identify'&&base.cards?.length))return nativeReply({...base,text:say(state,'I’ve kept your request. You can send it to the shop to check, or add a new detail.','உங்கள் கோரிக்கையை வைத்துள்ளேன். சரிபார்க்க கடைக்கு அனுப்பலாம் அல்லது புதிய விவரம் சொல்லலாம்.','Unga request-ai vechchirukken. Check panna kadaikku anuppalaam illa puthu vivaram sollalaam.'),stage:'identify',clarificationReason:'stalled_request',buttons:[state.allowPartialReview?{label:say(state,'Send request to shop','கடைக்கு கோரிக்கை அனுப்பு','Kadaikku request anuppu'),event:{id:randomUUID(),type:'review_partial',expectedVersion:state.version}}:shop(state),change(state)]},state);
 if(state.pending?.kind==='products'&&!(base.stage==='identify'&&base.cards?.length))return withContext({...visualProductReview(state,!!base.compactReview,base.text),replyLanguage:state.replyLanguage},base.contextLines);
 if(state.pending?.kind==='review'&&!(base.stage==='identify'&&base.cards?.length)){
  if(!plan.mayOfferSubmission)return nativeReply({...base,text:say(state,'The list needs a fresh check before submission. Review the product, amount and shop price.','அனுப்பும் முன் பட்டியலை மீண்டும் சரிபார்க்க வேண்டும். பொருள், எண்ணிக்கை, கடை விலையைச் சரிபாருங்கள்.','Anuppum mun list-ai marubadi check pannanum. Porul, count, kadai vilai check pannunga.'),kind:'text',stage:'identify',buttons:(base.buttons??[]).filter(b=>b.event.type!=='confirm')},state);
  const bill=visualBill(state);return withContext({...bill,replyLanguage:state.replyLanguage},base.contextLines);
 }
 if(state.editingLineId){
  const selected=state.draft.find(l=>l.id===state.editingLineId),product=selected?.candidates?.find(p=>p.sku===selected.sku);
  const remove:Button|undefined=selected?{label:say(state,'Remove this','இதை நீக்கு','Ithai neekku'),event:{id:randomUUID(),type:'set_quantity',lineId:selected.id,quantity:0,expectedVersion:state.version}}:undefined;
  if(selected&&!product){const question=say(state,'What should change? Say the correction or “remove it”.','என்ன மாற்றணும்? சரியான விவரம் அல்லது “இதை நீக்கு” சொல்லுங்க.','Enna maathanum? Sariyana vivaram illa “ithai neekku” sollunga.');return {...reply('correction',[part([instruction(lineName(selected,state),[say(state,'Request awaiting shop checking','கடை சரிபார்க்க வேண்டிய கோரிக்கை','Kadai check panna vendiya request')],lineName(selected,state),remove?[remove]:[])],question)],'selected_item_change'),replyLanguage:state.replyLanguage};}
  if(product){const question=say(state,'What should change: product, size or count?','பொருள், அளவு, எண்ணிக்கை — என்ன மாற்றணும்?','Porul, size, count — enna maathanum?');return {...reply('correction',[part([{kind:'product',lineId:selected!.id,product,caption:productCaption(product,state,[product.specifications?.size,question]),buttons:[...(base.buttons??[]).slice(0,2),...(remove?[remove]:[])]}],question)],'selected_item_change'),replyLanguage:state.replyLanguage};}
 }
 const questionId=state.pending?.kind==='question'?state.pending.lineId:undefined;
 const line=plan.purpose==='clarification'?plan.line:state.draft.find(l=>l.id===questionId);
 if(line?.discovery&&state.pending){const grouped=catalogGroupReply(line.discovery,state,{lineId:line.id,batchId:state.pending.id});if(grouped)return grouped;}
 if(line&&!(base.stage==='identify'&&base.cards?.length)&&(line.resolution==='needs_quantity'||line.resolution==='needs_unit')){
  const product=line.candidates?.find(p=>p.sku===line.sku);
  const size=line.packSize??(product?catalogPack(product):undefined);
  const prompt=line.catalogIssue?draftIssueText(line,state)!:say(state,`How many ${line.unit??'packs'} of ${lineName(line,state)}?`,`${lineName(line,state)} — எத்தனை ${unitName(line.unit??'unit',state)} வேணும்?`,`${lineName(line,state)} — eththanai ${line.unit??'packs'} venum?`);
  const details=size?`${size.value} ${size.unit}`:'';
  if(!product)return nativeReply({...base,text:prompt,stage:'quantity',clarificationReason:line.requestedAmount?'requested_amount_conversion':'purchase_count'},state);
  const needsCount=line.resolution==='needs_quantity'&&line.quantity===null&&line.requestedQuantity===undefined&&!line.requestedAmount||line.resolution==='needs_unit'&&!line.requestedAmount&&!!product.sellingUnitVerified&&state.pending?.kind==='question'&&state.pending.lineId===line.id;
  if(!needsCount){
   const card:VisualCard={kind:'product',lineId:line.id,product,caption:productCaption(product,state,[measurementText(details,state),requestedAmountText(line,state),productPriceText(product,state),productStockText(product,state),prompt]),buttons:base.buttons?.slice(0,3)};
   return withContext({...reply('quantity',[part([card],prompt,base.buttons?.slice(0,3))],line.requestedAmount?'requested_amount_conversion':'purchase_count'),replyLanguage:state.replyLanguage},base.contextLines);
  }
  const step=product.quantityStep||1;
  const quantityButtons:Button[]=needsCount?[1,2,3].map(n=>Math.round(n*step*1000)/1000).filter(n=>n>0&&n<=100).map(quantity=>({label:`${quantity} ${unitName(product.unit,state,quantity)}`,event:{id:randomUUID(),type:'set_quantity',lineId:line.id,quantity,expectedVersion:state.version}})):base.buttons?.slice(0,3)??[];
  const requested=line.resolution==='needs_unit'&&line.requestedQuantity!==undefined&&line.requestedUnit?say(state,`You asked for ${line.requestedQuantity} ${unitName(line.requestedUnit,state,line.requestedQuantity)}. `,`நீங்க ${line.requestedQuantity} ${unitName(line.requestedUnit,state,line.requestedQuantity)} கேட்டீங்க. `,`Neenga ${line.requestedQuantity} ${unitName(line.requestedUnit,state,line.requestedQuantity)} ketteenga. `):'';
  const pack=details?`${measurementText(details,state)} ${unitName(product.unit,state)} — `:'';
  const question=requested+pack+say(state,`How many ${unitName(product.unit,state)}? Tap a number or reply with the count.`,`எத்தனை ${unitName(product.unit,state)} வேணும்? எண்ணைத் தேர்வு செய்யுங்க அல்லது எண்ணிக்கையை reply பண்ணுங்க.`,`Eththanai ${unitName(product.unit,state)} venum? Number-ai choose pannunga illa count reply pannunga.`);
  const card:VisualCard={kind:'product',lineId:line.id,product,caption:productCaption(product,state,[question,measurementText(details,state)]),buttons:quantityButtons};
  return withContext({...reply('quantity',[part([card],question)],'purchase_count'),replyLanguage:state.replyLanguage},base.contextLines);
 }
 if(base.cards?.length){
  const cards:VisualCard[]=base.cards.slice(0,10).map(c=>({kind:'product',product:c.product,caption:productCaption(c.product,state,[c.product.brand,measurementText(c.product.specifications?.size??'',state),productPriceText(c.product,state),productStockText(c.product,state),c.matchLabel,c.quantityLabel]),buttons:[...(c.action?[{label:c.label,event:c.action}]:[]),...(base.buttons??[]).filter(b=>!(b.event.type==='shopping_action'&&b.event.action==='handoff'))].slice(0,2)}));
  return withContext({...reply('identify',[part(cards,base.text)],'product_or_specification'),replyLanguage:state.replyLanguage},base.contextLines);
 }
 const welcomeTurn=!state.draft.length&&!state.lastRequestId&&(!base.text||/^(?:Hi[!, ]|Hello[!, ]|வணக்கம்|Vanakkam)/i.test(base.text));
 const stage=state.editingLineId?'correction':welcomeTurn?'welcome':base.stage??'status';
 const welcomeButtons:Button[]=[{label:'தமிழ்',event:{id:randomUUID(),type:'change_language',language:'ta'}},{label:'Tanglish',event:{id:randomUUID(),type:'change_language',language:'ta-Latn'}},action(state,'browse',say(state,'Browse catalog','கடை வகைகள் பார்','Kadai vagaigal paaru'))];
 const message=stage==='welcome'?customerCopy('welcome',state):base.text;
 return nativeReply({...base,text:message,stage,buttons:stage==='welcome'?welcomeButtons:base.buttons?.slice(0,3)},state);
}
function visualTargetQuestion(base:RichReply,state:ConversationState):RichReply {
 const cards:VisualCard[]=[];
 for(const button of base.buttons??[]){
  const event=button.event;
  if(!('lineId' in event)||typeof event.lineId!=='string')continue;
  const line=state.draft.find(line=>line.id===event.lineId);if(!line)continue;
  const product=line.candidates?.find(product=>product.sku===line.sku);
  const number=state.draft.indexOf(line)+1;
  const label=say(state,`Item ${number}`,`பொருள் ${number}`,`Porul ${number}`);
  const choice={...button,label};
  const buttons=[choice,...(base.buttons??[]).filter(button=>button.event.type==='resolve_cart_group')].slice(0,2);
  cards.push(product?{kind:'product',lineId:line.id,product,caption:productCaption(product,state,[line.quantity===null?undefined:`${line.quantity} ${unitName(line.unit??'unit',state,line.quantity)}`]),buttons}:instruction(lineName(line,state),[say(state,'Request awaiting shop checking','கடை சரிபார்க்க வேண்டிய கோரிக்கை','Kadai check panna vendiya request')],lineName(line,state),buttons));
 }
 if(!cards.length)return nativeReply(base,state);
 const counts=(base.buttons??[]).flatMap(button=>button.event.type==='set_quantity'?[button.event.quantity]:[]);
 const count=counts.length&&new Set(counts).size===1?counts[0]:undefined;
 const question=base.text|| (count!==undefined?say(state,`Which item should have count ${count}?`,`எந்தப் பொருளுக்கு எண்ணிக்கை ${count} வேணும்?`,`Entha porulukku count ${count} venum?`):say(state,'Which item did you mean?','எந்தப் பொருளைச் சொன்னீங்க?','Entha porulai sonneenga?'));
 const parts:ReplyPart[]=[];for(let offset=0;offset<cards.length;offset+=10)parts.push(part(cards.slice(offset,offset+10),question));
 return {...reply('identify',parts,base.clarificationReason),buttons:base.buttons,replyLanguage:state.replyLanguage};
}
function nativeReply(base:RichReply,state:ConversationState):RichReply {
 const text=[...base.contextLines??[],base.text].filter(Boolean).join('\n');
 if(base.stage==='identify'&&state.draft.length&&!base.readOnly){
  const line=nextCounterLine(state)??state.draft[0],card=instruction(lineName(line,state),[text],text,base.buttons?.slice(0,3));
  return {...reply('identify',[part([card],text)],base.clarificationReason),buttons:base.buttons,replyLanguage:state.replyLanguage};
 }
 return {...base,text,parts:undefined,cards:undefined,presentation:base.buttons?.length?'list':'text',outboundMessages:1,replyLanguage:state.replyLanguage};
}
function withContext(result:RichReply,lines:string[]|undefined):RichReply {
 if(!lines?.length||!result.parts?.length)return result;
 const target=result.parts.at(-1)!.cards.length?result.parts[0]:result.parts.at(-1)!;
 const text=[...lines.map(l=>fitText(l,240)),target.text].join('\n\n');
 if(!target.cards.length){const pages=textPresentation(text,target.buttons??[],result.stage);result.parts.splice(result.parts.indexOf(target),1,...pages.parts!);result.outboundMessages=result.parts.length;}
 else target.text=text;
 result.text=result.parts.map(p=>p.text).join('\n\n');return result;
}
export function returningReply(state:ConversationState):RichReply {
 const count=state.draft.length;
 const message=say(state,`You have ${count} ${count===1?'item':'items'} in your saved list.`,`சேமித்த பட்டியலில் ${count} ${count===1?'பொருள்':'பொருட்கள்'} இருக்கு.`,`Unga saved list-la ${count} ${count===1?'porul':'porutkal'} irukku.`);
 return {...reply('returning',[part([],message,[action(state,'continue_list',say(state,'Continue list','List தொடரு','List thodaru')),action(state,'new_list',say(state,'New list','புது list','Pudhu list'))])]),replyLanguage:state.replyLanguage};
}

function visualSubmitted(state:ConversationState,request:OrderRequest):RichReply {
 const reference=orderReference(request.id);
 const text=say(state,
  `Sent to the shop · ${reference}\nThe shop will confirm your order.`,
  `கடைக்கு அனுப்பியாச்சு · ${reference}\nகடை ஆர்டரை உறுதி செய்யும்.`,
  `Kadaikku anuppiyaachu · ${reference}\nKadai order-ai confirm pannum.`);
 const status:Button={label:say(state,'Order status','ஆர்டர் நிலை','Order status'),event:{id:randomUUID(),type:'shopping_action',action:'status',expectedVersion:state.version}};
 return reply('submitted',[part([],text,[status])]);
}

export function visualStatus(state:ConversationState,request:OrderRequest):RichReply {
 const text=requestStatusText(request,state.replyLanguage);
 const buttons:Button[]=request.acceptance!=='rejected'&&!['collected','cancelled'].includes(request.fulfillment)&&request.advanceRequired&&['requested','claimed'].includes(request.advanceState??'')?[{label:say(state,'Show ₹10 QR','₹10 QR காட்டு','₹10 QR kaattu'),event:{id:randomUUID(),type:'show_payment_qr',requestId:request.id,expectedVersion:state.version}}]:[];
 return {...reply('status',[part([],text,buttons)]),replyLanguage:state.replyLanguage};
}

function visualEditPicker(state:ConversationState):RichReply {
 const keep:Button={label:say(state,'Keep list','மாற்ற வேண்டாம்','Maatha venaam'),event:{id:randomUUID(),type:'shopping_action',action:'keep_list',expectedVersion:state.version}};
 const cards:VisualCard[]=state.draft.map((line,index)=>{const button:Button={label:say(state,'Change this','இதை மாற்று','Ithai maathu'),event:{id:randomUUID(),type:'edit_item',lineId:line.id,expectedVersion:state.version}},product=line.candidates?.find(p=>p.sku===line.sku);const caption=`${index+1}. ${lineName(line,state)}`;return product?{kind:'product',lineId:line.id,product,caption,buttons:[button]}:instruction(caption,[say(state,'Shop needs to check','கடை சரிபார்க்க வேண்டும்','Kadai check pannanum')],caption,[button]);});
 const parts:ReplyPart[]=[];for(let offset=0;offset<cards.length;offset+=9)parts.push(part([...cards.slice(offset,offset+9),instruction(say(state,'Which item needs changing?','எந்தப் பொருளை மாற்றணும்?','Entha porulai maathanum?'),[say(state,'Tap that item or say its name in text / voice','படத்தில் தேர்வு செய்யுங்க. அல்லது பெயரை text / voice-ல சொல்லுங்க.','Photo-la choose pannunga illa peyarai text / voice-la sollunga.')],say(state,'Choose the item to change','மாற்ற வேண்டிய பொருளைத் தேர்வு செய்','Maatha vendiya porulai choose pannu'),[keep])],say(state,'Choose the item to change','மாற்ற வேண்டிய பொருளைத் தேர்வு செய்','Maatha vendiya porulai choose pannu')));
 return reply('correction',parts,'correction_target');
}

function productCaption(product:Product,state:ConversationState,details:(string|undefined)[],index?:number):string {
 return buildProductCaption(product,state,details,index);
}
