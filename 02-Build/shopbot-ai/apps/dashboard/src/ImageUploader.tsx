import {useEffect,useRef,useState,type ChangeEvent} from 'react';
export type ImageUpload={id:string;mimeType:string;data:string;caption:string};
export function ImageUploader({disabled,onSend,onAttachment}:{disabled:boolean;onSend:(upload:ImageUpload)=>Promise<boolean>;onAttachment:(active:boolean)=>void}){
 const [photo,setPhoto]=useState<{file:File;url:string;id:string}|null>(null),[caption,setCaption]=useState(''),[error,setError]=useState(''),[sending,setSending]=useState(false);
 const input=useRef<HTMLInputElement>(null),url=useRef<string|null>(null),retry=useRef<ImageUpload|null>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(url.current)URL.revokeObjectURL(url.current);};},[]);
 function clear(){if(url.current)URL.revokeObjectURL(url.current);url.current=null;retry.current=null;setPhoto(null);setCaption('');setError('');if(input.current)input.current.value='';onAttachment(false);}
 function choose(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];if(!file)return;setError('');if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>2097152){setError('Choose a JPG, PNG or WebP photo under 2 MB.');event.target.value='';return;}if(url.current)URL.revokeObjectURL(url.current);url.current=URL.createObjectURL(file);retry.current=null;setPhoto({file,url:url.current,id:crypto.randomUUID()});setCaption('');onAttachment(true);}
 async function send(){if(!photo||sending)return;setSending(true);setError('');try{
   if(!retry.current){const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Could not read the photo.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(photo.file);});retry.current={id:photo.id,mimeType:photo.file.type,data,caption:caption.trim()};}
   const ok=await onSend(retry.current);if(alive.current){if(ok)clear();else setError('Could not complete the upload. Retry the same photo, or cancel.');}
 }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not read the photo.');}finally{if(alive.current)setSending(false);}}
 return <section className="image-uploader" aria-label="Product photo search">
   <input ref={input} className="sr-only" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose product photo" onChange={choose} disabled={disabled||sending}/>
   {photo?<div className="image-upload-preview"><img src={photo.url} alt="Product photo to send"/><div><label htmlFor="photo-caption">What are you looking for? (optional)</label><textarea id="photo-caption" value={caption} onChange={e=>setCaption(e.target.value)} maxLength={1000} rows={2} placeholder="Describe the product in Tamil or English…" disabled={disabled||sending||!!retry.current}/><p className="image-upload-note">Send shares this photo with Google Gemini for a catalog search. Check the suggested product photos before choosing.</p><div className="image-upload-actions"><button type="button" onClick={()=>{void send();}} disabled={disabled||sending}>{sending?'Checking photo…':retry.current?'Retry same photo':'Find matching products'}</button><button type="button" onClick={clear} disabled={sending}>Cancel photo</button></div></div></div>:<><button type="button" onClick={()=>input.current?.click()} disabled={disabled}>Upload image</button><small>Product photo · JPG, PNG or WebP · up to 2 MB</small></>}
   {error?<p role="alert">{error}</p>:null}
 </section>;
}
