import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {DraftLine} from '../packages/contracts/index.js';
import {finalQuotePresentation} from '../apps/server/src/services/quote-presentation.js';
import {materializeVisualReply,visualSvg} from '../apps/server/src/services/visual-images.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';

const confirmed={actor:'fixture-owner',at:'2026-10-16T00:00:00.000Z',free:false};
const line=(name:string,quantity:number,unit:string,pricePaise:number):DraftLine=>({id:randomUUID(),name,quantity,unit,pricePaise,resolution:'matched',merchantConfirmed:confirmed});
test('the final shop invoice explains 1210 to 1570, preserves the 10L can basis and uses only verified advance facts',()=>{
 const lines=[line('PVC pipe',2,'piece',38000),line('Garden hose 10m',1,'piece',45000),line('M-Seal 90g',1,'pack',5500),{...line('Paint 10L',1,'can',25000),packSize:{value:10,unit:'litre'}},line('Cutting wheel',1,'piece',5500)];
 const previous=lines.map((l,i)=>i<2?l:{...l,merchantConfirmed:undefined,pricePaise:undefined,resolution:'unavailable' as const,catalogIssue:'price_unverified' as const});
 const quote={id:randomUUID(),requestId:randomUUID(),version:7,lines,previousLines:previous,previousTotalPaise:121000,totalPaise:157000,advancePaise:0,storeName:'Fixture shop'};
 const rich=materializeVisualReply(finalQuotePresentation('en',quote));
 assert.match(rich.text,/Earlier known subtotal: ₹1,210/);assert.match(rich.text,/Difference: \+₹360/);assert.match(rich.text,/Total: ₹1,570/);assert.match(rich.text,/Verified advance: ₹0/);
 const card=rich.parts![0].cards[0];assert.ok(card.kind!=='product');assert.equal(card.invoiceType,'quote');assert.match(card.billRows![3].packSize,/10 litre/);assert.equal(card.billRows![3].count,'1 can');assert.equal(card.billRows![3].total,'₹250.00');assert.match(visualSvg(card),/Shop quote/);assert.doesNotMatch(visualSvg(card),/Estimate only/);
 assert.equal(rich.buttons![0].event.type,'confirm_order_quote');assert.equal(rich.buttons![1].event.type,'shopping_action');assert.equal(rich.buttons![1].event.type==='shopping_action'&&rich.buttons![1].event.action,'edit_quote');
 assert.equal(renderWhatsAppReply({...rich,parts:[rich.parts![0]]},randomUUID(),'fixture.example').format,'buttons');
 const paid=finalQuotePresentation('en',{...quote,advancePaise:1000});assert.match(paid.text,/Verified advance: ₹10/);assert.match(paid.text,/Remaining balance: ₹1,560/);
});
test('a multi-page shop quote keeps all rows and binds approval only to its final image, even if the total is unchanged',()=>{
 const lines=Array.from({length:19},(_,i)=>line('Quoted product '+i,1,'pack',10000));
 const rich=materializeVisualReply(finalQuotePresentation('ta',{id:randomUUID(),requestId:randomUUID(),version:3,lines,previousLines:lines,previousTotalPaise:190000,totalPaise:190000,advancePaise:0}));
 assert.equal(rich.parts!.length,3);assert.equal(rich.parts!.flatMap(p=>p.cards.flatMap(c=>c.kind==='product'?[]:c.billRows??[])).length,19);
 for(const [i,part] of rich.parts!.entries()){
  const rendered=renderWhatsAppReply({...rich,parts:[part]},randomUUID(),'fixture.example');assert.equal(rendered.actions.some(a=>a.event.type==='confirm_order_quote'),i===2);
 }
 assert.equal(rich.buttons![0].event.type,'confirm_order_quote','same total does not eliminate meaningful quote consent');
});
test('an incomplete or inconsistent final quote cannot produce a misleading invoice',()=>{
 const lines=[line('Fixture pack',1,'pack',5000)],quote={id:randomUUID(),requestId:randomUUID(),version:1,lines,previousLines:[],previousTotalPaise:0,totalPaise:5000,advancePaise:0};
 assert.throws(()=>finalQuotePresentation('en',{...quote,totalPaise:1}),/matching total/);
 assert.throws(()=>finalQuotePresentation('en',{...quote,lines:[{...lines[0],quantity:null}]}),/every priced line/);
 assert.doesNotMatch(finalQuotePresentation('en',quote).text,/Earlier known subtotal: ₹0/);
});
