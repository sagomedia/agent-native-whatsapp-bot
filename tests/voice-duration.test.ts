import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {execFileSync} from 'node:child_process';
import {voiceLimits,voiceUploadBase64Limit} from '../packages/contracts/voice-policy.js';
import {normalizeVoice,pcmWav,voiceUploadSchema,loadVoice,loadVoicePlayback} from '../apps/server/src/services/voice-media.js';
import {downloadWhatsAppMedia,mediaFailureCode} from '../apps/server/src/services/whatsapp-media.js';
import {GoogleSpeechRecognizer} from '../apps/server/src/adapters/google-speech-recognizer.js';
import {GoogleInterpreter} from '../apps/server/src/adapters/google-interpreter.js';
import {admitRequest} from '../apps/server/src/services/inference-admission.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {createApp} from '../apps/server/src/http/app.js';
import {fixtureStore} from '../profiles/hardware.js';
import type {WhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';
function wav(seconds:number){const pcm=Buffer.alloc(Math.round(seconds*16000)*2);for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(i*.17)*1200),i*2);return pcmWav(pcm);}
const upload=(seconds:number)=>({id:randomUUID(),mimeType:'audio/wav' as const,data:wav(seconds).toString('base64')});
const state={version:0,draft:[],pending:null,fulfillment:'pickup' as const,lastRequestId:null};
async function fixture(run:(pool:pg.Pool,inbox:SimulatorService)=>Promise<void>){const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='voice90_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});try{await setupDatabase(pool,'mock');await run(pool,new SimulatorService(pool));}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}

test('decoded recordings accept 30–90 seconds without truncation and reject anything over 90',async()=>{
 for(const seconds of [30.2,60,90]){const u=voiceUploadSchema.parse(upload(seconds)),media=await normalizeVoice(u);assert.equal(media.durationSeconds,seconds);assert.equal(media.audio.length,seconds*32000+44);}
 for(const seconds of [90.01,91,100])await assert.rejects(normalizeVoice(upload(seconds)),error=>{assert.equal(mediaFailureCode(error),'media_duration_invalid');return /90 seconds/.test(String(error));});
 const opus=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=90','-ac','1','-ar','48000','-c:a','libopus','-b:a','32k','-f','ogg','pipe:1']);const compressed=await normalizeVoice({id:randomUUID(),mimeType:'audio/ogg',data:opus.toString('base64')});assert.equal(compressed.durationSeconds,90);assert.equal(compressed.audio.length,voiceLimits.wavBytes);
 assert.equal(voiceUploadBase64Limit,5592408);assert.equal(voiceLimits.wavBytes,2880044);
});

test('90-second audio fits both model adapters and admission while per-type and total caps remain enforced',async()=>{
 const input={text:'voice',state,stage:'recognize' as const,audio:{mimeType:'audio/wav' as const,data:wav(90).toString('base64'),durationSeconds:90}};
 let calls=0;const speech=new GoogleSpeechRecognizer({apiKey:'offline',budgetMicrousd:1000000},{create:async request=>{calls++;assert.equal(request.input&&JSON.stringify(request.input).includes(input.audio.data),true);return {id:'fixture',model:speech.billing.model,status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'two pipes'}]}]};}});
 assert.equal(speech.prepareInput(input).admission.mediaBytes,2880044);assert.equal(calls,0);await speech.interpret(input,AbortSignal.timeout(1000));assert.equal(calls,1);
 const free=new GoogleInterpreter({allowPaidInference:false,apiKey:'offline',model:'gemini-3.5-flash-lite',budgetMicrousd:0,freeQuota:{scope:'duration-test',model:'gemini-3.5-flash-lite'}});assert.equal(free.prepareInput(input).admission.mediaBytes,2880044);
 const over={...input,audio:{...input.audio,durationSeconds:90.01}};assert.throws(()=>speech.prepareInput(over),/90 seconds/);assert.throws(()=>free.prepareInput(over),/90 seconds/);
 const request=(parts:any[])=>({model:'offline',contents:[{parts}],config:{maxOutputTokens:4096}});
 const inline=(mimeType:string,bytes:number)=>({inlineData:{mimeType,data:Buffer.alloc(bytes).toString('base64')}});
 assert.throws(()=>admitRequest(request([inline('audio/wav',1440023),inline('audio/wav',1440023)])),/bounded inference/);
 assert.throws(()=>admitRequest(request([inline('image/jpeg',1048577),inline('image/jpeg',1048577)])),/bounded inference/);
 assert.throws(()=>admitRequest(request([inline('audio/wav',1),inline('image/jpeg',1)])),/bounded inference/);
});

