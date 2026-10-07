import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo} from '../apps/server/src/services/demo-catalog.js';
import {WhatsAppChannel,webhookSchema} from '../apps/server/src/services/whatsapp-channel.js';
import {createApp} from '../apps/server/src/http/app.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import {geminiTextRate} from '../apps/server/src/services/inference-budget.js';
import {GoogleInterpreter} from '../apps/server/src/adapters/google-interpreter.js';
import {fixtureStore} from '../profiles/hardware.js';
import type {Interpreter,InterpretationInput} from '../apps/server/src/adapters/interpreter.js';
import type {WhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';
import type {GenerateContentResponse} from '@google/genai';
import {readFile} from 'node:fs/promises';
import {downloadWhatsAppMedia,mediaFailureCode} from '../apps/server/src/services/whatsapp-media.js';
import {pcmWav} from '../apps/server/src/services/voice-media.js';
import {readWhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';

const cfg:WhatsAppConfig={hostname:'api.example.test',storeId:fixtureStore,appId:'123456789',wabaId:'987654321',phoneId:'123987654',appSecret:'offline-only-secret',verifyToken:'offline-only-verify',accessToken:'offline-only-token',graphVersion:'v25.0',recipients:['919000000001'],defaultReplyLanguage:'en',processEnabled:true,sendEnabled:true};
async function fixture(run:(pool:pg.Pool,channel:WhatsAppChannel,sent:any[])=>Promise<void>){
 const schema='customer_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.DATABASE_URL});await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`}),sent:any[]=[];
 try{await setupDatabase(pool,'mock');await setupImageDemo(pool,fixtureStore);const channel=new WhatsAppChannel(pool,cfg,async(_url,init)=>{sent.push(JSON.parse(String(init!.body)));return new Response(JSON.stringify({messages:[{id:'wamid.reply.'+sent.length}]}),{status:200});});await channel.setup();await run(pool,channel,sent);}
 finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
function inbound(body:object){return webhookSchema.parse({object:'whatsapp_business_account',entry:[{id:cfg.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:cfg.phoneId},messages:[{id:'wamid.'+randomUUID(),from:cfg.recipients[0],timestamp:String(Math.floor(Date.now()/1000)),...body}]}}]}]});}
async function turn(channel:WhatsAppChannel,body:object){await channel.receive(inbound(body));await channel.processNext();await channel.sendNext();}
async function action(pool:pg.Pool,type:string,extra?:string){return (await pool.query(`SELECT a.*,o.provider_id FROM whatsapp_actions a JOIN whatsapp_outbox o ON o.message_id=a.message_id WHERE a.event->>'type'=$1 AND ($2::text IS NULL OR a.event->>'action'=$2) ORDER BY o.created_at DESC LIMIT 1`,[type,extra??null])).rows[0];}
const tap=(a:any)=>({type:'interactive',context:{id:a.provider_id},interactive:{type:'button_reply',button_reply:{id:a.id,title:'ignored title'}}});

