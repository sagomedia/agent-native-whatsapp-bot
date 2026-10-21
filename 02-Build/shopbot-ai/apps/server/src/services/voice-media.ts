import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Pool} from 'pg';
import {ToolError,withConversation,type ActorContext} from './context.js';
export const voiceUploadSchema=z.object({id:z.uuid(),mimeType:z.enum(['audio/webm','audio/ogg','audio/mp4','audio/wav','audio/mpeg']),data:z.string().min(4).max(1398104).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)}).strict();
export const voiceDecodeTimeoutMs=45000;
export type VoiceMedia={audio:Buffer;durationSeconds:number;sourceHash:string};
export function pcmWav(pcm:Buffer){const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(36+pcm.length,4);h.write('WAVE',8);h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(16000,24);h.writeUInt32LE(32000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);}
// Decode only uploaded bytes: no shell, filesystem path, network source or client duration is trusted.
export async function normalizeVoice(input:z.infer<typeof voiceUploadSchema>):Promise<VoiceMedia>{
 const bytes=Buffer.from(input.data,'base64');if(bytes.length>1048576)throw new ToolError('Keep recordings under 1 MB.');
 const pcm=await new Promise<Buffer>((resolve,reject)=>{const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-threads','1','-filter_threads','1','-filter_complex_threads','1','-protocol_whitelist','pipe','-i','pipe:0','-t','31','-vn','-ac','1','-ar','16000','-f','s16le','pipe:1'],{stdio:['pipe','pipe','ignore']});const chunks:Buffer[]=[];let size=0,finished=false;const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new ToolError('Recording could not be decoded in time. Please try a shorter voice note.'));},voiceDecodeTimeoutMs);function finish(error?:Error){if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(Buffer.concat(chunks));}child.on('error',()=>finish(new ToolError('Voice decoder is unavailable. Please type your request.')));child.stdin.on('error',()=>{});child.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>992000){child.kill('SIGKILL');finish(new ToolError('Keep voice notes to 30 seconds.'));}else chunks.push(b);});child.on('close',code=>finish(code===0?undefined:new ToolError('That recording could not be read. Please record it again.')));child.stdin.end(bytes);});
 const durationSeconds=pcm.length/32000;if(durationSeconds<0.2||durationSeconds>30)throw new ToolError('Record between 0.2 and 30 seconds, then send your voice note.');
 let energy=0;for(let n=0;n<pcm.length;n+=2){const sample=pcm.readInt16LE(n);energy+=sample*sample;}if(Math.sqrt(energy/(pcm.length/2))<30)throw new ToolError('I could not hear anything in that recording. Please speak again or type your request.');
 return {audio:pcmWav(pcm),durationSeconds,sourceHash:createHash('sha256').update(input.mimeType).update(bytes).digest('hex')};
}
export async function loadVoice(pool:Pool,ctx:ActorContext,id:string){return withConversation(pool,ctx,async client=>{const row=(await client.query('SELECT audio,duration_seconds,source_version FROM voice_media WHERE id=$1 AND store_id=$2 AND conversation_id=$3 AND actor=$4',[id,ctx.storeId,ctx.conversationId,ctx.actor])).rows[0];if(!row)throw new ToolError('That voice note is not accessible to this conversation.','forbidden');return {mimeType:'audio/wav' as const,data:(row.audio as Buffer).toString('base64'),durationSeconds:Number(row.duration_seconds),sourceVersion:Number(row.source_version)};});}


// Playback can use the bounded original even if normalization failed. Inference
// continues to require loadVoice's decoded WAV; raw bytes never bypass it.
export async function loadVoicePlayback(pool:Pool,ctx:ActorContext,id:string){return withConversation(pool,ctx,async client=>{
 const row=(await client.query(`SELECT audio,'audio/wav' AS mime_type,0 AS priority FROM voice_media WHERE id=$1 AND store_id=$2 AND conversation_id=$3 AND actor=$4
 UNION ALL SELECT a.original_audio AS audio,a.original_mime_type AS mime_type,1 AS priority FROM whatsapp_media a JOIN messages m ON m.id=a.message_id JOIN conversations c ON c.id=m.conversation_id WHERE a.message_id=$1 AND a.kind='voice' AND a.original_audio IS NOT NULL AND m.payload->>'mediaId'=a.message_id::text AND c.store_id=$2 AND c.id=$3 AND c.actor=$4 ORDER BY priority LIMIT 1`,[id,ctx.storeId,ctx.conversationId,ctx.actor])).rows[0];
 if(!row)throw new ToolError('That voice note is not accessible to this conversation.','forbidden');
 return {mimeType:row.mime_type as string,data:(row.audio as Buffer).toString('base64')};
});}


export async function verifyVoiceDecoder(){
 const pcm=Buffer.alloc(8000);for(let n=0;n<4000;n++)pcm.writeInt16LE(Math.round(1000*Math.sin(n/10)),n*2);
 const media=await normalizeVoice({id:'00000000-0000-4000-8000-000000000000',mimeType:'audio/wav',data:pcmWav(pcm).toString('base64')});
 if(Math.abs(media.durationSeconds-.25)>.01)throw new Error('Audio decoder preflight produced an invalid duration');
 return {status:'ready' as const};
}
