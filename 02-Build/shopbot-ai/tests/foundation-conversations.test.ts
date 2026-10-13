import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {pcmWav} from '../apps/server/src/services/voice-media.js';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {productCheckReply} from '../apps/server/src/services/product-verification.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';
import {spokenClearCommand,negatedSpokenClear} from '../apps/server/src/services/shopping-language.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import type {Snapshot,SimulatorEvent} from '../packages/contracts/index.js';

test('explicit Tamil clear survives incidental speech and list inflections, without matching examples or compound edits',()=>{
 const explicit=[
  'பட்டியலை காலி செய்',
  'பட்டியலையே காலி செய். ஆமா',
  'பேசவா. 9:30க்குதான் எடுக்கணும். பட்டியலையே காலி செய். ஆமா. நான் வேலையில',
  'நான் பேசுறேன் 9:30க்கு தான் இருக்கு அதுல பட்டியலாய காலி செய் ஆமா என்ன வேலையில',
  'பட்டியல் எல்லாம் காலி செய்',
 ];
 for(const utterance of explicit){assert.equal(spokenClearCommand(utterance),'clear my list',utterance);assert.equal(negatedSpokenClear(utterance),false,utterance);}
 const rejected=[
  'patiala idli khali chey',
  'பட்டியலையே காலி செய் வேண்டாம்',
  'பட்டியலையே காலி செய் பண்ணாதே',
  'பட்டியலையே காலி செய் பண்ணாதீங்க',
  'பட்டியலையே காலி செய் செய்யாதே',
  'பட்டியலையே காலி செய் செய்யாதீங்க',
  'பட்டியலையே காலி செய் இல்ல',
  'பட்டியலையே காலி செய் சொல்லல',
  'பட்டியலையே காலி செய் ஆமா பெயிண்ட் சேர்',
  'பட்டியலாய காலி செய் and add paint',
  '“பட்டியலையே காலி செய்” என்று உதாரணம் சொன்னேன்',
  'பட்டியலையே காலி செய்?',
  'பட்டியலையே காலி செய் வேண்டுமா',
  'பட்டியலையே காலி செய் என்று சொன்னா',
  'பட்டியலையே காலி செய் please remove the pipe',
 ];
 for(const utterance of rejected)assert.equal(spokenClearCommand(utterance),undefined,utterance);
 for(const utterance of rejected.slice(1,8))assert.equal(negatedSpokenClear(utterance),true,utterance);
 for(const utterance of rejected.filter(utterance=>utterance.includes('உதாரணம்')||utterance.endsWith('?')||utterance.endsWith('வேண்டுமா')))assert.equal(negatedSpokenClear(utterance),true,utterance);
});

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const schema='foundation_conversation_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');
  await setupImageDemo(pool);
  const conversationId=randomUUID();
  await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'foundation-test')",[conversationId,demoCatalogStore]);
  const inbox=new SimulatorService(pool,{storeId:demoCatalogStore,conversationId,actor:'foundation-test',role:'customer'});
  await run(pool,inbox);
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}

async function turn(inbox:SimulatorService,runtime:ConversationRuntime,event:SimulatorEvent){
 await inbox.ingest(event);await runtime.processNext(inbox.context);return inbox.snapshot();
}
const text=(inbox:SimulatorService,runtime:ConversationRuntime,value:string)=>turn(inbox,runtime,{id:randomUUID(),type:'text',text:value});
const last=(state:Snapshot)=>state.messages.at(-1)!.rich!;