test('a clear two-item request takes two confirmation taps; new list preserves the old submitted snapshot',async()=>fixture(async(pool,channel)=>{
 await turn(channel,{type:'text',text:{body:'2 H05 and 1 H08'}});const all=await action(pool,'confirm_products');assert.ok(all);assert.equal(all.label,'All correct');
 await turn(channel,tap(all));const confirm=await action(pool,'confirm');assert.ok(confirm);assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,0);
 const kept=await action(pool,'shopping_action','keep_list');assert.ok(kept);
 await turn(channel,tap(confirm));const submitted=(await pool.query('SELECT * FROM order_requests')).rows[0];assert.deepEqual(submitted.lines.map((l:any)=>l.quantity),[2,1]);
 const next=await action(pool,'shopping_action','new_list');assert.ok(next);await turn(channel,tap(next));
 assert.equal((await pool.query('SELECT draft FROM conversations WHERE id=$1',[next.conversation_id])).rows[0].draft.length,0);
 assert.deepEqual((await pool.query('SELECT lines FROM order_requests WHERE id=$1',[submitted.id])).rows[0].lines,submitted.lines);
 await turn(channel,tap(confirm));assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,1);
}));
test('targeted quantity edits retain every other item, and keeping the list invalidates old consent',async()=>fixture(async(pool,channel)=>{
 await turn(channel,{type:'text',text:{body:'2 H05 and 1 H08'}});await turn(channel,tap(await action(pool,'confirm_products')));
 const old=await action(pool,'confirm');await turn(channel,tap(await action(pool,'shopping_action','edit_list')));
 const item=(await pool.query(`SELECT a.*,o.provider_id FROM whatsapp_actions a JOIN whatsapp_outbox o ON o.message_id=a.message_id WHERE a.event->>'type'='edit_item' ORDER BY o.created_at DESC,a.label LIMIT 1`)).rows[0];assert.ok(item);await turn(channel,tap(item));
 await turn(channel,{type:'text',text:{body:'3'}});const state=(await pool.query('SELECT draft FROM conversations WHERE id=$1',[item.conversation_id])).rows[0];assert.deepEqual(state.draft.map((l:any)=>l.quantity),[3,1]);
 await turn(channel,tap(old));assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,0);
 await turn(channel,tap(await action(pool,'shopping_action','keep_list')));assert.equal((await pool.query('SELECT draft FROM conversations WHERE id=$1',[item.conversation_id])).rows[0].draft.length,2);
}));
test('handoff pauses AI, cancels assistant work, and authenticated owner replies are idempotent and window-bound',async()=>fixture(async(pool,channel,sent)=>{
 await turn(channel,{type:'text',text:{body:'hello'}});await turn(channel,tap(await action(pool,'shopping_action','handoff')));
 const c=(await pool.query('SELECT * FROM conversations WHERE id IN (SELECT conversation_id FROM whatsapp_conversations)')).rows[0];assert.equal(c.operator_mode,'owner');assert.equal(c.handoff_requested,true);assert.match(sent.at(-1).text.body,/asked the shop/);
 await channel.receive(inbound({type:'text',text:{body:'Could you check this size?'}}));assert.equal(await channel.processNext(),false);
 const owner={hostname:'owner.example.test',issuer:'https://test.cloudflareaccess.com',audience:'offline-audience',email:'owner@example.test',storeId:fixtureStore};
 const app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/offline-media',owner,whatsapp:cfg},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline-owner'}),channel);
 try{const headers={host:owner.hostname,'cf-access-jwt-assertion':'offline-owner',origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json'},payload={id:randomUUID(),text:'Let me check the size for you.',revision:c.operator_revision},url='/api/owner/conversations/'+c.id+'/reply';
  assert.equal((await app.inject({method:'POST',url,headers,payload})).statusCode,200);assert.equal((await app.inject({method:'POST',url,headers,payload})).statusCode,200);
  assert.equal((await pool.query("SELECT * FROM whatsapp_outbox WHERE sender_kind='owner'")).rowCount,1);await channel.sendNext();assert.equal(sent.at(-1).text.body,payload.text);
  await pool.query("UPDATE whatsapp_conversations SET last_inbound_at=now()-interval '25 hours'");assert.equal((await app.inject({method:'POST',url,headers,payload:{...payload,id:randomUUID()}})).statusCode,409);
  assert.equal((await pool.query('SELECT * FROM provider_attempts')).rowCount,0);
 }finally{await app.close();}
}));
test('a second planning stage sees fresh results, cannot add items or change amounts, and is cached independently',async()=>fixture(async(pool)=>{
 let calls=0;const provider:Interpreter={name:'two-stage-offline',mode:'mock',interpret:async input=>{
  calls++;if(input.stage==='recommend'){assert.ok(input.observations?.some(o=>o.products.some(p=>p.sku==='H19')));return {output:{operations:[],next:'assist',assistance:{queries:['H19'],quantity:99,question:'What pipe diameter will you cut?',search:{keywords:['cutter'],preferredSkus:['H19','INVENTED']}}},truncated:false,usage:null};}
  return {output:{operations:[],next:'assist',assistance:{queries:['PVC pipe cutter'],quantity:2}},truncated:false,usage:null};
 }};
 const inbox=new SimulatorService(pool),runtime=new ConversationRuntime(pool,provider,{discoveryStages:true});await inbox.ingest({id:randomUUID(),type:'text',text:'Show tools for cutting PVC pipe'});await runtime.processNext(simulatorContext);
 assert.equal(calls,2);assert.equal((await inbox.snapshot()).conversation.draft.length,0);const memory=(await pool.query('SELECT assistant_memory FROM conversations WHERE id=$1',[simulatorContext.conversationId])).rows[0].assistant_memory;assert.equal(memory.requestedQuantity,2);
 assert.deepEqual((await pool.query('SELECT stage FROM provider_attempts ORDER BY attempt')).rows.map(r=>r.stage),['identify','recommend']);
}));
test('recommendation spacing releases the lease and resumes from cached identification without a third call',async()=>fixture(async(pool)=>{
 let calls=0;const provider:Interpreter={name:'free-staged-offline',mode:'live',billing:geminiTextRate,freeQuota:{scope:'offline-'+randomUUID(),model:geminiTextRate.model},interpret:async input=>{calls++;return {output:{operations:[],next:'assist',assistance:{queries:['PVC pipe cutter'],search:{keywords:['cutter'],preferredSkus:['H19']}}},truncated:false,responseModel:geminiTextRate.model,usage:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20}};}};
 const inbox=new SimulatorService(pool),runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});const id=randomUUID();await inbox.ingest({id,type:'text',text:'Show a tool to cut PVC pipe'});await runtime.processNext(simulatorContext);assert.equal(calls,1);
 assert.equal((await pool.query('SELECT status FROM messages WHERE id=$1',[id])).rows[0].status,'pending');assert.equal((await inbox.snapshot()).messages.filter(m=>m.direction==='outbound').length,0);
 await pool.query("UPDATE provider_attempts SET created_at=now()-interval '7 seconds'");await pool.query('UPDATE messages SET not_before=now() WHERE id=$1',[id]);await runtime.processNext(simulatorContext);assert.equal(calls,2);assert.equal((await inbox.snapshot()).pending,0);
}));
test('the native recommendation schema is compact and filters invented product identifiers',async()=>{
 const provider=new GoogleInterpreter({apiKey:'offline-key',model:geminiTextRate.model,allowPaidInference:true,budgetMicrousd:1}, {generateContent:async params=>{assert.ok(params.config?.responseJsonSchema);return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({skus:['MISSING'],question:null})}]}}]} as GenerateContentResponse;}});
 const output=await provider.interpret({stage:'recommend',proposal:{operations:[],next:'assist',assistance:{queries:['cutter'],quantity:2}},text:'pipe cutter',state:{version:0,draft:[],pending:null,fulfillment:'pickup',lastRequestId:null},observations:[]},new AbortController().signal);
 assert.deepEqual((output.output as any).assistance.search.preferredSkus,[]);assert.equal((output.output as any).assistance.quantity,2);
});
test('media recommendation enablement requires the channel, media and AI gates',()=>{
 assert.throws(()=>readWhatsAppConfig({WHATSAPP_MEDIA_RECOMMENDATION_ENABLED:'true'}),/channel enablement/);
 assert.throws(()=>readWhatsAppConfig({WHATSAPP_ENABLED:'true',WHATSAPP_MEDIA_RECOMMENDATION_ENABLED:'true'}),/media and AI/);
});
test('opt-in voice recommendations use fresh facts, ask above photos, preserve quantity and stop inference on a product tap',async()=>fixture(async(pool)=>{
 const pcm=Buffer.alloc(32000);for(let i=0;i<16000;i++)pcm.writeInt16LE(Math.round(1000*Math.sin(i/10)),i*2);const wav=pcmWav(pcm);let calls=0;
 const provider=new GoogleInterpreter({apiKey:'offline',model:geminiTextRate.model,allowPaidInference:true,allowMultimodal:true,budgetMicrousd:1000000},{generateContent:async params=>{
  calls++;const recommendation=!!params.config?.responseJsonSchema;
  if(recommendation){
   const context=JSON.parse(params.contents as string);assert.ok(!JSON.stringify(context).includes('inlineData'));assert.match(JSON.stringify(context),/H19/);assert.match(JSON.stringify(context),/பைப் கட்டர்/);
   assert.match(String(params.config?.systemInstruction),/Do not re-ask/);
  }else {assert.match(JSON.stringify(params.contents),/audio\/wav/);assert.equal(params.config?.httpOptions?.timeout,19000);}
  return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(recommendation?{skus:['H19','INVENTED'],question:'எந்த அளவு பைப் வெட்ட வேண்டும்?'}:{transcript:'எனக்கு இரண்டு பைப் கட்டர் வேண்டும்',operations:[{kind:'add_item',query:'PVC pipe cutter',quantity:2}],next:'review'})}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:100,totalTokenCount:1100}} as GenerateContentResponse;
 }});
 const channel=new WhatsAppChannel(pool,{...cfg,defaultReplyLanguage:'ta',aiEnabled:true,paidEnabled:true,budgetMicrousd:1000000,mediaEnabled:true,mediaRecommendations:true,discoveryStages:false},async url=>String(url).includes('graph.facebook.com')?new Response(JSON.stringify({url:'https://lookaside.fbsbx.com/voice',mime_type:'audio/wav',file_size:wav.length})):new Response(JSON.stringify({messages:[{id:'wamid.offline-media-recommendation'}]})),provider);
 await channel.setup();const id=randomUUID(),inbox=new SimulatorService(pool),runtime=new ConversationRuntime(pool,provider,{allowPaidInference:true,mediaRecommendations:true,discoveryStages:false});
 await inbox.ingest({id,type:'voice',mediaId:id},{audio:wav,durationSeconds:1,sourceHash:'offline-voice-recommendation'});await pool.query("UPDATE conversations SET reply_language='ta' WHERE id=$1",[simulatorContext.conversationId]);await runtime.processNext(simulatorContext);
 const snapshot=await inbox.snapshot(),rich=snapshot.messages.at(-1)!.rich!;
 assert.equal(calls,2);assert.equal(snapshot.conversation.draft.length,0);assert.equal(snapshot.requests.length,0);assert.ok(rich.text.startsWith('எந்த அளவு பைப் வெட்ட வேண்டும்?\n'));assert.deepEqual(rich.cards?.map(c=>c.product.sku),['H19']);assert.match(rich.cards![0].quantityLabel!,/2/);
 await inbox.ingest(rich.cards![0].action!);await runtime.processNext(simulatorContext);
 assert.equal(calls,2);assert.equal((await inbox.snapshot()).conversation.draft[0].quantity,2);
 assert.deepEqual((await pool.query('SELECT stage FROM provider_attempts ORDER BY attempt')).rows.map(r=>r.stage),['identify','recommend']);
}));
test('a failed voice attachment offers bound browse and handoff buttons without claiming recognition or spending',async()=>fixture(async(pool)=>{
 const provider:Interpreter={name:'offline-unreadable-voice',mode:'live',billing:geminiTextRate,supportsAudio:true,interpret:async()=>{throw new Error('Must not call AI for undecoded media');}};
 const channel=new WhatsAppChannel(pool,{...cfg,defaultReplyLanguage:'ta',aiEnabled:true,paidEnabled:true,budgetMicrousd:500000,mediaEnabled:true,mediaRecommendations:true},async()=>new Response('{}',{status:404}),provider);await channel.setup();
 await channel.receive(inbound({type:'audio',audio:{id:'123456'}}));await channel.processNext();
 const reply=(await pool.query("SELECT text,payload FROM messages WHERE direction='outbound' ORDER BY sequence DESC LIMIT 1")).rows[0];assert.match(reply.text,/குரல் பதிவைத் திறக்க முடியவில்லை/);assert.equal(reply.text.split('\n').length,1);assert.equal(reply.payload.cards?.length??0,0);
 assert.ok(await action(pool,'shopping_action','browse'));assert.ok(await action(pool,'shopping_action','handoff'));assert.equal((await pool.query('SELECT * FROM provider_attempts')).rowCount,0);
}));
test('provider rejection codes are diagnosable without saving secrets or retrying the request',async()=>fixture(async(pool)=>{
 let calls=0;const provider:Interpreter={name:'offline-api-error',mode:'live',billing:geminiTextRate,freeQuota:{scope:randomUUID(),model:geminiTextRate.model},interpret:async()=>{calls++;throw Object.assign(new Error('Private URL and credential details must not be persisted'),{status:503});}};
 const inbox=new SimulatorService(pool);await inbox.ingest({id:randomUUID(),type:'text',text:'Find a pipe cutter'});await new ConversationRuntime(pool,provider,{allowFreeInference:true,discoveryStages:false}).processNext(simulatorContext);
 assert.equal(calls,1);assert.equal((await pool.query('SELECT failure_code FROM provider_attempts')).rows[0].failure_code,'provider_http_503');assert.ok(!(await inbox.snapshot()).messages.at(-1)!.text.includes('Private URL'));
}));
test('media downloads stay on verified HTTPS hosts and normalized audio/photo bytes remain private',async()=>{
 const jpeg=await readFile('resources/catalog/ksmc-demo/images/H19.jpg');
 const pcm=Buffer.alloc(32000);for(let n=0;n<16000;n++)pcm.writeInt16LE(Math.round(1000*Math.sin(n/10)),n*2);const wav=pcmWav(pcm);
 for(const [kind,bytes,mime] of [['image',jpeg,'image/jpeg'],['voice',wav,'audio/wav']] as const){
  let calls=0;const media=await downloadWhatsAppMedia(cfg,async(url,init)=>{calls++;assert.equal(init?.redirect,'error');return String(url).includes('graph.facebook.com')?new Response(JSON.stringify({url:'https://lookaside.fbsbx.com/offline-media',mime_type:mime,file_size:bytes.length})):new Response(new Uint8Array(bytes));},'123456',kind,randomUUID());
  assert.equal(calls,2);assert.ok('image' in media||'audio' in media);
 }
 let calls=0;await assert.rejects(downloadWhatsAppMedia(cfg,async()=>{calls++;return new Response(JSON.stringify({url:'http://127.0.0.1/private',mime_type:'image/jpeg',file_size:20}));},'123456','image',randomUUID()),/Untrusted/);assert.equal(calls,1);
 await assert.rejects(downloadWhatsAppMedia(cfg,async()=>new Response(JSON.stringify({url:'https://lookaside.fbsbx.com/photo',mime_type:'image/jpeg',file_size:2097153})),'123456','image',randomUUID()),/too large/);
});
test('WhatsApp photos are durably ingested before download and a replay does not refetch or infer twice',async()=>fixture(async(pool)=>{
 let downloads=0,calls=0;const jpeg=await readFile('resources/catalog/ksmc-demo/images/H19.jpg');
 const provider:Interpreter={name:'offline-photo',mode:'live',billing:geminiTextRate,supportsImages:true,freeQuota:{scope:'photo-'+randomUUID(),model:geminiTextRate.model},interpret:async input=>{calls++;assert.ok(input.image?.data);return {output:{operations:[],next:'assist',assistance:{queries:['H19']}},truncated:false,responseModel:geminiTextRate.model,usage:{promptTokenCount:10,candidatesTokenCount:10,totalTokenCount:20}};}};
 const channel=new WhatsAppChannel(pool,{...cfg,aiEnabled:true,mediaEnabled:true},async(url)=>{downloads++;return String(url).includes('graph.facebook.com')?new Response(JSON.stringify({url:'https://lookaside.fbsbx.com/photo',mime_type:'image/jpeg',file_size:jpeg.length})):new Response(new Uint8Array(jpeg));},provider);
 const payload=inbound({type:'image',image:{id:'123456',caption:'Which cutter is this?'}});await channel.receive(payload);assert.equal(downloads,0);await channel.processNext();await channel.receive(payload);assert.equal(await channel.processNext(),false);
 assert.equal(downloads,2);assert.equal(calls,1);assert.equal((await pool.query('SELECT * FROM image_media')).rowCount,1);assert.equal((await pool.query('SELECT state FROM whatsapp_media')).rows[0].state,'ready');
}));
test('media retries transient downloads once without retrying permission errors or unsafe files',async()=>{
 const bytes=await readFile('resources/catalog/ksmc-demo/images/H19.jpg');
 for(const failure of ['network','server'] as const){
  let calls=0;
  const media=await downloadWhatsAppMedia(cfg,async(url)=>{
   calls++;
   if(calls===1){if(failure==='network')throw new TypeError('Connection interrupted');return new Response('unavailable',{status:503});}
   return String(url).includes('graph.facebook.com')?new Response(JSON.stringify({url:'https://lookaside.fbsbx.com/photo',mime_type:'image/jpeg',file_size:bytes.length})):new Response(new Uint8Array(bytes));
  },'123456','image',randomUUID());
  assert.ok('image' in media);assert.equal(calls,3);
 }
 for(const status of [401,403,404,429,503]){
  let calls=0;
  await assert.rejects(downloadWhatsAppMedia(cfg,async()=>{calls++;return new Response('failed',{status});},'123456','image',randomUUID()),error=>{assert.equal(mediaFailureCode(error),`media_http_${status}`);return true;});
  assert.equal(calls,status===503?2:1);
 }
 let calls=0;
 await assert.rejects(downloadWhatsAppMedia(cfg,async()=>{calls++;throw new TypeError('private connection detail');},'123456','voice',randomUUID()),error=>{assert.equal(mediaFailureCode(error),'media_network_failed');return true;});
 assert.equal(calls,2);
});
test('voice requests require an audible transcript in the explicit contract and retain strict operations',async()=>{
 let calls=0;
 const provider=new GoogleInterpreter({apiKey:'offline-key',model:geminiTextRate.model,allowPaidInference:true,budgetMicrousd:100000,allowMultimodal:true},{generateContent:async params=>{
  calls++;
  assert.equal(params.config!.responseJsonSchema,undefined);
  assert.match(String(params.config!.systemInstruction),/actual audible customer speech/);
  assert.match(String(params.config!.systemInstruction),/REQUIRED top-level transcript/);
  assert.match(String(params.config!.systemInstruction),/wood saw, not hacksaw blade/);
  const context=JSON.parse((params.contents as any)[0].parts[0].text);
  assert.equal(context.storeCatalogMap,null);assert.deepEqual(context.publicCatalog,[]);assert.deepEqual(context.toolObservations,[]);
  return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({transcript:'ரெண்டு பைப் கட்டர் வேணும்',operations:[{kind:'add_item',query:'PVC pipe cutter',quantity:2}],next:'review'})}]}}]} as GenerateContentResponse;
 }});
 const output=await provider.interpret({text:'Recorded customer voice note',audio:{mimeType:'audio/wav',data:'AAAA',durationSeconds:1},catalogMap:{store:{name:'Offline catalog',type:'hardware'},productCount:1,departments:[{id:'tools',label:'Tools',count:1,families:[{id:'saw-blades',label:'Hacksaw blades',aliases:['hacksaw'],count:1}]}],truncated:false},state:{version:0,draft:[],pending:null,fulfillment:'pickup',lastRequestId:null}},new AbortController().signal);
 assert.equal(calls,1);assert.equal((output.output as any).transcript,'ரெண்டு பைப் கட்டர் வேணும்');
 assert.deepEqual((output.output as any).operations,[{kind:'add_item',query:'PVC pipe cutter',quantity:2}]);
});
test('submitted orders are hidden from new intent while current discovery memory is retained',async()=>{
 const lineId=randomUUID();
 const input:InterpretationInput={text:'Recorded customer voice note',audio:{mimeType:'audio/wav',data:'AAAA',durationSeconds:1},state:{version:9,draft:[{id:lineId,query:'old blade',quantity:77,name:'Old blade',resolution:'matched'}],pending:{kind:'question',id:randomUUID(),lineId,version:9},editingLineId:lineId,fulfillment:'pickup',lastRequestId:randomUUID()},assistantMemory:{id:randomUUID(),purpose:'pending',queries:['old blade'],lineId,sourceVersion:9,requestedQuantity:77,observations:[]}};
 const original=structuredClone(input);let calls=0;
 const provider=new GoogleInterpreter({apiKey:'offline',model:geminiTextRate.model,allowPaidInference:true,allowMultimodal:true,budgetMicrousd:100000},{generateContent:async params=>{
  calls++;const context=JSON.parse((params.contents as any)[0].parts[0].text);
  assert.equal(context.submittedRequest,true);assert.deepEqual(context.currentDraft,[]);assert.equal(context.pendingQuestion,null);assert.equal(context.pendingProductCheck,null);assert.equal(context.editingLineId,null);assert.ok(!JSON.stringify(context).includes(lineId));
  assert.match(String(params.config!.systemInstruction),/previous request is immutable/);
  if(calls===1)assert.equal(context.assistantMemory,null);
  else{assert.equal(context.assistantMemory.purpose,'discovery');assert.equal(context.assistantMemory.requestedQuantity,1);assert.deepEqual(context.assistantMemory.queries,['metal cutting blade']);}
  return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({transcript:'எனக்கு ஒரு பிளேடு வேணும்',operations:[],next:'assist',assistance:{queries:['metal cutting blade'],quantity:1}})}]}}]} as GenerateContentResponse;
 }});
 await provider.interpret(input,new AbortController().signal);assert.deepEqual(input,original);
 await provider.interpret({...input,assistantMemory:{...input.assistantMemory!,purpose:'discovery',queries:['metal cutting blade'],lineId:null,requestedQuantity:1}},new AbortController().signal);
 assert.equal(calls,2);
});
test('only mislabeled read-only assistance is normalized; mixed write and price proposals stay invalid',async()=>{
 const replies=[{operations:[],next:'review',assistance:{queries:['blade'],quantity:1},assistanceSearch:{keywords:['metal cutting blade']}},{operations:[{kind:'add_item',query:'blade',quantity:1}],next:'review',assistance:{queries:['blade']}},{operations:[],next:'continue',assistance:{queries:['blade']},conversation:'greeting'},{operations:[],next:'review',assistance:{queries:['blade']},priceQuery:'blade'}];
 let index=0;
 const provider=new GoogleInterpreter({apiKey:'offline',model:geminiTextRate.model,allowPaidInference:true,budgetMicrousd:100000},{generateContent:async()=>({modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(replies[index++])}]}}]}) as GenerateContentResponse});
 const input:InterpretationInput={text:'blade',state:{version:0,draft:[],pending:null,fulfillment:'pickup',lastRequestId:null}};
 const valid=await provider.interpret(input,new AbortController().signal);assert.equal(valid.validationIssues,undefined);assert.equal((valid.output as any).next,'assist');assert.deepEqual((valid.output as any).operations,[]);assert.equal((valid.output as any).assistance.quantity,1);assert.deepEqual((valid.output as any).assistance.search.keywords,['metal cutting blade']);
 for(let n=0;n<3;n++){const invalid=await provider.interpret(input,new AbortController().signal);assert.ok(invalid.validationIssues?.length);assert.notEqual((invalid.output as any).next,'assist');}
});
test('submitted photo and recommendation requests retain their own dedicated contracts',async()=>{
 const input:InterpretationInput={text:'item photo',image:{mimeType:'image/jpeg',data:'AAAA'},state:{version:1,draft:[],pending:null,fulfillment:'pickup',lastRequestId:randomUUID()}};
 const provider=new GoogleInterpreter({apiKey:'offline',model:geminiTextRate.model,allowPaidInference:true,allowMultimodal:true,budgetMicrousd:100000},{generateContent:async params=>{
  assert.doesNotMatch(String(params.config!.systemInstruction),/previous request is immutable/);
  return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(input.image?{query:'pipe cutter',keywords:['pipe cutter'],specificationFilters:null}:{skus:[],question:null})}]}}]} as GenerateContentResponse;
 }});
 assert.equal((await provider.interpret(input,new AbortController().signal)).validationIssues,undefined);
 delete input.image;input.stage='recommend';input.proposal={operations:[],next:'assist',assistance:{queries:['pipe cutter']}};
 assert.equal((await provider.interpret(input,new AbortController().signal)).validationIssues,undefined);
});
test('media decoding failures retain safe actionable codes without leaking source details',()=>{
 assert.equal(mediaFailureCode(new Error('Audio could not be decoded in time.')),'media_decode_timeout');
 assert.equal(mediaFailureCode(new Error('Audio decoder is unavailable.')),'media_decoder_unavailable');
 assert.equal(mediaFailureCode(new Error('Recording must be between 0.2 and 30 seconds.')),'media_duration_invalid');
 assert.equal(mediaFailureCode(new Error('We could not hear speech.')),'media_silent');
 assert.equal(mediaFailureCode(new Error('private path or URL')),'media_decode_failed');
});
test('a text reply quoted to an old review cannot confirm the newer review',async()=>fixture(async(pool,channel)=>{
 await turn(channel,{type:'text',text:{body:'2 H05 and 1 H08'}});await turn(channel,tap(await action(pool,'confirm_products')));const old=await action(pool,'confirm');
 await turn(channel,{type:'text',text:{body:'change H05 to 3'}});
 await turn(channel,{type:'text',text:{body:'yes'},context:{id:old.provider_id}});assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,0);
 const latest=(await pool.query("SELECT text FROM messages WHERE direction='outbound' ORDER BY sequence DESC LIMIT 1")).rows[0];assert.match(latest.text,/expired/);
}));
test('request status reflects the shop decision without treating it as payment or fulfillment',async()=>fixture(async(pool,channel)=>{
 await turn(channel,{type:'text',text:{body:'2 H05'}});await turn(channel,tap(await action(pool,'confirm_products')));await turn(channel,tap(await action(pool,'confirm')));
 await pool.query("UPDATE order_requests SET acceptance='accepted'");await turn(channel,tap(await action(pool,'shopping_action','status')));
 const latest=(await pool.query("SELECT text FROM messages WHERE direction='outbound' ORDER BY sequence DESC LIMIT 1")).rows[0];assert.match(latest.text,/accepted/);assert.match(latest.text,/Payment and pickup readiness still need separate confirmation/);
}));
test('disabled media never downloads attachments even when the provider supports them',async()=>fixture(async(pool)=>{
 let downloads=0;const provider:Interpreter={name:'offline-disabled-photo',mode:'live',billing:geminiTextRate,supportsImages:true,freeQuota:{scope:'disabled-'+randomUUID(),model:geminiTextRate.model},interpret:async()=>{throw new Error('No inference expected');}};
 const channel=new WhatsAppChannel(pool,{...cfg,aiEnabled:true},async()=>{downloads++;throw new Error('No download expected');},provider);
 await channel.receive(inbound({type:'image',image:{id:'123456',caption:'An item'}}));await channel.processNext();assert.equal(downloads,0);assert.equal((await pool.query('SELECT * FROM whatsapp_media')).rowCount,0);
}));
test('new WhatsApp chats default to Tamil and explicit Tanglish persists without another AI call',async()=>fixture(async(pool)=>{
 const sent:any[]=[];const channel=new WhatsAppChannel(pool,{...cfg,defaultReplyLanguage:undefined},async(_url,init)=>{sent.push(JSON.parse(String(init!.body)));return new Response(JSON.stringify({messages:[{id:'wamid.tamil.'+sent.length}]}));});
 await turn(channel,{type:'text',text:{body:'hello'}});assert.equal((await pool.query('SELECT reply_language FROM conversations WHERE actor LIKE $1',[ 'whatsapp:%'])).rows[0].reply_language,'ta');assert.match(sent.at(-1).interactive.body.text,/வணக்கம்/);
 await turn(channel,{type:'text',text:{body:'Tanglish la sollunga'}});assert.equal((await pool.query('SELECT reply_language FROM conversations WHERE actor LIKE $1',['whatsapp:%'])).rows[0].reply_language,'ta-Latn');assert.equal((await pool.query('SELECT * FROM provider_attempts')).rowCount,0);
}));

