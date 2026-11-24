import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import type {ConversationState,DraftLine,SimulatorEvent,Snapshot} from '../packages/contracts/index.js';
import {fixtureStore} from '../profiles/hardware.js';
import {understandingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';
import type {Interpreter,InterpretationInput} from '../apps/server/src/adapters/interpreter.js';
import {compileKeepOnly} from '../apps/server/src/services/shopping-corrections.js';
import {explicitPurchaseCount} from '../apps/server/src/services/quantity-evidence.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';

const base={schemaVersion:2,inputKind:'text',intents:['edit'],requestedItems:[],proposedEdits:[],shopQuestions:[],unresolved:[]};
const line=(name:string,quantity:number|null=1,sku?:string):DraftLine=>({id:randomUUID(),name,query:name,quantity,resolution:'unavailable',...(sku?{sku}:{})});
const state=(draft:DraftLine[]):ConversationState=>({version:4,draft,pending:null,fulfillment:'pickup',lastRequestId:null,replyLanguage:'en'});
const target=(line:DraftLine,sourceText=line.name)=>({sourceText,query:line.query??line.name,targetLineId:line.id});
const keep=(sourceText:string,targets:ReturnType<typeof target>[])=>({sourceText,complete:true,targets});

test('keep exactly three compiles only the complement by stable IDs',()=>{
 const draft=[line('screw driver'),line('cutting plier',2),line('Anchor switch'),line('nail'),line('hose')],s=state(draft);
 const source='remove one cutting plier; keep only screw driver, cutting plier, Anchor switch; remove everything else';
 const u={...base,keepOnly:keep(source,draft.slice(0,3).map(l=>target(l))),proposedEdits:[{kind:'decrement_quantity',targetLineId:draft[1].id,sourceText:'remove one cutting plier',quantity:1}]};
 const result=understandingToInterpretation(u,{text:source,state:s},false);
 assert.deepEqual(result.operations.map(op=>op.kind==='remove_item'?op.reference:op.kind==='set_quantity'?`${op.reference}:${op.quantity}`:op.kind),[`${draft[1].id}:1`,draft[3].id,draft[4].id]);
});

test('one ambiguous kept name holds every linked mutation, retaining the keep goal',()=>{
 const draft=[line('screw driver'),line('cutting plier',2),line('Anchor switch'),line('Legrand switch'),line('nail')],s=state(draft);
 const source='remove one cutting plier; keep only screw driver, cutting plier, switch; remove everything else';
 const result=understandingToInterpretation({...base,keepOnly:keep(source,[target(draft[0]),target(draft[1]),{sourceText:'switch',query:'switch',targetLineId:draft[2].id}]),proposedEdits:[{kind:'decrement_quantity',targetLineId:draft[1].id,sourceText:'remove one cutting plier',quantity:1}]},{text:source,state:s},false);
 assert.deepEqual(result.operations,[]);assert.ok(result.understanding?.keepOnly);assert.ok(result.understanding?.unresolved.includes('keep_only_target'));assert.match(result.clarifyQuestion!,/switch/);
});

test('negated or invented keep evidence cannot authorize complement deletion',()=>{
 const draft=[line('screw driver'),line('nail')],s=state(draft);
 for(const source of ["don't keep only screw driver",'do not remove everything else; keep only screw driver'])assert.throws(()=>understandingToInterpretation({...base,keepOnly:keep(source,[target(draft[0])])},{text:source,state:s},false),/evidence/);
 assert.throws(()=>understandingToInterpretation({...base,keepOnly:keep('keep only screw driver',[target(draft[0])])},{text:'screw driver price',state:s},false),/evidence/);
});

test('clipped positive keep evidence cannot bypass surrounding negation or a later revocation',()=>{
 const driver=line('screw driver'),s=state([driver,line('nail')]);
 for(const [description,sourceText] of [
  ['do not keep only screw driver','keep only screw driver'],
  ["don't keep only screw driver",'keep only screw driver'],
  ['keep only screw driver? No, keep everything','keep only screw driver'],
  ['keep only screw driver; actually keep all items','keep only screw driver'],
  ['ஸ்க்ரூ டிரைவர் மட்டும் வைங்க வேண்டாம்','ஸ்க்ரூ டிரைவர் மட்டும் வைங்க'],
  ['ஸ்க்ரூ டிரைவர் மட்டும் வைங்க. இல்லை எல்லாத்தையும் வச்சிருங்க','ஸ்க்ரூ டிரைவர் மட்டும் வைங்க'],
 ])assert.throws(()=>compileKeepOnly(keep(sourceText,[target(driver,description.includes('ஸ்க்ரூ')?'ஸ்க்ரூ டிரைவர்':'screw driver')]),s,description),/evidence/);
});

test('negated or unrelated repeated-entry evidence never silently selects one duplicate',()=>{
 const a=line('cutting plier',1,'SAME'),b=line('cutting plier',null,'SAME'),s=state([a,b,line('nail')]);
 for(const evidence of ['do not remove the duplicate cutting plier entry','screw driver appeared twice, remove one entry']){
  const description=evidence+'; keep only cutting plier';
  const compiled=compileKeepOnly({sourceText:'keep only cutting plier',complete:true,targets:[{...target(b),duplicateSourceText:evidence}]},s,description);
  assert.deepEqual(compiled.operations,[]);assert.equal(compiled.choices?.length,2);
 }
});

test('same names with different SKUs/specifications stay distinct, including unknown counts',()=>{
 const a=line('cutting plier',1,'PLIER-6'),b={...line('cutting plier',null,'PLIER-8'),productMeasures:[{role:'size' as const,value:8,unit:'inch'}]},s=state([a,b,line('nail')]);
 const source='cutting plier appeared twice, remove one entry; keep only cutting plier';
 const plan=compileKeepOnly({sourceText:source,complete:true,targets:[{...target(a),duplicateSourceText:'cutting plier appeared twice, remove one entry'}]},s,source);
 assert.deepEqual(plan.operations,[]);assert.equal(plan.choices?.length,2);
 const sameSku={...b,sku:a.sku};assert.deepEqual(compileKeepOnly({sourceText:source,complete:true,targets:[{...target(a),duplicateSourceText:'cutting plier appeared twice, remove one entry'}]},state([a,sameSku]),source).operations,[]);
});

test('recorded duplicate known-one and unknown-count rows retain the known count only with explicit repeated-entry evidence',()=>{
 const known=line('cutting plier',1,'CANON-KSMC-0034'),unknown=line('cutting plier',null,'CANON-KSMC-0034'),driver=line('screw driver'),sw=line('Anchor switch'),other=line('hose');
 const source='ரெண்டு தடவை கட்டிங் பிளேயர் வந்துட்டு சோ ஒன்ன எடுத்துருங்க. இந்த ஸ்க்ரூ டிரைவர் கட்டிங் பிளேயர் இந்த ஸ்விட்ச். இந்த மூணு மட்டும் போதும் மத்தது எல்லாம் எடுத்துருங்க.';
 const k={sourceText:'இந்த மூணு மட்டும் போதும் மத்தது எல்லாம் எடுத்துருங்க.',complete:true,targets:[target(driver,'ஸ்க்ரூ டிரைவர்'),{...target(unknown,'கட்டிங் பிளேயர்'),duplicateSourceText:'ரெண்டு தடவை கட்டிங் பிளேயர் வந்துட்டு சோ ஒன்ன எடுத்துருங்க.'},target(sw,'ஸ்விட்ச்')]};
 const operations=compileKeepOnly(k,state([known,unknown,driver,sw,other]),source).operations;
 assert.deepEqual(operations.map(op=>op.kind==='remove_item'?op.reference:undefined),[unknown.id,other.id]);assert.equal(known.quantity,1);assert.equal(unknown.quantity,null);
 const without={...k,targets:k.targets.map(t=>({...t,duplicateSourceText:undefined}))};assert.deepEqual(compileKeepOnly(without,state([known,unknown,driver,sw,other]),source).operations,[]);
 for(const phrase of ['ஒன்ன எடுத்துருங்க','ஒண்ண நீக்குங்க'])assert.equal(explicitPurchaseCount(phrase),1);
});

test('recorded overlapping requestedItem and replacement become one correction preserving missing count',()=>{
 const old=line('hacksaw blade',1,'H16'),other=line('screw driver',2),s=state([old,other]);
 const source='ஹேங்ஷாப் பிளேடு இல்ல கட்டிங் பிளேயர்';
 const u={...base,requestedItems:[{ordinal:1,sourceText:'கட்டிங் பிளேயர்',query:'cutting plier',purchaseCount:null,unresolved:[]}],proposedEdits:[{kind:'replace',query:'cutting plier',sourceText:source,targetLineId:old.id}]};
 const result=understandingToInterpretation(u,{text:source,state:s},false);
 assert.equal(result.operations.length,1);assert.deepEqual(result.operations[0],{kind:'resolve_line',lineId:old.id,query:'cutting plier',supportingPhrase:source});
 assert.equal(old.quantity,1);assert.equal(other.quantity,2);
});

test('nonoverlapping and explicitly additional requests are not folded into a replacement',()=>{
 const old=line('hacksaw blade',1),s=state([old]);
 for(const [source,phrase] of [['replace hacksaw blade with cutting plier; extra one cutting plier','extra one cutting plier'],['replace hacksaw blade with cutting plier; another cutting plier','another cutting plier']]){
  const result=understandingToInterpretation({...base,requestedItems:[{ordinal:0,sourceText:phrase,query:'cutting plier',purchaseCount:1,unresolved:[]}],proposedEdits:[{kind:'replace',query:'cutting plier',sourceText:'replace hacksaw blade with cutting plier',targetLineId:old.id}]},{text:source,state:s},false);
  assert.equal(result.operations.length,2);assert.equal(result.operations[0].kind,'add_item');assert.equal(result.operations[1].kind,'resolve_line');
 }
});

test('decrement differs from deleting an entire repeated row and unknown totals are never invented',()=>{
 const a=line('cutting plier',2),b=line('hose'),s=state([a,b]);
 const decrement={...base,proposedEdits:[{kind:'decrement_quantity',targetLineId:a.id,quantity:1,sourceText:'remove one cutting plier'}]};
 assert.equal((understandingToInterpretation(decrement,{text:'remove one cutting plier',state:s},false).operations[0] as any).quantity,1);
 const unknown=understandingToInterpretation(decrement,{text:'remove one cutting plier',state:state([{...a,quantity:null},b])},false);assert.deepEqual(unknown.operations,[]);
 const duplicate={...a,id:randomUUID(),quantity:null};
 const remove=understandingToInterpretation({...base,proposedEdits:[{kind:'remove_item',targetLineId:duplicate.id,sourceText:'remove the second item'}]},{text:'remove the second item',state:state([a,duplicate,b])},false);
 assert.deepEqual(remove.operations,[{kind:'remove_item',reference:duplicate.id,supportingPhrase:'remove the second item'}]);
});

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService,r:ConversationRuntime,output:{value:unknown;calls:number})=>Promise<void>){
 const schema='compound_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');const conversationId=randomUUID(),ctx={storeId:fixtureStore,conversationId,actor:'compound-test',role:'customer' as const};
  await pool.query('INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,$3)',[conversationId,fixtureStore,ctx.actor]);
  for(const [sku,name] of [['CP-PLI','cutting plier'],['CP-SCR','screw driver'],['CP-SWA','Anchor switch'],['CP-SWB','Legrand switch'],['CP-NAL','nail'],['CP-BLD','hacksaw blade']])await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases) VALUES($1,$2,$3,'piece',1000,100,'[]'::jsonb)",[fixtureStore,sku,name]);
  const output={value:{} as unknown,calls:0};
  const provider:Interpreter={name:'offline-compound',mode:'mock',unifiedUnderstanding:true,supportsAudio:true,interpret:async(input:InterpretationInput)=>{output.calls++;return {output:understandingToInterpretation(output.value,input,false),usage:null,truncated:false};}};
  const inbox=new SimulatorService(pool,ctx),r=new ConversationRuntime(pool,provider,{visualOrdering:true});
  await new RetailTools(pool).invoke(ctx,{name:'apply_draft_changes',args:{expectedVersion:0,operations:['CP-SCR','CP-PLI','CP-SWA','CP-SWB','CP-NAL'].map(sku=>({kind:'add_item',query:sku,quantity:sku==='CP-PLI'?2:1}))}},randomUUID());
  await run(pool,inbox,r,output);
 }finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
