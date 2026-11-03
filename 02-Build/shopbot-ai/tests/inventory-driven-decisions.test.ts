import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {understandingToInterpretation,understandingPrompt,inventoryGroundingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';
import {discoverProducts,refinementPlan} from '../apps/server/src/services/catalog-discovery.js';
import {validateCurrentTurn} from '../apps/server/src/services/current-turn.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {validateInventoryReplan,inventoryCandidateFacts} from '../apps/server/src/services/inventory-grounding.js';
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
  const plan=understandingToInterpretation({...base(),proposedEdits:[{kind,sourceText:source,targetLineId:id,targetQuery:'hammer',quantity:2,countEvidence:{sourceText:countPhrase,value:2,mode},...(kind==='increment_quantity'?{additionalEvidence:'increase'}:{})}]},{text:source,state:cart,inventoryGrounding:true},false);
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

test('multiple observed semantic choices do not inherit the first alias match pack size',()=>fixture(async(pool,inbox)=>{
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,aliases,specifications,image_path,selling_unit_verified) VALUES($1,'OAT-SMALL','Other Oat Beverage 500ml','can',5000,10,'plant-drinks','[]','{\"pack_size\":\"500 ml\"}','/fixtures/OAT-SMALL.jpg',true)",[inbox.context.storeId]);
 const c=await pool.connect();try{
  const search={keywords:['oat drink'],selectedSkus:['OAT','OAT-SMALL']};
  const choices=await discoverProducts(c,inbox.context,'oat drink',search);assert.deepEqual(new Set(choices.products.map(p=>p.sku)),new Set(search.selectedSkus));
  const limited=await discoverProducts(c,inbox.context,'oat drink',{...search,specifications:{pack_size:'1 litre'}});assert.deepEqual(limited.products.map(p=>p.sku),['OAT']);
 }finally{c.release();}
}));

test('the single evidence repair also grounds replacement photos without a third model call',()=>fixture(async(pool,inbox)=>{
 const old=randomUUID(),untouched=randomUUID();
 await pool.query('UPDATE conversations SET draft=$1::jsonb WHERE id=$2',[JSON.stringify([{id:old,name:'Dairy milk',query:'dairy milk',quantity:3,resolution:'needs_choice'},{id:untouched,name:'Rice flour',query:'rice flour',quantity:7,resolution:'unavailable'}]),inbox.context.conversationId]);
 const source='The dairy milk is wrong; I meant oat drink';
 const rejected={...base(),intents:['edit','add'],requestedItems:[{ordinal:0,sourceText:'oat drink',query:'oat drink',purchaseCount:null,unresolved:['quantity'],search:{keywords:['oat drink']}}],proposedEdits:[{kind:'remove_item',targetLineId:old,targetQuery:'dairy milk',sourceText:'dairy milk'}]};
 let calls=0;
 const provider:Interpreter={name:'controlled-repair-with-inventory',mode:'mock',unifiedUnderstanding:true,interpret:async input=>{
  if(++calls===1)return {output:{operations:[],next:'continue',understanding:{...base(),unresolved:['validation_recovery']}},evidenceRepair:{understanding:rejected as any,feedback:'Use one complete replacement.'},usage:null,truncated:false};
  assert.equal(calls,2);assert.ok(input.planningFeedback?.includes('same repair'));
  assert.equal(input.observations?.[0].query,'oat drink');assert.ok(input.observations?.[0].products.some(p=>p.sku==='OAT'));
  const repaired={...base(),proposedEdits:[{kind:'replace',targetLineId:old,targetQuery:'dairy milk',query:'oat drink',sourceText:source,search:{keywords:['oat drink'],selectedSkus:['OAT']}}]};
  return {output:understandingToInterpretation(repaired,input,false),usage:null,truncated:false};
 }};
 const snapshot=await turn(inbox,new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true}),{id:randomUUID(),type:'text',text:source});
 assert.equal(calls,2);assert.equal(snapshot.requests.length,0);assert.equal(snapshot.conversation.draft.length,2);
 const line=snapshot.conversation.draft[0];assert.equal(line.id,old);assert.equal(line.quantity,3);assert.deepEqual(line.candidates?.map(p=>p.sku),['OAT']);assert.ok(!line.productConfirmation);
 assert.equal(snapshot.conversation.draft[1].id,untouched);assert.equal(snapshot.conversation.draft[1].quantity,7);
 assert.ok(snapshot.messages.at(-1)?.rich?.parts?.some(part=>part.cards.some(card=>card.kind==='product'&&card.product.imageUrl==='/fixtures/OAT.jpg')));
 const attempts=(await pool.query('SELECT stage,state FROM provider_attempts WHERE conversation_id=$1 ORDER BY created_at',[inbox.context.conversationId])).rows;
 assert.deepEqual(attempts.map(a=>[a.stage,a.state]),[['identify','failed'],['repair','succeeded']]);
}));

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
 const prompt=JSON.parse(understandingPrompt({text:source,state:cart,inventoryGrounding:true,inventoryReplan:true,proposal:original,observations}));
 assert.deepEqual(prompt.groundingTargets,{items:[],replacements:[{index:0,query:'oat drink'}]});
 assert.throws(()=>understandingToInterpretation({...raw,proposedEdits:[{...edit,search:{...edit.search,selectedSkus:['DAIRY']}}]},{text:source,state:cart,inventoryGrounding:true,proposal:original,observations},false),/this item’s fresh inventory/);
});


