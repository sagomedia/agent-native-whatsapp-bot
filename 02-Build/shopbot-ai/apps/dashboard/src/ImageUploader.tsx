import {ui} from './customer-copy.js';
import {say,productName,unitName,localName,customerError,type ReplyLanguage} from '../../../packages/contracts/language.js';
import {useEffect,useRef,useState,type ChangeEvent} from 'react';
export type ImageUpload={id:string;mimeType:string;data:string;caption:string};
export function ImageUploader({language,disabled,onSend,onAttachment}:{language:ReplyLanguage;disabled:boolean;onSend:(upload:ImageUpload)=>Promise<boolean>;onAttachment:(active:boolean)=>void}){
 const [photo,setPhoto]=useState<{file:File;url:string;id:string}|null>(null),[caption,setCaption]=useState(''),[error,setError]=useState(''),[sending,setSending]=useState(false);
 const input=useRef<HTMLInputElement>(null),url=useRef<string|null>(null),retry=useRef<ImageUpload|null>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(url.current)URL.revokeObjectURL(url.current);};},[]);
 function clear(){if(url.current)URL.revokeObjectURL(url.current);url.current=null;retry.current=null;setPhoto(null);setCaption('');setError('');if(input.current)input.current.value='';onAttachment(false);}
 function choose(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];if(!file)return;setError('');if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>2097152){setError(ui(language,"Choose a JPG, PNG or WebP photo under 2 MB."));event.target.value='';return;}if(url.current)URL.revokeObjectURL(url.current);url.current=URL.createObjectURL(file);retry.current=null;setPhoto({file,url:url.current,id:crypto.randomUUID()});setCaption('');onAttachment(true);}
 async function send(){if(!photo||sending)return;setSending(true);setError('');try{
   if(!retry.current){const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error(ui(language,"Could not read the photo.")));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(photo.file);});retry.current={id:photo.id,mimeType:photo.file.type,data,caption:caption.trim()};}
   const ok=await onSend(retry.current);if(alive.current){if(ok)clear();else setError(ui(language,"Could not complete the upload. Retry the same photo, or cancel."));}
 }catch(e){if(alive.current)setError(e instanceof Error?customerError(e.message,language):ui(language,"Could not read the photo."));}finally{if(alive.current)setSending(false);}}
 return <section className="image-uploader" aria-label={ui(language,"Product photo search")}>
   <input ref={input} className="sr-only" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" aria-label={ui(language,"Choose product photo")} onChange={choose} disabled={disabled||sending}/>
   {photo?<div className="image-upload-preview"><img src={photo.url} alt={ui(language,"Product photo to send")}/><div><label htmlFor="photo-caption">{ui(language,"What are you looking for? (optional)")}</label><textarea id="photo-caption" value={caption} onChange={e=>setCaption(e.target.value)} maxLength={1000} rows={2} placeholder={ui(language,"Describe the product in Tamil or English…")} disabled={disabled||sending||!!retry.current}/><p className="image-upload-note">{ui(language,"Send shares this photo with Google Gemini for a catalog search. Check the suggested product photos before choosing.")}</p><div className="image-upload-actions"><button type="button" onClick={()=>{void send();}} disabled={disabled||sending}>{sending?ui(language,"Checking photo…"):retry.current?ui(language,"Retry same photo"):ui(language,"Find matching products")}</button><button type="button" onClick={clear} disabled={sending}>{ui(language,"Cancel photo")}</button></div></div></div>:<><button type="button" onClick={()=>input.current?.click()} disabled={disabled}>{ui(language,"Upload image")}</button><small>{ui(language,"Product photo · JPG, PNG or WebP · up to 2 MB")}</small></>}
   {error?<p role="alert">{error}</p>:null}
 </section>;
}
