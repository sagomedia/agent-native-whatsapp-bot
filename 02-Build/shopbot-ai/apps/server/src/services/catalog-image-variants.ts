import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {FastifyReply,FastifyRequest} from 'fastify';
import type {Pool,PoolClient} from 'pg';

export const catalogImageSizes=[128,256,640] as const;
export type CatalogImageSize=typeof catalogImageSizes[number];
export type CatalogImageVariant={size:CatalogImageSize;image:Buffer;contentHash:string};
export const imageHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function catalogImageSize(value:unknown):CatalogImageSize|undefined {
 if(value===undefined)return undefined;
 if(typeof value==='string'&&catalogImageSizes.some(size=>String(size)===value))return Number(value) as CatalogImageSize;
 throw Object.assign(new Error('Choose image size 128, 256 or 640.'),{statusCode:400});
}

/** Called at ingestion/backfill only. Requests never invoke an image decoder. */
export async function prepareCatalogImageVariants(bytes:Buffer,processingTimeoutMs=10000):Promise<CatalogImageVariant[]> {
 if(!Number.isInteger(processingTimeoutMs)||processingTimeoutMs<1000||processingTimeoutMs>60000)throw Error('Image processing timeout must be an integer from 1000 to 60000 milliseconds.');
 if(!bytes.length||bytes.length>2097152)throw Error('Keep catalog images under 2 MB.');
 const variants:CatalogImageVariant[]=[];
 for(const size of catalogImageSizes){
  const image=await new Promise<Buffer>((done,reject)=>{
   const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-threads','1','-protocol_whitelist','pipe','-i','pipe:0','-frames:v','1','-vf',`scale='min(${size},iw)':'min(${size},ih)':force_original_aspect_ratio=decrease`,'-map_metadata','-1','-q:v','5','-f','image2pipe','-vcodec','mjpeg','pipe:1'],{stdio:['pipe','pipe','ignore']});
   const chunks:Buffer[]=[];let length=0,finished=false;
   const finish=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):done(Buffer.concat(chunks));};
   const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('Catalog image preview took too long to prepare.'));},processingTimeoutMs);
   child.on('error',()=>finish(new Error('Catalog image preview decoder unavailable.')));child.stdin.on('error',()=>{});
   child.stdout.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>2097152){child.kill('SIGKILL');finish(new Error('Catalog image preview exceeded its byte limit.'));}else chunks.push(chunk);});
   child.on('close',code=>finish(code===0?undefined:new Error('Catalog image preview could not be prepared.')));child.stdin.end(bytes);
  });
  if(image[0]!==255||image[1]!==216)throw Error('Catalog preview is not a JPEG.');
  variants.push({size,image,contentHash:imageHash(image)});
 }
 return variants;
}

export async function saveCatalogImageVariants(client:PoolClient,storeId:string,sourceHash:string,variants:CatalogImageVariant[]){
 for(const variant of variants)await client.query(`INSERT INTO catalog_image_variants(store_id,source_hash,max_side,image,content_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(store_id,source_hash,max_side) DO NOTHING`,[storeId,sourceHash,variant.size,variant.image,variant.contentHash]);
}

