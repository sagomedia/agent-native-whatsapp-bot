import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Pool} from 'pg';
import {ToolError,withConversation,type ActorContext} from './context.js';
import type {CatalogImageVariant} from './catalog-image-variants.js';
const MAX_BYTES=2097152;
const DEFAULT_PROCESSING_TIMEOUT_MS=10000;
const MIN_PROCESSING_TIMEOUT_MS=1000;
const MAX_PROCESSING_TIMEOUT_MS=60000;
export const imageUploadSchema=z.object({id:z.uuid(),mimeType:z.enum(['image/jpeg','image/png','image/webp']),data:z.string().min(4).max(2796204).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),caption:z.string().trim().max(1000).default('')}).strict();
export type ImageMedia={image:Buffer;sourceHash:string;width:number;height:number;variants?:CatalogImageVariant[]};
function run(binary:string,args:string[],bytes:Buffer,maxOutput:number,processingTimeoutMs:number){return new Promise<Buffer>((resolve,reject)=>{
 const child=spawn(binary,args,{stdio:['pipe','pipe','ignore']});let finished=false,size=0;const chunks:Buffer[]=[];
 const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new ToolError('That image took too long to read. Try a smaller photo.'));},processingTimeoutMs);
 function finish(error?:Error){if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(Buffer.concat(chunks));}
 child.on('error',()=>finish(new ToolError('The image decoder is unavailable. Please describe the product instead.')));child.stdin.on('error',()=>{});
 child.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>maxOutput){child.kill('SIGKILL');finish(new ToolError('That photo is too large to process.'));}else chunks.push(b);});
 child.on('close',code=>finish(code===0?undefined:new ToolError('That image could not be read. Use a clear JPG, PNG or WebP photo.')));child.stdin.end(bytes);
});}
// Only uploaded raster bytes are accepted. No client filename/path/URL is opened.
export async function normalizeImage(input:z.infer<typeof imageUploadSchema>,options:{maxSide?:1280|2048;processingTimeoutMs?:number}={}):Promise<ImageMedia>{
 const processingTimeoutMs=options.processingTimeoutMs??DEFAULT_PROCESSING_TIMEOUT_MS;
 if(!Number.isInteger(processingTimeoutMs)||processingTimeoutMs<MIN_PROCESSING_TIMEOUT_MS||processingTimeoutMs>MAX_PROCESSING_TIMEOUT_MS)throw new ToolError('Image processing timeout must be an integer from 1000 to 60000 milliseconds.');
 const maxSide=options.maxSide??(process.env.GEMINI_HANDWRITTEN_LISTS_ENABLED==='true'?2048:1280);
 const bytes=Buffer.from(input.data,'base64');if(bytes.length>MAX_BYTES)throw new ToolError('Keep photos under 2 MB.');
 const detected=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
 if(detected!==input.mimeType)throw new ToolError('The file is not a supported JPG, PNG or WebP image.');
 const probe=JSON.parse((await run('ffprobe',['-v','error','-protocol_whitelist','pipe','-select_streams','v:0','-show_entries','stream=width,height','-of','json','-i','pipe:0'],bytes,8192,processingTimeoutMs)).toString());
 const {width,height}=probe.streams?.[0]??{};
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new ToolError('That image could not be read: no readable dimensions. Use a complete JPG, PNG or WebP file.','invalid_photo_bytes');
 if(width>8192||height>8192||width*height>16000000)throw new ToolError('Use a photo up to 16 megapixels and 8192 pixels per side.','photo_too_large');
 // A single bounded frame, without EXIF/location metadata or animation.
 const image=await run('ffmpeg',['-hide_banner','-loglevel','error','-threads','1','-protocol_whitelist','pipe','-i','pipe:0','-frames:v','1','-vf',`scale='min(${maxSide},iw)':'min(${maxSide},ih)':force_original_aspect_ratio=decrease`,'-map_metadata','-1','-q:v','3','-f','image2pipe','-vcodec','mjpeg','pipe:1'],bytes,MAX_BYTES,processingTimeoutMs);
 if(!image.length||image[0]!==255||image[1]!==216)throw new ToolError('That image could not be decoded.');
 const normalized=JSON.parse((await run('ffprobe',['-v','error','-protocol_whitelist','pipe','-select_streams','v:0','-show_entries','stream=width,height','-of','json','-i','pipe:0'],image,8192,processingTimeoutMs)).toString()).streams[0];
 return {image,width:normalized.width,height:normalized.height,sourceHash:createHash('sha256').update(input.mimeType).update(bytes).digest('hex')};
}
export async function loadImage(pool:Pool,ctx:ActorContext,id:string){return withConversation(pool,ctx,async client=>{
 const row=(await client.query('SELECT image,width,height,source_version FROM image_media WHERE id=$1 AND store_id=$2 AND conversation_id=$3 AND actor=$4',[id,ctx.storeId,ctx.conversationId,ctx.actor])).rows[0];if(!row)throw new ToolError('That image is not accessible to this conversation.','forbidden');
 return {mimeType:'image/jpeg' as const,data:(row.image as Buffer).toString('base64'),width:Number(row.width),height:Number(row.height),sourceVersion:Number(row.source_version)};
});}
