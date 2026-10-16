import {useEffect,useRef,useState} from 'react';
import type {Product} from '../../../packages/contracts/index.js';
import {Notice} from './owner-ui.js';
type Movement={id:string;kind:string;on_hand_before:string|null;on_hand_after:string|null;reserved_after:string;reason:string;created_at:string};
export function OwnerStock({product,disabled,onSaved}:{product:Product;disabled:boolean;onSaved:()=>Promise<void>}){
 const [kind,setKind]=useState('restock'),[quantity,setQuantity]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[history,setHistory]=useState<Movement[]>([]);
 const attempt=useRef<{fingerprint:string;id:string}|null>(null);
 async function load(){const response=await fetch('/api/owner/catalog/products/'+encodeURIComponent(product.sku)+'/stock',{cache:'no-store'});if(response.ok)setHistory((await response.json()).movements);}
 useEffect(()=>{void load();},[product.sku,product.inventoryVersion]);
 async function save(){setBusy(true);setError('');const body={kind,quantity:Number(quantity),reason:reason.trim(),expectedVersion:product.inventoryVersion??1},fingerprint=JSON.stringify(body);if(attempt.current?.fingerprint!==fingerprint)attempt.current={fingerprint,id:crypto.randomUUID()};try{
  const r=await fetch('/api/owner/catalog/products/'+encodeURIComponent(product.sku)+'/stock',{method:'POST',headers:{'content-type':'application/json','x-shopbot-owner':'1'},body:JSON.stringify({...body,id:attempt.current.id})}),data=await r.json();if(!r.ok)throw new Error(data.error??data.message??'Could not record stock.');
  await onSaved();setQuantity('');setReason('');attempt.current=null;await load();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="owner-stock-control" aria-label="Stock movements"><h3>Shop stock · {product.unit}</h3><dl className="owner-stock-totals"><div><dt>On hand</dt><dd>{product.stockOnHand??'Unknown'}</dd></div><div><dt>Reserved</dt><dd>{product.stockReserved??0}</dd></div><div><dt>Available</dt><dd>{product.stock??'Unknown'}</dd></div></dl>
  <p>Accepted orders reserve stock. Collection deducts it; cancellation releases it.</p>{error&&<Notice error>{error}</Notice>}
  <details><summary>Record a stock movement</summary><fieldset disabled={disabled||busy}><label>Action<select value={kind} onChange={e=>setKind(e.target.value)}><option value="restock">Stock received · add</option><option value="sale">Walk-in sale · subtract</option><option value="count">Correct physical shelf count</option></select></label><label>{kind==='count'?'Physical count (includes reserved items)':'Quantity'}<input type="number" min={kind==='count'?'0':'0.001'} step="0.001" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label><label>Reason / receipt reference<input value={reason} maxLength={240} onChange={e=>setReason(e.target.value)}/></label><button type="button" disabled={!quantity.trim()||reason.trim().length<3} onClick={()=>void save()}>{busy?'Recording…':'Record movement'}</button>{disabled&&<p>Save or discard product edits before recording stock.</p>}</fieldset></details>
  <details><summary>Recent stock history</summary>{history.length?<ul>{history.map(m=><li key={m.id}>{m.kind} · {m.on_hand_before??'Unknown'} → {m.on_hand_after??'Unknown'} · reserved {Number(m.reserved_after)}<br/><small>{m.reason} · {new Date(m.created_at).toLocaleString('en-IN')}</small></li>)}</ul>:<p>No movements recorded yet. Existing catalog counts have not been physically rechecked.</p>}</details>
 </section>;
}
