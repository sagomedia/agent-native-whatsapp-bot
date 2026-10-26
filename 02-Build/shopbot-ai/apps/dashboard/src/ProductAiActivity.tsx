import {useEffect,useRef,useState} from 'react';
import {redesignApi} from './redesign-api.js';
import {OwnerLink} from './owner-ui.js';
import {useOwnerLocale} from './owner-locale.js';
import {useOwnerPhoto} from './OwnerPhotoViewer.js';
import {activitySummary} from './ai-activity-summary.js';
import './product-ai-activity.css';

type Change={field:string;before:unknown;after:unknown};
type Item={hasPhoto?:boolean;productVersion?:number;id:string;sku:string|null;name:string|null;action?:string;category?:string;status?:string;live?:boolean;applicationName?:string;createdAt:string;changes?:Change[]|null;historical?:boolean;historyNote?:string;reason?:string;explanation?:string;wording?:string;conversationId?:string|null;patch?:{aliases:{add:string[];remove:string[]};keywords:{add:string[];remove:string[]}}};
type Page={items:Item[];total:number;nextCursor:string|null};
const fieldName=(field:string)=>({aliases:'Names customers use',keywords:'Search terms',name:'Product name',price_paise:'Price (paise)',stock:'Shelf stock',reserved_stock:'Stock held for orders',image_path:'Product photo',active:'Visible in shop',merchant_verification:'Verified details',selling_policy:'Selling details'} as Record<string,string>)[field]??field.replaceAll('_',' ');
function valueText(value:unknown,locale:'en'|'ta',field?:string):string {if(value===null||value===undefined)return locale==='ta'?'பதிவு இல்லை':'Not recorded';if(field==='price_paise'&&typeof value==='number')return new Intl.NumberFormat(locale==='ta'?'ta-IN':'en-IN',{style:'currency',currency:'INR'}).format(value/100);if(typeof value==='boolean')return value?(locale==='ta'?'ஆம்':'Yes'):(locale==='ta'?'இல்லை':'No');if(Array.isArray(value))return value.length?value.map(String).join(', '):(locale==='ta'?'இல்லை':'None');return typeof value==='object'?JSON.stringify(value):String(value);}
type ActivityItem=Item&{source?:string};
function ActivityPhoto({src,name}:{src:string;name:string}){
 const [failed,setFailed]=useState(false),{t}=useOwnerLocale(),openPhoto=useOwnerPhoto();
 return <div className="rd-ai-photo">{src&&!failed?<button type="button" aria-label={t('View photo')+': '+name} onClick={()=>openPhoto({src,name})}><img loading="lazy" src={src+'&size=256'} alt="" onError={()=>setFailed(true)}/></button>:<span aria-hidden="true">▧</span>}</div>;
}

