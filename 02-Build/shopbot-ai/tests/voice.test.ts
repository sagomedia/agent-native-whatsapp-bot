import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';import {FinishReason,GenerateContentResponse,ThinkingLevel} from '@google/genai';
import {spokenClearCommand} from '../apps/server/src/services/shopping-language.js';
import {geminiTextRate} from '../apps/server/src/services/inference-budget.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';import {normalizeVoice,pcmWav,verifyVoiceDecoder,loadVoice} from '../apps/server/src/services/voice-media.js';import {SimulatorService} from '../apps/server/src/services/simulator.js';import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';import {GoogleInterpreter} from '../apps/server/src/adapters/google-interpreter.js';import {initializeBudget} from '../apps/server/src/services/inference-budget.js';import {createApp} from '../apps/server/src/http/app.js';
const settings={allowPaidInference:false,apiKey:'offline-placeholder',model:'gemini-3.5-flash-lite',budgetMicrousd:0,freeQuota:{scope:'voice-test',model:'gemini-3.5-flash-lite'}};
function wav(seconds:number){const pcm=Buffer.alloc(Math.round(seconds*16000)*2);for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(i*0.17)*1200),i*2);return pcmWav(pcm);}
function upload(seconds=1,id=randomUUID()){return {id,mimeType:'audio/wav' as const,data:wav(seconds).toString('base64')};}
function response(output:unknown){return Object.assign(new GenerateContentResponse(),{candidates:[{content:{parts:[{text:JSON.stringify(output)}]},finishReason:FinishReason.STOP}],modelVersion:settings.model,usageMetadata:{promptTokenCount:1400,candidatesTokenCount:130,totalTokenCount:1530}});}
async function resumeAfterFreeSpacing(pool:pg.Pool,runtime:ConversationRuntime,inbox:SimulatorService){await pool.query("UPDATE provider_attempts SET created_at=now()-interval '7 seconds'");await pool.query("UPDATE messages SET not_before=now() WHERE status='pending'");await runtime.processNext(inbox.context);}
async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){const connectionString=process.env.DATABASE_URL,admin=new pg.Pool({connectionString}),schema='voice_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA "${schema}"`);const pool=new pg.Pool({connectionString,options:`-c search_path=${schema}`});try{await setupDatabase(pool,'mock');await setupImageDemo(pool);const id=randomUUID();await pool.query('INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,$3)',[id,demoCatalogStore,'voice-test']);await run(pool,new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'voice-test',role:'customer'}));}finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}}

test('uploaded bytes determine voice duration; invalid, long and silent recordings are rejected before inference',async()=>{const normalized=await normalizeVoice(upload());assert.equal(normalized.durationSeconds,1);assert.equal(normalized.audio.length,32044);await assert.rejects(normalizeVoice({...upload(),data:Buffer.from('not audio').toString('base64')}),/could not be read/);await assert.rejects(normalizeVoice(upload(30.2)),/30 seconds/);await assert.rejects(normalizeVoice({...upload(),data:pcmWav(Buffer.alloc(32000)).toString('base64')}),/could not hear/);await assert.rejects(normalizeVoice({...upload(),data:Buffer.alloc(1048577).toString('base64')}),/under 1 MB/);});

