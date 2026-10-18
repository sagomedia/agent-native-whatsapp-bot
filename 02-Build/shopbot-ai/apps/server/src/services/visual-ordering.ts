import {buildProductCaption} from '../../../../packages/contracts/channel-text.js';
import type {Product} from '../../../../packages/contracts/index.js';
import {customerCopy} from '../../../../packages/contracts/customer-copy.js';
import {estimateLines,estimateText,estimatePendingSummary,estimateTotalText,indicativeLineEstimate,indicativeEstimate} from './order-estimate.js';
import {textPresentation} from './message-presentation.js';
import {randomUUID,createHash} from 'node:crypto';
import type {ConversationState,RichReply,ReplyPart,VisualCard,ProductCheck,OrderRequest} from '../../../../packages/contracts/index.js';
import {say,lineName,unitName,productName,safeQuestion,localName,draftIssueText,requestedAmountText,measurementText,productPriceText,productStockText,referencePhotoLabel} from '../../../../packages/contracts/language.js';
import {formatMoney,lineTotal} from '../../../../packages/contracts/money.js';
import {productIdentity} from './product-confirmation.js';
import {counterLine,productCheckCoversDraft} from './counter-state.js';
import {fitText} from './whatsapp-reply.js';
import {requestStatusText} from './request-status.js';
import {catalogPack,catalogContent} from './quantity-evidence.js';
import {INVOICE_ROWS_PER_PAGE} from './visual-images.js';
import {needsPipeType} from './catalog-discovery.js';
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
export function visualProductReview(state:ConversationState,compact=false):RichReply {
 const check=state.pending as ProductCheck;
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
  const buttons=cards.map((card,index)=>{
   const alternative=intent.alternatives![index],family=meaning.discovery?.facets.find(f=>f.key==='family')?.values.find(v=>v.value===alternative.familyId);
   return {...card.buttons![0],label:family?localName(family.label,family.localNames,state):alternative.query};
  });
  return reply('identify',[part([],question,buttons)],'product_meaning');
 }
 const ambiguous=check.groups.find(g=>g.products.length>1||!state.draft.find(l=>l.id===g.lineId)?.sku),missing=state.draft.filter(l=>!l.sku&&!l.candidates?.length||l.resolution==='unavailable');
 const identified=productCheckCoversDraft(state,check);
 const confirmShown=identified||!!state.allowPartialReview&&check.groups.length>0&&check.groups.every(g=>g.products.length===1&&state.draft.find(l=>l.id===g.lineId)?.sku===g.products[0].sku);
 const approve:Button={label:say(state,'Correct, show bill','சரி, Bill காட்டு','Sari, bill kaattu'),event:{id:randomUUID(),type:'confirm_products',batchId:check.id}};
 const edit=change(state);
 if(ambiguous){
  const line=state.draft.find(l=>l.id===ambiguous.lineId)!;
  const alternative=line.packUnitAlternative&&!line.packUnitAlternative.acceptedSku;
  const choices:VisualCard[]=ambiguous.products.slice(0,3).map(product=>({kind:'product',lineId:line.id,product,caption:productCaption(product,state,[product.brand,measurementText(product.specifications?.size??product.specifications?.weight??'',state),productPriceText(product,state),productStockText(product,state)]),buttons:[{label:alternative?say(state,'Use this pack','இந்த pack வேணும்','Intha pack venum'):say(state,'Choose this','இது வேணும்','Ithu venum'),event:{id:randomUUID(),type:'select_product',batchId:check.id,lineId:line.id,sku:product.sku}}]}));
  const question=alternative?say(state,`You asked for ${line.packUnitAlternative!.requested.value} ${line.packUnitAlternative!.requested.unit}. This product is in the catalog with a different pack unit. Check the photo and pack label. Would you like this pack?`,`${line.packUnitAlternative!.requested.value} ${unitName(line.packUnitAlternative!.requested.unit,state)} கேட்டீங்க.\nஇந்த பெயர்ல கடைல இருக்குற pack-ஐ காட்டுறேன்.\nPhoto-வும் pack அளவும் பாருங்க. இது வேணுமா?`,`${line.packUnitAlternative!.requested.value} ${line.packUnitAlternative!.requested.unit} ketteenga. Intha peyarla kadaiyila irukkura pack-ai kaatturen. Photo-vum pack size-um paarunga. Ithu venumaa?`):say(state,`Which ${lineName(line,state)} do you need?`,`${lineName(line,state)} — எது வேணும்?`,`${lineName(line,state)} — ethu venum?`);
  return reply('identify',[part(choices,question)],alternative?'pack_unit_alternative':'product_or_specification');
 }
 const cards:VisualCard[]=state.draft.flatMap((line,index)=>{
  const edit:Button={label:say(state,'Change this','இதை மாற்று','Ithai maathu'),event:{id:randomUUID(),type:'edit_item',lineId:line.id,expectedVersion:state.version}};
  const product=line.candidates?.find(p=>p.sku===line.sku);
  if(!product)return [instruction(lineName(line,state),[say(state,'Shop check · price pending','கடை check பண்ணணும் · விலை இன்னும் வரல','Kadai check pannanum · vilai innum varala'),line.quantity===null?say(state,'Count to check','Count check பண்ணணும்','Count check pannanum'):`${line.quantity} ${unitName(line.unit??line.requestedUnit??'unit',state,line.quantity)}`],lineName(line,state),[edit])];
  const pack=line.packSize??catalogPack(product),size=pack?`${pack.value} ${pack.unit}`:product.specifications?.size;
  const content=catalogContent(product),amount=line.requestedAmount;
  const count=line.quantity===null?line.requestedQuantity!==undefined?`${line.requestedQuantity} ${unitName(line.requestedUnit??'unit',state,line.requestedQuantity)}`:amount?requestedAmountText(line,state):say(state,'Count: to check','எண்ணிக்கை: சொல்ல வேண்டும்','Count: sollanum'):`${line.quantity} ${unitName(product.unit,state,line.quantity)}`;
  const conversion=amount&&content&&line.quantity!==null&&!['metre','foot','litre','kg'].includes(product.unit)?`${content.value} ${content.unit} × ${line.quantity} = ${amount.value} ${amount.unit}`:undefined;
  return [{kind:'product',lineId:line.id,product,caption:productCaption(product,state,[count,measurementText(size??'',state),budgetText(line,state),conversion?measurementText(conversion,state):undefined],index+1),buttons:[edit]}];
 });
 const estimate=estimateLines(state.draft);
 const total=[estimateTotalText(state),estimatePendingSummary(state)].filter(Boolean).join('\n');
 const estimateButton:Button={label:say(state,'Show estimate','Bill காட்டு','Bill kaattu'),event:{id:randomUUID(),type:'review_partial',expectedVersion:state.version}};
 const primary=confirmShown?approve:state.allowPartialReview?estimateButton:undefined;
 const title=say(state,`${state.draft.length} items`,`${state.draft.length} items`,`${state.draft.length} items`);
 const focused=compact?cards.filter(c=>c.kind==='product'&&state.draft.some(l=>l.id===c.lineId&&l.requestedAmount&&['needs_unit','unavailable'].includes(l.resolution))):[];
 if(compact&&!focused.length){
  const controls=[...(primary?[primary]:[]),change(state),action(state,'view_products',say(state,'See photos','Photo காட்டு','Photo kaattu'))];
  return textPresentation([title,total].join('\n'),controls,missing.length?'shop_check':'products');
 }
 const guidance=compact?say(state,'Check the requested amount and selling unit.','கேட்ட அளவும் கடை அளவும் சரியா பாருங்க.','Ketta alavum kadai alavum sariyaa paarunga.'):say(state,'Swipe to check → Then tap Show bill.','படங்களை நகர்த்திப் பாருங்க → சரின்னா Bill காட்டு.','Photos-ai nagarththi paarunga → sarinna Bill kaattu.');
 const guide:VisualCard={kind:'instruction',reviewGuide:true,title,lines:[say(state,'Check every item','ஒவ்வொரு item-யும் பாருங்க','Ovvoru item-aiyum paarunga'),total],caption:guidance,buttons:[change(state)]};
 // The first card explains the swipe; the final group owns approval. Every
 // group remains in the same delivery binding, so no unseen page can be approved.
 const reviewCards=compact?focused:[guide,...cards],parts:ReplyPart[]=[];
 for(let offset=0;offset<reviewCards.length;offset+=10){
  const final=offset+10>=reviewCards.length;
  const group=reviewCards.slice(offset,offset+10).map(card=>({...card,buttons:final&&primary?[primary,...(card.buttons??[change(state)]).slice(0,1)]:card.buttons?.slice(0,1)??[change(state)]}));
  parts.push(part(group,offset===0?(compact?guidance:title):say(state,'More items → Check these too.','மீதமுள்ள items-யும் பாருங்க →','Meethamulla items-aiyum paarunga →')));
 }
 return reply(missing.length?'shop_check':'products',parts,missing.length?missing.find(l=>l.catalogIssue)?.catalogIssue??'catalog_missing':undefined);
}
export function visualBill(state:ConversationState,request?:OrderRequest):RichReply {
 const lines=request?.lines??state.draft,estimate=estimateLines(lines),display=indicativeEstimate(lines);
 const buttons:Button[]=request?[]:state.pending?.kind==='review'?[{label:say(state,'Send order to shop','கடைக்கு அனுப்பு','Order kadaikku anuppu'),event:{id:randomUUID(),type:'confirm',reviewId:state.pending.id}},change(state)]:[];
 const cards:Exclude<VisualCard,{kind:'product'}>[]=[],pages=Math.ceil(lines.length/INVOICE_ROWS_PER_PAGE);
 for(let offset=0;offset<lines.length;offset+=INVOICE_ROWS_PER_PAGE){
  const page=offset/INVOICE_ROWS_PER_PAGE+1,final=page===pages;
  const rows=lines.slice(offset,offset+INVOICE_ROWS_PER_PAGE).map(line=>{
   const product=line.candidates?.find(p=>p.sku===line.sku),pack=line.packSize??(product?catalogPack(product):undefined),priced=estimate.priced.includes(line),indicative=indicativeLineEstimate(line);
   return {name:lineName(line,state),packSize:measurementText(pack?`${pack.value} ${pack.unit}`:product?.specifications?.size??'',state)+(line.requestedAmount?` · ${requestedAmountText(line,state)}`:''),count:line.quantity===null?line.requestedQuantity!==undefined?`${line.requestedQuantity} ${unitName(line.requestedUnit??'unit',state,line.requestedQuantity)}`:'—':`${line.quantity} ${unitName(line.requestedUnit??line.unit??'unit',state,line.quantity)}`,unitPrice:priced?formatMoney(line.pricePaise!):indicative?'~'+formatMoney(indicative.pricePaise):'—',total:priced?formatMoney(lineTotal(line.pricePaise!,line.quantity!)):indicative?'~'+formatMoney(indicative.totalPaise):say(state,'Price pending','விலை இன்னும் வரல','Vilai innum varala')};
  });
  const total=estimateTotalText(state,lines),pending=estimatePendingSummary(state,lines);
  cards.push({kind:request?'status':'bill',title:say(state,'Estimated invoice','Estimate Bill','Estimate Bill'),reference:request?orderReference(request.id):state.pending?.kind==='review'?'Estimate #'+state.pending.id.slice(0,8).toUpperCase():undefined,lines:[...(pages>1?[say(state,`Page ${page} / ${pages}`,`பக்கம் ${page} / ${pages}`,`Page ${page} / ${pages}`)]:[]),pending??say(state,'Final availability is checked by the shop','கடை stock-ஐ check பண்ணி confirm பண்ணும்','Kadai stock-ai check panni confirm pannum')],...(display.indicative.length?{footer:say(state,'Indicative prices (~) · the shop confirms the final bill.','~ உத்தேச விலை · இறுதி விலையை கடை உறுதி செய்யும்.','~ Uththesa vilai · final vilaiyai kadai confirm pannum.')} :{}),billRows:rows,total:final?total:undefined,caption:say(state,`Estimated invoice ${page} / ${pages}`,`Estimate Bill ${page} / ${pages}`,`Estimate Bill ${page} / ${pages}`),buttons:request?[{label:say(state,'Order status','Order நிலை','Order status'),event:{id:randomUUID(),type:'shopping_action',action:'status',expectedVersion:state.version}}]:final?buttons:[change(state)]});
 }
 const text=estimateText(state,lines,false,!request);
 // Each page is one native image. Consent travels with the final invoice page;
 // earlier pages must be delivered before its buttons become available.
 const parts=cards.map((card,index)=>part([card],[pages>1?card.caption:undefined,index===cards.length-1?card.total:undefined].filter(Boolean).join('\n')||card.caption));
 return {...reply(request?'submitted':'bill',parts),text,accessibleText:text,kind:request?'text':'order_review'};
}
export function visualEstimate(state:ConversationState,lines:ConversationState['draft']):RichReply {
 const invoice=visualBill({...state,draft:lines,pending:null}),next:Button={label:say(state,'Continue checkout','Order தொடரலாம்','Order thodaralaam'),event:state.allowPartialReview?{id:randomUUID(),type:'review_partial',expectedVersion:state.version}:{id:randomUUID(),type:'review',expectedVersion:state.version}};
 const parts=invoice.parts!.map((p,index)=>({...p,cards:p.cards.map(c=>({...c,buttons:index===invoice.parts!.length-1?[next]:[change(state)]}))}));
 return {...invoice,readOnly:true,text:estimateText(state,lines,false,false),accessibleText:estimateText(state,lines,false,false),parts,buttons:[next]};
}

