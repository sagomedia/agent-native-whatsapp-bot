import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {normalizeVoice} from '../apps/server/src/services/voice-media.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {FinishReason,GenerateContentResponse} from '@google/genai';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {GoogleInterpreter,type NativeSettings} from '../apps/server/src/adapters/google-interpreter.js';
import {createApp} from '../apps/server/src/http/app.js';
import {canonicalShortcut,languageRequest,productName,safeQuestion,type ReplyLanguage} from '../packages/contracts/language.js';
import {quantityReply,priceInquiry} from '../apps/server/src/services/shopping-language.js';
import {sameUnit} from '../apps/server/src/services/catalog.js';
import type {SimulatorEvent} from '../packages/contracts/index.js';
const settings:NativeSettings={allowPaidInference:false,apiKey:'offline-fixture',model:'gemini-3.5-flash-lite',budgetMicrousd:0,freeQuota:{scope:'language-test',model:'gemini-3.5-flash-lite'}};
async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='language_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA "${schema}"`);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');await setupImageDemo(pool);const id=randomUUID();await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language) VALUES($1,$2,$3,'ta')",[id,demoCatalogStore,'language-test']);await run(pool,new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'language-test',role:'customer'}));}
 finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
async function turn(inbox:SimulatorService,runtime:ConversationRuntime,event:Omit<Extract<SimulatorEvent,{type:'text'}>,'id'>|SimulatorEvent){const e='id' in event?event:{...event,id:randomUUID()};await inbox.ingest(e);await runtime.processNext(inbox.context);return inbox.snapshot();}
function noAI(pool:pg.Pool){return new ConversationRuntime(pool,{name:'no-inference',mode:'mock',interpret:async()=>{throw new Error('unexpected inference');}});}
function response(output:unknown){return Object.assign(new GenerateContentResponse(),{candidates:[{content:{parts:[{text:JSON.stringify(output)}]},finishReason:FinishReason.STOP}],modelVersion:settings.model,usageMetadata:{promptTokenCount:1600,candidatesTokenCount:70,totalTokenCount:1670}});}

test('Tamil and Tanglish shortcuts are whole-message actions; quantities retain units without pack conversion',()=>{
 assert.equal(languageRequest('change to English'),'en');assert.equal(languageRequest('English la pesunga'),'en');assert.equal(languageRequest('தமிழில் பேசுங்கள்'),'ta');assert.equal(languageRequest('Tanglish la pesu'),'ta-Latn');
 for(const text of ['English brand paint venum','English-la sonna two pipes add pannu','ஆம் ஆனால் மூன்று வேண்டும்'])assert.equal(languageRequest(text),undefined);
 assert.equal(canonicalShortcut('ஆம் ஆனால் மூன்று வேண்டும்'),'ஆம் ஆனால் மூன்று வேண்டும்');assert.equal(canonicalShortcut('கடைக்கு அனுப்பு'),'send it');
 assert.deepEqual(quantityReply('ரெண்டு பாட்டில் வேண்டும்'),{quantity:2,unit:'பாட்டில்'});assert.deepEqual(quantityReply('rendu petti venum'),{quantity:2,unit:'petti'});
 assert.equal(sameUnit('பெட்டி','box'),true);assert.equal(sameUnit('அடி','piece'),false);assert.equal(quantityReply('rendu inch pipe venum'),undefined);
 assert.deepEqual(priceInquiry('H14 விலை என்ன'),{query:'h14'});assert.equal(priceInquiry('H14 வேண்டும் விலை என்ன'),undefined);
 assert.equal(safeQuestion('Which blade do you need?', 'ta'),undefined);assert.equal(safeQuestion('எதை வெட்டப் போகிறீர்கள்?', 'ta'),'எதை வெட்டப் போகிறீர்கள்?');assert.equal(safeQuestion('என்ன விலை?', 'ta'),undefined);
});

test('Tamil is persisted through an English greeting, localized catalog discovery and Tamil quantity response without inference',async()=>fixture(async(pool,inbox)=>{
 const runtime=noAI(pool);let s=await turn(inbox,runtime,{type:'text',text:'hi'});assert.equal(s.conversation.replyLanguage,'ta');assert.match(s.messages.at(-1)!.text,/வணக்கம்/);assert.equal(s.interpretationAttempts,0);
 s=await turn(inbox,runtime,{id:randomUUID(),type:'browse',query:'cutting-discs',expectedVersion:0});assert.match(s.messages.at(-1)!.text,/[\u0b80-\u0bff]/);const rich=s.messages.at(-1)!.rich!;assert.deepEqual(rich.cards!.map(c=>c.product.sku),['H14','H15']);assert.equal(rich.cards![0].label,'இதைத் தேர்வு செய்');assert.match(productName(rich.cards![0].product,'ta'),/கட்டிங் வீல்/);
 s=await turn(inbox,runtime,rich.cards![0].action!);assert.match(s.messages.at(-1)!.text,/எத்தனை/);s=await turn(inbox,runtime,{type:'text',text:'ரெண்டு பீஸ்'});assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.conversation.pending?.kind,'review');assert.match(s.messages.at(-1)!.text,/மொத்தம்: ₹70.00/);assert.equal(s.messages.at(-1)!.rich!.buttons![0].label,'கடைக்கு அனுப்பு');assert.equal(s.requests.length,0);assert.equal(s.interpretationAttempts,0);
}));

