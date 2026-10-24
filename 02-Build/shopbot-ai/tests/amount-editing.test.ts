import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {amountToCount,protectQuantityEvidence} from '../apps/server/src/services/quantity-evidence.js';
import {discoverProducts} from '../apps/server/src/services/catalog-discovery.js';
import {normalizeAmountEdits} from '../apps/server/src/services/amount-edits.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';
import {normalizeVoice,pcmWav} from '../apps/server/src/services/voice-media.js';
import type {Interpretation,Operation,SimulatorEvent,Snapshot} from '../packages/contracts/index.js';
import type {InterpretationInput,Interpreter} from '../apps/server/src/adapters/interpreter.js';
async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){
 const url=process.env.DATABASE_URL!,schema='amount_edit_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:url});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');await setupImageDemo(pool);const id=randomUUID();await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language,visual_ordering) VALUES($1,$2,'amount-test','ta',true)",[id,demoCatalogStore]);await run(pool,new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'amount-test',role:'customer'}));}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
function planner(plan:(i:InterpretationInput)=>Interpretation):Interpreter{return {name:'controlled-amount-regression',mode:'mock',interpret:async i=>({output:plan(i),usage:null,truncated:false})};}
async function send(i:SimulatorService,r:ConversationRuntime,e:SimulatorEvent){await i.ingest(e);await r.processNext(i.context);return i.snapshot();}
const text=(i:SimulatorService,r:ConversationRuntime,t:string)=>send(i,r,{id:randomUUID(),type:'text',text:t});
const last=(s:Snapshot)=>s.messages.at(-1)!.rich!;
const cards=(s:Snapshot)=>s.messages.filter(m=>m.rich?.groupId===last(s).groupId).flatMap(m=>m.rich?.parts?.flatMap(p=>p.cards)??[]);
const seed:Operation[]=[{kind:'add_item',query:'H03',quantity:1},{kind:'add_item',query:'H01',quantity:1},{kind:'add_item',query:'H13',quantity:1}];
const hose=(s:Snapshot)=>s.conversation.draft.find(l=>l.sku==='H13')!;

for(const phrase of ['ஒரு இன்ச் பைப் ஒன்னு','one 1 inch pipe','1 inch pipe onnu','two 1 inch pipes'])test(`explicit count survives dimension guard: ${phrase}`,()=>{
 const count=/two/.test(phrase)?2:1;
 const op=protectQuantityEvidence([{kind:'add_item',query:'1 inch PVC pipe',quantity:count,productMeasures:[{value:1,unit:'inch'}],supportingPhrase:phrase}],phrase)[0];assert.ok(op.kind==='add_item');assert.equal(op.quantity,count);assert.deepEqual(op.productMeasures,[{value:1,unit:'inch'}]);
});

test('verified length contents convert totals while cutting, continuous length and unverified basis stay pending',()=>{
 const p={sku:'HOSE',name:'Hose 10m',unit:'piece',pricePaise:45000,stock:30,version:1,aliases:[],quantityStep:1,sellingUnitVerified:true,specifications:{size:'0.5 inch x 10m'}};
 assert.equal(amountToCount({requestedAmount:{value:50,unit:'m'}} as any,p),5);
 assert.equal(amountToCount({requestedAmount:{value:50,unit:'m'}} as any,{...p,sellingUnitVerified:false}),null);
 assert.equal(amountToCount({requestedAmount:{value:5,unit:'m'}} as any,p),null);
 assert.equal(amountToCount({requestedAmount:{value:50,unit:'m'},amountMode:'continuous'} as any,p),null);
 assert.equal(amountToCount({requestedAmount:{value:.2,unit:'litre'}} as any,{...p,unit:'bottle',specifications:{size:'100ml'}}),2);
 assert.equal(amountToCount({requestedAmount:{value:1,unit:'kg'}} as any,{...p,unit:'can',specifications:{size:'1L'}}),null);
});