export function ProductAiActivity({query,onOpen}:{query:string;onOpen:(sku:string)=>void}){
 const {t,locale}=useOwnerLocale();
 const [mode,setMode]=useState<'applied'|'review'>('applied'),[items,setItems]=useState<ActivityItem[]>([]),[total,setTotal]=useState(0),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[more,setMore]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const moreRequest=useRef<AbortController|null>(null),scope=useRef('');const key=JSON.stringify([query,mode,retry]);scope.current=key;
 useEffect(()=>{
  moreRequest.current?.abort();setMore(false);setLoading(true);setError('');setItems([]);setCursor(null);setTotal(0);
  const controller=new AbortController(),timer=window.setTimeout(async()=>{
   try{const page=await redesignApi<Page>('catalog/ai-activity?'+new URLSearchParams({mode,q:query,limit:'25'}),undefined,controller.signal);if(controller.signal.aborted)return;setItems(page.items);setTotal(page.total);setCursor(page.nextCursor);}
   catch(e){if(!controller.signal.aborted)setError((e as Error).message);}finally{if(!controller.signal.aborted)setLoading(false);}
  },query?250:0);
  return()=>{controller.abort();moreRequest.current?.abort();window.clearTimeout(timer);};
 },[query,mode,retry]);
 async function loadMore(){if(!cursor||more||loading)return;const captured=key,controller=new AbortController();moreRequest.current=controller;setMore(true);setError('');
  try{const page=await redesignApi<Page>('catalog/ai-activity?'+new URLSearchParams({mode,q:query,limit:'25',cursor}),undefined,controller.signal);if(controller.signal.aborted||scope.current!==captured)return;setItems(old=>[...new Map([...old,...page.items].map(item=>[item.id,item])).values()]);setTotal(page.total);setCursor(page.nextCursor);}
  catch(e){if(!controller.signal.aborted&&scope.current===captured)setError((e as Error).message);}finally{if(moreRequest.current===controller)setMore(false);}
 }
 return <section className="rd-ai-activity" aria-label={t('AI activity')}>
  <div className="rd-ai-view-switch" role="group" aria-label={locale==='ta'?'AI மாற்றங்கள்':'AI activity views'}><button type="button" aria-pressed={mode==='applied'} onClick={()=>setMode('applied')}>{locale==='ta'?'மாற்றங்கள்':t('Applied')}</button><button type="button" aria-pressed={mode==='review'} onClick={()=>setMode('review')}>{locale==='ta'?'பரிந்துரைகள்':t('Needs review')}</button><button type="button" aria-label={locale==='ta'?'புதுப்பி':'Refresh'} title={locale==='ta'?'புதுப்பி':'Refresh'} onClick={()=>setRetry(n=>n+1)}>↻</button></div>
  <p className="rd-ai-explainer">{mode==='applied'?t('Changes saved through your connected AI applications.'):t('Discuss these suggestions in your AI chat. Accepted changes go live from that chat.')}</p>
  {error?<p className="rd-products-error" role="alert">{locale==='ta'?'மாற்றங்களை ஏற்ற முடியவில்லை.':'Could not load activity.'} <button type="button" onClick={()=>setRetry(n=>n+1)}>{t('Try again')}</button></p>:null}
  {loading?<p role="status">{t('Loading…')}</p>:items.length?<ol className="rd-ai-event-list">{items.map(item=>{
   const photo=item.hasPhoto&&item.sku?'/api/owner/products/'+encodeURIComponent(item.sku)+'/image?v='+item.productVersion:'';
   const name=item.name??item.sku??t('Product not identified');
   const status=mode==='review'?t('Suggestion'):item.status==='live'?t('Live in inventory'):item.status==='undone'?t('Undone'):item.status==='hidden'?t('Saved · hidden'):(locale==='ta'?'பொருள் கிடைக்கவில்லை':'Product unavailable');
   const lines=activitySummary(item,locale,mode==='review');
   return <li className="rd-ai-event" key={item.id}>
    <div className="rd-ai-event-main"><ActivityPhoto key={photo} src={photo} name={name}/>
     <div className="rd-ai-content"><div className="rd-ai-event-heading"><strong>{name}</strong><span className={'rd-ai-state '+(mode==='review'?'is-review':item.status==='live'?'is-live':'')}>{status}</span></div>
      <div className="rd-ai-message"><span className="rd-ai-message-label">{locale==='ta'?'AI சொல்வது':'AI update'}</span>{lines.map((line,i)=><p key={i}>{line}</p>)}</div>
      <p className="rd-ai-event-meta">{mode==='applied'?`${item.applicationName??(locale==='ta'?'இணைக்கப்பட்ட AI':'Connected AI')} · `:''}<time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(locale==='ta'?'ta-IN':'en-IN',{dateStyle:'medium',timeStyle:'short'})}</time></p>
      {photo?<p className="rd-ai-photo-note">{locale==='ta'?'தற்போதைய படம்':'Current photo'}</p>:null}
      {(item.wording||(mode==='review'&&item.patch)||item.changes?.length||item.historyNote||item.reason||item.explanation)?<details className="rd-ai-details"><summary>{locale==='ta'?'முழு விவரங்களைப் பார்':'See full details'}</summary>
       {item.wording?<p className="rd-ai-wording">{t('Customer wording')}: <q>{item.wording}</q></p>:null}
       {mode==='review'&&item.patch?<div className="rd-ai-proposed">{(['aliases','keywords'] as const).map(field=>{const patch=item.patch![field];return patch.add.length||patch.remove.length?<div key={field}><strong>{t(fieldName(field))}</strong>{patch.add.length?<p>＋ {patch.add.join(', ')}</p>:null}{patch.remove.length?<p>− {patch.remove.join(', ')}</p>:null}</div>:null;})}</div>:null}
       {item.changes?.length?<dl className="rd-ai-diff">{item.changes.map(change=><div key={change.field}><dt>{t(fieldName(change.field))}</dt><dd><span>{t('Before')}: {valueText(change.before,locale,change.field)}</span><span>{t('After')}: {valueText(change.after,locale,change.field)}</span></dd></div>)}</dl>:null}
       {item.historyNote?<p className="rd-ai-history-note">{t('Historical action recorded. Previous values are unavailable.')}</p>:null}
       {item.reason||item.explanation?<div className="rd-ai-original"><strong>{locale==='ta'?'அசல் குறிப்பு':'Original note'}</strong><p>{item.reason??item.explanation}</p></div>:null}
      </details>:null}
      <div className="rd-ai-event-links">{item.sku&&item.name&&item.status!=='product_unavailable'?<button type="button" onClick={()=>onOpen(item.sku!)}>{t('Open product')}</button>:null}{item.conversationId?<OwnerLink values={{view:'conversations',conversation:item.conversationId}}>{t('Conversation evidence')}</OwnerLink>:null}</div>
     </div></div>
   </li>})}</ol>:<p className="rd-products-empty">{mode==='applied'?t('No AI changes match this search.'):t('No suggestions need review.')}</p>}
  {!loading?<div className="rd-products-footer"><span>{items.length} / {total}</span>{cursor?<button type="button" onClick={()=>void loadMore()} disabled={more}>{more?t('Loading…'):t('Load more')}</button>:null}</div>:null}
 </section>;
}
