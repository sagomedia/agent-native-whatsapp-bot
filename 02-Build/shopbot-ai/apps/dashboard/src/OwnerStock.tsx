import {useEffect,useId,useRef,useState} from 'react';
import type {Product} from '../../../packages/contracts/index.js';
import {Notice} from './owner-ui.js';
import {stockChangePreview,type StockTask} from './owner-stock-preview.js';
import {useOwnerLocale} from './owner-locale.js';
type StockWrite={kind:StockTask;quantity:number;reason:string;expectedVersion:number};
type Movement={id:string;kind:string;on_hand_before:string|null;on_hand_after:string|null;reserved_after:string;reason:string;created_at:string};
export function OwnerStock({product,disabled,onSaved,onBusyChange}:{product:Product;disabled:boolean;onSaved:()=>Promise<void>;onBusyChange?:(busy:boolean)=>void}){
 const {t}=useOwnerLocale();
 const [kind,setKind]=useState<StockTask|null>(()=>product.stockOnHand==null?'count':null),[quantity,setQuantity]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(''),[history,setHistory]=useState<Movement[]>([]);
 const resultId=useId();
 const attempt=useRef<{fingerprint:string;id:string;body:StockWrite}|null>(null),running=useRef(false),[uncertain,setUncertain]=useState(false);
 async function load(signal?:AbortSignal){try{const response=await fetch('/api/owner/catalog/products/'+encodeURIComponent(product.sku)+'/stock',{cache:'no-store',signal});if(response.ok&&!signal?.aborted)setHistory((await response.json()).movements);}catch{/* History can be retried independently of stock facts. */}}
 useEffect(()=>{setKind(product.stockOnHand==null?'count':null);setQuantity('');setReason('');setError('');setSuccess('');setUncertain(false);attempt.current=null;},[product.sku]);
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[product.sku,product.inventoryVersion]);
 useEffect(()=>{onBusyChange?.(busy||uncertain);},[busy,uncertain,onBusyChange]);
 const preview=kind?stockChangePreview(product,kind,quantity):null;
 async function save(){
  if(!kind||running.current||(!uncertain&&(!preview||preview.error||preview.onHand===null)))return;
  running.current=true;setBusy(true);setError('');setSuccess('');
  const body:StockWrite=uncertain&&attempt.current?attempt.current.body:{kind,quantity:Number(quantity),reason:reason.trim()||({restock:'Stock received',sale:'Walk-in sale',count:'Physical shelf count'}[kind]),expectedVersion:product.inventoryVersion??1},fingerprint=JSON.stringify(body);
  if(attempt.current?.fingerprint!==fingerprint)attempt.current={fingerprint,id:crypto.randomUUID(),body};
  let committed=false,resolved=false;
  try{
   const r=await fetch('/api/owner/catalog/products/'+encodeURIComponent(product.sku)+'/stock',{method:'POST',headers:{'content-type':'application/json','x-shopbot-owner':'1'},body:JSON.stringify({...body,id:attempt.current.id})}),data=await r.json();
   if(!r.ok){resolved=r.status<500;setUncertain(r.status>=500);throw new Error(data.error??data.message??'Could not record stock.');}
   committed=true;setUncertain(false);attempt.current=null;setQuantity('');setReason('');setSuccess('Stock change saved.');await onSaved();await load();
  }catch(e){if(!committed)setUncertain(!resolved);setError(committed?'Stock saved; the product could not refresh. Reload before another change.':(e as Error).message);}
  finally{running.current=false;setBusy(false);}
 }
 const totals=[['On shelf',product.stockOnHand],['Held for orders',product.stockReserved??0],['Available',product.stock]] as const;
 return <section className="owner-stock-control" aria-label="Stock movements"><h3>{t('Stock')} · {product.unit}</h3>
  <dl className="owner-stock-totals">{totals.map(([label,value])=><div key={label}><dt>{t(label)}</dt><dd>{value??t('Unknown')}</dd></div>)}</dl>
  <p>{t('Accepted orders hold stock. Count everything on the shelf, including held items.')}</p>{product.stockOnHand==null?<p className="owner-stock-opening" role="status">{t('Start with a physical count. Include the new delivery and items held for orders.')}</p>:null}
  {error?<Notice error>{error}</Notice>:null}{success?<Notice>{success}</Notice>:null}
  <div className="owner-stock-tasks">{(['restock','sale','count'] as const).map(task=><button type="button" key={task} disabled={disabled||busy||uncertain||(product.stockOnHand==null&&task!=='count')} className={product.stockOnHand==null&&task==='count'?'owner-primary':undefined} aria-pressed={kind===task} onClick={()=>{setKind(task);setQuantity('');setError('');setSuccess('');}}>{t({restock:'Receive stock',sale:'Record walk-in sale',count:'Correct count'}[task])}</button>)}</div>
  {kind?<fieldset className="owner-stock-form" disabled={busy||(disabled&&!uncertain)}><label>{t(kind==='count'?'Physical count (includes reserved items)':'Quantity')} · {product.unit}<input inputMode="decimal" value={quantity} disabled={uncertain} onChange={e=>setQuantity(e.target.value)} aria-invalid={!!preview?.error} aria-describedby={resultId}/></label>
   <div className="owner-stock-preview" id={resultId} role="status">{uncertain?<p>The recorded result is unknown. Retry the same update to recover it.</p>:preview?.error?<p>{preview.error}</p>:preview?.onHand!==null?<><strong>{t('Result after saving')}</strong><dl><div><dt>{t('On shelf')}</dt><dd>{preview?.onHand}</dd></div><div><dt>{t('Held for orders')}</dt><dd>{preview?.reserved}</dd></div><div><dt>{t('Available')}</dt><dd>{preview?.available}</dd></div></dl></>:<span>Enter the quantity to see the result.</span>}</div>
   <label>{t('Reason / receipt reference')} <small>(optional)</small><input value={reason} disabled={uncertain} maxLength={240} onChange={e=>setReason(e.target.value)}/></label>
   <button type="button" className="owner-primary" disabled={!uncertain&&(!quantity.trim()||!!preview?.error||preview?.onHand==null)} onClick={()=>void save()}>{t(busy?'Recording…':uncertain?'Retry same update':'Save stock change')}</button>
   {uncertain?<p>The last save has an uncertain result. Retry this same change before starting another.</p>:null}
  </fieldset>:null}
  {disabled?<p>Save or discard product edits before recording stock.</p>:null}
  <details><summary>{t('Recent stock history')}</summary>{history.length?<ul>{history.map(m=><li key={m.id}>{m.kind} · {m.on_hand_before??t('Unknown')} → {m.on_hand_after??t('Unknown')} · {t('Held for orders')} {Number(m.reserved_after)}<br/><small>{m.reason} · {new Date(m.created_at).toLocaleString('en-IN')}</small></li>)}</ul>:<p>No movements recorded yet. Existing catalog counts have not been physically rechecked.</p>}</details>
 </section>;
}
