import {categoryState} from './catalog-type-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {ConversationState,DraftLine,Product} from '../packages/contracts/index.js';
import {estimateLines,estimatePendingSummary,estimateTotalText} from '../apps/server/src/services/order-estimate.js';
import {visualBill,visualProductReview,visualReply} from '../apps/server/src/services/visual-ordering.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';
import {finalQuotePresentation} from '../apps/server/src/services/quote-presentation.js';
import {indicativeLineEstimate,indicativeEstimate} from '../apps/server/src/services/order-estimate.js';

const product:Product={sku:'TAPE',name:'PTFE tape',unit:'roll',pricePaise:2000,stock:20,version:1,aliases:[],quantityStep:1,imageUrl:'/demo-images/H08.jpg',sellingUnitVerified:true};
const line=(p:Product,quantity:number|null=1):DraftLine=>({id:randomUUID(),sku:p.sku,name:p.name,query:p.name,quantity,resolution:quantity===null?'needs_quantity':'matched',pricePaise:p.pricePaise,unit:p.unit,productVersion:p.version,candidates:[p]});
function state(draft:DraftLine[]):ConversationState{return {version:5,replyLanguage:'ta',visualOrdering:true,allowPartialReview:true,draft,pending:null,fulfillment:'pickup',lastRequestId:null};}

test('a wholly unpriced cart never presents a zero estimate or repeats a full bill beside its image',()=>{
 const unknown={...product,pricePaise:0,priceStatus:'confirm' as const};
 const s=state(Array.from({length:8},(_,n)=>line({...unknown,sku:'UNKNOWN'+n,name:'பொருள் '+n},n+1)));
 s.pending={kind:'products',id:randomUUID(),version:s.version,expiresAt:new Date(Date.now()+60000).toISOString(),remaining:8,groups:s.draft.map(l=>({lineId:l.id,products:l.candidates!}))};
 const review=visualProductReview(s),guide=review.parts![0].cards[0];
 assert.equal(guide.kind,'instruction');if(guide.kind!=='instruction')return;
 assert.doesNotMatch(guide.lines.join('\n'),/₹0/);
 assert.match(guide.lines.join('\n'),/8 விலை/);
 const bill=visualBill(s),card=bill.parts![0].cards[0];
 assert.equal(bill.parts!.length,1);assert.equal(card.kind,'bill');if(card.kind!=='bill')return;
 assert.equal(card.billRows!.length,8);assert.ok(card.billRows!.every(row=>row.unitPrice==='—'));
 assert.doesNotMatch(card.total!,/₹0/);assert.match(card.total!,/கடையில்/);
 assert.ok(bill.accessibleText!.includes('பொருள் 7'));
 assert.ok(!bill.parts![0].text.includes('பொருள் 7'),'only the invoice contains the full item list');
 const rendered=renderWhatsAppReply({...bill,parts:[{...bill.parts![0],cards:[{...card,imageUrl:'/catalog-images/messages/'+'a'.repeat(64)+'.png'}]}]},randomUUID(),'shop.example.test');
 assert.equal(rendered.format,'image');assert.ok(!JSON.stringify(rendered.payload).includes('பொருள் 7'));
});

test('an excluded count or identity is not mislabeled as only an unknown price',()=>{
 const quantity=line(product,null),missing:DraftLine={id:randomUUID(),name:'unknown pipe',query:'unknown pipe',quantity:2,resolution:'unavailable'};
 const unknown=line({...product,sku:'UNKNOWN',pricePaise:0,priceStatus:'confirm'}),s=state([line(product,2),quantity,missing,unknown]);
 assert.equal(estimateLines(s.draft).knownSubtotalPaise,4000);
 const summary=estimatePendingSummary(s)!;
 assert.match(summary,/1 எண்ணிக்கை/);assert.match(summary,/1 பொருள்/);assert.match(summary,/1 விலை/);
 assert.match(estimateTotalText(s),/₹40.00/);
 const card=visualBill(s).parts![0].cards[0];assert.equal(card.kind,'bill');if(card.kind!=='bill')return;
 assert.match(card.lines.join('\n'),/எண்ணிக்கை/);assert.match(card.lines.join('\n'),/பொருள் தேர்வு/);
 assert.doesNotMatch(card.lines.join('\n'),/3.*விலை/);
 assert.equal(card.billRows![1].total,'எண்ணிக்கை தேவை');
 const bill=visualBill(s);assert.match(bill.parts![0].text,/1 எண்ணிக்கை சொல்லணும்/);
 assert.match(bill.accessibleText!,/எண்ணிக்கை தேவை/);
 const rendered=renderWhatsAppReply({...bill,parts:[{...bill.parts![0],cards:[{...card,imageUrl:'/catalog-images/messages/'+'a'.repeat(64)+'.png'}]}]},randomUUID(),'shop.example.test');
 assert.match(JSON.stringify(rendered.payload),/எண்ணிக்கை சொல்லணும்/);
});