test('language changes preserve current product and review consent bindings; replay cannot duplicate replies or submit',async()=>fixture(async(pool,inbox)=>{
 const runtime=noAI(pool);let s=await turn(inbox,runtime,{id:randomUUID(),type:'choose_product',sku:'H07',quantity:2,expectedVersion:0});const before=s.conversation,check=before.pending;assert.equal(check?.kind,'products');
 const event:SimulatorEvent={id:randomUUID(),type:'change_language',language:'ta-Latn'};s=await turn(inbox,runtime,event);assert.equal(s.conversation.version,before.version);assert.deepEqual(s.conversation.draft,before.draft);assert.deepEqual(s.conversation.pending,check);assert.match(s.messages.at(-1)!.text,/Tanglish-la/);assert.equal(s.messages.at(-1)!.rich!.cards![0].label,'Intha porulai seru');
 const count=s.messages.length;assert.equal((await inbox.ingest(event)).duplicate,true);assert.equal(await runtime.processNext(inbox.context),false);assert.equal((await inbox.snapshot()).messages.length,count);
 s=await turn(inbox,runtime,{type:'text',text:'ivatrai seru'});assert.equal(s.conversation.pending?.kind,'review');const review=s.conversation.pending;const draft=s.conversation.draft;
 s=await turn(inbox,runtime,{type:'text',text:'change to English'});assert.equal(s.conversation.replyLanguage,'en');assert.deepEqual(s.conversation.pending,review);assert.deepEqual(s.conversation.draft,draft);assert.equal(s.messages.at(-1)!.rich!.buttons![0].label,'Confirm request');assert.equal(s.requests.length,0);
 const restored=new SimulatorService(pool,inbox.context);assert.equal((await restored.snapshot()).conversation.replyLanguage,'en');s=await turn(inbox,runtime,{type:'text',text:'தமிழில் பேசுங்கள்'});assert.equal(s.conversation.replyLanguage,'ta');assert.deepEqual(s.conversation.pending,review);assert.equal(s.requests.length,0);assert.equal(s.interpretationAttempts,0);
}));

test('Tamil short consent remains bound to the current review; a stale answer cannot submit or change quantities',async()=>fixture(async(pool,inbox)=>{
 const runtime=noAI(pool);let s=await turn(inbox,runtime,{id:randomUUID(),type:'choose_product',sku:'H14',quantity:2,expectedVersion:0});s=await turn(inbox,runtime,{type:'text',text:'இதை சேர்'});assert.equal(s.conversation.pending?.kind,'review');
 await inbox.ingest({id:randomUUID(),type:'set_quantity',lineId:s.conversation.draft[0].id,quantity:3,expectedVersion:s.conversation.version});await inbox.ingest({id:randomUUID(),type:'text',text:'ஆம்'});await runtime.processNext(inbox.context);await runtime.processNext(inbox.context);s=await inbox.snapshot();assert.equal(s.requests.length,0);assert.equal(s.conversation.draft[0].quantity,3);assert.match(s.messages.at(-1)!.text,/முந்தைய/);assert.equal(s.interpretationAttempts,0);
}));

test('Tamil failed inference and submitted-request guards are localized and retain business state',async()=>fixture(async(pool,inbox)=>{
 const runtime=new ConversationRuntime(pool,{name:'bad-plan',mode:'mock',interpret:async()=>({output:{operations:[{kind:'add_item',query:'H14',quantity:null}],next:'review',pricePaise:1},truncated:false,usage:null})});
 let s=await turn(inbox,runtime,{type:'text',text:'பிளேடு வேண்டும்'});assert.equal(s.conversation.draft.length,0);assert.match(s.messages.at(-1)!.text,/பட்டியல் அப்படியே/);
 const known=noAI(pool);s=await turn(inbox,known,{id:randomUUID(),type:'choose_product',sku:'H14',quantity:2,expectedVersion:0});s=await turn(inbox,known,{type:'text',text:'இதை சேர்'});s=await turn(inbox,known,{type:'text',text:'கடைக்கு அனுப்பு'});assert.equal(s.requests.length,1);assert.match(s.messages.at(-1)!.text,/ஒப்புதலுக்காக/);const snapshot=s.requests[0];
 s=await turn(inbox,known,{id:randomUUID(),type:'choose_product',sku:'H07',quantity:1,expectedVersion:s.conversation.version});assert.deepEqual(s.requests[0],snapshot);assert.equal(s.requests.length,1);assert.match(s.messages.at(-1)!.text,/ஏற்கனவே/);
}));