test('product carousels expose a bound menu for batch filters, editing and shop help without AI',async()=>fixture(async(pool,channel,sent)=>{
 await turn(channel,{type:'text',text:{body:'2 blade'}});
 const menu=await action(pool,'shopping_action','options');assert.ok(menu);
 const payload=sent.at(-1).interactive;assert.equal(payload.type,'carousel');
 assert.ok(payload.action.cards.every((c:any)=>c.action.buttons.length===2));
 await turn(channel,tap(menu));assert.equal(sent.at(-1).interactive.type,'list');
 assert.ok(await action(pool,'refine_search'));assert.ok(await action(pool,'shopping_action','edit_list'));assert.ok(await action(pool,'shopping_action','handoff'));
 assert.equal((await pool.query('SELECT * FROM provider_attempts')).rowCount,1);
}));

test('new product discovery after submission remains read-only until a displayed choice starts a new list',async()=>fixture(async(pool,channel)=>{
 await turn(channel,{type:'text',text:{body:'2 H05'}});await turn(channel,tap(await action(pool,'confirm_products')));await turn(channel,tap(await action(pool,'confirm')));
 const old=(await pool.query('SELECT * FROM order_requests')).rows[0];let calls=0;
 const provider=new GoogleInterpreter({apiKey:'offline',model:geminiTextRate.model,allowPaidInference:true,budgetMicrousd:500000},{generateContent:async()=>{calls++;return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({operations:[{kind:'add_item',query:'pipe cutter',quantity:1}],next:'review'})}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:100,totalTokenCount:1100}} as GenerateContentResponse;}});
 const paid=new WhatsAppChannel(pool,{...cfg,aiEnabled:true,paidEnabled:true,budgetMicrousd:500000},async()=>new Response(JSON.stringify({messages:[{id:'wamid.paid.'+randomUUID()}]})),provider);await paid.setup();
 await turn(paid,{type:'text',text:{body:'ennaku oru pipe cutter veenum'}});
 const before=(await pool.query('SELECT draft,last_request_id FROM conversations WHERE id IN (SELECT conversation_id FROM whatsapp_conversations)')).rows[0];assert.equal(before.last_request_id,old.id);assert.equal(before.draft[0].sku,'H05');
 const choose=await action(pool,'choose_product');assert.ok(choose);await turn(paid,tap(choose));
 const after=(await pool.query('SELECT draft,last_request_id FROM conversations WHERE id=$1',[choose.conversation_id])).rows[0];assert.equal(after.last_request_id,null);assert.equal(after.draft.length,1);assert.notEqual(after.draft[0].sku,'H05');assert.equal(after.draft[0].quantity,1);
 assert.deepEqual((await pool.query('SELECT lines FROM order_requests WHERE id=$1',[old.id])).rows[0].lines,old.lines);assert.equal(calls,1);
}));
test('a submitted multi-item follow-up retains all quantities until its bound start-list button is tapped',async()=>fixture(async(pool,channel)=>{
 await turn(channel,{type:'text',text:{body:'2 H05'}});await turn(channel,tap(await action(pool,'confirm_products')));await turn(channel,tap(await action(pool,'confirm')));
 const old=(await pool.query('SELECT * FROM order_requests')).rows[0],stale=await action(pool,'shopping_action','new_list');let calls=0;
 const provider=new GoogleInterpreter({apiKey:'offline',model:geminiTextRate.model,allowPaidInference:true,budgetMicrousd:500000},{generateContent:async params=>{
  calls++;assert.match(String(params.config!.systemInstruction),/oru inch pipe/);
  return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({operations:[{kind:'add_item',query:'H16',quantity:2},{kind:'add_item',query:'H01',quantity:null}],next:'review'})}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:100,totalTokenCount:1100}} as GenerateContentResponse;
 }});
 const paid=new WhatsAppChannel(pool,{...cfg,aiEnabled:true,paidEnabled:true,budgetMicrousd:500000},async()=>new Response(JSON.stringify({messages:[{id:'wamid.batch.'+randomUUID()}]})),provider);await paid.setup();
 await turn(paid,{type:'text',text:{body:'rendu blade and oru inch pipe venum'}});
 const before=(await pool.query('SELECT draft,last_request_id,assistant_memory FROM conversations WHERE id=$1',[old.conversation_id])).rows[0];assert.equal(before.last_request_id,old.id);assert.deepEqual(before.draft,old.lines);assert.deepEqual(before.assistant_memory.newList.map((item:any)=>item.quantity),[2,null]);
 const start=await action(pool,'shopping_action','new_list');assert.notEqual(start.id,stale.id);
 await turn(paid,tap(stale));assert.equal((await pool.query('SELECT last_request_id FROM conversations WHERE id=$1',[old.conversation_id])).rows[0].last_request_id,old.id);
 await turn(paid,tap(start));const after=(await pool.query('SELECT draft,last_request_id FROM conversations WHERE id=$1',[old.conversation_id])).rows[0];assert.equal(after.last_request_id,null);assert.equal(after.draft.length,2);assert.deepEqual(after.draft.map((item:any)=>item.quantity),[2,null]);
 assert.deepEqual((await pool.query('SELECT lines FROM order_requests WHERE id=$1',[old.id])).rows[0].lines,old.lines);assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_requests')).rows[0].n,1);assert.equal(calls,1);
 await turn(paid,tap(start));assert.deepEqual((await pool.query('SELECT draft FROM conversations WHERE id=$1',[old.conversation_id])).rows[0].draft,after.draft);assert.equal(calls,1);
}));

