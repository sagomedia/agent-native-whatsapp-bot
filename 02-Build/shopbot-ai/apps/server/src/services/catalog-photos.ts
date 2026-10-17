import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {normalizeImage} from './image-media.js';
import type {Pool,PoolClient} from 'pg';
import type {ImageMedia} from './image-media.js';

// Call inside catalogWrite's store lock. Reusing identical immutable bytes does
// not approve a photo for another product: that decision remains per product.
export async function saveCatalogPhoto(client:PoolClient,storeId:string,media:Pick<ImageMedia,'image'|'width'|'height'>){
 const contentHash=createHash('sha256').update(media.image).digest('hex');
 const existing=(await client.query('SELECT id FROM catalog_photos WHERE store_id=$1 AND content_hash=$2 AND width=$3 AND height=$4 LIMIT 1',[storeId,contentHash,media.width,media.height])).rows[0];
 if(existing)return existing.id as string;
 const id=randomUUID();
 await client.query('INSERT INTO catalog_photos(id,store_id,image,width,height,content_hash) VALUES($1,$2,$3,$4,$5,$6)',[id,storeId,media.image,media.width,media.height,contentHash]);
 return id;
}
export async function catalogPhoto(pool:Pool,storeId:string,id:string,onlyActive=true,kind:'custom'|'reference'='custom'){
 return (await pool.query(`SELECT f.image FROM catalog_photos f JOIN products p ON p.store_id=f.store_id AND p.image_path=('/catalog-images/'||$3::text||'/'||f.id::text||'.jpg') WHERE f.store_id=$1 AND f.id=$2 ${onlyActive?'AND p.active=true':''} LIMIT 1`,[storeId,id,kind])).rows[0]?.image as Buffer|undefined;
}


// Staff inference can use a saved photo, including hidden items, after owner authentication.
// Product versions and store scoping prevent stale or other-shop photos from being used.
export async function loadSuggestionPhoto(pool:Pool,storeId:string,sku:string,version:number,withImage=true){
 const row=(await pool.query('SELECT version,image_path FROM products WHERE store_id=$1 AND sku=$2',[storeId,sku])).rows[0];
 if(!row)throw Object.assign(new Error('Product not found in this shop.'),{statusCode:404});
 if(row.version!==version)throw Object.assign(new Error('The saved product changed. Select it again before auto-filling.'),{statusCode:409});
 if(!withImage||!row.image_path)return undefined;
 const custom=/^\/catalog-images\/(?:custom|reference)\/([a-f0-9-]{36})\.jpg$/.exec(row.image_path);
 if(custom){
  const photo=(await pool.query('SELECT image,width,height FROM catalog_photos WHERE store_id=$1 AND id=$2',[storeId,custom[1]])).rows[0];
  if(!photo)throw Object.assign(new Error('Saved photo not found. Choose a new photo.'),{statusCode:404});
  return {image:photo.image as Buffer,width:photo.width,height:photo.height,sourceHash:createHash('sha256').update('image/jpeg').update(photo.image).digest('hex')};
 }
 if(/^\/demo-images\/H\d{2}\.jpg$/.test(row.image_path)){
  let bytes:Buffer;try{bytes=await readFile(resolve('resources/catalog/ksmc-demo/images',row.image_path.split('/').at(-1)));}catch{throw Object.assign(new Error('Saved photo not found. Choose a new photo.'),{statusCode:404});}
  return normalizeImage({id:randomUUID(),mimeType:'image/jpeg',data:bytes.toString('base64'),caption:''});
 }
 throw Object.assign(new Error('Choose a new exact product photo.'),{statusCode:422});
}