test('saved 50m dimension plan becomes five pieces with the same photo and other stable lines',()=>fixture(async(pool,i)=>{
 await pool.query("UPDATE products SET selling_unit_verified=true WHERE store_id=$1 AND sku='H13'",[demoCatalogStore]);
 const r=new ConversationRuntime(pool,planner(input=>!input.state.draft.length?{next:'review',operations:seed}:{next:'review',operations:[{kind:'resolve_line',lineId:input.state.draft[2].id,query:'garden hose',quantity:1,productMeasures:[{value:50,unit:'m'}],supportingPhrase:'இந்த ஹோஸ் வந்து 50 மீட்டர் வேணும்'}]}),{visualOrdering:true});
 const before=await text(i,r,'three products');const after=await text(i,r,'இல்ல இல்ல இந்த ஹோஸ் வந்து 50 மீட்டர் வேணும்');
 assert.deepEqual(after.conversation.draft.slice(0,2),before.conversation.draft.slice(0,2));assert.equal(hose(after).id,hose(before).id);assert.equal(hose(after).quantity,5);assert.deepEqual(hose(after).requestedAmount,{value:50,unit:'m'});
 assert.equal(cards(after).length,1);assert.ok(cards(after).some(c=>c.kind==='product'&&c.product.sku==='H13'));assert.match(last(after).text,/50 மீட்டர்/);assert.ok(cards(after).some(c=>c.buttons?.some(b=>b.event.type==='shopping_action'&&b.event.action==='view_products')));assert.equal(after.requests.length,0);assert.equal(after.conversation.productReview,null);
 renderWhatsAppReply(last(after),randomUUID(),'test.example');
}));

test('unknown length selling basis keeps recognized hose photo and requested amount, never unavailable',()=>fixture(async(_pool,i)=>{
 const r=new ConversationRuntime(_pool,planner(input=>!input.state.draft.length?{next:'review',operations:seed}:{next:'review',operations:[{kind:'set_amount',reference:input.state.draft[2].id,amount:{value:50,unit:'m'},supportingPhrase:'hose 50m venum'}]}),{visualOrdering:true});
 const before=await text(i,r,'three products'),s=await text(i,r,'hose 50m venum');assert.equal(hose(s).quantity,null);assert.equal(hose(s).resolution,'needs_unit');assert.equal(hose(s).catalogIssue,'amount_unverified');assert.deepEqual(s.conversation.draft.slice(0,2),before.conversation.draft.slice(0,2));assert.ok(cards(s).some(c=>c.kind==='product'&&c.product.sku==='H13'));assert.match(cards(s).find(c=>c.kind==='product'&&c.product.sku==='H13')!.caption,/50/);
}));

test('5m plus bill applies an amount correction; pure price questions remain read-only',()=>fixture(async(pool,i)=>{
 const r=new ConversationRuntime(pool,planner(input=>!input.state.draft.length?{next:'review',operations:seed}:{next:'price',priceQuery:'garden hose',priceQuantity:5,priceUnit:'m',operations:[]}),{visualOrdering:true});
 let s=await text(i,r,'three products');const before=structuredClone(s.conversation.draft);
 s=await text(i,r,'Indha hose 10 m irukku but 5 m mattum enakku venum. Bill calculate panni sollu.');assert.deepEqual(hose(s).requestedAmount,{value:5,unit:'m'});assert.equal(hose(s).quantity,null);assert.deepEqual(s.conversation.draft.slice(0,2),before.slice(0,2));assert.match(last(s).text,/முழு பில்|Muzhu bill/);assert.match(last(s).text,/₹425/);assert.equal(s.requests.length,0);
 const keep=structuredClone(s.conversation.draft);s=await text(i,r,'How much for 5 metres garden hose?');assert.deepEqual(s.conversation.draft,keep);assert.match(last(s).text,/450/);assert.match(last(s).text,/கடை உறுதி|shop must confirm|kadai confirm/i);
 const state=s.conversation;assert.equal(normalizeAmountEdits({next:'price',operations:[],priceQuery:'garden hose',priceQuantity:50,priceUnit:'m'},'Only the price for this hose 50m please',state).next,'price');
}));

test('amount increments use the bound total; fractional cuts and continuous requirements retain the photo',()=>fixture(async(pool,i)=>{
 await pool.query("UPDATE products SET selling_unit_verified=true WHERE store_id=$1 AND sku='H13'",[demoCatalogStore]);
 const r=new ConversationRuntime(pool,planner(input=>!input.state.draft.length?{next:'review',operations:seed}:{next:'review',operations:[input.text.includes('extra')?{kind:'increment_amount',reference:input.state.draft[2].id,delta:{value:20,unit:'m'},supportingPhrase:'hose extra 20m'}:{kind:'set_amount',reference:input.state.draft[2].id,amount:{value:input.text.includes('continuous')?50:5,unit:'m'},mode:input.text.includes('continuous')?'continuous':'total',supportingPhrase:input.text}]}),{visualOrdering:true});
 await text(i,r,'three products');let s=await text(i,r,'hose extra 20m');assert.equal(hose(s).quantity,3);assert.equal(hose(s).requestedAmount!.value,30);
 s=await text(i,r,'hose 5m only');assert.equal(hose(s).catalogIssue,'cutting_required');assert.equal(hose(s).quantity,null);assert.ok(cards(s).some(c=>c.kind==='product'&&c.product.sku==='H13'));
 s=await text(i,r,'hose 50m continuous');assert.equal(hose(s).catalogIssue,'continuous_length');assert.equal(s.requests.length,0);
}));

