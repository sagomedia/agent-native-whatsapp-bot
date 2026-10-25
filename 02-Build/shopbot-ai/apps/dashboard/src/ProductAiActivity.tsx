import {useEffect,useRef,useState} from 'react';
import {redesignApi} from './redesign-api.js';
import {OwnerLink} from './owner-ui.js';
import {useOwnerLocale} from './owner-locale.js';
import './product-ai-activity.css';

type Change={field:string;before:unknown;after:unknown};
type Item={id:string;sku:string|null;name:string|null;action?:string;category?:string;status?:string;live?:boolean;applicationName?:string;createdAt:string;changes?:Change[]|null;historical?:boolean;historyNote?:string;reason?:string;explanation?:string;wording?:string;conversationId?:string|null;patch?:{aliases:{add:string[];remove:string[]};keywords:{add:string[];remove:string[]}}};
type Page={items:Item[];total:number;nextCursor:string|null};
const fieldName=(field:string)=>({aliases:'Names customers use',keywords:'Search terms',name:'Product name',price_paise:'Price (paise)',stock:'Shelf stock',reserved_stock:'Stock held for orders',image_path:'Product photo',active:'Visible in shop',merchant_verification:'Verified details',selling_policy:'Selling details'} as Record<string,string>)[field]??field.replaceAll('_',' ');
function valueText(value:unknown):string {if(value===null||value===undefined)return 'Not recorded';if(typeof value==='boolean')return value?'Yes':'No';if(Array.isArray(value))return value.length?value.map(String).join(', '):'None';return typeof value==='object'?JSON.stringify(value):String(value);}
function actionName(item:ActivityItem){if(item.source==='audit')return item.action==='audit_undo'?'Search terms restored':'Search terms improved';return ({add_product:'Product added',commit:'Product edited',stock:'Stock updated',visibility:'Visibility updated'} as Record<string,string>)[item.action??'']??'Product changed';}
type ActivityItem=Item&{source?:string};
export function ProductAiActivity({query,onOpen}:{query:string;onOpen:(sku:string)=>void}){
 const {t}=useOwnerLocale();
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
  <div className="rd-ai-view-switch" role="group" aria-label="AI activity views"><button type="button" aria-pressed={mode==='applied'} onClick={()=>setMode('applied')}>{t('Applied')}</button><button type="button" aria-pressed={mode==='review'} onClick={()=>setMode('review')}>{t('Needs review')}</button><button type="button" onClick={()=>setRetry(n=>n+1)}>{t('Refresh')}</button></div>
  <p className="rd-ai-explainer">{mode==='applied'?t('Changes saved through your connected AI applications.'):t('Discuss these suggestions in your AI chat. Accepted changes go live from that chat.')}</p>
  {error?<p className="rd-products-error" role="alert">{error} <button type="button" onClick={()=>setRetry(n=>n+1)}>{t('Try again')}</button></p>:null}
  {loading?<p role="status">{t('Loading…')}</p>:items.length?<ol className="rd-ai-event-list">{items.map(item=><li className="rd-ai-event" key={item.id}>
   <div className="rd-ai-event-heading"><div><strong>{item.name??item.sku??t('Product not identified')}</strong><span>{mode==='applied'?actionName(item):item.category?.replaceAll('_',' ')}</span></div><span className={'rd-ai-state '+(mode==='review'?'is-review':item.status==='live'?'is-live':'')}>{mode==='review'?t('Suggestion'):item.status==='live'?t('Live in inventory'):item.status==='undone'?t('Undone'):item.status==='hidden'?t('Saved · hidden'):t('Product unavailable')}</span></div>
   <p className="rd-ai-event-meta">{mode==='applied'?`${item.applicationName??'Connected AI application'} · `:''}<time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></p>
   {item.wording?<p className="rd-ai-wording">{t('Customer wording')}: <q>{item.wording}</q></p>:null}
   {item.reason||item.explanation?<p>{item.reason??item.explanation}</p>:null}
   {item.patch?<div className="rd-ai-proposed">{(['aliases','keywords'] as const).map(field=>{const patch=item.patch![field];return patch.add.length||patch.remove.length?<div key={field}><strong>{t(fieldName(field))}</strong>{patch.add.length?<p>＋ {patch.add.join(', ')}</p>:null}{patch.remove.length?<p>− {patch.remove.join(', ')}</p>:null}</div>:null;})}</div>:null}
   {item.changes?.length?<details><summary>{t('See changes')} ({item.changes.length})</summary><dl className="rd-ai-diff">{item.changes.map(change=><div key={change.field}><dt>{t(fieldName(change.field))}</dt><dd><span>{t('Before')}: {valueText(change.before)}</span><span>{t('After')}: {valueText(change.after)}</span></dd></div>)}</dl></details>:null}
   {item.historyNote?<p className="rd-ai-history-note">{t('Historical action recorded. Previous values are unavailable.')}</p>:null}
   <div className="rd-ai-event-links">{item.sku?<button type="button" onClick={()=>onOpen(item.sku!)}>{t('Open product')}</button>:null}{item.conversationId?<OwnerLink values={{view:'conversations',conversation:item.conversationId}}>{t('Conversation evidence')}</OwnerLink>:null}</div>
  </li>)}</ol>:<p className="rd-products-empty">{mode==='applied'?t('No AI changes match this search.'):t('No suggestions need review.')}</p>}
  {!loading?<div className="rd-products-footer"><span>{items.length} / {total}</span>{cursor?<button type="button" onClick={()=>void loadMore()} disabled={more}>{more?t('Loading…'):t('Load more')}</button>:null}</div>:null}
 </section>;
}
