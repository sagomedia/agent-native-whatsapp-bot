import {useEffect,useRef,useState} from 'react';
import type {DraftLine} from '../../../packages/contracts/index.js';
import {formatMoney,lineTotal} from '../../../packages/contracts/money.js';

export type WorkflowRequest={id:string;lines:DraftLine[];acceptance:string;fulfillment:string;advance_required?:boolean;advance_state?:string;advance_amount_paise?:number;estimate_complete?:boolean;effective_revision?:number;inventory_state?:string;inventory_untracked_line_ids?:string[];packed_revision?:number|null;inventory?:{sku:string;name:string;unit:string;onHand:number|null;reserved:number;available:number|null;held?:number;version:number;hasPhoto:boolean}[]};
export type AmendmentSummary={id:string;request_id:string;kind:'change'|'cancel';summary:string;proposed_lines?:DraftLine[];state:string;estimate_complete:boolean};
type Act=(path:string,body:unknown,success:string)=>Promise<void>;
function quoteLines(lines:DraftLine[]){return lines.map(line=>({id:line.id,name:line.name,quantity:line.quantity===null?'':String(line.quantity),unit:line.unit??line.requestedUnit??'',saleMode:line.merchantConfirmed?.saleMode??line.candidates?.find(p=>p.sku===line.sku)?.sellingPolicy?.saleMode??'',price:line.pricePaise===undefined||line.catalogIssue==='price_unverified'?'':(line.pricePaise/100).toFixed(2),free:false}));}
type QuoteDraft={revision:number;amendmentId?:string;lines:ReturnType<typeof quoteLines>;baseline:string;attempt?:{fingerprint:string;id:string}};
// Keep customer quote edits only in this page's memory, including when a tab unmounts.
const quoteDrafts=new Map<string,QuoteDraft>();
const warnBeforeUnload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
function rememberDraft(id:string,draft:QuoteDraft,dirty:boolean){
 if(dirty)quoteDrafts.set(id,draft);else quoteDrafts.delete(id);
 // Keep the warning active even while another dashboard tab has unmounted this form.
 if(quoteDrafts.size)window.addEventListener('beforeunload',warnBeforeUnload);else window.removeEventListener('beforeunload',warnBeforeUnload);
}
function freshDraft(r:WorkflowRequest):QuoteDraft{const lines=quoteLines(r.lines);return{revision:r.effective_revision??1,lines,baseline:JSON.stringify(lines)};}
export function OrderWorkflow({request:r,amendments,busy,act,notify,startQuote=false,onDirtyChange}:{startQuote?:boolean;request:WorkflowRequest;amendments:AmendmentSummary[];busy:boolean;act:Act;notify:boolean;onDirtyChange?:(requestId:string,dirty:boolean)=>void}) {
 const [reference,setReference]=useState(''),[showQuote,setShowQuote]=useState(()=>quoteDrafts.has(r.id));
 const [draft,setDraft]=useState<QuoteDraft>(()=>quoteDrafts.get(r.id)??freshDraft(r));
 const {lines,amendmentId:quoteAmendmentId}=draft,dirty=!!quoteAmendmentId||JSON.stringify(lines)!==draft.baseline;
 const pending=amendments.filter(a=>a.request_id===r.id&&a.state==='owner_pending');
 const stale=draft.revision!==(r.effective_revision??1)||!!quoteAmendmentId&&!pending.some(a=>a.id===quoteAmendmentId);
 const latest=useRef({draft,dirty});latest.current={draft,dirty};
 useEffect(()=>{rememberDraft(r.id,draft,dirty);onDirtyChange?.(r.id,dirty);},[r.id,draft,dirty,onDirtyChange]);
 useEffect(()=>()=>{rememberDraft(r.id,latest.current.draft,latest.current.dirty);onDirtyChange?.(r.id,false);},[r.id,onDirtyChange]);
 useEffect(()=>{if(!dirty&&stale)setDraft(freshDraft(r));},[dirty,stale,r]);
 useEffect(()=>{if(startQuote)setShowQuote(true);},[startQuote]);
 const active=!['collected','cancelled'].includes(r.fulfillment)&&r.acceptance!=='rejected';
 const change=(id:string,key:string,value:string|boolean)=>setDraft(current=>({...current,lines:current.lines.map(line=>line.id===id?{...line,[key]:value}:line)}));
 const valid=lines.every(line=>line.name.trim()&&line.unit.trim()&&Number(line.quantity)>0&&Number(line.quantity)<=100&&/^\d+(?:\.\d{1,2})?$/.test(line.price)&&(Number(line.price)>0||line.free));
 function resetDraft(){if(dirty&&!window.confirm('Discard these quote edits and load the current order?'))return;quoteDrafts.delete(r.id);setDraft(freshDraft(r));}
 function sendQuote(){if(!valid||stale||busy)return;const payload={expectedRevision:draft.revision,...(quoteAmendmentId?{amendmentId:quoteAmendmentId}:{}),lines:lines.map(line=>({id:line.id,name:line.name.trim(),quantity:Number(line.quantity),unit:line.unit.trim(),...(line.saleMode?{saleMode:line.saleMode}:{}),pricePaise:Math.round(Number(line.price)*100),free:line.free})),notify},fingerprint=JSON.stringify(payload),attempt=draft.attempt?.fingerprint===fingerprint?draft.attempt:{fingerprint,id:crypto.randomUUID()};setDraft(current=>({...current,attempt}));void act('requests/'+r.id+'/quote',{id:attempt.id,...payload},'Final bill saved for customer approval.');}
 return <div className="owner-workflow" id={'workflow-'+r.id}>
  {r.advance_state==='pay_at_shop'?<div className="owner-workflow-section"><h3>Pay at shop · demo</h3><p>Customer will pay the full amount at pickup. No ₹10 advance has been received.</p></div>:null}
  {r.advance_required?<div className="owner-workflow-section"><h3>₹10 UPI advance</h3><p>{r.advance_state==='verified'?'Received · checked by shop':r.advance_state==='claimed'?'Customer says paid · check your bank/UPI app':r.advance_state==='refund_pending'?'Refund needs your attention':r.advance_state==='refunded'?'Refund recorded by shop':'Awaiting advance'}</p>
   {['requested','claimed'].includes(r.advance_state??'')?<><p>Check that ₹10 reached the configured UPI account before confirming. A screenshot or customer message is not confirmation.</p><label>Bank/UPI transaction reference<input value={reference} onChange={e=>setReference(e.target.value)} maxLength={80} autoComplete="off"/></label><button disabled={busy||reference.trim().length<6} onClick={()=>void act('requests/'+r.id+'/advance/verify',{reference:reference.trim(),notify},'Advance recorded after shop verification.')}>I checked receipt of ₹10</button></>:null}
   {r.advance_state==='refund_pending'?<><label>Actual refund transaction reference<input value={reference} onChange={e=>setReference(e.target.value)} maxLength={80} autoComplete="off"/></label><button disabled={busy||reference.trim().length<6} onClick={()=>void act('requests/'+r.id+'/advance/refund',{reference:reference.trim(),notify},'Completed refund recorded.')}>Record refund already sent</button></>:null}
  </div>:null}
  {active?<div className="owner-workflow-section"><h3>{r.estimate_complete===false?'Items still need a shop quote':'Shop quote'}</h3>{r.estimate_complete===false?<p>The estimate excludes unresolved items. Quote every line and get the customer’s approval before accepting.</p>:null}<button disabled={busy||!!pending.length} onClick={()=>setShowQuote(value=>!value)}>{showQuote?'Close quote editor':'Review items & offer final bill'}</button>
   {showQuote?<form onSubmit={e=>{e.preventDefault();sendQuote();}}>
    {dirty?<p role="status">Quote edits are kept while you move around this dashboard. Reloading or closing the page discards them.</p>:null}
    {stale?<p role="alert">This order or its proposed change has changed. Your quote edits are kept below. Load the current order and review it before sending a final bill.</p>:null}
    {dirty||stale?<button type="button" disabled={busy} onClick={resetDraft}>Discard quote edits & load current order</button>:null}
    {lines.map((line,index)=><fieldset key={line.id}><legend>Item {index+1}</legend><label>Product<input value={line.name} maxLength={200} onChange={e=>change(line.id,'name',e.target.value)}/></label><div className="owner-quote-fields"><label>Quantity<input type="number" min="0.001" max="100" step="0.001" value={line.quantity} onChange={e=>change(line.id,'quantity',e.target.value)}/></label><label>Selling unit<input value={line.unit} maxLength={30} onChange={e=>change(line.id,'unit',e.target.value)}/></label><label>Sale basis<select value={line.saleMode} onChange={e=>change(line.id,'saleMode',e.target.value)}><option value="">Verify pack / loose basis if needed</option><option value="pack">Sealed / whole pack</option><option value="measured">Measured / loose sale</option></select></label><label>Unit price (₹)<input type="number" min="0" step="0.01" value={line.price} onChange={e=>change(line.id,'price',e.target.value)}/></label></div><label className="owner-check"><input type="checkbox" checked={line.free} onChange={e=>change(line.id,'free',e.target.checked)}/>This item is free</label></fieldset>)}
    <p>Quoted total: {formatMoney(lines.reduce((sum,line)=>sum+lineTotal(Math.round(Number(line.price||0)*100),Number(line.quantity||0)),0))}</p><button className="owner-primary" type="submit" disabled={busy||!valid||stale}>Send final bill for approval</button><p>This does not replace the customer’s original order or collect money.</p>
   </form>:null}
  </div>:null}
  {pending.map(amendment=><div className="owner-workflow-section" key={amendment.id}><h3>{amendment.kind==='cancel'?'Cancellation request':'Customer amendment'}</h3><p className="owner-message-text">{amendment.summary}</p>{!amendment.estimate_complete&&amendment.kind!=='cancel'?<p>Some details remain unresolved. Discuss them with the customer before accepting.</p>:null}<div className="owner-actions">{amendment.kind==='change'&&amendment.proposed_lines?<button disabled={busy} onClick={()=>{if(dirty&&!window.confirm('Discard these quote edits and quote the proposed customer list?'))return;setDraft({...freshDraft(r),amendmentId:amendment.id,lines:quoteLines(amendment.proposed_lines!)});setShowQuote(true);}}>Quote this proposed list</button>:null}<button disabled={busy||amendment.kind!=='cancel'&&!amendment.estimate_complete} onClick={()=>void act('amendments/'+amendment.id+'/decision',{decision:'accepted',notify},'Amendment accepted.')}>Accept change</button><button disabled={busy} onClick={()=>void act('amendments/'+amendment.id+'/decision',{decision:'rejected',notify},'Amendment declined; earlier order kept.')}>Decline change</button></div></div>)}
 </div>;
}
