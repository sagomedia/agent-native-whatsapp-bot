import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {ConversationState,DiscoveryResult,Product} from '../packages/contracts/index.js';
import {discoveryPresentation} from '../apps/server/src/services/discovery-replies.js';
import {visualReply} from '../apps/server/src/services/visual-ordering.js';

const product:Product={sku:'P1',name:'PVC pipe',unit:'piece',pricePaise:1000,stock:2,version:1,aliases:[],quantityStep:1,imageUrl:'/catalog-images/p1.jpg'};
const result=(products:Product[],noExactMatch=false):DiscoveryResult=>({query:'pipe',plan:{keywords:['pipe']},products,rankings:products.map(p=>({sku:p.sku,score:1,match:noExactMatch?'related':'keyword_match',reason:'name'})),totalCount:products.length,retrievedCount:products.length,facets:[],noExactMatch});
const state=(replyLanguage:ConversationState['replyLanguage']):ConversationState=>({version:1,replyLanguage,visualOrdering:true,draft:[],pending:null,fulfillment:'pickup',lastRequestId:null});

test('agent clarification keeps related-option warning and a usable next step in each customer language',()=>{
 for(const [language,question,warning,nextStep] of [
  ['en','Which pipe type do you need?','related catalog items','Choose a photo'],
  ['ta','எந்த பைப் வகை வேண்டும்?','தொடர்புடைய பட்டியல் பொருட்கள்','படத்தில் தேர்வு'],
  ['ta-Latn','Entha pipe type venum?','thodarbudaiya catalog porutkal','Photo-la choose']
 ] as const){
  const s=state(language),reply=discoveryPresentation(result([product],true),s,undefined,undefined,question);
  assert.ok(reply.text.startsWith(question+'\n'));
  assert.match(reply.text,new RegExp(warning,'i'));
  assert.ok(reply.text.includes(question));
  assert.match(reply.text,new RegExp(nextStep,'i'));
  assert.equal(reply.cards?.[0].matchLabel?.length!==0,true);
  const visual=visualReply(reply,s);
  assert.match(visual.text,new RegExp(warning,'i'));
  assert.ok(visual.text.includes(question));
 }
});

test('catalog-only no-match search does not claim the item was saved',()=>{
 for(const language of ['en','ta','ta-Latn'] as const){
  const reply=discoveryPresentation(result([]),state(language));
  assert.doesNotMatch(reply.text,/on your list|உங்கள் பட்டியலில்|unga list-la|kept your request/i);
  assert.match(reply.text,/\?/);
 }
});

test('detailed no-match request keeps the named description and count without looping on a generic question',()=>{
 for(const language of ['en','ta','ta-Latn'] as const){
  const reply=discoveryPresentation({...result([]),query:'Asian Paints wall paint'},state(language),undefined,undefined,'What size or brand do you want?',{quantity:1});
  assert.match(reply.text,/Asian Paints wall paint/);
  assert.match(reply.text,/1/);
  assert.doesNotMatch(reply.text,/What size|What will you use|brand|என்ன வேலை|Enna velaikku/i);
  assert.doesNotMatch(reply.text,/on your list|உங்கள் பட்டியலில்|unga list-la/i);
  assert.doesNotMatch(reply.text,/stock|இருப்பு|iruppu/i);
 }
});

test('persisted no-match line keeps supplied count and asks for a missing detail',()=>{
 const s=state('en'),lineId=randomUUID();
 s.draft=[{id:lineId,name:'paint',query:'paint',quantity:2,unit:'tin',resolution:'unavailable'}];
 const reply=discoveryPresentation({...result([]),query:'paint'},s,undefined,lineId,undefined,{quantity:2,unit:'tin'});
 assert.match(reply.text,/paint.*2 tin.*on your list/i);
 assert.match(reply.text,/What are you painting/);
 assert.doesNotMatch(reply.text,/How many/i);
});

test('known size does not lead to a repeated size facet question',()=>{
 const s=state('en'),lineId=randomUUID();
 s.draft=[{id:lineId,name:'pipe',query:'one inch pipe',quantity:2,resolution:'needs_choice',productMeasures:[{value:1,unit:'inch'}]}];
 s.pending={kind:'question',id:randomUUID(),lineId,version:s.version};
 const found={...result([product]),facets:[{key:'size',label:'size',values:[{value:'1 inch',label:'1 inch',count:1}]}]};
 const reply=discoveryPresentation(found,s,undefined,lineId,'Which size do you need?');
 assert.doesNotMatch(reply.text,/Which size/i);
 assert.match(reply.text,/Which photo/);
 assert.equal(reply.cards?.[0].action?.type,'select_candidate');
});

test('known pipe length still permits a diameter question',()=>{
 const s=state('en'),lineId=randomUUID();
 s.draft=[{id:lineId,name:'pipe',query:'pipe',quantity:2,resolution:'needs_choice',productMeasures:[{value:2,unit:'metre',role:'length'}]}];
 s.pending={kind:'question',id:randomUUID(),lineId,version:s.version};
 const found={...result([product]),facets:[{key:'diameter',label:'diameter',values:[{value:'1 inch',label:'1 inch',count:1}]}]};
 const reply=discoveryPresentation(found,s,undefined,lineId,'Which diameter do you need?');
 assert.match(reply.text,/Which diameter do you need\?/);
 const withoutModelQuestion=discoveryPresentation(found,s,undefined,lineId);
 assert.match(withoutModelQuestion.text,/Which diameter: 1 inch\?/);
});

test('a brand and size question stays when only size is known',()=>{
 const s=state('en'),lineId=randomUUID();
 s.draft=[{id:lineId,name:'pipe',query:'one inch pipe',quantity:2,resolution:'needs_choice',productMeasures:[{value:1,unit:'inch',role:'size'}]}];
 s.pending={kind:'question',id:randomUUID(),lineId,version:s.version};
 const reply=discoveryPresentation(result([product]),s,undefined,lineId,'Which brand and size do you need?');
 assert.match(reply.text,/Which brand and size do you need\?/);
});

test('visual product clarification retains earlier list context',()=>{
 const s=state('ta');
 const reply=visualReply({...discoveryPresentation(result([product]),s),contextLines:['மற்ற பொருட்கள் பட்டியலில் உள்ளன']},s);
 assert.match(reply.text,/மற்ற பொருட்கள் பட்டியலில் உள்ளன/);
 assert.match(reply.parts?.[0].text??'',/மற்ற பொருட்கள் பட்டியலில் உள்ளன/);
});