test('product choices do not display the model’s quantity question',()=>{
 const a={...product,sku:'WHITE-A',name:'White paint A',unit:'can'},b={...a,sku:'WHITE-B',name:'White paint B'};
 const item:DraftLine={id:randomUUID(),name:'white paint',query:'white paint',quantity:null,resolution:'needs_choice',candidates:[a,b]};
 const s=state([item]);s.pending={kind:'products',id:randomUUID(),version:s.version,expiresAt:new Date(Date.now()+60000).toISOString(),remaining:1,groups:[{lineId:item.id,products:[a,b]}]};
 for(const question of ['ஒயிட் கலர் பெயிண்ட் எத்தனை பாக்கெட் அல்லது கேன் வேணும்?','How many cans do you need?','Eththanai can venum?']){
  const result=visualProductReview(s,false,question);assert.equal(result.clarificationReason,'product_or_specification');
  assert.doesNotMatch(result.parts![0].text,/எத்தனை|how many|eththanai/i);
  assert.match(result.parts![0].text,/எது வேணும்/);
  const cards=result.parts![0].cards;assert.equal(cards.length,2);assert.ok(cards.every(c=>c.kind==='product'&&c.buttons?.some(b=>b.event.type==='select_product')));
 }
});

test('inventory category clarification asks one question with actual bound choices',()=>{
 const l:DraftLine={id:randomUUID(),name:'pipe',query:'pipe',quantity:2,resolution:'unavailable'},s=categoryState(state([l]));
 const questionId=s.pending!.id;
 const reply=visualReply({version:1,kind:'text',text:'Choose category',presentation:'text',outboundMessages:1},s);
 assert.match(reply.text,/வகையைத் தேர்வு செய்யுங்கள்/);assert.equal(reply.parts?.[0].cards.length,2);
 const choices=reply.parts![0].cards.flatMap(card=>card.buttons??[]);assert.equal(choices.length,2);
 for(const button of choices){assert.equal(button.event.type,'refine_search');if(button.event.type==='refine_search'){assert.equal(button.event.lineId,l.id);assert.equal(button.event.batchId,questionId);}}
 assert.deepEqual(choices.map(b=>b.event.type==='refine_search'?b.event.value:undefined),['pvc-pipes','hose']);
});

test('indicative invoice amounts stay approximate and cannot satisfy final shop quote checks',()=>{
 const p:Product={...product,pricePaise:0,priceStatus:'confirm',indicativePrice:{pricePaise:35000,lowPaise:25000,highPaise:50000,unit:'roll',currency:'INR',asOf:'2026-10-18',source:'model-low-indicative',basis:'category_estimate',generation:{model:'gpt-6',requestedModel:'gpt-6-luna',effort:'low',inputHash:'a'.repeat(64),proposalHash:'b'.repeat(64)}}};
 const approximate=line(p,2),s=state([line(product),approximate]);
 assert.equal(estimateLines(s.draft).knownSubtotalPaise,2000);assert.equal(estimateLines(s.draft).complete,false);
 assert.equal(indicativeEstimate(s.draft).subtotalPaise,72000);assert.equal(indicativeLineEstimate(approximate)!.totalPaise,70000);
 const card=visualBill(s).parts![0].cards[0];assert.equal(card.kind,'bill');if(card.kind!=='bill')return;
 assert.equal(card.billRows![1].unitPrice,'~₹350.00');assert.equal(card.billRows![1].total,'~₹700.00');
 assert.match(card.total!,/சுமார்: ₹720.00/);assert.match(card.footer!,/உத்தேச விலை/);
 assert.throws(()=>finalQuotePresentation('ta',{id:randomUUID(),requestId:randomUUID(),version:1,lines:s.draft,totalPaise:72000,previousLines:[],previousTotalPaise:0,advancePaise:0}),/final quote/);
 for(const bad of [{...approximate,quantity:null},{...approximate,unit:'box'},{...approximate,resolution:'needs_unit' as const},{...approximate,requestedAmount:{value:10,unit:'metre'}}])assert.equal(indicativeLineEstimate(bad),undefined);
});
