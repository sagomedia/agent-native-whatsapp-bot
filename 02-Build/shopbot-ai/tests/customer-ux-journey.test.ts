import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {understandingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import type {SimulatorEvent,Snapshot} from '../packages/contracts/index.js';

const base={schemaVersion:2,inputKind:'text',intents:['edit'],requestedItems:[],proposedEdits:[],shopQuestions:[],unresolved:[]};
async function fixture(run:(pool:pg.Pool,inbox:SimulatorService,runtime:ConversationRuntime)=>Promise<void>){
  const schema='customer_journey_'+randomUUID().replaceAll('-','');
  const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
  try {
    await setupDatabase(pool,'mock');
    const id=randomUUID(),ctx={storeId:fixtureStore,conversationId:id,actor:'customer-journey',role:'customer' as const};
    await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language) VALUES($1,$2,$3,'en')",[id,fixtureStore,ctx.actor]);
    for(const [sku,name] of [['J-PVC','PVC pipe'],['J-PUMP','water pumping pipe'],['J-NAIL','nail']])
      await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases) VALUES($1,$2,$3,'piece',1000,100,'[]'::jsonb)",[fixtureStore,sku,name]);
    await new RetailTools(pool).invoke(ctx,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'J-PVC',quantity:2},{kind:'add_item',query:'J-PUMP',quantity:4},{kind:'add_item',query:'J-NAIL',quantity:3}]}},randomUUID());
    await pool.query('UPDATE conversations SET pending=NULL,editing_line_id=NULL WHERE id=$1',[id]);
    const provider:Interpreter={name:'journey-offline',mode:'mock',interpret:async input=>{
      const pvc=input.state.draft.find(line=>line.sku==='J-PVC')!;
      const pump=input.state.draft.find(line=>line.sku==='J-PUMP')!;
      const proposal=input.text==='remove pipe'?{...base,proposedEdits:[{kind:'remove_item' as const,targetLineId:pvc.id,sourceText:'remove pipe'}]}:
        input.text==='water pumping pipe'?{...base,cartTargetAnswer:{sourceText:'water pumping pipe',query:'water pumping pipe',targetLineId:pump.id}}:base;
      return {output:understandingToInterpretation(proposal,input,false),usage:null,truncated:false};
    }};
    await run(pool,new SimulatorService(pool,ctx),new ConversationRuntime(pool,provider,{visualOrdering:true}));
  } finally {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
async function send(inbox:SimulatorService,runtime:ConversationRuntime,event:SimulatorEvent){await inbox.ingest(event);await runtime.processNext(inbox.context);return inbox.snapshot();}
const text=(inbox:SimulatorService,runtime:ConversationRuntime,value:string)=>send(inbox,runtime,{id:randomUUID(),type:'text',text:value});
const choice=(s:Snapshot,sku:string)=>s.messages.filter(m=>m.direction==='outbound').at(-1)?.rich?.buttons?.find(b=>b.event.type==='resolve_cart_target'&&b.event.lineId===s.conversation.draft.find(l=>l.sku===sku)?.id)?.event;

for(const interruption of ['help','thanks','price of nail','review','view cart'] as const)
  test(`a ${interruption} interruption keeps the unresolved removal choice actionable`,()=>fixture(async(_pool,inbox,runtime)=>{
    const before=await inbox.snapshot();
    let s=await text(inbox,runtime,'remove pipe');
    assert.equal(s.messages.at(-1)?.rich?.clarificationReason,'cart_edit_target');
    const select=choice(s,'J-PUMP');assert.ok(select);
    s=await text(inbox,runtime,interruption);
    assert.deepEqual(s.conversation.draft,before.conversation.draft);
    s=await send(inbox,runtime,select);
    assert.equal(s.conversation.draft.find(line=>line.sku==='J-PUMP'),undefined);
    assert.equal(s.conversation.draft.find(line=>line.sku==='J-PVC')?.quantity,2);
    assert.equal(s.conversation.draft.find(line=>line.sku==='J-NAIL')?.quantity,3);
    assert.equal(s.requests.length,0);
  }));

test('a real cart change still makes an earlier ambiguous removal choice stale',()=>fixture(async(pool,inbox,runtime)=>{
  let s=await text(inbox,runtime,'remove pipe');
  const select=choice(s,'J-PUMP');assert.ok(select);
  const before=s.conversation.draft;
  await new RetailTools(pool).invoke(inbox.context,{name:'apply_draft_changes',args:{expectedVersion:s.conversation.version,operations:[{kind:'set_quantity',reference:before.find(line=>line.sku==='J-NAIL')!.id,quantity:5}]}},randomUUID());
  s=await send(inbox,runtime,select);
  assert.equal(s.conversation.draft.find(line=>line.sku==='J-PUMP')?.quantity,4);
  assert.equal(s.conversation.draft.find(line=>line.sku==='J-NAIL')?.quantity,5);
  assert.equal(s.requests.length,0);
}));

test('a typed item answer after a price check resumes the original removal',()=>fixture(async(_pool,inbox,runtime)=>{
  let s=await text(inbox,runtime,'remove pipe');
  const before=s.conversation.draft;
  assert.ok(choice(s,'J-PUMP'));
  s=await text(inbox,runtime,'price of nail');
  assert.deepEqual(s.conversation.draft,before);
  s=await text(inbox,runtime,'water pumping pipe');
  assert.equal(s.conversation.draft.find(line=>line.sku==='J-PUMP'),undefined);
  assert.equal(s.conversation.draft.find(line=>line.sku==='J-PVC')?.quantity,2);
  assert.equal(s.conversation.draft.find(line=>line.sku==='J-NAIL')?.quantity,3);
  assert.equal(s.requests.length,0);
}));

for(const response of ['yes','confirm_products'] as const)
  test(`a ${response} during review cannot execute a deferred removal`,()=>fixture(async(_pool,inbox,runtime)=>{
    let s=await text(inbox,runtime,'remove pipe');
    const before=structuredClone(s.conversation.draft);
    assert.ok(choice(s,'J-PUMP'));
    s=await text(inbox,runtime,'review');
    if(response==='yes')s=await text(inbox,runtime,'yes');
    else {
      const action=s.messages.filter(m=>m.direction==='outbound').at(-1)?.rich?.parts?.flatMap(p=>[
        ...p.buttons??[],...p.cards.flatMap(c=>c.buttons??[])
      ]).find(button=>button.event.type==='confirm_products')?.event;
      assert.ok(action,'the review should offer a current product-approval choice');
      s=await send(inbox,runtime,action);
    }
    assert.deepEqual(s.conversation.draft.map(line=>[line.id,line.sku,line.quantity]),before.map(line=>[line.id,line.sku,line.quantity]));
    assert.equal(s.requests.length,0);
  }));
