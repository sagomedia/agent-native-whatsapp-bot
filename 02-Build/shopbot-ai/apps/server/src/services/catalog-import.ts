import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import {importManifestSchema,importItemSchema,importAgentPrompt,importExample} from '../../../../packages/contracts/catalog-import.js';
import {directProductDetails,addChatProduct,exactProductDuplicates} from './catalog-direct.js';
import {assertCatalogPermission,type CatalogPrincipal} from './catalog-chat.js';
import {imageUploadSchema} from './image-media.js';
export const catalogImportGuide=()=>({agentPrompt:importAgentPrompt,example:importExample,maximumProducts:200,imageLimitBytes:2097152,publication:'Complete products enter inventory directly. Existing products are never overwritten.'});
export const importApplySchema=z.object({batchId:importManifestSchema.shape.batchId,item:importItemSchema,photo:imageUploadSchema}).strict();
export function importDetails(item:z.infer<typeof importItemSchema>){const {id,image,price,quantity,...details}=item;return directProductDetails.parse({...details,pricePaise:Math.round(price*100),priceStatus:'priced',stock:quantity});}
export async function previewCatalogImport(pool:Pool,p:CatalogPrincipal,input:unknown){
 const manifest=importManifestSchema.parse(input),c=await pool.connect();
 try{await assertCatalogPermission(c,p,'catalog:read');const rows=[];for(const item of manifest.products){
  let issue='';try{importDetails(item);}catch{issue='Check selling unit and product specifications.';}
  const duplicates=await exactProductDuplicates(c,p.storeId,item.name,item.unit);
  rows.push({id:item.id,name:item.name,image:item.image,issue,duplicates});
 }return {batchId:manifest.batchId,rows};}finally{c.release();}
}
export async function applyCatalogImportItem(pool:Pool,p:CatalogPrincipal,input:unknown){
 const {batchId,item,photo}=importApplySchema.parse(input);
 const operationId=catalogImportOperationId(p.storeId,batchId,item.id);
 return addChatProduct(pool,p,{operationId,details:importDetails(item),photo});
}

export function catalogImportOperationId(storeId:string,batchId:string,itemId:string){
 const hash=createHash('sha256').update(JSON.stringify([storeId,batchId,itemId])).digest('hex');
 return hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-8'+hash.slice(17,20)+'-'+hash.slice(20,32);
}