test('provider receives language rules; optional nulls are omitted without relaxing required quantities or unknown fields',async()=>fixture(async(pool,inbox)=>{
 let output:unknown={operations:[{kind:'add_item',query:'H14',quantity:2,requestedUnit:null}],next:'review',priceQuery:null,assistance:null,searchPlans:null};
 const provider=new GoogleInterpreter(settings,{generateContent:async p=>{assert.match(String(p.config?.systemInstruction),/reply language is ta/);assert.equal(JSON.parse(String(p.contents)).replyLanguage,'ta');return response(output);}}),runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 let s=await turn(inbox,runtime,{type:'text',text:'ரெண்டு கட்டிங் வீல் வேண்டும்'});assert.equal(s.conversation.draft[0].quantity,2);assert.equal(s.conversation.pending?.kind,'products');assert.match(s.messages.at(-1)!.text,/சரிபாருங்கள்/);assert.equal(s.requests.length,0);
 const before=s.conversation;for(const bad of [{operations:[{kind:'add_item',query:'H07'}],next:'review'},{operations:[],next:'continue',language:'en'}]){await pool.query("UPDATE provider_attempts SET created_at=created_at-interval '1 hour'");output=bad;s=await turn(inbox,runtime,{type:'text',text:'மற்றொரு பொருள்'});assert.deepEqual(s.conversation,before);assert.equal(s.requests.length,0);}
}));

test('new native sessions start Tamil, explicit language actions are authenticated and scoped, foreign actor cannot change preference',async()=>fixture(async(pool,inbox)=>{
 const provider=new GoogleInterpreter(settings,{generateContent:async()=>{throw new Error('unexpected inference');}}),app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,host:'127.0.0.1',port:3017,mediaDir:'/tmp/language-fixture'},pool,provider,demoCatalogStore);
 try{const h={host:'localhost:3017','x-shopbot-local-test':'1'},session=await app.inject({method:'POST',url:'/api/native-test/session',headers:h}),cookie=String(session.headers['set-cookie']).split(';')[0],headers={...h,cookie};
 const get=()=>app.inject({url:'/api/native-test',headers});assert.equal((await get()).json().conversation.replyLanguage,'ta');
 const payload={id:randomUUID(),type:'change_language',language:'en'};assert.equal((await app.inject({method:'POST',url:'/api/native-test/events',headers:h,payload})).statusCode,401);assert.equal((await app.inject({method:'POST',url:'/api/native-test/events',headers,payload})).statusCode,200);assert.equal((await get()).json().conversation.replyLanguage,'en');assert.equal((await get()).json().interpretationAttempts,0);
 await assert.rejects(new SimulatorService(pool,{...inbox.context,actor:'foreign'}).ingest({id:randomUUID(),type:'change_language',language:'en'}),/not accessible/);assert.equal((await inbox.snapshot()).conversation.replyLanguage,'ta');
 }finally{await app.close();}
}));

test('spoken language changes use the actual transcript without touching a draft or creating consent',async()=>fixture(async(pool,inbox)=>{
 const data=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=0.5','-ar','16000','-ac','1','-f','wav','pipe:1']).toString('base64');
 const upload={id:randomUUID(),mimeType:'audio/wav' as const,data},media=await normalizeVoice(upload);
 let calls=0;const runtime=new ConversationRuntime(pool,{name:'spoken-language-fixture',mode:'mock',supportsAudio:true,interpret:async()=>{calls++;return {output:{transcript:'English la pesunga',operations:[],next:'continue'},truncated:false,usage:null};}});
 await inbox.ingest({id:upload.id,type:'voice',mediaId:upload.id},media);await runtime.processNext(inbox.context);const s=await inbox.snapshot();assert.equal(calls,1);assert.equal(s.conversation.replyLanguage,'en');assert.equal(s.conversation.draft.length,0);assert.equal(s.requests.length,0);assert.equal(s.messages[0].text,'English la pesunga');assert.match(s.messages.at(-1)!.text,/reply in English/);
}));

test('Tamil family narrowing labels and rechecks resolve the displayed facet without extra inference',async()=>fixture(async(pool,inbox)=>{
 const runtime=noAI(pool);let s=await turn(inbox,runtime,{id:randomUUID(),type:'browse',query:'tools',expectedVersion:0});const rich=s.messages.at(-1)!.rich!;assert.ok(rich.buttons?.length);assert.ok(rich.buttons!.every(b=>/[\u0b80-\u0bff]/.test(b.label)));
 const label=rich.buttons![0].label;s=await turn(inbox,runtime,{type:'text',text:label});assert.ok(s.messages.at(-1)!.rich?.cards?.length);assert.equal(s.interpretationAttempts,0);
 s=await turn(inbox,runtime,{type:'text',text:'மீண்டும் பார்'});assert.ok(s.messages.at(-1)!.rich?.cards?.length);assert.equal(s.interpretationAttempts,0);assert.equal(s.conversation.replyLanguage,'ta');
}));
