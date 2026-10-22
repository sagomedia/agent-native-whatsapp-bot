import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Interactions} from '@google/genai';
import {GoogleSpeechRecognizer,type SpeechRequest} from '../apps/server/src/adapters/google-speech-recognizer.js';
import {GoogleInterpreter,readNativeSettings} from '../apps/server/src/adapters/google-interpreter.js';
import {geminiSpeechRate,geminiTextRate,usageEstimate,validateRateCard,worstCaseReservation} from '../apps/server/src/services/inference-budget.js';
const settings={apiKey:'offline-only-key',budgetMicrousd:1000000};
const input={stage:'recognize' as const,text:'old transcript',state:{version:1,draft:[],pending:null,fulfillment:'pickup' as const,lastRequestId:null},audio:{mimeType:'audio/wav' as const,data:'AAAA',durationSeconds:20},history:[{direction:'customer',text:'old transcript'}]};
function response(transcript:string):Interactions.Interaction{return {id:'offline',model:geminiSpeechRate.model,status:'completed',steps:[{type:'model_output',content:[{type:'text',text:transcript}]}],usage:{total_input_tokens:500,total_output_tokens:30,total_tokens:530,total_thought_tokens:0}};}
test('Transcribe receives one audio-only verbatim request without history, tools or thinking',async()=>{
 let request:SpeechRequest|undefined,calls=0;
 const provider=new GoogleSpeechRecognizer(settings,{create:async(p,options)=>{calls++;request=p;assert.equal(options.maxRetries,0);assert.equal(options.timeout,44000);return response('இரண்டு wall stickers');}});
 const prepared=provider.prepareInput(input);assert.equal(prepared.admission.mediaBytes,3);assert.equal(calls,0);
 const result=await prepared.interpret(AbortSignal.timeout(1000));
 assert.equal(calls,1);assert.equal(request?.model,geminiSpeechRate.model);assert.deepEqual(result.output,{transcript:'இரண்டு wall stickers',operations:[],next:'continue'});
 assert.deepEqual(request,{model:geminiSpeechRate.model,store:false,input:[{type:'audio',mime_type:'audio/wav',data:'AAAA'}],generation_config:{max_output_tokens:4096,transcription_config:{mode:{type:'verbatim'}}}});
 assert.ok(!JSON.stringify(request).includes('old transcript'));
 assert.notEqual(prepared.admission.requestHash,provider.prepareInput({...input,audio:{...input.audio,data:'BBBB'}}).admission.requestHash);
});
test('empty, invalid, incomplete and model-mismatched transcripts cannot produce actions',async()=>{
 const run=(r:Interactions.Interaction)=>new GoogleSpeechRecognizer(settings,{create:async()=>r}).interpret(input,AbortSignal.timeout(1000));
 assert.deepEqual((await run(response(''))).output,{operations:[],next:'continue'});
 for(const r of [response('x'.repeat(4001)),{...response('one'),model:geminiTextRate.model},{...response('one'),status:'failed'},{...response('one'),steps:[{type:'function_call',id:'bad',name:'submit',arguments:{}}]},{...response('one'),errors:[{code:'INTERNAL',message:'fixture'}]}] as Interactions.Interaction[]){const result=await run(r);assert.equal(result.output,null);assert.ok(result.validationIssues?.length);}
 assert.equal((await run({...response('one'),status:'incomplete'})).truncated,true);
 for(const durationSeconds of [0,-1,31,NaN,Infinity])await assert.rejects(new GoogleSpeechRecognizer(settings).interpret({...input,audio:{...input.audio,durationSeconds}},AbortSignal.timeout(1000)),/30 seconds/);
 for(const data of ['', '!!!',Buffer.alloc(960045).toString('base64')])await assert.rejects(new GoogleSpeechRecognizer(settings).interpret({...input,audio:{...input.audio,data}},AbortSignal.timeout(1000)));
 assert.throws(()=>new GoogleSpeechRecognizer({...settings,model:geminiTextRate.model}),/pinned model/);
});
test('Transcribe accounting uses its speech rate and holds unknown usage',()=>{
 validateRateCard(geminiSpeechRate,Date.parse('2026-10-21T12:00:00Z'));assert.equal(worstCaseReservation(geminiSpeechRate),57344);
 const result={output:{},truncated:false,responseModel:geminiSpeechRate.model,usage:{promptTokenCount:500,candidatesTokenCount:30,thoughtsTokenCount:0,totalTokenCount:530}};
 assert.deepEqual(usageEstimate(geminiSpeechRate,result),{microusd:1360,violation:false});assert.deepEqual(usageEstimate(geminiSpeechRate,{...result,usage:null}),{microusd:null,violation:false});
 assert.equal(usageEstimate(geminiSpeechRate,{...result,usage:{promptTokenCount:4097,candidatesTokenCount:30,totalTokenCount:4127}}).violation,true);
 assert.equal(usageEstimate(geminiSpeechRate,{...result,usage:{...result.usage,toolUsePromptTokenCount:1}}).violation,true);
});
test('dedicated transcription is explicit, paid, multimodal and separate from the shopping model',()=>{
 const env={ALLOW_PAID_INFERENCE:'true',ALLOW_MULTIMODAL_INFERENCE:'true',GEMINI_API_KEY:'offline',AI_BUDGET_USD:'1',GEMINI_TRANSCRIPTION_MODEL:geminiSpeechRate.model};
 const configured=readNativeSettings(env);assert.equal(configured.model,geminiTextRate.model);assert.equal(configured.transcriptionModel,geminiSpeechRate.model);
 const provider=new GoogleInterpreter(configured);assert.equal(provider.recognitionProviderFor(input).billing?.model,geminiSpeechRate.model);assert.equal(provider.billing.model,geminiTextRate.model);
 const combined=new GoogleInterpreter({...configured,transcriptionModel:undefined});assert.equal(combined.recognitionProviderFor(input).billing?.model,geminiTextRate.model);assert.notEqual(provider.name,combined.name);
 for(const overrides of [{ALLOW_MULTIMODAL_INFERENCE:'false'},{ALLOW_PAID_INFERENCE:'false'},{ALLOW_FREE_INFERENCE:'true'},{GEMINI_TRANSCRIPTION_MODEL:'unreviewed'}])assert.throws(()=>readNativeSettings({...env,...overrides}),/Dedicated transcription/);
});
test('pinned SDK uses one real Interactions HTTP request with no GenerateContent configuration',async()=>{
 const original=globalThis.fetch;let calls=0,body:any;
 globalThis.fetch=async(url,init)=>{calls++;const request=new Request(url,init);assert.equal(new URL(request.url).pathname,'/v1beta/interactions');body=await request.json();return new Response(JSON.stringify(response('சரி')),{headers:{'Content-Type':'application/json'}});};
 try{const r=await new GoogleSpeechRecognizer(settings).interpret(input,AbortSignal.timeout(1000));assert.equal(calls,1);assert.equal((r.output as any).transcript,'சரி');assert.equal(body.model,geminiSpeechRate.model);assert.equal(body.generation_config.transcription_config.mode.type,'verbatim');assert.equal(body.generationConfig,undefined);assert.equal(body.store,false);}finally{globalThis.fetch=original;}
});
test('pinned SDK never hides a retry when the speech endpoint fails',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{code:503,status:'UNAVAILABLE',message:'fixture'}}),{status:503,headers:{'Content-Type':'application/json'}});};
 try{await assert.rejects(new GoogleSpeechRecognizer(settings).interpret(input,AbortSignal.timeout(1000)),(error:any)=>{assert.equal(error.status,503);return true;});assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
