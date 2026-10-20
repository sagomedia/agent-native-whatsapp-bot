import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {ToolError} from '../apps/server/src/services/context.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';
import {understandingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import type {ConversationState} from '../packages/contracts/index.js';

async function fixture(language:ConversationState['replyLanguage'],run:(pool:pg.Pool,inbox:SimulatorService,runtime:ConversationRuntime)=>Promise<void>){
 const schema='feedback_flow_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');const id=randomUUID(),ctx={storeId:fixtureStore,conversationId:id,actor:'synthetic-feedback',role:'customer' as const};
  await pool.query('INSERT INTO conversations(id,store_id,actor,reply_language,reply_language_explicit) VALUES($1,$2,$3,$4,true)',[id,fixtureStore,ctx.actor,language]);
  for(const [sku,name] of [['FEED-PIPE','PVC pipe'],['FEED-SCREW','screw box'],['FEED-DRILL','drill machine']])await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases,selling_unit_verified) VALUES($1,$2,$3,'piece',1000,100,'[]',true)",[fixtureStore,sku,name]);
  await new RetailTools(pool).invoke(ctx,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'FEED-PIPE',quantity:2},{kind:'add_item',query:'FEED-SCREW',quantity:1},{kind:'add_item',query:'FEED-DRILL',quantity:1}]}},randomUUID());
  await pool.query('UPDATE conversations SET pending=NULL,editing_line_id=NULL WHERE id=$1',[id]);
  const provider:Interpreter={name:'offline-feedback',mode:'mock',interpret:async input=>{
   const removing=input.text==='remove screw box',target=input.state.draft.find(line=>line.sku===(removing?'FEED-SCREW':'FEED-PIPE'))!;
   const u={schemaVersion:2,inputKind:'text',intents:['edit'],requestedItems:[],proposedEdits:[{kind:removing?'remove_item':'set_quantity',targetLineId:target.id,targetQuery:target.query,sourceText:input.text,...(removing?{}:{quantity:3})}],shopQuestions:[],unresolved:[]};
   return {output:understandingToInterpretation(u,input,false),usage:null,truncated:false};
  }};
  await run(pool,new SimulatorService(pool,ctx),new ConversationRuntime(pool,provider,{visualOrdering:true}));
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
async function send(inbox:SimulatorService,runtime:ConversationRuntime,text:string){await inbox.ingest({id:randomUUID(),type:'text',text});await runtime.processNext(inbox.context);return inbox.snapshot();}
for(const [language,expected] of [['en','Changed PVC pipe (3 pieces)'],['ta','PVC pipe மாற்றப்பட்டது (3 எண்ணம்)'],['ta-Latn','PVC pipe maaththiyaachu (3 ennam)']] as const)test(`persisted quantity feedback reaches the first native WhatsApp part in ${language}`,()=>fixture(language,async(_pool,inbox,runtime)=>{
 const after=await send(inbox,runtime,'make PVC pipe three'),out=after.messages.filter(m=>m.direction==='outbound').at(-1)!,rich=out.rich!;
 assert.equal(after.conversation.draft.find(line=>line.sku==='FEED-PIPE')?.quantity,3);assert.equal(after.conversation.pending?.kind,'products');assert.equal(after.requests.length,0);
 assert.ok(out.text.startsWith(expected));assert.ok(rich.parts?.[0].text.startsWith(expected));assert.equal(rich.parts?.flatMap(p=>p.cards).filter(c=>c.kind==='product').length,1);assert.ok(rich.parts?.[0].cards.some(c=>c.kind==='product'&&c.product.sku==='FEED-PIPE'));assert.match(rich.parts![0].cards[0].caption,/3/);
 const rendered=renderWhatsAppReply({...rich,parts:[rich.parts![0]]},out.id,'shop.example.test');assert.ok(JSON.stringify(rendered.payload).includes(expected));
}));

test('a removal is acknowledged, while a following price check makes no change claim',()=>fixture('en',async(_pool,inbox,runtime)=>{
 let after=await send(inbox,runtime,'remove screw box');assert.equal(after.conversation.draft.length,2);assert.match(after.messages.at(-1)!.text,/^Removed screw box\n/);
 const before=structuredClone(after.conversation.draft);after=await send(inbox,runtime,'price of PVC pipe');assert.deepEqual(after.conversation.draft,before);assert.doesNotMatch(after.messages.at(-1)!.text,/Removed|Changed|Added/);assert.equal(after.requests.length,0);
}));

test('a failure after a write rolls back the edit and never acknowledges that rejected change',()=>fixture('en',async(_pool,inbox,runtime)=>{
 const before=(await inbox.snapshot()).conversation.draft,tools=(runtime as unknown as {tools:RetailTools}).tools,original=tools.invokeInTransaction.bind(tools);
 tools.invokeInTransaction=async(client,ctx,call,key)=>{if(typeof call==='object'&&call!==null&&'name' in call&&call.name==='preview_order')throw new ToolError('Synthetic catalog refresh failed.');return original(client,ctx,call,key);};
 const after=await send(inbox,runtime,'make PVC pipe three');assert.deepEqual(after.conversation.draft,before);assert.equal(after.messages.at(-1)!.rich?.stage,'error');assert.doesNotMatch(after.messages.at(-1)!.text,/Changed|Added|Removed/);assert.equal(after.requests.length,0);
}));