test('legacy wrong-family product choices cannot be accepted after retrieval changes',async()=>fixture(async(pool,inbox)=>{
 const provider:Interpreter={name:'legacy-choice',mode:'mock',interpret:async()=>({output:{operations:[{kind:'add_item',query:'H22',quantity:1}],next:'review'},usage:null,truncated:false})};
 const runtime=new ConversationRuntime(pool,provider);
 const snapshot=await text(inbox,runtime,'one scraper');
 const state=snapshot.conversation,line=state.draft[0];assert.equal(state.pending?.kind,'products');
 line.query='Asian Paints wall paint';line.name=line.query;delete line.sku;line.resolution='needs_choice';
 line.discovery={...line.discovery!,query:line.query,plan:{keywords:['wall stencil'],familyId:'wall-stencils'}};
 await pool.query('UPDATE conversations SET draft=$1::jsonb WHERE id=$2',[JSON.stringify(state.draft),inbox.context.conversationId]);
 const tools=new RetailTools(pool),batchId=state.pending!.id;
 await assert.rejects(tools.invoke({...inbox.context,consentProductBatchId:batchId},{name:'confirm_product_choices',args:{batchId,choices:[{lineId:line.id,sku:'H22'}]}},randomUUID()),/no longer matches/);
 await assert.rejects(tools.invoke(inbox.context,{name:'apply_draft_changes',args:{expectedVersion:state.version,operations:[{kind:'resolve_line',lineId:line.id,query:'H22'}]}},randomUUID()),/no longer matches/);
 assert.deepEqual((await inbox.snapshot()).conversation,state);
}));

test('four-item corrections retain the active line, avoid unrelated images and reject old photo actions',async()=>fixture(async(_pool,inbox)=>{
 const provider:Interpreter={name:'four-item-correction',mode:'mock',interpret:async input=>({output:input.text.includes('wall paint')?{operations:[{kind:'resolve_line',lineId:input.state.draft[1].id,query:'Asian Paints wall paint',quantity:2}],next:'review'}:input.text.includes('cutting plier')?{operations:[{kind:'resolve_line',lineId:input.state.draft[1].id,query:'cutting plier',quantity:2}],next:'review'}:{operations:[{kind:'add_item',query:'H07',quantity:2},{kind:'add_item',query:'Asian Paints',quantity:2},{kind:'add_item',query:'H08',quantity:2},{kind:'add_item',query:'H19',quantity:2}],next:'review'},usage:null,truncated:false})};
 const runtime=new ConversationRuntime(_pool,provider,{sequentialItems:true});
 let state=await text(inbox,runtime,'two solvent bottles, two Asian Paints, two pipes and two cutters');
 const ids=state.conversation.draft.map(line=>line.id),quantities=state.conversation.draft.map(line=>line.quantity);
 assert.equal(ids.length,4);assert.equal(state.conversation.pending?.kind,'products');
 const oldPhoto=last(state).cards![0].action!;
 state=await turn(inbox,runtime,oldPhoto);
 assert.equal(state.conversation.pending?.kind,'question');
 assert.equal(state.conversation.pending.lineId,ids[1]);
 state=await text(inbox,runtime,'No, for item 2 I meant Asian Paints wall paint');
 assert.deepEqual(state.conversation.draft.map(line=>line.id),ids);
 assert.deepEqual(state.conversation.draft.map(line=>line.quantity),quantities);
 assert.equal(state.conversation.draft[1].query,'Asian Paints wall paint');
 assert.equal(last(state).cards?.length??0,0);
 assert.equal(last(state).buttons?.some(button=>button.event.type==='confirm_products')??false,false);
 const rendered=renderWhatsAppReply(last(state),randomUUID(),'catalog.example.test');
 assert.doesNotMatch(JSON.stringify(rendered.payload),/H22|H23|H24|H25|stencil|scraper/i);
 const before=state.conversation;
 state=await turn(inbox,runtime,{...oldPhoto,id:randomUUID()});
 assert.deepEqual(state.conversation,before);
 state=await text(inbox,runtime,'No, I meant a cutting plier for item 2');
 assert.deepEqual(state.conversation.draft.map(line=>line.id),ids);
 assert.deepEqual(state.conversation.draft.map(line=>line.quantity),quantities);
 assert.equal(state.conversation.draft[1].query,'cutting plier');
 assert.equal(last(state).cards?.length??0,0);
 assert.equal(state.requests.length,0);
}));

