import test from 'node:test';
import assert from 'node:assert/strict';
import {amountToCount,catalogContent} from '../apps/server/src/services/quantity-evidence.js';
import type {Product,DraftLine} from '../packages/contracts/index.js';
import {sellingBasisIssues} from '../packages/contracts/selling-basis.js';
import {counterLine} from '../apps/server/src/services/counter-state.js';
const product:Product={sku:'POLICY-PIPE',name:'Fixture pipe',unit:'metre',quantityStep:.5,stock:100,pricePaise:10000,priceStatus:'priced',sellingUnitVerified:true,version:1,aliases:[],sellingPolicy:{cutAllowed:true,continuousLengthAvailable:12}};
const amount=(value:number,mode?:'continuous')=>({requestedAmount:{value,unit:'metre'},amountMode:mode}) as DraftLine;
test('merchant cutting permission, quantity increments and continuous length constrain amount conversion',()=>{
 assert.equal(amountToCount(amount(8,'continuous'),product),8);assert.equal(amountToCount(amount(13,'continuous'),product),null);assert.equal(amountToCount(amount(8.25),product),null);assert.equal(amountToCount(amount(8),{...product,sellingPolicy:{cutAllowed:false,continuousLengthAvailable:12}}),null);assert.equal(amountToCount(amount(8,'continuous'),{...product,sellingPolicy:{cutAllowed:true,continuousLengthAvailable:null}}),null);
});
test('explicit merchant pack contents take priority; pack quantity stays distinct from dimensions and loose-cut permission',()=>{
 const can:Product={...product,unit:'can',name:'Fixture 10L pack',quantityStep:1,sellingPolicy:{cutAllowed:false,continuousLengthAvailable:null,packContents:{value:10,unit:'litre'}}};assert.deepEqual(catalogContent(can),{value:10,unit:'litre'});assert.equal(amountToCount({requestedAmount:{value:20,unit:'litre'}} as DraftLine,can),2);assert.equal(amountToCount({requestedAmount:{value:5,unit:'litre'}} as DraftLine,can),null);
});
test('paint pack versus loose sale needs an explicit basis, and conflicting weight cannot become volume',()=>{
 const paint:Product={...product,name:'Asian Paints 10L',unit:'litre',sellingPolicy:undefined};
 assert.match(sellingBasisIssues(paint).join(' '),/measured\/loose/);
 assert.match(sellingBasisIssues({...paint,name:'Solvent 500ml'}).join(' '),/measured\/loose/);
 assert.deepEqual(sellingBasisIssues({...paint,sellingPolicy:{saleMode:'measured',cutAllowed:false,continuousLengthAvailable:null}}),[]);
 assert.deepEqual(sellingBasisIssues({...paint,unit:'can',sellingPolicy:{saleMode:'pack',packContents:{value:10,unit:'litre'},cutAllowed:false,continuousLengthAvailable:null}}),[]);
 assert.match(sellingBasisIssues({...paint,name:'Paint 10kg',sellingPolicy:{saleMode:'measured',cutAllowed:false,continuousLengthAvailable:null}}).join(' '),/weight and volume/);
 assert.match(sellingBasisIssues({...paint,unit:'can',sellingPolicy:{saleMode:'pack',packContents:{value:5,unit:'litre'},cutAllowed:false,continuousLengthAvailable:null}}).join(' '),/label and recorded pack/);
 const line:DraftLine={id:'fixture',sku:paint.sku,name:paint.name,unit:paint.unit,quantity:1,pricePaise:paint.pricePaise,productVersion:paint.version,candidates:[paint],resolution:'matched'};
 assert.equal(counterLine(line).canQuote,false,'a legacy pack ambiguity remains unpriced until the merchant resolves it');
 assert.deepEqual(line.quantity,1,'validation never converts the count or edits the saved line');
});
