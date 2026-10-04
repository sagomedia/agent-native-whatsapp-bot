import {NativeChat} from './NativeChat.js';
import {OwnerDashboard} from './OwnerDashboard.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Snapshot, SimulatorEvent, DraftLine } from '../../../packages/contracts/index.js';
import { formatMoney, lineTotal } from '../../../packages/contracts/money.js';
import './style.css';
const nativeTest=window.location.pathname==='/native-test';
const endpoint=nativeTest?'/api/native-test':'/api/simulator';
function App() {
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[text,setText]=useState('');
  const [error,setError]=useState(''),[connectionError,setConnectionError]=useState(''),[sending,setSending]=useState(false);
  const pendingEvent=useRef<SimulatorEvent|null>(null);
  useEffect(()=>{
    let active=true;let timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
    async function load(){
      try {const response=await fetch(endpoint,{signal:controller.signal});if(response.status===401&&nativeTest){if(active)setConnectionError('Click New AI test to start.');return;}if(!response.ok)throw new Error('Test page is unavailable.');const data:Snapshot=await response.json();if(active){setSnapshot(data);setConnectionError('');}}
      catch(cause){if(active)setConnectionError(cause instanceof Error?cause.message:'Connection failed.');}
      finally{if(active)timer=setTimeout(()=>{void load();},1000);}
    }
    void load();return()=>{active=false;controller.abort();clearTimeout(timer);};
  },[]);
  async function send(event:SimulatorEvent){
    setSending(true);setError('');pendingEvent.current=event;
    try {
      const response=await fetch(endpoint+'/events',{method:'POST',headers:{'Content-Type':'application/json','x-shopbot-local-test':'1'},body:JSON.stringify(event)});
      if(!response.ok){const data=await response.json();throw new Error(data.error??data.message??'Action could not be saved.');}
      pendingEvent.current=null;
      const current=await fetch(endpoint);if(current.ok)setSnapshot(await current.json());
      if(event.type==='text')setText('');
    }catch(cause){setError((cause instanceof Error?cause.message:'Connection failed.')+' Use Retry action to resend the same input.');}
    finally{setSending(false);}
  }
  function submit(event:FormEvent){event.preventDefault();if(text.trim())void send({id:crypto.randomUUID(),type:'text',text});}
  async function newTest(){setSending(true);setError('');try{const r=await fetch(endpoint+'/session',{method:'POST',headers:{'x-shopbot-local-test':'1'}});if(!r.ok)throw new Error('Could not start a new test.');pendingEvent.current=null;setSnapshot(await fetch(endpoint).then(r=>r.json()));setConnectionError('');setText('');}catch(e){setError(e instanceof Error?e.message:'Could not start test.');}finally{setSending(false);}}
  const busy=!snapshot||sending||(snapshot?.pending??0)>0||pendingEvent.current!==null;
  const version=snapshot?.conversation.version??0,draft=snapshot?.conversation.draft??[],pending=snapshot?.conversation.pending;
  const subtotal=draft.reduce((sum,l)=>sum+(l.resolution==='matched'&&l.quantity!==null&&l.pricePaise!==undefined?lineTotal(l.pricePaise,l.quantity):0),0);
  const unresolved=draft.some(l=>l.resolution!=='matched');
  const questionLine=pending?.kind==='question'?draft.find(l=>l.id===pending.lineId):undefined;
  function quantity(line:DraftLine,value:number){void send({id:crypto.randomUUID(),type:'set_quantity',lineId:line.id,quantity:value,expectedVersion:version});}
  return <main>
    <header><div><h1>ShopBot</h1><p>Reusable retail agent tools</p></div><div>{nativeTest?<button disabled={sending} onClick={()=>{void newTest();}}>New AI test</button>:null} <span className="mode">{nativeTest?'Gemini · free tier':'Mock interpreter'}</span></div></header>
    <aside className="notice">{nativeTest?'Type a shopping list to test Gemini with synthetic products. Wait at least 15 seconds between AI messages; limits are 3 per minute and 100 per day. WhatsApp is not connected.':'Local test engine with synthetic products. Text uses a limited English test adapter. No live AI, WhatsApp, payments or stock reservations.'}</aside>
    {error||connectionError?<div role="alert" className="error">{error||connectionError} {pendingEvent.current?<button disabled={sending} onClick={()=>{if(pendingEvent.current)void send(pendingEvent.current);}}>Retry action</button>:null}</div>:null}
    <div className="workspace">
      <section aria-labelledby="catalog-title" className="catalog"><h2 id="catalog-title">Demo catalog</h2><p>Fixture data for the shared tools.</p>
        {!snapshot?<p>Loading catalog…</p>:snapshot.catalog.map(product=><article key={product.sku}><div><h3>{product.name}</h3><p>{formatMoney(product.pricePaise)} / {product.unit}</p><small>{product.stock===null?'Stock needs shop confirmation':`${product.stock} in synthetic stock`}</small></div><button disabled={busy||!!snapshot.conversation.lastRequestId} onClick={()=>{void send({id:crypto.randomUUID(),type:'add_item',sku:product.sku,quantity:1,expectedVersion:version});}} aria-label={`Add ${product.name}`}>Add</button></article>)}
        <p className="hint">Known catalog actions use no interpretation calls.</p>
      </section>
      <section aria-labelledby="conversation-title" className="conversation"><h2 id="conversation-title">Conversation</h2>
        <div className="messages" role="log" aria-live="polite">{snapshot?.messages.length?snapshot.messages.map(message=><div key={message.id} className={`message ${message.direction}`}><small>{message.direction==='inbound'?'You':'ShopBot'}</small><p>{message.text}</p>{['pending','processing'].includes(message.status)?<small>Processing…</small>:null}</div>):<p className="empty">Try: I need three half-inch PVC elbows, two PTFE tape rolls and one ten-inch adjustable wrench.</p>}</div>
        <form onSubmit={submit}><label htmlFor="message">Message</label><textarea id="message" maxLength={4000} value={text} onChange={e=>setText(e.target.value)} placeholder="Describe your shopping list or edit…"/><button type="submit" disabled={busy||!text.trim()}>Send message</button></form>
        {nativeTest&&(snapshot as (Snapshot&{lastFailure?:string})|null)?.lastFailure?<p className="error">AI response rejected: {(snapshot as Snapshot&{lastFailure:string}).lastFailure}. Your draft was retained.</p>:null}
        <p className="hint">Try “change the elbows to five”, “remove the wrench”, “review” or “order status”. A price question does not add items.</p>
        <p className="hint">{snapshot?.interpretationAttempts??0} {nativeTest?'AI attempts. Known buttons, review and confirmation need no AI call.':'mock interpretation attempts. Real-model quality and costs are untested.'}</p>
      </section>
      <section aria-labelledby="draft-title" className="draft"><h2 id="draft-title">Current draft</h2>
        {draft.length?<ul>{draft.map(line=><li key={line.id}><h3>{line.name}</h3><div className="line"><span>{line.quantity??'?'} {line.unit??'units'}</span><strong>{line.resolution==='matched'&&line.pricePaise!==undefined&&line.quantity!==null?formatMoney(lineTotal(line.pricePaise,line.quantity)):line.resolution.replaceAll('_',' ')}</strong></div>
          {!snapshot?.conversation.lastRequestId?<div className="quantity">{line.quantity!==null&&line.resolution==='matched'?<><button disabled={busy} aria-label={`Reduce ${line.name}`} onClick={()=>quantity(line,line.quantity!-1)}>−</button><span>{line.quantity}</span><button disabled={busy||line.quantity>=100} aria-label={`Increase ${line.name}`} onClick={()=>quantity(line,line.quantity!+1)}>+</button></>:null}<button disabled={busy} onClick={()=>quantity(line,0)} aria-label={`Remove ${line.name}`}>Remove</button></div>:null}
        </li>)}</ul>:<p className="empty">Describe a shopping list or add a known product.</p>}
        <div className="total"><span>{unresolved?'Resolved subtotal':'Draft total'}</span><strong>{formatMoney(subtotal)}</strong></div>
        {pending?.kind==='question'&&questionLine?<div className="question"><h3>Clarification needed</h3><p>{questionLine.resolution==='needs_quantity'?'Reply with the quantity for this line.':questionLine.resolution==='needs_choice'?'Choose the exact product.':'This item is unmatched or unavailable. Rephrase or remove it.'}</p>{questionLine.resolution==='needs_choice'?(questionLine.candidates??[]).map(p=><button key={p.sku} disabled={busy} onClick={()=>{void send({id:crypto.randomUUID(),type:'select_candidate',questionId:pending.id,lineId:questionLine.id,sku:p.sku});}}>{p.name}</button>):null}</div>:null}
        {!snapshot?.conversation.lastRequestId&&draft.length?<button disabled={busy} onClick={()=>{void send({id:crypto.randomUUID(),type:'review',expectedVersion:version});}}>Review request</button>:null}
        {pending?.kind==='review'?<div className="review"><p>Confirm this exact {formatMoney(pending.totalPaise)} request for pickup.</p><button disabled={busy} onClick={()=>{void send({id:crypto.randomUUID(),type:'confirm',reviewId:pending.id});}}>Send request to shop</button><p className="hint">Requires shop approval. No payment or readiness implied.</p></div>:null}
        {snapshot?.requests.map(r=><div className="request" key={r.id}><h3>Waiting for shop approval</h3><p className="reference">{r.id}</p><p>{formatMoney(r.totalPaise)}. Payment not requested. Items are not ready.</p></div>)}
      </section>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(window.location.pathname==='/owner'?<OwnerDashboard/>:nativeTest?<NativeChat/>:<App/>);
