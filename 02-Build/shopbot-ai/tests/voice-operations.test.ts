import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {discoverProducts} from '../apps/server/src/services/catalog-discovery.js';
import {normalizeVoice,pcmWav} from '../apps/server/src/services/voice-media.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {submissionIntent} from '../apps/server/src/services/current-turn.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import type {Interpretation,SimulatorEvent,Snapshot} from '../packages/contracts/index.js';

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='voice_ops_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');await setupImageDemo(pool);const id=randomUUID();await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language,reply_language_explicit) VALUES($1,$2,'voice-qa','ta',true)",[id,demoCatalogStore]);await run(pool,new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'voice-qa',role:'customer'}));}
 finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
function provider(plan:(input:Parameters<Interpreter['interpret']>[0])=>Interpretation,spoken:()=>string=()=> 'send my list to the store'):Interpreter{return {name:'offline-voice-ops',mode:'mock',supportsAudio:true,interpret:async input=>({output:input.stage==='recognize'?{transcript:spoken(),operations:[],next:'continue'}:plan(input),usage:null,truncated:false})};}
const hosePlan=()=>({operations:[{kind:'add_item' as const,query:'H13',quantity:1}],next:'review' as const});
async function send(i:SimulatorService,r:ConversationRuntime,e:SimulatorEvent){await i.ingest(e);await r.processNext(i.context);return i.snapshot();}
const text=(i:SimulatorService,r:ConversationRuntime,value:string)=>send(i,r,{id:randomUUID(),type:'text',text:value});
async function audio(i:SimulatorService,r:ConversationRuntime){const id=randomUUID(),pcm=Buffer.alloc(32000);for(let n=0;n<16000;n++)pcm.writeInt16LE(Math.round(Math.sin(n*.17)*1500),n*2);await i.ingest({id,type:'voice',mediaId:id},await normalizeVoice({id,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')}));await r.processNext(i.context);return i.snapshot();}
const last=(s:Snapshot)=>s.messages.at(-1)!.rich!;
const cards=(s:Snapshot)=>last(s).parts?.flatMap(p=>p.cards)??[];
const actions=(s:Snapshot)=>[...last(s).buttons??[],...last(s).parts?.flatMap(p=>[...p.buttons??[],...p.cards.flatMap(c=>c.buttons??[])])??[]];

test('the actual pipe diameter filter retrieves size-stored pipes and excludes other diameters',()=>fixture(async(pool,i)=>{
 const c=await pool.connect();try{const d=await discoverProducts(c,i.context,'1 inch PVC pipe',{familyId:'pvc-pipes',keywords:['pvc pipe','water pipe'],specifications:{diameter:'1 inch'}});assert.ok(d.products.some(p=>p.sku==='H01'));assert.ok(d.products.some(p=>p.sku==='H02'));assert.ok(!d.products.some(p=>p.sku==='H03'));assert.equal(d.noExactMatch,false);}finally{c.release();}
}));

test('known stock and price remain visible when a metre conversion needs shop verification',()=>fixture(async(pool,i)=>{
 const r=new ConversationRuntime(pool,provider(()=>({operations:[{kind:'add_item',query:'H13',quantity:null,requestedAmount:{value:20,unit:'m'},supportingPhrase:'hose 20m'}],next:'review'})),{visualOrdering:true});
 const s=await text(i,r,'hose 20m');const card=cards(s).find(c=>c.kind==='product')!;assert.match(card.caption,/30/);assert.match(card.caption,/₹450/);assert.match(card.caption,/20 மீட்டர்/);assert.equal(s.conversation.draft[0].catalogIssue,'amount_unverified');assert.equal(s.requests.length,0);
}));

for(const language of ['ta','en'] as const)test(`${language} uses one instruction language and one unit label`,()=>fixture(async(pool,i)=>{
 await pool.query('UPDATE conversations SET reply_language=$1,reply_language_explicit=true WHERE id=$2',[language,i.context.conversationId]);
 const r=new ConversationRuntime(pool,provider(hosePlan),{visualOrdering:true});const s=await text(i,r,'one hose');const instruction=cards(s).find(c=>c.kind==='instruction')!;assert.ok(instruction.kind!=='product');
 if(language==='ta'){assert.match(instruction.lines.join(' '),/[\u0b80-\u0bff]/);assert.doesNotMatch(instruction.lines.join(' '),/[\u0900-\u097f\u4e00-\u9fff]/);assert.ok(!/\b(?:inch|m|pieces?)\b/.test(cards(s)[0].caption));assert.match(cards(s)[0].caption,/1 எண்ணம்/);}else{assert.ok(!/[\u0b80-\u0bff]/.test(instruction.lines.join(' ')));assert.match(cards(s)[0].caption,/1 piece/);}
 assert.match(cards(s)[0].caption,/450/);
}));

test('price lookup during product review answers from stock and price without changing the list',()=>fixture(async(pool,i)=>{
 const r=new ConversationRuntime(pool,provider(input=>input.text==='இதன் விலை என்ன?'?{operations:[],next:'price',priceQuery:'H13',priceQuantity:1,clarifyQuestion:'எந்தப் பொருள் வேணும்?'}:hosePlan()),{visualOrdering:true});
 let s=await text(i,r,'one hose');const before=structuredClone(s.conversation);s=await text(i,r,'இதன் விலை என்ன?');assert.deepEqual(s.conversation,before);assert.match(last(s).text,/450/);assert.match(last(s).text,/30/);assert.equal(last(s).readOnly,true);assert.equal(cards(s).length,0);assert.ok(!last(s).text.includes('எந்தப் பொருள் வேணும்'));
}));

for(const phrase of ['send my list to the store','send it to the shop','ஓகே ஆர்டரை பிளேஸ் பண்ணிடலாம்'])test(`spoken finish command: ${phrase}`,()=>fixture(async(pool,i)=>{
 const r=new ConversationRuntime(pool,provider(input=>{if(input.state.draft.length)throw Error('finish must use recognized command, not a generated plan');return hosePlan();},()=>phrase),{visualOrdering:true});
 let s=await text(i,r,'one hose');s=await audio(i,r);assert.equal(s.requests.length,0);assert.equal(last(s).stage,'bill');s=await audio(i,r);assert.equal(s.requests.length,1);assert.equal(last(s).stage,'submitted');assert.equal(s.requests[0].totalPaise,45000);
 const receipts=(await pool.query('SELECT tool_name FROM tool_receipts WHERE conversation_id=$1',[i.context.conversationId])).rows.map(x=>x.tool_name);assert.ok(receipts.includes('confirm_product_choices'));assert.ok(receipts.includes('submit_order_request'));
 s=await audio(i,r);assert.equal(s.requests.length,1);
}));

test('spoken product approval followed by spoken submission needs no button',()=>fixture(async(pool,i)=>{
 let phrase='all correct';const r=new ConversationRuntime(pool,provider(hosePlan,()=>phrase),{visualOrdering:true});let s=await text(i,r,'one hose');s=await audio(i,r);assert.equal(last(s).stage,'bill');assert.equal(s.requests.length,0);phrase='send it to the store';s=await audio(i,r);assert.equal(s.requests.length,1);
}));

test('text finish opens the bill, then a second command submits the reviewed order',()=>fixture(async(pool,i)=>{
 const r=new ConversationRuntime(pool,provider(hosePlan),{visualOrdering:true});await text(i,r,'one hose');let s=await text(i,r,'send my order to the store');assert.equal(s.requests.length,0);assert.equal(last(s).stage,'bill');s=await text(i,r,'send my order to the store');assert.equal(s.requests.length,1);assert.equal(last(s).stage,'submitted');
}));

test('unknown price blocks sending; explicit shop help retains the list and known stock',()=>fixture(async(pool,i)=>{
 await pool.query("UPDATE products SET price_status='confirm',price_paise=0 WHERE store_id=$1 AND sku='H13'",[demoCatalogStore]);const r=new ConversationRuntime(pool,provider(hosePlan),{visualOrdering:true});let s=await text(i,r,'one hose');const draft=structuredClone(s.conversation.draft);assert.match(cards(s)[0].caption,/30/);assert.ok(!cards(s)[0].caption.includes('₹0'));
 s=await text(i,r,'send my list to the store');assert.deepEqual(s.conversation.draft,draft);assert.equal(s.requests.length,0);assert.equal(s.conversation.handoffRequested,false);assert.equal((await pool.query('SELECT operator_mode FROM conversations WHERE id=$1',[i.context.conversationId])).rows[0].operator_mode,'assistant');s=await text(i,r,'talk to shop');assert.deepEqual(s.conversation.draft,draft);assert.equal(s.requests.length,0);assert.equal(s.conversation.handoffRequested,true);assert.equal(last(s).handoffRequested,true);
 const c=(await pool.query('SELECT operator_mode,handoff_requested FROM conversations WHERE id=$1',[i.context.conversationId])).rows[0];assert.equal(c.operator_mode,'owner');assert.equal(c.handoff_requested,true);assert.ok((await pool.query("SELECT 1 FROM tool_receipts WHERE conversation_id=$1 AND tool_name='request_store_assistance'",[i.context.conversationId])).rowCount);
}));

test('a read-only estimate preserves the current review and excludes unpriced lines',()=>fixture(async(pool,i)=>{
 await pool.query("UPDATE products SET price_status='confirm',price_paise=0 WHERE store_id=$1 AND sku='H05'",[demoCatalogStore]);const r=new ConversationRuntime(pool,provider(()=>({operations:[{kind:'add_item',query:'H13',quantity:1},{kind:'add_item',query:'H05',quantity:1}],next:'review'})),{visualOrdering:true});let s=await text(i,r,'one hose and one elbow');const before=structuredClone(s.conversation);s=await text(i,r,'bill');assert.deepEqual(s.conversation,before);assert.match(last(s).text,/450/);assert.match(last(s).accessibleText!,/1 items/);assert.equal(s.requests.length,0);
}));

test('voice edits and removal affect only their named line',()=>fixture(async(pool,i)=>{
 let phrase='hose two pieces';const r=new ConversationRuntime(pool,provider(input=>!input.state.draft.length?{operations:[{kind:'add_item',query:'H13',quantity:1},{kind:'add_item',query:'H05',quantity:1}],next:'review'}:{operations:phrase==='hose two pieces'?[{kind:'set_quantity',reference:input.state.draft[0].id,quantity:2,supportingPhrase:phrase}]:[{kind:'remove_item',reference:input.state.draft[0].id,supportingPhrase:phrase}],next:'review'},()=>phrase),{visualOrdering:true});let s=await text(i,r,'one hose and one elbow');const elbow=structuredClone(s.conversation.draft[1]);s=await audio(i,r);assert.equal(s.conversation.draft[0].quantity,2);assert.deepEqual(s.conversation.draft[1],elbow);phrase='hose venda';s=await audio(i,r);assert.deepEqual(s.conversation.draft,[elbow]);assert.equal(s.requests.length,0);
}));

test('a stale recording cannot submit a newer draft',()=>fixture(async(pool,i)=>{
 const r=new ConversationRuntime(pool,provider(hosePlan),{visualOrdering:true});await text(i,r,'one hose');const id=randomUUID(),pcm=Buffer.alloc(32000);for(let n=0;n<16000;n++)pcm.writeInt16LE(Math.round(Math.sin(n*.17)*1200),n*2);await i.ingest({id,type:'voice',mediaId:id},await normalizeVoice({id,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')}));await pool.query('UPDATE conversations SET version=version+1 WHERE id=$1',[i.context.conversationId]);await r.processNext(i.context);assert.equal((await i.snapshot()).requests.length,0);
}));

test('store assistance is an idempotent tool; customer inventory writes are absent',()=>fixture(async(pool,i)=>{
 const tools=new RetailTools(pool),call={name:'request_store_assistance',args:{expectedVersion:0}};const a=await tools.invoke(i.context,call,'same-key'),b=await tools.invoke(i.context,call,'same-key');assert.deepEqual(a,b);assert.equal((await pool.query('SELECT operator_revision FROM conversations WHERE id=$1',[i.context.conversationId])).rows[0].operator_revision,1);await assert.rejects(()=>tools.invoke(i.context,{name:'update_inventory',args:{sku:'H13',stock:99}},'forbidden'));
}));

test('submission is a whole command; refusals, questions and edits cannot become consent',()=>{
 for(const s of ['do not send it','can you send it to the store?','remove the hose and send it','send it after changing quantity'])assert.equal(submissionIntent(s),false,s);
});

test('estimates read the current owner price, rather than the old product snapshot',()=>fixture(async(pool,i)=>{
 const r=new ConversationRuntime(pool,provider(hosePlan),{visualOrdering:true});let s=await text(i,r,'one hose');const before=structuredClone(s.conversation);await pool.query("UPDATE products SET price_paise=50000,version=version+1 WHERE store_id=$1 AND sku='H13'",[demoCatalogStore]);s=await text(i,r,'bill');assert.deepEqual(s.conversation,before);assert.match(last(s).text,/500/);assert.equal(s.requests.length,0);
}));

test('product approval opens the bill and only its confirm button submits',()=>fixture(async(pool,i)=>{
 const r=new ConversationRuntime(pool,provider(hosePlan),{visualOrdering:true});let s=await text(i,r,'one hose');assert.ok(!actions(s).some(b=>b.event.type==='shopping_action'&&b.event.action==='finish_order'));const approve=actions(s).find(b=>b.event.type==='confirm_products');assert.ok(approve);s=await send(i,r,approve.event);assert.equal(s.requests.length,0);assert.equal(last(s).stage,'bill');const confirm=actions(s).find(b=>b.event.type==='confirm');assert.ok(confirm);s=await send(i,r,confirm.event);assert.equal(s.requests.length,1);
}));
test('a read-only quote preserves product review; spoken consent first opens the bill',()=>fixture(async(pool,i)=>{
 const r=new ConversationRuntime(pool,provider(hosePlan),{visualOrdering:true});const before=(await text(i,r,'one hose')).conversation;let s=await text(i,r,'H13 விலை என்ன');assert.equal(s.requests.length,0);assert.deepEqual(s.conversation,before);s=await audio(i,r);assert.equal(s.requests.length,0);assert.equal(last(s).stage,'bill');s=await audio(i,r);assert.equal(s.requests.length,1);
}));
