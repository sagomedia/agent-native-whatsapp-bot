import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {DraftLine} from '../packages/contracts/index.js';
import {initialQuoteLines,quoteLineIssues} from '../packages/contracts/owner-quote.js';

const item=(extra:Partial<DraftLine>={}):DraftLine=>({id:randomUUID(),query:'Store item',name:'Store item',quantity:2,unit:'piece',resolution:'unavailable',...extra});

test('existing indicative prices prefill as suggestions; missing and unconfirmed zero prices remain empty',()=>{
 const indicative=item({pricePaise:12500,catalogIssue:'price_unverified'});
 const [suggestion]=initialQuoteLines([indicative]);
 assert.equal(suggestion!.price,'125.00');assert.equal(suggestion!.estimated,true);
 assert.equal(initialQuoteLines([item()])[0]!.price,'');
 assert.equal(initialQuoteLines([item({pricePaise:0})])[0]!.price,'');
 assert.equal(initialQuoteLines([item({quantity:null})])[0]!.quantity,'');
});

test('complete store items can be sent without catalog matching or per-item review checkboxes',()=>{
 const original=item({pricePaise:2500,sourceUncertainty:['Check quantity']});
 const [line]=initialQuoteLines([original]);
 assert.equal(line!.sku,undefined);assert.equal(line!.manualConfirmed,false);
 assert.deepEqual(quoteLineIssues({...line!,reviewed:false},original,[original]),[]);
});

test('the simplified review still identifies missing facts and requires explicit free pricing',()=>{
 const original=item(),[line]=initialQuoteLines([original]);
 const missing={...line!,name:'',quantity:'0',unit:'',price:''};
 assert.equal(quoteLineIssues(missing,original,[original]).length,4);
 assert.equal(quoteLineIssues({...line!,price:'0',free:false},original,[original]).length,1);
 assert.deepEqual(quoteLineIssues({...line!,price:'0',free:true},original,[original]),[]);
});

import {quoteGuidance} from '../apps/dashboard/src/owner-quote-guidance.js';
test('quote guidance focuses invalid nonzero quantities and explicit free confirmation, not an unrelated price',()=>{
 const original=item({pricePaise:2500}),line=initialQuoteLines([original])[0]!;
 for(const quantity of ['101','-2','0.0001'])assert.equal(quoteGuidance({...line,quantity},original,[original])[0]!.field,'quantity');
 assert.equal(quoteGuidance({...line,price:'0',free:false},original,[original])[0]!.field,'free');
 assert.deepEqual(quoteGuidance({...line,price:'0',free:true},original,[original]),[]);
});
test('quote guidance asks pack or measured basis before send and identifies incompatible selling units',()=>{
 const original=item({name:'Paint 10 litre can',unit:'litre',pricePaise:2500}),line=initialQuoteLines([original])[0]!;
 assert.equal(quoteGuidance(line,original,[original])[0]!.field,'saleMode');
 assert.deepEqual(quoteGuidance({...line,saleMode:'measured'},original,[original]),[]);
 assert.equal(quoteGuidance({...line,saleMode:'measured',unit:'can'},original,[original])[0]!.field,'unit');
 assert.deepEqual(quoteGuidance({...line,saleMode:'pack',unit:'can'},original,[original]),[]);
});
