import {customerCopy} from '../../../../packages/contracts/customer-copy.js';
import {estimateText} from './order-estimate.js';
import {textPresentation} from './message-presentation.js';
import {randomUUID,createHash} from 'node:crypto';
import type {ConversationState,RichReply,ReplyPart,VisualCard,ProductCheck,OrderRequest} from '../../../../packages/contracts/index.js';
import {say,lineName,unitName,productName,safeQuestion,localName,draftIssueText,requestedAmountText,measurementText,productPriceText,productStockText} from '../../../../packages/contracts/language.js';
import {formatMoney,lineTotal} from '../../../../packages/contracts/money.js';
import {productIdentity} from './product-confirmation.js';
import {canQuoteDraft,counterLine,productCheckCoversDraft} from './counter-state.js';
import {fitText} from './whatsapp-reply.js';
import {requestStatusText} from './request-status.js';
import {catalogPack,catalogContent} from './quantity-evidence.js';
import {needsPipeType} from './catalog-discovery.js';
import {planReply} from './reply-plan.js';

type Button=NonNullable<RichReply['buttons']>[number];
export const orderReference=(id:string)=>'Order #'+id.replaceAll('-','').slice(0,8).toUpperCase();
export function productListHash(state:ConversationState):string {return createHash('sha256').update(JSON.stringify(state.draft.map(l=>[l.id,l.sku,l.query,l.packSize,l.productMeasures,l.productIntent,l.candidates?.find(p=>p.sku===l.sku)?productIdentity(l.candidates.find(p=>p.sku===l.sku)!):null]))).digest('hex');}
const action=(state:ConversationState,a:'edit_list'|'handoff'|'continue_list'|'new_list',label:string):Button=>({label,event:{id:randomUUID(),type:'shopping_action',action:a,expectedVersion:state.version}});
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
export function visualProductReview(state:ConversationState):RichReply {
 const check=state.pending as ProductCheck;
 const meaning=check.groups.find(g=>state.draft.find(l=>l.id===g.lineId)?.productIntent?.kind==='ambiguous');
 if(meaning){
  const line=state.draft.find(l=>l.id===meaning.lineId)!,intent=line.productIntent!;
  const question=safeQuestion(intent.question,state)??say(state,'Which product type do you mean?','எந்த வகைப் பொருள் வேணும்?','Entha vagai porul venum?');
  const cards:VisualCard[]=intent.alternatives!.map(a=>{
   const product=meaning.products.find(p=>p.familyId===a.familyId),family=meaning.discovery?.facets.find(f=>f.key==='family')?.values.find(v=>v.value===a.familyId);
   const select:Button={label:say(state,'This type','இந்த வகை','Intha vagai'),event:{id:randomUUID(),type:'refine_search',batchId:check.id,lineId:line.id,facet:'family',value:a.familyId}};
   const caption=family?localName(family.label,family.localNames,state):a.query;
   return product?{kind:'product',lineId:line.id,product,caption:productCaption(productName(product,state),[caption,product.specifications?.size]),buttons:[select,shop(state)]}:instruction(caption,[say(state,'Shop needs to check this type','இந்த வகையை கடை சரிபார்க்கணும்','Intha vagai kadai check pannanum')],caption,[select,shop(state)]);
  });
  return reply('identify',[part(cards,question)],'product_meaning');
 }
 const ambiguous=check.groups.find(g=>g.products.length>1||!state.draft.find(l=>l.id===g.lineId)?.sku),missing=state.draft.filter(l=>!l.sku&&!l.candidates?.length||l.resolution==='unavailable');
 const identified=productCheckCoversDraft(state,check);
 const all=identified&&canQuoteDraft(state)&&!missing.length&&!ambiguous;
 const approve:Button={label:all?say(state,'Review bill','பில் பார்க்கலாம்','Bill paarkkalaam'):say(state,'Products are right','பொருட்கள் சரி','Porutkal sari'),event:{id:randomUUID(),type:'confirm_products',batchId:check.id}};
 const edit=change(state),help=shop(state);
 if(ambiguous){
  const line=state.draft.find(l=>l.id===ambiguous.lineId)!;
  const choices:VisualCard[]=ambiguous.products.slice(0,3).map(product=>({kind:'product',lineId:line.id,product,caption:productCaption(productName(product,state),[product.brand,measurementText(product.specifications?.size??'',state),productPriceText(product,state),productStockText(product,state)]),buttons:[{label:say(state,'Choose this','இதைத் தேர்வு செய்','Ithai choose pannu'),event:{id:randomUUID(),type:'select_product',batchId:check.id,lineId:line.id,sku:product.sku}},help]}));
  return reply('identify',[part(choices,say(state,`Which ${lineName(line,state)} do you need?`,`${lineName(line,state)} — எது வேணும்?`,`${lineName(line,state)} — ethu venum?`))],'product_or_specification');
 }
 const cards:VisualCard[]=state.draft.map((line,index)=>{
  const edit:Button={label:say(state,'Change this','இதை மாற்று','Ithai maathu'),event:{id:randomUUID(),type:'edit_item',lineId:line.id,expectedVersion:state.version}};
  const product=line.candidates?.find(p=>p.sku===line.sku);
  if(!product)return instruction(`${index+1}. ${line.query??line.name}`,[line.candidates?.length?say(state,'Choose the correct product','சரியான பொருளைத் தேர்வு செய்ய வேண்டும்','Sariyana porulai choose pannanum'):say(state,'Shop needs to check','கடை சரிபார்க்க வேண்டும்','Kadai check pannanum'),measurementText(line.packSize?`${line.packSize.value} ${line.packSize.unit}`:line.productMeasures?.map(m=>`${m.value} ${m.unit}`).join(' × ')??'',state),line.quantity!==null?`${line.quantity} ${unitName(line.requestedUnit??line.unit??'unit',state,line.quantity)}`:say(state,'Count still needed','எண்ணிக்கை சொல்ல வேண்டும்','Count sollanum')],say(state,'Requested item kept','கேட்ட பொருள் பட்டியலில் உள்ளது','Ketta porul list-la irukku'),[edit,help]);
  const pack=line.packSize??catalogPack(product),size=pack?`${pack.value} ${pack.unit}`:product.specifications?.size;
  const content=catalogContent(product),amount=line.requestedAmount;
  const count=line.quantity===null?amount?requestedAmountText(line,state):say(state,'Count: to check','எண்ணிக்கை: சொல்ல வேண்டும்','Count: sollanum'):`${line.quantity} ${unitName(product.unit,state,line.quantity)}`;
  const conversion=amount&&content&&line.quantity!==null&&!['metre','foot','litre','kg'].includes(product.unit)?`${content.value} ${content.unit} × ${line.quantity} = ${amount.value} ${amount.unit}`:undefined;
  return {kind:'product',lineId:line.id,product,caption:productCaption(productName(product,state),[product.brand?fitText(product.brand,24):'',measurementText(size??'',state),count,budgetText(line,state),conversion?measurementText(conversion,state):undefined,productPriceText(product,state),productStockText(product,state),draftIssueText(line,state)],index+1),buttons:[edit,help]};
 });
 const parts:ReplyPart[]=[];
 for(let start=0;start<cards.length;start+=9){
  const final=start+9>=cards.length;
  const lines=[say(state,'Check each item. Tell me any changes by text or voice.','பொருட்களைச் சரிபாருங்கள். மாற்றங்களை எழுத்து அல்லது குரலில் சொல்லுங்கள்.','Porutkalai check pannunga. Maaththangalai text illa voice-la sollunga.'),all?say(state,'Review the estimated bill before sending your order.','ஆர்டரை அனுப்பும் முன் உத்தேச பில்லைப் பாருங்கள்.','Order anuppum mun estimate bill-ai paarunga.'):say(state,'Shop help asks the shop about unresolved items; it does not place an order.','கடை உதவி தெரியாத விவரங்களைச் சரிபார்க்கும்; ஆர்டர் இன்னும் அனுப்பப்படாது.','Kadai help theriyatha vivarangalai check pannum; order innum anuppappadathu.')];
  if(identified&&!all){lines.splice(1,1,say(state,'Confirm the product names and photos. We will check the missing quantity or selling basis next.','பெயரையும் படத்தையும் உறுதி செய்யுங்கள். அடுத்து எண்ணிக்கை அல்லது விற்பனை அலகைச் சரிபார்ப்போம்.','Peyaraiyum photo-vaiyum confirm pannunga. Aduthu count illa virpanai unit-ai check pannalaam.'));}
  if(!identified&&final)lines.push(say(state,'Some items still need checking.','சில பொருட்களை இன்னும் சரிபார்க்க வேண்டும்.','Sila porutkalai innum check pannanum.'));
  const sendForCheck={...help,label:say(state,'Ask shop for help','கடை உதவி கேள்','Kadai help kelu')};
  const buttons=final&&identified?[approve,help]:[edit,final?sendForCheck:help];
  const countNeeded=identified&&!all?state.draft.slice(start,start+9).filter(l=>l.quantity===null&&!l.requestedAmount).map(l=>say(state,`${lineName(l,state)}: quantity still needed.`,`${lineName(l,state)}: எண்ணிக்கை சொல்ல வேண்டும்.`,`${lineName(l,state)}: quantity sollanum.`)):[];
  parts.push(part([...cards.slice(start,start+9),instruction(say(state,'Check the products','பொருட்களைப் பாருங்க','Porutkalai paarunga'),lines,say(state,'Check all photos','எல்லா படங்களையும் பாருங்க','Ella photos-aiyum paarunga'),buttons)],say(state,`Products ${start+1}–${Math.min(cards.length,start+9)} / ${cards.length}`,`பொருட்கள் ${start+1}–${Math.min(cards.length,start+9)} / ${cards.length}`,`Porutkal ${start+1}–${Math.min(cards.length,start+9)} / ${cards.length}`)+'\n'+say(state,'Swipe to check every photo.','பக்கமா நகர்த்தி எல்லா படங்களையும் பாருங்க.','Pakkamaaga nagarththi ella photos-aiyum paarunga.')+(all?'\n'+say(state,'Confirm these products to review the bill. Nothing is sent yet.','இந்தப் பொருட்களை உறுதி செய்ததும் பில் பார்க்கலாம். இன்னும் அனுப்பவில்லை.','Intha porutkalai confirm pannina bill paarkkalaam. Innum anuppala.'):countNeeded.length?'\n'+countNeeded.join('\n'):'')));
 }
 return reply(missing.length?'shop_check':'products',parts,missing.length?missing.find(l=>l.catalogIssue)?.catalogIssue??'catalog_missing':undefined);
}
export function visualBill(state:ConversationState,request?:OrderRequest):RichReply {
 if(state.pending?.kind==='review'&&(state.pending.excludedLineIds||state.pending.advanceRequired)||request?.estimateComplete===false){
  const buttons:Button[]=request?[]:[{label:say(state,'List is correct','List சரி','List sari'),event:{id:randomUUID(),type:'confirm',reviewId:state.pending!.id}},change(state)];
  return textPresentation(estimateText(state,request?.lines??state.draft,!!(state.pending?.kind==='review'&&state.pending.advanceRequired),!request),buttons,request?'submitted':'bill');
 }

 const lines=request?.lines??state.draft,total=request?.totalPaise??(state.pending?.kind==='review'?state.pending.totalPaise:0);
 const buttons:Button[]=request?[{label:say(state,'Order status','ஆர்டர் நிலை','Order status'),event:{id:randomUUID(),type:'shopping_action',action:'status',expectedVersion:state.version}},shop(state)]:state.pending?.kind==='review'?[{label:say(state,'Send to shop','கடைக்கு அனுப்பு','Kadaikku anuppu'),event:{id:randomUUID(),type:'confirm',reviewId:state.pending.id}},change(state)]:[];
 const parts:ReplyPart[]=[];
 const rowsPerPage=3,billCards:VisualCard[]=[],pages=Math.ceil(lines.length/rowsPerPage);
 for(let offset=0;offset<lines.length;offset+=rowsPerPage){
  const page=offset/rowsPerPage+1,final=page===pages;
  const rows=lines.slice(offset,offset+rowsPerPage).map(l=>{const p=l.candidates?.find(p=>p.sku===l.sku),pack=l.packSize??(p?catalogPack(p):undefined);return {name:lineName(l,state),packSize:measurementText(pack?`${pack.value} ${pack.unit}`:p?.specifications?.size??unitName(l.unit??'unit',state),state)+(l.requestedAmount?` · ${say(state,'total','மொத்தம்','moththam')} ${l.requestedAmount.value} ${unitName(l.requestedAmount.unit,state)}`:''),count:`${l.quantity} ${unitName(l.unit??'unit',state,l.quantity??1)}`,unitPrice:formatMoney(l.pricePaise!),total:formatMoney(lineTotal(l.pricePaise!,l.quantity!))};});
  billCards.push({kind:request?'status':'bill',title:request?say(state,'Sent to shop','கடைக்கு அனுப்பியாச்சு','Kadaikku anuppiyaachu'):say(state,'Estimated bill','உத்தேச பில்','Estimate bill'),reference:request?orderReference(request.id):undefined,lines:[say(state,`Page ${page} / ${pages}`,`பக்கம் ${page} / ${pages}`,`Page ${page} / ${pages}`),say(state,'Shop price may change','கடை விலை மாறலாம்','Kadai vilai maaralaam')],billRows:rows,total:final?say(state,`Estimated total: ${formatMoney(total)}`,`உத்தேச மொத்தம்: ${formatMoney(total)}`,`Estimate moththam: ${formatMoney(total)}`):undefined,caption:say(state,`Bill ${page} / ${pages}`,`பில் ${page} / ${pages}`,`Bill ${page} / ${pages}`),buttons:final?buttons:[change(state),shop(state)]});
 }
 for(let offset=0;offset<billCards.length;offset+=10)parts.push(part(billCards.slice(offset,offset+10),request?orderReference(request.id)+'\n'+say(state,'Waiting for shop approval','கடை ஒப்புதலுக்குக் காத்திருக்கிறது','Kadai approval-ku kaathirukku'):say(state,'Check sizes and counts. Say “send it to the store” by text or voice, or use the button.','அளவும் எண்ணிக்கையும் பாருங்க. சரின்னா “கடைக்கு அனுப்புங்க” என்று எழுத்து அல்லது குரலில் சொல்லலாம். பொத்தானையும் அழுத்தலாம்.','Size-um count-um marubadi paarunga.\nSarina kadaikku anuppunga.')));
 return reply(request?'submitted':'bill',parts);
}
export function visualReply(base:RichReply,state:ConversationState,request?:OrderRequest|null):RichReply {
 const plan=planReply(base,state,request);
 if(!state.visualOrdering||plan.purpose==='read_only')return base;
 if(plan.purpose==='error'||base.clarificationReason==='intent_clarification')return nativeReply(base,state);
 if(base.handoffRequested){return {...base,...reply('status',[part([instruction(say(state,'Shop assistance','கடையின் உதவி','Kadai help'),base.text.split('\n').filter(Boolean),say(state,'Waiting for the shop reply','கடை பதிலுக்குக் காத்திருக்கிறது','Kadai bathilukku kaathirukku'))],say(state,'Shop assistance requested. Your list is kept.','கடை உதவி கேட்டிருக்கோம். பட்டியல் அப்படியே இருக்கு.','Kadai help kettirukkom. List appadiye irukku.'))]),handoffRequested:true,replyLanguage:state.replyLanguage};}
 if(request){return {...(base.stage==='submitted'?visualBill(state,request):visualStatus(state,request)),replyLanguage:state.replyLanguage};}
 if(base.stage==='returning')return base;
 if(base.buttons?.length&&base.buttons.every(b=>b.event.type==='browse')){
  const categories=base.buttons;
  if(categories.length<=3){const buttons=categories.map((b,i)=>({...b,label:say(state,`Category ${i+1}`,`வகை ${i+1}`,`Vagai ${i+1}`)}));return {...reply('identify',[part([instruction(say(state,'Choose a category','எந்த வகை வேணும்?','Entha vagai venum?'),categories.map((b,i)=>`${i+1}. ${b.label}`),say(state,'Choose below','கீழே தேர்வு செய்யுங்க','Keezhe choose pannunga'),buttons)],say(state,'Choose a category, or send your request by voice.','வகையைத் தேர்வு செய்யுங்க. Voice-லும் சொல்லலாம்.','Vagai choose pannunga illa voice-la sollunga.'))]),replyLanguage:state.replyLanguage};}
  const cards=categories.map(b=>instruction(b.label,[],b.label,[{...b,label:say(state,'Open category','வகையைப் பார்','Vagai paaru')}])) ;return {...reply('identify',[part(cards,say(state,'Swipe and choose a category','பக்கமாக நகர்த்தி வகையைத் தேர்வு செய்யுங்க','Pakkamaaga nagarththi vagai choose pannunga'))]),replyLanguage:state.replyLanguage};
 }

 if(base.buttons?.length&&base.buttons.every(b=>b.event.type==='edit_item'))return visualEditPicker(state);
 if(state.pending?.kind==='products'&&!(base.stage==='identify'&&base.cards?.length))return withContext({...visualProductReview(state),replyLanguage:state.replyLanguage},base.contextLines);
 if(state.pending?.kind==='review'&&!(base.stage==='identify'&&base.cards?.length)){
  if(!plan.mayOfferSubmission)return nativeReply({...base,text:say(state,'The list needs a fresh check before submission. Review the product, amount and shop price.','அனுப்பும் முன் பட்டியலை மீண்டும் சரிபார்க்க வேண்டும். பொருள், எண்ணிக்கை, கடை விலையைச் சரிபாருங்கள்.','Anuppum mun list-ai marubadi check pannanum. Porul, count, kadai vilai check pannunga.'),kind:'text',stage:'identify',buttons:(base.buttons??[]).filter(b=>b.event.type!=='confirm')},state);
  const bill=visualBill(state);return withContext({...bill,replyLanguage:state.replyLanguage},base.contextLines);
 }
 if(state.editingLineId){
  const selected=state.draft.find(l=>l.id===state.editingLineId),product=selected?.candidates?.find(p=>p.sku===selected.sku);
  if(product){const question=say(state,'What should change: product, size or count?','பொருள், அளவு, எண்ணிக்கை — என்ன மாற்றணும்?','Porul, size, count — enna maathanum?');return {...reply('correction',[part([{kind:'product',lineId:selected!.id,product,caption:productCaption(productName(product,state),[product.specifications?.size,question]),buttons:base.buttons?.slice(0,3)}],question)],'selected_item_change'),replyLanguage:state.replyLanguage};}
 }
 const questionId=state.pending?.kind==='question'?state.pending.lineId:undefined;
 const line=plan.purpose==='clarification'?plan.line:state.draft.find(l=>l.id===questionId);
 if(line&&!line.sku&&line.productIntent?.kind!=='ambiguous'&&needsPipeType(line.query??line.name)&&!(base.stage==='identify'&&base.cards?.length)){
  const pump=/\bpump(?:ing)?\b|\bsuction\b|\bmotor\b|பம்ப்|மோட்டார்/i.test(line.query??line.name);
  const prompt=pump?say(state,'Which kind of pipe for the pump do you need? A brand or photo will help the shop identify it.','பம்புக்கு எந்த வகை பைப் வேணும்? பிராண்ட் அல்லது படம் இருந்தா சொல்லுங்க.','Pump-ku entha vagai pipe venum? Brand illa photo iruntha sollunga.'):say(state,'Which kind of pipe do you mean: rigid PVC, a flexible hose, or a pump delivery/suction pipe?','எந்த வகை பைப் வேணும் — கெட்டியான PVC, வளையும் ஹோஸ், அல்லது மோட்டார் தண்ணீர் பைப்?','Entha vagai pipe venum — rigid PVC, flexible hose, illa motor thanni pipe?');
  const label=lineName(line,state);
  const namedPrompt=label+': '+prompt;
  const count=line.quantity===null?say(state,'Count still needed','எண்ணிக்கை தேவை','Count venum'):`${line.quantity} ${unitName(line.requestedUnit??line.unit??'unit',state,line.quantity)}`;
  const size=line.productMeasures?.map(m=>`${m.value} ${m.unit}`).join(' × ');
  const kept=say(state,'Your requested quantity and size are kept. No catalog product is selected yet.','நீங்கள் சொன்ன எண்ணிக்கையும் அளவும் பட்டியலில் உள்ளது. இன்னும் கடைப் பொருள் தேர்வு செய்யவில்லை.','Neenga sonna count-um size-um list-la irukku. Catalog product innum choose pannala.');
  const choices:Button[]=!pump&&state.pending?.kind==='question'?(['pvc','hose','pump'] as const).map(pipeType=>({label:{pvc:say(state,'Rigid PVC','கெட்டியான PVC','Rigid PVC'),hose:say(state,'Flexible hose','வளையும் ஹோஸ்','Flexible hose'),pump:say(state,'Pump pipe','மோட்டார் பைப்','Pump pipe')}[pipeType],event:{id:randomUUID(),type:'choose_pipe_type',lineId:line.id,questionId:state.pending!.id,pipeType,expectedVersion:state.version}})):[shop(state)];
  return nativeReply({...base,text:[namedPrompt,size?measurementText(size,state):undefined,count,kept].filter(Boolean).join('\n'),stage:'identify',clarificationReason:'product_or_specification',buttons:choices},state);
 }
 if(line&&!(base.stage==='identify'&&base.cards?.length)&&(line.resolution==='needs_quantity'||line.resolution==='needs_unit')){
  const product=line.candidates?.find(p=>p.sku===line.sku);
  const size=line.packSize??(product?catalogPack(product):undefined);
  const prompt=line.catalogIssue?draftIssueText(line,state)!:say(state,`How many ${line.unit??'packs'} of ${lineName(line,state)}?`,`${lineName(line,state)} — எத்தனை ${unitName(line.unit??'unit',state)} வேணும்?`,`${lineName(line,state)} — eththanai ${line.unit??'packs'} venum?`);
  const details=size?`${size.value} ${size.unit}`:'';
  if(!product)return nativeReply({...base,text:prompt,stage:'quantity',clarificationReason:line.requestedAmount?'requested_amount_conversion':'purchase_count'},state);
  const cards:VisualCard[]=[{kind:'product',lineId:line.id,product,caption:productCaption(productName(product,state),[measurementText(details,state),requestedAmountText(line,state),productPriceText(product,state),productStockText(product,state),prompt]),buttons:base.buttons?.slice(0,3)}];
  return withContext({...reply('quantity',[part(cards,prompt,base.buttons?.slice(0,3))],line.requestedAmount?'requested_amount_conversion':'purchase_count'),replyLanguage:state.replyLanguage},base.contextLines);
 }
 if(base.cards?.length){
  const cards:VisualCard[]=base.cards.slice(0,3).map(c=>({kind:'product',product:c.product,caption:productCaption(productName(c.product,state),[c.product.brand,measurementText(c.product.specifications?.size??'',state),productPriceText(c.product,state),productStockText(c.product,state),c.matchLabel,c.quantityLabel]),buttons:[...(c.action?[{label:c.label,event:c.action}]:[]),...base.buttons??[]].slice(0,3)}));
  return withContext({...reply('identify',[part(cards,base.text)],'product_or_specification'),replyLanguage:state.replyLanguage},base.contextLines);
 }
 const welcomeTurn=!state.draft.length&&!state.lastRequestId&&(!base.text||/^(?:Hi[!, ]|Hello[!, ]|வணக்கம்|Vanakkam)/i.test(base.text));
 const stage=state.editingLineId?'correction':welcomeTurn?'welcome':base.stage??'status';
 const welcomeButtons:Button[]=[{label:'தமிழ்',event:{id:randomUUID(),type:'change_language',language:'ta'}},{label:'Tanglish',event:{id:randomUUID(),type:'change_language',language:'ta-Latn'}},shop(state)];
 const message=stage==='welcome'?customerCopy('welcome',state):base.text;
 return {...base,...reply(stage,[part([instruction(stage==='welcome'?say(state,'Welcome','வணக்கம்','Vanakkam'):say(state,'Your list','உங்கள் பட்டியல்','Unga list'),message.split('\n').filter(Boolean),say(state,'Text, voice or photo','எழுத்து, குரல் பதிவு அல்லது படம்','Text, voice illa photo'),stage==='welcome'?welcomeButtons:base.buttons?.slice(0,3))],stage==='welcome'?say(state,'Send what you need.','தேவையானதை அனுப்புங்க.','Thevaiyanathai anuppunga.'):fitText(message.split('\n')[0],180))]),replyLanguage:state.replyLanguage};
}
function nativeReply(base:RichReply,state:ConversationState):RichReply {
 return {...base,text:[...base.contextLines??[],base.text].filter(Boolean).join('\n'),parts:undefined,cards:undefined,presentation:base.buttons?.length?'list':'text',outboundMessages:1,replyLanguage:state.replyLanguage};
}
function withContext(result:RichReply,lines:string[]|undefined):RichReply {
 if(!lines?.length||!result.parts?.length)return result;
 result.parts[0].text=[...lines.map(l=>fitText(l,240)),result.parts[0].text].join('\n');
 result.text=result.parts.map(p=>p.text).join('\n\n');return result;
}
export function returningReply(state:ConversationState):RichReply {
 const message=say(state,`You have a saved list with ${state.draft.length} items. Continue it or start a new list?`,`${state.draft.length} பொருட்கள் கொண்ட பட்டியல் உள்ளது.\nதொடரலாம் அல்லது புதிய பட்டியல் தொடங்கலாம்.`,`${state.draft.length} porutkal list-la irukku.\nThodaralaam illa pudhu list thodangalaam.`);
 return reply('returning',[part([instruction(say(state,'Saved list','சேமித்த பட்டியல்','Saved list'),message.split('\n'),message,[action(state,'continue_list',say(state,'Continue list','பட்டியலைத் தொடரு','List thodaru')),action(state,'new_list',say(state,'New list','புதிய பட்டியல்','Pudhu list'))])],message)]);
}