test('an empty unobserved SKU array is absence, while an observed rejection stays explicit',()=>{
 const source='two oat drinks',raw={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'oat drink',purchaseCount:2,unresolved:[],search:{keywords:['oat drink'],selectedSkus:[]}}]};
 const original=understandingToInterpretation(raw,{text:source,state:empty},false);
 assert.equal(original.understanding!.requestedItems[0].search?.selectedSkus,undefined);
 assert.equal((original.operations[0] as any).search.selectedSkus,undefined);
 const rejected=understandingToInterpretation(raw,{text:source,state:empty,proposal:original,observations:[{tool:'discover_products',query:'oat drink',products:[],totalCount:0}]},false);
 assert.deepEqual(rejected.understanding!.requestedItems[0].search?.selectedSkus,[]);
});

test('optional count evidence cannot turn a measured pack with unknown count into a purchase amount',()=>{
 const source='நாலு லிட்டர் ஒயிட் பெயிண்ட் வேணும்',raw={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'white paint',purchaseCount:null,packSize:{value:4,unit:'litre'},countEvidence:{sourceText:'நாலு லிட்டர்',value:4,mode:'total'},unresolved:[],attributeEvidence:[],dimensions:[]}]};
 const plan=understandingToInterpretation(raw,{text:source,state:empty},false);
 assert.equal((plan.operations[0] as any).quantity,null);assert.deepEqual((plan.operations[0] as any).packSize,{value:4,unit:'litre'});assert.equal(plan.understanding!.requestedItems[0].countEvidence,undefined);
});

test('grounding search patches preserve all source fields and cannot invent a pack or rewrite counts',()=>{
 const source='two oat drinks',item={ordinal:1,sourceText:source,query:'oat drinks',purchaseCount:2,unresolved:['variant'],search:{keywords:['oat drink'],familyIds:['dairy-drinks']}};
 const raw={...base(),intents:['add'],requestedItems:[item]},original=understandingToInterpretation(raw,{text:source,state:empty},false);
 const observations=[{tool:'discover_products' as const,query:'oat drinks',products:[{sku:'OAT',name:'Oat Drink',unit:'can',pricePaise:100,stock:1,version:1,aliases:[],quantityStep:1,familyId:'plant-drinks'}],totalCount:1}];
 const input={text:source,state:empty,proposal:original,observations,inventoryReplan:true};
 const patch={items:[{ordinal:1,query:'oat drink',search:{keywords:['oat drink'],selectedSkus:['OAT'],familyIds:['dairy-drinks']}}],replacements:[]};
 const plan=inventoryGroundingToInterpretation(patch,input,false);
 assert.equal((plan.operations[0] as any).quantity,2);assert.equal((plan.operations[0] as any).packSize,undefined);assert.equal((plan.operations[0] as any).search.familyIds,undefined);
 assert.deepEqual(plan.understanding!.requestedItems[0].unresolved,['variant']);assert.equal(validateInventoryReplan(original,plan,observations).operations.length,1);
 assert.throws(()=>inventoryGroundingToInterpretation({...patch,items:[{...patch.items[0],purchaseCount:10}]},input,false));
 assert.throws(()=>inventoryGroundingToInterpretation({...patch,items:[{...patch.items[0],search:{keywords:['drink'],selectedSkus:['FOREIGN']}}]},input,false),/fresh inventory/);
 assert.throws(()=>inventoryGroundingToInterpretation({...patch,items:[]},input,false),/observed items/);
});

