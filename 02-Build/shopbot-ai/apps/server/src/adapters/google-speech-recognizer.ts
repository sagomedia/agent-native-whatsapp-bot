import {voiceLimits,voiceWavBase64Limit} from '../../../../packages/contracts/voice-policy.js';
import {GoogleGenAI,type Interactions} from '@google/genai';
import {geminiSpeechRate,validateRateCard,type RateCard} from '../services/inference-budget.js';
import {admitInferenceRequest} from '../services/inference-admission.js';
import {providerSdkTimeout} from '../services/inference-timing.js';
import type {Interpreter,InterpretationInput,ProviderResult} from './interpreter.js';

export type SpeechRecognizerSettings={apiKey:string;model?:string;budgetMicrousd:number};
export type SpeechRequest=Interactions.CreateModelInteractionParamsNonStreaming;
export type SpeechTransport={create(request:SpeechRequest,options:{signal:AbortSignal;timeout:number;maxRetries:number}):Promise<Interactions.Interaction>};

/** Recognizes only the current audio. Shopping context never reaches ASR. */
export class GoogleSpeechRecognizer implements Interpreter {
 readonly mode='live' as const;
 readonly supportsAudio=true;
 readonly name=`google:${geminiSpeechRate.model}:verbatim-v1`;
 readonly billing:RateCard={...geminiSpeechRate};
 private readonly transport:SpeechTransport;
 constructor(settings:SpeechRecognizerSettings,transport?:SpeechTransport){
  if(!settings.apiKey||settings.model!==undefined&&settings.model!==geminiSpeechRate.model||!Number.isSafeInteger(settings.budgetMicrousd)||settings.budgetMicrousd<=0)throw new Error('Live speech recognition requires a pinned model and positive budget.');
  this.transport=transport??new GoogleGenAI({apiKey:settings.apiKey,vertexai:false,httpOptions:{apiVersion:'v1beta',retryOptions:{attempts:1}}}).interactions;
 }
 validateInput(input:InterpretationInput){
  const a=input.audio;
  if(input.stage!=='recognize'||input.image||!a||a.mimeType!=='audio/wav'||!Number.isFinite(a.durationSeconds)||a.durationSeconds<=0||a.durationSeconds>voiceLimits.maxSeconds||!a.data||a.data.length>voiceWavBase64Limit||(a.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)))throw new Error('Recognition requires one verified WAV recording of up to 90 seconds.');
 }
 prepareInput(input:InterpretationInput){
  validateRateCard(this.billing);this.validateInput(input);
  const request:SpeechRequest={model:this.billing.model,store:false,input:[{type:'audio',mime_type:'audio/wav',data:input.audio!.data}],generation_config:{max_output_tokens:this.billing.maxOutputTokens,transcription_config:{mode:{type:'verbatim'}}}};
  const admission=admitInferenceRequest(request,this.billing.maxOutputTokens);
  return {admission,interpret:async(signal:AbortSignal):Promise<ProviderResult>=>{
   // One SDK/HTTP request per committed attempt; retry only in the runtime.
   let r:Interactions.Interaction;
   try{r=await this.transport.create(request,{signal,timeout:providerSdkTimeout(input),maxRetries:0});}
   catch(error){
    const status=error&&typeof error==='object'?('status' in error?error.status:'statusCode' in error?error.statusCode:undefined):undefined;
    if(typeof status==='number'&&Number.isInteger(status)&&status>=400&&status<=599)throw Object.assign(new Error('Speech recognition request failed.'),{status});
    throw error;
   }
   const usage=r.usage?Object.fromEntries(Object.entries({promptTokenCount:r.usage.total_input_tokens,candidatesTokenCount:r.usage.total_output_tokens,thoughtsTokenCount:r.usage.total_thought_tokens,totalTokenCount:r.usage.total_tokens,cachedContentTokenCount:r.usage.total_cached_tokens,toolUsePromptTokenCount:r.usage.total_tool_use_tokens}).filter(([,v])=>v!==undefined)) as Record<string,number>:null;
   const steps=r.steps??[];
   const transcript=steps.flatMap(s=>s.type==='model_output'?s.content??[]:[]).filter(c=>c.type==='text').map(c=>c.text??'').join('').trim();
   const valid=r.status==='completed'&&r.model===this.billing.model&&!r.errors?.length&&steps.every(s=>s.type==='model_output'&&!s.error&&(s.content??[]).every(c=>c.type==='text'))&&transcript.length<=4000;
   return {output:valid?{...(transcript?{transcript}:{}),operations:[],next:'continue'}:null,truncated:r.status==='incomplete',usage,responseModel:r.model,...(!valid?{validationIssues:[{path:'transcript',code:'invalid_transcription'}]}:{})};
  }};
 }
 async interpret(input:InterpretationInput,signal:AbortSignal):Promise<ProviderResult>{return this.prepareInput(input).interpret(signal);}
}