test('unverified amount refresh resolves after merchant verifies basis and clears the old issue',()=>fixture(async(pool,i)=>{
 const r=new ConversationRuntime(pool,planner(input=>!input.state.draft.length?{next:'review',operations:seed}:{next:'review',operations:[{kind:'set_amount',reference:input.state.draft[2].id,amount:{value:50,unit:'m'},supportingPhrase:'hose 50m'}]}),{visualOrdering:true});
 await text(i,r,'three products');let s=await text(i,r,'hose 50m');assert.equal(hose(s).quantity,null);
 await pool.query("UPDATE products SET selling_unit_verified=true,version=version+1 WHERE store_id=$1 AND sku='H13'",[demoCatalogStore]);s=await text(i,r,'review');assert.equal(hose(s).quantity,5);assert.equal(hose(s).catalogIssue,undefined);assert.equal(hose(s).resolution,'matched');
}));

test('capacity filter uses an actual size=10L fact, never 10kg; one compatible pack needs no separate variant question',()=>fixture(async(pool,i)=>{
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,specifications,selling_unit_verified) VALUES($1,'PAINT-L','Wall paint 10L','can',120000,3,'paint','{\"size\":\"10L\"}',true),($1,'PAINT-KG','Paint 10kg','box',100000,3,'paint','{\"size\":\"10kg\"}',true)",[demoCatalogStore]);
 const c=await pool.connect();try{assert.deepEqual((await discoverProducts(c,i.context,'paint',{keywords:['paint'],familyId:'paint',specifications:{capacity:'10 litre'}})).products.map(p=>p.sku),['PAINT-L']);}finally{c.release();}
 const r=new ConversationRuntime(pool,planner(()=>({next:'review',operations:[{kind:'add_item',query:'paint',quantity:1,packSize:{value:10,unit:'litre'},search:{keywords:['paint'],familyId:'paint',specifications:{capacity:'10 litre'}}}]})),{visualOrdering:true});
 const s=await text(i,r,'10 லிட்டர் பெயிண்ட் டப்பா ஒன்னு');assert.equal(s.conversation.draft[0].sku,'PAINT-L');assert.equal(last(s).stage,'products');assert.equal(s.conversation.draft[0].quantity,1);
}));

test('twenty catalog variants narrow to an explicit brand and size without unrelated products',()=>fixture(async(pool,i)=>{
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,brand,specifications) SELECT $1,'VAR-'||n,'Brand '||n||' wall paint 10L','can',100000,10,'paint','Brand '||n,'{\"size\":\"10L\"}'::jsonb FROM generate_series(1,20) n",[demoCatalogStore]);
 const c=await pool.connect();try{const all=await discoverProducts(c,i.context,'paint',{keywords:['paint'],familyId:'paint'});assert.equal(all.totalCount,20);assert.ok(all.products.length<=10);const exact=await discoverProducts(c,i.context,'paint',{keywords:['paint'],familyId:'paint',brand:'Brand 17',specifications:{size:'10L'}});assert.deepEqual(exact.products.map(p=>p.sku),['VAR-17']);}finally{c.release();}
}));

test('repaired paint plan without search metadata still matches the verified pack and retains its explicit can count',()=>fixture(async(pool,i)=>{
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,specifications,selling_unit_verified) VALUES($1,'REPAIRED-L','Wall paint 10L','can',120000,3,'paint','{\"size\":\"10L\"}',true),($1,'WRONG-KG','Paint 10kg','box',100000,3,'paint','{\"size\":\"10kg\"}',true)",[demoCatalogStore]);
 const r=new ConversationRuntime(pool,planner(()=>({next:'review',operations:[{kind:'add_item',query:'10 liter paint',quantity:1,packSize:{value:10,unit:'litre'},requestedAmount:{value:10,unit:'litre'},supportingPhrase:'10 லிட்டர் பெயிண்ட் டப்பா ஒன்னு'}]})),{visualOrdering:true});
 const s=await text(i,r,'10 லிட்டர் பெயிண்ட் டப்பா ஒன்னு');assert.equal(s.conversation.draft[0].sku,'REPAIRED-L');assert.equal(s.conversation.draft[0].quantity,1);assert.equal(s.conversation.draft[0].requestedAmount,undefined);assert.deepEqual(s.conversation.draft[0].packSize,{value:10,unit:'litre'});
}));