async function send(inbox:SimulatorService,r:ConversationRuntime,event:SimulatorEvent){await inbox.ingest(event);await r.processNext(inbox.context);return inbox.snapshot();}
function keepButtons(s:Snapshot){return s.messages.filter(m=>m.direction==='outbound').at(-1)?.rich?.buttons?.flatMap(b=>b.event.type==='resolve_keep_target'?[b.event]:[])??[];}

for(const channel of ['button','text'] as const)test(`ambiguous linked correction resumes original keep goal through ${channel} without partial mutation`,()=>fixture(async(pool,inbox,r,output)=>{
 const before=await inbox.snapshot(),draft=before.conversation.draft;
 const driver=draft.find(l=>l.sku==='CP-SCR')!,plier=draft.find(l=>l.sku==='CP-PLI')!,sw=draft.find(l=>l.sku==='CP-SWA')!;
 const source='remove one cutting plier; keep only screw driver, cutting plier, switch; remove everything else';
 output.value={...base,keepOnly:keep(source,[target(driver),target(plier),{sourceText:'switch',query:'switch',targetLineId:sw.id}]),proposedEdits:[{kind:'decrement_quantity',targetLineId:plier.id,sourceText:'remove one cutting plier',quantity:1}]};
 const pending=await send(inbox,r,{id:randomUUID(),type:'text',text:source});assert.deepEqual(pending.conversation.draft,draft);assert.equal(output.calls,1);
 const buttons=keepButtons(pending);assert.deepEqual(new Set(buttons.map(b=>b.lineId)),new Set(draft.filter(l=>l.sku?.startsWith('CP-SW')).map(l=>l.id)));
 const chosen=buttons.find(b=>b.lineId===sw.id)!;assert.ok(chosen);
 let after:Snapshot;
 if(channel==='button')after=await send(inbox,r,chosen);
 else {output.value={...base,keepOnlyAnswer:{sourceText:'Anchor switch',query:'Anchor switch',targetLineId:sw.id}};after=await send(inbox,r,{id:randomUUID(),type:'text',text:'Anchor switch'});}
 assert.deepEqual(after.conversation.draft.map(l=>l.id),[driver.id,plier.id,sw.id]);assert.equal(after.conversation.draft.find(l=>l.id===plier.id)?.quantity,1);assert.equal(output.calls,channel==='button'?1:2);assert.equal(after.requests.length,0);
 const changed=structuredClone(after.conversation.draft);
 await send(inbox,r,{...chosen,id:randomUUID()});assert.deepEqual((await inbox.snapshot()).conversation.draft,changed);
 assert.notEqual((await pool.query('SELECT assistant_memory FROM conversations WHERE id=$1',[inbox.context.conversationId])).rows[0].assistant_memory?.purpose,'cart_correction');
}));

