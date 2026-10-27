import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import type {ConversationState,DiscoveryResult,Product} from '../packages/contracts/index.js';
import {catalogGroupReply} from '../apps/server/src/services/catalog-group-replies.js';
import {discoveryPresentation} from '../apps/server/src/services/discovery-replies.js';
import {visualReply} from '../apps/server/src/services/visual-ordering.js';
import {materializeVisualReply} from '../apps/server/src/services/visual-images.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';

const state:ConversationState={visualOrdering:true,replyLanguage:'en',version:0,draft:[],pending:null,fulfillment:'pickup',lastRequestId:null};
const product=(n:number,familyId='pvc'):Product=>({sku:`P${n}`,name:`Product ${n}`,unit:'piece',pricePaise:12500,stock:null,version:1,aliases:[],quantityStep:1,familyId,brand:n===1?'Alpha':'Beta',specifications:{size:n===1?'small':'large'},imageUrl:`https://images.example.test/${n}.jpg`});
const facet=(key:string,values:{value:string;label:string;count:number}[])=>({key,label:key,values});
const result=(products:Product[],facets:DiscoveryResult['facets']=[],totalCount=products.length):DiscoveryResult=>({query:'pipe',plan:{keywords:['pipe']},products,rankings:products.map(p=>({sku:p.sku,score:1,match:'keyword_match',reason:'match'})),totalCount,retrievedCount:products.length,facets,noExactMatch:false});
const memoryId=randomUUID(),batchId=randomUUID(),lineId=randomUUID();
const cards=(reply:NonNullable<ReturnType<typeof catalogGroupReply>>)=>reply.parts![0].cards;

test('large family results show truthful example photos, counts and bound selection',()=>{
 const source=result([product(1),product(2,'hose')],[facet('family',[{value:'pvc',label:'PVC',count:12},{value:'hose',label:'Hose',count:7}])],19);
 const before=structuredClone(source),reply=catalogGroupReply(source,state,{memoryId})!;
 assert.equal(reply.clarificationReason,'catalog_group');assert.equal(visualReply(reply,state),reply);assert.deepEqual(source,before);
 const entries=cards(reply);assert.equal(entries.length,2);
 for(const [index,card] of entries.entries()){
  if(card.kind==='product')throw new Error('expected group');assert.equal(card.kind,'instruction');
  assert.equal(card.imageUrl,source.products[index].imageUrl);assert.match(card.caption,/matching products/);assert.match(card.caption,/Example product photo/);
  const event=card.buttons![0].event;assert.equal(event.type,'refine_discovery');if(event.type==='refine_discovery'){assert.equal(event.memoryId,memoryId);assert.equal(event.facet,'family');}
 }
 const batch=catalogGroupReply(source,state,{batchId,lineId})!;
 const event=cards(batch)[0].buttons![0].event;assert.equal(event.type,'refine_search');if(event.type==='refine_search'){assert.equal(event.batchId,batchId);assert.equal(event.lineId,lineId);}
});

test('missing example never borrows a different group photo',()=>{
 const source=result([product(1)],[facet('family',[{value:'pvc',label:'PVC',count:10},{value:'hose',label:'Hose',count:9}])],19);
 const entries=cards(catalogGroupReply(source,state,{memoryId})!);const missing=entries[1];assert.notEqual(missing.kind,'product');if(missing.kind!=='product'){assert.equal(missing.imageUrl,undefined);assert.doesNotMatch(missing.caption,/Example product photo/);}
});

test('explicit solvent groups need no candidate products and never add phantom products',()=>{
 const source=result([],[],0);source.groups=[{key:'family',value:'pvc-solvent',label:'PVC solvent',count:2},{key:'family',value:'thinner',label:'Paint thinner',count:3}];
 const reply=discoveryPresentation(source,state,memoryId),entries=cards(reply);assert.equal(entries.length,2);assert.ok(entries.every(c=>c.kind==='instruction'));
 assert.ok(entries.flatMap(c=>c.buttons??[]).every(b=>b.event.type==='refine_discovery'));
 const dir=mkdtempSync('/tmp/catalog-group-');try{const rendered=renderWhatsAppReply(materializeVisualReply(reply,dir),randomUUID(),'shop.example.test');assert.equal(rendered.format,'carousel');assert.ok(rendered.actions.every(a=>a.event.type==='refine_discovery'));}finally{rmSync(dir,{recursive:true,force:true});}
});