test('repaired paint-can wording and a counted can in requestedAmount recover without replacing a real watering can',()=>fixture(async(pool,i)=>{
 await pool.query("INSERT INTO catalog_nodes(store_id,id,kind,label,aliases) VALUES($1,'watering-cans','family','Watering cans','[\"watering can\"]')",[demoCatalogStore]);
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,specifications,selling_unit_verified) VALUES($1,'PAINT-CAN','Wall paint 10L','can',120000,3,'paint','{\"size\":\"10L\"}',true),($1,'WATER-CAN','Watering can 10L','piece',35000,3,'watering-cans','{\"size\":\"10L\"}',true)",[demoCatalogStore]);
 const r=new ConversationRuntime(pool,planner(input=>({next:'review',operations:[{kind:'add_item',query:input.text.includes('watering')?'10 litre watering can':'10 litre paint can',quantity:1,packSize:{value:10,unit:'litre'},requestedAmount:{value:1,unit:'can'},supportingPhrase:input.text}]})),{visualOrdering:true});
 let s=await text(i,r,'10 லிட்டர் பெயிண்ட் டப்பா ஒன்னு');assert.equal(s.conversation.draft[0].sku,'PAINT-CAN');assert.equal(s.conversation.draft[0].quantity,1);assert.equal(s.conversation.draft[0].requestedAmount,undefined);
 s=await text(i,r,'one 10 litre watering can');const line=s.conversation.draft[1];assert.ok(line.sku==='WATER-CAN'||line.candidates?.some(p=>p.sku==='WATER-CAN'));assert.ok(!line.candidates?.some(p=>p.sku==='PAINT-CAN'));assert.equal(line.requestedQuantity??line.quantity,1);
}));

