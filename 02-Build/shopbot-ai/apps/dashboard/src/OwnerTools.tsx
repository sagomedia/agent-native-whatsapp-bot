import {useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {OwnerLanguagePicker,useOwnerLocale} from './owner-locale.js';
import {OwnerLink,navigateOwner} from './owner-ui.js';
import {OwnerIcon} from './OwnerIcon.js';
const narrow=()=>window.matchMedia('(max-width:800px)');
function subscribe(listener:()=>void){const query=narrow();query.addEventListener('change',listener);return()=>query.removeEventListener('change',listener);}
export function OwnerTools({onHelp,status,shop,busy}:{busy:boolean;onHelp:()=>void;status:ReactNode;shop:string}){
 const {t}=useOwnerLocale(),mobile=useSyncExternalStore(subscribe,()=>narrow().matches,()=>false),[open,setOpen]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(open&&mobile){const node=dialog.current;node?.showModal();return()=>{node?.close();trigger.current?.focus();};}},[open,mobile]);
 useEffect(()=>setOpen(false),[mobile]);
 const content=<><p className="owner-tools-shop">{shop}</p><OwnerLanguagePicker/><nav aria-label={t('Shop tools')}>
  <OwnerLink disabled={busy} values={{view:'overview'}} onNavigate={()=>{setOpen(false);navigateOwner({view:'overview'});}}>{t('Today')}</OwnerLink>
  <OwnerLink disabled={busy} values={{view:'requests'}} onNavigate={()=>{setOpen(false);navigateOwner({view:'requests'});}}>{t('Orders')}</OwnerLink>
  <OwnerLink disabled={busy} values={{view:'conversations'}} onNavigate={()=>{setOpen(false);navigateOwner({view:'conversations'});}}>{t('Messages')}</OwnerLink>
  <OwnerLink disabled={busy} values={{view:'catalog'}} onNavigate={()=>{setOpen(false);navigateOwner({view:'catalog'});}}>{t('Products')}</OwnerLink>
  <OwnerLink disabled={busy} values={{view:'connections'}}>{t('Settings & usage')}</OwnerLink><OwnerLink disabled={busy} values={{view:'message-review'}}>{t('Message review')}</OwnerLink>
 </nav><button type="button" className="owner-help-trigger" onClick={()=>{setOpen(false);requestAnimationFrame(()=>{trigger.current?.focus();onHelp();});}}>{t('Quick help')}</button><div className="owner-tools-status">{status}<p>{t('Private dashboard')}</p></div></>;
 if(!mobile)return <div className="owner-app-tools"><OwnerLanguagePicker/><button type="button" className="owner-help-trigger" aria-label={t('Quick help')} onClick={onHelp}><span aria-hidden="true">?</span><span>{t('Quick help')}</span></button></div>;
 return <><button ref={trigger} className="owner-tools-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><OwnerIcon name="settings"/><span>{t('Tools')}</span></button>{open?<dialog ref={dialog} className="owner-dialog owner-tools-dialog" aria-labelledby="owner-tools-title" onKeyDown={event=>{
  if(event.key!=='Tab')return;
  const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),a[href]:not([aria-disabled=true])')).filter(el=>el.getClientRects().length);
  const target=event.shiftKey?controls.at(-1):controls[0],boundary=event.shiftKey?controls[0]:controls.at(-1);
  if(document.activeElement===boundary){event.preventDefault();target?.focus();}
 }} onCancel={event=>{event.preventDefault();setOpen(false);}} onClick={event=>{if((event.target as HTMLElement).closest('a'))setOpen(false);}}><header><h2 id="owner-tools-title">{t('Shop tools')}</h2><button type="button" onClick={()=>setOpen(false)}>{t('Close')}</button></header>{content}</dialog>:null}</>;
}