test('sequential multi-item photo checks keep the no-exact warning in every reply language and WhatsApp body',async()=>fixture(async(pool,inbox)=>{
 const provider:Interpreter={name:'related-warning',mode:'mock',interpret:async()=>({output:{operations:[{kind:'add_item',query:'H07',quantity:2},{kind:'add_item',query:'paint',quantity:2}],next:'review'},usage:null,truncated:false})};
 const state=await text(inbox,new ConversationRuntime(pool,provider,{sequentialItems:true}),'two solvent bottles and two paints');
 const first=state.conversation.draft[0],second=state.conversation.draft[1];
 const product=first.candidates![0];
 const discovery={...first.discovery!,query:'paint',products:[product],noExactMatch:true};
 const pending={kind:'products' as const,id:randomUUID(),version:state.conversation.version,expiresAt:new Date(Date.now()+900000).toISOString(),groups:[{lineId:second.id,products:[product],discovery}],remaining:0};
 for(const [language,warning] of [['en','not a confirmed match'],['ta','உறுதி இல்லை'],['ta-Latn','confirm aagala']] as const){
  const reply=productCheckReply({...state.conversation,replyLanguage:language,pending});
  assert.match(reply.text,new RegExp(warning));
  const whatsApp=renderWhatsAppReply({...reply,replyLanguage:language},randomUUID(),'catalog.example.test');
  assert.match(JSON.stringify(whatsApp.payload),new RegExp(warning));
 }
}));

test('an absent product can wait for shop checking while later products are verified without submitting an incomplete list',async()=>fixture(async(pool,inbox)=>{
 const provider:Interpreter={name:'next-item-flow',mode:'mock',interpret:async input=>({output:input.text.includes('replace')?{operations:[{kind:'resolve_line',lineId:input.state.draft[1].id,query:'wall paint'}],next:'review'}:{operations:[{kind:'add_item',query:'H07',quantity:2},{kind:'add_item',query:'Asian Paints wall paint',quantity:1},{kind:'add_item',query:'H08',quantity:2},{kind:'add_item',query:'H19',quantity:2}],next:'review'},usage:null,truncated:false})};
 const runtime=new ConversationRuntime(pool,provider,{sequentialItems:true});
 let s=await text(inbox,runtime,'four products');
 s=await turn(inbox,runtime,last(s).cards![0].action!);
 const before=s.conversation,ids=before.draft.map(l=>l.id),quantities=before.draft.map(l=>l.quantity);
 assert.equal(before.pending?.kind,'question');assert.equal((before.pending as any).lineId,ids[1]);
 assert.match(last(s).text,/Asian Paints wall paint/);assert.doesNotMatch(last(s).text,/What will you use|size, type or brand/);assert.match(last(s).text,/H08 and H19|Teflon Tape and Ratchet/);
 const next=last(s).buttons!.find(b=>b.event.type==='shopping_action'&&b.event.action==='next_item')!.event;
 // A forged choice, even at the right version, must be displayed first.
 s=await turn(inbox,runtime,{...next,id:randomUUID()});assert.deepEqual(s.conversation,before);
 s=await turn(inbox,runtime,next);
 assert.deepEqual(s.conversation.draft.map(l=>l.id),ids);assert.deepEqual(s.conversation.draft.map(l=>l.quantity),quantities);
 assert.equal(s.conversation.draft[1].shopCheckDeferred,true);assert.equal(s.conversation.draft[1].productConfirmation,undefined);
 assert.equal(s.conversation.pending?.kind,'products');assert.equal((s.conversation.pending as any).groups[0].lineId,ids[2]);
 const continued=s.conversation,thirdPhoto=last(s).cards![0].action!;
 s=await turn(inbox,runtime,{...next,id:randomUUID()});assert.deepEqual(s.conversation,continued);
 s=await turn(inbox,runtime,thirdPhoto);
 // Finish any remaining current product check; the absent line still blocks review.
 if(s.conversation.pending?.kind==='products'){
  const batch=s.conversation.pending;s=await turn(inbox,runtime,{id:randomUUID(),type:'select_product',batchId:batch.id,lineId:batch.groups[0].lineId,sku:batch.groups[0].products[0].sku});
 }
 assert.equal(s.conversation.pending?.kind,'question');assert.equal((s.conversation.pending as any).lineId,ids[1]);
 assert.deepEqual(s.conversation.draft.map(l=>l.id),ids);assert.deepEqual(s.conversation.draft.map(l=>l.quantity),quantities);assert.equal(s.requests.length,0);
 assert.ok(s.conversation.draft.filter((_,i)=>i!==1).every(l=>l.productConfirmation));
 assert.ok(!last(s).buttons?.some(b=>b.event.type==='confirm'));
 s=await text(inbox,runtime,'replace paint description');assert.equal(s.conversation.draft[1].shopCheckDeferred,undefined);assert.equal(s.requests.length,0);
}));


