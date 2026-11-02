import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {understandingToInterpretation,understandingPrompt} from '../apps/server/src/adapters/turn-understanding.js';
import {discoverProducts,refinementPlan} from '../apps/server/src/services/catalog-discovery.js';
import {validateCurrentTurn} from '../apps/server/src/services/current-turn.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {validateInventoryReplan} from '../apps/server/src/services/inventory-grounding.js';
import {catalogGroupReply} from '../apps/server/src/services/catalog-group-replies.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import type {ConversationState,Interpretation,SimulatorEvent} from '../packages/contracts/index.js';
import type {Interpreter,InterpretationInput} from '../apps/server/src/adapters/interpreter.js';

const base=()=>({schemaVersion:2,inputKind:'text',intents:['edit'],requestedItems:[],proposedEdits:[],shopQuestions:[],unresolved:[]});
const empty:ConversationState={version:0,draft:[],pending:null,lastRequestId:null,fulfillment:'pickup',replyLanguage:'en'};
const id=randomUUID(),other=randomUUID();
const cart:ConversationState={...empty,editingLineId:id,draft:[{id,query:'hammer',name:'Hammer',quantity:2,resolution:'unavailable'},{id:other,query:'brush',name:'Brush',quantity:4,resolution:'unavailable'}]};

for(const source of ['take the hammer off my list','exclude the hammer from my list','சுத்தியலை பட்டியலிலிருந்து அகற்று'])test(`semantic removal accepts a complete paraphrase: ${source}`,()=>{
 const plan=understandingToInterpretation({...base(),proposedEdits:[{kind:'remove_item',sourceText:source,targetLineId:id,targetQuery:'hammer'}]},{text:source,state:cart,inventoryGrounding:true},false);
 assert.deepEqual(plan.operations,[{kind:'remove_item',reference:id,supportingPhrase:source}]);
 assert.deepEqual(validateCurrentTurn(plan.operations,source,cart),plan.operations);
 assert.equal(cart.draft[1].quantity,4);
});

test('count evidence supports paraphrased additions and quantities without a number-word allowlist',()=>{
 for(const [source,kind,mode,countPhrase] of [['increase the hammers by two','increment_quantity','additional','two'],['make the hammer count a couple','set_quantity','total','a couple']] as const){
  const plan=understandingToInterpretation({...base(),proposedEdits:[{kind,sourceText:source,targetLineId:id,targetQuery:'hammer',quantity:2,countEvidence:{sourceText:countPhrase,value:2,mode}}]},{text:source,state:cart,inventoryGrounding:true},false);
  assert.equal(plan.operations[0].kind,kind);assert.equal(validateCurrentTurn(plan.operations,source,cart).length,1);
 }
});

test('semantic evidence never authorizes negation, a stale row, a bare noun or a dimension as a count',()=>{
 for(const [source,targetLineId,evidence] of [["do not remove the hammer",id,undefined],['hammer',id,undefined],['remove the hammer',randomUUID(),undefined]] as const){
  assert.throws(()=>understandingToInterpretation({...base(),proposedEdits:[{kind:'remove_item',sourceText:source,targetLineId,targetQuery:'hammer'}]},{text:source,state:cart,inventoryGrounding:true},false));
 }
 assert.throws(()=>understandingToInterpretation({...base(),proposedEdits:[{kind:'set_quantity',sourceText:'hammer 5 inch',targetLineId:id,targetQuery:'hammer',quantity:5,countEvidence:{sourceText:'5 inch',value:5,mode:'total'}}]},{text:'hammer 5 inch',state:cart},false),/count must appear/);
});

