// Explicit live evaluation. Run with the backend environment, without a channel sender.
// Keeps its own schema and paid ledger; never resets production budgets or orders.
import assert from 'node:assert/strict';
import {readFile, realpath} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const root=await realpath(process.argv[2]);
const phase=process.argv[3]??'baseline';
const replaySavedVoices=process.argv.includes('--replay-authorized-test-voices');
const attachedVoiceIndex=process.argv.indexOf('--replay-attached-voice');
const attachedVoicePath=attachedVoiceIndex>=0?process.argv[attachedVoiceIndex+1]:undefined;
if(phase.includes('transcribe-only'))assert.ok(attachedVoicePath,'Attached recording requires an explicit local file');
if(phase.includes('voice-only'))assert.ok(replaySavedVoices,'Recorded voices require explicit replay authorization');
assert.match(phase,/^[a-z0-9-]+$/);
const env=parseEnv(await readFile('/etc/shopbot-vps.env','utf8'));
assert.equal(env.ALLOW_PAID_INFERENCE,'true');
const pg=createRequire(root+'/package.json')('pg');
const moduleAt=path=>import(pathToFileURL(root+'/dist/'+path).href);
const {setupDatabase}=await moduleAt('apps/server/src/db/migrate.js');
const {setupImageDemo,demoCatalogStore}=await moduleAt('apps/server/src/services/demo-catalog.js');
const {SimulatorService}=await moduleAt('apps/server/src/services/simulator.js');
const {ConversationRuntime}=await moduleAt('apps/server/src/runtime/conversation.js');
const {GoogleInterpreter}=await moduleAt('apps/server/src/adapters/google-interpreter.js');
const {initializeBudget,geminiTextRate}=await moduleAt('apps/server/src/services/inference-budget.js');
const {discoverProducts}=await moduleAt('apps/server/src/services/catalog-discovery.js');
const {normalizeImage}=await moduleAt('apps/server/src/services/image-media.js');
const {normalizeVoice}=await moduleAt('apps/server/src/services/voice-media.js');
const schema='foundation_eval_20261007';
const admin=new pg.Pool({connectionString:env.DATABASE_URL,max:1});
const pool=new pg.Pool({connectionString:env.DATABASE_URL,options:`-c search_path=${schema}`,max:2});
const report={phase,schema,model:geminiTextRate.model,source:root,whatsAppSends:0,results:[]};
let locked=false;
process.chdir(root);
try{
 locked=(await admin.query("SELECT pg_try_advisory_lock(hashtext('shopbot-foundation-evaluation')) AS locked")).rows[0].locked;
 assert.ok(locked,'Another foundation evaluation is running');
 await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
 await setupDatabase(pool,'mock');await setupImageDemo(pool);
 const ctx={storeId:demoCatalogStore,conversationId:randomUUID(),actor:'synthetic-foundation-audit',role:'customer'};
 await pool.query('INSERT INTO conversations(id,store_id,actor,reply_language) VALUES($1,$2,$3,$4)',[ctx.conversationId,ctx.storeId,ctx.actor,'en']);
 // Mirror only the configured test shop's public catalog, including starter SKUs.
 const columns=(await admin.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND is_generated='NEVER' ORDER BY ordinal_position")).rows.map(x=>x.column_name);
 assert.ok(columns.every(c=>/^[a-z_]+$/.test(c)));
 await pool.query(`INSERT INTO products(${columns.join(',')}) SELECT ${columns.map(c=>c==='store_id'?'$1':c).join(',')} FROM public.products WHERE store_id=$2 ON CONFLICT(store_id,sku) DO NOTHING`,[demoCatalogStore,env.WHATSAPP_STORE_ID]);
 const catalog=(await pool.query('SELECT sku,name,family_id,image_path FROM products WHERE store_id=$1 ORDER BY sku',[ctx.storeId])).rows;
 report.catalog=catalog;console.log(JSON.stringify({phase,catalogCount:catalog.length}));
 const direct=[
  ['paint',{keywords:['paint']}],['Asian Paints',{keywords:['paint']}],
  ['Asian Paints wall paint',{keywords:['paint','wall paint']}],
  ['cutting plier',{keywords:['cutting','cutting tool']}],
  ['cutting plier',{keywords:['cutting wheel'],familyIds:['cutting-discs','saw-blades','pipe-cutters']}],
  ['wall paint',{keywords:['wall stencil'],familyId:'wall-stencils'}],
  ['PVC pipe cutter',{keywords:['PVC pipe cutter']}],
  ['paint scraper',{keywords:['paint scraper']}],['blade',{keywords:['blade','saw blade','cutting disc','putty scraper']}],
  ['pipe',{keywords:['pipe']}],['pipe',{keywords:['pipe glue','pipe clamp','PVC pipe cutter'],departmentId:'plumbing'}]
 ];
 const client=await pool.connect();
 try{for(const [directIndex,[query,plan]] of direct.entries()){const r=await discoverProducts(client,ctx,query,plan);const expected=[[],[],[],[],[],[],['H19'],['H22'],['H16','H22','H14','H15'],['H01','H02','H03','H04'],['H01','H02','H03','H04']][directIndex];const retrievalPass=JSON.stringify(r.products.map(p=>p.sku).sort())===JSON.stringify([...expected].sort());const result={kind:'retrieval',pass:retrievalPass,query,plan,products:r.products.map(p=>({sku:p.sku,name:p.name,family:p.familyId,image:p.imageUrl})),noExactMatch:r.noExactMatch,rankings:r.rankings};report.results.push(result);console.log(JSON.stringify(result));}}finally{client.release();}
 if(phase.includes('retrieval-only')){console.log(JSON.stringify({report}));process.exitCode=0;}
 else{
 const cap=5000000;await initializeBudget(pool,ctx,cap);
 const {GoogleGenAI}=createRequire(root+'/package.json')('@google/genai');
 const modelTransport=new GoogleGenAI({apiKey:env.GEMINI_API_KEY,vertexai:false,httpOptions:{apiVersion:'v1beta',retryOptions:{attempts:1}}}).models;
 let rawResponses=[],responseDiagnostics=[];
 const provider=new GoogleInterpreter({apiKey:env.GEMINI_API_KEY,model:geminiTextRate.model,allowPaidInference:true,allowMultimodal:true,budgetMicrousd:cap},{generateContent:async params=>{let result;try{result=await modelTransport.generateContent(params);}catch(error){if(error?.status===400)console.error(JSON.stringify({schemaRejection:String(error.message).replaceAll(env.GEMINI_API_KEY,'[redacted]').slice(0,2400)}));throw error;}rawResponses.push(result.candidates?.[0]?.content?.parts?.filter(p=>!p.thought).map(p=>p.text??'').join('')?.slice(0,4000));responseDiagnostics.push({model:params.model,keys:Object.keys(result),modelVersion:result.modelVersion,usage:result.usageMetadata,candidates:result.candidates?.map(c=>({keys:Object.keys(c),finishReason:c.finishReason,parts:c.content?.parts?.map(p=>({keys:Object.keys(p),text:p.text,audioTranscription:p.audioTranscription}))})),audioTranscription:result.audioTranscription});return result;}});
 const runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true,discoveryStages:false,mediaRecommendations:true,sequentialItems:true});
 report.recognitionModels=[geminiTextRate.model,provider.recognitionProvider?.billing?.model].filter(Boolean);
 report.recognitionRouting={shortUtteranceModel:geminiTextRate.model,longDictationModel:provider.recognitionProvider?.billing?.model,longerThanSeconds:8};
 if(phase.includes('transcribe-only')){
  const inbox=new SimulatorService(pool,ctx),id=randomUUID(),token=randomUUID();
  const normalized=await normalizeVoice({id,mimeType:'audio/ogg',data:(await readFile(attachedVoicePath)).toString('base64')});
  await inbox.ingest({id,type:'voice',mediaId:id},normalized);
  await pool.query("UPDATE messages SET status='processing',claim_token=$2,lease_until=now()+interval '2 minutes' WHERE id=$1 AND conversation_id=$3",[id,token,ctx.conversationId]);
  const state=(await inbox.snapshot()).conversation;
  const output=await runtime.callProvider(ctx,{id,token,state},{text:'Transcribe the attached new recording',state,audio:{mimeType:'audio/wav',data:normalized.audio.toString('base64'),durationSeconds:normalized.durationSeconds,sourceVersion:state.version}},'recognize');
  await pool.query("UPDATE messages SET status='processed',claim_token=NULL,lease_until=NULL WHERE id=$1 AND conversation_id=$2",[id,ctx.conversationId]);
  const result={kind:'recognition',name:'attached-oct8-recording',pass:!!output.transcript,transcript:output.transcript,durationSeconds:normalized.durationSeconds,...(phase.includes('diagnostic')?{responseDiagnostics}: {})};
  report.results.push(result);console.log(JSON.stringify(result));
 }
 const cases=phase.includes('transcribe-only')?[]:[
  {name:'branded-paint',language:'en',texts:['I need one Asian Paints wall paint.'],absent:true,quantity:1,identity:/asian\s+paints.*wall.*paint/i},
  {name:'cutting-plier',language:'en',texts:['I need one cutting plier.'],absent:true,quantity:1,identity:/cutting.*plier/i},
  {name:'tamil-paint',language:'ta',texts:['எனக்கு ஏசியன் பெயிண்ட்ஸ் சுவர் பெயிண்ட் வேண்டும்'],absent:true,quantity:null,identity:/asian\s+paints.*wall.*paint/i},
  {name:'tanglish-plier',language:'ta-Latn',texts:['enakku oru cutting plier venum'],absent:true,quantity:1,identity:/cutting.*plier/i},
  {name:'pipe-cutter',language:'en',texts:['I need a PVC pipe cutter'],allowed:['H19']},
  {name:'wall-stencil',language:'ta',texts:['சுவர் ஸ்டென்சில் வேண்டும்'],allowed:['H23','H24','H25']},
  {name:'four-item-corrections',language:'ta',texts:['I need two one-inch PVC pipes, one Asian Paints, two pipes and two cutters.','The second item is Asian Paints wall paint, not a stencil or scraper.','Change only that paint item to one cutting plier.'],sequential:true},
  {name:'recorded-voice-corrections',language:'ta',texts:['I need two one-inch PVC pipes, one Asian Paints, two pipes and two cutters.'],sequential:true,voices:['b1031f94-520e-4604-897f-d6c54130f012','0679568a-b856-4036-b321-167f6935f44c','374e5a53-1ad1-41c6-a850-c5d4e9fcc8a0']},
  {name:'oct8-current-list-additions',language:'ta',texts:['I need two one-inch PVC pipes, one cutting plier, two pipes and two cutters.'],sequential:true,attached:true,additions:true},
  {name:'photo-cutter',language:'ta',photo:'H19',allowed:['H19']},
  {name:'photo-blade',language:'ta',photo:'H16',allowed:['H16']}
 ];
 const correctionCase=cases.find(c=>c.name==='four-item-corrections');
 const eligibleCases=cases.filter(c=>(replaySavedVoices||!c.voices)&&(!c.attached||attachedVoicePath));
 const selectedCases=phase.includes('voice-only')?Array.from({length:phase.includes('repeated')?3:1},()=>cases.find(c=>c.voices)):phase.includes('corrections')?Array.from({length:3},()=>correctionCase):phase.includes('final')?[...eligibleCases,correctionCase,correctionCase,...(attachedVoicePath?[cases.find(c=>c.attached),cases.find(c=>c.attached)]:[]),...(replaySavedVoices?[cases.find(c=>c.voices),cases.find(c=>c.voices)]:[])]:eligibleCases;
 for(const c of selectedCases){
  const context={...ctx,conversationId:randomUUID()};
  await pool.query('INSERT INTO conversations(id,store_id,actor,reply_language) VALUES($1,$2,$3,$4)',[context.conversationId,context.storeId,context.actor,c.language]);
  const inbox=new SimulatorService(pool,context);
  let originalIds,previousDraft;
  const steps=[...(c.texts??['']).map(text=>({text})),...(c.voices??[]).map(voice=>({voice})),...(c.attached?[{attachedVoice:true}]:[])];
  for(const [stepIndex,step] of steps.entries()){
   const text=step.text??'Recorded test voice';
   rawResponses=[];
   const id=randomUUID(),started=Date.now();
   if(step.attachedVoice){
    await inbox.ingest({id,type:'voice',mediaId:id},await normalizeVoice({id,mimeType:'audio/ogg',data:(await readFile(attachedVoicePath)).toString('base64')}));
   }else if(step.voice){
    const recipients=(env.WHATSAPP_TEST_RECIPIENTS??'').split(',').map(s=>s.trim().replace(/^\+/,''));
    const saved=(await admin.query('SELECT v.audio,v.duration_seconds,v.source_hash FROM public.voice_media v JOIN public.conversations c ON c.id=v.conversation_id JOIN public.whatsapp_conversations w ON w.conversation_id=c.id WHERE v.id=$1 AND c.store_id=$2 AND w.phone_id=$3 AND w.recipient=ANY($4::text[])',[step.voice,env.WHATSAPP_STORE_ID,env.WHATSAPP_PHONE_ID,recipients])).rows[0];
    assert.ok(saved,'Authorized test recording is missing');
    await inbox.ingest({id,type:'voice',mediaId:id},{audio:saved.audio,durationSeconds:Number(saved.duration_seconds),sourceHash:saved.source_hash});
   }else if(c.photo){const image=await normalizeImage({id,mimeType:'image/jpeg',data:(await readFile(root+'/resources/catalog/ksmc-demo/images/'+c.photo+'.jpg')).toString('base64'),caption:''});await inbox.ingest({id,type:'image',mediaId:id,caption:'இந்த பொருள் வேண்டும்'},undefined,image);}
   else await inbox.ingest({id,type:'text',text});
   await runtime.processNext(context);
   const snapshot=await inbox.snapshot(),reply=snapshot.messages.at(-1)?.rich;
   const memory=(await pool.query('SELECT assistant_memory FROM conversations WHERE id=$1 AND store_id=$2 AND actor=$3',[context.conversationId,context.storeId,context.actor])).rows[0].assistant_memory;
   const retainedRequest=!c.absent||snapshot.conversation.draft.some(l=>c.identity.test(l.query??'')&&l.quantity===c.quantity)||memory?.sourceVersion===snapshot.conversation.version&&memory.purpose==='discovery'&&memory.queries.some(q=>c.identity.test(q))&&(memory.requestedQuantity??null)===c.quantity;
   const attempts=(await pool.query('SELECT provider,stage,state,billing_state,usage,estimated_cost_microusd,failure_code,validation_issues,response FROM provider_attempts WHERE message_id=$1 ORDER BY attempt',[id])).rows;
   const cards=reply?.cards?.map(c=>({sku:c.product.sku,name:c.product.name,family:c.product.familyId,image:c.product.imageUrl,request:c.requestLabel,match:c.matchLabel}))??[];
   const clearing=step.voice===c.voices?.at(-1)&&!!c.voices;
   const correction=c.sequential&&stepIndex>0;
   const unchangedOthers=!correction||snapshot.conversation.draft.every((line,index)=>index===1||JSON.stringify(line)===JSON.stringify(previousDraft[index]));
   let sequenceOkay=true;
   if(c.sequential){
    if(clearing)sequenceOkay=snapshot.conversation.draft.length===0;
    else if(stepIndex===0){const d=snapshot.conversation.draft;sequenceOkay=d.length===4&&JSON.stringify(d.map(l=>l.quantity))===JSON.stringify([2,1,2,2])&&/1 inch.*pipe/i.test(d[0].query??'')&&(c.additions?/cutting.*plier/i:/asian\s+paints/i).test(d[1].query??'')&&/pipe/i.test(d[2].query??'')&&!/inch|mm/i.test(d[2].query??'')&&/cutter/i.test(d[3].query??'');}
    else if(c.additions){
     const d=snapshot.conversation.draft,added=d.filter(line=>!originalIds.includes(line.id));
     const quantityFor=re=>d.filter(line=>re.test(line.query??'')).reduce((sum,line)=>sum+(line.quantity??0),0);
     sequenceOkay=d.length>=7&&d.length<=8&&previousDraft.slice(0,3).every((line,index)=>JSON.stringify(d[index])===JSON.stringify(line))&&d[3]?.id===originalIds[3]&&cards.length===0&&!d[1]?.sku&&d[1]?.quantity===1&&/cutting.*plier/i.test(d[1]?.query??'')&&quantityFor(/pipe/i)===6&&quantityFor(/cutter/i)===3&&quantityFor(/wrench/i)===1&&quantityFor(/wall.*sticker/i)===1&&added.every(line=>!/cutting.*plier/i.test(line.query??''));
    }
    else {const correctedQuery=snapshot.conversation.draft[1]?.query??'';const identityOkay=stepIndex===1?/asian\s+paints/i.test(correctedQuery)&&/wall.*paint|paint.*wall/i.test(correctedQuery):/cutting.*plier/i.test(correctedQuery)&&!/asian\s+paints/i.test(correctedQuery);sequenceOkay=snapshot.conversation.draft.length===4&&JSON.stringify(snapshot.conversation.draft.map(l=>l.id))===JSON.stringify(originalIds)&&unchangedOthers&&cards.length===0&&!snapshot.conversation.draft[1].sku&&snapshot.conversation.draft[1].quantity===1&&identityOkay;}
   }
   const pass=retainedRequest&&sequenceOkay&&attempts.length>0&&attempts.every(a=>a.state==='succeeded')&&(c.absent?cards.length===0:c.allowed?cards.length>0&&cards.every(p=>c.allowed.includes(p.sku)):true)&&snapshot.requests.length===0;
   const result={kind:'live',name:c.name,retainedRequest,memory,text:snapshot.messages.find(m=>m.id===id)?.text??text,pass,elapsedMs:Date.now()-started,reply:reply?.text,cards,draft:snapshot.conversation.draft,pending:snapshot.conversation.pending?.kind,attempts,requestCount:snapshot.requests.length,...(!pass?{rawResponses}:{})};
   report.results.push(result);console.log(JSON.stringify(result));
   if(c.sequential&&stepIndex===0){
    assert.equal(snapshot.conversation.draft.length,4);
    const card=reply?.cards?.find(card=>card.product.sku==='H02');assert.ok(card?.action,'One-inch Blueguard choice must be shown');
    await inbox.ingest(card.action);await runtime.processNext(context);
    const accepted=await inbox.snapshot();assert.equal(accepted.conversation.draft[0].sku,'H02');assert.ok(accepted.conversation.draft[0].productConfirmation);
    originalIds=accepted.conversation.draft.map(l=>l.id);previousDraft=accepted.conversation.draft;
    const selected={kind:'action',name:c.name,action:'accept-first-photo',pass:true,cards:accepted.messages.at(-1)?.rich?.cards?.map(c=>c.product.sku)??[],activeLine:accepted.conversation.pending?.lineId,draft:accepted.conversation.draft};
    report.results.push(selected);console.log(JSON.stringify(selected));
   }else if(c.sequential&&!clearing)previousDraft=snapshot.conversation.draft;
   if(c.sequential&&!c.voices&&!c.additions&&stepIndex===steps.length-1&&pass){
    const next=reply?.buttons?.find(b=>b.event.type==='shopping_action'&&b.event.action==='next_item');assert.ok(next,'Absent item must have a next-item choice');
    const before=snapshot.conversation,quantities=before.draft.map(l=>l.quantity),attemptCount=(await pool.query('SELECT count(*)::int AS n FROM provider_attempts WHERE conversation_id=$1',[context.conversationId])).rows[0].n;
    await inbox.ingest(next.event);await runtime.processNext(context);
    let progress=await inbox.snapshot();assert.ok(progress.conversation.draft[1].shopCheckDeferred);assert.equal(progress.requests.length,0);
    const pipeCards=progress.messages.at(-1)?.rich?.cards??[];
    assert.ok(pipeCards.length>0&&pipeCards.every(c=>c.product.familyId==='pvc-pipes'),'Later pipe choices must contain pipes, never glue or cutters');
    let checked=0;
    while(progress.conversation.pending?.kind==='products'&&checked<3){
     const card=progress.messages.at(-1)?.rich?.cards?.[0];assert.ok(card?.action);
     await inbox.ingest(card.action);await runtime.processNext(context);progress=await inbox.snapshot();checked++;
    }
    const nextPass=checked===2&&progress.conversation.pending?.kind==='question'&&progress.conversation.pending.lineId===originalIds[1]&&progress.conversation.draft.filter((_,index)=>index!==1).every(l=>l.productConfirmation)&&JSON.stringify(progress.conversation.draft.map(l=>l.id))===JSON.stringify(originalIds)&&JSON.stringify(progress.conversation.draft.map(l=>l.quantity))===JSON.stringify(quantities)&&progress.requests.length===0;
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM provider_attempts WHERE conversation_id=$1',[context.conversationId])).rows[0].n,attemptCount);
    const result={kind:'action',name:c.name,action:'defer-absent-and-check-two-later-items',pass:nextPass,checkedLaterItems:checked,draft:progress.conversation.draft,pending:progress.conversation.pending?.kind,requestCount:progress.requests.length};report.results.push(result);console.log(JSON.stringify(result));
   }
   if(clearing){
    const saved=(await pool.query('SELECT audio,duration_seconds,source_hash FROM voice_media WHERE id=$1',[id])).rows[0];
    const duplicate=await inbox.ingest({id,type:'voice',mediaId:id},{audio:saved.audio,durationSeconds:Number(saved.duration_seconds),sourceHash:saved.source_hash});
    assert.equal(duplicate.duplicate,true);assert.equal(await runtime.processNext(context),false);
   }
   if(attempts.some(a=>a.failure_code==='provider_http_429'))throw new Error('provider-rate-limit');
   if(attempts.some(a=>a.failure_code==='provider_http_400'))throw new Error('provider-schema-rejected');
  }
 }
 report.budget=(await pool.query('SELECT limit_microusd,committed_microusd,held_microusd,blocked FROM inference_budgets WHERE store_id=$1',[ctx.storeId])).rows[0];
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM whatsapp_outbox')).rows[0].n,0);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_requests')).rows[0].n,0);
 report.pass=report.results.every(r=>r.pass!==false);console.log(JSON.stringify({report}));if(!report.pass)process.exitCode=1;
 }
}catch(error){console.error(JSON.stringify({failed:true,name:error?.name,code:typeof error?.code==='string'?error.code:'evaluation_error'}));process.exitCode=1;}
finally{await pool.end();if(locked)await admin.query("SELECT pg_advisory_unlock(hashtext('shopbot-foundation-evaluation'))");await admin.end();}