test('a multi-item voice follow-up shows native recommendations and a product tap starts every requested line without losing quantities',async()=>fixture(async(pool,channel)=>{
 await turn(channel,{type:'text',text:{body:'2 H05'}});await turn(channel,tap(await action(pool,'confirm_products')));await turn(channel,tap(await action(pool,'confirm')));
 const old=(await pool.query('SELECT * FROM order_requests')).rows[0],pcm=Buffer.alloc(32000);for(let i=0;i<16000;i++)pcm.writeInt16LE(Math.round(1000*Math.sin(i/10)),i*2);const wav=pcmWav(pcm);let calls=0;
 const provider=new GoogleInterpreter({apiKey:'offline',model:geminiTextRate.model,allowPaidInference:true,allowMultimodal:true,budgetMicrousd:1000000},{generateContent:async params=>{
  calls++;const recommend=!!params.config?.responseJsonSchema;
  if(recommend){const context=JSON.parse(params.contents as string);assert.deepEqual(context.publicCatalog,[]);assert.equal(context.storeCatalogMap,null);assert.match(JSON.stringify(context.toolObservations),/H01/);assert.match(JSON.stringify(context.toolObservations),/H16/);}
  return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(recommend?{skus:['H01','H02','H16'],question:'பிளேடு எந்த வேலைக்குத் தேவை?'}:{transcript:'ஒரு இன்ச் பைப்பும் ஒரு பிளேடும் வேண்டும்',operations:[{kind:'add_item',query:'one inch PVC pipe',quantity:null},{kind:'add_item',query:'blade',quantity:1}],next:'review'})}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:100,totalTokenCount:1100}} as GenerateContentResponse;
 }});
 const sent:any[]=[],paid=new WhatsAppChannel(pool,{...cfg,defaultReplyLanguage:'ta',aiEnabled:true,paidEnabled:true,budgetMicrousd:1000000,mediaEnabled:true,mediaRecommendations:true},async(url,init)=>{
  if(String(url).includes('graph.facebook.com')&&!init?.body)return new Response(JSON.stringify({url:'https://lookaside.fbsbx.com/voice',mime_type:'audio/wav',file_size:wav.length}));
  if(String(url).includes('lookaside.fbsbx.com'))return new Response(new Uint8Array(wav));
  sent.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({messages:[{id:'wamid.multi-voice.'+randomUUID()}]}));
 },provider);await paid.setup();await pool.query("UPDATE conversations SET reply_language='ta' WHERE id=$1",[old.conversation_id]);
 await turn(paid,{type:'audio',audio:{id:'123456'}});
 const before=(await pool.query('SELECT draft,last_request_id,assistant_memory FROM conversations WHERE id=$1',[old.conversation_id])).rows[0];assert.deepEqual(before.draft,old.lines);assert.equal(before.last_request_id,old.id);assert.equal(calls,2);
 assert.equal(sent.at(-1).interactive.type,'carousel');assert.ok(sent.at(-1).interactive.body.text.startsWith('பிளேடு எந்த வேலைக்குத் தேவை?\n'));assert.ok(sent.at(-1).interactive.action.cards.length<=4);assert.ok(await action(pool,'shopping_action','new_list'));
 const selected=(await pool.query("SELECT a.*,o.provider_id FROM whatsapp_actions a JOIN whatsapp_outbox o ON o.message_id=a.message_id WHERE a.event->>'type'='choose_product' AND a.event->>'sku'='H16' ORDER BY o.created_at DESC LIMIT 1")).rows[0];assert.ok(selected);await turn(paid,tap(selected));
 const after=(await pool.query('SELECT draft,last_request_id FROM conversations WHERE id=$1',[old.conversation_id])).rows[0];assert.equal(after.last_request_id,null);assert.equal(after.draft.length,2);assert.deepEqual(after.draft.map((item:any)=>item.quantity),[null,1]);assert.equal(after.draft[1].sku,'H16');assert.ok(after.draft[1].productConfirmation);
 assert.ok(after.draft[0].candidates.every((p:any)=>p.specifications.size==='1 inch'));assert.deepEqual((await pool.query('SELECT lines FROM order_requests WHERE id=$1',[old.id])).rows[0].lines,old.lines);assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,1);assert.equal(calls,2);
 await turn(paid,tap(selected));assert.deepEqual((await pool.query('SELECT draft FROM conversations WHERE id=$1',[old.conversation_id])).rows[0].draft,after.draft);assert.equal(calls,2);
}));
test('WhatsApp sequential proposals preview only the first category and automatically advance after its quantity',async()=>fixture(async(pool,channel)=>{
 await turn(channel,{type:'text',text:{body:'2 H05'}});await turn(channel,tap(await action(pool,'confirm_products')));await turn(channel,tap(await action(pool,'confirm')));
 const old=(await pool.query('SELECT * FROM order_requests')).rows[0];let calls=0;
 const provider=new GoogleInterpreter({apiKey:'offline',model:geminiTextRate.model,allowPaidInference:true,budgetMicrousd:1000000},{generateContent:async()=>{
  calls++;return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({operations:[{kind:'add_item',query:'blade',quantity:null},{kind:'add_item',query:'1 inch PVC pipe',quantity:4}],next:'review'})}]}}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:100,totalTokenCount:1100}} as GenerateContentResponse;
 }});
 const sent:any[]=[],paid=new WhatsAppChannel(pool,{...cfg,aiEnabled:true,paidEnabled:true,budgetMicrousd:1000000,sequentialItems:true},async(_url,init)=>{sent.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({messages:[{id:'wamid.sequential.'+randomUUID()}]}));},provider);await paid.setup();
 await turn(paid,{type:'text',text:{body:'blade and four one-inch pipes'}});
 const proposal=(await pool.query("SELECT payload FROM messages WHERE conversation_id=$1 AND direction='outbound' ORDER BY sequence DESC LIMIT 1",[old.conversation_id])).rows[0].payload;
 assert.ok(proposal.cards.length);assert.ok(proposal.cards.every((c:any)=>c.product.familyId!=='pvc-pipes'));assert.equal((await pool.query('SELECT last_request_id FROM conversations WHERE id=$1',[old.conversation_id])).rows[0].last_request_id,old.id);
 await turn(paid,tap(await action(pool,'shopping_action','new_list')));
 let c=(await pool.query('SELECT draft,pending FROM conversations WHERE id=$1',[old.conversation_id])).rows[0];assert.equal(c.pending.kind,'products');assert.deepEqual(c.pending.groups.map((g:any)=>g.lineId),[c.draft[0].id]);
 const select=(await pool.query("SELECT a.*,o.provider_id FROM whatsapp_actions a JOIN whatsapp_outbox o ON o.message_id=a.message_id WHERE a.event->>'type'='select_product' AND a.event->>'sku'='H16' ORDER BY o.created_at DESC LIMIT 1")).rows[0];assert.ok(select);await turn(paid,tap(select));
 c=(await pool.query('SELECT draft,pending FROM conversations WHERE id=$1',[old.conversation_id])).rows[0];assert.equal(c.pending.kind,'question');assert.equal(c.pending.lineId,c.draft[0].id);await turn(paid,{type:'text',text:{body:'5'}});
 c=(await pool.query('SELECT draft,pending FROM conversations WHERE id=$1',[old.conversation_id])).rows[0];assert.equal(c.draft[0].quantity,5);assert.equal(c.draft[1].quantity,4);assert.equal(c.pending.kind,'products');assert.deepEqual(c.pending.groups.map((g:any)=>g.lineId),[c.draft[1].id]);assert.ok(c.pending.groups[0].products.every((p:any)=>p.familyId==='pvc-pipes'));assert.equal(calls,1);
 const pipe=(await pool.query("SELECT a.*,o.provider_id FROM whatsapp_actions a JOIN whatsapp_outbox o ON o.message_id=a.message_id WHERE a.event->>'type'='select_product' AND a.event->>'sku'='H01' ORDER BY o.created_at DESC LIMIT 1")).rows[0];await turn(paid,tap(pipe));c=(await pool.query('SELECT draft,pending FROM conversations WHERE id=$1',[old.conversation_id])).rows[0];assert.equal(c.pending.kind,'review');assert.match(sent.at(-1).interactive.body.text,/5 units × ₹30.00 = ₹150.00|5 pieces × ₹30.00 = ₹150.00/);assert.equal(calls,1);assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,1);assert.deepEqual((await pool.query('SELECT lines FROM order_requests WHERE id=$1',[old.id])).rows[0].lines,old.lines);
}));
test('typing indicators claim only one eligible message and never repeat after failure or during owner pause',async()=>fixture(async(pool)=>{
 const indicated:any[]=[];const channel=new WhatsAppChannel(pool,{...cfg,typingEnabled:true},async(_url,init)=>{indicated.push(JSON.parse(String(init!.body)));throw new Error('Offline Meta error');});
 await channel.receive(inbound({type:'text',text:{body:'hello'}}));await pool.query('UPDATE stores SET operator_paused=true WHERE id=$1',[cfg.storeId]);await channel.processNext();assert.equal(indicated.length,0);
 await pool.query('UPDATE stores SET operator_paused=false WHERE id=$1',[cfg.storeId]);await channel.processNext();await channel.processNext();assert.equal(indicated.length,1);assert.equal(indicated[0].status,'read');assert.deepEqual(indicated[0].typing_indicator,{type:'text'});
 await channel.receive(inbound({type:'text',text:{body:'hello'}}));await pool.query("UPDATE whatsapp_conversations SET last_inbound_at=now()-interval '25 hours'");await channel.processNext();assert.equal(indicated.length,1);
}));

