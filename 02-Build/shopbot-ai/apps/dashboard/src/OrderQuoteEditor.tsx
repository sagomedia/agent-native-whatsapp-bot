import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {DraftLine,Product} from '../../../packages/contracts/index.js';
import {initialQuoteLines,quoteLineIssues,quoteSubtotal,type QuoteEditorLine,type SavedQuoteDraft} from '../../../packages/contracts/owner-quote.js';
import {formatMoney,lineTotal} from '../../../packages/contracts/money.js';
import {requestedAmountText} from '../../../packages/contracts/language.js';
import type {WorkflowRequest,AmendmentSummary} from './OrderWorkflow.js';
import {ProductPhoto,ConfirmDialog} from './owner-ui.js';

export async function orderApi(path:string,body?:unknown,signal?:AbortSignal){
 const response=await fetch('/api/owner/'+path,body===undefined?{cache:'no-store',signal}:{method:'POST',headers:{'content-type':'application/json','x-shopbot-owner':'1'},body:JSON.stringify(body),signal});
 const data=await response.json();if(!response.ok)throw new Error(data.error??data.message??'Unable to save. Try again.');return data;
}
type EditorState={lines:QuoteEditorLine[];revision:number;amendmentId?:string;version:number;baseline:string;savedAt?:string;attempt?:{fingerprint:string;id:string}};
const drafts=new Map<string,EditorState>();
const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
function remember(id:string,state:EditorState){if(JSON.stringify(state.lines)!==state.baseline)drafts.set(id,state);else drafts.delete(id);if(drafts.size)window.addEventListener('beforeunload',unload);else window.removeEventListener('beforeunload',unload);}
function fresh(r:WorkflowRequest,lines=r.lines):EditorState{const next=initialQuoteLines(lines);return{lines:next,revision:r.effective_revision??1,version:0,baseline:JSON.stringify(next)};}
function fromSaved(draft:SavedQuoteDraft):EditorState{return{lines:draft.lines,revision:draft.expectedRevision,amendmentId:draft.amendmentId,version:draft.version,baseline:JSON.stringify(draft.lines),savedAt:draft.updatedAt};}
function MatchProduct({line,onChoose,onClose}:{line:DraftLine;onChoose:(p:Product)=>void;onClose:()=>void}){
 const [query,setQuery]=useState(line.query??line.name),[products,setProducts]=useState<Product[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');const timer=window.setTimeout(()=>{void orderApi('catalog?visibility=visible&limit=8&q='+encodeURIComponent(query),undefined,controller.signal).then(data=>setProducts(data.products)).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},200);return()=>{clearTimeout(timer);controller.abort();};},[query]);
 return <div className="order-matcher" aria-label={'Match '+line.name}>
  <div className="order-match-heading"><strong>Match the customer’s item</strong><button type="button" onClick={onClose} aria-label="Close product matching">×</button></div>
  <p>Requested: {line.supportingPhrase??line.query??line.name}{requestedAmountText(line,'en')?' · '+requestedAmountText(line,'en'):''}</p>
  <label>Search catalog<input type="search" value={query} onChange={e=>setQuery(e.target.value)} maxLength={200} placeholder="Product name, Tamil name or SKU…" autoComplete="off"/></label>
  {loading?<p role="status">Finding products…</p>:error?<p role="alert">{error} <button type="button" onClick={()=>setQuery(q=>q+' ')}>Try again</button></p>:products.length?<div className="order-match-results">{products.map(p=><button key={p.sku} type="button" onClick={()=>onChoose(p)}><ProductPhoto src={p.imageUrl?'/api/owner/products/'+encodeURIComponent(p.sku)+'/image?v='+p.version:undefined} name={p.name}/><span><strong>{p.name}</strong><small>{p.sku} · per {p.unit} · {p.priceStatus==='confirm'?'Price to confirm':formatMoney(p.pricePaise)} · {p.stock===null?'Check stock':p.stock+' available'}</small></span><span>Choose</span></button>)}</div>:<p>No matching products. Try a shorter name, or close this panel and confirm a manual item.</p>}
 </div>;
}
export function OrderQuoteEditor({request:r,originalLines,amendments,offered,notify,onNotify,onRefresh,busy,children,amendmentToQuote,onAmendmentLoaded}:{request:WorkflowRequest;originalLines?:DraftLine[];amendments:AmendmentSummary[];offered?:{id:string;lines?:DraftLine[];total_paise?:string;created_at?:string};busy:boolean;notify:boolean;onNotify:(value:boolean)=>void;onRefresh:()=>Promise<void>;children:ReactNode;amendmentToQuote?:string;onAmendmentLoaded:()=>void}){
 const [state,setState]=useState<EditorState>(()=>drafts.get(r.id)??fresh(r,offered?.lines??r.lines)),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(''),[matching,setMatching]=useState<string>(),[discard,setDiscard]=useState<'saved'|'current'|'amendment'>(),[loaded,setLoaded]=useState(false),[expanded,setExpanded]=useState<Record<string,boolean>>({});
 const inFlight=useRef(false);
 const current=useRef(state);current.current=state;
 const revision=r.effective_revision??1,dirty=JSON.stringify(state.lines)!==state.baseline;
 const pending=amendments.filter(a=>a.request_id===r.id&&a.state==='owner_pending');
 const source=state.amendmentId?pending.find(a=>a.id===state.amendmentId)?.proposed_lines??r.lines:offered?.lines??r.lines;
 const stale=state.revision!==revision||!!state.amendmentId&&!pending.some(a=>a.id===state.amendmentId);
 const blockedChange=pending.length>0&&!state.amendmentId||amendments.some(a=>a.request_id===r.id&&a.state==='proposed');
 const closed=['collected','cancelled'].includes(r.fulfillment)||r.acceptance==='rejected';
 const expired=!!offered?.created_at&&Date.now()-Date.parse(offered.created_at)>=24*3600000;
 const readOnly=!!offered&&!expired||closed,disabled=busy||loading||!loaded||saving||readOnly||stale||blockedChange;
 const displayLines=readOnly?initialQuoteLines(offered?.lines??r.lines):state.lines;
 const issues=displayLines.map(l=>quoteLineIssues(l,source.find(o=>o.id===l.id)??r.lines.find(o=>o.id===l.id)??l as unknown as DraftLine,source));
 const unresolved=issues.filter(i=>i.length).length,priced=displayLines.filter(l=>/^\d+(?:\.\d{1,2})?$/.test(l.price)&&(Number(l.price)>0||l.free)&&Number(l.quantity)>0).length,total=quoteSubtotal(displayLines);
 useEffect(()=>{remember(r.id,state);},[r.id,state]);
 useEffect(()=>()=>remember(r.id,current.current),[r.id]);
 async function load(signal?:AbortSignal){setLoading(true);setError('');try{const data=await orderApi('requests/'+r.id+'/quote-draft',undefined,signal);if(signal?.aborted)return;const cache=drafts.get(r.id);if(cache){if((data.draft?.version??0)!==cache.version){setLoaded(false);setError('The saved draft changed in another window. Load the saved draft before continuing.');}}else setState(data.draft?fromSaved(data.draft):fresh(r,offered?.lines??r.lines));if(!cache||(data.draft?.version??0)===cache.version)setLoaded(true);}catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'Could not load the saved draft.');}finally{if(!signal?.aborted)setLoading(false);}}
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[r.id]);
 function loadAmendment(){const amendment=pending.find(a=>a.id===amendmentToQuote);if(amendment?.proposed_lines)setState(s=>({...s,lines:initialQuoteLines(amendment.proposed_lines!),revision,amendmentId:amendment.id,attempt:undefined}));onAmendmentLoaded();}
 useEffect(()=>{if(!amendmentToQuote||loading)return;if(dirty)setDiscard('amendment');else loadAmendment();},[amendmentToQuote,loading]);
 useEffect(()=>{if(!dirty&&!state.version&&!state.amendmentId&&!loading)setState(fresh(r,offered?.lines??r.lines));},[revision,offered?.id]);
 function change(id:string,key:keyof QuoteEditorLine,value:string|boolean){setError('');setSuccess('');setState(s=>({...s,lines:s.lines.map(l=>l.id===id?{...l,[key]:value,...(key==='name'||key==='unit'?{sku:undefined,productVersion:undefined,manualConfirmed:false}:{})}:l),attempt:undefined}));}
 function choose(id:string,p:Product){setState(s=>({...s,lines:s.lines.map(l=>l.id===id?{...l,sku:p.sku,productVersion:p.version,name:p.name,unit:p.unit,price:p.priceStatus==='confirm'?'':(p.pricePaise/100).toFixed(2),free:p.priceStatus==='free',saleMode:p.sellingPolicy?.saleMode??'',manualConfirmed:false,reviewed:false}:l),attempt:undefined}));setMatching(undefined);setError('');setSuccess('');}
 async function save(){
  const data=await orderApi('requests/'+r.id+'/quote-draft',{expectedVersion:state.version,expectedRevision:state.revision,...(state.amendmentId?{amendmentId:state.amendmentId}:{}),lines:state.lines});
  const next=fromSaved(data.draft);setState(next);current.current=next;remember(r.id,next);return next;
 }
 async function saveDraft(){if(disabled||inFlight.current)return;inFlight.current=true;setSaving(true);setError('');setSuccess('');try{await save();setSuccess('Draft saved. You can safely return to it later.');}catch(e){setError(e instanceof Error?e.message:'Couldn’t save. Your edits are still here.');}finally{inFlight.current=false;setSaving(false);}}
 async function send(){
  if(disabled||unresolved||inFlight.current)return;inFlight.current=true;setSaving(true);setError('');setSuccess('');
  try{const saved=dirty||!state.version?await save():state;
   const payload={expectedRevision:saved.revision,draftVersion:saved.version,...(saved.amendmentId?{amendmentId:saved.amendmentId}:{}),lines:saved.lines.map(l=>({id:l.id,name:l.name.trim(),quantity:Number(l.quantity),unit:l.unit.trim(),pricePaise:Math.round(Number(l.price)*100),free:l.free,...(l.saleMode?{saleMode:l.saleMode}:{}),...(l.sku?{sku:l.sku,productVersion:l.productVersion}:{}),manualConfirmed:l.manualConfirmed,reviewed:l.reviewed})),notify};
   const fingerprint=JSON.stringify(payload),attempt=state.attempt?.fingerprint===fingerprint?state.attempt:{fingerprint,id:crypto.randomUUID()};setState(s=>({...s,attempt}));
   const result=await orderApi('requests/'+r.id+'/quote',{id:attempt.id,...payload});drafts.delete(r.id);if(!drafts.size)window.removeEventListener('beforeunload',unload);
   setState(s=>({...s,version:0,baseline:JSON.stringify(s.lines),attempt:undefined}));
   setSuccess(result.customerNotification==='queued'?'Quote saved and queued for WhatsApp. Waiting for customer approval.':result.customerNotification==='not_requested'?'Quote saved. WhatsApp notification is off; customer approval is still required.':'Quote saved, but WhatsApp delivery needs attention. Open the conversation to check before sending again.');await onRefresh();
  }catch(e){setError(e instanceof Error?e.message:'Could not send. Your draft is kept.');}finally{inFlight.current=false;setSaving(false);}
 }
 async function notifyQuote(){if(!offered||!notify||saving||inFlight.current)return;inFlight.current=true;setSaving(true);setError('');try{const result=await orderApi('requests/'+r.id+'/quote/notify',{quoteId:offered.id,expectedRevision:revision,notify:true});setSuccess(result.customerNotification==='queued'?'Quote queued for WhatsApp. Check delivery in the conversation.':result.customerNotification==='already_queued'?'This quote already has a delivery attempt. Check the conversation for its status.':result.customerNotification==='outcome_unknown'?'Earlier delivery is unknown. Check the conversation before trying again.':result.reason??'WhatsApp delivery is unavailable. Open the conversation to follow up.');await onRefresh();}catch(e){setError(e instanceof Error?e.message:'Could not queue the quote. Check the conversation.');}finally{inFlight.current=false;setSaving(false);}}
 function jump(){const index=issues.findIndex(i=>i.length);if(index>=0){const row=document.getElementById('quote-row-'+state.lines[index]!.id);setExpanded(e=>({...e,[state.lines[index]!.id]:true}));document.getElementById('quote-row-'+state.lines[index]!.id)?.scrollIntoView({block:'center'});document.getElementById('quote-row-'+state.lines[index]!.id)?.focus();}}
 async function reloadCurrent(){const mode=discard;setDiscard(undefined);if(mode==='amendment'){loadAmendment();return;}setLoading(true);setError('');try{const data=await orderApi('requests/'+r.id+'/quote-draft');drafts.delete(r.id);setLoaded(true);if(mode==='saved'&&data.draft){setState(fromSaved(data.draft));setSuccess('Saved draft loaded.');}else{setState({...fresh(r,offered?.lines??r.lines),version:data.draft?.version??0,baseline:''});setSuccess('Current order loaded. Review and save to replace the earlier draft.');}}catch(e){setError(e instanceof Error?e.message:'Could not load. Your edits are kept.');}finally{setLoading(false);}}

 return <div className="order-quote-layout">
  <section className="order-items-panel" aria-label="Order items and quote">
   {!readOnly&&!stale&&!blockedChange?<div className={'order-review-banner'+(unresolved?' needs-check':'')} role="status"><span className="order-banner-icon" aria-hidden="true">{unresolved?'!':'✓'}</span><div><strong>{unresolved?`Resolve ${unresolved} item ${unresolved===1?'check':'checks'} to send this quote.`:'All item checks complete. Review the total and send your quote.'}</strong><p>Customer approval is required before preparing this quote.</p>{unresolved?<button type="button" className="owner-link" onClick={jump}>Go to first item check</button>:null}</div></div>:null}
   {stale?<div className="order-review-banner needs-check" role="alert"><div><strong>The order changed while this draft was open.</strong><p>Your edits are kept. Load the current order and review the customer’s latest list before saving or sending.</p><button type="button" onClick={()=>setDiscard('current')}>Load current order</button></div></div>:null}
   {blockedChange?<div className="order-review-banner needs-check"><strong>Review the customer’s change below before editing or preparing this order.</strong></div>:null}
   {offered&&!expired?<div className="order-review-banner"><div><strong>Waiting for customer approval</strong><p>The quoted items are shown below. Stock acceptance and pickup remain separate steps.</p></div></div>:null}
   {expired?<div className="order-review-banner needs-check"><strong>The earlier quote expired. Review these items and send a fresh quote for customer approval.</strong></div>:null}
   <div className="order-section-heading"><h3>Order items</h3><span>{displayLines.length} lines</span></div>
   {loading?<p className="order-loading" role="status">Loading saved quote…</p>:null}
   <div className="order-table" role="table" aria-label="Quote line items">
    <div className="order-table-head" role="row"><span role="columnheader">Product</span><span role="columnheader">Qty</span><span role="columnheader">Unit</span><span role="columnheader">Price / unit</span><span role="columnheader">Amount</span><span role="columnheader" className="sr-only">Item actions</span></div>
    {displayLines.map((line,index)=>{const original=source.find(l=>l.id===line.id)??r.lines.find(l=>l.id===line.id),inventory=r.inventory?.find(p=>p.sku===line.sku),candidate=original?.candidates?.find(p=>p.sku===line.sku),photo=line.sku&&(inventory?.hasPhoto||candidate?.imageUrl||line.productVersion)?'/api/owner/products/'+encodeURIComponent(line.sku)+'/image?v='+(line.productVersion??inventory?.version??1):undefined;
     const amount=line.price!==''&&Number(line.quantity)>0?lineTotal(Math.round(Number(line.price)*100),Number(line.quantity)):null;
     return <div className={'order-line'+(issues[index]!.length&&!readOnly?' order-line-needs-check':'')} key={line.id}>
      <div className="order-table-row" role="row" id={'quote-row-'+line.id} tabIndex={-1}>
       <div className="order-product-cell" role="cell"><ProductPhoto src={photo} name={line.name}/><div><label className="order-product-label"><span className="sr-only">Product {index+1}</span><input aria-label={'Product '+(index+1)} value={line.name} disabled={disabled} onChange={e=>change(line.id,'name',e.target.value)} maxLength={200}/></label><div className="order-product-meta">{!readOnly?<button type="button" className={'owner-link'+(!line.sku?' order-match-needed':'')} disabled={disabled} onClick={()=>setMatching(matching===line.id?undefined:line.id)}>{line.sku?'Matched · change':line.manualConfirmed?'Manual item · match':'● Match product'}</button>:<small>{line.sku?'Matched product':'Shop-confirmed item'}</small>}{!readOnly&&issues[index]!.length?<span className="order-row-check-count">{issues[index]!.length} {issues[index]!.length===1?'check':'checks'}</span>:null}</div></div></div>
       <label role="cell" className="order-number-cell"><span className="order-mobile-label">Qty</span><span className="sr-only">Quantity {index+1}</span><input type="number" inputMode="decimal" aria-label={'Quantity '+(index+1)} min="0.001" max="100" step="0.001" value={line.quantity} disabled={disabled} onChange={e=>change(line.id,'quantity',e.target.value)} aria-invalid={!readOnly&&issues[index]!.some(i=>i.startsWith('Enter a quantity'))}/></label>
       <label role="cell"><span className="order-mobile-label">Unit</span><span className="sr-only">Selling unit {index+1}</span><input aria-label={'Selling unit '+(index+1)} value={line.unit} list="order-selling-units" disabled={disabled} onChange={e=>change(line.id,'unit',e.target.value)} maxLength={30}/></label>
       <label role="cell"><span className="order-mobile-label">Price / unit (₹)</span><span className="sr-only">Unit price {index+1} (₹)</span><div className="order-price-input"><span aria-hidden="true">₹</span><input type="number" inputMode="decimal" aria-label={'Unit price '+(index+1)+' (₹)'} min="0" max="1000000" step="0.01" value={line.price} disabled={disabled} onChange={e=>change(line.id,'price',e.target.value)} aria-invalid={!readOnly&&issues[index]!.some(i=>i.startsWith('Enter a price'))}/></div></label>
       <div className="order-amount-cell" role="cell"><span className="order-mobile-label">Amount</span>{amount===null||!Number.isFinite(amount)?'—':formatMoney(amount)}</div>
       {!readOnly?<button type="button" className="order-row-options" aria-label={'Review item '+(index+1)+' checks and options'} aria-expanded={!!expanded[line.id]} aria-controls={'quote-options-'+line.id} onClick={()=>setExpanded(e=>({...e,[line.id]:!e[line.id]}))}>⋮</button>:<span/>}
      </div>
      {original&&(original.supportingPhrase&&original.supportingPhrase!==line.name||original.query&&original.query!==line.name||original.requestedQuantity!==undefined||original.requestedAmount||inventory)?<div className="order-line-context"><span>Requested: {original.supportingPhrase??original.query??original.name}{original.requestedQuantity!==undefined?' · '+original.requestedQuantity+' '+(original.requestedUnit??''):''}{requestedAmountText(original,'en')?' · '+requestedAmountText(original,'en'):''}</span>{inventory?<span>{inventory.available===null?'Stock unknown · check shelf':`${inventory.available+(inventory.held??0)} ${inventory.unit} available for this order`}</span>:null}</div>:null}
      {!readOnly?<details className="order-line-options" id={'quote-options-'+line.id} open={expanded[line.id]??false}><summary>{issues[index]!.length?`${issues[index]!.length} ${issues[index]!.length===1?'check':'checks'} remaining`:'Line options'}</summary><div>
       {issues[index]!.length?<ul id={'quote-issues-'+line.id}>{issues[index]!.map(issue=><li key={issue}>{issue}</li>)}</ul>:null}
       {!line.sku?<label className="owner-check"><input type="checkbox" disabled={disabled} checked={line.manualConfirmed??false} onChange={e=>change(line.id,'manualConfirmed',e.target.checked)}/>I checked this manual item’s identity and selling unit.</label>:null}
       <label className="owner-check"><input type="checkbox" disabled={disabled} checked={line.free} onChange={e=>change(line.id,'free',e.target.checked)}/>This item is free (enter price 0).</label>
       <label>Sale basis for packs or loose materials<select value={line.saleMode} disabled={disabled} onChange={e=>change(line.id,'saleMode',e.target.value)} aria-label={'Sale basis '+(index+1)}><option value="">Check if applicable</option><option value="pack">Sealed / whole pack</option><option value="measured">Measured / loose sale</option></select></label>
       <label className="owner-check"><input type="checkbox" disabled={disabled} checked={line.reviewed??false} onChange={e=>change(line.id,'reviewed',e.target.checked)}/>I checked the original request, quantity, pack size and any duplicate.</label>
      </div></details>:null}
      {matching===line.id&&original?<MatchProduct line={original} onChoose={p=>choose(line.id,p)} onClose={()=>setMatching(undefined)}/>:null}
     </div>;
    })}
   </div>
   <datalist id="order-selling-units">{['piece','pack','roll','box','metre','kg','litre','pair','set'].map(unit=><option key={unit} value={unit}/>)}</datalist>
   <p className="order-stock-note">Stock availability needs shop confirmation. Matching and saving a draft do not reserve stock.</p>
   <details className="order-original-request"><summary>Original customer request · {originalLines?.length??r.lines.length} lines</summary><ul>{(originalLines??r.lines).map(l=><li key={l.id}><strong>{l.supportingPhrase??l.query??l.name}</strong> · {l.quantity??l.requestedQuantity??'Quantity to check'} {l.unit??l.requestedUnit??''}{requestedAmountText(l,'en')?' · '+requestedAmountText(l,'en'):''}</li>)}</ul><p>Open the conversation above for the customer’s messages, photos and available recordings.</p></details>
  </section>
  <aside className="order-quote-summary" aria-label="Quote summary">
   <h3>{closed?'Order summary':'Quote summary'}</h3><dl><div><dt>Order lines</dt><dd>{displayLines.length}</dd></div><div><dt>Priced lines</dt><dd>{priced} of {displayLines.length}</dd></div></dl>
   <div className="order-quote-total"><span>{priced===displayLines.length?'Quote total':'Priced subtotal'}</span><strong>{priced?formatMoney(offered?.total_paise?Number(offered.total_paise):total):'—'}</strong><small>{!priced?'Add prices to calculate':priced<displayLines.length?'Incomplete · remaining items are not included':'Customer approval confirms this quote.'}</small></div>
   {r.advance_state==='verified'?<div className="order-payment-confirmed"><strong>✓ {formatMoney(r.advance_amount_paise??1000)} advance recorded</strong><small>Confirmed by shop · separate from pickup</small></div>:null}
   {!readOnly&&unresolved?<button className="order-check-summary" type="button" onClick={jump}><strong>{unresolved} item {unresolved===1?'check':'checks'} remaining</strong><span>Review product matches, quantities and prices.</span></button>:null}
   {error?<div className="order-save-error" role="alert"><strong>Couldn’t complete this action</strong><p>{error}</p><button type="button" disabled={saving} onClick={()=>setDiscard('saved')}>Load current order</button></div>:null}
   {success?<p className="order-save-status" role="status">{success}</p>:null}
   {!readOnly?<div className="order-quote-actions"><button type="button" disabled={disabled} onClick={()=>void saveDraft()}>{saving?'Saving…':'Save draft'}</button><button type="button" className="owner-primary" disabled={disabled||unresolved>0} onClick={()=>void send()}>Send quote for approval</button><small>{unresolved?'Available once every line is resolved and priced.':stale?'Load the current order before sending.':'Saves this quote and requests customer approval.'}</small><p className="order-draft-state" role="status">{loading?'Loading…':saving?'Saving…':dirty?'Unsaved changes':state.savedAt?'Draft saved to shop':state.version?'Draft saved':'No saved draft yet'}</p></div>:null}
   {offered&&!expired&&!closed?<button type="button" disabled={busy||saving||!notify||blockedChange} onClick={()=>void notifyQuote()}>Send saved quote on WhatsApp</button>:null}
   {!closed?<label className="owner-check order-notify"><input type="checkbox" checked={notify} onChange={e=>onNotify(e.target.checked)} disabled={saving}/>Notify on WhatsApp</label>:null}
   <fieldset disabled={saving||busy}>{children}</fieldset>
  </aside>
  {!readOnly?<div className="order-mobile-actionbar" aria-label="Quote actions"><button type="button" disabled={disabled} onClick={()=>void saveDraft()}>{saving?'Saving…':'Save draft'}</button><button type="button" className="owner-primary" disabled={disabled||unresolved>0} onClick={()=>void send()}>Send quote for approval</button></div>:null}
  {discard?<ConfirmDialog title={discard==='saved'?'Load the saved draft?':discard==='amendment'?'Quote the customer’s proposed list?':'Load the current order?'} confirmLabel={discard==='saved'?'Load saved draft':discard==='amendment'?'Quote proposed list':'Load current order'} onCancel={()=>{setDiscard(undefined);onAmendmentLoaded();}} onConfirm={()=>void reloadCurrent()}>Your unsaved quote edits will be replaced. The saved draft stays unchanged until you save again.</ConfirmDialog>:null}
 </div>;
}
