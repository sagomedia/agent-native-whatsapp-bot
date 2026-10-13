import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FinishReason,type GenerateContentParameters,type GenerateContentResponse} from '@google/genai';
import {GoogleSpeechRecognizer} from '../apps/server/src/adapters/google-speech-recognizer.js';
import {geminiSpeechRate,geminiTextRate,usageEstimate,validateRateCard,worstCaseReservation} from '../apps/server/src/services/inference-budget.js';
const settings={apiKey:'offline-only-key',budgetMicrousd:1000000};
const input={stage:'recognize' as const,text:'old transcript',state:{version:1,draft:[],pending:null,fulfillment:'pickup' as const,lastRequestId:null},audio:{mimeType:'audio/wav' as const,data:'AAAA',durationSeconds:20},history:[{direction:'customer',text:'old transcript'}]};
function response(transcript:string):GenerateContentResponse{return {modelVersion:geminiTextRate.model,candidates:[{finishReason:FinishReason.STOP,content:{parts:[{text:JSON.stringify({transcript})}]}}],usageMetadata:{promptTokenCount:1200,candidatesTokenCount:30,totalTokenCount:1230}} as GenerateContentResponse;}
test('recognition compatibility entry point sends one Flash Lite request without old conversation or ASR-only configuration',async()=>{
 let request:GenerateContentParameters|undefined,calls=0;
 const result=await new GoogleSpeechRecognizer(settings,{generateContent:async p=>{calls++;request=p;return response('இரண்டு wall stickers');}}).interpret(input,AbortSignal.timeout(1000));
 assert.equal(calls,1);assert.equal(request?.model,'gemini-3.5-flash-lite');assert.deepEqual(result.output,{transcript:'இரண்டு wall stickers',operations:[],next:'continue'});
 assert.ok(!JSON.stringify(request).includes('old transcript'));assert.equal(request?.config?.audioTranscriptionConfig,undefined);assert.equal(request?.config?.candidateCount,undefined);assert.equal(request?.config?.temperature,undefined);assert.equal(request?.config?.responseMimeType,'application/json');assert.equal(request?.config?.httpOptions?.retryOptions?.attempts,1);
});
test('empty, invalid and truncated transcripts retain strict recognition boundaries',async()=>{
 const result=await new GoogleSpeechRecognizer(settings,{generateContent:async()=>response('')}).interpret(input,AbortSignal.timeout(1000));assert.deepEqual(result.output,{operations:[],next:'continue'});
 const long=await new GoogleSpeechRecognizer(settings,{generateContent:async()=>response('x'.repeat(4001))}).interpret(input,AbortSignal.timeout(1000));assert.equal(long.output,null);assert.ok(long.validationIssues?.length);
 const cut=await new GoogleSpeechRecognizer(settings,{generateContent:async()=>({...response('one'),candidates:[{finishReason:FinishReason.MAX_TOKENS,content:{parts:[{text:'{}'}]}}]} as GenerateContentResponse)}).interpret(input,AbortSignal.timeout(1000));assert.equal(cut.truncated,true);
 await assert.rejects(new GoogleSpeechRecognizer(settings).interpret({...input,audio:{...input.audio,durationSeconds:31}},AbortSignal.timeout(1000)),/30 seconds/);
 assert.throws(()=>new GoogleSpeechRecognizer({...settings,model:'gemini-3.5-transcribe'}),/pinned model/);
});
test('speech accounting shares Flash Lite rates and retains unknown usage holds',()=>{
 assert.equal(geminiSpeechRate,geminiTextRate);validateRateCard(geminiSpeechRate,Date.parse('2026-10-13T12:00:00Z'));assert.equal(worstCaseReservation(geminiSpeechRate),324813);
 const result={output:{},truncated:false,responseModel:geminiTextRate.model,usage:{promptTokenCount:1200,candidatesTokenCount:30,totalTokenCount:1230}};
 assert.deepEqual(usageEstimate(geminiSpeechRate,result),{microusd:435,violation:false});assert.deepEqual(usageEstimate(geminiSpeechRate,{...result,usage:null}),{microusd:null,violation:false});
 assert.equal(usageEstimate(geminiSpeechRate,{...result,usage:{promptTokenCount:1200,candidatesTokenCount:4097,totalTokenCount:5297}}).violation,true);
});
test('official SDK sends the Flash Lite JSON recognition contract in one HTTP request',async()=>{
 const original=globalThis.fetch;let calls=0,body:any;
 globalThis.fetch=async(url,init)=>{calls++;const request=new Request(url,init);assert.match(request.url,/gemini-3\.5-flash-lite/);body=await request.json();return new Response(JSON.stringify(response('சரி')),{headers:{'Content-Type':'application/json'}});};
 try{const r=await new GoogleSpeechRecognizer(settings).interpret(input,AbortSignal.timeout(1000));assert.equal(calls,1);assert.equal((r.output as any).transcript,'சரி');assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.generationConfig.audioTranscriptionConfig,undefined);assert.equal(body.generationConfig.candidateCount,undefined);}finally{globalThis.fetch=original;}
});
