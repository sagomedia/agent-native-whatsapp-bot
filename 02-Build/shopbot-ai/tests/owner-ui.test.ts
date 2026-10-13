import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activeRequest,requestLabel,replyWindowOpen,matchesProduct,inventoryMatches,stockLabel,type OwnerProduct} from '../apps/dashboard/src/owner-model.js';
const product:OwnerProduct={sku:'PIPE-1',name:'1 inch PVC pipe',localNames:{ta:'பிவிசி குழாய்','ta-Latn':'pvc kulai'},brand:'Blueguard',unit:'piece',pricePaise:18000,stock:null,version:1,aliases:['white pipe'],quantityStep:1,active:true,origin:'owner',inventoryUpdatedAt:null};
test('inventory can find English, Tamil and customer spellings without confusing unknown stock with zero',()=>{
 for(const query of ['குழாய்','kulai','blueguard','whit pipe','PIPE-1'])assert.equal(matchesProduct(product,query),true,query);
 assert.equal(matchesProduct(product,'hammer'),false);
 assert.equal(inventoryMatches(product,'visible','unknown'),true);
 assert.equal(inventoryMatches(product,'visible','out'),false);
 assert.equal(inventoryMatches({...product,stock:0},'visible','unknown'),false);
 assert.equal(inventoryMatches({...product,stock:0},'visible','out'),true);
 assert.equal(inventoryMatches({...product,active:false},'visible',''),false);
 assert.equal(stockLabel(product),'Stock not entered');
 assert.equal(stockLabel({...product,stock:0}),'Out of stock');
});
test('request queue keeps accepted pickups active until collection or cancellation and labels their actual stage',()=>{
 const stages=[['awaiting_approval','awaiting_approval',true,'New'],['accepted','preparing',true,'Preparing'],['accepted','ready_for_pickup',true,'Ready for pickup'],['accepted','collected',false,'Collected'],['accepted','cancelled',false,'Cancelled'],['rejected','awaiting_approval',false,'Declined']] as const;
 for(const [acceptance,fulfillment,active,label] of stages){assert.equal(activeRequest({acceptance,fulfillment}),active);assert.equal(requestLabel({acceptance,fulfillment}),label);}
});
test('reply composer closes at the 24-hour boundary and never enables sending for invalid or future dates',()=>{
 const now=Date.parse('2026-10-10T12:00:00Z');
 assert.equal(replyWindowOpen(new Date(now-24*3600000+1).toISOString(),now),true);
 assert.equal(replyWindowOpen(new Date(now-24*3600000).toISOString(),now),false);
 assert.equal(replyWindowOpen(new Date(now+1).toISOString(),now),false);
 assert.equal(replyWindowOpen(null,now),false);assert.equal(replyWindowOpen('unknown',now),false);
});
