import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildProductCaption,fitText,productPhotoCaption} from '../packages/contracts/channel-text.js';
import {productPriceText} from '../packages/contracts/language.js';
import {customerCopy} from '../packages/contracts/customer-copy.js';
import {cardText,renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';
import {materializeVisualReply} from '../apps/server/src/services/visual-images.js';
import {upiAdvancePresentation,upiUri} from '../apps/server/src/services/upi-advance.js';
import type {ConversationState,Product,RichReply} from '../packages/contracts/index.js';

const product:Product={sku:'PIPE-20',name:'PVC pipe',unit:'piece',pricePaise:12500,stock:null,version:1,aliases:[],quantityStep:1,specifications:{size:'20 mm'},imageReference:true,imageUrl:'/catalog-images/reference/12345678-1234-1234-1234-123456789abc.jpg'};
const makeReply=(p:Product):RichReply=>({version:1,kind:'product_choices',text:'Choose a pipe',presentation:'carousel_preview',outboundMessages:1,replyLanguage:'ta',cards:[{product:p,label:'Choose',action:{id:'choose',type:'choose_product',sku:p.sku,expectedVersion:8}}]});

test('caption keeps actual identity, distinguishing variant, price and reference before long optional prose',()=>{
 for(const language of ['ta','ta-Latn','en'] as const){
  const caption=buildProductCaption(product,language,['கேட்டது '.repeat(200),'stock detail '.repeat(200)],2);
  assert.ok(Array.from(caption).length<=160);
  assert.ok(caption.startsWith('2. PVC pipe'));
  assert.ok(caption.includes(language==='ta'?'20 மி.மீ.':'20 mm'));
  assert.ok(caption.includes('₹125.00'));
  assert.ok(caption.endsWith(language==='ta'?'Reference படம்':'Reference photo'));
 }
 const caption=buildProductCaption({...product,name:'குழாய் '.repeat(100)},'ta',['optional '.repeat(100)]);
 assert.ok(Array.from(caption).length<=160);
 assert.ok(caption.includes('20 மி.மீ.'));
 assert.ok(caption.includes('₹125.00'));
 assert.ok(caption.endsWith('Reference படம்'));
});

test('long names retain the first count detail and advisory recorded-stock warning',()=>{
 const caption=buildProductCaption({...product,name:'Premium pipe '.repeat(100),stock:0},'ta',['எண்ணிக்கை: 5',productPriceText(product,'ta')]);
 assert.ok(caption.includes('எண்ணிக்கை: 5'));
 assert.ok(caption.includes('பதிவில் stock 0 · கடை சரிபார்க்கும்'));
 assert.ok(caption.includes('20 மி.மீ.'));
 assert.ok(caption.includes('₹125.00'));
 assert.equal(caption.split('₹125.00').length,2);
 assert.ok(caption.endsWith('Reference படம்'));
 assert.ok(Array.from(caption).length<=160);
});

test('unknown-price captions and native list rows never invent a zero-price offer',()=>{
 const unknown={...product,pricePaise:0,priceStatus:'confirm' as const,imageUrl:undefined};
 assert.equal(productPriceText(unknown,'ta'),'கடையில் சரிபார்த்து சொல்லப்படும்');
 const rich=makeReply(unknown),caption=cardText(rich.cards![0],rich);
 assert.ok(caption.includes('கடையில் சரிபார்த்து சொல்லப்படும்'));
 assert.ok(!caption.includes('₹0'));
 const result=renderWhatsAppReply(rich,'message','shop.example.test'),payload=result.payload as any;
 assert.equal(result.format,'list');
 assert.equal(payload.interactive.action.sections[0].rows[0].description,'கடையில் சரிபார்த்து சொல்லப்படும்');
 assert.deepEqual(result.actions[0].event,rich.cards![0].action);
 assert.ok(productPriceText({...unknown,priceStatus:'free'},'ta').includes('₹0.00'));
});

test('grapheme truncation handles zero budgets and reserves exactly one full disclosure',()=>{
 assert.equal(fitText('தமிழ்',0),'');
 assert.equal(fitText('தமிழ்',-10),'');
 for(let limit=1;limit<180;limit++){
  const caption=productPhotoCaption('தமிழ் '.repeat(100),product,'ta',limit);
  assert.ok(Array.from(caption).length<=limit,`${limit}: ${caption}`);
  if(limit>=Array.from('Reference படம்').length)assert.ok(caption.endsWith('Reference படம்'));
 }
 const caption=productPhotoCaption(buildProductCaption(product,'ta'),product,'ta');
 assert.equal(caption.split('Reference படம்').length,2);
});

test('missing-photo fallback renders only the selected SKU name and size with accessible absence text',()=>{
 const directory=mkdtempSync(join(tmpdir(),'compact-fallback-'));
 try{
  const rich:RichReply={version:1,kind:'text',text:'',presentation:'single_product',outboundMessages:1,replyLanguage:'ta',parts:[{id:'part',text:'',cards:[{kind:'product',product:{...product,imageReference:undefined,imageUrl:undefined},caption:buildProductCaption({...product,imageReference:undefined},'ta')}]}]};
  const materialized=materializeVisualReply(rich,directory),card=materialized.parts![0].cards[0];
  assert.equal(card.kind,'product');if(card.kind!=='product')return;
  assert.equal(card.product.sku,product.sku);
  assert.ok(card.caption.includes('PVC pipe'));
  assert.ok(card.caption.includes('20 மி.மீ.'));
  assert.ok(card.caption.includes('படம் இல்லை'));
  assert.match(card.product.imageUrl!,/^\/catalog-images\/messages\/[a-f0-9]{64}\.png$/);
  assert.equal(readFileSync(join(directory,card.product.imageUrl!.split('/').at(-1)!)).subarray(1,4).toString(),'PNG');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('compact QR payload preserves recipient, same-phone link, gated demo choice and unverified payment state',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'compact-upi-')),previous=process.env.VISUAL_MEDIA_DIR;
 process.env.VISUAL_MEDIA_DIR=directory;
 try{
  const state={lastRequestId:'12345678-1234-1234-1234-123456789abc',replyLanguage:'ta',version:12} as ConversationState;
  const row={id:'advance-id',state:'requested',payee_name:'Selected Shop',payee_vpa:'shop@bank',upi_uri:upiUri({name:'Selected Shop',vpa:'shop@bank'},'Order123')};
  const standard=await upiAdvancePresentation(state,row,'shop.example.test');
  assert.ok(standard.text.includes('₹10 advance pay பண்ணி order confirm பண்ணுங்க.'));
  assert.ok(standard.text.includes('https://shop.example.test/pay/advance-id'));
  assert.ok(standard.text.includes('Selected Shop'));
  assert.ok(standard.text.includes('shop@bank'));
  assert.ok(!standard.text.includes('demo'));
  assert.deepEqual(standard.buttons!.map(b=>b.event.type),['payment_claim']);
  assert.equal((standard.buttons![0].event as any).expectedVersion,12);
  const demo=await upiAdvancePresentation(state,row,'shop.example.test',true);
  assert.deepEqual(demo.buttons!.map(b=>b.event.type),['payment_claim','pay_at_shop']);
  const claimed=await upiAdvancePresentation(state,{...row,state:'claimed'},'shop.example.test',true);
  assert.ok(claimed.text.includes('Payment check பண்ணிட்டு சொல்றோம். மறுபடியும் pay பண்ண வேண்டாம்.'));
  assert.ok(!claimed.text.includes('வந்திருக்கு'));
  assert.deepEqual(claimed.buttons,[]);
  const payload=renderWhatsAppReply(standard,'payment-message','shop.example.test').payload as any;
  assert.equal(payload.interactive.body.text,standard.text);
  assert.equal(payload.interactive.body.text.split('UPI ID:').length,2);
  assert.ok(customerCopy('demoPayAtShop','ta').includes('₹10 advance வாங்கல'));
 }finally{
  if(previous===undefined)delete process.env.VISUAL_MEDIA_DIR;else process.env.VISUAL_MEDIA_DIR=previous;
  rmSync(directory,{recursive:true,force:true});
 }
});
