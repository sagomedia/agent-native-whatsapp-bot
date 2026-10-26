import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {useOwnerLocale} from './owner-locale.js';

type Photo={src:string;name:string};
const PhotoContext=createContext<(photo:Photo)=>void>(()=>{});
export const useOwnerPhoto=()=>useContext(PhotoContext);

export function OwnerPhotoProvider({children}:{children:ReactNode}){
 const [photo,setPhoto]=useState<Photo|null>(null);
 return <PhotoContext.Provider value={setPhoto}>{children}{photo?<PhotoViewer key={photo.src} photo={photo} onClose={()=>setPhoto(null)}/>:null}</PhotoContext.Provider>;
}

function PhotoViewer({photo,onClose}:{photo:Photo;onClose:()=>void}){
 const {t}=useOwnerLocale(),dialog=useRef<HTMLDialogElement>(null),entry=useRef(''),closing=useRef(false);
 const closeRef=useRef(onClose);closeRef.current=onClose;
 const [zoom,setZoom]=useState(false),[error,setError]=useState(false);
 useEffect(()=>{
  const opener=document.activeElement as HTMLElement|null,previousState=history.state;
  entry.current=crypto.randomUUID();history.pushState({...previousState,shopbotPhoto:entry.current},'');
  const back=()=>closeRef.current();window.addEventListener('popstate',back);dialog.current?.showModal();
  return()=>{
   window.removeEventListener('popstate',back);dialog.current?.close();
   if(history.state?.shopbotPhoto===entry.current)history.replaceState(previousState,'');
   if(opener?.isConnected)opener.focus({preventScroll:true});
  };
 },[]);
 function close(){if(closing.current)return;closing.current=true;if(history.state?.shopbotPhoto===entry.current)history.back();else onClose();}
 return <dialog ref={dialog} className="rd-photo-viewer" aria-label={t('Product photo')} onCancel={event=>{event.preventDefault();close();}}>
  <header><strong>{photo.name}</strong><div><button type="button" disabled={error} aria-pressed={zoom} onClick={()=>setZoom(value=>!value)}>{t(zoom?'Zoom out':'Zoom in')}</button><button type="button" autoFocus aria-label={t('Close photo')} onClick={close}>×</button></div></header>
  <div className={'rd-photo-surface'+(zoom?' is-zoomed':'')}>
   {error?<p role="alert">{t('This photo could not be loaded.')} <button type="button" onClick={()=>setError(false)}>{t('Try again')}</button></p>:<img src={photo.src} alt={photo.name} onError={()=>setError(true)}/>}
  </div>
 </dialog>;
}