test('spoken translated attributes use verbatim evidence, and an explicit four-litre pack cannot become one litre',()=>{
 const source='நாலு லிட்டர் ஒயிட் பெயிண்ட்';
 const item={ordinal:0,sourceText:source,query:'white paint',colour:'white',attributeEvidence:[{field:'colour',value:'white',sourceText:'ஒயிட்'}],purchaseCount:null,packSize:{value:4,unit:'litre'},unresolved:[],search:{keywords:['white paint','white wall coating']}};
 const input={text:source,state:empty};
 const valid=understandingToInterpretation({...base(),intents:['add'],requestedItems:[item]},input,false);
 assert.equal(valid.operations[0].kind,'add_item');assert.equal((valid.operations[0] as any).search.specifications.colour,'white');assert.equal((valid.operations[0] as any).search.specifications.pack_size,'4 litre');
 assert.throws(()=>understandingToInterpretation({...base(),intents:['add'],requestedItems:[{...item,packSize:{value:1,unit:'litre'}}]},input,false),/Pack size conflicts/);
});

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='dynamic_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');const storeId=randomUUID(),conversationId=randomUUID();
  await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Synthetic grocery','true')",[storeId]);
  await pool.query("INSERT INTO catalog_profiles(store_id,store_type) VALUES($1,'grocery')",[storeId]);
  await pool.query("INSERT INTO catalog_nodes(store_id,id,parent_id,kind,label,aliases) VALUES($1,'food',NULL,'department','Food','[]'),($1,'plant-drinks','food','family','Plant drinks','[\"oat milk\",\"oat drink\"]'),($1,'dairy-drinks','food','family','Dairy drinks','[\"milk\",\"dairy milk\"]')",[storeId]);
  for(const [sku,name,family,aliases] of [['OAT','Field Oat Drink 1L','plant-drinks',['oat milk','oat drink']],['DAIRY','Farm Dairy Milk 1L','dairy-drinks',['milk','dairy milk']]] as const){
   await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,aliases,specifications,image_path,selling_unit_verified) VALUES($1,$2,$3,'can',10000,10,$4,$5::jsonb,'{\"pack_size\":\"1 litre\"}',$6,true)",[storeId,sku,name,family,JSON.stringify(aliases),'/fixtures/'+sku+'.jpg']);
  }
  await pool.query("INSERT INTO conversations(id,store_id,actor,visual_ordering,reply_language) VALUES($1,$2,'dynamic-test',true,'en')",[conversationId,storeId]);
  await pool.query('INSERT INTO store_policies(store_id,require_product_confirmation) VALUES($1,true)',[storeId]);
  await run(pool,new SimulatorService(pool,{storeId,conversationId,actor:'dynamic-test',role:'customer'}));
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
async function turn(inbox:SimulatorService,runtime:ConversationRuntime,event:SimulatorEvent){await inbox.ingest(event);await runtime.processNext(inbox.context);return inbox.snapshot();}

test('a noisy per-item query is replanned against an unrelated shop inventory and shows real product photos',()=>fixture(async(pool,inbox)=>{
 let calls=0;const source='two oat letter milk';
 const original={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'oat letter milk',purchaseCount:2,unresolved:[],search:{keywords:['oat milk','oat drink']}}]};
 const provider:Interpreter={name:'controlled-inventory-planner',mode:'mock',unifiedUnderstanding:true,interpret:async input=>{
  calls++;
  if(calls===1)return {output:understandingToInterpretation(original,input,false),usage:null,truncated:false};
  assert.equal(input.observations?.[0].query,'oat letter milk');assert.ok(input.planningFeedback?.includes('fresh inventory'));assert.ok(input.observations?.[0].products.some(p=>p.sku==='OAT'));
  const grounded={...original,requestedItems:original.requestedItems.map(item=>({...item,search:{...item.search,identityQuery:'oat milk'}}))};
  return {output:understandingToInterpretation(grounded,input,false),usage:null,truncated:false};
 }};
 const runtime=new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true});
 const snapshot=await turn(inbox,runtime,{id:randomUUID(),type:'text',text:source});
 assert.equal(calls,2);assert.equal(snapshot.conversation.draft.length,1);assert.equal(snapshot.conversation.draft[0].quantity,2);
 assert.deepEqual(snapshot.conversation.draft[0].candidates?.map(p=>p.sku),['OAT']);
 assert.ok(snapshot.messages.at(-1)?.rich?.parts?.some(part=>part.cards.some(card=>card.kind==='product'&&card.product.imageUrl==='/fixtures/OAT.jpg')));
 assert.equal(snapshot.requests.length,0);
}));