/** Resource/store authorization must finish before calling this, including 304s. */
export function sendOwnerCatalogImage(request:FastifyRequest,reply:FastifyReply,bytes:Buffer,mimeType='image/jpeg'){
 const etag='"'+imageHash(bytes)+'"';
 reply.header('Cache-Control','private, no-cache, max-age=0').header('ETag',etag).header('Vary','Cookie, CF-Access-Jwt-Assertion').type(mimeType);
 const candidates=request.headers['if-none-match'];
 if(typeof candidates==='string'&&candidates.split(',').some(candidate=>candidate.trim()==='*'||candidate.trim().replace(/^W\//,'')===etag))return reply.code(304).send();
 return reply.send(bytes);
}

/** Immutable source bytes are scoped to a shop; variants are safe to share only within that shop. */
export async function ownerCatalogProductImage(pool:Pool,storeId:string,sku:string,size?:CatalogImageSize):Promise<Buffer|undefined>{
 const row=(await pool.query(`SELECT p.image_path,COALESCE(v.image,f.image) AS image FROM products p
  LEFT JOIN catalog_photos f ON f.store_id=p.store_id AND p.image_path IN ('/catalog-images/custom/'||f.id::text||'.jpg','/catalog-images/reference/'||f.id::text||'.jpg')
  LEFT JOIN catalog_image_variants v ON v.store_id=f.store_id AND v.source_hash=f.content_hash AND v.max_side=$3
  WHERE p.store_id=$1 AND p.sku=$2`,[storeId,sku,size??null])).rows[0];
 if(row?.image)return row.image as Buffer;
 if(!/^\/demo-images\/H\d{2}\.jpg$/.test(row?.image_path??''))return undefined;
 let bytes:Buffer;try{bytes=await readFile(resolve('resources/catalog/ksmc-demo/images',row.image_path.split('/').at(-1)));}catch{return undefined;}
 if(!size)return bytes;
 return (await pool.query('SELECT image FROM catalog_image_variants WHERE store_id=$1 AND source_hash=$2 AND max_side=$3',[storeId,imageHash(bytes),size])).rows[0]?.image as Buffer|undefined??bytes;
}

export type VariantBackfillOptions={limit?:number;after?:string;apply?:boolean;processingTimeoutMs?:number};
/** One bounded page, one source at a time. A failed source leaves the resume cursor before it. */
export async function backfillCatalogImageVariants(pool:Pool,storeId:string,options:VariantBackfillOptions={}){
 const limit=options.limit??25,after=options.after??'';
 if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Choose a backfill limit from 1 to 100.');
 if(after&&!/^(?:catalog:[a-f0-9-]{36}|proposal:[a-f0-9-]{36}|demo:H\d{2}\.jpg)$/.test(after))throw Error('Invalid image backfill cursor.');
 if(!(await pool.query('SELECT 1 FROM stores WHERE id=$1',[storeId])).rowCount)throw Error('Shop not found.');
 const sources=(await pool.query(`SELECT source FROM (
   SELECT 'catalog:'||id::text AS source FROM catalog_photos WHERE store_id=$1
   UNION ALL SELECT 'proposal:'||id::text FROM catalog_proposal_assets WHERE store_id=$1
   UNION SELECT 'demo:'||substring(image_path from '/([^/]+)$') FROM products WHERE store_id=$1 AND image_path ~ '^/demo-images/H[0-9]{2}\\.jpg$'
  ) sources WHERE source>$2 ORDER BY source LIMIT $3`,[storeId,after,limit+1])).rows as {source:string}[];
 let nextCursor=after,processed=0,created=0,originalBytes=0,variantBytes=0;
 const failures:{source:string;message:string}[]=[],items:{source:string;missing:number;originalBytes:number;variantBytes:number}[]=[];
 for(const {source} of sources.slice(0,limit)){
  try{
   const separator=source.indexOf(':'),kind=source.slice(0,separator),id=source.slice(separator+1);
   const bytes=kind==='demo'?await readFile(resolve('resources/catalog/ksmc-demo/images',id)):(await pool.query(`SELECT image FROM ${kind==='catalog'?'catalog_photos':'catalog_proposal_assets'} WHERE store_id=$1 AND id=$2`,[storeId,id])).rows[0]?.image as Buffer|undefined;
   if(!bytes)throw Error('Source image is unavailable.');
   const sourceHash=imageHash(bytes);
   const existing=(await pool.query('SELECT max_side,octet_length(image)::int AS bytes FROM catalog_image_variants WHERE store_id=$1 AND source_hash=$2',[storeId,sourceHash])).rows as {max_side:number;bytes:number}[];
   const missing=catalogImageSizes.length-existing.length;let storedBytes=existing.reduce((sum,v)=>sum+v.bytes,0);
   if(options.apply){
    const variants=missing?await prepareCatalogImageVariants(bytes,options.processingTimeoutMs):[];
    const client=await pool.connect();try{
     await client.query('BEGIN');await saveCatalogImageVariants(client,storeId,sourceHash,variants);
     if(kind==='catalog')await client.query('UPDATE catalog_photos SET content_hash=$3 WHERE store_id=$1 AND id=$2 AND content_hash IS DISTINCT FROM $3',[storeId,id,sourceHash]);
     if(kind==='proposal')await client.query('UPDATE catalog_proposal_assets SET image_hash=$3 WHERE store_id=$1 AND id=$2 AND image_hash IS DISTINCT FROM $3',[storeId,id,sourceHash]);
     await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    if(variants.length)storedBytes=variants.reduce((sum,v)=>sum+v.image.length,0);created+=missing;
   }
   originalBytes+=bytes.length;variantBytes+=storedBytes;processed++;nextCursor=source;
   items.push({source,missing,originalBytes:bytes.length,variantBytes:storedBytes});
  }catch{failures.push({source,message:'Image preview preparation failed. Resume from nextCursor to retry this source.'});break;}
 }
 return {readOnly:!options.apply,storeId,processed,created,originalBytes,variantBytes,items,failures,nextCursor,hasMore:failures.length>0||sources.length>limit};
}
