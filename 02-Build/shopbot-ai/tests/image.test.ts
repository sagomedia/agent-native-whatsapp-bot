import {execFileSync} from 'node:child_process';import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';import pg from 'pg';
import {GenerateContentResponse,FinishReason} from '@google/genai';
import {normalizeImage,loadImage} from '../apps/server/src/services/image-media.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';import {setupImageDemo,demoCatalogStore} from '../apps/server/src/services/demo-catalog.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {GoogleInterpreter,type NativeSettings} from '../apps/server/src/adapters/google-interpreter.js';import {createApp} from '../apps/server/src/http/app.js';
const settings:NativeSettings={allowPaidInference:false,apiKey:'offline-fixture',model:'gemini-3.5-flash-lite',budgetMicrousd:0,freeQuota:{scope:'image-test',model:'gemini-3.5-flash-lite'}};
async function upload(caption='What kind of blade is this?'){return {id:randomUUID(),mimeType:'image/jpeg' as const,data:(await readFile('resources/catalog/ksmc-demo/images/H14.jpg')).toString('base64'),caption};}
function response(output:unknown){return Object.assign(new GenerateContentResponse(),{candidates:[{content:{parts:[{text:JSON.stringify(output)}]},finishReason:FinishReason.STOP}],modelVersion:settings.model,usageMetadata:{promptTokenCount:1600,candidatesTokenCount:70,totalTokenCount:1670}});}
async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='image_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA "${schema}"`);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});try{await setupDatabase(pool,'mock');await setupImageDemo(pool);const id=randomUUID();await pool.query('INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,$3)',[id,demoCatalogStore,'image-test']);await run(pool,new SimulatorService(pool,{storeId:demoCatalogStore,conversationId:id,actor:'image-test',role:'customer'}));}finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}}

test('uploaded raster bytes are bounded and decoded into a small single JPEG; spoofed and malformed formats are rejected',async()=>{
 const u=await upload(),p=await normalizeImage(u);assert.ok(p.width<=1280&&p.height<=1280);assert.ok(p.image.length<=2097152);assert.equal(p.image[0],255);assert.equal(p.image[1],216);
 await assert.rejects(normalizeImage({...u,mimeType:'image/png'}),/not a supported/);
 await assert.rejects(normalizeImage({...u,data:Buffer.from('<svg>not a raster</svg>').toString('base64')}),/not a supported/);
 await assert.rejects(normalizeImage({...u,data:Buffer.alloc(2097153).toString('base64')}),/under 2 MB/);
 await assert.rejects(normalizeImage({...u,data:Buffer.from([255,216,255,0,0]).toString('base64')}),/could not|photo up to/);
});

test('one image inference searches catalog read-only; current photo selection is required; duplicate upload does not repeat inference',async()=>fixture(async(pool,inbox)=>{
 let calls=0;const provider=new GoogleInterpreter(settings,{generateContent:async p=>{calls++;assert.match(JSON.stringify(p.contents),/inlineData.*image\/jpeg/);assert.match(String(p.config?.systemInstruction),/search JSON contract/);assert.equal(p.config?.httpOptions?.retryOptions?.attempts,1);assert.equal(p.config?.automaticFunctionCalling?.disable,true);return response({query:'cutting wheel',keywords:['cutting wheel','cutting disc'],familyId:'cutting-discs',departmentId:null,brand:null,specificationFilters:null,question:null});}}),runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 const u=await upload('இந்த பிளேடு வேண்டும்'),media=await normalizeImage(u),e={id:u.id,type:'image' as const,mediaId:u.id,caption:u.caption};await inbox.ingest(e,undefined,media);await runtime.processNext(inbox.context);let s=await inbox.snapshot();assert.equal(calls,1);assert.equal(s.conversation.draft.length,0);assert.equal(s.requests.length,0);assert.equal(s.messages[0].image?.mediaId,u.id);assert.equal(s.messages[0].text,u.caption);assert.deepEqual(s.messages.at(-1)!.rich!.cards!.map(c=>c.product.sku),['H14','H15']);assert.match(s.messages.at(-1)!.text,/possible catalog matches/);assert.equal(s.messages.at(-1)!.rich!.outboundMessages,1);assert.ok(s.messages.at(-1)!.rich!.cards!.every(c=>c.product.imageUrl));
 assert.equal((await inbox.ingest(e,undefined,media)).duplicate,true);assert.equal(await runtime.processNext(inbox.context),false);assert.equal(calls,1);await assert.rejects(inbox.ingest(e,undefined,{...media,sourceHash:'different'}),/different photo/);assert.equal((await pool.query('SELECT count(*)::int AS n FROM image_media')).rows[0].n,1);
 const photo=await loadImage(pool,inbox.context,u.id);assert.equal(photo.mimeType,'image/jpeg');await assert.rejects(loadImage(pool,{...inbox.context,actor:'foreign'},u.id),/not accessible/);
 const choose=s.messages.at(-1)!.rich!.cards![0].action!;await inbox.ingest(choose);await runtime.processNext(inbox.context);s=await inbox.snapshot();assert.equal(calls,1);assert.equal(s.conversation.draft.length,1);assert.equal(s.conversation.draft[0].sku,'H14');assert.equal(s.conversation.draft[0].quantity,null);assert.equal(s.requests.length,0);
}));