test('semantic retrieval finds actual names across wrong family labels and remains store scoped',()=>fixture(async(pool,inbox)=>{
 await pool.query("UPDATE products SET family_id='dairy-drinks' WHERE store_id=$1 AND sku='OAT'",[inbox.context.storeId]);
 const c=await pool.connect();try{
  const products=await inventoryCandidateFacts(c,inbox.context,'oat drink',{keywords:['oat drink'],familyIds:['plant-drinks']});
  assert.equal(products[0].sku,'OAT');assert.equal(products[0].familyId,'dairy-drinks');
  assert.deepEqual(await inventoryCandidateFacts(c,{...inbox.context,storeId:randomUUID()},'oat drink',{keywords:['oat drink']}),[]);
 }finally{c.release();}
}));

test('a count expression that belongs only to a measurement cannot count packages',()=>{
 for(const [source,word] of [['நாலு லிட்டர் ஒயிட் பெயிண்ட்','நாலு'],['four litres of oat drink','four']]){
  const plan=understandingToInterpretation({...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'drink',purchaseCount:4,requestedAmount:{value:4,unit:'litre'},amountMode:'total',countEvidence:{sourceText:word,value:4,mode:'total'},unresolved:[]}]},{text:source,state:empty},false);
  assert.equal((plan.operations[0] as any).quantity,null);assert.equal((plan.operations[0] as any).requestedAmount.value,4);
 }
});

test('empty optional family hints do not reject an item or erase an explicit grounded rejection',()=>{
 const source='two oat drinks',raw={...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'oat drink',purchaseCount:2,unresolved:[],search:{keywords:['oat drink'],familyIds:[],identityQuery:null,useCase:null,clarifyType:null,selectedSkus:[]}}]};
 const original=understandingToInterpretation(raw,{text:source,state:empty},false);
 assert.equal((original.operations[0] as any).quantity,2);assert.equal(original.understanding!.requestedItems[0].search?.familyIds,undefined);
 const input={text:source,state:empty,proposal:original,observations:[{tool:'discover_products' as const,query:'oat drink',products:[],totalCount:0}]};
 const rejected=inventoryGroundingToInterpretation({items:[{ordinal:0,query:'oat drink',search:{keywords:['oat drink'],familyIds:[],selectedSkus:[]}}],replacements:[]},input,false);
 assert.deepEqual(rejected.understanding!.requestedItems[0].search?.selectedSkus,[]);
 assert.throws(()=>inventoryGroundingToInterpretation({items:[{ordinal:0,query:'oat drink',search:{keywords:[],selectedSkus:[]}}],replacements:[]},input,false));
});

test('replacement searches normalize absent family hints and still reject unknown keys',()=>{
 const source='replace hammer with oat drink',edit={kind:'replace',targetLineId:id,targetQuery:'hammer',sourceText:source,query:'oat drink',search:{keywords:['oat drink'],familyIds:[]}};
 const plan=understandingToInterpretation({...base(),proposedEdits:[edit]},{text:source,state:cart,inventoryGrounding:true},false);
 assert.equal((plan.operations[0] as any).search.familyIds,undefined);
 assert.throws(()=>understandingToInterpretation({...base(),proposedEdits:[{...edit,search:{...edit.search,unknownHint:'injected'}}]},{text:source,state:cart,inventoryGrounding:true},false));
});

