import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {DraftLine,Product} from '../../../packages/contracts/index.js';
import {initialQuoteLines,quoteLineIssues,quoteSubtotal,type QuoteEditorLine,type SavedQuoteDraft} from '../../../packages/contracts/owner-quote.js';
import {formatMoney,lineTotal} from '../../../packages/contracts/money.js';
import {requestedAmountText} from '../../../packages/contracts/language.js';
import type {WorkflowRequest,AmendmentSummary} from './OrderWorkflow.js';
import {sellingBasisIssues} from '../../../packages/contracts/selling-basis.js';
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
function OrderPhotoPreview({src,name,onClose}:{src:string;name:string;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
 return <dialog className="owner-dialog order-photo-preview" ref={dialog} aria-label={'Product photo: '+name} onCancel={e=>{e.preventDefault();onClose();}}><header><h2>{name}</h2><button type="button" onClick={onClose} autoFocus>Close photo</button></header><ProductPhoto src={src+(src.includes('?')?'&':'?')+'original=1'} name={name} large/><p>Reference photo. Check the actual item, size and variant in your store before quoting.</p></dialog>;
}
function MatchProduct({line,onChoose,onClose}:{line:DraftLine;onChoose:(p:Product)=>void;onClose:()=>void}){
 const [query,setQuery]=useState(line.query??line.name),[products,setProducts]=useState<Product[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');const timer=window.setTimeout(()=>{void orderApi('catalog?visibility=visible&limit=8&q='+encodeURIComponent(query),undefined,controller.signal).then(data=>setProducts(data.products)).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},200);return()=>{clearTimeout(timer);controller.abort();};},[query]);
 return <div className="order-matcher" aria-label={'Match '+line.name}>
  <div className="order-match-heading"><strong>Catalog suggestions (optional)</strong><button type="button" onClick={onClose} aria-label="Close product matching">×</button></div>
  <p>Requested: {line.supportingPhrase??line.query??line.name}{requestedAmountText(line,'en')?' · '+requestedAmountText(line,'en'):''}</p>
  <label>Search catalog<input type="search" value={query} onChange={e=>setQuery(e.target.value)} maxLength={200} placeholder="Product name, Tamil name or SKU…" autoComplete="off"/></label>
  {loading?<p role="status">Finding products…</p>:error?<p role="alert">{error} <button type="button" onClick={()=>setQuery(q=>q+' ')}>Try again</button></p>:products.length?<div className="order-match-results">{products.map(p=><button key={p.sku} type="button" onClick={()=>onChoose(p)}><ProductPhoto src={p.imageUrl?'/api/owner/products/'+encodeURIComponent(p.sku)+'/image?v='+p.version:undefined} name={p.name}/><span><strong>{p.name}</strong><small>{p.sku} · per {p.unit} · {p.priceStatus==='confirm'?'Price to confirm':formatMoney(p.pricePaise)} · {p.stock===null?'Check stock':p.stock+' available'}</small></span><span>Choose</span></button>)}</div>:<p>No catalog suggestions. Close this panel and quote the store item directly.</p>}
 </div>;
}
export function OrderQuoteEditor({request:r,originalLines,amendments,offered,notify,onNotify,onRefresh,busy,children,amendmentToQuote,onAmendmentLoaded,nextAction}:{request:WorkflowRequest;originalLines?:DraftLine[];amendments:AmendmentSummary[];offered?:{id:string;lines?:DraftLine[];total_paise?:string;created_at?:string};busy:boolean;notify:boolean;onNotify:(value:boolean)=>void;onRefresh:()=>Promise<void>;children:ReactNode;amendmentToQuote?:string;onAmendmentLoaded:()=>void;nextAction?:{label:string;help:string;disabled?:boolean;run:()=>void}}){
 const [state,setState]=useState<EditorState>(()=>drafts.get(r.id)??fresh(r,offered?.lines??r.lines)),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(''),[matching,setMatching]=useState<string>(),[discard,setDiscard]=useState<'saved'|'current'|'amendment'>(),[loaded,setLoaded]=useState(false),[preview,setPreview]=useState<{src:string;name:string}>(),[revising,setRevising]=useState(false);
 const inFlight=useRef(false);
 const current=useRef(state);current.current=state;
 const revision=r.effective_revision??1,dirty=JSON.stringify(state.lines)!==state.baseline;
 const pending=amendments.filter(a=>a.request_id===r.id&&a.state==='owner_pending');
 const source=state.amendmentId?pending.find(a=>a.id===state.amendmentId)?.proposed_lines??r.lines:offered?.lines??r.lines;
 const stale=state.revision!==revision||!!state.amendmentId&&!pending.some(a=>a.id===state.amendmentId);
 const blockedChange=pending.length>0&&!state.amendmentId||amendments.some(a=>a.request_id===r.id&&a.state==='proposed');
 const closed=['collected','cancelled'].includes(r.fulfillment)||r.acceptance==='rejected';
 const expired=!!offered?.created_at&&Date.now()-Date.parse(offered.created_at)>=24*3600000;
 const readOnly=!!offered&&!expired||closed||!!nextAction&&!revising&&!dirty&&!state.version,disabled=busy||loading||!loaded||saving||readOnly||stale||blockedChange;
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
 function change(id:string,key:keyof QuoteEditorLine,value:string|boolean){setError('');setSuccess('');setState(s=>({...s,lines:s.lines.map(l=>l.id===id?{...l,[key]:value,...(key==='name'||key==='unit'?{sku:undefined,productVersion:undefined,manualConfirmed:false}:{}),...(key==='price'?{estimated:false,free:Number(value)===0?l.free:false}:{})}:l),attempt:undefined}));}
 function choose(id:string,p:Product){setState(s=>({...s,lines:s.lines.map(l=>l.id===id?{...l,sku:p.sku,referenceSku:p.sku,productVersion:p.version,name:p.name,unit:p.unit,price:p.pricePaise>0||p.priceStatus==='free'?(p.pricePaise/100).toFixed(2):'',estimated:true,free:p.priceStatus==='free',saleMode:p.sellingPolicy?.saleMode??'',manualConfirmed:false,reviewed:false}:l),attempt:undefined}));setMatching(undefined);setError('');setSuccess('');}
 async function save(){
  const data=await orderApi('requests/'+r.id+'/quote-draft',{expectedVersion:state.version,expectedRevision:state.revision,...(state.amendmentId?{amendmentId:state.amendmentId}:{}),lines:state.lines});
  const next=fromSaved(data.draft);setState(next);current.current=next;remember(r.id,next);return next;
 }
 async function saveDraft(){if(disabled||inFlight.current)return;inFlight.current=true;setSaving(true);setError('');setSuccess('');try{await save();setSuccess('Draft saved. You can safely return to it later.');}catch(e){setError(e instanceof Error?e.message:'Couldn’t save. Your edits are still here.');}finally{inFlight.current=false;setSaving(false);}}
 async function send(){
  if(disabled||inFlight.current)return;if(unresolved){jump();setError('Enter the missing details shown beside the highlighted items, then send the quote.');return;}inFlight.current=true;setSaving(true);setError('');setSuccess('');
  try{const saved=dirty||!state.version?await save():state;
   const payload={expectedRevision:saved.revision,draftVersion:saved.version,...(saved.amendmentId?{amendmentId:saved.amendmentId}:{}),lines:saved.lines.map(l=>({id:l.id,name:l.name.trim(),quantity:Number(l.quantity),unit:l.unit.trim(),pricePaise:Math.round(Number(l.price)*100),free:l.free,...(l.saleMode?{saleMode:l.saleMode}:{}),...(l.sku?{sku:l.sku,productVersion:l.productVersion}:{}),manualConfirmed:!l.sku,reviewed:true})),notify};
   const fingerprint=JSON.stringify(payload),attempt=state.attempt?.fingerprint===fingerprint?state.attempt:{fingerprint,id:crypto.randomUUID()};setState(s=>({...s,attempt}));
   const result=await orderApi('requests/'+r.id+'/quote',{id:attempt.id,...payload});drafts.delete(r.id);if(!drafts.size)window.removeEventListener('beforeunload',unload);
   setState(s=>({...s,version:0,baseline:JSON.stringify(s.lines),attempt:undefined}));
   setRevising(false);setSuccess(result.customerNotification==='queued'?'Quote saved and queued for WhatsApp. Waiting for customer approval.':result.customerNotification==='not_requested'?'Quote saved. WhatsApp notification is off; customer approval is still required.':'Quote saved, but WhatsApp delivery needs attention. Open the conversation to check before sending again.');await onRefresh();
  }catch(e){setError(e instanceof Error?e.message:'Could not send. Your draft is kept.');}finally{inFlight.current=false;setSaving(false);}
 }
 async function notifyQuote(){if(!offered||!notify||saving||inFlight.current)return;inFlight.current=true;setSaving(true);setError('');try{const result=await orderApi('requests/'+r.id+'/quote/notify',{quoteId:offered.id,expectedRevision:revision,notify:true});setSuccess(result.customerNotification==='queued'?'Quote queued for WhatsApp. Check delivery in the conversation.':result.customerNotification==='already_queued'?'This quote already has a delivery attempt. Check the conversation for its status.':result.customerNotification==='outcome_unknown'?'Earlier delivery is unknown. Check the conversation before trying again.':result.reason??'WhatsApp delivery is unavailable. Open the conversation to follow up.');await onRefresh();}catch(e){setError(e instanceof Error?e.message:'Could not queue the quote. Check the conversation.');}finally{inFlight.current=false;setSaving(false);}}
 function jump(){const index=issues.findIndex(i=>i.length);if(index<0)return;const line=state.lines[index]!,row=document.getElementById('quote-row-'+line.id);row?.scrollIntoView({block:'center'});const field=!line.name.trim()?'Product ':!Number(line.quantity)?'Quantity ':!line.unit.trim()?'Selling unit ':'Unit price ';(row?.querySelector('[aria-label^="'+field+'"]') as HTMLElement|null)?.focus();}
 async function reloadCurrent(){const mode=discard;setDiscard(undefined);if(mode==='amendment'){loadAmendment();return;}setLoading(true);setError('');try{const data=await orderApi('requests/'+r.id+'/quote-draft');drafts.delete(r.id);setLoaded(true);if(mode==='saved'&&data.draft){setState(fromSaved(data.draft));setSuccess('Saved draft loaded.');}else{setState({...fresh(r,offered?.lines??r.lines),version:data.draft?.version??0,baseline:''});setSuccess('Current order loaded. Review and save to replace the earlier draft.');}}catch(e){setError(e instanceof Error?e.message:'Could not load. Your edits are kept.');}finally{setLoading(false);}}

 return <div className="order-quote-layout">
  <section className="order-items-panel" aria-label="Order items and quote">
   <div className="order-editor-status">
    {readOnly&&nextAction?<div className="order-review-banner"><strong>{nextAction.help}</strong></div>:null}
    {!readOnly&&!stale&&!blockedChange?<div className="order-review-banner needs-check" role="status"><div><strong>{unresolved?`${unresolved} ${unresolved===1?'item needs':'items need'} details before sending.`:'Check the orange suggestions, then send the quote.'}</strong><p>Check the photo, item, quantity and price against your store. Edit anything here. Catalog matching is optional.</p></div></div>:null}
    {stale?<div className="order-review-banner needs-check" role="alert"><div><strong>The customer’s order changed.</strong><p>Your edits are kept. Load the current order before sending.</p><button type="button" onClick={()=>setDiscard('current')}>Load current order</button></div></div>:null}
    {blockedChange?<div className="order-review-banner needs-check"><strong>Review the customer’s change in the order details below.</strong></div>:null}
    {offered&&!expired?<div className="order-review-banner"><div><strong>Quote sent · waiting for customer approval</strong><p>These are the quoted details. The customer confirms before pickup preparation.</p></div></div>:null}
    {expired?<div className="order-review-banner needs-check"><strong>The quote expired. Check the details and send an updated quote.</strong></div>:null}
   </div>
   <div className="order-items-scroll" role="region" aria-label="Order item list" tabIndex={0}>
    {loading?<p className="order-loading" role="status">Loading your saved quote…</p>:null}
    <div className="order-table" role="table" aria-label="Quote line items">
     <div className="order-table-head" role="row"><span role="columnheader">Item · verify in store</span><span role="columnheader">Quantity</span><span role="columnheader">Unit</span><span role="columnheader">Price / unit</span><span role="columnheader">Amount</span></div>
     {displayLines.map((line,index)=>{
      const original=source.find(l=>l.id===line.id)??r.lines.find(l=>l.id===line.id);
      const photoSku=line.sku??line.referenceSku??original?.sku;
      const photo=photoSku?'/api/owner/products/'+encodeURIComponent(photoSku)+'/image?v='+(line.productVersion??1):undefined;
      const amount=line.price!==''&&Number(line.quantity)>0?lineTotal(Math.round(Number(line.price)*100),Number(line.quantity)):null;
      const review=!readOnly&&(line.estimated||!line.sku||!!original?.sourceUncertainty?.length||!!original?.catalogIssue);
      const duplicate=!!original?.sku&&source.filter(l=>l.sku===original.sku).length>1;
      const basis=sellingBasisIssues({name:line.name,unit:line.unit,sellingPolicy:{...(line.saleMode?{saleMode:line.saleMode}:{}),cutAllowed:false,continuousLengthAvailable:null}});
      return <div className={'order-line'+(review?' order-line-review':'')+(issues[index]!.length&&!readOnly?' order-line-needs-check':'')} key={line.id}>
       <div className="order-table-row" role="row" id={'quote-row-'+line.id} tabIndex={-1}>
        <div className="order-product-cell" role="cell">
         {photo?<button type="button" className="order-photo-button" aria-label={'Enlarge photo of '+line.name} onClick={()=>setPreview({src:photo,name:line.name})}><ProductPhoto src={photo} name={line.name}/><span>View photo</span></button>:<div className="order-photo-missing"><span aria-hidden="true">▧</span><small>No photo<br/>Check in store</small></div>}
         <div>
          <label className="order-product-label"><span className="sr-only">Product {index+1}</span><textarea rows={2} aria-label={'Product '+(index+1)} value={line.name} disabled={disabled} onChange={e=>change(line.id,'name',e.target.value)} maxLength={200}/></label>
          <p className="order-source-phrase">Customer asked: {original?.supportingPhrase??original?.query??original?.name??line.name}{original&&requestedAmountText(original,'en')?' · '+requestedAmountText(original,'en'):''}</p>
          <small className="order-shop-check">{readOnly?'Shop-quoted item':line.sku?'Suggested product · verify in store':'Store item · no catalog match required'}</small>
          {original?.sourceUncertainty?.length?<p className="order-review-detail">Check the size and quantity against the original request.</p>:null}
          {duplicate?<p className="order-review-detail">Requested more than once. These remain separate items.</p>:null}
          {!readOnly?<div className="order-item-tools"><button type="button" className="owner-link" disabled={disabled} onClick={()=>setMatching(matching===line.id?undefined:line.id)}>{line.sku?'Change catalog suggestion':'Find in catalog (optional)'}</button>{line.sku?<button type="button" className="owner-link" disabled={disabled} onClick={()=>setState(s=>({...s,attempt:undefined,lines:s.lines.map(l=>l.id===line.id?{...l,referenceSku:l.sku,sku:undefined,productVersion:undefined,manualConfirmed:true}:l)}))}>Use store item instead</button>:null}</div>:null}
         </div>
        </div>
        <label role="cell" className="order-number-cell"><span className="order-mobile-label">Quantity</span><input type="number" inputMode="decimal" aria-label={'Quantity '+(index+1)} min="0.001" max="100" step="0.001" value={line.quantity} disabled={disabled} onChange={e=>change(line.id,'quantity',e.target.value)} aria-invalid={!readOnly&&issues[index]!.some(i=>i.startsWith('Enter a quantity'))}/></label>
        <label role="cell"><span className="order-mobile-label">Selling unit</span><input aria-label={'Selling unit '+(index+1)} value={line.unit} list="order-selling-units" placeholder="e.g. piece" disabled={disabled} onChange={e=>change(line.id,'unit',e.target.value)} maxLength={30}/></label>
        <label role="cell" className={!readOnly&&line.estimated?'order-price-suggested':''}><span className="order-mobile-label">Price / unit (₹)</span><div className="order-price-input"><span aria-hidden="true">₹</span><input type="number" inputMode="decimal" aria-label={'Unit price '+(index+1)+' (₹)'} min="0" max="1000000" step="0.01" value={line.price} placeholder="Enter price" disabled={disabled} onChange={e=>change(line.id,'price',e.target.value)} aria-invalid={!readOnly&&issues[index]!.some(i=>i.startsWith('Enter a price'))}/></div>{!readOnly&&line.estimated?<small>Suggested · editable</small>:line.free?<small>Free item</small>:null}</label>
        <div className="order-amount-cell" role="cell"><span className="order-mobile-label">Amount</span>{amount===null||!Number.isFinite(amount)?'—':formatMoney(amount)}</div>
       </div>
       {!readOnly&&issues[index]!.length?<div className="order-inline-issues" id={'quote-issues-'+line.id}>{issues[index]!.map(issue=><p key={issue}>{issue}.</p>)}{line.price!==''&&Number(line.price)===0&&!line.free?<button type="button" disabled={disabled} onClick={()=>change(line.id,'free',true)}>Make this item free</button>:null}</div>:null}
       {!readOnly&&basis.length?<label className="order-basis-question">Is this sold as a sealed pack or measured loose? <select aria-label={'Sale basis '+(index+1)} value={line.saleMode} disabled={disabled} onChange={e=>change(line.id,'saleMode',e.target.value)}><option value="">Choose for this item</option><option value="pack">Sealed pack · use its pack unit</option><option value="measured">Measured / loose · price per {line.unit}</option></select><small>{basis.join(' ')}</small></label>:null}
       {matching===line.id&&original?<MatchProduct line={original} onChoose={p=>choose(line.id,p)} onClose={()=>setMatching(undefined)}/>:null}
      </div>;
     })}
    </div>
    <datalist id="order-selling-units">{['piece','pack','roll','box','metre','kg','litre','pair','set'].map(unit=><option key={unit} value={unit}/>)}</datalist>
    <details className="order-original-request"><summary>Original customer request · {originalLines?.length??r.lines.length} items</summary><ul>{(originalLines??r.lines).map(l=><li key={l.id}><strong>{l.supportingPhrase??l.query??l.name}</strong> · {l.quantity??l.requestedQuantity??'Quantity to check'} {l.unit??l.requestedUnit??''}</li>)}</ul><p>View conversation for the customer’s photos, messages and recordings.</p></details>
    {blockedChange||readOnly?<div className="order-follow-up"><fieldset disabled={saving||busy}>{children}</fieldset></div>:<details className="order-follow-up"><summary>Payment and pickup details</summary><fieldset disabled={saving||busy}>{children}</fieldset></details>}
   </div>
  </section>
  <aside className="order-quote-footer" aria-label="Quote summary">
   {error?<div className="order-save-error" role="alert"><p>{error}</p><button type="button" disabled={saving} onClick={()=>setDiscard('saved')}>Load saved draft</button></div>:null}
   {success?<p className="order-save-status" role="status">{success}</p>:null}
   <div className="order-footer-row">
    <div className="order-footer-total"><strong>{priced===displayLines.length?'Quote total':'Priced subtotal'} <span>{priced?formatMoney(offered?.total_paise?Number(offered.total_paise):total):'—'}</span></strong><small>{unresolved?`${unresolved} ${unresolved===1?'item needs':'items need'} details`:readOnly?nextAction?.help??'Customer approval and pickup are shown in the order details.':'Sending confirms you checked these item details and prices.'}</small></div>
    <div className="order-footer-actions">
     {readOnly&&nextAction?<><button type="button" disabled={busy||saving} onClick={()=>setRevising(true)}>Change quote</button><button type="button" className="owner-primary" disabled={busy||saving||nextAction.disabled} onClick={nextAction.run}>{nextAction.label}</button></>:null}
     {!readOnly?<><button type="button" disabled={disabled} onClick={()=>void saveDraft()}>{saving?'Saving…':'Save draft'}</button><button type="button" className="owner-primary" disabled={disabled} onClick={()=>void send()}>Send quote for approval</button></>:null}
     {offered&&!expired&&!closed?<button type="button" disabled={busy||saving||!notify||blockedChange} onClick={()=>void notifyQuote()}>Send saved quote on WhatsApp</button>:null}
    </div>
   </div>
   {!readOnly?<div className="order-footer-note"><span role="status">{loading?'Loading…':saving?'Saving…':dirty?'Unsaved changes':state.savedAt||state.version?'Draft saved':'Ready to review'}</span><button type="button" className="owner-link" aria-pressed={notify} disabled={saving} onClick={()=>onNotify(!notify)}>{notify?'WhatsApp notification on':'WhatsApp notification off'}</button></div>:null}
  </aside>
  {preview?<OrderPhotoPreview {...preview} onClose={()=>setPreview(undefined)}/>:null}
  {discard?<ConfirmDialog title={discard==='saved'?'Load the saved draft?':discard==='amendment'?'Quote the customer’s proposed list?':'Load the current order?'} confirmLabel={discard==='saved'?'Load saved draft':discard==='amendment'?'Quote proposed list':'Load current order'} onCancel={()=>{setDiscard(undefined);onAmendmentLoaded();}} onConfirm={()=>void reloadCurrent()}>Your unsaved quote edits will be replaced. The saved draft stays unchanged until you save again.</ConfirmDialog>:null}
 </div>;
}
