import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sellingBasisIssues} from '../packages/contracts/selling-basis.js';
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

test('quote validation rejects out-of-range quantities',()=>{
 const original=item({pricePaise:2500}),line=initialQuoteLines([original])[0]!;
 for(const quantity of ['101','-2','0.0001']){
  assert.deepEqual(quoteLineIssues({...line,quantity},original,[original]),['Enter a quantity from 0.001 to 100']);
 }
});

test('order review requires a selling unit compatible with the selected sale mode',()=>{
 const paint={name:'Paint 10 litre can',unit:'litre'};
 const policy={cutAllowed:false,continuousLengthAvailable:null};
 assert.match(sellingBasisIssues(paint).join(' '),/measured|sealed pack/);
 assert.deepEqual(sellingBasisIssues({...paint,sellingPolicy:{...policy,saleMode:'measured'}}),[]);
 assert.match(sellingBasisIssues({...paint,unit:'can',sellingPolicy:{...policy,saleMode:'measured'}}).join(' '),/selling unit/);
 assert.deepEqual(sellingBasisIssues({...paint,unit:'can',sellingPolicy:{...policy,saleMode:'pack'}}),[]);
});
