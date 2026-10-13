import {GoogleInterpreter,type GoogleTransport} from './google-interpreter.js';
import {geminiTextRate,type RateCard} from '../services/inference-budget.js';
import type {Interpreter,InterpretationInput,ProviderResult} from './interpreter.js';
export type SpeechRecognizerSettings={apiKey:string;model?:string;budgetMicrousd:number};
/** Compatibility entry point; recognition uses the same Flash Lite model. */
export class GoogleSpeechRecognizer implements Interpreter {
 readonly mode='live' as const;
 readonly supportsAudio=true;
 readonly name=`google:${geminiTextRate.model}`;
 readonly billing:RateCard={...geminiTextRate};
 private readonly provider:GoogleInterpreter;
 constructor(settings:SpeechRecognizerSettings,transport?:GoogleTransport){
  if(!settings.apiKey||settings.model!==undefined&&settings.model!==geminiTextRate.model||!Number.isSafeInteger(settings.budgetMicrousd)||settings.budgetMicrousd<=0)throw new Error('Live speech recognition requires a pinned model and positive budget.');
  this.provider=new GoogleInterpreter({...settings,model:geminiTextRate.model,allowPaidInference:true,allowMultimodal:true},transport);
 }
 validateInput(input:InterpretationInput){
  if(input.stage!=='recognize'||input.image||!input.audio||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.audio.data))throw new Error('Recognition requires one verified WAV recording of up to 30 seconds.');
  this.provider.validateInput(input);
 }
 async interpret(input:InterpretationInput,signal:AbortSignal):Promise<ProviderResult>{this.validateInput(input);return this.provider.interpret(input,signal);}
}
