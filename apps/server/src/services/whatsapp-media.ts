import {voiceLimits} from '../../../../packages/contracts/voice-policy.js';
import {normalizeImage,imageUploadSchema} from './image-media.js';
import {normalizeVoiceBytes,voiceMimeSchema} from './voice-media.js';
import type {WhatsAppConfig} from './whatsapp-config.js';

class MediaDownloadError extends Error {
  constructor(readonly code:string,message:string){super(message);}
}
export function mediaFailureCode(error:unknown){
  if(error instanceof MediaDownloadError)return error.code;
  const message=error instanceof Error?error.message:'';
  if(/decoded in time|took too long/.test(message))return 'media_decode_timeout';
  if(/decoder is unavailable/.test(message))return 'media_decoder_unavailable';
  if(/(?:30|90) seconds|between 0.2/.test(message))return 'media_duration_invalid';
  if(/could not hear/.test(message))return 'media_silent';
  return 'media_decode_failed';
}

async function boundedBytes(response:Response,maximum:number){
  if(!response.ok||!response.body)throw new MediaDownloadError(`media_http_${response.status}`,'Media download failed');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum)throw new MediaDownloadError('media_too_large','Media is too large');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  if(!size)throw new MediaDownloadError('media_empty','Media is empty');
  return Buffer.concat(chunks);
}
async function downloadBytes(config:WhatsAppConfig,request:typeof fetch,url:string,maximum:number){
  // Only downloads retry: never inference, unsafe media, authentication errors or rate limits.
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await request(url,{headers:{authorization:'Bearer '+config.accessToken},signal:AbortSignal.timeout(8000),redirect:'error'});
      if(attempt===0&&response.status>=500){await response.body?.cancel();continue;}
      return await boundedBytes(response,maximum);
    }catch(error){
      if(error instanceof MediaDownloadError)throw error;
      if(attempt===1)throw new MediaDownloadError('media_network_failed','Media download connection failed');
    }
  }
  throw new MediaDownloadError('media_network_failed','Media download connection failed');
}
export type DownloadedVoice={audio:Buffer;mimeType:string};
export async function downloadWhatsAppMedia(config:WhatsAppConfig,request:typeof fetch,mediaId:string,kind:'image'|'voice',messageId:string,onVoiceDownloaded?:(source:DownloadedVoice)=>Promise<void>){
  if(!/^\d{1,100}$/.test(mediaId))throw new MediaDownloadError('media_invalid_id','Invalid media identifier');
  const metadata=JSON.parse((await downloadBytes(config,request,`https://graph.facebook.com/${config.graphVersion}/${mediaId}`,8192)).toString()) as {url?:string;mime_type?:string;file_size?:number};
  let url:URL;
  try{url=new URL(metadata.url??'');}catch{throw new MediaDownloadError('media_untrusted_host','Untrusted media host');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!(url.hostname==='lookaside.fbsbx.com'||url.hostname==='lookaside.facebook.com'||url.hostname.endsWith('.fbcdn.net')))throw new MediaDownloadError('media_untrusted_host','Untrusted media host');
  const maximum=kind==='image'?2097152:voiceLimits.uploadBytes;
  if(!Number.isSafeInteger(metadata.file_size)||metadata.file_size!<=0||metadata.file_size!>maximum)throw new MediaDownloadError('media_too_large','Media is too large');
  const bytes=await downloadBytes(config,request,url.href,maximum),mimeType=metadata.mime_type?.split(';')[0].trim();
  if(kind==='voice'){
    const type=voiceMimeSchema.parse(mimeType);
    if(!bytes.length)throw new MediaDownloadError('media_decode_failed','The recording was empty');
    await onVoiceDownloaded?.({audio:bytes,mimeType:type});
    return normalizeVoiceBytes(bytes,type);
  }
  return normalizeImage(imageUploadSchema.parse({id:messageId,data:bytes.toString('base64'),mimeType,caption:''}));
}