for(const first of ['brand','spec:pack_size'])test(`144 products narrow using the agent's ${first} strategy, preserving counts and other cart rows`,()=>fixture(async(pool,inbox)=>{
 await pool.query('UPDATE products SET active=false WHERE store_id=$1',[inbox.context.storeId]);
 for(let b=0;b<3;b++)for(let p=0;p<4;p++)for(let f=0;f<4;f++)for(let tier=0;tier<3;tier++)await pool.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,brand,specifications,image_path,selling_unit_verified,aliases) VALUES($1,$2,$3,'can',$4,100,'plant-drinks',$5,$6::jsonb,'https://images.example.test/catalog.jpg',true,'["oat drink"]')`,[inbox.context.storeId,`DRINK-${b}${p}${f}${tier}`,`Field Oat Drink ${b}${p}${f}${tier}`,10000+tier*5000,`Farm ${b}`,JSON.stringify({pack_size:`${p+1} litre`,process:`Process ${f}`})]);
 const kept=randomUUID();await pool.query('UPDATE conversations SET draft=$1::jsonb WHERE id=$2',[JSON.stringify([{id:kept,query:'rice flour',name:'Rice flour',quantity:7,resolution:'unavailable'}]),inbox.context.conversationId]);
 const source='two oat drinks',steps=[first,...['brand','spec:pack_size','spec:process','price'].filter(k=>k!==first)];let calls=0;
 const provider:Interpreter={name:'synthetic-dynamic-narrowing',mode:'mock',unifiedUnderstanding:true,interpret:async input=>{
  calls++;let output:Interpretation;
  if(input.inventoryReplan){
   const facts=input.observations![0];assert.equal(facts.totalCount,144);assert.ok(facts.discovery!.facets.some(f=>f.key==='price'));assert.ok(JSON.parse(understandingPrompt(input)).catalogObservations[0].facets.some((f:any)=>f.key==='spec:process'));
   output=inventoryGroundingToInterpretation({items:[{ordinal:0,query:'oat drink',search:{keywords:['oat drink'],narrowing:steps.map(key=>({key,question:`Which ${key==='brand'?'farm':key==='spec:pack_size'?'pack size':key==='price'?'price range':'process'}?`}))}}],replacements:[]},input,false);
  }else output=understandingToInterpretation({...base(),intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'oat drink',purchaseCount:2,countEvidence:{sourceText:'two',value:2,mode:'total'},unresolved:[],search:{keywords:['oat drink']}}]},input,false);
  return {output,usage:null,truncated:false};
 }};
 const runtime=new ConversationRuntime(pool,provider,{inventoryGrounding:true,visualOrdering:true});let s=await turn(inbox,runtime,{id:randomUUID(),type:'text',text:source});
 const id=s.conversation.draft.find(l=>l.id!==kept)!.id;
 const entries=()=>s.messages.at(-1)!.rich!.parts![0].cards;
 const e=entries()[0].buttons![0].event;assert.equal(e.type,'refine_search');if(e.type==='refine_search')assert.equal(e.facet,first);assert.equal(calls,2);
 const initial=s,forged={...e,id:randomUUID(),facet:'spec:process',value:'Process 3'} as SimulatorEvent;const version=s.conversation.version;s=await turn(inbox,runtime,forged);assert.equal(s.conversation.version,version);
 for(let level=0;level<3;level++){
  const next:SimulatorEvent=level===0?e:entries()[0].buttons![0].event;assert.equal(next.type,'refine_search');if(next.type==='refine_search')assert.equal(next.facet,steps[level]);
  const rich=(level===0?initial:s).messages.at(-1)!.rich!;assert.ok(rich.text.length<100,JSON.stringify({level,text:rich.text}));assert.ok(rich.parts![0].cards.length<=10);
  s=await turn(inbox,runtime,next);assert.equal(s.conversation.draft.find(l=>l.id===id)!.quantity,2);assert.equal(s.conversation.draft.find(l=>l.id===kept)!.quantity,7);assert.equal(s.conversation.draft.find(l=>l.id===id)!.sku,undefined,'group examples are not selected products');
 }
 assert.equal(calls,2,'facet taps reuse the validated strategy');assert.equal(s.requests.length,0);assert.equal(s.conversation.draft.find(l=>l.id===id)!.candidates!.length,3);assert.ok(s.messages.at(-1)!.rich!.parts![0].cards.every(c=>c.kind==='product'));
}));

test('grounding rejects invented narrowing keys and a strategy combined with sampled SKUs',()=>{
 const source='oat drink',prior=understandingToInterpretation({...base(),intents:['lookup'],requestedItems:[{ordinal:0,sourceText:source,query:source,purchaseCount:null,unresolved:[],search:{keywords:[source]}}]},{text:source,state:empty},false);
 const input={text:source,state:empty,proposal:prior,inventoryReplan:true,observations:[{tool:'discover_products' as const,query:source,totalCount:100,products:[],discovery:{query:source,plan:{keywords:[source]},products:[],rankings:[],totalCount:100,retrievedCount:0,noExactMatch:false,facets:[{key:'brand',label:'Brand',values:[{value:'A',label:'A',count:50},{value:'B',label:'B',count:50}]}]}}]};
 for(const search of [{keywords:[source],narrowing:[{key:'spec:invented_premium',question:'Premium?'}]},{keywords:[source],selectedSkus:[],narrowing:[{key:'brand',question:'Which brand?'}]}])assert.throws(()=>inventoryGroundingToInterpretation({items:[{ordinal:0,query:source,search}],replacements:[]},input,false),/observed|strategy|selection/i);
});

test('metadata-poor inventory pages through all 203 actual products beyond the retrieval sample',()=>fixture(async(pool,inbox)=>{
 await pool.query('UPDATE products SET active=false WHERE store_id=$1',[inbox.context.storeId]);
 await pool.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,aliases) SELECT $1,'DRINK-'||lpad(n::text,4,'0'),'Field Oat Drink model '||n,'can',0,100,'plant-drinks','["oat drink"]' FROM generate_series(1,203) n`,[inbox.context.storeId]);
 const c=await pool.connect();try{
  let result=await discoverProducts(c,inbox.context,'oat drink',{keywords:['oat drink'],browseAll:true});const seen:string[]=[];
  for(let page=0;page<30;page++){
   assert.equal(result.facets.length,0);assert.ok(result.products.length<=10);seen.push(...result.products.map(p=>p.sku));
   const reply=catalogGroupReply(result,empty,{memoryId:randomUUID()})!;assert.ok(reply.parts![0].cards.length<=10);
   if(result.nextProductOffset===undefined)break;
   result=await discoverProducts(c,inbox.context,'oat drink',refinementPlan(result,'__products__','__more__'));
  }
  assert.equal(seen.length,203);assert.equal(new Set(seen).size,203);assert.ok(seen.includes('DRINK-0203'));
 }finally{c.release();}
}));