test('refusing displayed photos by voice cannot erase unrelated lines',async()=>fixture(async(pool,inbox)=>{
 const provider:Interpreter={name:'photo-refusal',mode:'mock',supportsAudio:true,interpret:async input=>({output:input.stage==='recognize'?{transcript:'None of these; I need a cutting plier',operations:[],next:'continue'}:input.text==='two products'?{operations:[{kind:'add_item',query:'H07',quantity:2},{kind:'add_item',query:'H08',quantity:3}],next:'review'}:{operations:input.state.draft.map(line=>({kind:'remove_item',reference:line.id})),next:'review'},usage:null,truncated:false})};
 const runtime=new ConversationRuntime(pool,provider,{sequentialItems:true});
 let s=await text(inbox,runtime,'two products');assert.equal(s.conversation.pending?.kind,'products');assert.ok(last(s).cards?.length);
 const before=s.conversation,id=randomUUID(),audio=pcmWav(Buffer.alloc(32000,1));
 await inbox.ingest({id,type:'voice',mediaId:id},{audio,durationSeconds:1,sourceHash:createHash('sha256').update(audio).digest('hex')});
 await runtime.processNext(inbox.context);s=await inbox.snapshot();
 assert.deepEqual(s.conversation,before);assert.equal(s.requests.length,0);assert.match(last(s).text,/Which item should I remove/);
 assert.deepEqual((await pool.query('SELECT stage,state FROM provider_attempts WHERE message_id=$1 ORDER BY attempt',[id])).rows.map(row=>[row.stage,row.state]),[['recognize','succeeded'],['identify','succeeded']]);
}));

test('empty discovery acknowledges the named request and quantity instead of repeating its purpose or claiming shop stock',async()=>fixture(async(pool,inbox)=>{
 const provider:Interpreter={name:'empty-discovery',mode:'mock',interpret:async()=>({output:{operations:[],next:'assist',assistance:{rootQuery:'Asian Paints wall paint',queries:['Asian Paints wall paint'],quantity:1,question:'What size or brand do you want?'}},usage:null,truncated:false})};
 const runtime=new ConversationRuntime(pool,provider);
 for(const language of ['en','ta','ta-Latn'] as const){
  await pool.query('UPDATE conversations SET reply_language=$1 WHERE id=$2',[language,inbox.context.conversationId]);
  const s=await text(inbox,runtime,'one Asian Paints wall paint');
  assert.match(last(s).text,/Asian Paints wall paint/);assert.match(last(s).text,/1/);
  assert.doesNotMatch(last(s).text,/What size|What will you use|not in stock|brand|என்ன வேலை|Enna velaikku/i);
  assert.equal(last(s).cards?.length??0,0);assert.equal(s.requests.length,0);
  assert.ok(last(s).buttons?.some(button=>button.event.type==='shopping_action'&&button.event.action==='handoff'));
 }
}));

