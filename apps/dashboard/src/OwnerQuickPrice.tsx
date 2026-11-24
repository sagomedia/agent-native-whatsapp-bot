import {useEffect,useRef,useState} from 'react';
import type {Product} from '../../../packages/contracts/index.js';
import type {FactBatch} from '../../../packages/contracts/catalog-facts.js';
import {formatMoney} from '../../../packages/contracts/money.js';
import {quickPriceCsv} from './owner-quick-price.js';
import {Notice} from './owner-ui.js';
import {useOwnerLocale} from './owner-locale.js';
async function facts(path:string,body:unknown):Promise<FactBatch>{
 const response=await fetch('/api/owner/catalog/facts'+path,{method:'POST',headers:{'content-type':'application/json','x-shopbot-owner':'1'},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error??data.message??'Could not update this price.'),{status:response.status});return data;
}
export function OwnerQuickPrice({product,onClose,onSaved}:{product:Product;onClose:()=>void;onSaved:()=>Promise<void>}){
 const {t}=useOwnerLocale();
 const [price,setPrice]=useState(product.priceStatus==='confirm'?'':(product.pricePaise/100).toFixed(2)),[free,setFree]=useState(product.priceStatus==='free'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false),[blocked,setBlocked]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),running=useRef(false),attempt=useRef<{batchId:string;fileHash:string;expectedChunk:number}|null>(null),opener=useRef(document.activeElement as HTMLElement|null);
 useEffect(()=>{const node=dialog.current;node?.showModal();return()=>{node?.close();opener.current?.focus();};},[]);
 async function save(){
  if(running.current)return;running.current=true;setBusy(true);setError('');let applied=false,known=false,applying=!!attempt.current;
  try{
   if(!attempt.current){
    const batch=await facts('/preview',{csv:quickPriceCsv(product,price,free?'free':'priced'),filename:'Checked product price.csv'});
    if(batch.counts.errors||batch.status!=='preview')throw new Error(batch.rows.flatMap(row=>row.errors).join(' ')||'The price could not be prepared.');
    attempt.current={batchId:batch.batchId,fileHash:batch.fileHash,expectedChunk:batch.nextChunk};
   }
   applying=true;const result=await facts('/apply',attempt.current);
   known=true;setUncertain(false);attempt.current=null;
   if(result.status!=='complete'){setBlocked(true);throw new Error(result.error??'This product changed. Close and reload it before another update.');}
   applied=true;await onSaved();onClose();
  }catch(e){const code=(e as Error&{status?:number}).status,unknown=!applied&&!known&&applying&&(!code||code>=500);setUncertain(unknown);if(!unknown)attempt.current=null;setError(applied?'Price saved. Close and reload the inventory to see the latest result.':(e as Error).message+(unknown?' Retry the same update to recover its recorded result.':''));}
  finally{running.current=false;setBusy(false);}
 }
 return <dialog className="owner-dialog owner-quick-price" ref={dialog} aria-labelledby="quick-price-title" onCancel={event=>{event.preventDefault();if(!busy&&!uncertain)onClose();}}>
  <h2 id="quick-price-title">{t('Update shop price')}</h2><p><strong>{product.name}</strong><br/>{t('Selling unit:')} {product.unit}</p>
  {error?<Notice error>{error}</Notice>:null}
  <label>{t('Price / unit (₹)')}<input inputMode="decimal" value={price} disabled={busy||uncertain||blocked} onChange={event=>{setPrice(event.target.value);setFree(false);}}/></label>
  {price!==''&&Number(price)===0?<label className="owner-check"><input type="checkbox" checked={free} disabled={busy||uncertain||blocked} onChange={event=>setFree(event.target.checked)}/>{t('I confirm this item is free')}</label>:null}
  <div className="owner-quick-price-review"><p>{product.priceStatus==='confirm'?t('Price to confirm'):formatMoney(product.pricePaise)} → <strong>{/^\d+(?:\.\d{1,2})?$/.test(price)?formatMoney(Math.round(Number(price)*100)):'—'} / {product.unit}</strong></p><small>Saving confirms this shop price for the stated unit. Stock, visibility and other product facts stay unchanged.</small></div>
  <div className="owner-actions"><button type="button" disabled={busy||uncertain} onClick={onClose}>{t('Cancel')}</button><button type="button" className="owner-primary" disabled={busy||blocked||!price.trim()} onClick={()=>void save()}>{t(busy?'Saving price…':uncertain?'Retry same update':'Save price')}</button></div>
 </dialog>;
}