test('unrelated photo and malformed model search cannot mutate or approve an order',async()=>fixture(async(pool,inbox)=>{
 let output:unknown={query:null,keywords:[]};const provider=new GoogleInterpreter(settings,{generateContent:async()=>response(output)}),runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 for(const value of [output,{query:'cutting wheel',keywords:['cutting wheel'],operations:[{kind:'add_item',query:'H14',quantity:5}]},{query:'cutting wheel',keywords:['cutting wheel'],pricePaise:1}]){
  await pool.query("UPDATE provider_attempts SET created_at=created_at-interval '1 hour'");output=value;const u=await upload(),media=await normalizeImage(u);await inbox.ingest({id:u.id,type:'image',mediaId:u.id,caption:u.caption},undefined,media);await runtime.processNext(inbox.context);const s=await inbox.snapshot();assert.equal(s.conversation.draft.length,0);assert.equal(s.requests.length,0);assert.equal(s.messages.at(-1)!.rich?.cards,undefined);
 }
}));
test('photo recognition cannot force an absent nail into the screw-box catalog family',async()=>fixture(async(pool,inbox)=>{
 const provider=new GoogleInterpreter(settings,{generateContent:async params=>{
  const context=JSON.parse((params.contents as any)[0].parts[0].text);assert.equal(context.storeCatalogMap,null);assert.deepEqual(context.publicCatalog,[]);assert.deepEqual(context.toolObservations,[]);
  return response({query:'nail',keywords:['nail','iron nail','wood nail'],familyId:'screw-boxes',departmentId:'hardware',specificationFilters:null});
 }}),runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 const u=await upload(),media=await normalizeImage(u);await inbox.ingest({id:u.id,type:'image',mediaId:u.id,caption:''},undefined,media);await runtime.processNext(inbox.context);
 const snapshot=await inbox.snapshot();assert.equal(snapshot.conversation.draft.length,0);assert.equal(snapshot.requests.length,0);assert.equal(snapshot.messages.at(-1)!.rich!.cards?.length??0,0);
 const memory=(await pool.query('SELECT assistant_memory FROM conversations WHERE id=$1',[inbox.context.conversationId])).rows[0].assistant_memory;
 assert.equal(memory.observations[0].discovery.plan.familyId,undefined);assert.equal(memory.observations[0].discovery.plan.departmentId,undefined);assert.equal(memory.observations[0].discovery.noExactMatch,true);
}));
test('photo labels use supported size filters; unmodeled material stays a keyword rather than hiding a valid listing',async()=>fixture(async(pool,inbox)=>{
 const provider=new GoogleInterpreter(settings,{generateContent:async params=>{
  const context=JSON.parse((params.contents as any)[0].parts[0].text);assert.deepEqual(context.photoSpecificationKeys,['size']);
  return response({query:'hacksaw blade',keywords:['hacksaw blade','carbon steel'],specificationFilters:[{key:'size',value:'12 inch'},{key:'material',value:'carbon steel'}]});
 }}),runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 const u=await upload(),media=await normalizeImage(u);await inbox.ingest({id:u.id,type:'image',mediaId:u.id,caption:''},undefined,media);await runtime.processNext(inbox.context);
 const snapshot=await inbox.snapshot();assert.deepEqual(snapshot.messages.at(-1)!.rich!.cards!.map(card=>card.product.sku),['H16']);assert.equal(snapshot.conversation.draft.length,0);assert.equal(snapshot.requests.length,0);
 const memory=(await pool.query('SELECT assistant_memory FROM conversations WHERE id=$1',[inbox.context.conversationId])).rows[0].assistant_memory;
 assert.deepEqual(memory.observations[0].discovery.plan.specifications,{size:'12 inch'});assert.ok(memory.observations[0].discovery.plan.keywords.includes('carbon steel'));
}));