test('Tamil list additions are acknowledged before the pending missing item, and voice clearing gets explicit feedback',async()=>fixture(async(pool,inbox)=>{
 await pool.query("UPDATE conversations SET reply_language='ta' WHERE id=$1",[inbox.context.conversationId]);
 const provider:Interpreter={name:'tamil-ack',mode:'mock',supportsAudio:true,interpret:async input=>({output:input.stage==='recognize'?{transcript:'பட்டியலை காலி செய்',operations:[],next:'continue'}:input.text==='add a wrench'?{operations:[{kind:'add_item',query:'wrench',quantity:1}],next:'review'}:{operations:[{kind:'add_item',query:'cutting plier',quantity:1}],next:'review'},usage:null,truncated:false})};
 const runtime=new ConversationRuntime(pool,provider,{sequentialItems:true});
 let s=await text(inbox,runtime,'one cutting plier');const original=s.conversation.draft[0];
 s=await text(inbox,runtime,'add a wrench');assert.equal(s.conversation.draft[0].id,original.id);assert.equal(s.conversation.draft[0].quantity,1);assert.match(last(s).text,/சேர்த்திருக்கிறேன்: 1 wrench/);assert.match(last(s).text,/cutting plier/);assert.equal(s.requests.length,0);
 const id=randomUUID(),audio=pcmWav(Buffer.alloc(6400));await inbox.ingest({id,type:'voice',mediaId:id},{audio,durationSeconds:0.2,sourceHash:createHash('sha256').update(audio).digest('hex')});await runtime.processNext(inbox.context);s=await inbox.snapshot();assert.equal(s.conversation.draft.length,0);assert.match(last(s).text,/பட்டியலைக் காலி செய்துள்ளேன்/);
}));
test('an unspecified cutter remains unselected and asks what to cut, without unknown-quantity symbols',async()=>fixture(async(pool,inbox)=>{
 const provider:Interpreter={name:'vague-cutter',mode:'mock',interpret:async()=>({output:{operations:[{kind:'add_item',query:'cutter',quantity:null,search:{keywords:['PVC pipe cutter'],familyId:'pipe-cutters'}}],clarifyQuestion:'இது சரியான பைப் கட்டர். உறுதி செய்யுங்கள்.',next:'review'},usage:null,truncated:false})};
 await pool.query("UPDATE conversations SET reply_language='ta' WHERE id=$1",[inbox.context.conversationId]);
 const s=await text(inbox,new ConversationRuntime(pool,provider,{sequentialItems:true}),'cutter venum');assert.equal(s.conversation.draft[0].sku,undefined);assert.equal(s.conversation.draft[0].quantity,null);assert.match(last(s).text,/எதை வெட்ட/);assert.doesNotMatch(last(s).text,/\?\s*×/);assert.equal(s.requests.length,0);
}));
test('a catalogued item with insufficient stock is not described as missing from the catalog',async()=>fixture(async(pool,inbox)=>{
 await pool.query("UPDATE conversations SET reply_language='ta' WHERE id=$1",[inbox.context.conversationId]);
 await pool.query('UPDATE products SET stock=0 WHERE store_id=$1 AND sku=$2',[inbox.context.storeId,'H19']);
 const provider:Interpreter={name:'known-stock',mode:'mock',interpret:async()=>({output:{operations:[{kind:'add_item',query:'H19',quantity:1}],next:'review'},usage:null,truncated:false})};
 const runtime=new ConversationRuntime(pool,provider,{sequentialItems:true});let s=await text(inbox,runtime,'one H19');
 if(s.conversation.pending?.kind==='products')s=await turn(inbox,runtime,last(s).cards![0].action!);
 assert.match(last(s).text,/பட்டியலில் உள்ளது|இருப்பு/);assert.doesNotMatch(last(s).text,/கண்டுபிடிக்க முடியவில்லை/);assert.equal(s.requests.length,0);
}));
