import {useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type AnchorHTMLAttributes} from 'react';

const navigationEvent = 'shopbot:owner-navigation';
function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(navigationEvent, listener);
  return () => {window.removeEventListener('popstate', listener); window.removeEventListener(navigationEvent, listener);};
}
export function useOwnerUrl() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '');
  return new URLSearchParams(search);
}
function ownerUrl(values: Record<string,string|null>) {
  const url = new URL(window.location.href);
  for (const [key,value] of Object.entries(values)) {
    if(value===null || value==='')url.searchParams.delete(key);else url.searchParams.set(key,value);
  }
  return url;
}
export function navigateOwner(values: Record<string, string | null>, replace = false) {
  const url = ownerUrl(values);
  if (url.href === window.location.href) return;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
  window.dispatchEvent(new Event(navigationEvent));
}
export function OwnerLink({values,onNavigate,disabled,children,...props}:Omit<AnchorHTMLAttributes<HTMLAnchorElement>,'href'|'onClick'> & {
  values:Record<string,string|null>;onNavigate?:()=>void;disabled?:boolean
}) {
  const url=ownerUrl(values);
  return <a {...props} href={url.pathname+url.search+url.hash} aria-disabled={disabled||undefined} onClick={event=>{
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();if(disabled)return;if(onNavigate)onNavigate();else navigateOwner(values);
  }}>{children}</a>;
}
export function Notice({children, error = false}: {children: ReactNode; error?: boolean}) {
  return <p className={error ? 'owner-error' : 'owner-success'} role={error ? 'alert' : 'status'}>{children}</p>;
}
export function EmptyState({title, children}: {title: string; children: ReactNode}) {
  return <div className="owner-empty"><h2>{title}</h2><p>{children}</p></div>;
}
/** Only owner catalog images support precomputed variants; customer media stays unchanged. */
function photoVariant(src:string,size:number){
 if(!/^\/api\/owner\/(?:products\/[^/]+\/image|catalog\/proposals\/[^/]+\/photos\/[^/?]+)(?:\?|$)/.test(src)||/[?&]original=1(?:&|$)/.test(src))return src;
 const [path,query]=src.split('?'),params=new URLSearchParams(query);params.set('size',String(size));return path+'?'+params;
}
export function ProductPhoto({src, name, large = false}: {src?: string; name: string; large?: boolean}) {
 const [failed,setFailed]=useState<string>();
 const image=src?photoVariant(src,large?640:128):undefined;
 return src&&image&&failed!==src?<img onError={()=>setFailed(src)} className={large?'owner-editor-photo':'owner-thumbnail'} src={image} srcSet={large&&photoVariant(src,256)!==src?photoVariant(src,256)+' 256w, '+image+' 640w':undefined} sizes={large?'(max-width:480px) 104px, 176px':undefined} alt={large?name:''} width={large?176:48} height={large?140:48} loading={large?'eager':'lazy'} decoding="async"/>
 :<span className={large?'owner-photo-empty':'owner-thumbnail owner-photo-placeholder'} aria-label="No product photo">{large?'Add a product photo (optional)':'Photo'}</span>;
}
export function ConfirmDialog({title, children, confirmLabel = 'Discard changes', tone='danger', onConfirm, onCancel}: {
  title: string; children: ReactNode; confirmLabel?: string;tone?:'danger'|'primary'; onConfirm: () => void; onCancel: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {dialog.current?.showModal(); cancel.current?.focus(); return () => dialog.current?.close();}, []);
  return <dialog className="owner-dialog" ref={dialog} aria-labelledby="owner-dialog-title" onCancel={event => {event.preventDefault(); onCancel();}}>
    <h2 id="owner-dialog-title">{title}</h2><div className="owner-dialog-body">{children}</div>
    <div className="owner-actions"><button ref={cancel} type="button" onClick={onCancel}>Keep working</button><button className={tone==='primary'?'owner-primary':'owner-danger'} type="button" onClick={onConfirm}>{confirmLabel}</button></div>
  </dialog>;
}
