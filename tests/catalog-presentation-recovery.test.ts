import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogQuestion} from '../apps/server/src/services/catalog-differences.js';
import {visualProductReview} from '../apps/server/src/services/visual-ordering.js';
import type {ConversationState,Product} from '../packages/contracts/index.js';

const state:ConversationState={version:1,draft:[{id:'latch',query:'aluminium door latch',name:'aluminium door latch',quantity:1,resolution:'unavailable',candidates:[]}],pending:{kind:'products',id:'check',version:1,remaining:0,expiresAt:new Date(Date.now()+60000).toISOString(),groups:[{lineId:'latch',products:[]}]},fulfillment:'pickup',lastRequestId:null,replyLanguage:'en',visualOrdering:true};
const product=(brand?:string):Product=>({sku:brand??'unknown',name:'Latch',unit:'piece',pricePaise:10000,stock:1,version:1,aliases:[],quantityStep:1,...(brand?{brand}:{})});

test('brand clarification cannot loop over an empty result or identical verified brands',()=>{
 for(const products of [[],[product('A')],[product('A'),product('A')]])assert.equal(catalogQuestion('Which brand do you want?',state,products),undefined);
 assert.equal(catalogQuestion('Which brand and size do you need?',state,[product(),product()]),'Which brand and size do you need?');
 assert.equal(catalogQuestion('Which brand do you want?',state,[product('A'),product('B')]),'Which brand do you want?');
 assert.equal(catalogQuestion('What will you use it for?',state,[]),'What will you use it for?');
});
test('missing latch keeps a visual request and explains the catalog gap rather than a brand loop',()=>{
 const before=structuredClone(state),r=visualProductReview(state,false,'Which brand do you want?');
 assert.equal(r.stage,'shop_check');assert.equal(r.clarificationReason,'catalog_missing');
 assert.match(r.text,/No matching catalog listing/);assert.doesNotMatch(r.text,/brand|out of stock/i);
 assert.equal(r.parts?.[0].cards[0].kind,'instruction');assert.equal(r.parts?.[0].cards[0].title,'aluminium door latch');
 assert.equal(r.parts?.flatMap(p=>p.cards).filter(c=>c.kind==='product').length,0);
 assert.deepEqual(state,before);
});
test('Tamil missing-item caption explains the next step while retaining visual presentation',()=>{
 const r=visualProductReview({...state,replyLanguage:'ta'},false,'எந்த brand வேணும்?');
 assert.match(r.text,/கடை சரிபார்க்க/);assert.doesNotMatch(r.text,/brand|1 items/);
 assert.equal(r.presentation,'single_product');
});
test('a useful follow-up cannot replace the explanation of a missing listing',()=>{
 const r=visualProductReview(state,false,'What will you use it for?');
 assert.match(r.text,/No matching catalog listing/);assert.match(r.text,/What will you use it for/);
});
test('a known product awaiting price verification must not be called a missing listing',()=>{
 const p=product('A'),line={...state.draft[0],sku:p.sku,candidates:[p],catalogIssue:'price_unverified' as const};
 const s={...state,draft:[line],pending:{...state.pending!,kind:'products' as const,id:'check',version:1,remaining:0,expiresAt:new Date(Date.now()+60000).toISOString(),groups:[{lineId:line.id,products:[p]}]}};
 const r=visualProductReview(s);
 assert.doesNotMatch(r.text,/No matching catalog listing/);
 assert.ok(r.parts?.flatMap(p=>p.cards).some(c=>c.kind==='product'&&c.product.sku===p.sku));
});
