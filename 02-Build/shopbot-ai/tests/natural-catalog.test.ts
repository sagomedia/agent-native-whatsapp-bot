import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {discoverProducts} from '../apps/server/src/services/catalog-discovery.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {visualReply} from '../apps/server/src/services/visual-ordering.js';
import {trackItemClarification} from '../apps/server/src/services/item-clarification.js';
import {catalogQuestion} from '../apps/server/src/services/catalog-differences.js';
import {understandingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';
import type {ActorContext} from '../apps/server/src/services/context.js';
import type {Interpretation,ConversationState} from '../packages/contracts/index.js';

async function fixture(run:(pool:pg.Pool,ctx:ActorContext)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='natural_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');const storeId=randomUUID(),conversationId=randomUUID();
  await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Synthetic natural-language shop',true)",[storeId]);
  await pool.query("INSERT INTO catalog_profiles(store_id,store_type) VALUES($1,'hardware')",[storeId]);
  await pool.query("INSERT INTO catalog_nodes(store_id,id,kind,label) VALUES($1,'hardware','department','Hardware')",[storeId]);
  for(const [id,label,aliases] of [['respiratory','Dust Masks & Respirators',['dust mask','n95 mask','respirator']],['paint','Paints',['paint','wall paint']],['interior','Interior Wall Paints & Distempers',['interior paint','wall emulsion']],['exterior','Exterior Wall Paints & Emulsions',['exterior paint']],['primer','Wall Primers',['primer']],['pipes','PVC Pipes',['pvc pipe']]] as const)
   await pool.query("INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,aliases) VALUES($1,$2,'hardware','family',$3,$4)",[storeId,id,label,JSON.stringify(aliases)]);
  for(const [sku,name,family,brand,specs,aliases,unit] of [
   ['N95','3M 8210 N95 Particulate Respirator Mask with Valve','respiratory','3M',{standard:'NIOSH N95'},['n95 dust mask','mask'],'piece'],
   ['DUST','3M Disposable Dust Mask','respiratory','3M',{standard:'ordinary dust'},['dust mask'],'piece'],
   ['PAINT4','Asian Paints Tractor Emulsion 4L','interior','Asian Paints',{color:'White (BR White)',size:'4 L'},['Asian Paints white paint'],'can'],
   ['APEX4','Asian Paints Apex Exterior Emulsion 4L','exterior','Asian Paints',{colour:'white',pack_size:'4 L'},['Asian Paints Apex'],'can'],
   ['PAINT1','Asian Paints Tractor Emulsion 1L','interior','Asian Paints',{colour:'white',size:'1 L'},['Asian Paints white paint'],'can'],
   ['OLD','Asian Paints Tractor 10L','paint','Asian Paints',{colour:'white',size:'10 L'},['Asian Paints'],'can'],
   ['PRIMER','Asian Paints Wall Primer 4L','primer','Asian Paints',{colour:'white',size:'4 L'},['Asian Paints'],'can'],
   ['KG','Asian Paints Tractor Emulsion 4kg','interior','Asian Paints',{colour:'white',size:'4 kg'},['Asian Paints 4L'],'bucket'],
   ['OTHER','Otherbrand Interior Emulsion 4L','interior','Otherbrand',{colour:'white',size:'4 L'},['wall paint'],'can'],
  ] as const)await pool.query("INSERT INTO products(store_id,sku,name,family_id,brand,specifications,aliases,unit,price_paise,stock,selling_unit_verified,image_path) VALUES($1,$2,$3,$4,$5,$6,$7,$8,10000,20,true,'/demo-images/H01.jpg')",[storeId,sku,name,family,brand,JSON.stringify(specs),JSON.stringify(aliases),unit]);
  await pool.query("INSERT INTO conversations(id,store_id,actor,visual_ordering) VALUES($1,$2,'natural-test',true)",[conversationId,storeId]);
  await run(pool,{storeId,conversationId,actor:'natural-test',role:'customer'});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}