test('the runtime rejects mutation attempts from another image-capable provider and rejects stale queued photos before inference',async()=>fixture(async(pool,inbox)=>{
 let calls=0;const runtime=new ConversationRuntime(pool,{name:'hostile-image-test',mode:'mock',supportsImages:true,interpret:async()=>{calls++;return {output:{operations:[{kind:'add_item',query:'H14',quantity:3}],next:'review'},truncated:false,usage:null};}});
 let u=await upload();await inbox.ingest({id:u.id,type:'image',mediaId:u.id,caption:u.caption},undefined,await normalizeImage(u));await runtime.processNext(inbox.context);assert.equal((await inbox.snapshot()).conversation.draft.length,0);
 await inbox.ingest({id:randomUUID(),type:'choose_product',sku:'H07',quantity:2,expectedVersion:0});u=await upload();await inbox.ingest({id:u.id,type:'image',mediaId:u.id,caption:u.caption},undefined,await normalizeImage(u));await runtime.processNext(inbox.context);const before=(await inbox.snapshot()).conversation;await runtime.processNext(inbox.context);assert.deepEqual((await inbox.snapshot()).conversation,before);assert.equal(calls,1);
}));

test('image requests respect the shared free quota and paid text billing never authorizes image inference',async()=>fixture(async(pool,inbox)=>{
 let calls=0;const transport={generateContent:async()=>{calls++;return response({query:'cutting wheel',keywords:['cutting wheel']});}},provider=new GoogleInterpreter(settings,transport),runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
 for(let n=0;n<2;n++){const u=await upload();await inbox.ingest({id:u.id,type:'image',mediaId:u.id,caption:u.caption},undefined,await normalizeImage(u));await runtime.processNext(inbox.context);}assert.equal(calls,1);assert.match((await inbox.snapshot()).messages.at(-1)!.text,/request limit/);assert.equal((await inbox.snapshot()).conversation.draft.length,0);
 const paid=new GoogleInterpreter({...settings,allowPaidInference:true,freeQuota:undefined},transport),u=await upload(),media=await normalizeImage(u);await assert.rejects(paid.interpret({text:'photo',state:(await inbox.snapshot()).conversation,image:{mimeType:'image/jpeg',data:media.image.toString('base64')}},AbortSignal.timeout(1000)),/free-only/);assert.equal(calls,1);
}));

test('local photo upload and retrieval enforce signed conversation scope, origin and verified media ingress',async()=>fixture(async(pool)=>{
 let calls=0;const provider=new GoogleInterpreter(settings,{generateContent:async()=>{calls++;return response({query:'cutting wheel',keywords:['cutting wheel']});}}),app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,host:'127.0.0.1',port:3017,mediaDir:'/tmp/image-fixture'},pool,provider,demoCatalogStore);
 try{const h={host:'localhost:3017','x-shopbot-local-test':'1'},u=await upload();assert.equal((await app.inject({method:'POST',url:'/api/native-test/image',headers:h,payload:u})).statusCode,401);const session=await app.inject({method:'POST',url:'/api/native-test/session',headers:h}),cookie=String(session.headers['set-cookie']).split(';')[0],headers={...h,cookie};
 assert.equal((await app.inject({method:'POST',url:'/api/native-test/events',headers,payload:{id:u.id,type:'image',mediaId:u.id,caption:''}})).statusCode,400);
 assert.equal((await app.inject({method:'POST',url:'/api/native-test/image',headers:{...headers,origin:'https://foreign.test'},payload:u})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:'/api/native-test/image',headers,payload:{...u,data:Buffer.from('bad').toString('base64')}})).statusCode,400);assert.equal(calls,0);
 assert.equal((await app.inject({method:'POST',url:'/api/native-test/image',headers,payload:u})).statusCode,200);assert.equal(calls,1);
 const image=await app.inject({url:`/api/native-test/image/${u.id}`,headers});assert.equal(image.statusCode,200);assert.match(String(image.headers['content-type']),/image\/jpeg/);assert.equal(image.headers['cache-control'],'private, no-store');assert.equal(image.headers['x-content-type-options'],'nosniff');
 const second=await app.inject({method:'POST',url:'/api/native-test/session',headers:h});assert.equal((await app.inject({url:`/api/native-test/image/${u.id}`,headers:{...h,cookie:String(second.headers['set-cookie']).split(';')[0]}})).statusCode,404);
 }finally{await app.close();}
}));


test('PNG and WebP uploads decode successfully and over-dimension rasters are rejected before conversion',async()=>{
  for(const [mimeType,codec] of [['image/png','png'],['image/webp','libwebp']] as const){
    const data=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=gray:s=32x32','-frames:v','1','-threads','1','-vcodec',codec,'-f','image2pipe','pipe:1']);
    const image=await normalizeImage({id:randomUUID(),mimeType,data:data.toString('base64'),caption:''});assert.equal(image.width,32);assert.equal(image.height,32);
  }
  const large=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=gray:s=9000x2','-frames:v','1','-threads','1','-vcodec','png','-f','image2pipe','pipe:1']);
  await assert.rejects(normalizeImage({id:randomUUID(),mimeType:'image/png',data:large.toString('base64'),caption:''}),/16 megapixels/);
});