test('romanized Tamil voice retains Tamil preference; a spoken explicit language choice still works',()=>fixture(async(pool,i)=>{
 let raw='Indha hose 50 m mattum enakku venum';const p:Interpreter={...planner(()=>({next:'review',operations:seed})),supportsAudio:true,interpret:async input=>({output:input.stage==='recognize'?{transcript:raw,operations:[],next:'continue'}:{operations:seed,next:'review'},usage:null,truncated:false})};
 const r=new ConversationRuntime(pool,p,{visualOrdering:true}),id=randomUUID(),pcm=Buffer.alloc(32000);for(let n=0;n<16000;n++)pcm.writeInt16LE(Math.round(Math.sin(n*.17)*1500),n*2);
 const media=await normalizeVoice({id,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')});await i.ingest({id,type:'voice',mediaId:id},media);await r.processNext(i.context);assert.equal((await i.snapshot()).conversation.replyLanguage,'ta');raw='Tanglish la sollunga';const second=randomUUID();await i.ingest({id:second,type:'voice',mediaId:second},media);await r.processNext(i.context);assert.equal((await i.snapshot()).conversation.replyLanguage,'ta-Latn');
}));

test('a direct total-volume request does not turn the total into a pack-size filter',()=>fixture(async(pool,i)=>{
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,specifications,selling_unit_verified) VALUES($1,'VOLUME-PACK','Wall paint 10L','can',120000,10,'paint','{\"size\":\"10L\"}',true)",[demoCatalogStore]);
 const r=new ConversationRuntime(pool,planner(()=>({next:'review',operations:[{kind:'add_item',query:'VOLUME-PACK',quantity:null,requestedAmount:{value:20,unit:'litre'},supportingPhrase:'paint 20 litres total'}]})),{visualOrdering:true});
 const s=await text(i,r,'paint 20 litres total');assert.equal(s.conversation.draft[0].sku,'VOLUME-PACK');assert.equal(s.conversation.draft[0].quantity,2);assert.deepEqual(s.conversation.draft[0].packSize,{value:10,unit:'litre'});
}));

test('invalid amount evidence rejects the complete batch without partially changing other items',()=>fixture(async(pool,i)=>{
 const r=new ConversationRuntime(pool,planner(input=>!input.state.draft.length?{next:'review',operations:seed}:{next:'review',operations:[{kind:'set_quantity',reference:input.state.draft[0].id,quantity:2},{kind:'set_amount',reference:input.state.draft[2].id,amount:{value:50,unit:'m'},supportingPhrase:'hose 5m'}]}),{visualOrdering:true});
 const before=await text(i,r,'three products'),s=await text(i,r,'pipe two, hose 5m');assert.deepEqual(s.conversation.draft,before.conversation.draft);assert.equal(last(s).stage,'error');
}));

test('legacy lost hose binding is recovered by an amount edit without keeping the wrong length constraint',()=>fixture(async(pool,i)=>{
 await pool.query("UPDATE products SET selling_unit_verified=true WHERE store_id=$1 AND sku='H13'",[demoCatalogStore]);
 const r=new ConversationRuntime(pool,planner(input=>!input.state.draft.length?{next:'review',operations:seed}:{next:'review',operations:[{kind:'set_amount',reference:input.state.draft[2].id,amount:{value:50,unit:'m'},supportingPhrase:'hose 50m'}]}),{visualOrdering:true});
 let s=await text(i,r,'three products'),draft=structuredClone(s.conversation.draft);draft[2]={id:draft[2].id,name:'garden hose',query:'garden hose',quantity:1,resolution:'unavailable',productMeasures:[{value:50,unit:'m'}],candidates:[]};
 await pool.query('UPDATE conversations SET draft=$1::jsonb,pending=NULL WHERE id=$2',[JSON.stringify(draft),i.context.conversationId]);s=await text(i,r,'hose 50m');assert.equal(hose(s).quantity,5);assert.equal(hose(s).productMeasures,undefined);assert.equal(hose(s).id,draft[2].id);assert.deepEqual(s.conversation.draft.slice(0,2),draft.slice(0,2));
}));

test('explicit piece counts after an amount clarification override the old amount instead of looping',()=>fixture(async(pool,i)=>{
 const r=new ConversationRuntime(pool,planner(input=>!input.state.draft.length?{next:'review',operations:seed}:{next:'review',operations:[input.text.includes('pieces')?{kind:'set_quantity',reference:input.state.draft[2].id,quantity:5,supportingPhrase:'five pieces'}:{kind:'set_amount',reference:input.state.draft[2].id,amount:{value:50,unit:'m'},supportingPhrase:'hose 50m'}]}),{visualOrdering:true});
 await text(i,r,'three products');await text(i,r,'hose 50m');const s=await text(i,r,'I want five pieces');assert.equal(hose(s).quantity,5);assert.equal(hose(s).requestedAmount,undefined);assert.equal(hose(s).catalogIssue,undefined);
}));

test('insufficient recorded stock keeps the matched photo selectable',()=>fixture(async(pool,i)=>{
 await pool.query("UPDATE products SET selling_unit_verified=true,stock=2 WHERE store_id=$1 AND sku='H13'",[demoCatalogStore]);
 const r=new ConversationRuntime(pool,planner(input=>!input.state.draft.length?{next:'review',operations:seed}:{next:'review',operations:[{kind:'set_amount',reference:input.state.draft[2].id,amount:{value:50,unit:'m'},supportingPhrase:'hose 50m'}]}),{visualOrdering:true});
 await text(i,r,'three products');const s=await text(i,r,'hose 50m');assert.equal(hose(s).quantity,5);assert.equal(hose(s).catalogIssue,undefined);assert.equal(hose(s).resolution,'matched');assert.equal(s.conversation.pending?.kind,'products');assert.ok(cards(s).some(c=>c.kind==='product'&&c.product.sku==='H13')||last(s).parts?.flatMap(p=>p.buttons??[]).some(b=>b.event.type==='shopping_action'&&b.event.action==='view_products'));assert.equal(s.requests.length,0);
}));

test('fresh review repairs a legacy amount-as-variant error only against its own previously shown photo',()=>fixture(async(pool,i)=>{
 await pool.query("UPDATE products SET selling_unit_verified=true WHERE store_id=$1 AND sku='H13'",[demoCatalogStore]);
 const r=new ConversationRuntime(pool,planner(()=>({next:'review',operations:seed})),{visualOrdering:true});
 let s=await text(i,r,'three products');const draft=structuredClone(s.conversation.draft);
 draft[2]={id:draft[2].id,query:'garden hose',name:'garden hose',quantity:1,resolution:'unavailable',candidates:[],productMeasures:[{value:50,unit:'m'}],supportingPhrase:'இந்த ஹோஸ் வந்து 50 மீட்டர் வேணும்'};
 await pool.query('UPDATE conversations SET draft=$1::jsonb,pending=NULL,product_review=NULL WHERE id=$2',[JSON.stringify(draft),i.context.conversationId]);s=await text(i,r,'review');assert.equal(hose(s).quantity,5);assert.deepEqual(hose(s).requestedAmount,{value:50,unit:'m'});assert.equal(hose(s).id,draft[2].id);assert.equal(s.requests.length,0);
}));
