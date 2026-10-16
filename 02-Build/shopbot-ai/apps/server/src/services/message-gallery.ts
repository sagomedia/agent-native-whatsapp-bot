import {presentReply,plainReply} from './replies.js';
import {say} from '../../../../packages/contracts/language.js';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {ConversationState,DraftLine,Product,RichReply,OrderRequest} from '../../../../packages/contracts/index.js';
import type {ReplyLanguage} from '../../../../packages/contracts/language.js';
import {customerCopy} from '../../../../packages/contracts/customer-copy.js';
import {visualReply,visualProductReview,visualBill,visualStatus,returningReply} from './visual-ordering.js';
import {finalQuotePresentation} from './quote-presentation.js';
import {materializeVisualReply} from './visual-images.js';
import {upiAdvancePresentation,upiUri} from './upi-advance.js';
import {textPresentation} from './message-presentation.js';

export type GalleryEntry={id:string;label:string;group:string;note:string;reply:RichReply};
const cache=new Map<string,Promise<GalleryEntry[]>>();
/** Public demo fixtures only. No pool, provider, customer records or live transaction inputs. */
export function messageGallery(language:ReplyLanguage):Promise<GalleryEntry[]> {
 let result=cache.get(language);if(!result){result=build(language);cache.set(language,result);result.catch(()=>cache.delete(language));}return result;
}
async function build(language:ReplyLanguage){
 const pack=JSON.parse(await readFile('resources/catalog/ksmc-demo/catalog.json','utf8'));
 if(pack.demoOnly!==true)throw new Error('Gallery requires synthetic demo fixtures.');
 const products:Product[]=pack.products.filter((p:Product)=>['H01','H02','H21'].includes(p.sku)).map((p:Product)=>({...p,quantityStep:1,priceStatus:'priced',sellingUnitVerified:true,imageUrl:'/demo-images/'+p.sku+'.jpg'}));
 const pipe=products.find(p=>p.sku==='H02')!,seal=products.find(p=>p.sku==='H21')!;
 const line=(p:Product,quantity:number|null):DraftLine=>({id:randomUUID(),sku:p.sku,name:p.name,quantity,unit:p.unit,pricePaise:p.pricePaise,productVersion:p.version,candidates:[p],resolution:quantity===null?'needs_quantity':'matched'});
 const lines=[line(pipe,2),line(seal,1)],unknown:DraftLine={id:randomUUID(),name:'White wall paint · 10L can',quantity:1,unit:'can',resolution:'unavailable',shopCheckDeferred:true};
 const state:ConversationState={version:1,draft:lines,pending:null,fulfillment:'pickup',lastRequestId:null,visualOrdering:true,replyLanguage:language,requireProductConfirmation:true,allowPartialReview:true};
 const entries:GalleryEntry[]=[];
 const add=(id:string,label:string,group:string,reply:RichReply,note='')=>entries.push({id,label,group,note,reply:materializeVisualReply({...reply,readOnly:true,replyLanguage:language,storeName:'Sample shop · preview'})});
 add('welcome','Welcome & voice invitation','Shopping',visualReply(plainReply('Hi!'), {...state,draft:[]}));
 const missing=line(seal,null);
 add('quantity','Only the missing quantity','Shopping',visualReply({version:1,kind:'text',presentation:'text',outboundMessages:1,text:''},{...state,draft:[lines[0],missing],pending:{kind:'question',id:randomUUID(),lineId:missing.id,version:1} as ConversationState['pending']}),'No repeated product carousel for a missing count.');
 const choiceLine:DraftLine={...lines[0],sku:undefined,quantity:null,resolution:'needs_choice',candidates:products.filter(p=>p.sku!=='H21')};
 const choiceState:ConversationState={...state,draft:[choiceLine],pending:{kind:'question',id:randomUUID(),lineId:choiceLine.id,version:1}};
 add('compare','Compare product photos','Shopping',visualReply(presentReply({state:choiceState,message:''},choiceState),choiceState));
 const review={...state,pending:{kind:'products',id:randomUUID(),version:1,expiresAt:new Date(Date.now()+3600000).toISOString(),groups:lines.map(l=>({lineId:l.id,products:l.candidates!})),remaining:0}} as ConversationState;
 add('cart','Product review & outside action','Shopping',visualProductReview(review));
 add('compact-cart','Compact cart after an unchanged edit','Shopping',visualProductReview(review,true));
 add('missing-price','Unlisted item kept without a price','Checkout',visualBill({...state,draft:[...lines,unknown]}),'Known subtotal excludes the unpriced item.');
 add('estimate','Complete estimate invoice','Checkout',visualBill(state));
 const quoted=lines.map(l=>({...l,merchantConfirmed:{actor:'sample-owner',at:'2026-10-16T00:00:00.000Z',free:false}}));
 add('final-quote','Changed shop bill & customer approval','Checkout',finalQuotePresentation(language,{id:randomUUID(),requestId:randomUUID(),version:1,lines:quoted.map((l,i)=>({...l,pricePaise:l.pricePaise!+(i===1?1000:0)})),totalPaise:82500,previousLines:lines,previousTotalPaise:81500,advancePaise:0,storeName:'Sample shop'}));
 const requestId=randomUUID(),request={id:requestId,acceptance:'awaiting_approval',payment:'pending',fulfillment:'awaiting_approval',totalPaise:81500,lines} as OrderRequest;
 const submitted={...state,lastRequestId:requestId};
 for(const demo of [true,false]){
  const sample={id:randomUUID(),state:'requested',payee_name:'SAMPLE ONLY - DO NOT PAY',payee_vpa:'preview.only@invalid',upi_uri:upiUri({name:'SAMPLE ONLY - DO NOT PAY',vpa:'preview.only@invalid'},'SAMPLEONLY')};
  add(demo?'demo-qr':'advance-qr',demo?'₹10 QR · demo pay-at-shop option':'₹10 QR · standard advance','Checkout',await upiAdvancePresentation(submitted,sample,'preview.example.test',demo),'Sample QR only. Invalid recipient; do not pay. This preview cannot send messages or create orders.');
 }
 for(const [id,label,acceptance,fulfillment] of [['waiting','Sent · waiting for shop','awaiting_approval','awaiting_approval'],['packing','Accepted · preparing','accepted','preparing'],['ready','Ready for pickup','accepted','ready_for_pickup'],['collected','Collected','accepted','collected'],['cancelled','Cancelled','accepted','cancelled']] as const)add(id,label,'After order',visualStatus(submitted,{...request,acceptance,fulfillment}));
 add('amendment','Change requested · original order kept','After order',textPresentation(customerCopy('amendmentPending',language)));
 add('refund','Advance received · refund needed','After order',textPresentation(customerCopy('refundNeeded',language)));
 add('returning','Resume a saved list','Recovery',returningReply(state));
 add('voice-retry','Unclear voice recovery','Recovery',textPresentation(customerCopy('voiceUnclear',language)));
 add('media-error','Recording processing failure','Recovery',textPresentation(customerCopy('voiceProcessing',language),[{label:say(language,'Try again','மீண்டும் முயல்','Marubadi try'),event:{id:randomUUID(),type:'retry_voice',mediaId:randomUUID(),expectedVersion:1}},{label:say(language,'Talk to shop','கடையிடம் பேசு','Kadaiyila pesu'),event:{id:randomUUID(),type:'shopping_action',action:'handoff',expectedVersion:1}}]));
 add('stale','Old button / changed list','Recovery',textPresentation(customerCopy('stale',language)));
 return entries;
}
