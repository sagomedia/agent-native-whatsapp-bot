import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {Resvg} from '@resvg/resvg-js';
import {FinishReason,type GenerateContentResponse,type GenerateContentParameters} from '@google/genai';
import {understandingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';
import {GoogleInterpreter,readNativeSettings,type NativeSettings} from '../apps/server/src/adapters/google-interpreter.js';
import {spokenMeasures,catalogMeasures,matchesProductMeasures,explicitPurchaseCount} from '../apps/server/src/services/quantity-evidence.js';
import {normalize} from '../packages/contracts/catalog-text.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {initializeBudget} from '../apps/server/src/services/inference-budget.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {normalizeImage} from '../apps/server/src/services/image-media.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {markProductConfirmed} from '../apps/server/src/services/product-verification.js';
import {cartProgress} from '../apps/server/src/services/visual-ordering.js';
import {formatMoney} from '../packages/contracts/money.js';
import type {ConversationState,Product} from '../packages/contracts/index.js';
const state:ConversationState={version:0,draft:[],pending:null,fulfillment:'pickup',lastRequestId:null,replyLanguage:'en'};
const settings:NativeSettings={allowPaidInference:true,apiKey:'offline-only',model:'gemini-3.5-flash-lite',budgetMicrousd:5000000,allowMultimodal:true,unifiedUnderstanding:true,allowImageLists:true};
const base=(inputKind='text')=>({schemaVersion:2,inputKind,intents:['add'],requestedItems:[],proposedEdits:[],shopQuestions:[],unresolved:[]});
const item=(sourceText:string,query:string|null,count:number|null=1,ordinal=0)=>({ordinal,sourceText,query,purchaseCount:count,unresolved:query===null?['unreadable']:[]});
const response=(output:unknown):GenerateContentResponse=>({modelVersion:settings.model,candidates:[{finishReason:FinishReason.STOP,content:{parts:[{text:JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:100,totalTokenCount:1100}} as GenerateContentResponse);

test('fractions, mixed fractions and local amounts do not become denominators or counts',()=>{
 for(const [phrase,value] of [['1/2 inch pipe',.5],['3/4 inch pipe',.75],['1 1/2 inch pipe',1.5],['½ inch pipe',.5],['kaal kilo',.25],['ara kilo',.5]] as const){assert.equal(spokenMeasures(phrase)[0]?.value,value,phrase);assert.equal(explicitPurchaseCount(phrase),undefined,phrase);}
 assert.equal(explicitPurchaseCount('one 1 1/2 inch pipe'),1);assert.deepEqual(spokenMeasures('1/0 inch'),[]);assert.equal(normalize('1/2 inch pipe'),normalize('0.5 inch pipe'));
});
test('dimensions preserve their role and convert compatible physical units',()=>{
 const product={sku:'P',name:'fixture',unit:'piece',pricePaise:100,stock:2,version:1,aliases:[],quantityStep:1,specifications:{diameter:'1/2 inch',length:'2 inch'}} as Product;
 assert.ok(catalogMeasures(product).some(m=>m.value===.5&&m.role==='diameter'));assert.equal(matchesProductMeasures(product,[{value:2,unit:'inch',role:'diameter'}]),false);assert.equal(matchesProductMeasures(product,[{value:12.7,unit:'mm',role:'diameter'}]),true);
});
test('the common contract separates pack size, count, budget and unknown amounts',()=>{
 const source='rendu 10 litre white paint dabba venum';
 const output={...base('audio'),transcript:source,requestedItems:[{...item(source,'white paint',2),requestedContainer:'can',packSize:{value:10,unit:'litre'},unresolved:['variant']}]};
 const plan=understandingToInterpretation(output,{text:'current recording',audio:{mimeType:'audio/wav',data:'AAAA',durationSeconds:20},state},true);
 assert.equal(plan.operations[0].kind,'add_item');assert.equal((plan.operations[0] as any).quantity,2);assert.deepEqual((plan.operations[0] as any).packSize,{value:10,unit:'litre'});
 assert.throws(()=>understandingToInterpretation({...output,requestedItems:[item('invented words','paint')]},{text:'audio',audio:{mimeType:'audio/wav',data:'AAAA',durationSeconds:1},state},true),/evidence/);
});
test('availability-only questions remain read-only while mixed shopping and hours retain both intents',()=>{
 const lookup=understandingToInterpretation({...base(),intents:['lookup'],requestedItems:[item('Do you have white paint?','white paint',null)]},{text:'Do you have white paint?',state},true);assert.equal(lookup.next,'assist');assert.deepEqual(lookup.operations,[]);
 const mixed=understandingToInterpretation({...base(),intents:['add','store_info'],requestedItems:[item('two brushes','brush',2)],shopQuestions:['hours']},{text:'two brushes; when do you close?',state},true);assert.equal(mixed.operations.length,1);assert.deepEqual(mixed.shopQuestions,['hours']);
});
test('images cannot edit or submit orders, and list mode preserves unreadable and crossed-out evidence',()=>{
 const observed='2 H07\n[unreadable]\nH10 crossed out';
 const image={mimeType:'image/jpeg' as const,data:'AAAA'};
 const output={...base('handwritten_list'),observedText:observed,intents:['add','submit'],requestedItems:[item('2 H07','H07',2),item('[unreadable]',null,null,1),{...item('H10 crossed out','H10',1,2),crossedOut:true}]};
 const plan=understandingToInterpretation(output,{text:'send it',image,state},true);assert.equal(plan.operations.length,2);assert.ok((plan.operations[1] as any).sourceUncertainty.includes('unreadable'));assert.equal(plan.understanding!.requestedItems.length,3);assert.equal(plan.next,'review');
 const disabled=understandingToInterpretation(output,{text:'',image,state},false);assert.deepEqual(disabled.operations,[]);
 assert.throws(()=>understandingToInterpretation({...output,proposedEdits:[{kind:'remove_item',targetLineId:randomUUID(),sourceText:'2 H07'}]},{text:'',image,state},true),/Images cannot edit/);
 const photo=understandingToInterpretation({...base('product_photo'),observedText:'H07',requestedItems:[item('H07','H07',1)],intents:['add','submit']},{text:'',image,state},true);assert.deepEqual(photo.operations,[]);assert.equal(photo.next,'assist');
});
test('only current targets with source evidence can be edited',()=>{
 const id=randomUUID(),draft={...state,draft:[{id,name:'brush',query:'brush',quantity:1,resolution:'needs_quantity' as const}]};
 const output={...base(),intents:['edit'],proposedEdits:[{kind:'set_quantity',targetLineId:id,quantity:2,sourceText:'make brush two'}]};
 assert.equal(understandingToInterpretation(output,{text:'make brush two',state:draft},true).operations[0].kind,'set_quantity');
 assert.throws(()=>understandingToInterpretation({...output,proposedEdits:[{...output.proposedEdits[0],targetLineId:randomUUID()}]},{text:'make brush two',state:draft},true),/current/);
});
test('Flash Lite flags are explicit and long audio uses the common structured request once',async()=>{
 const config=readNativeSettings({ALLOW_PAID_INFERENCE:'true',GEMINI_API_KEY:'offline',AI_BUDGET_USD:'1',ALLOW_MULTIMODAL_INFERENCE:'true',GEMINI_UNIFIED_UNDERSTANDING_ENABLED:'true',GEMINI_HANDWRITTEN_LISTS_ENABLED:'true'} as any);assert.equal(config.model,settings.model);assert.equal(config.maxOutputTokens,16384);assert.equal(config.unifiedUnderstanding,true);
 let calls=0,request:GenerateContentParameters|undefined;
 const provider=new GoogleInterpreter(settings,{generateContent:async p=>{calls++;request=p;return response({...base('audio'),transcript:'two H07',requestedItems:[item('two H07','H07',2)]});}});
 const result=await provider.interpret({stage:'identify',text:'recording',audio:{mimeType:'audio/wav',data:'AAAA',durationSeconds:20},state},AbortSignal.timeout(1000));assert.equal(calls,1);assert.equal(request!.model,settings.model);assert.equal(request!.config?.candidateCount,undefined);assert.equal(request!.config?.temperature,undefined);assert.ok(!JSON.stringify(request).includes('publicCatalog'));assert.equal(result.validationIssues,undefined);assert.equal(provider.recognitionProviderFor({text:'',state}),provider);assert.match(provider.name,/understanding-v2/);
});
async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='unified_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA "${schema}"`);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});try{await setupDatabase(pool,'mock');await setupImageDemo(pool);const id=randomUUID();await pool.query('INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,$3)',[id,demoCatalogStore,'unified-test']);const inbox=new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'unified-test',role:'customer'});await initializeBudget(pool,inbox.context,settings.budgetMicrousd);await run(pool,inbox);}finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}}
function runtime(pool:pg.Pool,output:()=>unknown,counter?:{calls:number}){return new ConversationRuntime(pool,new GoogleInterpreter(settings,{generateContent:async()=>{if(counter)counter.calls++;return response(output());}}),{allowPaidInference:true,visualOrdering:true,sequentialItems:true});}
test('existing image storage upgrades idempotently for full-size list uploads',async()=>fixture(async(pool,inbox)=>{
 await pool.query('DELETE FROM schema_migrations WHERE version=26; ALTER TABLE image_media DROP CONSTRAINT image_media_width_check; ALTER TABLE image_media DROP CONSTRAINT image_media_height_check; ALTER TABLE image_media ADD CONSTRAINT image_media_width_check CHECK(width>0 AND width<=1280); ALTER TABLE image_media ADD CONSTRAINT image_media_height_check CHECK(height>0 AND height<=1280)');
 await setupDatabase(pool,'mock');await setupDatabase(pool,'mock');
 const id=randomUUID(),data=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1800"><rect width="2048" height="1800" fill="white"/></svg>').render().asPng();
 const media=await normalizeImage({id,mimeType:'image/png',data:Buffer.from(data).toString('base64'),caption:''},{maxSide:2048});assert.equal(media.width,2048);assert.equal(media.height,1800);
 await inbox.ingest({id,type:'image',mediaId:id,caption:''},undefined,media);
 assert.deepEqual((await pool.query('SELECT width,height FROM image_media WHERE id=$1',[id])).rows[0],{width:2048,height:1800});
 await assert.rejects(pool.query('UPDATE image_media SET width=2049 WHERE id=$1',[id]),/image_media_width_check/);
}));
async function text(inbox:SimulatorService,r:ConversationRuntime,value:string){await inbox.ingest({id:randomUUID(),type:'text',text:value});await r.processNext(inbox.context);return inbox.snapshot();}
async function photo(inbox:SimulatorService,r:ConversationRuntime){const id=randomUUID(),media=await normalizeImage({id,mimeType:'image/jpeg',data:(await readFile('resources/catalog/ksmc-demo/images/H14.jpg')).toString('base64'),caption:''});const event={id,type:'image' as const,mediaId:id,caption:''};await inbox.ingest(event,undefined,media);await r.processNext(inbox.context);return {event,media,snapshot:await inbox.snapshot()};}

test('one audio understanding stage preserves long-note count and does not submit a draft',async()=>fixture(async(pool,inbox)=>{
 const counter={calls:0},r=runtime(pool,()=>({...base('audio'),transcript:'two H07',requestedItems:[item('two H07','H07',2)]}),counter);
 const id=randomUUID();await inbox.ingest({id,type:'voice',mediaId:id},{audio:Buffer.from('RIFF controlled transcript fixture'),durationSeconds:20,sourceHash:'controlled'});await r.processNext(inbox.context);const s=await inbox.snapshot();assert.equal(counter.calls,1);assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.requests.length,0);assert.deepEqual((await pool.query('SELECT stage,state FROM provider_attempts')).rows,[{stage:'identify',state:'succeeded'}]);
}));
test('OCR retains every unresolved line, duplicate events are idempotent, and help retains the whole list',async()=>fixture(async(pool,inbox)=>{
 const observed='2 H07\n[unreadable]\n1 H10',counter={calls:0};
 const r=runtime(pool,()=>({...base('handwritten_list'),observedText:observed,requestedItems:[item('2 H07','H07',2),item('[unreadable]',null,null,1),item('1 H10','H10',1,2)]}),counter);
 const {event,media,snapshot:s}=await photo(inbox,r);assert.equal(s.conversation.draft.length,3);assert.equal(s.conversation.draft[1].catalogIssue,'unreadable');assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.conversation.draft[2].quantity,1);assert.equal(s.requests.length,0);assert.equal(counter.calls,1);assert.equal((await inbox.ingest(event,undefined,media)).duplicate,true);assert.equal(await r.processNext(inbox.context),false);assert.equal(counter.calls,1);
 const after=await text(inbox,r,'send my list to the store');assert.equal(after.requests.length,0);assert.deepEqual(after.conversation.draft,s.conversation.draft);assert.equal((await pool.query('SELECT operator_mode,handoff_requested FROM conversations WHERE id=$1',[inbox.context.conversationId])).rows[0].operator_mode,'assistant');const help=await text(inbox,r,'talk to shop');assert.equal(help.requests.length,0);assert.deepEqual(help.conversation.draft,s.conversation.draft);assert.equal((await pool.query('SELECT operator_mode,handoff_requested FROM conversations WHERE id=$1',[inbox.context.conversationId])).rows[0].operator_mode,'owner');
}));
test('malformed OCR evidence cannot partially add valid-looking items',async()=>fixture(async(pool,inbox)=>{
 const r=runtime(pool,()=>({...base('handwritten_list'),observedText:'H07',requestedItems:[item('H07','H07'),item('invented item','H10',1,1)]}));await photo(inbox,r);assert.equal((await inbox.snapshot()).conversation.draft.length,0);assert.equal((await pool.query("SELECT state FROM provider_attempts")).rows[0].state,'failed');
}));
test('a price/stock lookup keeps a live draft unchanged and mixed hours do not lose additions',async()=>fixture(async(pool,inbox)=>{
 let output:any={...base(),requestedItems:[item('one H07','H07')]};const r=runtime(pool,()=>output);let s=await text(inbox,r,'one H07');const draft=structuredClone(s.conversation.draft);
 output={...base(),intents:['price'],requestedItems:[item('H07 price','H07',null)]};s=await text(inbox,r,'H07 price');assert.deepEqual(s.conversation.draft,draft);
 output={...base(),intents:['add','store_info'],requestedItems:[item('one H10','H10')],shopQuestions:['hours']};s=await text(inbox,r,'one H10; when do you close?');assert.equal(s.conversation.draft.length,2);assert.match(s.messages.at(-1)!.text,/hours|opening|கடை|Kadai/);
}));
test('budget proposals calculate only verified selling quantities and preserve unknown-price requests',async()=>fixture(async(pool,inbox)=>{
 await pool.query("UPDATE products SET selling_unit_verified=true,price_paise=2000,quantity_step=1 WHERE store_id=$1 AND sku='H07'",[demoCatalogStore]);
 const r=runtime(pool,()=>({...base(),requestedItems:[{...item('H07 for 50 rupees','H07',null),requestedBudgetPaise:5000}]}));let s=await text(inbox,r,'H07 for 50 rupees');assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.conversation.draft[0].requestedBudgetPaise,5000);assert.equal(s.requests.length,0);
}));

test('uncertain OCR count remains unknown even when a digit is legible',async()=>fixture(async(pool,inbox)=>{
 const r=runtime(pool,()=>({...base('handwritten_list'),observedText:'2? H07',requestedItems:[{...item('2? H07','H07',2),unresolved:['quantity']}]}));const {snapshot:s}=await photo(inbox,r);assert.equal(s.conversation.draft[0].quantity,null);assert.equal(s.requests.length,0);
}));
test('a customer can repair an unreadable line without changing the other list items',async()=>fixture(async(pool,inbox)=>{
 let output:any={...base('handwritten_list'),observedText:'H07\n[unreadable]',requestedItems:[item('H07','H07'),item('[unreadable]',null,null,1)]};const r=runtime(pool,()=>output);const {snapshot:s}=await photo(inbox,r);const id=s.conversation.draft[1].id;
 output={...base(),intents:['edit'],proposedEdits:[{kind:'replace',targetLineId:id,query:'H10',sourceText:'second item is H10'}]};const after=await text(inbox,r,'second item is H10');assert.equal(after.conversation.draft.length,2);assert.equal(after.conversation.draft[0].id,s.conversation.draft[0].id);assert.equal(after.conversation.draft[1].id,id);assert.equal(after.conversation.draft[1].sku,'H10');assert.equal(after.conversation.draft[1].catalogIssue,undefined);
}));
test('a product photo cannot place an order even when its caption asks to send it',async()=>fixture(async(pool,inbox)=>{
 const r=runtime(pool,()=>({...base('product_photo'),observedText:'H07',intents:['add','submit'],requestedItems:[item('H07','H07')]}));await photo(inbox,r);const s=await inbox.snapshot();assert.equal(s.conversation.draft.length,0);assert.equal(s.requests.length,0);
}));
test('budget-derived quantities refresh when price changes and unknown prices stay pending',async()=>fixture(async(pool,inbox)=>{
 await pool.query("UPDATE products SET selling_unit_verified=true,price_paise=2000 WHERE store_id=$1 AND sku='H07'",[demoCatalogStore]);
 let output:any={...base(),requestedItems:[{...item('H07 for 50 rupees','H07',null),requestedBudgetPaise:5000}]};const r=runtime(pool,()=>output);let s=await text(inbox,r,'H07 for 50 rupees');assert.equal(s.conversation.draft[0].quantity,2);
 await pool.query("UPDATE products SET price_paise=3000,version=version+1 WHERE store_id=$1 AND sku='H07'",[demoCatalogStore]);s=await text(inbox,r,'review');assert.equal(s.conversation.draft[0].quantity,1);assert.equal(s.requests.length,0);
 output={...base(),requestedItems:[{...item('H10 for 50 rupees','H10',null),requestedBudgetPaise:5000}]};await pool.query("UPDATE products SET price_status='confirm',price_paise=0 WHERE store_id=$1 AND sku='H10'",[demoCatalogStore]);s=await text(inbox,r,'H10 for 50 rupees');assert.equal(s.conversation.draft[1].quantity,null);assert.equal(s.conversation.draft[1].catalogIssue,'budget_unverified');assert.equal(s.requests.length,0);
}));

test('a refusal of offered photos cannot be turned into a line removal by the model',()=>{
 const id=randomUUID(),draft={...state,draft:[{id,name:'brush',query:'brush',quantity:1,resolution:'needs_quantity' as const}]};
 assert.throws(()=>understandingToInterpretation({...base(),intents:['edit'],proposedEdits:[{kind:'remove_item',targetLineId:id,sourceText:'not correct'}]},{text:'not correct',state:draft},true),/explicit current intent/);
});

const repeatedSpeech='எனக்கு வந்து ரெண்டு பைப்பு அண்ட் தண்ணீர் ஊற்ற ஓஸ் ஒன்னு நெக்ஸ்ட் வந்து இது ஒரு இன்ச் பைப்பு ஆல்ரெடி சொல்லிட்டேன் பட் இருந்தாலும் இது சுவர பெயிண்ட் எடுக்கணும். பெயிண்ட் எடுக்கிற கத்தி உப்பு தாளு இருந்தா ரெண்டு.';
const recordedUnderstanding=()=>({...base('audio'),transcript:repeatedSpeech,requestedItems:[item('பைப்பு','pipe',2),item('தண்ணீர் ஊற்ற ஓஸ்','water hose',1,1),{...item('ஒரு இன்ச் பைப்பு','pipe',null,2),dimensions:[{value:1,unit:'inch',role:'diameter'}]},item('சுவர பெயிண்ட் எடுக்கணும். பெயிண்ட் எடுக்கிற கத்தி','paint scraper',null,3),item('உப்பு தாளு','sandpaper',2,4)]});
async function recordedVoice(inbox:SimulatorService,r:ConversationRuntime){const id=randomUUID();await inbox.ingest({id,type:'voice',mediaId:id},{audio:Buffer.from('RIFF controlled recorded-turn response'),durationSeconds:22.9735,sourceHash:'controlled-repeat'});await r.processNext(inbox.context);return inbox.snapshot();}
test('the observed repeated speech binds two pipes and one-inch diameter to one item',()=>{
 const plan=understandingToInterpretation(recordedUnderstanding(),{text:'recording',audio:{mimeType:'audio/wav',data:'AAAA',durationSeconds:23},state},true);
 assert.equal(plan.operations.length,4);assert.equal((plan.operations[0] as any).quantity,2);assert.deepEqual((plan.operations[0] as any).productMeasures,[{role:'diameter',unit:'inch',value:1}]);assert.match((plan.operations[0] as any).supportingPhrase,/ரெண்டு/);
 assert.equal((plan.operations[1] as any).quantity,1);assert.equal((plan.operations[1] as any).productMeasures,undefined);
});
test('the recorded voice updates the prior three-line cart into four unique products',async()=>fixture(async(pool,inbox)=>{
 const tools=new RetailTools(pool),old=(await tools.invoke(inbox.context,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'H02',quantity:2},{kind:'add_item',query:'H22',quantity:1},{kind:'add_item',query:'H13',quantity:null}]}},'seed-recorded-cart')).state!;
 old.draft[0].query='1 inch pipe';old.draft[1].query='scraper';old.draft[2].query='garden hose';
 for(const l of old.draft.slice(0,2))markProductConfirmed(l,l.candidates![0]);
 await pool.query('UPDATE conversations SET draft=$1::jsonb WHERE id=$2',[JSON.stringify(old.draft),inbox.context.conversationId]);
 const counter={calls:0},r=runtime(pool,recordedUnderstanding,counter),s=await recordedVoice(inbox,r);
 assert.equal(counter.calls,1);assert.equal(s.conversation.draft.length,4);assert.deepEqual(s.conversation.draft.slice(0,3).map(l=>l.id),old.draft.map(l=>l.id));
 assert.deepEqual(s.conversation.draft.slice(0,3).map(l=>[l.sku,l.quantity]),[['H02',2],['H22',1],['H13',1]]);assert.equal(s.conversation.draft[3].query,'sandpaper');assert.equal(s.conversation.draft[3].resolution,'unavailable');assert.equal(s.requests.length,0);
}));
test('a fresh recorded list asks pipe type before product and quantity choices',async()=>fixture(async(pool,inbox)=>{
 let output:any=recordedUnderstanding();const r=runtime(pool,()=>output);let s=await recordedVoice(inbox,r);assert.equal(s.conversation.draft.length,4);
 assert.equal(s.conversation.pending?.kind,'question');assert.match(s.messages.at(-1)!.text,/kind|type|வகை|vagai/);assert.equal(s.conversation.draft[0].sku,undefined);
 const pipe=s.conversation.draft[0];output={...base(),intents:['edit'],requestedItems:[{...item('PVC pipe','1 inch PVC pipe',2),targetLineId:pipe.id}]};s=await text(inbox,r,'PVC pipe');
 for(const sku of ['H01','H13','H22']){
  const pending=s.conversation.pending;assert.equal(pending?.kind,'products');if(pending?.kind!=='products')throw new Error('No product check');
  const g=pending.groups.find(g=>g.products.some(p=>p.sku===sku)&&!s.conversation.draft.find(l=>l.id===g.lineId)?.productConfirmation);assert.ok(g,sku);
  await inbox.ingest({id:randomUUID(),type:'select_product',batchId:pending.id,lineId:g!.lineId,sku});await r.processNext(inbox.context);s=await inbox.snapshot();
 }
 assert.equal(s.conversation.pending?.kind,'question');const question=s.conversation.pending;if(question?.kind==='question')assert.equal(s.conversation.draft.find(l=>l.id===question.lineId)?.sku,'H22');
 assert.match(s.messages.at(-1)!.text,/எத்தனை|How many|eththanai/);assert.equal(s.conversation.draft.find(l=>l.sku==='H13')?.quantity,1);
 s=await text(inbox,r,'two');assert.equal(s.conversation.draft.find(l=>l.sku==='H22')?.quantity,2);assert.ok(cartProgress(s.conversation).join(' ').includes(formatMoney(107000)));assert.equal(s.requests.length,0);
}));
test('restating a total does not increment a cart, while explicit extra does',async()=>fixture(async(pool,inbox)=>{
 let output:any={...base(),requestedItems:[item('one H07','H07')]};const r=runtime(pool,()=>output);let s=await text(inbox,r,'one H07'),id=s.conversation.draft[0].id;
 output={...base(),requestedItems:[item('two H07','H07',2)]};s=await text(inbox,r,'two H07');assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].id,id);assert.equal(s.conversation.draft[0].quantity,2);
 output={...base(),requestedItems:[{...item('two extra H07','H07',2),requestMode:'additional'}]};s=await text(inbox,r,'two extra H07');assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].quantity,4);
}));
test('different sizes stay separate and a false same-item link is rejected',()=>{
 const source='two 1 inch pipes and one 3/4 inch pipe',first={...item('two 1 inch pipes','1 inch pipe',2),dimensions:[{role:'diameter',value:1,unit:'inch'}]},second={...item('one 3/4 inch pipe','3/4 inch pipe',1,1),dimensions:[{role:'diameter',value:.75,unit:'inch'}]};
 const plan=understandingToInterpretation({...base(),requestedItems:[first,second]},{text:source,state},true);assert.equal(plan.operations.length,2);
 assert.throws(()=>understandingToInterpretation({...base(),requestedItems:[first,{...second,sameItemOrdinal:0}]},{text:source,state},true),/compatible/);
});
test('an explicit reference joins a later description without requiring already-said words',()=>{
 const plan=understandingToInterpretation({...base(),requestedItems:[item('two pipes','pipe',2),{...item('one inch pipe','pipe',null,1),sameItemOrdinal:0,dimensions:[{role:'diameter',value:1,unit:'inch'}]}]},{text:'two pipes; one inch pipe',state},true);assert.equal(plan.operations.length,1);assert.equal((plan.operations[0] as any).quantity,2);assert.equal((plan.operations[0] as any).productMeasures[0].value,1);
});
test('ambiguous existing variants ask for a target instead of appending or editing either',()=>{
 const draft={...state,draft:[{id:randomUUID(),name:'1 inch pipe Local',query:'1 inch pipe',quantity:2,resolution:'matched' as const},{id:randomUUID(),name:'1 inch pipe Blueguard',query:'1 inch pipe',quantity:2,resolution:'matched' as const}]};
 const plan=understandingToInterpretation({...base(),requestedItems:[item('two pipe','pipe',2)]},{text:'two pipe',state:draft},true);assert.deepEqual(plan.operations,[]);assert.match(plan.clarifyQuestion!,/Which existing item/);assert.ok(plan.understanding!.unresolved.includes('cart_target'));
});
test('extra counts require explicit evidence and images cannot target an existing cart',()=>{
 const id=randomUUID(),draft={...state,draft:[{id,name:'H07',query:'H07',quantity:1,resolution:'matched' as const}]};
 assert.throws(()=>understandingToInterpretation({...base(),requestedItems:[{...item('two H07','H07',2),targetLineId:id,requestMode:'additional'}]},{text:'two H07',state:draft},true),/explicit current evidence/);
 assert.throws(()=>understandingToInterpretation({...base('handwritten_list'),observedText:'H07',requestedItems:[{...item('H07','H07'),targetLineId:id}]},{text:'',image:{mimeType:'image/jpeg',data:'AAAA'},state:draft},true),/Images cannot edit/);
});
test('three linked descriptions retain one item and an explicit correction uses its final count',()=>{
 const plan=understandingToInterpretation({...base(),requestedItems:[item('two pipes','pipe',2),{...item('the same one inch pipe','pipe',null,1),sameItemOrdinal:0,dimensions:[{value:1,unit:'inch',role:'diameter'}]},{...item('actually three pipes','pipe',3,2),sameItemOrdinal:1}]},{text:'two pipes; the same one inch pipe; actually three pipes',state},true);
 assert.equal(plan.operations.length,1);assert.equal((plan.operations[0] as any).quantity,3);assert.equal((plan.operations[0] as any).productMeasures[0].value,1);
});
test('one current edit cannot be applied twice through both an item and a proposed edit',()=>{
 const id=randomUUID(),draft={...state,draft:[{id,name:'H07',query:'H07',quantity:1,resolution:'matched' as const}]};
 assert.throws(()=>understandingToInterpretation({...base(),intents:['edit'],requestedItems:[{...item('two extra H07','H07',2),targetLineId:id,requestMode:'additional'}],proposedEdits:[{kind:'increment_quantity',targetLineId:id,quantity:2,sourceText:'two extra H07'}]},{text:'two extra H07',state:draft},true),/not both/);
});