test('WhatsApp accepts and retains a 90-second original above the previous download ceiling',async()=>{
 const bytes=wav(90),id=randomUUID();let kept:Buffer|undefined,reads=0;
 const config={graphVersion:'v25.0',accessToken:'offline'} as WhatsAppConfig;
 const media=await downloadWhatsAppMedia(config,async()=>++reads===1?new Response(JSON.stringify({url:'https://lookaside.fbsbx.com/voice',mime_type:'audio/wav',file_size:bytes.length})):new Response(bytes), '123456','voice',id,async source=>{kept=source.audio;});
 assert.equal(reads,2);assert.deepEqual(kept,bytes);assert.ok('durationSeconds' in media);assert.equal((media as {durationSeconds:number}).durationSeconds,90);
 await assert.rejects(downloadWhatsAppMedia(config,async()=>new Response(JSON.stringify({url:'https://lookaside.fbsbx.com/voice',mime_type:'audio/wav',file_size:voiceLimits.uploadBytes+1})), '123456','voice',id),/too large/);
});

test('schema 40 upgrade preserves old audio, permits 90-second storage and original playback, and is repeatable',()=>fixture(async(pool,inbox)=>{
 const old=upload(1),oldMedia=await normalizeVoice(old);await inbox.ingest({id:old.id,type:'voice',mediaId:old.id},oldMedia);
 await pool.query(`ALTER TABLE voice_media DROP CONSTRAINT voice_media_audio_check;ALTER TABLE voice_media ADD CONSTRAINT voice_media_audio_check CHECK(octet_length(audio)<=960044);ALTER TABLE voice_media DROP CONSTRAINT voice_media_duration_seconds_check;ALTER TABLE voice_media ADD CONSTRAINT voice_media_duration_seconds_check CHECK(duration_seconds>0 AND duration_seconds<=30);ALTER TABLE whatsapp_media DROP CONSTRAINT whatsapp_media_original_audio_check;ALTER TABLE whatsapp_media ADD CONSTRAINT whatsapp_media_original_audio_check CHECK(original_audio IS NULL OR octet_length(original_audio) BETWEEN 1 AND 1048576);DELETE FROM schema_migrations WHERE version=41;`);
 await setupDatabase(pool,'mock');await setupDatabase(pool,'mock');assert.equal((await pool.query('SELECT count(*)::int AS n FROM schema_migrations WHERE version=41')).rows[0].n,1);assert.deepEqual(Buffer.from((await loadVoice(pool,inbox.context,old.id)).data,'base64'),oldMedia.audio);
 const u=upload(90),media=await normalizeVoice(u);await inbox.ingest({id:u.id,type:'voice',mediaId:u.id},media);assert.equal((await loadVoice(pool,inbox.context,u.id)).durationSeconds,90);
 await pool.query("INSERT INTO whatsapp_media(message_id,media_id,kind,source_version,state,original_audio,original_mime_type) VALUES($1,'123456','voice',0,'ready',$2,'audio/wav')",[u.id,media.audio]);await pool.query('DELETE FROM voice_media WHERE id=$1',[u.id]);assert.deepEqual(Buffer.from((await loadVoicePlayback(pool,inbox.context,u.id)).data,'base64'),media.audio);
 await assert.rejects(loadVoicePlayback(pool,{...inbox.context,actor:'other'},u.id),/not accessible/);
 await assert.rejects(inbox.ingest({id:randomUUID(),type:'voice',mediaId:randomUUID()},media),/verified upload/);
 const bad=randomUUID();await assert.rejects(inbox.ingest({id:bad,type:'voice',mediaId:bad},{...media,durationSeconds:90.01}),/voice_media_duration_seconds_check/);
}));

test('the signed local voice route accepts a full 90-second WAV payload above 1 MB',()=>fixture(async(pool,inbox)=>{
 let recognized=0;const provider=new GoogleInterpreter({allowPaidInference:false,apiKey:'offline',model:'gemini-3.5-flash-lite',budgetMicrousd:0,freeQuota:{scope:'route-duration-'+randomUUID(),model:'gemini-3.5-flash-lite'}},{generateContent:async request=>{assert.ok(JSON.stringify(request.contents).includes(wav(90).toString('base64')));recognized++;return {modelVersion:'gemini-3.5-flash-lite',candidates:[{finishReason:'STOP' as any,content:{parts:[{text:JSON.stringify({transcript:'two pipes'})}]}}],usageMetadata:{promptTokenCount:2300,candidatesTokenCount:10,totalTokenCount:2310}} as any;}});
 const app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,host:'127.0.0.1',port:0,mediaDir:'/tmp/audio90-test'},pool,provider,fixtureStore);
 try{const headers={host:'localhost','x-shopbot-local-test':'1'},session=await app.inject({method:'POST',url:'/api/native-test/session',headers}),cookie=String(session.headers['set-cookie']).split(';')[0],u=upload(90);const response=await app.inject({method:'POST',url:'/api/native-test/voice',headers:{...headers,cookie},payload:u});assert.equal(response.statusCode,200,response.body);assert.equal(recognized,1);assert.equal((await pool.query('SELECT duration_seconds FROM voice_media WHERE id=$1',[u.id])).rows[0].duration_seconds,90);}finally{await app.close();}
}));