const maskPhrases=['mask','face mask','dust mask','respirator','மாஸ்க்','முகக்கவசம்','முகக் கவசம்','thoosi mask','முகத்துல போடுற மாஸ்க்','I need a face mask','show me face mask','face mask please','mask irukka','mask venum','மாஸ்க் வேண்டும்'];
const n95Phrases=['N95 mask','N95 face mask','n95 dust mask','N95 respirator','N95 மாஸ்க்','N95 முகக்கவசம்','n95 முகக் கவசம்','n95 thoosi mask','I want N95 face mask','show me N95 mask','N95 mask please','N95 mask irukka','N95 mask venum','N95 மாஸ்க் வேணும்','N95 face mask rate enna'];
const paintPhrases=['Asian paint white colour 4L','4 litre white Asian paint','Asian Paints white 4 L','Asian paint white color 4L','Asian paint 4 litres white','white Asian paints 4 liters','Asian paint white 4 ltr','Asian paint white 4 litre','I need Asian paint white colour 4L','show me Asian Paints white 4L','Asian paint white 4L please','ஏஷியன் பெயிண்ட் வெள்ளை 4 litre','asain paint vellai 4L','Asian paint white four litre','Asian paint white 4L rate enna'];
const negatives=['N99 mask','N100 face mask','P100 respirator','Asian paint blue 4L','Asian paint red 4L','Asian paint black 4L','Asian paint green 4L','Asian paint white 40L','Asian paint white 3L','Asian paint white 5L','Asian paint white 4mm','Asian paint white 4 inch','Unknownbrand N95 mask','N95 surgical gown','N95 safety goggles'];

test('60 natural-language wording and negative cases retrieve grounded products',()=>fixture(async(pool,ctx)=>{
 const c=await pool.connect();try{
  for(const q of maskPhrases){const r=await discoverProducts(c,ctx,q);assert.ok(r.products.length,q);assert.ok(r.products.every(p=>p.familyId==='respiratory'),q);}
  for(const q of n95Phrases){const r=await discoverProducts(c,ctx,q);assert.deepEqual(r.products.map(p=>p.sku),['N95'],q);}
  for(const q of paintPhrases){const r=await discoverProducts(c,ctx,q);assert.deepEqual(r.products.map(p=>p.sku).sort(),['APEX4','PAINT4'],q);assert.equal(r.noExactMatch,false,q);}
  for(const q of negatives){const r=await discoverProducts(c,ctx,q);assert.deepEqual(r.products,[],q);}
  assert.equal(maskPhrases.length+n95Phrases.length+paintPhrases.length+negatives.length,60);
 }finally{c.release();}
}));

test('alternatives disclose colour and pack differences, never become an exact quote or automatic selection',()=>fixture(async(pool,ctx)=>{
 const tools=new RetailTools(pool);
 const r=await tools.invoke(ctx,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'Asian paint red 4L',quantity:1}]}},randomUUID());
 const line=r.state!.draft[0];assert.equal(line.sku,undefined);assert.equal(line.resolution,'needs_choice');assert.equal(line.discovery?.matchStatus,'alternatives');
 assert.ok(line.discovery!.rankings.every(r=>r.differences?.some(d=>d.requested==='red')));assert.ok(line.candidates!.every(p=>!['KG','PRIMER','DUST'].includes(p.sku)));
 const review=await tools.invoke(ctx,{name:'preview_order',args:{expectedVersion:r.state!.version}},randomUUID());
 const visible=visualReply({version:1,kind:'text',text:review.message,presentation:'text',outboundMessages:1},review.state!);
 assert.match(JSON.stringify(visible),/red/);assert.equal(review.state!.draft[0].sku,undefined);
 const quote=await tools.invoke(ctx,{name:'search_products',args:{query:'Asian paint red 4L',quantity:1}},randomUUID());assert.equal(quote.quote,undefined);
 const choice=line.candidates![0];
 const accepted=await tools.invoke({...ctx,consentProductBatchId:(review.state!.pending as any).id},{name:'confirm_product_choices',args:{batchId:(review.state!.pending as any).id,choices:[{lineId:line.id,sku:choice.sku}]}},randomUUID());
 assert.equal(accepted.state!.draft[0].sku,choice.sku);assert.ok(accepted.state!.draft[0].productConfirmation);
}));

