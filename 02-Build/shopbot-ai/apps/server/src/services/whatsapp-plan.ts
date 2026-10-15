import {productMediaUrl} from './whatsapp-reply.js';
import type {RichReply} from '../../../../packages/contracts/index.js';
export type WhatsAppCapabilities={serviceWindowOpen:boolean;mediaCarouselEnabled?:boolean;catalogConnected:boolean;serviceRatePaise:number;serviceRateMicroInr?:number;allowMarketingCarousel:boolean;marketingOptIn?:boolean;approvedCarousels:{name:string;cardCount:number;ratePaise:number;rateMicroInr?:number}[];maxPaisePerTurn:number;maxMicroInrPerTurn?:number};
export type WhatsAppPlan={format:'blocked'|'text'|'reply_buttons'|'list'|'single_product'|'multi_product'|'media_carousel'|'image_buttons'|'carousel_template';category:'service'|'marketing'|null;messageCount:number;estimatedPaise:number;estimatedMicroInr?:number;reason:string;templateName?:string;cardCount?:number};
function micros(paise:number,value?:number) {
  if(value===undefined&&(!Number.isSafeInteger(paise)||paise<0))throw new Error('Verified nonnegative integer paise rates are required.');
  const result=value??paise*10000;
  if(!Number.isSafeInteger(result)||result<0)throw new Error('Verified nonnegative integer micro-INR rates are required.');
  return result;
}
// Estimate gross configured delivery costs. Signed delivery receipts and account
// analytics determine free/billable status; this planner never spends a guessed
// monthly allowance. Order prices remain integer paise in their own contract.
export function planWhatsAppReply(reply:RichReply,c:WhatsAppCapabilities):WhatsAppPlan {
  const service=micros(c.serviceRatePaise,c.serviceRateMicroInr),budget=micros(c.maxPaisePerTurn,c.maxMicroInrPerTurn);
  const templates=c.approvedCarousels.map(t=>({...t,micros:micros(t.ratePaise,t.rateMicroInr)}));
  const finish=(plan:Omit<WhatsAppPlan,'estimatedPaise'|'estimatedMicroInr'>,amount=0):WhatsAppPlan=>({...plan,estimatedMicroInr:amount,estimatedPaise:amount/10000});
  const blocked=(reason:string)=>finish({format:'blocked',category:null,messageCount:0,reason});
  if(reply.parts){
    const count=reply.parts.length,cards=reply.parts.reduce((sum,p)=>sum+p.cards.length,0),amount=BigInt(count)*BigInt(service);
    if(!c.serviceWindowOpen||amount>BigInt(budget)||reply.parts.some(p=>!p.cards.length||p.cards.length>10))return blocked('Ordered review exceeds the configured window, card limit or delivery budget.');
    return finish({format:cards>count?'media_carousel':'image_buttons',category:'service',messageCount:count,cardCount:cards,reason:'Configured estimate for complete ordered image groups; actual charges require delivery pricing.'},Number(amount));
  }
  const cards=reply.cards??[],count=cards.length;
  if(count>10)return blocked('More than ten cards require narrowing; never silently drop or fan out choices.');
  const visual=cards.every(card=>productMediaUrl(card.product.imageUrl,'catalog.example.test')&&(card.action||reply.buttons?.length));
  const carousel=c.allowMarketingCarousel&&c.marketingOptIn===true&&count>=2&&cards.every(card=>card.product.imageUrl)?templates.filter(t=>t.name&&t.cardCount===count&&t.cardCount<=10&&t.micros<=budget).sort((a,b)=>a.micros-b.micros)[0]:undefined;
  if(c.serviceWindowOpen&&service<=budget&&(!carousel||service<=carousel.micros)){
    const format=count?c.mediaCarouselEnabled!==false&&visual?(count===1?'image_buttons':'media_carousel'):c.catalogConnected?(count===1?'single_product':'multi_product'):'list':reply.buttons?.length&&reply.buttons.length<=3?'reply_buttons':'text';
    return finish({format,category:'service',messageCount:1,cardCount:count||undefined,reason:'One customer-requested reply; avoid an unnecessary marketing charge.'},service);
  }
  if(carousel)return finish({format:'carousel_template',category:'marketing',messageCount:1,templateName:carousel.name,cardCount:count,reason:'Approved marketing carousel with matching card count and explicit budget.'},carousel.micros);
  return blocked('No permitted format within the service window/template capabilities and budget. Do not split into paid messages.');
}