test('category cards and their refinement use only types present in this store',()=>fixture(async(pool,inbox)=>{
 const c=await pool.connect();try{
  const found=await discoverProducts(c,inbox.context,'drink',{keywords:['drink','milk'],familyIds:['plant-drinks','dairy-drinks'],clarifyType:true});
  assert.equal(found.matchStatus,'needs_detail');assert.deepEqual(found.groups?.map(g=>g.value),['dairy-drinks','plant-drinks']);
  const reply=catalogGroupReply(found,empty,{memoryId:randomUUID()})!;
  assert.ok(reply.parts![0].cards.every(card=>card.kind==='instruction'&&card.imageUrl?.startsWith('/fixtures/')));
  assert.ok(reply.parts![0].cards.every(card=>card.buttons?.every(b=>b.event.type==='refine_discovery')));
  const refined=await discoverProducts(c,inbox.context,'Plant drinks',refinementPlan(found,'family','plant-drinks'));
  assert.equal(refined.plan.clarifyType,false);assert.deepEqual(refined.products.map(p=>p.sku),['OAT']);
  await pool.query("UPDATE catalog_nodes SET label='Oat beverages' WHERE store_id=$1 AND id='plant-drinks'",[inbox.context.storeId]);
  const changed=await discoverProducts(c,inbox.context,'drink',{keywords:['drink'],familyIds:['plant-drinks'],clarifyType:true});
  assert.equal(changed.groups?.[0].label,'Oat beverages');
 }finally{c.release();}
}));

test('a bad exact alias cannot make a different inventory product authoritative after grounding',()=>fixture(async(pool,inbox)=>{
 await pool.query("UPDATE products SET aliases=aliases||'[\"oat milk\"]'::jsonb WHERE store_id=$1 AND sku='DAIRY'",[inbox.context.storeId]);
 let calls=0;const source='two oat milk',original={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'oat milk',purchaseCount:2,unresolved:[],search:{keywords:['oat milk']}}]};
 const provider:Interpreter={name:'controlled-alias-grounding',mode:'mock',unifiedUnderstanding:true,interpret:async input=>{
  calls++;const raw=calls===1?original:{...original,requestedItems:original.requestedItems.map(item=>({...item,search:{...item.search,selectedSkus:['OAT']}}))};
  return {output:understandingToInterpretation(raw,input,false),usage:null,truncated:false};
 }};
 const s=await turn(inbox,new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true}),{id:randomUUID(),type:'text',text:source});
 assert.equal(calls,2);assert.deepEqual(s.conversation.draft[0].candidates?.map(p=>p.sku),['OAT']);assert.equal(s.requests.length,0);
}));

test('inventory replan cannot change a count or inject a product observed for another item',()=>{
 const source='two oat milk',raw={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'oat milk',purchaseCount:2,unresolved:[],search:{keywords:['oat milk']}}]};
 const initial=understandingToInterpretation(raw,{text:source,state:empty},false);
 const wrong=understandingToInterpretation({...raw,requestedItems:[{...raw.requestedItems[0],purchaseCount:4}]},{text:source,state:empty},false);
 assert.throws(()=>validateInventoryReplan(initial,wrong,[]),/cannot change items/);
 assert.throws(()=>understandingToInterpretation({...raw,requestedItems:[{...raw.requestedItems[0],search:{keywords:['oat milk'],selectedSkus:['FOREIGN']}}]},{text:source,state:empty,proposal:initial,observations:[]},false),/fresh inventory/);
});

test('a quantity-only reply to an unresolved selling unit stays in clarification instead of processing_failed',()=>fixture(async(pool,inbox)=>{
 const id=randomUUID();await pool.query("UPDATE conversations SET draft=$2::jsonb,pending=$3::jsonb WHERE id=$1",[inbox.context.conversationId,JSON.stringify([{id,name:'oat milk',query:'oat milk',quantity:null,requestedQuantity:2,requestedUnit:'bag',unit:'can',resolution:'needs_unit',candidates:[]}]),JSON.stringify({kind:'question',id:randomUUID(),lineId:id,version:0})]);
 const provider:Interpreter={name:'no-ai-for-unit-reply',mode:'mock',interpret:async()=>{throw new Error('Unexpected inference');}};
 const s=await turn(inbox,new ConversationRuntime(pool,provider,{visualOrdering:true}),{id:randomUUID(),type:'text',text:'2'});
 assert.notEqual(s.messages.at(-1)?.rich?.stage,'error');assert.equal(s.conversation.draft[0].quantity,null);assert.equal(s.requests.length,0);
}));

test('understanding receives real family IDs, fresh names and specifications instead of a fixed shop dictionary',()=>{
 const prompt=JSON.parse(understandingPrompt({text:'find a drink',state:empty,catalogMap:{store:{name:'New shop',type:'grocery'},productCount:1,truncated:false,departments:[{id:'food',label:'Food',count:1,families:[{id:'new-family',label:'New beverages',aliases:['drink'],count:1}]}]},observations:[{tool:'discover_products',query:'drink',totalCount:1,products:[{sku:'NEW',name:'New drink',unit:'can',pricePaise:100,stock:1,version:1,aliases:[],quantityStep:1,specifications:{flavour:'oat'}}]}]}));
 assert.equal(prompt.storeContext.families[0].id,'new-family');assert.equal(prompt.catalogObservations[0].products[0].specifications.flavour,'oat');
});


