import {GenerateContentResponse,FinishReason} from '@google/genai';
import {GoogleInterpreter} from '../apps/server/src/adapters/google-interpreter.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdtempSync} from 'node:fs';
import pg from 'pg';
import type {Operation,SimulatorEvent,Snapshot,RichReply,ConversationState,Product} from '../packages/contracts/index.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import {protectQuantityEvidence,amountToCount} from '../apps/server/src/services/quantity-evidence.js';
import {visualSvg,renderVisualImage} from '../apps/server/src/services/visual-images.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';
import {planWhatsAppReply} from '../apps/server/src/services/whatsapp-plan.js';
import {WhatsAppChannel} from '../apps/server/src/services/whatsapp-channel.js';
import type {WhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';
import {visualReply} from '../apps/server/src/services/visual-ordering.js';
import {reviewDeliveryReady} from '../apps/server/src/services/review-delivery.js';
import {normalizeVoice,pcmWav} from '../apps/server/src/services/voice-media.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='clear_visual_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA "${schema}"`);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});try{await setupDatabase(pool,'mock');for(let i=0;i<50;i++)await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,image_path,specifications) VALUES($1,$2,$3,'can',10000,100,'/demo-images/H01.jpg',$4)",[simulatorContext.storeId,'TEST'+i,'Test paint '+i,JSON.stringify({size:'10L'})]);await run(pool,new SimulatorService(pool));}finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}}
function planner(operations:Operation[],transcript?:string,truncated=false):Interpreter{return {name:'visual-offline',mode:'mock',supportsAudio:true,interpret:async input=>({output:input.stage==='recognize'?{transcript,operations:[],next:'continue'}:{operations,next:'review'},usage:null,truncated})};}
async function event(inbox:SimulatorService,runtime:ConversationRuntime,e:SimulatorEvent){await inbox.ingest(e);await runtime.processNext(inbox.context);return inbox.snapshot();}
async function text(inbox:SimulatorService,runtime:ConversationRuntime,value:string){return event(inbox,runtime,{id:randomUUID(),type:'text',text:value});}
const last=(s:Snapshot)=>s.messages.at(-1)!.rich!;
const buttons=(r:RichReply)=>r.parts?.flatMap(p=>[...p.buttons??[],...p.cards.flatMap(c=>c.buttons??[])])??r.buttons??[];
const approve=(s:Snapshot)=>buttons(last(s)).find(b=>b.event.type==='confirm_products')!.event;
const invoiceCards=(s:Snapshot)=>s.messages.filter(m=>m.rich?.groupId===last(s).groupId).flatMap(m=>m.rich?.parts?.flatMap(p=>p.cards)??[]);
const submit=(s:Snapshot)=>buttons(last(s)).find(b=>b.event.type==='confirm')!.event;

for(const count of [1,9,10,18,20,50])test(`${count} products: complete ordered review and separate quantity approval`,()=>fixture(async(pool,inbox)=>{
 const ops:Operation[]=Array.from({length:count},(_,i)=>({kind:'add_item',query:'TEST'+i,quantity:1}));const runtime=new ConversationRuntime(pool,planner(ops),{visualOrdering:true});
 let s=await text(inbox,runtime,'shopping list');const rows=s.messages.filter(m=>m.direction==='outbound');assert.equal(rows.length,Math.ceil(count/9));assert.equal(s.conversation.pending?.kind,'products');
 const cards=rows.flatMap(m=>m.rich!.parts!.flatMap(p=>p.cards));assert.equal(cards.filter(c=>c.kind==='product').length,count);assert.equal(new Set(cards.filter(c=>c.kind==='product').map(c=>c.lineId)).size,count);
 for(const [i,m] of rows.entries()){assert.equal(m.rich!.partIndex,i);assert.equal(m.rich!.parts![0].cards.at(-1)!.kind,'instruction');assert.ok(m.rich!.parts![0].cards.length<=10);const rendered=renderWhatsAppReply(m.rich!,m.id,'example.test');assert.equal(rendered.format,'carousel');if(i<rows.length-1)assert.ok(!rendered.actions.some(a=>a.event.type==='confirm_products'));}
 s=await event(inbox,runtime,approve(s));assert.equal(s.requests.length,0);assert.equal(s.conversation.pending?.kind,'review');assert.equal(last(s).stage,'bill');const bill=invoiceCards(s);assert.ok(bill.every(c=>c.kind!=='product'&&(c.billRows?.length??0)<=5));
 const final=submit(s);s=await event(inbox,runtime,final);assert.equal(s.requests.length,1);assert.equal(last(s).stage,'submitted');assert.ok(s.messages.filter(m=>m.rich?.stage==='submitted').flatMap(m=>m.rich!.parts?.flatMap(p=>p.cards)??[]).some(c=>c.kind==='status'&&c.billRows?.length));await inbox.ingest(final);assert.equal(await runtime.processNext(inbox.context),false);assert.equal((await inbox.snapshot()).requests.length,1);
}));

test('pack size and count guard preserves paint/pipe dimensions and original evidence',()=>{
 for(const [phrase,count,size,unit] of [['One 10L box',1,10,'litre'],['two 10L cans',2,10,'litre'],['10L paint',null,10,'litre'],['1-inch pipe',null,1,'inch'],['two 1-inch pipes',2,1,'inch']] as const){const result=protectQuantityEvidence([{kind:'add_item',query:phrase,quantity:size,requestedUnit:unit}],phrase)[0];assert.equal(result.kind,'add_item');if(result.kind!=='add_item')throw Error();assert.equal(result.quantity,count);if(unit==='inch'){assert.deepEqual(result.productMeasures,[{value:size,unit}]);assert.equal(result.packSize,undefined);}else assert.deepEqual(result.packSize,{value:size,unit});assert.equal(result.supportingPhrase,phrase);}
 const p={unit:'can',quantityStep:1,specifications:{size:'10L'}} as unknown as Product;assert.equal(amountToCount({requestedAmount:{value:20,unit:'litre'}} as any,p),2);assert.equal(amountToCount({requestedAmount:{value:15,unit:'litre'}} as any,p),null);assert.equal(amountToCount({requestedAmount:{value:20,unit:'litre'}} as any,{...p,specifications:{}}),null);
});

test('a later paint pack never becomes a wall-sticker specification',()=>{
 const phrase='Hello, enaku rendu pipe venum plus oru interior wall sticker wall la otra sticker venum. Aduthu vanthu Asian paint vanthu oru 10 liter box.';
 const result=protectQuantityEvidence([{kind:'add_item',query:'pipe',quantity:2},{kind:'add_item',query:'interior wall sticker',quantity:1},{kind:'add_item',query:'Asian paint',quantity:null,packSize:{value:10,unit:'litre'},requestedAmount:{value:1,unit:'box'}}],phrase);
 if(result[1].kind!=='add_item'||result[2].kind!=='add_item')throw Error('Expected additions');
 assert.equal(result[1].packSize,undefined);assert.equal(result[1].requestedUnit,undefined);assert.equal(result[1].quantity,1);
 assert.deepEqual(result[2].packSize,{value:10,unit:'litre'});assert.equal(result[2].quantity,1);assert.equal(result[2].requestedUnit,'box');assert.equal(result[2].requestedAmount,undefined);
});

test('a single unselected candidate has a usable selection button before full-list approval',()=>fixture(async(pool,inbox)=>{
 const state:ConversationState={version:1,visualOrdering:true,replyLanguage:'ta',draft:[{id:randomUUID(),name:'blade',query:'blade',quantity:1,resolution:'needs_choice',candidates:[{sku:'TEST0',name:'Test paint',unit:'can',pricePaise:10000,stock:100,version:1,aliases:[],quantityStep:1,specifications:{size:'10L'}}]}],pending:null,fulfillment:'pickup',lastRequestId:null};
 const line=state.draft[0];state.pending={kind:'products',id:randomUUID(),version:1,expiresAt:new Date(Date.now()+60000).toISOString(),groups:[{lineId:line.id,products:line.candidates!}],remaining:1};
 const rich=visualReply({version:1,kind:'text',text:'Check',presentation:'text',outboundMessages:1},state);
 assert.equal(rich.stage,'identify');const selection=buttons(rich).find(b=>b.event.type==='select_product');assert.ok(selection);assert.ok(!buttons(rich).some(b=>b.event.type==='confirm_products'));
}));

test('a product-choice question shows only that item, then reviews the complete retained list',()=>fixture(async(pool)=>{
 await setupImageDemo(pool);const id=randomUUID();await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'focused-choice')",[id,demoCatalogStore]);
 const inbox=new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'focused-choice',role:'customer'});
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'H01',quantity:2},{kind:'add_item',query:'blade',quantity:1,search:{keywords:['hacksaw'],familyId:'saw-blades'}}]),{visualOrdering:true});
 let s=await text(inbox,runtime,'two H01 pipes and one blade');const r=last(s);assert.equal(r.stage,'identify');assert.equal(r.outboundMessages,1);assert.equal(r.parts!.length,1);
 assert.ok(r.parts![0].cards.every(c=>c.kind==='product'&&c.lineId===s.conversation.draft[1].id));assert.ok(!buttons(r).some(b=>b.event.type==='confirm_products'));
 const select=buttons(r).find(b=>b.event.type==='select_product');assert.ok(select);const ids=s.conversation.draft.map(l=>l.id);
 s=await event(inbox,runtime,select.event);assert.deepEqual(s.conversation.draft.map(l=>l.id),ids);assert.equal(s.conversation.draft[0].quantity,2);assert.equal(last(s).stage,'products');
 assert.equal(last(s).parts!.flatMap(p=>p.cards).filter(c=>c.kind==='product').length,2);assert.ok(approve(s));
}));

test('requested 10L packs show a 10kg alternative without automatically selecting it or guessing volume',()=>fixture(async(pool)=>{
 await setupImageDemo(pool);const id=randomUUID();await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'pack-test')",[id,demoCatalogStore]);
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,family_id,brand,specifications) VALUES($1,'PAINT-KG','Asian Paints Distemper 10kg','litre',10000,20,'paint','Asian Paints','{\"weight\":\"10kg\"}'),($1,'PAINT-UNVERIFIED','Asian paint 10L','litre',10000,20,'paint','Asian Paints','{}')",[demoCatalogStore]);
 const inbox=new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'pack-test',role:'customer'});
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'Asian paint',quantity:1,packSize:{value:10,unit:'litre'},requestedUnit:'box'}]),{visualOrdering:true});
 const s=await text(inbox,runtime,'one 10 liter box Asian paint');assert.equal(s.conversation.draft[0].quantity,1);assert.equal(s.conversation.draft[0].resolution,'needs_choice');assert.equal(s.conversation.draft[0].sku,undefined);assert.equal(s.conversation.draft[0].packSize?.unit,'litre');assert.deepEqual(s.conversation.draft[0].candidates?.map(p=>p.sku),['PAINT-KG']);assert.equal(last(s).stage,'identify');assert.equal(s.requests.length,0);
}));

test('one remaining candidate progresses through product approval and bill instead of trapping the draft',()=>fixture(async(pool)=>{
 await setupImageDemo(pool);const id=randomUUID();await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'candidate-test')",[id,demoCatalogStore]);
 const inbox=new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'candidate-test',role:'customer'});
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'blade',quantity:1,search:{keywords:['hacksaw'],familyId:'saw-blades'}}]),{visualOrdering:true});
 let s=await text(inbox,runtime,'one blade');const select=buttons(last(s)).find(b=>b.event.type==='select_product');assert.ok(select);s=await event(inbox,runtime,select.event);assert.equal(last(s).stage,'bill');assert.equal(s.requests.length,0);s=await event(inbox,runtime,submit(s));assert.equal(s.requests.length,1);
}));
for(const mode of ['text','voice'])test(`${mode}: observed one 10-litre box remains one can, while a size alone asks its count`,()=>fixture(async(pool,inbox)=>{
 const phrase='one 10 liter box';const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'TEST0',quantity:10,requestedUnit:'litre'}],phrase),{visualOrdering:true,mediaRecommendations:true});
 let s:Snapshot;if(mode==='text')s=await text(inbox,runtime,phrase);else{const id=randomUUID(),pcm=Buffer.alloc(32000);for(let i=0;i<16000;i++)pcm.writeInt16LE(Math.round(Math.sin(i*.17)*1200),i*2);const media=await normalizeVoice({id,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')});await inbox.ingest({id,type:'voice',mediaId:id},media);await runtime.processNext(inbox.context);s=await inbox.snapshot();}
 assert.equal(s.conversation.draft[0].quantity,1);assert.equal(s.conversation.draft[0].packSize?.value,10);assert.equal(s.conversation.draft[0].supportingPhrase,phrase);s=await event(inbox,runtime,approve(s));const image=invoiceCards(s)[0];assert.ok(image.kind!=='product');assert.equal(image.billRows![0].packSize,'10 litre');assert.equal(image.billRows![0].count,'1 can');
}));

test('unknown count is requested after product approval; quantity answer advances without losing the approved identity',()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'TEST0',quantity:10,requestedUnit:'litre'}]),{visualOrdering:true});let s=await text(inbox,runtime,'10L paint');assert.equal(s.conversation.draft[0].quantity,null);s=await event(inbox,runtime,approve(s));assert.equal(last(s).stage,'quantity');assert.equal(last(s).parts![0].cards[0].kind,'product');s=await text(inbox,runtime,'2 cans');assert.equal(s.conversation.draft[0].quantity,2);assert.equal(last(s).stage,'bill');assert.equal(s.requests.length,0);
}));

test('targeted correction retains IDs, invalidates approvals, and redisplays every product; clear all actually resets',()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'TEST0',quantity:1},{kind:'add_item',query:'TEST1',quantity:2}]),{visualOrdering:true});let s=await text(inbox,runtime,'two items');const ids=s.conversation.draft.map(l=>l.id);s=await event(inbox,runtime,approve(s));const old=submit(s);s=await event(inbox,runtime,{id:randomUUID(),type:'set_quantity',lineId:ids[1],quantity:4,expectedVersion:s.conversation.version});assert.deepEqual(s.conversation.draft.map(l=>l.id),ids);assert.deepEqual(s.conversation.draft.map(l=>l.quantity),[1,4]);assert.equal(last(s).stage,'products');assert.equal(last(s).parts!.flatMap(p=>p.cards).filter(c=>c.kind==='product').length,2);s=await event(inbox,runtime,{...old,id:randomUUID()});assert.equal(s.requests.length,0);s=await text(inbox,runtime,'clear all');assert.deepEqual(s.conversation.draft,[]);assert.equal(s.conversation.pending,null);assert.equal(s.conversation.productReview,null);
}));

test('missing catalog requests survive and block global approval; returning greeting offers continue/new',()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'Asian Paints wall paint',quantity:1,packSize:{value:10,unit:'litre'},supportingPhrase:'one 10L box'}]),{visualOrdering:true});let s=await text(inbox,runtime,'one 10L box Asian Paints wall paint');assert.equal(last(s).stage,'shop_check');assert.equal(s.conversation.draft[0].quantity,1);assert.ok(!buttons(last(s)).some(b=>b.event.type==='confirm_products'));s=await text(inbox,runtime,'hello');assert.equal(last(s).stage,'returning');assert.ok(buttons(last(s)).some(b=>b.event.type==='shopping_action'&&b.event.action==='new_list'));const fresh=buttons(last(s)).find(b=>b.event.type==='shopping_action'&&b.event.action==='new_list')!.event;s=await event(inbox,runtime,fresh);assert.equal(s.conversation.draft.length,0);
}));

test('truncated interpretation and configured 50-line overflow never apply a partial list',()=>fixture(async(pool,inbox)=>{
 const ops:Operation[]=Array.from({length:51},(_,i)=>({kind:'add_item',query:'TEST'+(i%50),quantity:null}));let runtime=new ConversationRuntime(pool,planner(ops),{visualOrdering:true});let s=await text(inbox,runtime,'long list');assert.equal(s.conversation.draft.length,0);runtime=new ConversationRuntime(pool,planner(ops.slice(0,20),undefined,true),{visualOrdering:true});s=await text(inbox,runtime,'truncated list');assert.equal(s.conversation.draft.length,0);
}));

test('PNG templates shape mixed Tamil/Latin, cache identical renders and reject more than five rows',()=>{
 const dir=mkdtempSync('/tmp/visual-png-'),card={kind:'instruction' as const,title:'பொருட்களைப் பாருங்க',lines:['எல்லா photo-வும் பாருங்க.','மாற்றம் இருந்தா text / voice-ல சொல்லுங்க.'],caption:'Check'};const svg=visualSvg(card);assert.ok(svg.includes('aria-label="எல்லா photo-வும் பாருங்க."'));assert.ok(!svg.includes('<text'));const url=renderVisualImage(card,dir);assert.equal(renderVisualImage(card,dir),url);assert.ok(readFileSync(dir+'/'+url.split('/').at(-1)).subarray(1,4).equals(Buffer.from('PNG')));assert.throws(()=>visualSvg({...card,billRows:Array(6).fill({name:'x',packSize:'x',count:'1',unitPrice:'₹1',total:'₹1'})}),/five/);
});

test('cost planning uses configured service/category rates for the actual ordered group count',()=>{
 const rich={parts:[{cards:[{},{}]},{cards:[{},{}]},{cards:[{},{}]}]} as any;const c={serviceWindowOpen:true,catalogConnected:false,serviceRatePaise:0,allowMarketingCarousel:false,approvedCarousels:[],maxPaisePerTurn:100};assert.equal(planWhatsAppReply(rich,c).estimatedPaise,0);assert.equal(planWhatsAppReply(rich,{...c,serviceRatePaise:7}).estimatedPaise,21);assert.equal(planWhatsAppReply(rich,{...c,serviceWindowOpen:false}).format,'blocked');
});

const cfg:WhatsAppConfig={visualOrdering:true,aiEnabled:true,hostname:'example.test',storeId:simulatorContext.storeId,appId:'123456789',wabaId:'987654321',phoneId:'123987654',appSecret:'offline-test-secret',verifyToken:'offline-test-verification',accessToken:'offline-placeholder-not-real',graphVersion:'v25.0',recipients:['919000000001'],defaultReplyLanguage:'en',processEnabled:true,sendEnabled:true};
function webhook(body:string,id:string){return {object:'whatsapp_business_account' as const,entry:[{id:cfg.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:cfg.phoneId},messages:[{from:cfg.recipients[0],id,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body}}]}}]}]};}
test('partial group send blocks later parts and text approval until a complete review is resent',()=>fixture(async(pool)=>{
 let calls=0;const channel=new WhatsAppChannel(pool,cfg,async()=>{calls++;return new Response(JSON.stringify({error:{code:100}}),{status:400});},new GoogleInterpreter({allowPaidInference:false,apiKey:'offline-placeholder',model:'gemini-3.5-flash-lite',budgetMicrousd:0,freeQuota:{scope:'visual-delivery',model:'gemini-3.5-flash-lite'}},{generateContent:async()=>Object.assign(new GenerateContentResponse(),{candidates:[{content:{parts:[{text:JSON.stringify({operations:Array.from({length:10},(_,i)=>({kind:'add_item',query:'TEST'+i,quantity:1})),next:'review'})}]},finishReason:FinishReason.STOP}],modelVersion:'gemini-3.5-flash-lite',usageMetadata:{promptTokenCount:1000,candidatesTokenCount:300,totalTokenCount:1300}})}));await channel.setup();await channel.receive(webhook('shopping list','test-in'));await channel.processNext();let rows=(await pool.query('SELECT m.*,o.state FROM messages m JOIN whatsapp_outbox o ON o.message_id=m.id ORDER BY m.sequence')).rows;assert.equal(rows.length,2);assert.equal(rows[0].part_count,2);assert.equal(await channel.sendNext(),true);assert.equal(await channel.sendNext(),false);assert.equal(calls,1);const conversation=rows[0].conversation_id;const pending=(await pool.query('SELECT pending FROM conversations WHERE id=$1',[conversation])).rows[0].pending;const client=await pool.connect();try{assert.equal(await reviewDeliveryReady(client,conversation,pending.id),false);}finally{client.release();}await channel.receive(webhook('all correct','approve-incomplete'));await channel.processNext();assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_requests')).rows[0].n,0);assert.equal((await pool.query('SELECT product_review FROM conversations WHERE id=$1',[conversation])).rows[0].product_review,null);
}));

test('multipart approval requires delivery receipts for every part; accepted HTTP responses alone do not prove delivery',()=>fixture(async(pool)=>{
 const channel=new WhatsAppChannel(pool,cfg,async()=>new Response(JSON.stringify({messages:[{id:'synthetic-'+randomUUID()}]}),{status:200}),new GoogleInterpreter({allowPaidInference:false,apiKey:'offline-placeholder',model:'gemini-3.5-flash-lite',budgetMicrousd:0,freeQuota:{scope:'delivery-proof',model:'gemini-3.5-flash-lite'}},{generateContent:async()=>Object.assign(new GenerateContentResponse(),{candidates:[{content:{parts:[{text:JSON.stringify({operations:Array.from({length:10},(_,i)=>({kind:'add_item',query:'TEST'+i,quantity:1})),next:'review'})}]},finishReason:FinishReason.STOP}],modelVersion:'gemini-3.5-flash-lite',usageMetadata:{promptTokenCount:1000,candidatesTokenCount:300,totalTokenCount:1300}})}));
 await channel.setup();await channel.receive(webhook('ten item list','delivery-proof'));await channel.processNext();while(await channel.sendNext()){}
 const rows=(await pool.query('SELECT m.id,m.conversation_id,m.part_count,o.state FROM messages m JOIN whatsapp_outbox o ON o.message_id=m.id ORDER BY m.sequence')).rows;assert.equal(rows.length,2);assert.ok(rows.every(r=>r.state==='accepted'));
 const conversation=rows[0].conversation_id,binding=(await pool.query('SELECT pending FROM conversations WHERE id=$1',[conversation])).rows[0].pending.id,c=await pool.connect();
 try{
  assert.equal(await reviewDeliveryReady(c,conversation,binding),false);assert.equal(await reviewDeliveryReady(c,conversation,binding,true),false);
  await c.query("UPDATE whatsapp_outbox SET state='delivered' WHERE message_id=$1",[rows[1].id]);assert.equal(await reviewDeliveryReady(c,conversation,binding),false);
  for(const state of ['failed','unknown','blocked']){await c.query('UPDATE whatsapp_outbox SET state=$1 WHERE message_id=$2',[state,rows[0].id]);assert.equal(await reviewDeliveryReady(c,conversation,binding),false);}
  await c.query("UPDATE whatsapp_outbox SET state='read' WHERE message_id=$1",[rows[0].id]);assert.equal(await reviewDeliveryReady(c,conversation,binding),true);
  // Characterize the separate single-reply rule using one isolated group.
  // Typed/voice approval still needs delivery; a bound tap proves that reply.
  await c.query('UPDATE messages SET reply_group_id=$1,part_count=1 WHERE id=$2',[randomUUID(),rows[1].id]);await c.query("UPDATE whatsapp_outbox SET state='accepted' WHERE message_id=$1",[rows[1].id]);
  assert.equal(await reviewDeliveryReady(c,conversation,binding),false);assert.equal(await reviewDeliveryReady(c,conversation,binding,true),true);
  await c.query("UPDATE whatsapp_outbox SET state='unknown' WHERE message_id=$1",[rows[1].id]);assert.equal(await reviewDeliveryReady(c,conversation,binding,true),false);
 }finally{c.release();}
}));

for(const mode of ['text','voice'])for(const [phrase,count,size,unit,sku] of [['10L paint',null,10,'litre','TEST0'],['two 10L cans',2,10,'litre','TEST0'],['1-inch pipe',null,1,'inch','PIPE-ONE'],['two 1-inch pipes',2,1,'inch','PIPE-ONE']] as const)test(`${mode} preserves ${phrase}`,()=>fixture(async(pool,inbox)=>{
 await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,image_path,specifications) VALUES($1,'PIPE-ONE','1 inch PVC pipe','piece',12500,100,'/demo-images/H01.jpg','{\"size\":\"1 inch\"}')",[simulatorContext.storeId]);
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:sku,quantity:size,requestedUnit:unit}],phrase),{visualOrdering:true,mediaRecommendations:true});let s:Snapshot;
 if(mode==='text')s=await text(inbox,runtime,phrase);else{const id=randomUUID(),pcm=Buffer.alloc(32000);for(let i=0;i<16000;i++)pcm.writeInt16LE(Math.round(Math.sin(i*.17)*1200),i*2);await inbox.ingest({id,type:'voice',mediaId:id},await normalizeVoice({id,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')}));await runtime.processNext(inbox.context);s=await inbox.snapshot();}
 assert.equal(s.conversation.draft[0].quantity,count);if(unit==='inch'){assert.deepEqual(s.conversation.draft[0].productMeasures,[{value:size,unit}]);assert.equal(s.conversation.draft[0].packSize,undefined);}else assert.deepEqual(s.conversation.draft[0].packSize,{value:size,unit});assert.equal(s.requests.length,0);assert.equal(last(s).stage,'products');
}));

test('expired reviews and changed prices require a fresh review; late confirmations never submit',()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner([{kind:'add_item',query:'TEST0',quantity:1}]),{visualOrdering:true});let s=await text(inbox,runtime,'one can');s=await event(inbox,runtime,approve(s));const old=submit(s);await pool.query("UPDATE conversations SET pending=jsonb_set(pending,'{expiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1",[inbox.context.conversationId]);s=await event(inbox,runtime,old);assert.equal(s.requests.length,0);assert.equal(last(s).stage,'bill');const refreshed=submit(s);await pool.query("UPDATE products SET price_paise=15000,version=version+1 WHERE store_id=$1 AND sku='TEST0'",[simulatorContext.storeId]);s=await event(inbox,runtime,refreshed);assert.equal(s.requests.length,0);s=await text(inbox,runtime,'review');assert.equal(last(s).stage,'products');s=await event(inbox,runtime,approve(s));assert.equal(s.conversation.pending?.kind,'review');if(s.conversation.pending?.kind!=='review')throw Error();assert.equal(s.conversation.pending.totalPaise,15000);
}));

test('legacy ambiguous litre quantity is kept for fresh clarification, not treated as ten cans',()=>fixture(async(pool,inbox)=>{
 await pool.query('UPDATE conversations SET draft=$1,pending=NULL WHERE id=$2',[JSON.stringify([{id:randomUUID(),query:'TEST0',sku:'TEST0',name:'Test paint 0',quantity:10,unit:'can',requestedUnit:'litre',pricePaise:10000,productVersion:1,resolution:'needs_unit',discovery:{plan:{specifications:{size:'10L'}}}}]),inbox.context.conversationId]);const runtime=new ConversationRuntime(pool,planner([]),{visualOrdering:true});let s=await text(inbox,runtime,'review');assert.equal(s.conversation.draft[0].quantity,null);assert.equal(s.conversation.draft[0].packSize?.value,10);s=await event(inbox,runtime,approve(s));assert.equal(last(s).stage,'quantity');
}));

test('50-item edit picker covers every stable ID and keeps approval off the product buttons',()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,planner(Array.from({length:50},(_,i)=>({kind:'add_item',query:'TEST'+i,quantity:1}))),{visualOrdering:true});let s=await text(inbox,runtime,'shopping list');const ids=s.conversation.draft.map(l=>l.id);s=await event(inbox,runtime,{id:randomUUID(),type:'shopping_action',action:'edit_list',expectedVersion:s.conversation.version});const messages=s.messages.filter(m=>m.direction==='outbound'&&m.rich?.stage==='correction');assert.equal(messages.length,6);const editIds=new Set(messages.flatMap(m=>buttons(m.rich!)).flatMap(b=>b.event.type==='edit_item'?[b.event.lineId]:[]));assert.deepEqual(editIds,new Set(ids));
}));

test('an empty search or processing failure preserves its message instead of restarting the welcome',()=>{
 const state:ConversationState={visualOrdering:true,replyLanguage:'en',version:0,draft:[],pending:null,fulfillment:'pickup',lastRequestId:null};const base:RichReply={version:1,kind:'text',text:'The shop needs to check this cutting plier. Send a photo or describe it.',presentation:'text',outboundMessages:1};const r=visualReply(base,state);assert.equal(r.stage,'status');assert.match(r.text,/cutting plier/);assert.ok(!r.text.includes('Welcome'));
});

for(const stage of ['products','bill'])test(`shop handoff during ${stage} delivers its acknowledgement and pauses the assistant`,()=>fixture(async(pool)=>{
 let sends=0;
 const provider=new GoogleInterpreter({allowPaidInference:false,apiKey:'offline-placeholder',model:'gemini-3.5-flash-lite',budgetMicrousd:0,freeQuota:{scope:'visual-handoff',model:'gemini-3.5-flash-lite'}},{generateContent:async()=>Object.assign(new GenerateContentResponse(),{candidates:[{content:{parts:[{text:JSON.stringify({operations:[{kind:'add_item',query:'TEST0',quantity:1}],next:'review'})}]},finishReason:FinishReason.STOP}],modelVersion:'gemini-3.5-flash-lite',usageMetadata:{promptTokenCount:100,candidatesTokenCount:100,totalTokenCount:200}})});
 const channel=new WhatsAppChannel(pool,cfg,async()=>new Response(JSON.stringify({messages:[{id:'wamid.handoff.'+(++sends)}]}),{status:200}),provider);
 await channel.setup();await channel.receive(webhook('one TEST0','handoff-start'));await channel.processNext();assert.equal(await channel.sendNext(),true);
 const first=(await pool.query("SELECT m.*,o.state FROM messages m JOIN whatsapp_outbox o ON o.message_id=m.id ORDER BY m.sequence DESC LIMIT 1")).rows[0];
 if(stage==='bill'){
  const action=(await pool.query("SELECT id,label FROM whatsapp_actions WHERE message_id=$1 AND event->>'type'='confirm_products' LIMIT 1",[first.id])).rows[0];assert.ok(action);
  const input:any=webhook('button','handoff-approve');const m=input.entry[0].changes[0].value.messages[0];m.type='interactive';delete m.text;m.interactive={type:'button_reply',button_reply:{id:action.id,title:action.label}};
  await channel.receive(input);await channel.processNext();assert.equal(await channel.sendNext(),true);
 }
 const before=(await pool.query('SELECT pending FROM conversations WHERE id=$1',[first.conversation_id])).rows[0];assert.equal(before.pending.kind,stage==='bill'?'review':'products');
 await channel.receive(webhook('talk to shop','handoff-help'));await channel.processNext();
 const ack=(await pool.query("SELECT m.*,o.sender_kind,o.state FROM messages m JOIN whatsapp_outbox o ON o.message_id=m.id ORDER BY m.sequence DESC LIMIT 1")).rows[0];
 assert.equal(ack.payload.handoffRequested,true);assert.equal(ack.payload.stage,'status');assert.equal(ack.sender_kind,'system');assert.match(ack.text,/shop assistance requested/i);
 assert.ok(!buttons(ack.payload).some(b=>['confirm','confirm_products'].includes(b.event.type)));
 const state=(await pool.query('SELECT operator_mode,handoff_requested,jsonb_array_length(draft) AS lines FROM conversations WHERE id=$1',[first.conversation_id])).rows[0];assert.equal(state.operator_mode,'owner');assert.equal(state.handoff_requested,true);assert.equal(state.lines,1);
 assert.equal(await channel.sendNext(),true);assert.equal((await pool.query('SELECT state FROM whatsapp_outbox WHERE message_id=$1',[ack.id])).rows[0].state,'accepted');assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_requests')).rows[0].n,0);
}));