test('per-item clarification tracks only unchanged requests and resets for useful details',()=>{
 const base:ConversationState={version:0,draft:[{id:'a',name:'unknown part',query:'unknown part',quantity:null,resolution:'unavailable'}],pending:{kind:'question',id:'q',lineId:'a',version:0},lastRequestId:null,fulfillment:'pickup'};
 let next=structuredClone(base);assert.ok(trackItemClarification(base,next));assert.equal(next.draft[0].clarification?.unproductiveTurns,1);
 const after=structuredClone(next);trackItemClarification(next,after);assert.equal(after.draft[0].clarification?.unproductiveTurns,2);
 const refined=structuredClone(after);refined.draft[0].query='N95 mask';trackItemClarification(after,refined);assert.equal(refined.draft[0].clarification?.unproductiveTurns,0);
});

test('stalled requests promote shop review only when supported, without hiding errors or clear-list consent',()=>{
 const state:ConversationState={version:1,draft:[{id:'a',name:'spare part',query:'spare part',quantity:null,resolution:'unavailable',clarification:{signature:'fixture',unproductiveTurns:2}}],pending:{kind:'question',id:'q',lineId:'a',version:1},lastRequestId:null,fulfillment:'pickup',visualOrdering:true,allowPartialReview:true,replyLanguage:'en'};
 const base={version:1 as const,kind:'text' as const,text:'Which spare part?',presentation:'text' as const,outboundMessages:1};
 const promoted=visualReply(base,state);assert.match(promoted.text,/kept your request/);assert.equal(promoted.buttons?.[0].event.type,'review_partial');
 const blocked=visualReply(base,{...state,allowPartialReview:false});assert.equal(blocked.buttons?.[0].event.type,'shopping_action');assert.equal((blocked.buttons?.[0].event as any).action,'handoff');
 const failed=visualReply({...base,stage:'error'},state);assert.equal(failed.stage,'error');
 const clear=visualReply({...base,clarificationReason:'intent_clarification'},state);assert.equal(clear.text,base.text);
 assert.equal(catalogQuestion('Which brand do you need?',state,[{brand:'3M'} as any]),undefined);
 assert.equal(catalogQuestion('Which brand do you need?',state,[{brand:'3M'} as any,{brand:'Other'} as any]),'Which brand do you need?');
});

test('colour constraints use product names when absent but reject conflicting structured colour evidence',()=>fixture(async(pool,ctx)=>{
 await pool.query("UPDATE products SET specifications=specifications-'colour' WHERE store_id=$1 AND sku='PAINT1'",[ctx.storeId]);
 await pool.query("UPDATE products SET name=name||' White',specifications=specifications||'{\"colour\":\"red\"}' WHERE store_id=$1 AND sku='PAINT4'",[ctx.storeId]);
 const c=await pool.connect();try{
  const result=await discoverProducts(c,ctx,'Asian paint white 4L');
  assert.ok(!result.products.some(p=>p.sku==='PAINT4'));assert.ok(result.products.some(p=>p.sku==='APEX4'));
 }finally{c.release();}
}));

test('grounded understanding carries attributes into lookup, price and purchase without inventing counts',()=>{
 const state:ConversationState={version:0,draft:[],pending:null,lastRequestId:null,fulfillment:'pickup',replyLanguage:'en'};
 const phrase='one white 4 litre Asian paint can';
 const item={ordinal:0,query:'paint',sourceText:phrase,purchaseCount:1,brand:'Asian Paints',colour:'white',requestedContainer:'can',packSize:{value:4,unit:'litre'},unresolved:[]};
 for(const intent of ['add','lookup','price']){
  const result=understandingToInterpretation({schemaVersion:2,inputKind:'text',intents:[intent],requestedItems:[item],proposedEdits:[],shopQuestions:[],unresolved:[]},{text:phrase,state},true);
  const search=intent==='price'?result.priceSearch:intent==='lookup'?result.assistance?.search:(result.operations[0] as any).search;
  assert.equal(search?.brand,'Asian Paints');assert.equal(search?.specifications?.colour,'white');assert.equal(search?.specifications?.pack_size,'4 litre');
  if(intent!=='add')assert.deepEqual(result.operations,[]);
  else{assert.equal((result.operations[0] as any).quantity,1);assert.deepEqual((result.operations[0] as any).packSize,{value:4,unit:'litre'});}
 }
});

test('a rating mislabelled as a brand cannot relax N95 into an ordinary dust mask',()=>fixture(async(pool,ctx)=>{
 const c=await pool.connect();try{
  const result=await discoverProducts(c,ctx,'N95 mask',{keywords:['N95 mask'],brand:'N95',allowAlternatives:true});
  assert.ok(!result.products.some(p=>p.sku==='DUST'));
 }finally{c.release();}
}));