export function visualStatus(state:ConversationState,request:OrderRequest):RichReply {
 const reference=orderReference(request.id),text=requestStatusText(request,state.replyLanguage);
 const status=request.acceptance==='rejected'||request.fulfillment==='cancelled'?say(state,'Shop could not fulfill','கடை நிறைவேற்ற முடியவில்லை','Kadai niraivetra mudiyala'):request.fulfillment==='collected'?say(state,'Collected','பெற்றுக்கொண்டீர்கள்','Vaangiyaachu'):request.fulfillment==='ready_for_pickup'?say(state,'Ready for pickup','பெற்றுக்கொள்ளத் தயார்','Vaangikka ready'):request.acceptance==='accepted'?say(state,'Shop accepted','கடை ஏற்றுக்கொண்டது','Kadai accept panniyirukku'):say(state,'Sent to shop','கடைக்கு அனுப்பியாச்சு','Kadaikku anuppiyaachu');
 return {...reply('status',[part([{kind:'status',title:status,reference,lines:[say(state,'Estimated amount','உத்தேச தொகை','Estimate amount')+': '+formatMoney(request.totalPaise),say(state,'Shop price may change','கடை விலை மாறலாம்','Kadai vilai maaralaam'),say(state,'Check pickup and payment with the shop','Pickup, payment பற்றி கடையிடம் கேளுங்கள்','Pickup, payment paththi kadaiyila kelunga')],caption:reference}],text)]),replyLanguage:state.replyLanguage};
}

