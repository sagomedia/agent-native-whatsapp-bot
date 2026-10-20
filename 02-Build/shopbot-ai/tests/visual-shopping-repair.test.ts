import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {understandingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';
import {normalizeVoice,pcmWav} from '../apps/server/src/services/voice-media.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import type {Snapshot,SimulatorEvent,ConversationState} from '../packages/contracts/index.js';

const base={schemaVersion:2,inputKind:'text',intents:['edit'],requestedItems:[],proposedEdits:[],shopQuestions:[],unresolved:[]};
async function fixture(run:(pool:pg.Pool,inbox:SimulatorService,runtime:ConversationRuntime,provider:{value:unknown;calls:number})=>Promise<void>,count=3,language:ConversationState['replyLanguage']='en'){
 const schema='visual_repair_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');const id=randomUUID(),ctx={storeId:fixtureStore,conversationId:id,actor:'synthetic-visual-review',role:'customer' as const};
  await pool.query('INSERT INTO conversations(id,store_id,actor,reply_language,reply_language_explicit,visual_ordering) VALUES($1,$2,$3,$4,true,true)',[id,fixtureStore,ctx.actor,language]);
  for(let n=0;n<count;n++)await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases,selling_unit_verified,image_path) VALUES($1,$2,$3,'piece',1000,100,'[]',true,$4)",[fixtureStore,'VIS-'+n,['PVC pipe','Blueguard PVC pipe','screw box'][n]??'Synthetic item '+n,'/demo-images/H'+(n===2?'27':String(n%30+1).padStart(2,'0'))+'.jpg']);
  const tools=new RetailTools(pool);await tools.invoke(ctx,{name:'apply_draft_changes',args:{expectedVersion:0,operations:Array.from({length:count},(_,n)=>({kind:'add_item' as const,query:'VIS-'+n,quantity:n+1}))}},randomUUID());
  await pool.query('UPDATE conversations SET pending=NULL,editing_line_id=NULL WHERE id=$1',[id]);
  const output:{value:unknown;calls:number}={value:{...base,clarifyQuestion:'What should change in your list?'},calls:0};
  const provider:Interpreter={name:'offline-visual-repair',mode:'mock',unifiedUnderstanding:true,supportsAudio:true,interpret:async input=>{output.calls++;return {output:understandingToInterpretation(output.value,input,false),usage:null,truncated:false};}};
  await run(pool,new SimulatorService(pool,ctx),new ConversationRuntime(pool,provider,{visualOrdering:true}),output);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
