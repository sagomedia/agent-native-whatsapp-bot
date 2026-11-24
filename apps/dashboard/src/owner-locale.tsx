import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';

export type OwnerLocale='en'|'ta';
const storageKey='shopbot.owner.language';
const identity=(text:string)=>text;
type Translate=typeof identity;
let tamil:Translate|undefined;
let tamilLoad:Promise<Translate>|undefined;
function loadTamil(){
 return tamilLoad??=import('./owner-tamil.js').then(module=>tamil=module.ownerTamilText).catch(error=>{
  tamilLoad=undefined;
  throw error;
 });
}
const LocaleContext=createContext({locale:'en' as OwnerLocale,t:identity,setLocale:(_locale:OwnerLocale)=>{}});
export function OwnerLocaleProvider({children}:{children:ReactNode}){
 const [locale,setLanguage]=useState<OwnerLocale>(()=>{try{return localStorage.getItem(storageKey)==='ta'?'ta':'en';}catch{return 'en';}});
 function setLocale(next:OwnerLocale){setLanguage(next);try{localStorage.setItem(storageKey,next);}catch{/* Preference persistence is optional. */}}
 useEffect(()=>{const previous=document.documentElement.lang;document.documentElement.lang=locale;return()=>{document.documentElement.lang=previous;};},[locale]);
 const [translate,setTranslate]=useState<Translate|undefined>(()=>tamil);
 useEffect(()=>{
  if(locale!=='ta'||translate)return;
  let active=true;
  const load=()=>{void loadTamil().then(t=>{if(active)setTranslate(()=>t);}).catch(()=>{});};
  load();
  window.addEventListener('online',load);
  return()=>{active=false;window.removeEventListener('online',load);};
 },[locale,translate]);
 return <LocaleContext.Provider value={{locale,setLocale,t:locale==='ta'?translate??identity:identity}}>{children}</LocaleContext.Provider>;
}
export const useOwnerLocale=()=>useContext(LocaleContext);
export function OwnerLanguagePicker(){const {locale,setLocale}=useOwnerLocale();return <label className="owner-language"><span className="sr-only">Dashboard language / மொழி</span><select aria-label="Dashboard language / மொழி" value={locale} onChange={event=>setLocale(event.target.value as OwnerLocale)}><option value="en">English</option><option value="ta">தமிழ்</option></select></label>;}