test('single actual group uses a single image; no binding yields no group reply',()=>{
 const source=result([],[],0);source.groups=[{key:'family',value:'one',label:'One',count:1,product:product(1)}];
 assert.equal(catalogGroupReply(source,state,{}),undefined);const reply=catalogGroupReply(source,state,{memoryId})!;assert.equal(reply.presentation,'single_product');assert.equal(cards(reply).length,1);
 const rendered=renderWhatsAppReply(reply,randomUUID(),'shop.example.test');assert.equal(rendered.format,'buttons');
});

test('chooses useful nonfirst brand and specification facets and preserves paging',()=>{
 for(const key of ['brand','spec:size']){
  const values=key==='brand'?[{value:'Alpha',label:'Alpha',count:10},{value:'Beta',label:'Beta',count:9}]:[{value:'small',label:'Small',count:10},{value:'large',label:'Large',count:9}];
  const selected={...facet(key,values),nextOffset:2};const source=result([product(1),product(2)],[facet('irrelevant',values),selected],19);
  const entries=cards(catalogGroupReply(source,state,{memoryId})!);assert.equal(entries.length,3);
  const first=entries[0];assert.notEqual(first.kind,'product');if(first.kind!=='product')assert.equal(first.imageUrl,source.products[0].imageUrl);
  for(const card of entries){const e=card.buttons![0].event;assert.equal(e.type,'refine_discovery');if(e.type==='refine_discovery')assert.equal(e.facet,key);}
  const more=entries[2].buttons![0].event;if(more.type==='refine_discovery')assert.equal(more.value,'__more__');else assert.fail('expected paging');
 }
});

test('ten ordinary products retain all photos and actions through visual WhatsApp rendering',()=>{
 const products=Array.from({length:10},(_,i)=>product(i+1));const source=result(products,[facet('brand',[{value:'Alpha',label:'Alpha',count:1},{value:'Beta',label:'Beta',count:9}])]);
 assert.equal(catalogGroupReply(source,state,{memoryId}),undefined);
 const discovered=discoveryPresentation(source,state,memoryId);assert.equal(discovered.cards?.length,10);
 const visual=visualReply(discovered,state);assert.equal(visual.parts?.[0].cards.length,10);
 const dir=mkdtempSync('/tmp/catalog-products-');try{
  const rendered=renderWhatsAppReply(materializeVisualReply(visual,dir),randomUUID(),'shop.example.test');assert.equal(rendered.format,'carousel');
  const entries=(rendered.payload as any).interactive.action.cards;assert.equal(entries.length,10);assert.ok(entries.every((c:any)=>c.action.buttons.length>=1&&c.action.buttons.length<=2));assert.equal(new Set(entries.map((c:any)=>c.action.buttons.length)).size,1);
  assert.ok(entries.every((c:any)=>c.body.text.includes('₹125.00')));assert.equal(rendered.actions.filter(a=>a.event.type==='choose_product').length,10);
 }finally{rmSync(dir,{recursive:true,force:true});}
});


test('the final single facet-page choice remains visible and actionable',()=>{
 const source=result([product(1)],[{key:'brand',label:'brand',totalValues:3,values:[{value:'Alpha',label:'Alpha',count:19}]}],19);
 source.plan.facetPage={key:'brand',offset:2};
 const reply=catalogGroupReply(source,state,{memoryId})!;assert.equal(cards(reply).length,1);assert.equal(cards(reply)[0].buttons![0].event.type,'refine_discovery');
});
