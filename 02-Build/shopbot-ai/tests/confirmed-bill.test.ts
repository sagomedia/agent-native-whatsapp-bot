import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {DraftLine} from '../packages/contracts/index.js';
import {confirmedPriceBill} from '../apps/server/src/services/confirmed-bill.js';
import {materializeVisualReply,INVOICE_ROWS_PER_PAGE} from '../apps/server/src/services/visual-images.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';

test('confirmed bills preserve seller prices, page every item, and send images without approval or payment claims',()=>{
 const lines:DraftLine[]=Array.from({length:INVOICE_ROWS_PER_PAGE+1},(_,i)=>({id:randomUUID(),name:`Item ${i+1}`,quantity:i===0?2:1,unit:'piece',pricePaise:2500,resolution:'matched',merchantConfirmed:{actor:'shop',at:'2026-01-01',free:false}}));
 const total=(lines.length+1)*2500;
 for(const language of ['en','ta','ta-Latn'] as const){
  const bill=confirmedPriceBill(language,'90f61663-98bd-4268-b819-c61d60d679a0',lines,total,'Shop');
  assert.equal(bill.parts?.length,2);assert.equal(bill.buttons?.length,0);assert.equal(bill.parts!.flatMap(p=>p.cards.flatMap(c=>c.kind==='product'?[]:c.billRows??[])).length,lines.length);
  const first=bill.parts![0].cards[0];assert.notEqual(first.kind,'product');if(first.kind==='product')throw Error();assert.equal(first.billRows![0].total,'₹50.00');assert.equal(first.invoiceType,'confirmed');
  const last=bill.parts![1].cards[0];assert.notEqual(last.kind,'product');if(last.kind==='product')throw Error();assert.match(last.total!,/₹250\.00/);assert.match(bill.text,/Item 9/);assert.doesNotMatch(bill.text,/paid|பணம் வந்த/i);
  const dir=mkdtempSync(join(tmpdir(),'confirmed-bill-'));try{const rendered=materializeVisualReply(bill,dir);for(const part of rendered.parts!){const payload=renderWhatsAppReply({...rendered,parts:[part]},randomUUID(),'example.test');assert.equal(payload.format,'image');assert.equal(payload.actions.length,0);}}finally{rmSync(dir,{recursive:true,force:true});}
 }
 assert.throws(()=>confirmedPriceBill('en',randomUUID(),lines,total+1),/matching total/);
});