test('grounding binds selected SKUs to the actual attribute-expanded item query',()=>{
 const source='two white oat milk',item={ordinal:0,sourceText:source,query:'oat milk',colour:'white',purchaseCount:2,unresolved:[],search:{keywords:['oat milk']}};
 const raw={...base(),intents:['add'],requestedItems:[item]},original=understandingToInterpretation(raw,{text:source,state:empty},false);
 const product={sku:'OAT',name:'White oat milk',unit:'can',pricePaise:100,stock:1,version:1,aliases:[],quantityStep:1};
 const observations=[{tool:'discover_products' as const,query:'white oat milk',products:[product],totalCount:1}];
 const grounded=understandingToInterpretation({...raw,requestedItems:[{...item,search:{...item.search,selectedSkus:['OAT']}}]},{text:source,state:empty,proposal:original,observations},false);
 assert.equal(validateInventoryReplan(original,grounded,observations).operations.length,1);
});

test('semantic inventory lookup and price remain read-only through grounding',()=>{
 for(const intent of ['lookup','price']){
  const source='show white oat milk',item={ordinal:0,sourceText:source,query:'oat milk',colour:'white',purchaseCount:null,unresolved:[],search:{keywords:['oat milk']}};
  const raw={...base(),intents:[intent],requestedItems:[item]},original=understandingToInterpretation(raw,{text:source,state:empty},false);
  const product={sku:'OAT',name:'White oat milk',unit:'can',pricePaise:100,stock:1,version:1,aliases:[],quantityStep:1};
  const observations=[{tool:'discover_products' as const,query:original.assistance?.queries[0]??original.priceQuery!,products:[product],totalCount:1}];
  const grounded=understandingToInterpretation({...raw,requestedItems:[{...item,search:{...item.search,selectedSkus:['OAT']}}]},{text:source,state:empty,proposal:original,observations},false);
  const plan=validateInventoryReplan(original,grounded,observations);assert.deepEqual(plan.operations,[]);assert.equal(plan.next,intent==='lookup'?'assist':'price');
 }
});


test('an observed semantic selection can match a synonym without the literal query head',()=>fixture(async(pool,inbox)=>{
 const source='two plant beverages',raw={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'plant beverages',purchaseCount:2,unresolved:[],search:{keywords:['oat drink']}}]};
 let calls=0;const provider:Interpreter={name:'controlled-semantic-synonym',mode:'mock',unifiedUnderstanding:true,interpret:async input=>{
  calls++;const proposal=calls===1?raw:{...raw,requestedItems:raw.requestedItems.map(item=>({...item,search:{...item.search,selectedSkus:['OAT']}}))};
  return {output:understandingToInterpretation(proposal,input,false),usage:null,truncated:false};
 }};
 const s=await turn(inbox,new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true}),{id:randomUUID(),type:'text',text:source});
 assert.equal(calls,2);assert.deepEqual(s.conversation.draft[0].candidates?.map(p=>p.sku),['OAT']);assert.equal(s.requests.length,0);assert.ok(!s.conversation.draft[0].productConfirmation);
}));


test('a replacement cannot select a SKU observed for a different requested replacement',()=>{
 const source='replace hammer with oat drink',edit={kind:'replace',targetLineId:id,targetQuery:'hammer',sourceText:source,query:'oat drink',search:{keywords:['oat drink']}};
 const raw={...base(),proposedEdits:[edit]},original=understandingToInterpretation(raw,{text:source,state:cart,inventoryGrounding:true},false);
 const product={sku:'DAIRY',name:'Dairy milk',unit:'can',pricePaise:100,stock:1,version:1,aliases:[],quantityStep:1};
 const observations=[{tool:'discover_products' as const,query:'oat drink',products:[],totalCount:0},{tool:'discover_products' as const,query:'dairy milk',products:[product],totalCount:1}];
 assert.throws(()=>understandingToInterpretation({...raw,proposedEdits:[{...edit,search:{...edit.search,selectedSkus:['DAIRY']}}]},{text:source,state:cart,inventoryGrounding:true,proposal:original,observations},false),/this item’s fresh inventory/);
});
