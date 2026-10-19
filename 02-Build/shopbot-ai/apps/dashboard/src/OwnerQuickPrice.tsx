import {useEffect,useRef,useState} from 'react';
import type {Product} from '../../../packages/contracts/index.js';
import type {FactBatch} from '../../../packages/contracts/catalog-facts.js';
import {formatMoney} from '../../../packages/contracts/money.js';
import {quickPriceCsv} from './owner-quick-price.js';
import {Notice} from './owner-ui.js';
async function facts(path:string,body:unknown):Promise<FactBatch>{
 const response=await fetch('/api/owner/catalog/facts'+path,{method:'POST',headers:{'content-type':'application/json','x-shopbot-owner':'1'},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error??data.message??'Could not update this price.'),{status:response.status});return data;
}
export function OwnerQuickPrice({product,onClose,onSaved}:{product:Product;onClose:()=>void;onSaved:()=>Promise<void>}){
 const [price,setPrice]=useState(product.priceStatus==='confirm'?'':(product.pricePaise/100).toFixed(2)),[status,setStatus]=useState<'priced'|'free'>(product.priceStatus==='free'?'free':'priced'),[checked,setChecked]=useState(false),[batch,setBatch]=useState<FactBatch|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null),running=useRef(false),attempt=useRef<{batchId:string;fileHash:string;expectedChunk:number}|null>(null);
 useEffect(()=>{const node=dialog.current;node?.showModal();return()=>node?.close();},[]);
 async function preview(){if(running.current)return;running.current=true;setBusy(true);setError('');try{setBatch(await facts('/preview',{csv:quickPriceCsv(product,price,status),filename:'Checked product price.csv'}));}catch(e){setError((e as Error).message);}finally{running.current=false;setBusy(false);}}
 async function apply(){if(!batch||running.current)return;running.current=true;setBusy(true);setError('');const payload=attempt.current??{batchId:batch.batchId,fileHash:batch.fileHash,expectedChunk:batch.nextChunk};attempt.current=payload;
 let result:FactBatch;
 try{result=await facts('/apply',payload);setBatch(result);attempt.current=null;setUncertain(false);}
 catch(e){const code=(e as Error&{status?:number}).status,unknown=!code||code>=500;setUncertain(unknown);if(!unknown)attempt.current=null;setError((e as Error).message+(unknown?' Retry the same update to recover its recorded result.':''));running.current=false;setBusy(false);return;}
 if(result.status==='complete'){try{await onSaved();onClose();}catch{setError('Price saved. The inventory could not refresh; close this panel and reload the inventory.');}}
 else if(result.status==='blocked')setError(result.error??'This product changed. Close and reload it before preparing a new price.');
 running.current=false;setBusy(false);}
 const row=batch?.rows[0],ready=!!batch&&batch.status==='preview'&&!batch.counts.errors&&new Date(batch.expiresAt).getTime()>Date.now();
 return <dialog className="owner-dialog owner-quick-price" ref={dialog} aria-labelledby="quick-price-title" onCancel={event=>{event.preventDefault();if(!busy&&!uncertain)onClose();}}>
  <h2 id="quick-price-title">Update shop price</h2><p><strong>{product.name}</strong><br/>Selling unit: {product.unit}</p>
  {error&&<Notice error>{error}</Notice>}
  {!batch?<><label>Price per {product.unit} (₹)<input autoFocus inputMode="decimal" value={price} disabled={busy} onChange={event=>setPrice(event.target.value)}/></label><label>Price status<select value={status} disabled={busy} onChange={event=>{setStatus(event.target.value as 'priced'|'free');if(event.target.value==='free')setPrice('0');}}><option value="priced">Shop price checked</option><option value="free">I confirm this item is free</option></select></label><label className="owner-check"><input type="checkbox" checked={checked} disabled={busy} onChange={event=>setChecked(event.target.checked)}/>I checked this price for the stated selling unit.</label></>:<div className="owner-quick-price-review"><h3>Review price change</h3><p>{row?.before?.priceStatus==='confirm'?'Price to confirm':formatMoney(row?.before?.pricePaise??product.pricePaise)} → <strong>{formatMoney(row?.after.pricePaise??product.pricePaise)} / {product.unit}</strong></p>{row?.errors.length?<ul>{row.errors.map(message=><li key={message}>{message}</li>)}</ul>:null}<p>Stock, visibility and other product confirmations stay as saved.</p></div>}
  <div className="owner-actions"><button disabled={busy||uncertain} onClick={onClose}>{batch?.status==='complete'?'Close':'Cancel'}</button>{!batch?<button className="owner-primary" disabled={busy||!checked||!price.trim()} onClick={()=>void preview()}>{busy?'Preparing…':'Review price'}</button>:(ready||uncertain)&&<button className="owner-primary" disabled={busy} onClick={()=>void apply()}>{busy?'Saving…':uncertain?'Retry same update':'Save price'}</button>}</div>
 </dialog>;
}
