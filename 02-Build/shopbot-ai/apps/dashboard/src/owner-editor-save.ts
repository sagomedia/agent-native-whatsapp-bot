import {unchecked,type Verification} from './owner-verification.js';

export type PendingEditorPhoto={id:string;mimeType:string;data:string;caption:string;filename:string};
/** Commit the clean state only after the details and every pending photo are durable. */
export async function persistEditorDraft<T>(saveDetails:()=>Promise<T>,savePhoto:(draft:T)=>Promise<T>,complete:(draft:T)=>void):Promise<T>{
 const draft=await saveDetails();
 const saved=await savePhoto(draft);
 complete(saved);
 return saved;
}
export function prepareProductClone<T extends {sku:string;createId:string;version:number;inventoryVersion?:number;active:boolean;verified:boolean;verification:Verification}>(form:T,createId:string){
 return {form:{...form,sku:'',createId,version:0,inventoryVersion:undefined,active:false,verified:false,verification:unchecked()},proposal:null,draftAsset:'',withoutPhoto:false,selectedProduct:null};
}
/** Fetch first, then change editor identity: a failed copy leaves the source draft intact. */
export async function copyEditorPhoto(src:string,id:string,read:typeof fetch=fetch):Promise<PendingEditorPhoto>{
 const response=await read(src,{cache:'no-store'});
 if(!response.ok)throw new Error('Could not copy this photo. Try again or choose a photo before adding as new.');
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length>2097152)throw new Error('Choose a photo under 2 MB.');
 const mimeType=response.headers.get('content-type')?.split(';')[0]??'image/jpeg';
 if(!['image/jpeg','image/png','image/webp'].includes(mimeType))throw new Error('Could not copy this product photo. Choose a JPG, PNG or WebP.');
 let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
 return {id,mimeType,data:btoa(binary),caption:'',filename:'Copied product photo'};
}