export function visualReply(base:RichReply,state:ConversationState,request?:OrderRequest|null):RichReply {
 const plan=planReply(base,state,request);
 if(!state.visualOrdering||plan.purpose==='read_only')return base;
 if(plan.purpose==='error'||base.clarificationReason==='intent_clarification'||base.clarificationReason==='keep_only_target')return nativeReply(base,state);
 if(base.handoffRequested)return nativeReply({...base,stage:'status',handoffRequested:true},state);
 if(request){return {...(base.stage==='submitted'?visualBill(state,request):visualStatus(state,request)),replyLanguage:state.replyLanguage};}
 if(base.stage==='returning')return base;
 if(base.buttons?.length&&base.buttons.every(b=>b.event.type==='browse')){
  const categories=base.buttons;
  if(categories.length<=3){const buttons=categories.map((b,i)=>({...b,label:say(state,`Category ${i+1}`,`வகை ${i+1}`,`Vagai ${i+1}`)}));return {...reply('identify',[part([instruction(say(state,'Choose a category','எந்த வகை வேணும்?','Entha vagai venum?'),categories.map((b,i)=>`${i+1}. ${b.label}`),say(state,'Choose below','கீழே தேர்வு செய்யுங்க','Keezhe choose pannunga'),buttons)],say(state,'Choose a category, or send your request by voice.','வகையைத் தேர்வு செய்யுங்க. Voice-லும் சொல்லலாம்.','Vagai choose pannunga illa voice-la sollunga.'))]),replyLanguage:state.replyLanguage};}
  const cards=categories.map(b=>instruction(b.label,[],b.label,[{...b,label:say(state,'Open category','வகையைப் பார்','Vagai paaru')}])) ;return {...reply('identify',[part(cards,say(state,'Swipe and choose a category','பக்கமாக நகர்த்தி வகையைத் தேர்வு செய்யுங்க','Pakkamaaga nagarththi vagai choose pannunga'))]),replyLanguage:state.replyLanguage};
 }

 if(base.buttons?.length&&base.buttons.every(b=>b.event.type==='edit_item'))return visualEditPicker(state);
 if(state.pending?.kind==='products'&&!(base.stage==='identify'&&base.cards?.length))return withContext({...visualProductReview(state,!!base.compactReview),replyLanguage:state.replyLanguage},base.contextLines);
 if(state.pending?.kind==='review'&&!(base.stage==='identify'&&base.cards?.length)){
  if(!plan.mayOfferSubmission)return nativeReply({...base,text:say(state,'The list needs a fresh check before submission. Review the product, amount and shop price.','அனுப்பும் முன் பட்டியலை மீண்டும் சரிபார்க்க வேண்டும். பொருள், எண்ணிக்கை, கடை விலையைச் சரிபாருங்கள்.','Anuppum mun list-ai marubadi check pannanum. Porul, count, kadai vilai check pannunga.'),kind:'text',stage:'identify',buttons:(base.buttons??[]).filter(b=>b.event.type!=='confirm')},state);
  const bill=visualBill(state);return withContext({...bill,replyLanguage:state.replyLanguage},base.contextLines);
 }
 if(state.editingLineId){
  const selected=state.draft.find(l=>l.id===state.editingLineId),product=selected?.candidates?.find(p=>p.sku===selected.sku);
  if(product){const question=say(state,'What should change: product, size or count?','பொருள், அளவு, எண்ணிக்கை — என்ன மாற்றணும்?','Porul, size, count — enna maathanum?');return {...reply('correction',[part([{kind:'product',lineId:selected!.id,product,caption:productCaption(product,state,[product.specifications?.size,question]),buttons:base.buttons?.slice(0,3)}],question)],'selected_item_change'),replyLanguage:state.replyLanguage};}
 }
 const questionId=state.pending?.kind==='question'?state.pending.lineId:undefined;
 const line=plan.purpose==='clarification'?plan.line:state.draft.find(l=>l.id===questionId);
 if(line&&!line.sku&&line.productIntent?.kind!=='ambiguous'&&needsPipeType(line.query??line.name)&&!(base.stage==='identify'&&base.cards?.length)){
  const pump=/\bpump(?:ing)?\b|\bsuction\b|\bmotor\b|பம்ப்|மோட்டார்/i.test(line.query??line.name);
  const prompt=pump?say(state,'Which kind of pipe for the pump do you need? A brand or photo will help the shop identify it.','பம்புக்கு எந்த வகை பைப் வேணும்? பிராண்ட் அல்லது படம் இருந்தா சொல்லுங்க.','Pump-ku entha vagai pipe venum? Brand illa photo iruntha sollunga.'):say(state,'Which type of pipe do you need?','எந்த வகை பைப் வேணும்?','Entha vagai pipe venum?');
  const size=line.productMeasures?.map(m=>measurementText(`${m.value} ${m.unit}`,state)).join(' × ');
  const question=size?`${size} ${say(state,'pipe','பைப்','pipe')} — ${prompt}`:prompt;
  const choices:Button[]=!pump&&state.pending?.kind==='question'?(['pvc','hose','pump'] as const).map(pipeType=>({label:{pvc:say(state,'Rigid PVC','கெட்டியான PVC','Rigid PVC'),hose:say(state,'Flexible hose','வளையும் ஹோஸ்','Flexible hose'),pump:say(state,'Pump pipe','மோட்டார் பைப்','Pump pipe')}[pipeType],event:{id:randomUUID(),type:'choose_pipe_type',lineId:line.id,questionId:state.pending!.id,pipeType,expectedVersion:state.version}})):[shop(state)];
  return nativeReply({...base,text:question,contextLines:undefined,stage:'identify',clarificationReason:'product_or_specification',buttons:choices},state);
 }
 if(line&&!(base.stage==='identify'&&base.cards?.length)&&(line.resolution==='needs_quantity'||line.resolution==='needs_unit')){
  const product=line.candidates?.find(p=>p.sku===line.sku);
  const size=line.packSize??(product?catalogPack(product):undefined);
  const prompt=line.catalogIssue?draftIssueText(line,state)!:say(state,`How many ${line.unit??'packs'} of ${lineName(line,state)}?`,`${lineName(line,state)} — எத்தனை ${unitName(line.unit??'unit',state)} வேணும்?`,`${lineName(line,state)} — eththanai ${line.unit??'packs'} venum?`);
  const details=size?`${size.value} ${size.unit}`:'';
  if(!product)return nativeReply({...base,text:prompt,stage:'quantity',clarificationReason:line.requestedAmount?'requested_amount_conversion':'purchase_count'},state);
  const needsCount=line.resolution==='needs_quantity'&&line.quantity===null&&line.requestedQuantity===undefined&&!line.requestedAmount;
  if(!needsCount){
   const card:VisualCard={kind:'product',lineId:line.id,product,caption:productCaption(product,state,[measurementText(details,state),requestedAmountText(line,state),productPriceText(product,state),productStockText(product,state),prompt]),buttons:base.buttons?.slice(0,3)};
   return withContext({...reply('quantity',[part([card],prompt,base.buttons?.slice(0,3))],line.requestedAmount?'requested_amount_conversion':'purchase_count'),replyLanguage:state.replyLanguage},base.contextLines);
  }
  const step=product.quantityStep||1;
  const quantityButtons:Button[]=needsCount?[1,2,5].map(n=>Math.round(n*step*1000)/1000).filter(n=>n>0&&n<=100).map(quantity=>({label:`${quantity} ${unitName(product.unit,state,quantity)}`,event:{id:randomUUID(),type:'set_quantity',lineId:line.id,quantity,expectedVersion:state.version}})):base.buttons?.slice(0,3)??[];
  const text=[`*${productName(product,state)}*`,needsCount?say(state,`How many ${unitName(product.unit,state)}?`,`எத்தனை ${unitName(product.unit,state)} வேணும்?`,`Eththanai ${unitName(product.unit,state)} venum?`):prompt,needsCount?productPriceText(product,state):requestedAmountText(line,state),state.draft.length>1?say(state,'Your other items are kept.','மத்த items list-ல இருக்கு.','Maththa items list-la irukku.'):undefined].filter(Boolean).join('\n');
  return nativeReply({...base,text,stage:'quantity',clarificationReason:'purchase_count',contextLines:base.contextLines?.slice(0,1),buttons:quantityButtons},state);
 }
 if(base.cards?.length){
  const cards:VisualCard[]=base.cards.slice(0,3).map(c=>({kind:'product',product:c.product,caption:productCaption(c.product,state,[c.product.brand,measurementText(c.product.specifications?.size??'',state),productPriceText(c.product,state),productStockText(c.product,state),c.matchLabel,c.quantityLabel]),buttons:[...(c.action?[{label:c.label,event:c.action}]:[]),...(base.buttons??[]).filter(b=>!(b.event.type==='shopping_action'&&b.event.action==='handoff'))].slice(0,3)}));
  return withContext({...reply('identify',[part(cards,base.text)],'product_or_specification'),replyLanguage:state.replyLanguage},base.contextLines);
 }
 const welcomeTurn=!state.draft.length&&!state.lastRequestId&&(!base.text||/^(?:Hi[!, ]|Hello[!, ]|வணக்கம்|Vanakkam)/i.test(base.text));
 const stage=state.editingLineId?'correction':welcomeTurn?'welcome':base.stage??'status';
 const welcomeButtons:Button[]=[{label:'தமிழ்',event:{id:randomUUID(),type:'change_language',language:'ta'}},{label:'Tanglish',event:{id:randomUUID(),type:'change_language',language:'ta-Latn'}},action(state,'browse',say(state,'Browse items','பொருள் தேடு','Porul thedu'))];
 const message=stage==='welcome'?customerCopy('welcome',state):base.text;
 return nativeReply({...base,text:message,stage,buttons:stage==='welcome'?welcomeButtons:base.buttons?.slice(0,3)},state);
}
function nativeReply(base:RichReply,state:ConversationState):RichReply {
 return {...base,text:[...base.contextLines??[],base.text].filter(Boolean).join('\n'),parts:undefined,cards:undefined,presentation:base.buttons?.length?'list':'text',outboundMessages:1,replyLanguage:state.replyLanguage};
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
 const message=say(state,`You have a saved list with ${state.draft.length} items. Continue it or start a new list?`,`${state.draft.length} பொருட்கள் கொண்ட பட்டியல் உள்ளது.\nதொடரலாம் அல்லது புதிய பட்டியல் தொடங்கலாம்.`,`${state.draft.length} porutkal list-la irukku.\nThodaralaam illa pudhu list thodangalaam.`);
 return {...reply('returning',[part([],message,[action(state,'continue_list',say(state,'Continue list','List தொடரு','List thodaru')),action(state,'new_list',say(state,'New list','புது list','Pudhu list'))])]),replyLanguage:state.replyLanguage};
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