function visualEditPicker(state:ConversationState):RichReply {
 const help=shop(state),keep:Button={label:say(state,'Keep list','மாற்ற வேண்டாம்','Maatha venaam'),event:{id:randomUUID(),type:'shopping_action',action:'keep_list',expectedVersion:state.version}};
 const cards:VisualCard[]=state.draft.map((line,index)=>{const button:Button={label:say(state,'Change this','இதை மாற்று','Ithai maathu'),event:{id:randomUUID(),type:'edit_item',lineId:line.id,expectedVersion:state.version}},product=line.candidates?.find(p=>p.sku===line.sku);const caption=`${index+1}. ${lineName(line,state)}`;return product?{kind:'product',lineId:line.id,product,caption,buttons:[button,help]}:instruction(caption,[say(state,'Shop needs to check','கடை சரிபார்க்க வேண்டும்','Kadai check pannanum')],caption,[button,help]);});
 const parts:ReplyPart[]=[];for(let offset=0;offset<cards.length;offset+=9)parts.push(part([...cards.slice(offset,offset+9),instruction(say(state,'Which item needs changing?','எந்தப் பொருளை மாற்றணும்?','Entha porulai maathanum?'),[say(state,'Tap that item or say its name in text / voice','படத்தில் தேர்வு செய்யுங்க. அல்லது பெயரை text / voice-ல சொல்லுங்க.','Photo-la choose pannunga illa peyarai text / voice-la sollunga.')],say(state,'Choose the item to change','மாற்ற வேண்டிய பொருளைத் தேர்வு செய்','Maatha vendiya porulai choose pannu'),[keep,help])],say(state,'Choose the item to change','மாற்ற வேண்டிய பொருளைத் தேர்வு செய்','Maatha vendiya porulai choose pannu')));
 return reply('correction',parts,'correction_target');
}

function productCaption(name:string,details:(string|undefined)[],index?:number):string {
 const suffix=[...new Set(details.filter((d):d is string=>!!d&&!name.toLowerCase().includes(d.toLowerCase())))].join('\n'),prefix=index?`${index}. `:'';
 const available=Math.max(20,160-Array.from(suffix).length-prefix.length-1);
 return prefix+fitText(name,available)+(suffix?'\n'+suffix:'');
}