test('recognition and planning are separate free SDK requests; real photos need acceptance; duplicate upload cannot repeat inference',async()=>fixture(async(pool,inbox)=>{let calls=0;const provider=new GoogleInterpreter(settings,{generateContent:async(params)=>{calls++;assert.equal(params.config?.automaticFunctionCalling?.disable,true);assert.equal(params.config?.httpOptions?.retryOptions?.attempts,1);if(calls===1){assert.equal(params.config?.thinkingConfig?.thinkingLevel,ThinkingLevel.LOW);assert.match(JSON.stringify(params.contents),/inlineData.*audio\/wav/);assert.deepEqual(Object.keys((params.config?.responseJsonSchema as any).properties),['transcript']);assert.ok(!JSON.stringify(params.contents).includes('currentDraft'));return response({transcript:'Two one inch PVC pipes and five bottles of solvent gum'});}assert.equal(params.config?.thinkingConfig?.thinkingLevel,ThinkingLevel.MINIMAL);assert.ok(!JSON.stringify(params.contents).includes('audio/wav'));assert.match(JSON.stringify(params.contents),/Two one inch PVC pipes/);return response({operations:[{kind:'add_item',query:'1 inch PVC pipe',quantity:2,search:{keywords:['PVC pipe'],familyId:'pvc-pipes',specifications:{size:'1 inch'}}},{kind:'add_item',query:'H07',quantity:5,requestedUnit:'bottle'}],next:'review'});}}),runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true}),u=upload(),media=await normalizeVoice(u),event={id:u.id,type:'voice' as const,mediaId:u.id};await inbox.ingest(event,media);await runtime.processNext(inbox.context);await resumeAfterFreeSpacing(pool,runtime,inbox);let s=await inbox.snapshot();assert.equal(calls,2);assert.equal(s.conversation.draft.length,2);assert.deepEqual(s.conversation.draft.map(l=>l.quantity),[2,5]);assert.deepEqual(s.conversation.draft[0].candidates!.map(p=>p.sku),['H01','H02']);assert.equal(s.conversation.draft[1].sku,'H07');assert.equal(s.conversation.pending?.kind,'products');assert.ok(s.conversation.draft.every(l=>!l.productConfirmation));assert.equal(s.requests.length,0);assert.match(s.messages[0].text,/Two one inch/);assert.equal(s.messages[0].voice?.durationSeconds,1);assert.ok(s.messages.at(-1)!.rich!.cards!.every(c=>c.product.imageUrl&&Number.isSafeInteger(c.product.pricePaise)));assert.equal(s.messages.at(-1)!.rich!.outboundMessages,1);assert.equal((await inbox.ingest(event,media)).duplicate,true);assert.equal(await runtime.processNext(inbox.context),false);assert.equal(calls,2);await assert.rejects(inbox.ingest(event,{...media,sourceHash:'different'}),/different recording/);s=await inbox.snapshot();assert.equal(s.conversation.draft.length,2);assert.equal((await pool.query('SELECT count(*)::int AS n FROM voice_media')).rows[0].n,1);const audio=await loadVoice(pool,inbox.context,u.id);assert.equal(audio.durationSeconds,1);await assert.rejects(loadVoice(pool,{...inbox.context,actor:'other'},u.id),/not accessible/);}));

test('current voice approval uses recognized text without generated edits; missing transcript keeps the draft',async()=>fixture(async(pool,inbox)=>{
 let transcript:unknown={transcript:'Yes send it'};let calls=0;
 const provider=new GoogleInterpreter(settings,{generateContent:async p=>{calls++;return response(JSON.stringify(p.contents).includes('audio/wav')?transcript:{operations:[],next:'review'});}});
 const runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 await inbox.ingest({id:randomUUID(),type:'choose_product',sku:'H07',quantity:2,expectedVersion:0});await runtime.processNext(inbox.context);
 const before=(await inbox.snapshot()).conversation;
 let u=upload();await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);await resumeAfterFreeSpacing(pool,runtime,inbox);
 let s=await inbox.snapshot();assert.equal(calls,1);assert.equal(s.requests.length,before.pending?.kind==='review'?1:0);assert.equal(s.conversation.draft[0].quantity,before.draft[0].quantity);
 await pool.query("UPDATE provider_attempts SET created_at=created_at-interval '1 hour'");transcript={operations:[{kind:'add_item',query:'H13',quantity:1}],next:'review'};u=upload();const state=s.conversation;
 await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);s=await inbox.snapshot();
 assert.deepEqual(s.conversation,state);assert.equal(s.requests.length,0);assert.equal(s.messages.at(-1)!.rich?.cards,undefined);assert.deepEqual((await pool.query('SELECT stage,state FROM provider_attempts WHERE message_id=$1',[u.id])).rows.map(r=>[r.stage,r.state]),[['recognize','failed']]);
}));

test('voice respects the shared free request spacing without repeating a stage',async()=>fixture(async(pool,inbox)=>{let calls=0;const provider=new GoogleInterpreter(settings,{generateContent:async p=>{calls++;return JSON.stringify(p.contents).includes('audio/wav')?response({transcript:'blade'}):response({operations:[{kind:'add_item',query:'blade',quantity:null}],next:'review'});}}),runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});const u=upload();await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);assert.equal(calls,1);assert.equal((await inbox.snapshot()).conversation.draft.length,0);assert.deepEqual((await pool.query('SELECT stage FROM provider_attempts WHERE message_id=$1',[u.id])).rows.map(r=>r.stage),['recognize']);await resumeAfterFreeSpacing(pool,runtime,inbox);const s=await inbox.snapshot();assert.equal(calls,2);assert.equal(s.conversation.draft.length,1);assert.equal(s.requests.length,0);assert.deepEqual((await pool.query('SELECT stage FROM provider_attempts WHERE message_id=$1 ORDER BY attempt',[u.id])).rows.map(r=>r.stage),['recognize','identify']);}));

