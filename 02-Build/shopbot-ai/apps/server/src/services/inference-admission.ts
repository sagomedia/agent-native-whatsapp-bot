import {createHash} from 'node:crypto';
import type {GenerateContentParameters} from '@google/genai';
import {ToolError} from './context.js';

export const inputAdmissionLimits=Object.freeze({textBytes:65536,imageBytes:2097152,audioBytes:960044,maxOutputTokens:16384});
export type InputAdmission={requestHash:string;textBytes:number;mediaBytes:number;maxOutputTokens:number;reservationBasis:'model_context_limit'};

// Count every actual prompt, system instruction and schema byte, including the
// unified understanding path. Media stays separately bounded by ingress and
// this request check. A full model-context reservation remains in place until
// exact multimodal token counting is validated in the controlled live pilot.
export function admitRequest(request:GenerateContentParameters):InputAdmission {
  return admitInferenceRequest(request,request.config?.maxOutputTokens);
}
export function admitInferenceRequest(request:unknown,maxOutputTokens:number|undefined):InputAdmission {
  let mediaBytes=0;
  const json=JSON.stringify(request,(_key,value)=>{
    if(value&&typeof value==='object'&&('mimeType' in value||'mime_type' in value)&&'data' in value){
      if(typeof value.data!=='string'||!value.data||value.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.data))throw new ToolError('Invalid inference media.','inference_input_invalid');
      const bytes=Buffer.from(value.data,'base64').length;
      const mimeType=value.mimeType??value.mime_type;
      const cap=mimeType==='image/jpeg'?inputAdmissionLimits.imageBytes:mimeType==='audio/wav'?inputAdmissionLimits.audioBytes:0;
      if(!cap||bytes>cap)throw new ToolError('Inference media is too large. Your list is retained.','inference_input_too_large');
      mediaBytes+=bytes;
      return {mimeType,bytes};
    }
    if(_key==='abortSignal'||_key==='httpOptions')return undefined;
    return value;
  });
  const textBytes=Buffer.byteLength(json,'utf8');
  if(textBytes>inputAdmissionLimits.textBytes)throw new ToolError('Native context is too large, including instructions and schema. Narrow the request; your list is retained.','inference_input_too_large');
  if(mediaBytes>inputAdmissionLimits.imageBytes||!Number.isSafeInteger(maxOutputTokens)||!maxOutputTokens||maxOutputTokens<1||maxOutputTokens>inputAdmissionLimits.maxOutputTokens)throw new ToolError('Invalid bounded inference request.','inference_input_invalid');
  const requestHash=createHash('sha256').update(JSON.stringify(request,(_key,value)=>_key==='abortSignal'||_key==='httpOptions'?undefined:value)).digest('hex');
  return {requestHash,textBytes,mediaBytes,maxOutputTokens,reservationBasis:'model_context_limit'};
}
