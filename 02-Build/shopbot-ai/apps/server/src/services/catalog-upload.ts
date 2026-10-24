import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {ToolError} from './context.js';
import {chatError} from './catalog-chat.js';
import {catalogFileSchema,downloadCatalogPhoto} from './catalog-file-handoff.js';
import {imageUploadSchema} from './image-media.js';
import {prepareProposalAsset} from './catalog-proposals.js';

export const catalogUploadSchema=z.object({
 photo:imageUploadSchema.describe('Actual raster bytes: {id: UUID, mimeType: image/jpeg|image/png|image/webp, data: raw Base64}. Not a path, URL, data URI or JSON string.').optional(),
 file:catalogFileSchema.optional()
}).superRefine((p,c)=>{if(!!p.photo===!!p.file)c.addIssue({code:'custom',message:'Supply exactly one photo object with actual Base64 bytes, or one host file object with download_url and file_id. Local paths are not uploads.'});});
export const catalogUploadCapabilities={
 formats:['image/jpeg','image/png','image/webp'],maxBytes:2097152,maxBase64Characters:2796204,
 methods:{photo:{id:'UUID',mimeType:'image/webp',data:'RAW_BASE64_OF_FILE_BYTES'},file:{download_url:'https://files.oaiusercontent.com/…',file_id:'host-file-id',mime_type:'image/webp',file_name:'product.webp'}},
 localPathsSupported:false,arbitraryUrlsSupported:false,serverGeneratesImages:false,
 recovery:'If the host cannot supply a downloadable attachment, read its local file and supply photo as an object with actual Base64 bytes. Do not invent bytes, URLs or attachment IDs. If no byte-transfer capability exists, report that client limitation and retain facts in chat; do not save a new-product draft. Retry the corrected request with the same operationId after checking workflow_status.',
 publication:'A complete new product goes directly to inventory using catalog_add_product. No draft or dashboard approval step.'
};
function rasterMime(bytes:Buffer){return bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':undefined;}
/** Trust verified raster signatures rather than a client filename or MIME label. Decoding remains mandatory. */
export async function resolveCatalogUpload(input:unknown,download=downloadCatalogPhoto){
 const p=catalogUploadSchema.parse(input);
 let photo=p.photo;
 if(!photo){try{photo={id:randomUUID(),...await download(p.file!.download_url),caption:''};}catch(e){if((e as {statusCode?:number}).statusCode)throw e;throw chatError('file_download_failed','The host attachment could not be downloaded. Obtain a fresh host URL or send actual Base64 photo bytes.',400);}}
 const bytes=Buffer.from(photo.data,'base64');
 if(bytes.length>2097152)throw chatError('photo_too_large','Use a product photo under 2 MB.',400);
 const mimeType=rasterMime(bytes);
 if(!mimeType)throw chatError('invalid_photo_bytes','The supplied bytes are not a JPG, PNG or WebP image. Read and encode the actual file; do not send a path, data URI or placeholder.',400);
 return {...photo,mimeType};
}
export async function prepareCatalogUpload(input:Parameters<typeof prepareProposalAsset>[0]){
 try{return await prepareProposalAsset(input);}catch(e){
  if(e instanceof ToolError){const message=e.message;
   const code=/unavailable/.test(message)?'photo_decoder_unavailable':/too long/.test(message)?'photo_processing_timeout':/large|megapixel/.test(message)?'photo_too_large':'invalid_photo_bytes';
   throw chatError(code,message,code==='photo_decoder_unavailable'?503:400);
  }
  if(e instanceof z.ZodError)throw e;
  throw chatError('photo_processing_failed','The product photo could not be processed. Check the uploaded bytes with catalog_validate_photo; retry with a smaller JPG if necessary.',400);
 }
}
export async function validateCatalogUpload(input:unknown,download=downloadCatalogPhoto){
 const photo=await resolveCatalogUpload(input,download);
 const prepared=await prepareCatalogUpload({proposalId:randomUUID(),version:1,photo,matchKind:'exact'});
 return {valid:true,mimeType:photo.mimeType,bytes:Buffer.from(photo.data,'base64').length,sha256:createHash('sha256').update(Buffer.from(photo.data,'base64')).digest('hex'),width:prepared.media.width,height:prepared.media.height,previewCount:prepared.media.variants?.length??0,persisted:false,nextStep:'Use these same original bytes in catalog_add_product with the complete seller facts.'};
}
