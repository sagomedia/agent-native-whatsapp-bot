import test from 'node:test';
import assert from 'node:assert/strict';
import type {DraftLine,Product} from '../packages/contracts/index.js';
import {originalEstimateSnapshot} from '../apps/server/src/services/order-estimate.js';

const confirmed={actor:'fixture-owner',at:'2026-10-16T00:00:00.000Z',free:false};
const product:Product={sku:'SNAPSHOT',name:'Fixture item',unit:'piece',pricePaise:0,priceStatus:'confirm',stock:null,version:1,aliases:[],quantityStep:1,indicativePrice:{pricePaise:12500,lowPaise:10000,highPaise:15000,unit:'piece',currency:'INR',asOf:'2026-10-18',source:'model-low-indicative',generation:{model:'fixture-model',effort:'low',inputHash:'a'.repeat(64),proposalHash:'b'.repeat(64)}}};
function item(id:string,patch:Partial<DraftLine>={}):DraftLine {
 return {id,sku:product.sku,name:product.name,quantity:2,unit:product.unit,pricePaise:0,productVersion:1,resolution:'matched',candidates:[structuredClone(product)],...patch};
}

test('original estimate preserves frozen indicative prices after catalog and effective order changes',()=>{
 const catalog=structuredClone(product),originalLines=JSON.parse(JSON.stringify([item('original',{candidates:[catalog]})])) as DraftLine[];
 const before=structuredClone(originalLines);
 catalog.pricePaise=99000;catalog.priceStatus='priced';catalog.version=2;catalog.indicativePrice=undefined;
 const effectiveLines=[item('original',{pricePaise:99000,candidates:[catalog],productVersion:2,merchantConfirmed:confirmed})];
 assert.deepEqual(originalEstimateSnapshot(originalLines),{lines:[{id:'original',pricePaise:12500,totalPaise:25000,approximate:true}],subtotalPaise:25000,unpriced:0,approximate:true});
 assert.equal(originalEstimateSnapshot(effectiveLines).subtotalPaise,198000);
 assert.deepEqual(originalLines,before,'display reconstruction must not rewrite historical line data');
});

test('missing and unconfirmed zero prices remain pending while explicitly free items are exact',()=>{
 const lines=[item('zero',{candidates:[]}),item('missing',{pricePaise:undefined,candidates:[]}),item('free',{candidates:[],merchantConfirmed:{...confirmed,free:true}}),item('paid',{pricePaise:1750,candidates:[],merchantConfirmed:confirmed})];
 assert.deepEqual(originalEstimateSnapshot(lines),{lines:[{id:'zero',approximate:false},{id:'missing',approximate:false},{id:'free',pricePaise:0,totalPaise:0,approximate:false},{id:'paid',pricePaise:1750,totalPaise:3500,approximate:false}],subtotalPaise:3500,unpriced:2,approximate:false});
});

test('mixed estimates include only eligible exact and indicative lines in their subtotal',()=>{
 const freeProduct={...product,priceStatus:'free' as const,indicativePrice:undefined};
 const lines=[item('approximate'),item('free-catalog',{candidates:[freeProduct]}),item('unknown-quantity',{quantity:null}),item('wrong-unit',{unit:'box'}),item('unverified-positive',{pricePaise:5000,candidates:[]})];
 const result=originalEstimateSnapshot(lines);
 assert.equal(result.subtotalPaise,25000);assert.equal(result.unpriced,3);assert.equal(result.approximate,true);
 assert.deepEqual(result.lines[1],{id:'free-catalog',pricePaise:0,totalPaise:0,approximate:false});
 for(const line of result.lines.slice(2)){assert.equal(line.pricePaise,undefined);assert.equal(line.totalPaise,undefined);}
});

test('empty submitted estimates have no priced lines',()=>{
 assert.deepEqual(originalEstimateSnapshot([]),{lines:[],subtotalPaise:0,unpriced:0,approximate:false});
});