test('paid text adapter refuses audio before any request; local route requires signed session and uploaded media',async()=>fixture(async(pool,inbox)=>{let calls=0;const paid=new GoogleInterpreter({...settings,allowPaidInference:true,freeQuota:undefined,budgetMicrousd:1000000},{generateContent:async()=>{calls++;return response({operations:[],next:'continue'});}});await assert.rejects(paid.interpret({text:'voice',state:(await inbox.snapshot()).conversation,audio:{mimeType:'audio/wav',data:wav(1).toString('base64'),durationSeconds:1}},AbortSignal.timeout(1000)),/recognition stage/);assert.equal(calls,0);const provider=new GoogleInterpreter(settings,{generateContent:async()=>{calls++;return response({transcript:'I need a blade',operations:[{kind:'add_item',query:'blade',quantity:null}],next:'review'});}});const app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,host:'127.0.0.1',port:3017,mediaDir:'/tmp/voice-fixture'},pool,provider,demoCatalogStore);try{const headers={host:'localhost:3017','x-shopbot-local-test':'1'};assert.equal((await app.inject({method:'POST',url:'/api/native-test/voice',headers,payload:upload()})).statusCode,401);const session=await app.inject({method:'POST',url:'/api/native-test/session',headers});const cookie=String(session.headers['set-cookie']).split(';')[0],h={...headers,cookie};const u=upload();assert.equal((await app.inject({method:'POST',url:'/api/native-test/events',headers:h,payload:{id:u.id,type:'voice',mediaId:u.id}})).statusCode,400);assert.equal((await app.inject({method:'POST',url:'/api/native-test/voice',headers:{...h,origin:'https://foreign.test'},payload:u})).statusCode,403);assert.equal((await app.inject({method:'POST',url:'/api/native-test/voice',headers:h,payload:u})).statusCode,200);assert.equal(calls,1);const playback=await app.inject({url:`/api/native-test/voice/${u.id}`,headers:h});assert.equal(playback.statusCode,200);assert.equal(playback.headers['cache-control'],'private, no-store');await app.inject({method:'POST',url:'/api/native-test/session',headers});const second=await app.inject({method:'POST',url:'/api/native-test/session',headers});assert.equal((await app.inject({url:`/api/native-test/voice/${u.id}`,headers:{...headers,cookie:String(second.headers['set-cookie']).split(';')[0]}})).statusCode,404);}finally{await app.close();}}));

test('compact provider search plans translate atomically into the canonical deterministic filter contract',async()=>fixture(async(pool,inbox)=>{
 const provider=new GoogleInterpreter(settings,{generateContent:async p=>{
  if(JSON.stringify(p.contents).includes('audio/wav'))return response({transcript:'Two one inch pipes'});
  assert.ok((p.config?.responseJsonSchema as any)?.properties?.operations);
  assert.equal(p.config?.responseMimeType,'application/json');
  const contract=String(p.config?.systemInstruction);assert.match(contract,/Planning contract:/);assert.match(contract,/searchPlans/);assert.ok(!contract.includes('propertyNames'));assert.ok(contract.length<6000);
  return response({operations:[{kind:'add_item',query:'PVC pipe',quantity:2}],searchPlans:[{operationIndex:0,keywords:['PVC pipe'],familyId:'pvc-pipes',specificationFilters:[{key:'size',value:'1 inch'}]}],next:'review'});
 }}),runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true}),u=upload();
 await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);await resumeAfterFreeSpacing(pool,runtime,inbox);
 const s=await inbox.snapshot();assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].quantity,2);assert.ok(s.conversation.draft[0].candidates!.every(p=>p.specifications?.size==='1 inch'));assert.equal(s.requests.length,0);
}));