test('paid multimodal voice uses one compact intent call and durable estimated budget settlement',async()=>fixture(async(pool)=>{
 const pcm=Buffer.alloc(32000);for(let i=0;i<16000;i++)pcm.writeInt16LE(Math.round(1000*Math.sin(i/10)),i*2);const wav=pcmWav(pcm);let calls=0;
 const provider=new GoogleInterpreter({apiKey:'offline',model:geminiTextRate.model,allowPaidInference:true,allowMultimodal:true,budgetMicrousd:500000},{generateContent:async params=>{
  calls++;const prompt=JSON.parse((params.contents as any)[0].parts[0].text);assert.deepEqual(prompt.publicCatalog,[]);assert.equal(prompt.storeCatalogMap,null);assert.ok(!JSON.stringify(prompt).includes('pricePaise'));assert.ok(JSON.stringify(prompt).length<16000);assert.ok(String(params.config!.systemInstruction).length<6000);
  assert.match(JSON.stringify(params.contents),/audio\/wav/);return {modelVersion:geminiTextRate.model,candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({transcript:'எனக்கு ஒரு பைப் கட்டர் வேண்டும்',operations:[{kind:'add_item',query:'pipe cutter',quantity:1}],next:'review'})}]}}],usageMetadata:{promptTokenCount:1400,candidatesTokenCount:100,totalTokenCount:1500}} as GenerateContentResponse;
 }});
 const channel=new WhatsAppChannel(pool,{...cfg,defaultReplyLanguage:'ta',aiEnabled:true,paidEnabled:true,budgetMicrousd:500000,mediaEnabled:true},async url=>String(url).includes('graph.facebook.com')?new Response(JSON.stringify({url:'https://lookaside.fbsbx.com/voice',mime_type:'audio/wav',file_size:wav.length})):new Response(new Uint8Array(wav)),provider);await channel.setup();
 const input=inbound({type:'audio',audio:{id:'123456'}});await channel.receive(input);await channel.processNext();await channel.receive(input);await channel.processNext();assert.equal(calls,1);
 const budget=(await pool.query('SELECT * FROM inference_budgets WHERE store_id=$1',[cfg.storeId])).rows[0];assert.equal(Number(budget.held_microusd),0);assert.equal(Number(budget.committed_microusd),670);assert.equal(Number(budget.limit_microusd),500000);
 const reply=(await pool.query("SELECT payload FROM messages WHERE direction='outbound' ORDER BY sequence DESC LIMIT 1")).rows[0].payload;assert.equal(reply.replyLanguage,'ta');assert.ok(reply.cards.length>=1);assert.equal((await pool.query('SELECT * FROM voice_media')).rowCount,1);assert.equal((await pool.query('SELECT * FROM order_requests')).rowCount,0);
}));
