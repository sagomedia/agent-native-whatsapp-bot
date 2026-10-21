import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {understandingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';
import {namedEditLines} from '../apps/server/src/adapters/mention-reconciliation.js';
import {positiveRemoval} from '../packages/contracts/intent-language.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore} from '../profiles/hardware.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {RetailTools} from '../apps/server/src/services/tools.js';
import {normalizeVoice,pcmWav} from '../apps/server/src/services/voice-media.js';
import type {ConversationState,DraftLine,Snapshot,SimulatorEvent} from '../packages/contracts/index.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';

const line=(query:string,quantity:number|null=1,name=query):DraftLine=>({id:randomUUID(),query,name,quantity,resolution:'unavailable'});
const state=(draft:DraftLine[]):ConversationState=>({version:0,draft,pending:null,fulfillment:'pickup',lastRequestId:null,replyLanguage:'ta',visualOrdering:true});
const base={schemaVersion:2,inputKind:'text',intents:['edit'],requestedItems:[],proposedEdits:[],shopQuestions:[],unresolved:[]};
const recorded='இதெல்லாம் இல்ல அந்த லாஸ்ட்டா அஞ்சு இன்ச் நட்டு அந்த போல்ட் என்ன சொன்னோம்ல அது மட்டும் ரிமூவ் பண்ணனும்.';

test('recorded Tamil removal identifies the English unmatched nut-and-bolt row, not screws sharing inch',()=>{
 const draft=[line('2 inch screw',1,'மர ஸ்க்ரூ 2 இன்ச் 50 பேக்'),line('1 inch screw box',1,'1 இன்ச் ஸ்டெயின்லெஸ் ஸ்டீல் ஸ்க்ரூ பெட்டி'),line('nut and bolt',null)],s=state(draft);
 assert.deepEqual(namedEditLines(recorded,s).map(row=>row.id),[draft[2].id]);
 assert.deepEqual(namedEditLines('அஞ்சு இன்ச்',s),[],'a size alone never supplies a product identity');
 const u={...base,inputKind:'audio',transcript:recorded,proposedEdits:[{kind:'remove_item',targetLineId:draft[2].id,sourceText:recorded.slice(14,-1)}]};
 // Use the exact recorded clause, including its spoken removal verb.
 u.proposedEdits[0].sourceText=recorded;
 const result=understandingToInterpretation(u,{text:'current recording',audio:{mimeType:'audio/wav',data:'AA==',durationSeconds:1},state:s},false);
 assert.deepEqual(result.operations,[{kind:'remove_item',reference:draft[2].id,supportingPhrase:recorded}]);assert.equal(result.deferredCartTargets,undefined);assert.equal(draft[2].quantity,null);
});

for(const source of ['போல்ட்டை ரிமூவ் பண்ணுங்க','nut bolt remove pannu','remove the last item','delete third item'])test(`named or positional deletion: ${source}`,()=>{
 const draft=[line('screw'),line('switch'),line('nut and bolt')],s=state(draft),result=understandingToInterpretation({...base,proposedEdits:[{kind:'remove_item',targetLineId:draft[2].id,sourceText:source}]},{text:source,state:s},false);
 assert.equal(result.operations[0]?.kind,'remove_item');assert.equal('reference' in result.operations[0]?result.operations[0].reference:undefined,draft[2].id);
});

for(const source of ["don't remove bolt",'போல்ட் ரிமூவ் பண்ண வேண்டாம்','போல்ட் டெலீட் பண்ண வேணாம்'])test(`negated removal is rejected: ${source}`,()=>{
 const bolt=line('bolt'),s=state([bolt]);assert.equal(positiveRemoval(source),false);
 assert.throws(()=>understandingToInterpretation({...base,proposedEdits:[{kind:'remove_item',targetLineId:bolt.id,sourceText:source}]},{text:source,state:s},false),/positive current-message evidence|negates this cart mutation/);
});

test('clipped removal evidence cannot escape surrounding negation',()=>{
 assert.equal(positiveRemoval('remove bolt',"don't remove bolt"),false);
 assert.equal(positiveRemoval('போல்ட் ரிமூவ்','போல்ட் ரிமூவ் பண்ண வேண்டாம்'),false);
});

test('a correct normalized target name can bridge an untranslated item but cannot make a wrong UUID authoritative',()=>{
 const union=line('brass union'),screw=line('screw'),s=state([union,screw]),source='பித்தளை யூனியனை நீக்குங்க';
 const proposal={kind:'remove_item',targetLineId:union.id,targetQuery:'brass union',sourceText:source};
 const correct=understandingToInterpretation({...base,proposedEdits:[proposal]},{text:source,state:s},false);assert.equal(correct.operations.length,1);
 const wrong=understandingToInterpretation({...base,proposedEdits:[{...proposal,targetLineId:screw.id}]},{text:source,state:s},false);assert.deepEqual(wrong.operations,[]);assert.deepEqual(wrong.deferredCartTargets?.[0].candidateLineIds,[union.id]);
});

test('a generic pipe stays ambiguous even when a model proposes a specific normalized target',()=>{
 const a=line('PVC pipe'),b=line('water pumping pipe'),s=state([a,b]);
 const result=understandingToInterpretation({...base,proposedEdits:[{kind:'remove_item',targetLineId:a.id,targetQuery:'PVC pipe',sourceText:'remove pipe'}]},{text:'remove pipe',state:s},false);
 assert.deepEqual(result.operations,[]);assert.deepEqual(new Set(result.deferredCartTargets?.[0].candidateLineIds),new Set([a.id,b.id]));
});

test('the same unresolved row cannot receive an overlapping partial quantity mutation',()=>{
 const a=line('PVC pipe',2),b=line('water pumping pipe',4),s=state([a,b]),source='pipe three; make pipe three';
 const result=understandingToInterpretation({...base,intents:['add','edit'],requestedItems:[{ordinal:0,query:'PVC pipe',sourceText:'pipe three',purchaseCount:3,targetLineId:a.id,unresolved:[]}],proposedEdits:[{kind:'set_quantity',targetLineId:a.id,sourceText:'make pipe three',quantity:3}]},{text:source,state:s},false);
 assert.deepEqual(result.operations,[]);assert.equal(a.quantity,2);assert.ok(result.deferredCartTargets?.length);
});

test('a size without an actual count cannot authorize a quantity update',()=>{
 const bolt=line('bolt',2),s=state([bolt]);
 for(const source of ['bolt 5 inch','நட்டு போல்ட் லாஸ்ட்டா அது'])assert.throws(()=>understandingToInterpretation({...base,proposedEdits:[{kind:'set_quantity',targetLineId:bolt.id,sourceText:source,quantity:5}]},{text:source,state:s},false),/count must appear/);
});

test('size refines a named product identity and never becomes an item ordinal',()=>{
 const small=line('2 inch bolt'),large=line('5 inch bolt'),s=state([small,large]);
 assert.deepEqual(namedEditLines('அஞ்சு இன்ச் போல்ட் ரிமூவ் பண்ணுங்க',s).map(line=>line.id),[large.id]);
 assert.deepEqual(namedEditLines('remove 5 inch',s),[]);
});

test('a normalized name cannot override a conflicting positional reference',()=>{
 const screw=line('screw'),bolt=line('bolt'),s=state([screw,bolt]),source='remove first item bolt';
 const result=understandingToInterpretation({...base,proposedEdits:[{kind:'remove_item',targetLineId:bolt.id,targetQuery:'bolt',sourceText:source}]},{text:source,state:s},false);assert.deepEqual(result.operations,[]);
});

async function fixture(run:(pool:pg.Pool,inbox:SimulatorService,r:ConversationRuntime,output:{value:unknown;calls:number})=>Promise<void>){
 const schema='voice_crud_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');const id=randomUUID(),ctx={storeId:fixtureStore,conversationId:id,actor:'offline-crud',role:'customer' as const};await pool.query('INSERT INTO conversations(id,store_id,actor,reply_language) VALUES($1,$2,$3,\'ta\')',[id,fixtureStore,ctx.actor]);
  for(const [sku,name] of [['CRUD-PVC','PVC pipe'],['CRUD-PUMP','water pumping pipe'],['CRUD-SCR','screw'],['CRUD-NAL','nail'],['CRUD-UNI','brass union']])await pool.query("INSERT INTO products(store_id,sku,name,unit,price_paise,stock,aliases) VALUES($1,$2,$3,'piece',1000,100,'[]'::jsonb)",[fixtureStore,sku,name]);
  const output={value:{} as unknown,calls:0};const provider:Interpreter={name:'offline-voice-crud',mode:'mock',unifiedUnderstanding:true,supportsAudio:true,interpret:async input=>{output.calls++;return {output:understandingToInterpretation(output.value,input,false),usage:null,truncated:false};}};
  const inbox=new SimulatorService(pool,ctx),r=new ConversationRuntime(pool,provider,{visualOrdering:true});
  await new RetailTools(pool).invoke(ctx,{name:'apply_draft_changes',args:{expectedVersion:0,operations:[{kind:'add_item',query:'CRUD-PVC',quantity:2},{kind:'add_item',query:'CRUD-PUMP',quantity:4},{kind:'add_item',query:'CRUD-NAL',quantity:3}]}},randomUUID());
  await pool.query('UPDATE conversations SET pending=NULL,editing_line_id=NULL WHERE id=$1',[id]);await run(pool,inbox,r,output);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
async function send(i:SimulatorService,r:ConversationRuntime,event:SimulatorEvent){await i.ingest(event);await r.processNext(i.context);return i.snapshot();}
async function voice(i:SimulatorService,r:ConversationRuntime){const id=randomUUID(),pcm=Buffer.alloc(16000);for(let n=0;n<8000;n++)pcm.writeInt16LE(Math.round(Math.sin(n*.17)*1500),n*2);await i.ingest({id,type:'voice',mediaId:id},await normalizeVoice({id,mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')}));await r.processNext(i.context);return i.snapshot();}
const choices=(s:Snapshot)=>s.messages.filter(m=>m.direction==='outbound').at(-1)?.rich?.buttons?.flatMap(b=>b.event.type==='resolve_cart_target'?[b.event]:[])??[];

for(const [kind,source,quantity] of [['remove_item','remove pipe',undefined],['set_quantity','make pipe three',3],['increment_quantity','add two more pipe',2],['decrement_quantity','remove one pipe',1],['replace','replace pipe with brass union',undefined]] as const)test(`voice ${kind} keeps its action through a target choice without another inference`,()=>fixture(async(pool,i,r,output)=>{
 const before=await i.snapshot(),a=before.conversation.draft.find(l=>l.sku==='CRUD-PVC')!,b=before.conversation.draft.find(l=>l.sku==='CRUD-PUMP')!;
 output.value={...base,inputKind:'audio',transcript:source,proposedEdits:[{kind,targetLineId:a.id,sourceText:source,...(quantity!==undefined?{quantity}:{}),...(kind==='replace'?{query:'brass union'}:{})}]};
 const pending=await voice(i,r);assert.deepEqual(pending.conversation.draft,before.conversation.draft);assert.equal(output.calls,1);
 const offered=choices(pending);assert.deepEqual(new Set(offered.map(c=>c.lineId)),new Set([a.id,b.id]));
 const chosen=offered.find(c=>c.lineId===b.id)!;assert.ok(chosen);const after=await send(i,r,chosen);assert.equal(output.calls,1);assert.equal(after.requests.length,0);
 const changed=after.conversation.draft.find(l=>l.id===b.id);if(kind==='remove_item')assert.equal(changed,undefined);else if(kind==='replace'){assert.equal(changed?.sku,'CRUD-UNI');assert.equal(changed?.quantity,4);}else assert.equal(changed?.quantity,kind==='set_quantity'?3:kind==='increment_quantity'?6:3);
 assert.deepEqual(after.conversation.draft.find(l=>l.id===a.id),a);assert.equal(after.conversation.draft.find(l=>l.sku==='CRUD-NAL')?.quantity,3);
 const saved=structuredClone(after.conversation.draft);await send(i,r,{...chosen,id:randomUUID()});assert.deepEqual((await i.snapshot()).conversation.draft,saved,'a stale/repeated choice cannot apply the edit again');
}));

test('voice add creates a new item and a subsequent read-only price query leaves the cart intact',()=>fixture(async(_pool,i,r,output)=>{
 output.value={...base,inputKind:'audio',transcript:'add two screws',intents:['add'],requestedItems:[{ordinal:0,sourceText:'add two screws',query:'CRUD-SCR',purchaseCount:2,unresolved:[]}]};
 let s=await voice(i,r);assert.equal(s.conversation.draft.find(l=>l.sku==='CRUD-SCR')?.quantity,2);const before=structuredClone(s.conversation.draft);
 output.value={...base,inputKind:'audio',transcript:'screw price',intents:['price'],requestedItems:[{ordinal:0,sourceText:'screw',query:'screw',purchaseCount:null,unresolved:[]}]};s=await voice(i,r);assert.deepEqual(s.conversation.draft,before);assert.equal(s.requests.length,0);
}));

test('a forged choice outside the deferred candidate set cannot remove an unrelated row',()=>fixture(async(_pool,i,r,output)=>{
 const before=await i.snapshot(),a=before.conversation.draft.find(l=>l.sku==='CRUD-PVC')!,nail=before.conversation.draft.find(l=>l.sku==='CRUD-NAL')!;
 output.value={...base,proposedEdits:[{kind:'remove_item',targetLineId:a.id,sourceText:'remove pipe'}]};const pending=await send(i,r,{id:randomUUID(),type:'text',text:'remove pipe'}),choice=choices(pending)[0];assert.ok(choice);
 const after=await send(i,r,{...choice,id:randomUUID(),lineId:nail.id});assert.deepEqual(after.conversation.draft,before.conversation.draft);assert.equal(output.calls,1);
}));

test('an additional-item request retains its count when choosing the existing cart row',()=>fixture(async(_pool,i,r,output)=>{
 const before=await i.snapshot(),b=before.conversation.draft.find(l=>l.sku==='CRUD-PUMP')!,source='two more pipe';
 output.value={...base,inputKind:'audio',transcript:source,intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'pipe',purchaseCount:2,requestMode:'additional',unresolved:[]}]};
 const pending=await voice(i,r);assert.deepEqual(pending.conversation.draft,before.conversation.draft);const chosen=choices(pending).find(choice=>choice.lineId===b.id);assert.ok(chosen);
 const after=await send(i,r,chosen);assert.equal(after.conversation.draft.length,3);assert.equal(after.conversation.draft.find(line=>line.id===b.id)?.quantity,6);assert.equal(output.calls,1);
}));

test('two ambiguous proposed edits stay atomic and preserve the first selection until the second is answered',()=>fixture(async(_pool,i,r,output)=>{
 const before=await i.snapshot(),a=before.conversation.draft.find(l=>l.sku==='CRUD-PVC')!,b=before.conversation.draft.find(l=>l.sku==='CRUD-PUMP')!,source='make pipe three; remove pipe';
 output.value={...base,proposedEdits:[{kind:'set_quantity',targetLineId:a.id,quantity:3,sourceText:'make pipe three'},{kind:'remove_item',targetLineId:b.id,sourceText:'remove pipe'}]};
 const pending=await send(i,r,{id:randomUUID(),type:'text',text:source}),first=choices(pending).find(choice=>choice.lineId===a.id);assert.ok(first);
 const halfway=await send(i,r,first);assert.deepEqual(halfway.conversation.draft,before.conversation.draft);const second=choices(halfway).find(choice=>choice.lineId===b.id);assert.ok(second);
 const after=await send(i,r,second);assert.equal(after.conversation.draft.find(line=>line.id===a.id)?.quantity,3);assert.equal(after.conversation.draft.find(line=>line.id===b.id),undefined);assert.equal(output.calls,1);assert.equal(after.requests.length,0);
}));

for(const channel of ['text','voice'] as const)test(`a ${channel} answer resumes the pending removal without repeating its verb`,()=>fixture(async(_pool,i,r,output)=>{
 const before=await i.snapshot(),a=before.conversation.draft.find(line=>line.sku==='CRUD-PVC')!,b=before.conversation.draft.find(line=>line.sku==='CRUD-PUMP')!;
 output.value={...base,inputKind:'audio',transcript:'remove pipe',proposedEdits:[{kind:'remove_item',sourceText:'remove pipe',targetLineId:a.id}]};const pending=await voice(i,r);assert.ok(choices(pending).length);
 const answer='water pumping pipe';output.value={...base,inputKind:channel==='voice'?'audio':'text',...(channel==='voice'?{transcript:answer}:{}),cartTargetAnswer:{sourceText:answer,query:answer,targetLineId:b.id}};
 const after=channel==='voice'?await voice(i,r):await send(i,r,{id:randomUUID(),type:'text',text:answer});assert.equal(after.conversation.draft.find(line=>line.id===b.id),undefined);assert.deepEqual(after.conversation.draft.find(line=>line.id===a.id),a);assert.equal(output.calls,2);assert.equal(after.requests.length,0);
}));

test('an ambiguous spoken answer retains the original pending action and changes no rows',()=>fixture(async(_pool,i,r,output)=>{
 const before=await i.snapshot(),a=before.conversation.draft.find(line=>line.sku==='CRUD-PVC')!;
 output.value={...base,inputKind:'audio',transcript:'remove pipe',proposedEdits:[{kind:'remove_item',sourceText:'remove pipe',targetLineId:a.id}]};await voice(i,r);
 output.value={...base,inputKind:'audio',transcript:'pipe',cartTargetAnswer:{sourceText:'pipe',query:'pipe'}};const after=await voice(i,r);assert.deepEqual(after.conversation.draft,before.conversation.draft);assert.ok(choices(after).length);assert.match(after.messages.at(-1)?.text??'',/remove/);
}));


test('a positive removal clause remains independent of another item being kept',()=>{
 for(const description of ["don't remove screw but remove bolt","remove bolt and don't remove screw","remove bolt; don't remove screw"])assert.equal(positiveRemoval('remove bolt',description),true);
});

for(const source of ["don't make bolt three",'போல்ட் மூணு மாத்த வேண்டாம்'])test(`a negated quantity change cannot be applied: ${source}`,()=>{
 const bolt=line('bolt',2),s=state([bolt]);assert.throws(()=>understandingToInterpretation({...base,proposedEdits:[{kind:'set_quantity',targetLineId:bolt.id,sourceText:source,quantity:3}]},{text:source,state:s},false),/negates this cart mutation/);
});

test('a negated add is never converted into a fresh row',()=>{
 const source="don't add two screws";assert.throws(()=>understandingToInterpretation({...base,intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'screw',purchaseCount:2,unresolved:[]}]},{text:source,state:state([])},false),/negates this cart mutation/);
});


test('normalized target identity cannot override a known size contradiction',()=>{
 const bolt=line('2 inch bolt'),s=state([bolt]),source='remove 5 inch bolt';
 const result=understandingToInterpretation({...base,proposedEdits:[{kind:'remove_item',targetLineId:bolt.id,targetQuery:'2 inch bolt',sourceText:source}]},{text:source,state:s},false);assert.deepEqual(result.operations,[]);
});

test('photo refusal cannot authorize removal of the currently focused product',()=>{
 const bolt=line('bolt'),s={...state([bolt]),editingLineId:bolt.id},source="I don't want these photos";
 assert.throws(()=>understandingToInterpretation({...base,proposedEdits:[{kind:'remove_item',targetLineId:bolt.id,sourceText:source}]},{text:source,state:s},false),/explicit current intent/);
});

test('a decrement from an unknown count asks for the remaining total instead of assuming one',()=>{
 const bolt=line('bolt',null),source='remove one bolt',result=understandingToInterpretation({...base,proposedEdits:[{kind:'decrement_quantity',targetLineId:bolt.id,sourceText:source,quantity:1}]},{text:source,state:state([bolt])},false);
 assert.deepEqual(result.operations,[]);assert.match(result.clarifyQuestion??'',/எத்தனை|total/);assert.equal(bolt.quantity,null);
});


test('Tamil brand names starting like an edit verb remain valid removal targets',()=>{
 for(const [name,source] of [['Atlas hammer','அட்லஸ் சுத்தியல் வேண்டாம்'],['Cheran hammer','சேரன் சுத்தியல் வேண்டாம்']]){
  const hammer=line(name),result=understandingToInterpretation({...base,proposedEdits:[{kind:'remove_item',targetLineId:hammer.id,targetQuery:name,sourceText:source}]},{text:source,state:state([hammer])},false);assert.equal(result.operations[0]?.kind,'remove_item');
 }
});

test('Tamil add negation still requires the actual add action phrase',()=>{
 const source='ஸ்க்ரூ அட் பண்ண வேண்டாம்';assert.throws(()=>understandingToInterpretation({...base,intents:['add'],requestedItems:[{ordinal:0,sourceText:source,query:'screw',purchaseCount:2,unresolved:[]}]},{text:source,state:state([])},false),/negates this cart mutation/);
});