async function send(i:SimulatorService,r:ConversationRuntime,event:SimulatorEvent){await i.ingest(event);await r.processNext(i.context);return i.snapshot();}
const text=(i:SimulatorService,r:ConversationRuntime,value:string)=>send(i,r,{id:randomUUID(),type:'text',text:value});
async function voice(i:SimulatorService,r:ConversationRuntime){const id=randomUUID(),pcm=Buffer.alloc(16000);for(let n=0;n<8000;n++)pcm.writeInt16LE(Math.round(Math.sin(n*.17)*1500),n*2);await i.ingest({id,type:'voice',mediaId:id},await normalizeVoice({id,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')}));await r.processNext(i.context);return i.snapshot();}
function currentReply(s:Snapshot){return s.messages.filter(m=>m.direction==='outbound').at(-1)!.rich!;}
function productCards(s:Snapshot){return currentReply(s).parts?.flatMap(p=>p.cards).filter(c=>c.kind==='product')??[];}
function assertVisual(s:Snapshot,skus:string[]){const rich=currentReply(s),cards=productCards(s);assert.deepEqual(cards.map(c=>c.kind==='product'?c.product.sku:''),skus);const rendered=rich.parts!.map(p=>renderWhatsAppReply({...rich,parts:[p]},randomUUID(),'shop.example.test'));assert.ok(rendered.every(p=>['image','buttons','carousel'].includes(p.format)));if(skus.length>1)assert.ok(rendered.some(p=>p.format==='carousel'));assert.equal(s.requests.length,0);return rendered;}
function capture(name:string,s:Snapshot){
 const dir=process.env.VISUAL_REPAIR_EVIDENCE_DIR;if(!dir)return;mkdirSync(dir,{recursive:true});
 const rich=currentReply(s),replies=s.messages.filter(m=>m.direction==='outbound'&&(rich.groupId?m.rich?.groupId===rich.groupId:m.rich===rich)).map(m=>m.rich!);
 writeFileSync(join(dir,name+'.json'),JSON.stringify({name,language:s.conversation.replyLanguage,draft:s.conversation.draft.map(l=>({id:l.id,sku:l.sku,name:l.name,quantity:l.quantity,requestedAmount:l.requestedAmount})),rich,replies,payloads:replies.map(reply=>renderWhatsAppReply(reply,randomUUID(),'shop.example.test')),requests:s.requests.length},null,2));
}

for(const phrase of ['show my list','இல்ல, பர்ஸ்ட் லிஸ்ட்ட காமி','ஒன்னும் மாத்த வேணாம், பொருளை காமி','onnum maatha venam, list-a kaami'])test(`explicit viewing reopens the previously delivered carousel: ${phrase}`,()=>fixture(async(_pool,i,r,out)=>{
 await text(i,r,'review');const before=(await i.snapshot()).conversation;
 const s=await text(i,r,phrase);capture('view-'+(['show my list','இல்ல, பர்ஸ்ட் லிஸ்ட்ட காமி','ஒன்னும் மாத்த வேணாம், பொருளை காமி','onnum maatha venam, list-a kaami'].indexOf(phrase)),s);
 assertVisual(s,['VIS-0','VIS-1','VIS-2']);assert.deepEqual(s.conversation,before);assert.doesNotMatch(currentReply(s).text,/What should change|shall we|would you like me/i);assert.equal(out.calls,0);
}));

test('a spoken viewing request shows the saved products without the old edit question',()=>fixture(async(_pool,i,r,out)=>{
 await text(i,r,'review');const before=(await i.snapshot()).conversation;
 out.value={...base,inputKind:'audio',transcript:'ஒன்னும் மாத்த வேணாம், பொருளை காமி',clarifyQuestion:'What should change in your list?'};
 const s=await voice(i,r);capture('spoken-view',s);assertVisual(s,['VIS-0','VIS-1','VIS-2']);assert.deepEqual(s.conversation,before);assert.equal(out.calls,1);
}));

test('a real count edit retains the affected product photo after its old photo was delivered',()=>fixture(async(_pool,i,r,out)=>{
 await text(i,r,'review');const before=(await i.snapshot()).conversation,pipe=before.draft[0];
 out.value={...base,proposedEdits:[{kind:'set_quantity',targetLineId:pipe.id,targetQuery:'PVC pipe',sourceText:'make PVC pipe three',quantity:3}]};
 const s=await text(i,r,'make PVC pipe three');capture('quantity-edit',s);assert.equal(s.conversation.draft[0].quantity,3);assertVisual(s,['VIS-0']);assert.match(productCards(s)[0].caption,/3/);assert.equal(productCards(s)[0].kind==='product'&&productCards(s)[0].product.imageUrl,pipe.candidates![0].imageUrl);assert.deepEqual(s.conversation.draft.slice(1),before.draft.slice(1));
}));

test('a removal shows the remaining current products instead of an unchanged text summary',()=>fixture(async(_pool,i,r,out)=>{
 await text(i,r,'review');const before=(await i.snapshot()).conversation;
 out.value={...base,proposedEdits:[{kind:'remove_item',targetLineId:before.draft[2].id,targetQuery:'screw box',sourceText:'remove screw box'}]};
 const s=await text(i,r,'remove screw box');capture('removal-review',s);assertVisual(s,['VIS-0','VIS-1']);assert.match(currentReply(s).text,/Removed screw box/);assert.equal(s.conversation.draft.some(l=>l.sku==='VIS-2'),false);
}));

for(const [language,phrase] of [['en',"Let me check what I've already picked"],['ta','நான் எடுத்திருக்கும் சாமான்களை ஒரு தடவை பார்க்கணும்'],['ta-Latn','naan edutha saamana oru thadava paarkanum']] as const)test(`semantic viewing intent supports a paraphrase in ${language}`,()=>fixture(async(_pool,i,r,out)=>{
 await text(i,r,'review');const before=(await i.snapshot()).conversation;
 out.value={...base,intents:['view_list'],clarifyQuestion:'Should I show your products?'};
 const s=await text(i,r,phrase);capture('semantic-'+language,s);assertVisual(s,['VIS-0','VIS-1','VIS-2']);assert.deepEqual(s.conversation,before);assert.equal(out.calls,1);assert.doesNotMatch(currentReply(s).text,/Should I/);
},3,language));

test('viewing during an unresolved removal keeps its original choice actionable',()=>fixture(async(_pool,i,r,out)=>{
 const start=await i.snapshot(),pipe=start.conversation.draft[0];
 out.value={...base,proposedEdits:[{kind:'remove_item',targetLineId:pipe.id,sourceText:'remove pipe'}]};
 let s=await text(i,r,'remove pipe');assert.equal(currentReply(s).clarificationReason,'cart_edit_target');
 const choice=currentReply(s).buttons!.find(b=>b.event.type==='resolve_cart_target'&&b.event.lineId===s.conversation.draft[1].id)!.event;
 const before=structuredClone(s.conversation);
 s=await text(i,r,'show my list');capture('pending-removal-view',s);assertVisual(s,['VIS-0','VIS-1','VIS-2']);assert.deepEqual(s.conversation,before);
 s=await send(i,r,choice);assert.equal(s.conversation.draft.some(l=>l.sku==='VIS-1'),false);assert.equal(s.conversation.draft[0].quantity,1);assert.equal(s.requests.length,0);
}));

test('a viewing interruption retains an unknown count and the exact pending quantity question',()=>fixture(async(pool,i,r)=>{
 await text(i,r,'review');const s0=await i.snapshot(),line=s0.conversation.draft[0];line.quantity=null;line.resolution='needs_quantity';
 const pending={kind:'question',id:randomUUID(),lineId:line.id,version:s0.conversation.version};
 await pool.query('UPDATE conversations SET draft=$1::jsonb,pending=$2::jsonb WHERE id=$3',[JSON.stringify(s0.conversation.draft),JSON.stringify(pending),i.context.conversationId]);
 const before=(await i.snapshot()).conversation,s=await text(i,r,'show the products');capture('unknown-count-view',s);
 assertVisual(s,['VIS-0','VIS-1','VIS-2']);assert.deepEqual(s.conversation,before);assert.equal(s.conversation.draft[0].quantity,null);assert.match(productCards(s)[0].caption,/to check/);
}));

test('one saved item is shown as one native product image with actions',()=>fixture(async(_pool,i,r)=>{
 const s=await text(i,r,'show my list');capture('single-item',s);const payloads=assertVisual(s,['VIS-0']);assert.equal(currentReply(s).parts!.flatMap(p=>p.cards).length,1);assert.equal(payloads[0].format,'buttons');
},1));

test('a list larger than one native carousel group retains every row and mutates nothing',()=>fixture(async(_pool,i,r)=>{
 const before=(await i.snapshot()).conversation,s=await text(i,r,'show my list');capture('twelve-items',s);
 const rich=currentReply(s),outbound=s.messages.filter(m=>m.direction==='outbound'),cards=outbound.flatMap(m=>m.rich?.parts?.flatMap(p=>p.cards)??[]).filter(c=>c.kind==='product');
 assert.deepEqual(cards.map(c=>c.kind==='product'?c.product.sku:''),before.draft.map(l=>l.sku));assert.equal(rich.partCount,2);assert.deepEqual(s.conversation.draft,before.draft);
 for(const message of outbound)assert.equal(renderWhatsAppReply(message.rich!,message.id,'shop.example.test').format,'carousel');assert.equal(s.requests.length,0);
},12));

test('mixed count-and-view request applies the count and shows the entire current list',()=>fixture(async(_pool,i,r,out)=>{
 await text(i,r,'review');const before=(await i.snapshot()).conversation;
 out.value={...base,intents:['edit','view_list'],proposedEdits:[{kind:'set_quantity',targetLineId:before.draft[0].id,targetQuery:'PVC pipe',sourceText:'make PVC pipe three',quantity:3}]};
 const s=await text(i,r,'make PVC pipe three and show my list');capture('mixed-edit-and-view',s);assert.equal(s.conversation.draft[0].quantity,3);assertVisual(s,['VIS-0','VIS-1','VIS-2']);assert.deepEqual(s.conversation.draft.slice(1),before.draft.slice(1));
}));

test('negated viewing and new-product discovery are not treated as current-list commands',async()=>{
 const {listViewRequest}=await import('../apps/server/src/services/list-view-intent.js');
 for(const phrase of ["don't show my list",'remove screw box and show my list','show me cutter options','show the price of PVC pipe','clear my list','பொருளை காட்ட வேண்டாம்','ஒன்னும் மாத்த வேணாம்','make pipe three and show products'])assert.equal(listViewRequest(phrase),false,phrase);
});

test('a changed measured amount preserves the same photo and verified pack conversion',()=>fixture(async(pool,i,r,out)=>{
 await pool.query("UPDATE products SET name='Garden hose 10m',image_path='/demo-images/H13.jpg',specifications='{\"size\":\"10m\"}',version=version+1 WHERE sku='VIS-0' AND store_id=$1",[fixtureStore]);
 await text(i,r,'review');const before=(await i.snapshot()).conversation;
 out.value={...base,proposedEdits:[{kind:'set_amount',targetLineId:before.draft[0].id,targetQuery:'garden hose',sourceText:'make garden hose 50 metres',amount:{value:50,unit:'metre'}}]};
 const s=await text(i,r,'make garden hose 50 metres');capture('measured-edit',s);assertVisual(s,['VIS-0']);assert.equal(s.conversation.draft[0].quantity,5);assert.deepEqual(s.conversation.draft[0].requestedAmount,{value:50,unit:'metre'});assert.match(productCards(s)[0].caption,/50/);assert.equal(s.conversation.draft[0].sku,before.draft[0].sku);
}));

test('viewing while a line editor is open preserves the editor and does not ask which item to edit',()=>fixture(async(_pool,i,r)=>{
 let s=await text(i,r,'review');const action=currentReply(s).parts!.flatMap(p=>p.cards.flatMap(c=>c.buttons??[])).find(b=>b.event.type==='edit_item')!.event;
 s=await send(i,r,action);const before=structuredClone(s.conversation);assert.ok(before.editingLineId);
 s=await text(i,r,'show my list');assertVisual(s,['VIS-0','VIS-1','VIS-2']);assert.deepEqual(s.conversation,before);assert.doesNotMatch(currentReply(s).text,/What should change/);
}));

test('an empty list is described honestly without a fake carousel or a cart write',()=>fixture(async(pool,i,r)=>{
 await pool.query("UPDATE conversations SET draft='[]',pending=NULL WHERE id=$1",[i.context.conversationId]);const before=(await i.snapshot()).conversation;
 const s=await text(i,r,'show my list');assert.equal(productCards(s).length,0);assert.match(currentReply(s).text,/empty/);assert.deepEqual(s.conversation,before);assert.equal(s.requests.length,0);
}));

test('a generic yes after viewing photos cannot submit a previously opened bill',()=>fixture(async(_pool,i,r)=>{
 let s=await text(i,r,'review');const approval=currentReply(s).parts!.flatMap(p=>p.cards.flatMap(c=>c.buttons??[])).find(b=>b.event.type==='confirm_products')!.event;
 s=await send(i,r,approval);assert.equal(s.conversation.pending?.kind,'review');const before=structuredClone(s.conversation);
 s=await text(i,r,'show my list');assertVisual(s,['VIS-0','VIS-1','VIS-2']);assert.deepEqual(s.conversation,before);
 s=await text(i,r,'yes');assert.equal(s.requests.length,0);assert.equal(currentReply(s).stage,'bill');
 const submit=currentReply(s).parts!.flatMap(p=>p.cards.flatMap(c=>c.buttons??[])).find(b=>b.event.type==='confirm')!.event;
 s=await send(i,r,submit);assert.equal(s.requests.length,1);
}));

test('an expired product check can be viewed but exposes no expired approval',()=>fixture(async(pool,i,r)=>{
 await text(i,r,'review');await pool.query("UPDATE conversations SET pending=jsonb_set(pending,'{expiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1",[i.context.conversationId]);
 const before=(await i.snapshot()).conversation,s=await text(i,r,'show my list');assertVisual(s,['VIS-0','VIS-1','VIS-2']);assert.deepEqual(s.conversation,before);assert.ok(currentReply(s).parts!.every(p=>p.cards.every(c=>c.buttons?.every(b=>b.event.type!=='confirm_products'))));
}));
