import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {pcmWav} from '../apps/server/src/services/voice-media.js';
import {loadAssistantMemory} from '../apps/server/src/services/agent-assistance.js';
import type {Interpretation,Snapshot} from '../packages/contracts/index.js';

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){
 const schema='discovery_quantity_'+randomUUID().replaceAll('-','');
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');await setupImageDemo(pool);
  const id=randomUUID();await pool.query("INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,'discovery-quantity')",[id,demoCatalogStore]);
  await run(pool,new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'discovery-quantity',role:'customer'}));
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
async function memory(pool:pg.Pool,inbox:SimulatorService){
 const client=await pool.connect();try{return await loadAssistantMemory(client,inbox.context);}finally{client.release();}
}
const last=(snapshot:Snapshot)=>snapshot.messages.at(-1)!.rich!;
function scenario(pool:pg.Pool,inbox:SimulatorService){
 let output:Interpretation={operations:[],next:'continue'};let voiceTranscript='';
 const runtime=new ConversationRuntime(pool,{name:'offline-discovery-quantity',mode:'mock',supportsAudio:true,interpret:async input=>({output:input.stage==='recognize'?{operations:[],next:'continue',transcript:voiceTranscript}:input.stage==='recommend'?input.proposal!:output,usage:null,truncated:false})},{mediaRecommendations:true});
 return {
  async send(text:string,decision:Interpretation,voice=false){
   output=decision;voiceTranscript=text;const id=randomUUID();
   if(voice){
    const audio=pcmWav(Buffer.alloc(32000,1));
    await inbox.ingest({id,type:'voice',mediaId:id},{audio,durationSeconds:1,sourceHash:createHash('sha256').update(audio).digest('hex')});
   }else await inbox.ingest({id,type:'text',text});
   await runtime.processNext(inbox.context);return inbox.snapshot();
  },
  async choose(snapshot:Snapshot,sku:string){
   const action=last(snapshot).cards?.find(card=>card.product.sku===sku)?.action;assert.ok(action);
   await inbox.ingest(action);await runtime.processNext(inbox.context);return inbox.snapshot();
  }
 };
}
const blade:Interpretation={operations:[],next:'assist',assistance:{rootQuery:'blade',queries:['hacksaw blade'],quantity:1,requestedUnit:'piece',search:{keywords:['hacksaw blade'],familyId:'saw-blades'}}};

for(const voice of [false,true]){
 const channel=voice?'voice':'text';
 test(`${channel}: a new two-pipe request replaces the discovery amount for one blade`,async()=>fixture(async(pool,inbox)=>{
  const session=scenario(pool,inbox);await session.send('Show me one blade',blade);
  let snapshot=await session.send('I need two PVC pipes',{operations:[{kind:'add_item',query:'PVC pipe',quantity:2}],next:'review'},voice);
  assert.equal(snapshot.conversation.draft.length,0);
  const remembered=await memory(pool,inbox);assert.equal(remembered?.requestedQuantity,2);assert.equal(remembered?.requestedUnit,undefined);
  snapshot=await session.choose(snapshot,'H02');assert.equal(snapshot.conversation.draft[0].quantity,2);assert.equal(snapshot.requests.length,0);
 }));
 test(`${channel}: new explicit units do not inherit the earlier blade unit`,async()=>fixture(async(pool,inbox)=>{
  const session=scenario(pool,inbox);await session.send('Show me one blade',blade);
  let snapshot=await session.send('enakku rendu feet PVC pipe venum',{operations:[{kind:'add_item',query:'PVC pipe',quantity:2,requestedUnit:'foot'}],next:'review'},voice);
  const remembered=await memory(pool,inbox);assert.equal(remembered?.requestedQuantity,2);assert.equal(remembered?.requestedUnit,'foot');
  snapshot=await session.choose(snapshot,'H02');assert.equal(snapshot.conversation.draft[0].requestedQuantity,2);assert.equal(snapshot.conversation.draft[0].requestedUnit,'foot');assert.equal(snapshot.conversation.draft[0].resolution,'needs_unit');assert.equal(snapshot.requests.length,0);
 }));
 test(`${channel}: refining the same blade keeps the original amount and unit`,async()=>fixture(async(pool,inbox)=>{
  const session=scenario(pool,inbox);await session.send('Show me three blades',{...blade,assistance:{...blade.assistance!,quantity:3}});
  let snapshot=await session.send('The hacksaw blade for cutting metal',{operations:[{kind:'add_item',query:'hacksaw blade',quantity:1}],next:'review'},voice);
  const remembered=await memory(pool,inbox);assert.equal(remembered?.requestedQuantity,3);assert.equal(remembered?.requestedUnit,'piece');
  snapshot=await session.choose(snapshot,'H16');assert.equal(snapshot.conversation.draft[0].quantity,3);assert.equal(snapshot.requests.length,0);
 }));
 test(`${channel}: an explicit same-goal amount overrides memory while retaining its unit`,async()=>fixture(async(pool,inbox)=>{
  const session=scenario(pool,inbox);await session.send('Show me three blades',{...blade,assistance:{...blade.assistance!,quantity:3}});
  const snapshot=await session.send('இரண்டு பிளேடு வேண்டும்',{operations:[{kind:'add_item',query:'hacksaw blade',quantity:2}],next:'review'},voice);
  assert.equal(snapshot.conversation.draft.length,0);const remembered=await memory(pool,inbox);
  assert.equal(remembered?.requestedQuantity,2);assert.equal(remembered?.requestedUnit,'piece');assert.equal(snapshot.requests.length,0);
 }));
 test(`${channel}: an unrelated one-inch pipe request cannot inherit blade quantity or treat size as amount`,async()=>fixture(async(pool,inbox)=>{
  const session=scenario(pool,inbox);await session.send('Show me three blades',{...blade,assistance:{...blade.assistance!,quantity:3}});
  let snapshot=await session.send('I need one inch PVC pipe',{operations:[{kind:'add_item',query:'1 inch PVC pipe',quantity:1}],next:'review'},voice);
  const remembered=await memory(pool,inbox);assert.equal(remembered?.requestedQuantity,undefined);assert.equal(remembered?.requestedUnit,undefined);
  snapshot=await session.choose(snapshot,'H02');assert.equal(snapshot.conversation.draft[0].quantity,null);assert.equal(snapshot.requests.length,0);
 }));
}
test('bound discovery yes preserves the requested quantity and unit without granting photo consent',async()=>fixture(async(pool,inbox)=>{
 const session=scenario(pool,inbox);await session.send('Show me two feet of garden hose',{operations:[],next:'assist',assistance:{rootQuery:'garden hose',queries:['garden hose'],quantity:2,requestedUnit:'foot',search:{keywords:['garden hose'],familyId:'hose'}}});
 const snapshot=await session.send('yes',{operations:[],next:'continue'});
 assert.equal(snapshot.conversation.draft.length,1);const line=snapshot.conversation.draft[0];
 assert.equal(line.sku,'H13');assert.equal(line.requestedQuantity,2);assert.equal(line.requestedUnit,'foot');assert.equal(line.resolution,'needs_unit');assert.equal(line.productConfirmation,undefined);assert.equal(snapshot.requests.length,0);
}));