test('unresolved requests can reach the existing partial shop submission flow without a false stock claim',()=>fixture(async(pool,ctx)=>{
 await pool.query('UPDATE conversations SET partial_reviews=true WHERE id=$1',[ctx.conversationId]);
 const tools=new RetailTools(pool);
 const first=await tools.invoke(ctx,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'unlisted spare part',quantity:null}]}},randomUUID());
 const reviewed=await tools.invoke(ctx,{name:'preview_order',args:{expectedVersion:first.state!.version,allowPartial:true}},randomUUID());
 assert.equal(reviewed.state!.pending?.kind,'review');
 const reviewId=reviewed.state!.pending!.id;
 const sent=await tools.invoke({...ctx,consentReviewId:reviewId},{name:'submit_order_request',args:{reviewId}},randomUUID());
 assert.ok(sent.request);assert.match(JSON.stringify(sent.request),/unlisted spare part/);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_requests WHERE conversation_id=$1',[ctx.conversationId])).rows[0].n,1);
}));

test('eight multi-turn customer flows retain intent, cart state and read-only price checks',()=>fixture(async(pool,ctx)=>{
 for(const scenario of ['refine-rating','quantity','replace','other-lines','price-only','colour-alternative','shop-check','recheck']){
  const id=randomUUID();await pool.query("INSERT INTO conversations(id,store_id,actor,visual_ordering) VALUES($1,$2,$3,true)",[id,ctx.storeId,ctx.actor]);
  const inbox=new SimulatorService(pool,{...ctx,conversationId:id});let calls=0;
  const runtime=new ConversationRuntime(pool,{name:'natural-fixture',mode:'mock',interpret:async input=>{
   calls++;const line=input.state.draft[0];let output:Interpretation;
   if(input.text==='rate enna')output={operations:[],next:'price',priceQuery:line?.query??'N95 mask',priceQuantity:2};
   else if(input.text==='N95')output={operations:[{kind:'resolve_line',lineId:line!.id,query:'N95 mask'}],next:'review'};
   else if(input.text==='two pieces')output={operations:[{kind:'resolve_line',lineId:line!.id,quantity:2}],next:'review'};
   else if(input.text==='not that one, N95')output={operations:[{kind:'resolve_line',lineId:line!.id,query:'N95 mask'}],next:'review'};
   else output={operations:[{kind:'add_item',query:input.text,quantity:1}],next:'review'};
   return {output,usage:null,truncated:false};
  }});
  async function send(text:string){await inbox.ingest({id:randomUUID(),type:'text',text});await runtime.processNext(inbox.context);return inbox.snapshot();}
  const first=await send(scenario==='colour-alternative'?'Asian paint red 4L':scenario==='shop-check'?'unlisted spare part':'mask');const lineId=first.conversation.draft[0].id;
  if(scenario==='refine-rating'||scenario==='replace'){const s=await send(scenario==='replace'?'not that one, N95':'N95');assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].id,lineId);assert.ok(s.conversation.draft[0].candidates?.some(p=>p.sku==='N95'));}
  if(scenario==='quantity'){const s=await send('two pieces');assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.conversation.draft.length,1);}
  if(scenario==='other-lines'){await send('Asian paint white 4L');const s=await send('N95');assert.equal(s.conversation.draft.length,2);assert.equal(s.conversation.draft[0].id,lineId);assert.match(s.conversation.draft[1].query!,/Asian paint/);}
  if(scenario==='price-only'){const s=await send('rate enna');assert.deepEqual(s.conversation.draft,first.conversation.draft);assert.equal(s.requests.length,0);}
  if(scenario==='colour-alternative'){assert.equal(first.conversation.draft[0].sku,undefined);const s=await send('N95');assert.equal(s.conversation.draft.length,1);}
  if(scenario==='shop-check'){const s=await send('unlisted spare part');assert.ok(s.conversation.draft.some(l=>l.query==='unlisted spare part'));assert.equal(s.requests.length,0);assert.ok(!JSON.stringify(s.messages.at(-1)?.rich).includes('out of stock'));}
  if(scenario==='recheck'){const before=calls;const s=await send('check again');assert.equal(calls,before);assert.equal(s.conversation.draft[0].id,lineId);}
  assert.ok(calls<=3,scenario);
 }
}));