test('duplicate or out-of-range provider plan bindings cannot partially mutate a draft',async()=>fixture(async(pool,inbox)=>{
 for(const plans of [[{operationIndex:2,keywords:['pipe']}],[{operationIndex:0,keywords:['pipe']},{operationIndex:0,keywords:['tape']}],[{operationIndex:0,keywords:['pipe'],specificationFilters:[{key:'size',value:'1 inch'},{key:'size',value:'2 inch'}]}]]){
  await pool.query("UPDATE provider_attempts SET created_at=created_at-interval '1 hour'");
  const provider=new GoogleInterpreter(settings,{generateContent:async p=>response(JSON.stringify(p.contents).includes('audio/wav')?{transcript:'two pipes'}:{operations:[{kind:'add_item',query:'PVC pipe',quantity:2}],searchPlans:plans,next:'review'})});
  const runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true}),u=upload();await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);await resumeAfterFreeSpacing(pool,runtime,inbox);
  assert.equal((await inbox.snapshot()).conversation.draft.length,0);
  assert.deepEqual((await pool.query('SELECT stage,state FROM provider_attempts WHERE message_id=$1 ORDER BY attempt',[u.id])).rows.map(r=>[r.stage,r.state]),[['recognize','succeeded'],['identify','failed']]);
 }
}));

test('a queued voice quantity cannot answer the next product question or make another AI call',async()=>fixture(async(pool,inbox)=>{let calls=0;const provider=new GoogleInterpreter(settings,{generateContent:async()=>{calls++;return response({transcript:'three bottles'});}}),runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true}),u=upload();await inbox.ingest({id:randomUUID(),type:'choose_product',sku:'H07',quantity:2,expectedVersion:0});await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);const before=(await inbox.snapshot()).conversation;await runtime.processNext(inbox.context);assert.deepEqual((await inbox.snapshot()).conversation,before);assert.equal(calls,0);}));

test('recognized Tamil clear-list command overrides a model pause and remains idempotent',async()=>fixture(async(pool,inbox)=>{
 let calls=0;const provider=new GoogleInterpreter(settings,{generateContent:async()=>{calls++;return response({transcript:'பட்டியலை காலி செய்'});}});
 const runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 await inbox.ingest({id:randomUUID(),type:'choose_product',sku:'H07',quantity:2,expectedVersion:0});await runtime.processNext(inbox.context);
 const u=upload(),media=await normalizeVoice(u),event={id:u.id,type:'voice' as const,mediaId:u.id};
 await inbox.ingest(event,media);await runtime.processNext(inbox.context);
 const after=await inbox.snapshot();assert.equal(after.conversation.draft.length,0);assert.equal(after.requests.length,0);assert.equal(calls,1);
 assert.equal(after.messages.find(m=>m.id===u.id)?.text,'பட்டியலை காலி செய்');
 assert.equal((await inbox.ingest(event,media)).duplicate,true);assert.equal(await runtime.processNext(inbox.context),false);
 assert.deepEqual((await inbox.snapshot()).conversation,after.conversation);assert.equal(calls,1);
}));

test('recognized spoken quantity answers the bound item when the model omits operations',async()=>fixture(async(pool,inbox)=>{
 const provider=new GoogleInterpreter(settings,{generateContent:async()=>response({transcript:'three bottles'})});
 const runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 await inbox.ingest({id:randomUUID(),type:'choose_product',sku:'H07',expectedVersion:0});await runtime.processNext(inbox.context);
 const u=upload();await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);
 const after=await inbox.snapshot();assert.equal(after.conversation.draft[0].quantity,3);assert.equal(after.conversation.draft[0].sku,'H07');
 assert.equal(after.requests.length,0);assert.ok(!after.conversation.draft[0].productConfirmation);
}));

