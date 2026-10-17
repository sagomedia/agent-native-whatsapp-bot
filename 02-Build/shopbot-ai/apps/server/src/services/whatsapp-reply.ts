import {createHash} from 'node:crypto';
import type {RichReply,SimulatorEvent,ProductCard,VisualCard} from '../../../../packages/contracts/index.js';
import {productName,unitName,say,productPriceText,referencePhotoLabel} from '../../../../packages/contracts/language.js';
import {formatMoney} from '../../../../packages/contracts/money.js';

export type WhatsAppAction={id:string;label:string;event:SimulatorEvent};
export type WhatsAppReply={payload:Record<string,unknown>;actions:WhatsAppAction[];format:'text'|'buttons'|'image'|'carousel'|'list'|'audio'};
export {fitText} from '../../../../packages/contracts/channel-text.js';
import {fitText,cardMessageText,productPhotoCaption} from '../../../../packages/contracts/channel-text.js';
export function productMediaUrl(image:string|undefined,hostname:string):string|undefined {
  if(!image)return;
  if(/^\/demo-images\/H\d{2}\.jpg$/.test(image))return `https://${hostname}/catalog-images/${image.split('/').at(-1)}`;
  if(/^\/catalog-images\/messages\/[a-f0-9]{64}\.png$/.test(image))return `https://${hostname}${image}`;
  if(/^\/catalog-images\/(?:custom|reference)\/[a-f0-9-]{36}\.jpg$/.test(image))return `https://${hostname}${image}`;
  try{const url=new URL(image);if(url.protocol==='https:'&&!url.username&&!url.password)return url.href;}catch{}
}
export function cardText(card:ProductCard,reply:RichReply):string {
  const language=reply.replyLanguage??'en';
  const price=card.product.priceStatus==='confirm'||card.product.pricePaise===0&&card.product.priceStatus!=='free'?productPriceText(card.product,language):`${formatMoney(card.product.pricePaise)} / ${unitName(card.product.unit,language)}`;
  const reference=referencePhotoLabel(card.product,language),limit=160-(reference?Array.from(reference).length+1:0);
  const detail=[card.matchLabel,card.quantityLabel??card.detailLabel].filter(Boolean).join(' · ').replace(/\s+/g,' ');
  const last=fitText(detail,45),reserved=Array.from(price).length+(last?Array.from(last).length+1:0)+1;
  // The photograph's catalog identity must survive caption truncation. Request
  // context follows it and can be shortened; it never replaces the product name.
  const name=fitText([productName(card.product,language),card.requestLabel].filter(Boolean).join(' · ').replace(/\s+/g,' '),Math.max(20,limit-reserved));
  return productPhotoCaption([name,price,last||undefined].filter(Boolean).join('\n'),card.product,language);
}
export function renderWhatsAppReply(reply:RichReply,messageId:string,hostname:string):WhatsAppReply {
  if(reply.audio){if(!/^\/welcome-audio\/[a-f0-9]{64}\.ogg$/.test(reply.audio.url))throw new Error('Invalid welcome audio');return {format:'audio',actions:[],payload:{type:'audio',audio:{link:`https://${hostname}${reply.audio.url}`,voice:true}}};}
  if(reply.parts)return renderVisualPart(reply,messageId,hostname);
  if((reply.cards?.length??0)>10)throw new Error('A WhatsApp reply may contain at most ten product cards');
  const actions:WhatsAppAction[]=[];
  const bind=(label:string,event:SimulatorEvent):WhatsAppAction=>{
    const id='w'+createHash('sha256').update(messageId+':'+actions.length+':'+event.id).digest('base64url').slice(0,19);
    const action={id,label:fitText(label.trim().replace(/\s+/g,' ')||say(reply.replyLanguage??'en','Choose','தேர்வு','Choose'),20),event};actions.push(action);return action;
  };
  const cards=reply.kind==='order_review'?[]:reply.cards??[],body=fitText(reply.text,1024);
  const media=cards.map(c=>productMediaUrl(c.product.imageUrl,hostname));
  const shared=reply.buttons??[];
  const start=shared.find(b=>b.event.type==='shopping_action'&&b.event.action==='new_list');
  // Ambiguous multi-line previews already use Start this list as their primary
  // action. A carousel must not repeat that title within the same card.
  const menu=start&&cards.some(c=>c.action?.id===start.event.id||fitText(c.label,20)===fitText(start.label,20))
    ?shared.find(b=>b.event.type==='shopping_action'&&b.event.action==='handoff')
    :start??shared.find(b=>b.event.type==='shopping_action'&&b.event.action==='options');
  if(reply.kind==='order_review'&&Array.from(reply.text).length>1024)throw new Error('Order review must fit in full before confirmation');
  if(reply.presentation==='carousel_preview'&&cards.length>=2&&media.every(Boolean)&&cards.every(c=>c.action||shared.length)){
    const entries=cards.map((card,index)=>{
      const batch=shared.find(b=>b.event.type==='confirm_products');
      const buttons=batch&&menu?[bind(batch.label,batch.event),bind(menu.label,menu.event)]:card.action?[bind(card.label,card.action),...(menu?[bind(menu.label,menu.event)]:shared.filter(b=>b.event.type==='review'||b.event.type==='confirm_products').slice(0,1).map(b=>bind(b.label,b.event)))]:shared.slice(0,2).map(b=>bind(b.label,b.event));
      if(new Set(buttons.map(b=>b.label)).size!==buttons.length)throw new Error('Carousel button titles must be unique within each card');
      return {card_index:index,type:'cta_url',header:{type:'image',image:{link:media[index]}},body:{text:cardText(card,reply)},action:{buttons:buttons.map(b=>({type:'quick_reply',quick_reply:{id:b.id,title:b.label}}))}};
    });
    if(new Set(entries.map(c=>c.action.buttons.length)).size!==1)throw new Error('Carousel cards must have the same button count');
    return {format:'carousel',actions,payload:{type:'interactive',interactive:{type:'carousel',body:{text:body},action:{cards:entries}}}};
  }
  if(cards.length===1&&media[0]){
    const card=cards[0],batch=shared.find(b=>b.event.type==='confirm_products');
    const buttons=batch&&menu?[bind(batch.label,batch.event),bind(menu.label,menu.event)]:card.action?[bind(card.label,card.action),...(menu?[bind(menu.label,menu.event)]:shared.slice(0,2).map(b=>bind(b.label,b.event)))]:shared.slice(0,3).map(b=>bind(b.label,b.event));
    const caption=cardText(card,reply),text=referencePhotoLabel(card.product,reply.replyLanguage??'en')?cardMessageText(fitText(reply.text,1024-Array.from(caption).length-2),caption):fitText(reply.text+'\n\n'+caption,1024);
    if(new Set(buttons.map(b=>b.label)).size!==buttons.length)throw new Error('Reply button titles must be unique');
    if(buttons.length)return {format:'buttons',actions,payload:{type:'interactive',interactive:{type:'button',header:{type:'image',image:{link:media[0]}},body:{text},action:{buttons:buttons.map(b=>({type:'reply',reply:{id:b.id,title:b.label}}))}}}};
    return {format:'image',actions,payload:{type:'image',image:{link:media[0],caption:text}}};
  }
  const choiceCards=cards.filter(c=>c.action);
  const productOptions=choiceCards.map(c=>({label:productName(c.product,reply.replyLanguage??'en'),event:c.action!}));
  const rawOptions=choiceCards.length?shared.length+productOptions.length<=10?[...shared,...productOptions]:[...productOptions,...shared].slice(0,10):shared;
  const options=rawOptions.map(b=>bind(b.label,b.event));
  if(options.length>10)throw new Error('A WhatsApp list may contain at most ten choices');
  if((options.length>0&&choiceCards.length>0)||options.length>3){
    return {format:'list',actions,payload:{type:'interactive',interactive:{type:'list',body:{text:body},action:{button:say(reply.replyLanguage??'en','Choose an option','தேர்வு செய்யுங்கள்','Choose'),sections:[{rows:options.map((b,index)=>{const card=choiceCards.find(c=>c.action===rawOptions[index].event);return {id:b.id,title:fitText(`${index+1}. ${b.label}`,24),...(card?{description:fitText(`${formatMoney(card.product.pricePaise)} / ${card.product.unit}`,72)}:{})};})}]}}}};
  }
  if(options.length)return {format:'buttons',actions,payload:{type:'interactive',interactive:{type:'button',body:{text:body},action:{buttons:options.map(b=>({type:'reply',reply:{id:b.id,title:b.label}}))}}}};
  return {format:'text',actions,payload:{type:'text',text:{preview_url:false,body:fitText(reply.text,4096)}}};
}