// Actual Flash Lite response: original-language queries plus a redundant hose edit.
const nativeTamilUnderstanding=(pipe:string,hose:string)=>({"schemaVersion": 2, "inputKind": "audio", "transcript": "எனக்கு வந்து ரெண்டு பைப்பு அண்ட் தண்ணீர் ஊத்துற ஓஸ் ஒண்ணு நெக்ஸ்ட் வந்து இது ஒரு இன்ச் பைப்பு ஆல்ரெடி சொல்லிட்டேன் பட் இருந்தாலும் இது சுவர பெயிண்ட் எடுக்கணும். பெயிண்ட் எடுக்கிற கத்தி உப்பு தாள் இருந்தா ரெண்டு.", "intents": ["edit", "add"], "requestedItems": [{"ordinal": 1, "sourceText": "தண்ணீர் ஊத்துற ஓஸ் ஒண்ணு", "query": "தண்ணீர் ஊத்துற ஓஸ்", "purchaseCount": 1, "unresolved": []}, {"ordinal": 2, "sourceText": "சுவர பெயிண்ட் எடுக்கணும். பெயிண்ட் எடுக்கிற கத்தி", "query": "பெயிண்ட் கத்தி", "purchaseCount": null, "unresolved": []}, {"ordinal": 3, "sourceText": "உப்பு தாள் இருந்தா ரெண்டு", "query": "உப்பு தாள்", "purchaseCount": 2, "unresolved": []}], "proposedEdits": [{"kind": "set_quantity", "targetLineId": pipe, "sourceText": "ரெண்டு பைப்பு", "quantity": 2}, {"kind": "set_quantity", "targetLineId": hose, "sourceText": "ஓஸ் ஒண்ணு", "quantity": 1}], "shopQuestions": [], "unresolved": [], "clarifyQuestion": "வேறு ஏதாவது வேண்டுமா?"});
test('native Tamil names update existing products and a repeated total is applied once',async()=>fixture(async(pool,inbox)=>{
 const old=(await new RetailTools(pool).invoke(inbox.context,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'H02',quantity:2},{kind:'add_item',query:'H22',quantity:1},{kind:'add_item',query:'H13',quantity:null}]}},'seed-native-tamil-cart')).state!;
 old.draft[0].query='1 inch pipe';old.draft[1].query='scraper';old.draft[2].query='garden hose';
 for(const line of old.draft.slice(0,2))markProductConfirmed(line,line.candidates![0]);
 await pool.query('UPDATE conversations SET draft=$1::jsonb WHERE id=$2',[JSON.stringify(old.draft),inbox.context.conversationId]);
 const r=runtime(pool,()=>nativeTamilUnderstanding(old.draft[0].id,old.draft[2].id)),s=await recordedVoice(inbox,r);
 assert.equal(s.conversation.draft.length,4);assert.deepEqual(s.conversation.draft.slice(0,3).map(l=>l.id),old.draft.map(l=>l.id));
 assert.deepEqual(s.conversation.draft.slice(0,3).map(l=>[l.sku,l.quantity]),[['H02',2],['H22',1],['H13',1]]);
 assert.equal(s.conversation.draft[3].resolution,'unavailable');assert.equal(s.requests.length,0);
 assert.ok(!s.messages.some(m=>m.rich?.stage==='error'));
}));
test('regional aliases preserve unknown items and reject conflicting duplicate totals',()=>{
 for(const query of ['உப்பு தாள்','உப்பு தாளு','உப்புத் தாள்'])assert.equal(normalize(query),'sandpaper');
 assert.equal(normalize('தண்ணீர் ஊத்துற ஓஸ்'),'garden hose');assert.equal(normalize('பெயிண்ட் கத்தி'),'scraper');
 const id=randomUUID(),draft={...state,draft:[{id,name:'brush',query:'brush',quantity:1,resolution:'matched' as const,candidates:[{sku:'B1',name:'brush',aliases:['பிரஷ்'],stock:1,unit:'piece',pricePaise:100,version:1,quantityStep:1}],sku:'B1'}]};
 const output={...base(),requestedItems:[item('two பிரஷ்','பிரஷ்',2)]};
 const plan=understandingToInterpretation(output,{text:'two பிரஷ்',state:draft},true);assert.equal(plan.operations[0].kind,'resolve_line');
 assert.throws(()=>understandingToInterpretation({...output,proposedEdits:[{kind:'set_quantity',targetLineId:id,sourceText:'two பிரஷ்',quantity:3}]},{text:'two பிரஷ்',state:draft},true),/not both/);
 const unknown=understandingToInterpretation({...base(),requestedItems:[item('கத்தி','கத்தி',null)]},{text:'கத்தி',state:draft},true);assert.equal(unknown.operations[0].kind,'add_item');
});