test('spoken clear command tolerates the recorded inflection and acknowledgement but rejects negation and compound edits',async()=>fixture(async(pool,inbox)=>{
 const transcript='பட்டியலைய காலி செய். ஆமா, என்ன வேலையில வேலை';
 assert.equal(spokenClearCommand(transcript),'clear my list');
 assert.equal(spokenClearCommand('பட்டியல் எல்லாம் காலி செய்'),'clear my list');
 assert.equal(spokenClearCommand('பாட்டியாளை காலி செய் ஆமா என்ன வேலையில'),'clear my list');
 assert.equal(spokenClearCommand('பாட்டியாளை காலி செய் வேண்டாம்'),undefined);
 assert.equal(spokenClearCommand('பாட்டியை காலி செய்'),undefined);
 assert.equal(spokenClearCommand('பாத்திரங்களை காலி செய்'),undefined);
 assert.equal(spokenClearCommand('பட்டியல் எல்லாம் காலி செய் வேண்டாம்'),undefined);
 for(const negative of ['பட்டியலை காலி செய் வேண்டாம்','clear my list, actually keep it','clear my list yes do not clear it','clear my list and add paint','clear my list yes add paint','clear my list please remove first item','பட்டியலை காலி செய் ஆமா பெயிண்ட் சேர்',"don't clear my list"]){assert.equal(spokenClearCommand(negative),undefined);}
 assert.equal(spokenClearCommand('clear my list please yes thanks'),'clear my list');
 const provider=new GoogleInterpreter(settings,{generateContent:async()=>response({transcript})});
 const runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 await inbox.ingest({id:randomUUID(),type:'choose_product',sku:'H07',quantity:2,expectedVersion:0});await runtime.processNext(inbox.context);
 const u=upload();await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);
 assert.equal((await inbox.snapshot()).conversation.draft.length,0);assert.equal((await inbox.snapshot()).requests.length,0);
}));

test('a negated spoken clear keeps the draft even when the model proposes removal',async()=>fixture(async(pool,inbox)=>{
 const provider=new GoogleInterpreter(settings,{generateContent:async()=>response({transcript:'பட்டியலை காலி செய் வேண்டாம்'})});
 const runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 await inbox.ingest({id:randomUUID(),type:'choose_product',sku:'H07',quantity:2,expectedVersion:0});await runtime.processNext(inbox.context);
 const before=(await inbox.snapshot()).conversation,u=upload();await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);
 assert.deepEqual((await inbox.snapshot()).conversation,before);assert.equal((await inbox.snapshot()).requests.length,0);
}));

test('an explicit clear transcript remains usable when the model plan is malformed',async()=>fixture(async(pool,inbox)=>{
 const provider=new GoogleInterpreter(settings,{generateContent:async params=>{
  assert.equal((params.contents as any)[0].parts[0].text,'Transcribe this new recording.');assert.ok(!JSON.stringify(params.contents).includes('currentDraft'));
  return response({transcript:'பட்டியலை காலி செய் ஆமா என்ன வேலையில'});
 }});
 const runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 await inbox.ingest({id:randomUUID(),type:'choose_product',sku:'H07',quantity:2,expectedVersion:0});await runtime.processNext(inbox.context);
 const u=upload();await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);
 assert.equal((await inbox.snapshot()).conversation.draft.length,0);assert.equal((await inbox.snapshot()).requests.length,0);
 const attempt=(await pool.query('SELECT stage,state FROM provider_attempts WHERE message_id=$1',[u.id])).rows[0];
 assert.deepEqual(attempt,{stage:'recognize',state:'succeeded'});
}));

test('an acknowledgement before a second spoken edit keeps the complete validated plan',async()=>fixture(async(pool,inbox)=>{
 const provider=new GoogleInterpreter(settings,{generateContent:async p=>JSON.stringify(p.contents).includes('audio/wav')?response({transcript:'clear my list yes add one Asian Paints'}):response({operations:[{kind:'remove_item',reference:(await inbox.snapshot()).conversation.draft[0].id},{kind:'add_item',query:'Asian Paints',quantity:1}],next:'review'})});
 const runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 await inbox.ingest({id:randomUUID(),type:'choose_product',sku:'H07',quantity:2,expectedVersion:0});await runtime.processNext(inbox.context);
 const u=upload();await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);await resumeAfterFreeSpacing(pool,runtime,inbox);
 const after=await inbox.snapshot();assert.equal(after.conversation.draft.length,1);assert.match(after.conversation.draft[0].query??'',/Asian Paints/);assert.equal(after.conversation.draft[0].quantity,1);assert.equal(after.requests.length,0);
}));

test('malformed compound spoken edits cannot recover into a partial clear',async()=>fixture(async(pool,inbox)=>{
 const provider=new GoogleInterpreter(settings,{generateContent:async p=>response(JSON.stringify(p.contents).includes('audio/wav')?{transcript:'clear my list yes add paint'}:{operations:['remove_item'],next:'review'})});
 const runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 await inbox.ingest({id:randomUUID(),type:'choose_product',sku:'H07',quantity:2,expectedVersion:0});await runtime.processNext(inbox.context);
 const before=(await inbox.snapshot()).conversation,u=upload();await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);await resumeAfterFreeSpacing(pool,runtime,inbox);
 const after=await inbox.snapshot();assert.deepEqual(after.conversation,before);assert.equal(after.requests.length,0);
 assert.deepEqual((await pool.query('SELECT stage,state FROM provider_attempts WHERE message_id=$1 ORDER BY attempt',[u.id])).rows.map(r=>[r.stage,r.state]),[['recognize','succeeded'],['identify','failed']]);
}));

