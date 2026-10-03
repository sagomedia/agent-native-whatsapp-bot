import {priceInquiry} from './shopping-language.js';
import {randomUUID} from 'node:crypto';
import type {ConversationState,Interpretation,RichReply,ProductCard,SimulatorEvent} from '../../../../packages/contracts/index.js';
import {formatMoney} from '../../../../packages/contracts/money.js';
import type {ToolResult} from './tools.js';
import {renderDraft} from './tools.js';
import {productCheckReply} from './product-verification.js';

export function socialIntent(text:string):Interpretation['conversation']|undefined {
  const s=text.toLowerCase().trim().replace(/[!.,?]+$/,'');
  if(/^(hi|hello|hey|hi there|good morning|good evening|vanakkam|வணக்கம்)(?: (?:anna|sir|bro))?$/.test(s))return 'greeting';
  if(/^(thanks|thank you|thank you so much|நன்றி)(?: (?:anna|sir|bro))?$/.test(s))return 'thanks';
  if(/^(help|what can you do|how does this work)$/.test(s))return 'help';
  if(/^(no|no thanks|not now|cancel that|just browsing|only browsing|none|none of these)$/.test(s))return 'pause';
  if(/^(talk to (?:the )?shop|talk to a person|human please)$/.test(s))return 'handoff';
}
export function socialReply(intent:Interpretation['conversation'],state:ConversationState):string {
  if(intent==='greeting')return state.draft.length?'Hi again! Your list is still here. What would you like to change or add?':"Hi! I’m ShopBot, your shop assistant. What are you looking for today? If you’re unsure of the name or size, tell me what it’s for.";
  if(intent==='pause')return state.lastRequestId?'Your request has already been sent to the shop. Please ask them about a cancellation or amendment.':"Okay, I haven’t sent a request. Your list is kept. Tell me what to change, or say ‘clear my list’ to start over.";
  if(intent==='thanks')return 'You’re welcome! Anything else you’d like me to help you find?';
  if(intent==='handoff')return 'You can ask the shop to check sizes, availability or a special request. A direct handoff isn’t connected in this test yet; I can keep helping you narrow down the item here.';
  return 'Tell me the product you need, or what you’re working on. I’ll show matching options and ask about size and quantity before you confirm.';
}

export function shopInquiry(text:string):Interpretation|undefined {
  const s=text.toLowerCase().trim();
  // Only standalone inquiries bypass inference; shopping plus a question still
  // goes through the interpreter so its item operations are retained.
  if(!/^(?:can|could|do|does|will|would|are|is|when|what|how)\b/.test(s)||/\b(?:i need|i want|add|remove|make|change|can i get|can you add)\b/.test(s))return;
  const shopQuestions:NonNullable<Interpretation['shopQuestions']>=[];
  if(/\bdeliver(?:y)?|shipping|ship\b/.test(s))shopQuestions.push('delivery');
  if(/discount|plumber rate|trade (?:price|rate)|best price/.test(s))shopQuestions.push('discount');
  if(/closing|close|open|working hours|opening hours/.test(s))shopQuestions.push('hours');
  if(/compatible|will (?:this|it|that) fit|pressure rating|suitable for/.test(s))shopQuestions.push('technical');
  if(/in stock|available today|ready today/.test(s))shopQuestions.push('availability');
  return shopQuestions.length?{operations:[],next:'continue',conversation:'shop_question',shopQuestions}:undefined;
}
function shopAnswers(questions:Interpretation['shopQuestions']) {
  const answers={delivery:'Please check delivery timing, area and charges with the shop. I can help prepare your item list.',discount:'I can show catalog prices; trade rates or discounts need the shop’s confirmation.',hours:'The shop’s opening hours aren’t in this catalog. Please check with the shop before travelling.',technical:'The catalog doesn’t verify that compatibility or rating. Please confirm the exact specification with the shop before choosing.',availability:'Availability and readiness need the shop’s confirmation; I can help prepare your item list.'};
  return [...new Set(questions??[])].map(q=>answers[q]).join(' ');
}