const nativeSelfReference=(pipe:string)=>({"schemaVersion": 2, "inputKind": "audio", "transcript": "எனக்கு வந்து ரெண்டு பைப்பு அண்ட் தண்ணி ஊத்துற ஓஸ் ஒன்னு, நெக்ஸ்ட் வந்து இது ஒரு இன்ச் பைப்பு ஆல்ரெடி சொல்லிட்டேன். பட் இருந்தாலும் இது சுவர பெயிண்ட் எடுக்கணும், பெயிண்ட் எடுக்கிற கத்தி, உப்பு தாள் இருந்தா ரெண்டு.", "intents": ["edit", "add"], "requestedItems": [{"ordinal": 1, "sourceText": "ஒரு இன்ச் பைப்பு", "query": "1 inch pipe", "targetLineId": pipe, "sameItemOrdinal": 1, "requestMode": "set", "purchaseCount": 2, "dimensions": [{"value": 1, "unit": "inch", "role": "diameter"}], "unresolved": []}, {"ordinal": 2, "sourceText": "தண்ணி ஊத்துற ஓஸ் ஒன்னு", "query": "water hose", "purchaseCount": 1, "unresolved": []}, {"ordinal": 3, "sourceText": "சுவர பெயிண்ட் எடுக்கணும், பெயிண்ட் எடுக்கிற கத்தி", "query": "paint scraper", "purchaseCount": null, "unresolved": []}, {"ordinal": 4, "sourceText": "உப்பு தாள் இருந்தா ரெண்டு", "query": "sandpaper", "purchaseCount": 2, "unresolved": []}], "proposedEdits": [], "shopQuestions": [], "unresolved": []});
test('a native consolidated self-reference preserves the current count and diameter',async()=>fixture(async(pool,inbox)=>{
 const old=(await new RetailTools(pool).invoke(inbox.context,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'H02',quantity:2},{kind:'add_item',query:'H22',quantity:1},{kind:'add_item',query:'H13',quantity:null}]}},'seed-native-self-reference')).state!;
 old.draft[0].query='1 inch pipe';old.draft[1].query='scraper';old.draft[2].query='garden hose';
 for(const line of old.draft.slice(0,2))markProductConfirmed(line,line.candidates![0]);
 await pool.query('UPDATE conversations SET draft=$1::jsonb WHERE id=$2',[JSON.stringify(old.draft),inbox.context.conversationId]);
 const r=runtime(pool,()=>nativeSelfReference(old.draft[0].id)),s=await recordedVoice(inbox,r);
 assert.equal(s.conversation.draft.length,4);assert.deepEqual(s.conversation.draft.slice(0,3).map(l=>[l.id,l.sku,l.quantity]),old.draft.map(l=>[l.id,l.sku,l.sku==='H13'?1:l.quantity]));
 assert.equal(s.conversation.draft[0].productMeasures?.[0].value,1);assert.equal(s.requests.length,0);assert.ok(!s.messages.some(m=>m.rich?.stage==='error'));
}));