test('a pending item refusal cannot remove unrelated draft lines',async()=>fixture(async(pool,inbox)=>{
 const provider={name:'pending-refusal-test',mode:'mock' as const,interpret:async(input:any)=>({truncated:false,usage:null,output:{operations:input.state.draft.map((line:any)=>({kind:'remove_item',reference:line.id})),next:'review'}})};
 const runtime=new ConversationRuntime(pool,provider);
 await inbox.ingest({id:randomUUID(),type:'choose_product',sku:'H13',quantity:1,expectedVersion:0});await runtime.processNext(inbox.context);
 let state=(await inbox.snapshot()).conversation;
 await inbox.ingest({id:randomUUID(),type:'choose_product',sku:'H07',expectedVersion:state.version});await runtime.processNext(inbox.context);
 let before=(await inbox.snapshot()).conversation;assert.equal(before.draft.length,2);
 await pool.query('UPDATE conversations SET pending=$1::jsonb WHERE id=$2',[JSON.stringify({kind:'question',id:randomUUID(),lineId:before.draft[1].id,version:before.version}),inbox.context.conversationId]);
 before=(await inbox.snapshot()).conversation;assert.equal(before.pending?.kind,'question');
 await inbox.ingest({id:randomUUID(),type:'text',text:'I do not want these options, just the cutting plier'});await runtime.processNext(inbox.context);
 const after=await inbox.snapshot();assert.deepEqual(after.conversation.draft,before.draft);assert.match(after.messages.at(-1)!.text,/Which item should I remove/);
}));


test('inaudible recognition returns a clear retry without shopping planning',async()=>fixture(async(pool,inbox)=>{
 let calls=0;const provider=new GoogleInterpreter(settings,{generateContent:async()=>{calls++;return response({transcript:''});}}),runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 const u=upload();await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);
 const snapshot=await inbox.snapshot();assert.equal(calls,1);assert.equal(snapshot.conversation.draft.length,0);assert.match(snapshot.messages.at(-1)!.text,/record it again or type/);
 assert.deepEqual((await pool.query('SELECT stage,state FROM provider_attempts WHERE message_id=$1',[u.id])).rows.map(r=>[r.stage,r.state]),[['recognize','succeeded']]);
}));

test('spoken edit list opens bound item choices without a planning request',async()=>fixture(async(pool,inbox)=>{
 let calls=0;const provider=new GoogleInterpreter(settings,{generateContent:async()=>{calls++;return response({transcript:'edit my list'});}}),runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 await inbox.ingest({id:randomUUID(),type:'choose_product',sku:'H07',quantity:2,expectedVersion:0});await runtime.processNext(inbox.context);
 const before=(await inbox.snapshot()).conversation,u=upload();await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);
 const after=await inbox.snapshot();assert.equal(calls,1);assert.deepEqual(after.conversation.draft,before.draft);assert.match(after.messages.at(-1)!.text,/Which item would you like to change/);
 assert.ok(after.messages.at(-1)!.rich?.buttons?.some(b=>b.event.type==='edit_item'&&b.event.lineId===before.draft[0].id));
}));

test('spoken language preference uses recognition only',async()=>fixture(async(pool,inbox)=>{
 let calls=0;const provider=new GoogleInterpreter(settings,{generateContent:async()=>{calls++;return response({transcript:'Tamil la sollunga'});}}),runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 const u=upload();await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);
 assert.equal(calls,1);assert.equal((await inbox.snapshot()).conversation.replyLanguage,'ta');
 assert.deepEqual((await pool.query('SELECT stage FROM provider_attempts WHERE message_id=$1',[u.id])).rows.map(r=>r.stage),['recognize']);
}));