test('forged or stale keep choices cannot replay pending correction',()=>fixture(async(pool,inbox,r,output)=>{
 const before=await inbox.snapshot(),draft=before.conversation.draft,driver=draft.find(l=>l.sku==='CP-SCR')!,plier=draft.find(l=>l.sku==='CP-PLI')!;
 const source='keep only screw driver, cutting plier, switch';output.value={...base,keepOnly:keep(source,[target(driver),target(plier),{sourceText:'switch',query:'switch',targetLineId:draft.find(l=>l.sku==='CP-SWA')!.id}])};
 const pending=await send(inbox,r,{id:randomUUID(),type:'text',text:source}),choice=keepButtons(pending)[0];assert.ok(choice);
 await send(inbox,r,{...choice,id:randomUUID(),lineId:driver.id});assert.deepEqual((await inbox.snapshot()).conversation.draft,draft);
 await pool.query('UPDATE conversations SET version=version+1 WHERE id=$1',[inbox.context.conversationId]);
 await send(inbox,r,{...choice,id:randomUUID()});assert.deepEqual((await inbox.snapshot()).conversation.draft,draft);assert.equal(output.calls,1);
}));

test('replacement dual representation does not create count-less duplicate and preserves unrelated lines',()=>fixture(async(pool,inbox,r,output)=>{
 const s=await inbox.snapshot(),old=s.conversation.draft.find(l=>l.sku==='CP-PLI')!,other=s.conversation.draft.find(l=>l.sku==='CP-NAL')!;
 await pool.query("UPDATE conversations SET draft=$1::jsonb,pending=NULL WHERE id=$2",[JSON.stringify([{...old,query:'hacksaw blade',name:'hacksaw blade',sku:'CP-BLD',quantity:1,candidates:[]},other]),inbox.context.conversationId]);
 const source='ஹேங்ஷாப் பிளேடு இல்ல கட்டிங் பிளேயர்';output.value={...base,requestedItems:[{ordinal:1,sourceText:'கட்டிங் பிளேயர்',query:'cutting plier',purchaseCount:null,unresolved:[]}],proposedEdits:[{kind:'replace',query:'cutting plier',sourceText:source,targetLineId:old.id}]};
 const after=await send(inbox,r,{id:randomUUID(),type:'text',text:source});assert.equal(after.conversation.draft.length,2);assert.equal(after.conversation.draft[0].id,old.id);assert.equal(after.conversation.draft[0].sku,'CP-PLI');assert.equal(after.conversation.draft[0].quantity,1);assert.equal(after.conversation.draft[1].id,other.id);assert.equal(output.calls,1);
}));