function renderVisualPart(reply:RichReply,messageId:string,hostname:string):WhatsAppReply {
 if(reply.parts?.length!==1)throw new Error('Render and track one ordered part at a time');
 const part=reply.parts[0];
 if(!part.cards.length){if(Array.from(part.text).length>4096||part.buttons?.length&&Array.from(part.text).length>1024)throw new Error('Text part exceeds channel limit');return renderWhatsAppReply({...reply,parts:undefined,kind:part.buttons?.length?reply.kind:'text',text:part.text,buttons:part.buttons},messageId,hostname);}
 if(part.cards.length>10)throw new Error('Visual parts require 1–10 cards');
 const actions:WhatsAppAction[]=[];
 const bind=(button:NonNullable<RichReply['buttons']>[number])=>{const id='w'+createHash('sha256').update(messageId+':'+actions.length+':'+button.event.id).digest('base64url').slice(0,19);const action={id,label:fitText(button.label,20),event:button.event};actions.push(action);return action;};
 const media=part.cards.map(c=>productMediaUrl(c.kind==='product'?c.product.imageUrl:c.imageUrl,hostname));
 if(!media.every(Boolean))throw new Error('Every visual card must have a usable image');
 const cardButtons=(c:VisualCard)=>c.buttons??part.buttons??[];
 const caption=(c:VisualCard)=>c.kind==='product'&&referencePhotoLabel(c.product,reply.replyLanguage??'en')?productPhotoCaption(c.caption,c.product,reply.replyLanguage??'en'):c.caption;
 if(part.cards.length===1){const c=part.cards[0],buttons=cardButtons(c).slice(0,3).map(bind),body=c.kind==='product'&&referencePhotoLabel(c.product,reply.replyLanguage??'en')?cardMessageText(fitText(part.text,1024-Array.from(caption(c)).length-1),caption(c)):cardMessageText(part.text,c.caption);
  if(!buttons.length)return {format:'image',actions,payload:{type:'image',image:{link:media[0],caption:body}}};
  return {format:'buttons',actions,payload:{type:'interactive',interactive:{type:'button',header:{type:'image',image:{link:media[0]}},body:{text:body},action:{buttons:buttons.map(b=>({type:'reply',reply:{id:b.id,title:b.label}}))}}}};
 }
 const counts=part.cards.map(c=>cardButtons(c).length);
 if(counts.some(n=>n<1||n>2)||new Set(counts).size!==1)throw new Error('Carousel cards require the same one or two native buttons');
 const cards=part.cards.map((c,index)=>({card_index:index,type:'cta_url',header:{type:'image',image:{link:media[index]}},body:{text:fitText(caption(c),160)},action:{buttons:cardButtons(c).map(bind).map(b=>({type:'quick_reply',quick_reply:{id:b.id,title:b.label}}))}}));
 return {format:'carousel',actions,payload:{type:'interactive',interactive:{type:'carousel',body:{text:fitText(part.text,1024)},action:{cards}}}};
}