test('paid voice recognition, planning and recommendation each settle a separate budgeted attempt',async()=>fixture(async(pool,inbox)=>{
 let calls=0;const provider=new GoogleInterpreter({...settings,freeQuota:undefined,allowPaidInference:true,allowMultimodal:true,budgetMicrousd:1000000},{generateContent:async params=>{
  calls++;const schema=(params.config?.responseJsonSchema as any)?.properties;
  if((params.config?.responseJsonSchema as any)?.properties?.transcript&&!(params.config?.responseJsonSchema as any)?.properties?.operations)return Object.assign(response({}),{modelVersion:geminiTextRate.model,candidates:[{finishReason:FinishReason.STOP,content:{parts:[{text:JSON.stringify({transcript:'Show me a pipe cutter'})}]}}]});
  if(schema?.skus)return response({skus:['H19'],question:null});
  assert.match(params.contents as string,/Show me a pipe cutter/);return response({operations:[],next:'assist',assistance:{queries:['pipe cutter'],rootQuery:'pipe cutter'},assistanceSearch:{keywords:['pipe cutter']}});
 }});
 await initializeBudget(pool,inbox.context,1000000);
 const runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true,mediaRecommendations:true});
 const u=upload(12);await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);
 const attempts=(await pool.query('SELECT stage,state,billing_state,provider,rate_snapshot FROM provider_attempts WHERE message_id=$1 ORDER BY attempt',[u.id])).rows;
 assert.equal(calls,3);assert.deepEqual(attempts.map(a=>a.stage),['recognize','identify','recommend']);assert.ok(attempts.every(a=>a.state==='succeeded'&&a.billing_state==='estimated'));
 assert.equal(attempts[0].provider,'google:'+geminiTextRate.model);assert.equal(attempts[0].rate_snapshot.model,geminiTextRate.model);assert.equal(attempts[1].rate_snapshot.model,settings.model);
 const budget=(await pool.query('SELECT held_microusd,committed_microusd FROM inference_budgets WHERE store_id=$1',[inbox.context.storeId])).rows[0];assert.equal(Number(budget.held_microusd),0);assert.equal(Number(budget.committed_microusd),2235);
 assert.equal((await inbox.snapshot()).conversation.draft.length,0);
}));

test('recognition uses only a reply-language locale hint and never sends draft or history',async()=>{
 const seen:{instruction:string;contents:string}[]=[];
 const provider=new GoogleInterpreter(settings,{generateContent:async params=>{
  seen.push({instruction:String(params.config?.systemInstruction),contents:JSON.stringify(params.contents)});
  return response({transcript:'கட்டிங் பிளையர் வேண்டும்'});
 }});
 for(const replyLanguage of ['ta','ta-Latn','en'] as const){
  const result=await provider.interpret({stage:'recognize',text:'Recording placeholder',audio:{mimeType:'audio/wav',data:'AAAA',durationSeconds:1},state:{version:0,draft:[{id:randomUUID(),query:'PRIVATE OLD ORDER',name:'PRIVATE OLD ORDER',quantity:8,resolution:'matched'}],pending:null,fulfillment:'pickup',lastRequestId:null,replyLanguage},history:[{direction:'inbound',text:'PRIVATE HISTORY'}],catalog:[{sku:'PRIVATE-CATALOG'} as any]},new AbortController().signal);
  assert.equal((result.output as any).transcript,'கட்டிங் பிளையர் வேண்டும்');
 }
 assert.match(seen[0].instruction,/இந்தியப் பேச்சுவழக்குத் தமிழில்/);assert.match(seen[0].instruction,/தமிழ் எழுத்தில்/);
 assert.match(seen[1].instruction,/Tanglish Latin/);assert.match(seen[1].instruction,/ஒலிப்படி/);
 assert.match(seen[2].instruction,/English, colloquial Tamil/);
 for(const request of seen){assert.match(request.contents,/audio\/wav/);assert.equal(JSON.parse(request.contents)[0].parts[0].text,'Transcribe this new recording.');assert.doesNotMatch(request.instruction+request.contents,/PRIVATE OLD ORDER|PRIVATE HISTORY|PRIVATE-CATALOG/);assert.match(request.instruction,/முழுப் பதிவும் ஆங்கிலமாகவும் இருக்கலாம்|may use English/);}
});