test('a dependent validation failure rolls back the entire keep batch including earlier quantity changes',()=>fixture(async(pool,inbox,r,output)=>{
 const before=await inbox.snapshot(),draft=before.conversation.draft,driver=draft.find(l=>l.sku==='CP-SCR')!,plier=draft.find(l=>l.sku==='CP-PLI')!,sw=draft.find(l=>l.sku==='CP-SWA')!;
 const source='remove one cutting plier; make screw driver 0.5; keep only screw driver, cutting plier, Anchor switch';
 output.value={...base,keepOnly:keep(source,[target(driver),target(plier),target(sw)]),proposedEdits:[{kind:'decrement_quantity',targetLineId:plier.id,sourceText:'remove one cutting plier',quantity:1},{kind:'set_quantity',targetLineId:driver.id,sourceText:'make screw driver 0.5',quantity:.5}]};
 const after=await send(inbox,r,{id:randomUUID(),type:'text',text:source});assert.deepEqual(after.conversation.draft,draft);assert.equal(after.requests.length,0);assert.equal(output.calls,1);
}));

test('explicit duplicate-entry cleanup keeps the known-count row and never invents an unknown count',()=>fixture(async(pool,inbox,r,output)=>{
 const s=await inbox.snapshot(),driver=s.conversation.draft.find(l=>l.sku==='CP-SCR')!,original=s.conversation.draft.find(l=>l.sku==='CP-PLI')!,known={...original,quantity:1},unknown={...original,id:randomUUID(),quantity:null},sw=s.conversation.draft.find(l=>l.sku==='CP-SWA')!,other=s.conversation.draft.find(l=>l.sku==='CP-NAL')!;
 await pool.query('UPDATE conversations SET draft=$1::jsonb,pending=NULL WHERE id=$2',[JSON.stringify([driver,known,unknown,sw,other]),inbox.context.conversationId]);
 const duplicate='cutting plier appeared twice, remove one entry',source=duplicate+'; keep only screw driver, cutting plier, Anchor switch';
 output.value={...base,keepOnly:{sourceText:source,complete:true,targets:[target(driver),{...target(unknown),duplicateSourceText:duplicate},target(sw)]}};
 const after=await send(inbox,r,{id:randomUUID(),type:'text',text:source});assert.deepEqual(after.conversation.draft.map(l=>l.id),[driver.id,known.id,sw.id]);assert.equal(after.conversation.draft.find(l=>l.id===known.id)?.quantity,1);assert.equal(after.requests.length,0);assert.equal(output.calls,1);
}));

test('duplicate-looking keep choices retain distinct native button labels and exact row IDs',()=>fixture(async(pool,inbox,r,output)=>{
 const before=await inbox.snapshot(),original=before.conversation.draft.find(l=>l.sku==='CP-PLI')!,known={...original,quantity:1},unknown={...original,id:randomUUID(),quantity:null};
 await pool.query('UPDATE conversations SET draft=$1::jsonb,pending=NULL WHERE id=$2',[JSON.stringify([known,unknown]),inbox.context.conversationId]);
 const source='keep only cutting plier';output.value={...base,keepOnly:keep(source,[target(unknown)])};
 const after=await send(inbox,r,{id:randomUUID(),type:'text',text:source});
 const rich=after.messages.filter(m=>m.direction==='outbound').at(-1)!.rich!;
 const rendered=renderWhatsAppReply(rich,randomUUID(),'shop.example.test');
 assert.equal(rendered.actions.length,2);assert.equal(new Set(rendered.actions.map(a=>a.label)).size,2);
 assert.deepEqual(keepButtons(after).map(e=>e.lineId),[known.id,unknown.id]);
 assert.deepEqual(after.conversation.draft.map(l=>l.quantity),[1,null]);
}));
