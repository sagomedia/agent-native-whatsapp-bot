import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {normalizeImage} from './image-media.js';
import type {Pool} from 'pg';
export async function catalogPhoto(pool:Pool,storeId:string,id:string,onlyActive=true){
 return (await pool.query(`SELECT f.image FROM catalog_photos f JOIN products p ON p.store_id=f.store_id AND p.image_path=('/catalog-images/custom/'||f.id::text||'.jpg') WHERE f.store_id=$1 AND f.id=$2 ${onlyActive?'AND p.active=true':''} LIMIT 1`,[storeId,id])).rows[0]?.image as Buffer|undefined;
}


// Staff inference can use a saved photo, including hidden items, after owner authentication.
// Product versions and store scoping prevent stale or other-shop photos from being used.
export async function loadSuggestionPhoto(pool:Pool,storeId:string,sku:string,version:number,withImage=true){
 const row=(await pool.query('SELECT version,image_path FROM products WHERE store_id=$1 AND sku=$2',[storeId,sku])).rows[0];
 if(!row)throw Object.assign(new Error('Product not found in this shop.'),{statusCode:404});
 if(row.version!==version)throw Object.assign(new Error('The saved product changed. Select it again before auto-filling.'),{statusCode:409});
 if(!withImage||!row.image_path)return undefined;
 const custom=/^\/catalog-images\/custom\/([a-f0-9-]{36})\.jpg$/.exec(row.image_path);
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