test('one transient paid recognition retry allows all four accounted stages without releasing unknown charges',async()=>fixture(async(pool,inbox)=>{
 let calls=0,speechCalls=0;
 const provider=new GoogleInterpreter({...settings,freeQuota:undefined,allowPaidInference:true,allowMultimodal:true,budgetMicrousd:1000000},{generateContent:async params=>{
  calls++;
  if((params.config?.responseJsonSchema as any)?.properties?.transcript&&!(params.config?.responseJsonSchema as any)?.properties?.operations){speechCalls++;if(speechCalls===1)throw Object.assign(new Error('temporary speech error'),{status:503});return Object.assign(response({}),{modelVersion:geminiTextRate.model,candidates:[{finishReason:FinishReason.STOP,content:{parts:[{text:JSON.stringify({transcript:'Show me a pipe cutter'})}]}}]});}
  if((params.config?.responseJsonSchema as any)?.properties?.skus)return response({skus:['H19'],question:null});
  return response({operations:[],next:'assist',assistance:{queries:['pipe cutter'],rootQuery:'pipe cutter'},assistanceSearch:{keywords:['pipe cutter']}});
 }});
 await initializeBudget(pool,inbox.context,1000000);
 const runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true,mediaRecommendations:true,visualOrdering:true});
 const u=upload(12);await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);
 const attempts=(await pool.query('SELECT attempt,stage,state,billing_state,reserved_microusd FROM provider_attempts WHERE message_id=$1 ORDER BY attempt',[u.id])).rows;
 assert.equal(calls,4);assert.equal(speechCalls,2);assert.deepEqual(attempts.map(a=>a.attempt),[1,2,3,4]);
 assert.deepEqual(attempts.map(a=>[a.stage,a.state]),[['recognize','failed'],['recognize','succeeded'],['identify','succeeded'],['recommend','succeeded']]);
 assert.equal(attempts[0].billing_state,'unknown');assert.ok(attempts.slice(1).every(a=>a.billing_state==='estimated'));
 const budget=(await pool.query('SELECT held_microusd,committed_microusd FROM inference_budgets WHERE store_id=$1',[inbox.context.storeId])).rows[0];
 assert.equal(Number(budget.held_microusd),Number(attempts[0].reserved_microusd));assert.ok(Number(budget.committed_microusd)>0);
 assert.equal((await inbox.snapshot()).requests.length,0);await setupDatabase(pool,'mock');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM provider_attempts WHERE message_id=$1',[u.id])).rows[0].n,4);
}));

test('paid retry cannot bypass the configured budget or release a failed request reservation',async()=>fixture(async(pool,inbox)=>{
 let calls=0;
 const provider=new GoogleInterpreter({...settings,freeQuota:undefined,allowPaidInference:true,allowMultimodal:true,budgetMicrousd:400000},{generateContent:async()=>{calls++;throw Object.assign(new Error('temporary speech error'),{status:503});}});
 await initializeBudget(pool,inbox.context,400000);
 const runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true,visualOrdering:true}),u=upload(12);
 await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},await normalizeVoice(u));await runtime.processNext(inbox.context);
 const s=await inbox.snapshot();assert.equal(calls,1);assert.equal(s.conversation.draft.length,0);assert.equal(s.messages.at(-1)!.rich!.stage,'error');
 const attempts=(await pool.query('SELECT billing_state,reserved_microusd FROM provider_attempts WHERE message_id=$1',[u.id])).rows;
 assert.equal(attempts.length,1);assert.equal(attempts[0].billing_state,'unknown');
 const b=(await pool.query('SELECT limit_microusd,held_microusd,committed_microusd FROM inference_budgets WHERE store_id=$1',[inbox.context.storeId])).rows[0];
 assert.equal(Number(b.limit_microusd),400000);assert.equal(Number(b.held_microusd),Number(attempts[0].reserved_microusd));assert.equal(Number(b.committed_microusd),0);
}));


test('the deployed decoder preflight works and a WhatsApp-style 16-second Ogg Opus note becomes a private mono WAV',async()=>{
 assert.deepEqual(await verifyVoiceDecoder(),{status:'ready'});const {readFile}=await import('node:fs/promises');const bytes=await readFile('tests/fixtures/audio/opus-16s.ogg');const audio=await normalizeVoice({id:randomUUID(),mimeType:'audio/ogg',data:bytes.toString('base64')});assert.ok(Math.abs(audio.durationSeconds-16)<.1);assert.equal(audio.audio.subarray(0,4).toString(),'RIFF');assert.equal(audio.audio.readUInt16LE(22),1);assert.equal(audio.audio.readUInt32LE(24),16000);assert.ok(audio.audio.length<=960044);
});