function unitLabel(unit:string,quantity:number) {if(quantity===1)return unit;return ({box:'boxes',foot:'feet',kg:'kg',g:'g',m:'m',mm:'mm',cm:'cm',litre:'litres'} as Record<string,string>)[unit]??unit+'s';}
function questionFromAI(value:string|undefined) {
  return value&&value.endsWith('?')&&!/[\d₹$]|discount|payment|in stock|ready|approved|guarantee|https?:/i.test(value)?value:undefined;
}
export function presentReply(result:ToolResult,state:ConversationState,intent?:Interpretation,event?:SimulatorEvent):RichReply {
  const priceRequest=event?.type==='quote_product'?{quantity:event.quantity,requestedUnit:event.requestedUnit}:event?.type==='text'?priceInquiry(event.text):undefined;
  const quoting=!!priceRequest||intent?.next==='price';
  let text=result.message,cards:ProductCard[]|undefined,kind:RichReply['kind']='text',buttons:RichReply['buttons'];
  if(intent?.operations.length===0&&intent.next==='continue'&&intent.conversation)text=intent.conversation==='shop_question'?shopAnswers(intent.shopQuestions)||socialReply('handoff',state):socialReply(intent.conversation,state);
  else if(result.products) {
    if(result.products.length){text=intent?.conversation==='browse'?'Here are the closest options. Choose the size/type you need; I’ll ask how many next.':`Here are the catalog prices and options. ${quoting?result.message+'\n':''}Which one did you mean?`;if(result.quote)text=`${result.products[0].name}: ${formatMoney(result.products[0].pricePaise)} / ${result.quote.unit}. For ${result.quote.quantity} ${unitLabel(result.quote.unit,result.quote.quantity)}, the catalog total is ${formatMoney(result.quote.totalPaise)}. Availability needs shop confirmation. This quote hasn’t added anything to your list.`;cards=result.products.slice(0,10).map(product=>({product,label:quoting?(result.products!.length>1?'Check this price':'Add to my list'):'Choose this',action:quoting&&result.products!.length>1?{id:randomUUID(),type:'quote_product',sku:product.sku,quantity:priceRequest?.quantity??intent?.priceQuantity,requestedUnit:priceRequest?.requestedUnit??intent?.priceUnit,expectedVersion:state.version}:{id:randomUUID(),type:'choose_product',sku:product.sku,...(quoting&&result.quote?{quantity:result.quote.quantity}:{}),expectedVersion:state.version}}));}
    else text='I couldn’t find a matching item in this catalog. What is it for, and do you know the size or type?';
  } else if(state.pending?.kind==='products'&&result.state) {
    return productCheckReply(state);
  } else if(state.pending?.kind==='question'&&result.state) {
    const pending=state.pending,line=state.draft.find(l=>l.id===pending.lineId)!;
    const others=state.draft.filter(l=>l.id!==line.id&&l.resolution!=='matched');
    if(line.resolution==='needs_unit') {
      text=`${line.name} is sold per ${line.unit}. You asked for ${line.requestedQuantity??'an amount in'} ${unitLabel(line.requestedUnit??'unit',line.requestedQuantity??2)}. I don’t have a verified conversion or pack length. How many ${unitLabel(line.unit??'unit',2)} do you need? Include the unit, or check the conversion with the shop.`;
    } else if(line.resolution==='needs_quantity') {
      text=`I found ${line.name}. How many ${unitLabel(line.unit??'unit',2)} would you like?`;
      cards=event?.type==='select_candidate'||event?.type==='choose_product'||event?.type==='text'?undefined:line.candidates?.slice(0,1).map(product=>({product,label:'Selected',action:{id:randomUUID(),type:'select_candidate',questionId:pending.id,lineId:line.id,sku:product.sku}}));
      // Quantity is still required; this card is informational, not another addition.
      cards=cards?.map(c=>({...c,label:'Selected',action:undefined}));
    } else if(line.resolution==='needs_choice') {
      text=`Let’s make sure I’ve got the right ${line.query??'item'}. ${questionFromAI(intent?.clarifyQuestion)??((line.candidates?.length??0)===1?'Is this the size/type you mean?':'Which of these sizes/types do you need? If none fits, tell me what you’re using it for.')}`;
      cards=line.candidates?.slice(0,10).map(product=>({product,label:'Choose this',action:{id:randomUUID(),type:'select_candidate',questionId:pending.id,lineId:line.id,sku:product.sku}}));
    } else {
      text=line.sku?`The shop needs to check availability for ${line.name}. Would you like a different item?`:`I checked the catalog for “${line.name}”, but there’s no matching listing. I’ve kept it on your list for the shop to check. ${questionFromAI(intent?.clarifyQuestion)??(/paint/i.test(line.name)?'What are you painting—walls, wood or metal?':'What will you use it for? I can look for relevant options, or leave this for the shop to check.')}`;
    }
    if(event?.type==='text'&&/^(?:yes|confirm|one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)$/i.test(event.text.trim())&&line.resolution==='needs_choice'){text=`I still need the size/type for ${line.query??line.name}. Please choose an option by name or button; if that was a quantity, include the unit.`;cards=undefined;}
    if(others.length)text+=` I’ve also kept ${others.map(l=>l.query??l.name).join(' and ')} on your list; we’ll check those next.`;
  } else if(state.pending?.kind==='review'&&result.state) {
    kind='order_review';text=`Here’s your list:\n${renderDraft(state)}\n\nTotal: ${formatMoney(state.pending.totalPaise)} for pickup. Shall I send this request to the shop? They’ll confirm availability before it’s ready.`;
    buttons=[{label:'Confirm request',event:{id:randomUUID(),type:'confirm',reviewId:state.pending.id}}];
    if(state.requireProductConfirmation)cards=state.draft.slice(0,10).flatMap(line=>{
      const product=line.candidates?.find(p=>p.sku===line.sku);
      return product?[{product,label:'Product checked',quantityLabel:`${line.quantity} ${unitLabel(line.unit??'unit',line.quantity??1)}`,requestLabel:line.name}]:[];
    });
  } else if(result.request) text=`${event?.type==='text'&&/^(my orders|order status|status)$/i.test(event.text.trim())?'Your request is still with the shop.':'Thanks!'} Your ${formatMoney(result.request.totalPaise)} request is waiting for the shop’s approval. They still need to confirm availability and pickup readiness. No payment is requested here.`;
  else if(intent?.operations.length===0&&intent.next==='continue')text=questionFromAI(intent.clarifyQuestion)??socialReply(intent.conversation,state);
  else if(result.state&&result.message.startsWith('Draft updated.'))text='Got it—your list is updated. Want to add anything else, or shall we review it?';
  if(!intent?.operations.length&&event?.type==='text'&&/^(yes|confirm|place order|send it)$/i.test(event.text.trim())&&!state.pending)text=state.lastRequestId?'Your request is already with the shop. Say “status” to check it.':state.draft.length?'Please review your list before confirming. Say “review” when you’re ready.':'Your list is empty. What would you like to order?';
  if(intent?.operations.length&&intent.shopQuestions?.length)text+=' '+shopAnswers(intent.shopQuestions);
  if(event?.type==='text'&&/^(clear my list|clear the list|empty my list)$/i.test(event.text.trim())&&!state.lastRequestId)text='Your list is cleared. What would you like to look for next?';
  if((result.totalCount??0)>10)text+=' I’m showing ten options. Tell me a size/type to narrow them down.';
  if(cards?.length&&kind!=='order_review')kind='product_choices';
  const presentation=cards?.length===1?'single_product':cards?.length&&cards.every(c=>c.product.imageUrl)?'carousel_preview':cards?.length?'list':'text';
  return {version:1,kind,text,cards,buttons,presentation,outboundMessages:1};
}
export function plainReply(text:string):RichReply{return {version:1,kind:'text',text,presentation:'text',outboundMessages:1};}
