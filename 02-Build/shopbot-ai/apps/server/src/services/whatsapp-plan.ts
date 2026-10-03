import type {RichReply} from '../../../../packages/contracts/index.js';
export type WhatsAppCapabilities={serviceWindowOpen:boolean;catalogConnected:boolean;serviceRatePaise:number;allowMarketingCarousel:boolean;marketingOptIn?:boolean;approvedCarousels:{name:string;cardCount:number;ratePaise:number}[];maxPaisePerTurn:number};
export type WhatsAppPlan={format:'blocked'|'text'|'reply_buttons'|'list'|'single_product'|'multi_product'|'carousel_template';category:'service'|'marketing'|null;messageCount:0|1;estimatedPaise:number;reason:string;templateName?:string;cardCount?:number};
// No sender here: capability/budget planning for the future channel adapter.
// Never fan out a product list into one message per image or auto-page.
export function planWhatsAppReply(reply:RichReply,c:WhatsAppCapabilities):WhatsAppPlan {
  for(const n of [c.serviceRatePaise,c.maxPaisePerTurn,...c.approvedCarousels.map(t=>t.ratePaise)])if(!Number.isSafeInteger(n)||n<0)throw new Error('Verified nonnegative paise rates are required.');
  const cards=(reply.cards??[]).slice(0,10),count=cards.length;
  const carousel=c.allowMarketingCarousel&&c.marketingOptIn===true&&count>=2&&cards.every(card=>card.product.imageUrl)?c.approvedCarousels.filter(t=>t.name&&t.cardCount===count&&t.cardCount<=10&&t.ratePaise<=c.maxPaisePerTurn).sort((a,b)=>a.ratePaise-b.ratePaise)[0]:undefined;
  // Prefer requested conversational/catalog replies when available and cheaper.
  if(c.serviceWindowOpen&&c.serviceRatePaise<=c.maxPaisePerTurn&&(!carousel||c.serviceRatePaise<=carousel.ratePaise)) {
    const format=count?c.catalogConnected?(count===1?'single_product':'multi_product'):'list':reply.buttons?.length&&reply.buttons.length<=3?'reply_buttons':'text';
    return {format,category:'service',messageCount:1,estimatedPaise:c.serviceRatePaise,cardCount:count||undefined,reason:'One customer-requested reply; avoid an unnecessary marketing charge.'};
  }
  if(carousel)return {format:'carousel_template',category:'marketing',messageCount:1,estimatedPaise:carousel.ratePaise,templateName:carousel.name,cardCount:count,reason:'Approved marketing carousel with matching card count and explicit budget.'};
  return {format:'blocked',category:null,messageCount:0,estimatedPaise:0,reason:'No permitted format within the service window/template capabilities and budget. Do not split into paid messages.'};
}