test('actual price bands filter known prices without inventing quality or treating price as count',()=>fixture(async(pool,inbox)=>{
 await pool.query('UPDATE products SET active=false WHERE store_id=$1',[inbox.context.storeId]);
 await pool.query(`INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,selling_unit_verified) SELECT $1,'OAT-'||n,'Field Oat Drink model '||n,'can',n*1000,100,'plant-drinks',true FROM generate_series(1,18) n`,[inbox.context.storeId]);
 await pool.query(`UPDATE products SET price_status='confirm' WHERE store_id=$1 AND sku='OAT-18'`,[inbox.context.storeId]);
 const c=await pool.connect();try{
  const result=await discoverProducts(c,inbox.context,'oat drink',{keywords:['oat drink'],narrowing:[{key:'price',question:'Which price range?'}]});
  const bands=result.facets.find(f=>f.key==='price')!;assert.equal(bands.values.length,3);assert.equal(bands.values.reduce((sum,v)=>sum+v.count,0),17);
  for(const value of bands.values){const [low,high]=value.value.split(':').map(Number);assert.doesNotMatch(value.label,/premium|budget|quality/i);const refined=await discoverProducts(c,inbox.context,'oat drink',refinementPlan(result,'price',value.value));assert.ok(refined.products.length);assert.ok(refined.products.every(p=>p.priceStatus==='priced'&&p.pricePaise>=low&&p.pricePaise<=high));assert.equal(refined.plan.specifications?.pack_size,undefined);assert.equal(refined.plan.selectedSkus,undefined);}
 }finally{c.release();}
}));
