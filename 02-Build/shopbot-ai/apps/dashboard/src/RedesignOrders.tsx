import {customerContact} from './customer-contact.js';
import {cachedOwnerRead} from './owner-read-cache.js';
import {useEffect,useRef,useState} from 'react';
import type {DraftLine} from '../../../packages/contracts/index.js';
import {formatMoney,lineTotal} from '../../../packages/contracts/money.js';
import {initialQuoteLines} from '../../../packages/contracts/owner-quote.js';
import {SELLING_UNITS} from '../../../packages/contracts/selling-unit-values.js';
import {navigateOwner,useOwnerUrl,photoVariant} from './owner-ui.js';
import {OwnerIcon} from './OwnerIcon.js';
import {visiblePoll} from './owner-polling.js';
import {redesignApi} from './redesign-api.js';
import './redesign-orders.css';
import {useOwnerLocale} from './owner-locale.js';
import {PageHeading} from './mobile-workspace.js';
import {ConfirmBillRecipient,OrderBillHistory,billUrl,whatsappPhone} from './OrderBillActions.js';
import {useOwnerPhoto} from './OwnerPhotoViewer.js';

type Product={sku:string;version:number;name:string;unit:string;pricePaise:number;priceStatus:string;stock:number|null;quantityStep?:number;imageUrl?:string;sellingPolicy?:{saleMode?:'pack'|'measured'}};
type OriginalEstimate={lines:{id:string;pricePaise?:number;totalPaise?:number;approximate:boolean}[];subtotalPaise:number;unpriced:number;approximate:boolean};
type Order={unread?:boolean;attention_key?:string;original_estimate:OriginalEstimate;id:string;conversation_id:string|null;source?:'chat'|'in_store';has_final_bill?:boolean;bill_delivery?:string|null;customer_name?:string;customer_phone?:string;actor?:string;stage:'new'|'ready'|'completed'|'cancelled';lines:DraftLine[];original_lines:DraftLine[];original_total_paise:string;total_paise:string;effective_revision:number;created_at:string;advance_required:boolean;advance_state?:string;advance_amount_paise?:number;inventory?:{sku:string;available:number|null;hasPhoto:boolean;version:number}[]};
type Amendment={id:string;request_id:string;state:string;kind:string;summary:string;proposed_lines:DraftLine[]};
type Snapshot={store?:{name:string;bill_address?:string|null};requests:Order[];amendments:Amendment[];orderPage:{number:number;total:number;hasNext:boolean;ids:string[]};requestCounts:{new:number;ready_for_pickup:number;completed:number;active:number;history:number}};
type EditLine={id:string;sku?:string;productVersion?:number;name:string;quantity:string;unit:string;price:string;manualConfirmed?:boolean;free:boolean;saleMode?:'pack'|'measured';photo?:boolean;step?:number};
type Editor={orderId:string;revision:number;amendmentId?:string;source:string;lines:EditLine[];baseIds:string[];removed:{line:EditLine;index:number}[];dirty:boolean};
const stages=[['new','New'],['ready','Ready for pickup'],['completed','Completed'],['all','All']] as const;
const code=(id:string)=>id.replaceAll('-','').slice(0,8).toUpperCase();
const person=(r:Order)=>r.customer_name||r.customer_phone||r.actor?.replace(/^whatsapp:/,'')||(r.source==='in_store'?'Walk-in customer':'Customer');
const stageLabel=(stage:string)=>stage==='new'?'New':stage==='ready'?'Ready for pickup':stage==='completed'?'Completed':'Cancelled';
const lineAmount=(l:EditLine)=>lineTotal(Math.round(Number(l.price)*100),Number(l.quantity));
const total=(lines:EditLine[])=>lines.reduce((sum,l)=>sum+lineAmount(l),0);
const payloadLines=(lines:EditLine[])=>lines.map(l=>({
 id:l.id,sku:l.sku,productVersion:l.productVersion,manualConfirmed:l.manualConfirmed,name:l.name.trim(),
 quantity:Number(l.quantity),unit:l.unit.trim(),saleMode:l.saleMode,pricePaise:Math.round(Number(l.price)*100),free:l.free,
}));
const emptyLine=(id:string):EditLine=>({id,name:'',quantity:'1',unit:'',price:'',free:false});
type OrderAction='save'|'revise'|'ready'|'update_ready'|'complete'|'payment'|'cancel';
type CounterDraft={id:string;customerName:string;phone:string;lines:EditLine[];removed:{line:EditLine;index:number}[]};
type DialogView='revise'|'ready'|'update_ready'|'counter'|'history'|'recipient'|null;
const originalWords=(line:DraftLine|undefined)=>line?.supportingPhrase||line?.query||line?.name||'Requested item';
const date=(value:string)=>new Date(value).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
function sourceKey(r:Order,a?:Amendment){return JSON.stringify([r.effective_revision,r.stage,a?.id,a?.state,a?.proposed_lines]);}
function makeEditor(r:Order,a?:Amendment):Editor{
 const accepted=a?.state==='owner_pending'&&a.kind==='change'?a:undefined;
 const lines=(accepted?.proposed_lines??r.lines).map(l=>{
  const initial=initialQuoteLines([l])[0]!,original=r.original_lines?.find(original=>original.id===l.id),estimate=r.original_estimate?.lines.find(original=>original.id===l.id);
  // Only reuse the submitted estimate for the same product and selling unit.
  const originalPrice=original?.sku===l.sku&&original?.unit===l.unit?estimate?.pricePaise:undefined;
  return {id:l.id,sku:l.sku,productVersion:l.productVersion,name:l.name,quantity:l.quantity===null?'':String(l.quantity),unit:l.unit??'',price:initial.price||(originalPrice!==undefined?String(originalPrice/100):''),manualConfirmed:!!l.merchantConfirmed,free:initial.free,saleMode:l.merchantConfirmed?.saleMode,photo:r.inventory?.find(p=>p.sku===l.sku)?.hasPhoto};
 });
 return {orderId:r.id,revision:r.effective_revision,source:sourceKey(r,a),amendmentId:accepted?.id,dirty:false,lines,baseIds:lines.map(l=>l.id),removed:[]};
}
function validation(lines:EditLine[]):string{
 if(!lines.length)return 'Add at least one item to the order.';
 if(lines.length>50)return 'An order can contain up to 50 items.';
 for(const l of lines){if(!l.name.trim()||!l.unit.trim()||l.quantity===''||!Number.isFinite(Number(l.quantity))||Number(l.quantity)<=0||Number(l.quantity)>100||Math.abs(Number(l.quantity)*1000-Math.round(Number(l.quantity)*1000))>1e-7||l.price===''||!Number.isFinite(Number(l.price))||Number(l.price)<0||Number(l.price)>1000000||Math.abs(Number(l.price)*100-Math.round(Number(l.price)*100))>1e-7)return `${l.name||'Item'}: enter a name, quantity (up to 100), selling unit and price with up to two decimals.`;if(Number(l.price)===0&&!l.free)return `${l.name}: enter a price or mark the item free.`;if(!l.sku&&!l.manualConfirmed)return `${l.name}: choose the item or confirm it with Use store item.`;}
 return '';
}
function Thumb({line}:{line:EditLine}){return line.sku&&line.photo?<img alt="" src={photoVariant('/api/owner/products/'+encodeURIComponent(line.sku)+'/image'+(line.productVersion?'?v='+line.productVersion:''),128)} loading="lazy" decoding="async" onError={e=>{e.currentTarget.style.display='none';}}/>:<span aria-hidden="true">{line.name.slice(0,1)||'?'}</span>;}

export function RedesignOrders(){
 const {t}=useOwnerLocale();
 const params=useOwnerUrl(),rawStage=params.get('orderStage')??'new',stage=stages.some(s=>s[0]===rawStage)?rawStage:'new',page=Math.max(1,Number(params.get('orderPage'))||1),search=params.get('orderSearch')??'',selectedId=params.get('order');
 const initialRead=new URLSearchParams({details:'0',scope:'orders',orderStage:stage,orderSearch:search,orderPage:String(page)});if(selectedId)initialRead.set('order',selectedId);
 const [snapshot,setSnapshot]=useState<Snapshot|undefined>(()=>cachedOwnerRead<Snapshot>('snapshot?'+initialRead)),[error,setError]=useState(''),[notice,setNotice]=useState(''),[deliveryNotice,setDeliveryNotice]=useState(''),[busy,setBusy]=useState(false),[editor,setEditor]=useState<Editor>(),[refresh,setRefresh]=useState(0),[query,setQuery]=useState(search),[picker,setPicker]=useState<string>(),[bill,setBill]=useState<DialogView>(null),[cancelTarget,setCancelTarget]=useState<{id:string;revision:number}|null>(null);
 const [counter,setCounter]=useState<CounterDraft|null>(null);
 const [dialogError,setDialogError]=useState('');
 const [pickerIsNew,setPickerIsNew]=useState(false);
 const [counterStage,setCounterStage]=useState<'new'|'completed'|null>(null);
 const retry=useRef<{key:string;id:string}|undefined>(undefined),dialog=useRef<HTMLDialogElement>(null),returnFocus=useRef<HTMLElement|null>(null);
 useEffect(()=>setQuery(search),[search]);
 useEffect(()=>{const timer=setTimeout(()=>{if(query!==search)navigateOwner({orderSearch:query||null,orderPage:null,order:null},true);},250);return()=>clearTimeout(timer);},[query,search]);
 useEffect(()=>visiblePoll(async signal=>{try{const read=new URLSearchParams({details:'0',scope:'orders',orderStage:stage,orderSearch:search,orderPage:String(page)});if(selectedId)read.set('order',selectedId);const data=await redesignApi<Snapshot>('snapshot?'+read,undefined,signal);if(!signal.aborted){setSnapshot(data);setError('');}}catch(e){if(!signal.aborted)setError((e as Error).message);throw e;}},{intervalMs:5000}),[stage,search,page,selectedId,refresh]);
 const listed=snapshot?.requests.filter(r=>snapshot.orderPage.ids.includes(r.id))??[],order=snapshot?.requests.find(r=>r.id===selectedId)??(!selectedId?listed[0]:undefined),amendment=snapshot?.amendments.find(a=>a.request_id===order?.id),source=order?sourceKey(order,amendment):'';
 useEffect(()=>{if(!order)return;setEditor(old=>old?.orderId===order.id&&old.dirty?old:makeEditor(order,amendment));},[order?.id,source]);
 const seen=useRef(new Set<string>());
 useEffect(()=>{
  if(!selectedId||!order||order.id!==selectedId||!order.attention_key||!order.unread)return;
  const key=order.id+':'+order.attention_key;let cancelled=false;
  const mark=()=>{if(document.hidden||!document.querySelector('.rd-orders-detail')?.getClientRects().length||seen.current.has(key))return;seen.current.add(key);
   void redesignApi<{seen:boolean}>(`requests/${order.id}/seen`,{attentionKey:order.attention_key}).then(result=>{if(!cancelled&&result.seen){setSnapshot(current=>current?{...current,requests:current.requests.map(item=>item.id===order.id&&item.attention_key===order.attention_key?{...item,unread:false}:item)}:current);window.dispatchEvent(new Event('owner-attention-changed'));}}).catch(()=>seen.current.delete(key));};
  const timer=setTimeout(mark,500);document.addEventListener('visibilitychange',mark);return()=>{cancelled=true;clearTimeout(timer);document.removeEventListener('visibilitychange',mark);};
 },[selectedId,order?.id,order?.attention_key,order?.unread]);
 const originalLines=order?.original_lines??[],originalEstimate=order?.original_estimate;
 const current=editor?.orderId===order?.id?editor:undefined,stale=!!(current&&source!==current.source),closed=order?.stage!=='new'&&order?.stage!=='ready',pendingBlocked=!!amendment&&(amendment.state!=='owner_pending'||amendment.kind!=='change');
 useEffect(()=>{if(!current?.dirty)return;const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};const navigate=(event:globalThis.MouseEvent)=>{const anchor=(event.target as Element).closest?.('a[href]') as HTMLAnchorElement|null;if(!anchor||event.defaultPrevented||event.metaKey||event.ctrlKey||event.shiftKey||anchor.target==='_blank'||anchor.hasAttribute('download')||anchor.getAttribute('href')?.startsWith('#'))return;if(!window.confirm('Discard unsaved order changes?')){event.preventDefault();event.stopPropagation();}else window.removeEventListener('beforeunload',unload);};window.addEventListener('beforeunload',unload);document.addEventListener('click',navigate,true);return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',navigate,true);};},[current?.dirty]);
 const modalOpen=!!(picker||bill||cancelTarget);
 useEffect(()=>{
  if(modalOpen){returnFocus.current=document.activeElement as HTMLElement;dialog.current?.showModal();}
  else if(dialog.current?.open){dialog.current.close();returnFocus.current?.focus();}
 },[modalOpen]);
 function closeDialog(){
  if(busy)return;
  if(picker&&bill==='counter'){setPicker(undefined);return;}
  if(bill==='counter'&&counter?.lines.length&&!window.confirm(t('Discard this unsaved in-store order?')))return;
  setPicker(undefined);setBill(null);setCancelTarget(null);setCounter(null);setCounterStage(null);setDialogError('');
 }
 function editItems(change:(draft:{lines:EditLine[];removed:{line:EditLine;index:number}[]})=>{lines:EditLine[];removed:{line:EditLine;index:number}[]}){
  if(bill==='counter')setCounter(old=>old?{...old,...change(old)}:old);
  else setEditor(old=>old?{...old,...change(old),dirty:true}:old);
 }
 function update(id:string,patch:Partial<EditLine>){
  editItems(draft=>({...draft,lines:draft.lines.map(l=>l.id===id?{...l,...patch}:l)}));
 }
 function removeItem(id:string){
  editItems(draft=>{
   const index=draft.lines.findIndex(l=>l.id===id);
   return index<0?draft:{lines:draft.lines.filter(l=>l.id!==id),removed:[...draft.removed,{line:draft.lines[index],index}]};
  });
 }
 function undoRemove(id:string){
  editItems(draft=>{
   const item=draft.removed.find(row=>row.line.id===id);
   return item?{lines:[...draft.lines.slice(0,item.index),item.line,...draft.lines.slice(item.index)],removed:draft.removed.filter(row=>row.line.id!==id)}:draft;
  });
 }
 function pick(id?:string){
  setPickerIsNew(!id);setPicker(id??crypto.randomUUID());
 }
 function confirmItem(patch:Partial<EditLine>){
  if(!picker)return;
  if(pickerIsNew)editItems(draft=>({...draft,lines:[...draft.lines,{...emptyLine(picker),...patch}]}));
  else update(picker,patch);
  setPicker(undefined);
 }
 function leave(values:Record<string,string|null>,replace=false){
  if(current?.dirty){
   if(!window.confirm('Discard unsaved order changes?'))return false;
   if(order)setEditor(makeEditor(order,amendment));
  }
  navigateOwner(values,replace);return true;
 }
 function openChat(){if(order?.conversation_id)leave({view:'conversations',conversation:order.conversation_id});}
 function showPreview(action:'ready'|'revise'|'update_ready'){
  const invalid=validation(current?.lines??[]);
  if(invalid)setError(invalid);
  else{setError('');setDialogError('');setBill(action);}
 }
 function startCounter(){
  setCounter({id:crypto.randomUUID(),customerName:'',phone:'',lines:[],removed:[]});setCounterStage(null);setDialogError('');setBill('counter');
 }
 async function saveCounter(stage:'new'|'completed'){
  if(!counter||busy)return;
  const invalid=validation(counter.lines),phone=whatsappPhone(counter.phone);
  if(invalid){setDialogError(invalid);return;}
  if(phone&&!/^\+[1-9]\d{7,14}$/.test(phone)){setDialogError('Enter the phone number with its country code.');return;}
  setCounterStage(stage);setBusy(true);setDialogError('');
  try{
   const result=await redesignApi<{requestId:string;stage:'new'|'completed'}>('requests',{
    id:counter.id,stage,customerName:counter.customerName.trim()||undefined,customerPhone:phone||undefined,lines:payloadLines(counter.lines),
   });
   setCounter(null);setBill(null);setCounterStage(null);setNotice('In-store order saved.');setError('');setDeliveryNotice('');
   setQuery('');navigateOwner({orderStage:result.stage,orderPage:null,order:result.requestId,orderSearch:null});
   setRefresh(n=>n+1);
  }catch(e){
   if([400,409].includes((e as {status?:number}).status??0))setCounterStage(null);
   setDialogError((e as Error).message);
  }finally{setBusy(false);}
 }
 function notifyResult(result:{customerNotification?:string;reason?:string}){
  const messages:Record<string,string>={
   not_sent:'WhatsApp could not send the document.',
   outcome_unknown:'Delivery is uncertain. Check the WhatsApp chat before trying again.',
   already_queued:'This bill is already queued or sent.',
   queued:'Bill queued for WhatsApp.',
  };
  setDeliveryNotice(result.reason||(result.customerNotification?messages[result.customerNotification]??'':''));
 }
 async function sendFinalBill(conversationId?:string){
  if(!order||!current||busy||stale||current.dirty)return;
  setBusy(true);setError('');setDialogError('');
  try{
   const result=await redesignApi(`requests/${order.id}/bill/send`,{
    expectedRevision:current.revision,conversationId,customerOptedIn:conversationId?true:undefined,
   });
   if(bill==='recipient'&&result.customerNotification==='not_sent'){setDialogError(result.reason);return;}
   setBill(null);notifyResult(result);setRefresh(n=>n+1);
  }catch(e){
   if(bill==='recipient')setDialogError((e as Error).message);
   else setError((e as Error).message);
  }finally{setBusy(false);}
 }
 async function run(action:OrderAction){
  if(!order||!current||busy)return;
  if(action==='complete'&&current.dirty){setError('Save your item changes before recording pickup.');return;}
  if(action!=='payment'&&(stale||(action!=='cancel'&&pendingBlocked))){setError('This order changed. Load the latest order before continuing.');return;}
  if(action==='cancel'&&(!cancelTarget||cancelTarget.id!==order.id||cancelTarget.revision!==current.revision||order.stage!=='ready')){
   setCancelTarget(null);setError('This ready order changed. Refresh it before cancelling.');return;
  }
  if(['save','revise','ready','update_ready'].includes(action)){
   const invalid=validation(current.lines);if(invalid){setError(invalid);return;}
  }
  setBusy(true);setError('');setNotice('');setDeliveryNotice('');
  const base='requests/'+order.id;let path:string,body:unknown;
  if(action==='complete'){path=base+'/complete';body={expectedRevision:current.revision,notify:order.source!=='in_store'};}
  else if(action==='cancel'){path=base+'/fulfillment';body={expected:'ready_for_pickup',status:'cancelled',expectedRevision:cancelTarget!.revision,reason:'not_picked_up',notify:false};}
  else if(action==='payment'){path=base+'/advance/confirm';body={received:true,expectedState:order.advance_state,notify:false};}
  else{
   path=base+'/review';
   const ids=new Set(current.lines.map(l=>l.id));
   const payload={expectedRevision:current.revision,amendmentId:current.amendmentId,action,lines:payloadLines(current.lines),
    addedLineIds:current.lines.filter(l=>!current.baseIds.includes(l.id)).map(l=>l.id),
    removedLineIds:current.baseIds.filter(id=>!ids.has(id)),notify:order.source!=='in_store'};
   const key=JSON.stringify([path,payload]);
   if(retry.current?.key!==key)retry.current={key,id:crypto.randomUUID()};
   body={id:retry.current.id,...payload};
  }
  try{
   const result=await redesignApi(path,body);
   retry.current=undefined;
   if(action!=='payment')setEditor(old=>old?{...old,dirty:false}:old);
   setBill(null);setCancelTarget(null);
   const notices:Record<OrderAction,string>={
    save:'Order changes saved.',revise:'Revised bill saved. Order stays in New.',ready:'Order is ready for pickup.',
    update_ready:'Updated pickup bill saved.',complete:'Pickup recorded. Order completed.',
    cancel:'Order cancelled: customer did not pick up.',payment:'₹10 advance marked received.',
   };
   setNotice(notices[action]);notifyResult(result);
   if(action==='ready'||action==='complete'||action==='cancel'){
    navigateOwner({orderStage:action==='ready'?'ready':action==='cancel'?'all':'completed',orderPage:null,order:order.id});
   }
   setRefresh(n=>n+1);
  }catch(e){
   setError((e as Error).message);setBill(null);setCancelTarget(null);setRefresh(n=>n+1);
  }finally{setBusy(false);}
 }
 function warning(l:EditLine){
  if(l.price==='')return 'Enter the final price';
  if(l.quantity==='')return 'Enter the quantity';
  const p=order?.inventory?.find(p=>p.sku===l.sku);if(!l.sku&&!l.manualConfirmed)return 'Choose the exact item';if(!p||p.available===null)return !l.sku&&l.manualConfirmed?'':'Recorded stock unknown · Check in store';if(p.available<=0)return 'Recorded stock: 0 · Check in store';if(Number(l.quantity)>p.available)return `Recorded stock: ${p.available} · Check in store`;return '';}
 return <div className={'rd-orders'+(selectedId?' rd-orders-selected':'')}>
  <aside className="rd-orders-list" aria-label={t("Order list")}><header className="rd-orders-list-head" data-scroll-tools><div className="rd-orders-heading"><PageHeading title={t("Orders")}/><button type="button" className="rd-orders-quiet" onClick={startCounter}>{t("New in-store order")}</button></div><label className="rd-orders-search"><OwnerIcon name="search"/><input aria-label={t("Search customers or orders")} type="search" placeholder={t("Search customers or orders")} value={query} onChange={e=>{if(current?.dirty){if(!window.confirm('Discard unsaved order changes?'))return;if(order)setEditor(makeEditor(order,amendment));}setQuery(e.target.value);}} maxLength={200}/></label><nav data-horizontal-scroll className="rd-orders-tabs" aria-label={t("Order stages")}>{stages.map(([value,label])=><button key={value} aria-pressed={stage===value} onClick={()=>leave({orderStage:value,order:null,orderPage:null})}>{t(label)}{value!=='all'&&snapshot?<span>{value==='ready'?snapshot.requestCounts.ready_for_pickup:snapshot.requestCounts[value]}</span>:null}</button>)}</nav></header><div className="rd-orders-rows" data-scroll-list tabIndex={0} role="region" aria-label={t("Order list")}>
  {!snapshot&&!error?<p className="rd-orders-empty" role="status">{t("Loading orders…")}</p>:null}
  {error&&!snapshot?<div className="rd-orders-empty" role="alert">{t(error)}<button onClick={()=>setRefresh(n=>n+1)}>{t("Try again")}</button></div>:null}
  {listed.map(r=><button key={r.id} className={'rd-orders-list-row'+(order?.id===r.id?' is-active':'')} onClick={()=>{setNotice('');setError('');leave({order:r.id});}}><span className="rd-orders-avatar">{person(r).slice(0,1).toUpperCase()}</span><span className="rd-orders-list-copy"><strong>{t(person(r))}{r.source==='in_store'&&<span className="rd-orders-source">{t("In store")}</span>}{r.unread&&<span className="rd-orders-unread" role="img" aria-label={t("Unread order")} title={t("Not opened yet")}/>}</strong><small>{r.lines.length}{' '}{t(r.lines.length===1?"item ·":"items ·")}{' '}{r.lines.slice(0,2).map(l=>l.name).join(', ')}</small><span>#{code(r.id)} · {date(r.created_at)}</span></span><span className={'rd-orders-stage rd-orders-stage-'+r.stage}>{t(stageLabel(r.stage))}</span><span aria-hidden="true">›</span></button>)}
  {snapshot&&!listed.length?<div className="rd-orders-empty"><strong>{search?t("No matching orders"):t("No orders here")}</strong><p>{search?t("Try a customer, order number or item name."):t("Orders will appear here as customers place them.")}</p></div>:null}
  {snapshot&&(page>1||snapshot.orderPage.hasNext)?<div className="rd-orders-pages"><button disabled={page<=1} onClick={()=>leave({orderPage:String(page-1),order:null})}>{t("Previous")}</button><span>{t("Page")}{' '}{page} · {snapshot.orderPage.total}{' '}{t("orders")}</span><button disabled={!snapshot.orderPage.hasNext} onClick={()=>leave({orderPage:String(page+1),order:null})}>{t("Next")}</button></div>:null}</div></aside>
  <section className="rd-orders-detail" aria-label={t("Selected order")}>{order&&current?<><header className="rd-orders-detail-head"><div><button className="rd-orders-back" onClick={()=>leave({order:null})}>{t("← Orders")}</button><h2>{t(person(order))}{order.source==='in_store'&&<span className="rd-orders-source">{t("In store")}</span>}</h2>{customerContact(order.customer_phone)?<a className="rd-orders-call" href={customerContact(order.customer_phone)!.href} aria-label={(t('Call customer'))+': '+customerContact(order.customer_phone)!.number}>{t('Call')} {customerContact(order.customer_phone)!.number}</a>:null}<p>{t("Order #")}{code(order.id)} · {date(order.created_at)}</p></div><div className="rd-orders-head-actions">{order.conversation_id&&<button onClick={openChat}><OwnerIcon name="messages"/>{' '}{t("Open chat")}</button>}<span className={'rd-orders-stage rd-orders-stage-'+order.stage}>{t(stageLabel(order.stage))}</span></div></header>
   <div className="rd-orders-progress" aria-label={t("Order progress")}>{['new','ready','completed'].map((s,i)=><span key={s} className={order.stage===s?'is-current':''}>{i+1} <span>{t(stageLabel(s))}</span>{i<2?<b aria-hidden="true">›</b>:null}</span>)}</div>
   {error?<p className="rd-orders-notice is-error" role="alert">{t(error)}</p>:null}{notice?<p className="rd-orders-notice" role="status">{t(notice)}</p>:null}{deliveryNotice?<p className="rd-orders-notice is-warning" role="status">{t(deliveryNotice)} {order.conversation_id&&<button onClick={openChat}>{t("Open chat")}</button>}</p>:null}
   {stale?<div className="rd-orders-notice is-warning" role="alert">{t("This order changed while you were editing. Your edits are still here.")}{' '}<button onClick={()=>{setEditor(makeEditor(order,amendment));setError('');}}>{t("Load latest order")}</button><small>{t("Loading the latest order replaces your unsaved edits.")}</small></div>:null}
   {amendment&&order.stage!=='cancelled'&&order.stage!=='completed'?<div className="rd-orders-notice is-warning"><strong>{pendingBlocked?t("Customer change awaiting confirmation"):t("Customer confirmed a change")}</strong><p>{amendment.summary}</p><small>{pendingBlocked?t("Open chat to resolve the customer change before continuing."):t("Review the updated items below. Saving applies this change to the order.")}</small>{pendingBlocked?<button onClick={openChat}>{t("Open chat")}</button>:null}</div>:null}
   <OrderItems lines={current.lines} removed={current.removed} originalLines={order.source==='in_store'?[]:originalLines}
    disabled={busy||stale||pendingBlocked} readOnly={closed} warning={closed?undefined:warning}
    onAdd={()=>pick()} onPick={pick} onUpdate={update} onRemove={removeItem} onUndo={undoRemove}/>
   {order.source!=='in_store'&&<div className="rd-orders-original"><details><summary>{originalEstimate&&originalEstimate.lines.some(l=>l.pricePaise!==undefined)?<>{t("Customer saw")}{' '}{originalEstimate.approximate?'approx. ':''}{formatMoney(originalEstimate.subtotalPaise)}{originalEstimate.unpriced?' subtotal':''}{' '}{t("in WhatsApp")}{originalEstimate.unpriced?t(" · Some prices pending"):''}</>:t("Original bill · Prices pending")} <span>{t("View original bill")}</span></summary><div>{(order.original_lines??order.lines).map(l=><div key={l.id}><span>{l.quantity??'?'} {l.unit} × {l.name}</span><strong>{originalEstimate?.lines.find(original=>original.id===l.id)?.totalPaise===undefined?t("Price pending"):<>{originalEstimate.lines.find(original=>original.id===l.id)?.approximate?t("Approx. "):''}{formatMoney(originalEstimate.lines.find(original=>original.id===l.id)!.totalPaise!)}</>}</strong></div>)}</div></details></div>}
   {(order.advance_required||order.advance_state)?<div className="rd-orders-payment"><span className="rd-orders-payment-icon" aria-hidden="true">₹</span><div><strong>{order.advance_state==='refund_pending'?t("₹10 advance · Refund check needed"):order.advance_state==='verified'?t("₹10 advance received"):order.advance_state==='claimed'?t("Customer says ₹10 paid"):'₹10 advance'}</strong><p>{order.advance_state==='refund_pending'?t("This advance needs a separate refund check. Cancelling does not record a refund."):order.advance_state==='verified'?t("Checked by shop. The remaining bill is settled separately."):['requested','claimed','pay_at_shop'].includes(order.advance_state??'')?t("Check your bank or UPI app before marking received."):(order.advance_state??'Payment not recorded').replaceAll('_',' ')}</p></div>{['requested','claimed','pay_at_shop'].includes(order.advance_state??'')?<button disabled={busy} onClick={()=>void run('payment')}>{t("Mark received")}</button>:null}</div>:null}
   <footer className="rd-orders-footer">
    <div className="rd-orders-total"><span>{t("Total")}</span><strong>{validation(current.lines)?t("Check items"):formatMoney(total(current.lines))}</strong></div>
    {order.stage==='new'&&<>
     <p>{t("Check the items and prices before marking the order ready.")}</p>
     <button className="rd-orders-primary" disabled={busy||stale||pendingBlocked} onClick={()=>showPreview('ready')}>
      {t(order.source==='in_store'?'Mark ready':'Mark ready & send bill')}
     </button>
     <div className="rd-orders-secondary">
      {order.source!=='in_store'&&<button disabled={busy||stale||pendingBlocked} onClick={()=>showPreview('revise')}>{t("Send revised bill")}</button>}
      <button disabled={busy||stale||pendingBlocked||!current.dirty&&!current.amendmentId} onClick={()=>void run('save')}>{t("Save changes")}</button>
     </div>
    </>}
    {order.stage==='ready'&&<>
     <p>{t(current.dirty||current.amendmentId?'Save the item changes before recording pickup.':'Close the order after handing the items to the customer.')}</p>
     {current.dirty||current.amendmentId?<button className="rd-orders-primary" disabled={busy||stale||pendingBlocked} onClick={()=>showPreview('update_ready')}>
      {t(order.source==='in_store'?'Save updated bill':'Save & send updated bill')}
     </button>:<button className="rd-orders-primary" disabled={busy||stale||!!amendment} onClick={()=>void run('complete')}>{t(order.source==='in_store'?"Picked up · Close order":"Picked up · Send invoice")}</button>}
     <button type="button" className="rd-orders-cancel-option" disabled={busy||stale||current.dirty} onClick={()=>setCancelTarget({id:order.id,revision:current.revision})}>{t("Not picked up · Cancel order")}</button>
    </>}
    {order.stage==='completed'&&<p>{t("Pickup recorded. This order is completed.")}</p>}
    {order.stage==='cancelled'&&<p>{t("This order is cancelled.")}</p>}
    {(order.has_final_bill||order.stage==='ready')&&
     <div className="rd-orders-share">
      {order.has_final_bill&&<>
       <a href={billUrl(order.id,'download',current.revision)} download>{t(order.stage==='completed'?'Download invoice':'Download bill')}</a>
       <a href={billUrl(order.id,'print',current.revision)} target="_blank" rel="noopener">{t(order.stage==='completed'?'Print invoice':'Print bill')}</a>
       <button type="button" onClick={()=>setBill('history')}>{t('Bill history')}</button>
      </>}
      {(order.stage==='ready'||order.stage==='completed')&&!['queued','accepted','delivered','unknown'].includes(order.bill_delivery??'')&&
       <button type="button" disabled={busy||stale||current.dirty||!!amendment} onClick={()=>{
        if(order.source==='in_store'){setDialogError('');setBill('recipient');}else void sendFinalBill();
       }}>{t(order.stage==='completed'?'Send invoice':order.source==='in_store'?'Send on WhatsApp':'Send pickup bill')}</button>}
      {order.bill_delivery&&<span role="status">{t(billStatus[order.bill_delivery]??'')}</span>}
     </div>}
   </footer>
  </>:<div className="rd-orders-empty"><h2>{selectedId?t("Order unavailable"):t("Choose an order")}</h2><p>{selectedId?t("Return to the list or try refreshing."):t("Review items and arrange pickup here.")}</p></div>}</section>
  <dialog className="rd-orders-dialog" ref={dialog} onCancel={event=>{event.preventDefault();closeDialog();}} aria-labelledby="rd-orders-dialog-title">
   <div className="rd-orders-dialog-head">
    <h2 id="rd-orders-dialog-title">{t(cancelTarget?'Cancel uncollected order?':picker?pickerIsNew?'Add item':'Replace item':bill==='counter'?'New in-store order':bill==='history'?'Bill history':bill==='recipient'?'Send on WhatsApp':bill==='revise'?'Revised bill':bill==='update_ready'?'Updated pickup bill':'Pickup bill')}</h2>
    <button aria-label={t("Close dialog")} disabled={busy} onClick={closeDialog}>×</button>
   </div>
   {picker?<ItemPicker key={picker}
    line={(bill==='counter'?counter?.lines:current?.lines)?.find(l=>l.id===picker)??emptyLine(picker)}
    original={bill==='counter'?undefined:(amendment?.proposed_lines??originalLines).find(l=>l.id===picker)} onUse={confirmItem}/>
   :bill==='counter'&&counter?<div className="rd-orders-bill rd-orders-counter">
    {dialogError&&<p role="alert" className="rd-orders-notice is-error">{t(dialogError)}</p>}
    <div className="rd-orders-counter-contact">
     <label className="rd-orders-field">{t('Customer name (optional)')}<input maxLength={120} value={counter.customerName} disabled={busy||!!counterStage} onChange={e=>setCounter({...counter,customerName:e.target.value})}/></label>
     <label className="rd-orders-field">{t('Phone (optional)')}<input type="tel" maxLength={24} value={counter.phone} disabled={busy||!!counterStage} onChange={e=>setCounter({...counter,phone:e.target.value})}/></label>
    </div>
    <OrderItems lines={counter.lines} removed={counter.removed} disabled={busy||!!counterStage}
     onAdd={()=>pick()} onPick={pick} onUpdate={update} onRemove={removeItem} onUndo={undoRemove}/>
    <div className="rd-orders-preview-total"><strong>{t('Total')}</strong><strong>{validation(counter.lines)?'—':formatMoney(total(counter.lines))}</strong></div>
    <div className="rd-orders-counter-actions">
     <button type="button" className="rd-orders-quiet" disabled={busy||!counter.lines.length||counterStage==='completed'} onClick={()=>void saveCounter('new')}>{t('Save to New')}</button>
     <button type="button" className="rd-orders-primary" disabled={busy||!counter.lines.length||counterStage==='new'} onClick={()=>void saveCounter('completed')}>{t('Save as completed')}</button>
    </div>
   </div>:bill==='history'&&order?<OrderBillHistory key={order.id} orderId={order.id}/>
   :bill==='recipient'&&order?<>
    {dialogError&&<p role="alert" className="rd-orders-notice is-error">{t(dialogError)}</p>}
    <ConfirmBillRecipient key={order.id} orderId={order.id} phone={order.customer_phone||undefined} linked={!!order.conversation_id} busy={busy} onSend={id=>void sendFinalBill(id)}/>
   </>:current&&order&&(bill==='revise'||bill==='ready'||bill==='update_ready')?<div className="rd-orders-bill">
    <p>{snapshot?.store?.name}{snapshot?.store?.bill_address&&<><br/>{snapshot.store.bill_address}</>}<br/>{t("Order #")}{code(order.id)}</p>
    <p>{t(bill==='revise'?'The order stays in New. The customer will receive an updated bill.':bill==='update_ready'?'The updated bill replaces the previous one.':'Check these items and prices before marking ready.')}</p>
    {current.lines.map(l=><div key={l.id}><span>{l.name}<br/>{l.quantity} {l.unit} × {formatMoney(Math.round(Number(l.price)*100))}</span><strong>{formatMoney(lineAmount(l))}</strong></div>)}
    <div><strong>{t("Final total")}</strong><strong>{formatMoney(total(current.lines))}</strong></div>
    <button className="rd-orders-primary" disabled={busy||stale||pendingBlocked} onClick={()=>void run(bill)}>
     {t(busy?'Saving…':bill==='revise'?'Send revised bill':bill==='ready'?order.source==='in_store'?'Mark ready':'Mark ready & send bill':order.source==='in_store'?'Save updated bill':'Save & send updated bill')}
    </button>
   </div>:null}{cancelTarget?<div className="rd-orders-cancel-confirm">{stale||order?.id!==cancelTarget.id||current?.revision!==cancelTarget.revision||order?.stage!=='ready'?<p className="rd-orders-notice is-warning" role="alert">{t("This order changed. Close this dialog and check the latest order before cancelling.")}</p>:null}<p>{t("Cancel this order only if the customer will not collect it. It will leave Ready for pickup and remain in All as Cancelled.")}</p>{order?.advance_state==='verified'||order?.advance_state==='refund_pending'?<p className="rd-orders-notice is-warning">{t("The ₹10 advance needs a separate refund check. Cancelling does not record a refund.")}</p>:order?.advance_state==='claimed'?<p className="rd-orders-notice is-warning">{t("The customer reported an advance payment. Check whether any refund is due.")}</p>:null}<div className="rd-orders-cancel-actions"><button type="button" disabled={busy} onClick={()=>setCancelTarget(null)}>{t("Keep ready for pickup")}</button><button type="button" className="rd-orders-cancel-submit" disabled={busy||stale||order?.id!==cancelTarget.id||current?.revision!==cancelTarget.revision||order?.stage!=='ready'} onClick={()=>void run('cancel')}>{busy?t("Cancelling…"):t("Cancel order")}</button></div></div>:null}</dialog>
 </div>;
}

const billStatus:Record<string,string>={
 queued:'WhatsApp bill queued',accepted:'WhatsApp bill sent',delivered:'WhatsApp bill delivered',failed:'WhatsApp bill could not be delivered',unknown:'WhatsApp delivery uncertain',
};
function OrderItems({lines,removed,originalLines=[],warning,readOnly=false,disabled,onAdd,onPick,onUpdate,onRemove,onUndo}:{
 lines:EditLine[];removed:{line:EditLine;index:number}[];originalLines?:DraftLine[];warning?:(line:EditLine)=>string;
 readOnly?:boolean;disabled:boolean;onAdd:()=>void;onPick:(id:string)=>void;onUpdate:(id:string,patch:Partial<EditLine>)=>void;
 onRemove:(id:string)=>void;onUndo:(id:string)=>void;
}){
 const {t}=useOwnerLocale(),openPhoto=useOwnerPhoto();
 const rows=lines.map(line=>({line,issue:warning?.(line)??''}));
 const groups=[rows.filter(row=>row.issue),rows.filter(row=>!row.issue)];
 return <div className="rd-orders-items">
  <div className="rd-orders-items-head"><h3>{t('Items')} <span>({lines.length})</span></h3>
   {!readOnly&&<button type="button" className="rd-orders-quiet" disabled={disabled||lines.length>=50} onClick={onAdd}>{t('Add item')}</button>}
  </div>
  {!lines.length&&<p className="rd-orders-empty-items">{t('Add at least one item to the order.')}</p>}
  {groups.map((rows,index)=>rows.length>0&&<div className="rd-orders-item-group" key={index}>
   {index===0&&<h4 className="rd-orders-warning">{t('Needs checking')}</h4>}
   {rows.map(({line:l,issue})=>{
    const original=originalLines.find(item=>item.id===l.id);
    return <div className="rd-orders-item" key={l.id}>
     <div className="rd-orders-item-identity">
      {l.sku&&l.photo?<button type="button" className="rd-photo-trigger rd-orders-thumb" aria-label={t('View photo')+' '+l.name}
       onClick={()=>openPhoto({src:'/api/owner/products/'+encodeURIComponent(l.sku!)+'/image'+(l.productVersion?'?v='+l.productVersion:''),name:l.name})}><Thumb line={l}/></button>
       :<span className="rd-orders-thumb"><Thumb line={l}/></span>}
      <div className="rd-orders-item-name"><strong>{l.name||t('Choose item')}</strong>
       {issue&&<small className="rd-orders-warning">{t(issue)}</small>}
       {original&&<details><summary>{t('Customer asked for')}</summary><p>{originalWords(original)}</p></details>}
      </div>
     </div>
     <label className="rd-orders-field">{t('Qty')}
      {readOnly?<strong>{l.quantity}</strong>:<input aria-label={t('Quantity')+' '+l.name} type="number" min="0.001" max="100" step={l.step??'any'} disabled={disabled} value={l.quantity} onChange={e=>onUpdate(l.id,{quantity:e.target.value})}/>}
      <small>{l.unit}</small>
     </label>
     <label className="rd-orders-field">{t('Price each (₹)')}
      {readOnly?<strong>{l.price===''?'—':formatMoney(Math.round(Number(l.price)*100))}</strong>
       :<input aria-label={t('Price each (₹)')+' '+l.name} type="number" min="0" step="0.01" disabled={disabled} value={l.price} placeholder={t('Enter price')} onChange={e=>onUpdate(l.id,{price:e.target.value,manualConfirmed:true,free:false})}/>}
      {!readOnly&&l.price!==''&&Number(l.price)===0&&<span className="rd-orders-free"><input aria-label={t('Free item')+' '+l.name} type="checkbox" checked={l.free} disabled={disabled} onChange={e=>onUpdate(l.id,{free:e.target.checked,manualConfirmed:true})}/>{t('Free item')}</span>}
     </label>
     <output className="rd-orders-line-total"><span>{t('Amount')}</span><strong>{Number(l.quantity)>0&&Number(l.quantity)<=100&&l.price!==''&&Number(l.price)>=0&&Number(l.price)<=1000000?formatMoney(lineAmount(l)):'—'}</strong></output>
     {!readOnly&&<div className="rd-orders-item-actions">
      <button type="button" aria-label={t('Replace')+' '+l.name} disabled={disabled} onClick={()=>onPick(l.id)}>{t('Replace')}</button>
      <button type="button" aria-label={t('Remove')+' '+l.name} disabled={disabled} onClick={()=>onRemove(l.id)}>{t('Remove')}</button>
     </div>}
    </div>;
   })}
  </div>)}
  {!readOnly&&removed.map(({line})=><div className="rd-orders-removed" key={line.id}><span>{line.name} · {t('Removed')}</span><button type="button" className="rd-orders-quiet" disabled={disabled||lines.length>=50} onClick={()=>onUndo(line.id)}>{t('Undo')}</button></div>)}
 </div>;
}

function ItemPicker({line,original,onUse}:{line:EditLine;original?:DraftLine;onUse:(patch:Partial<EditLine>)=>void}){
 const {t}=useOwnerLocale();
 const [query,setQuery]=useState(''),[products,setProducts]=useState<Product[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState<Product|null|undefined>(),[draft,setDraft]=useState<EditLine>(line);
 useEffect(()=>{const controller=new AbortController(),timer=setTimeout(async()=>{setLoading(true);try{const data=await redesignApi<{products:Product[]}>('catalog?'+new URLSearchParams({q:query,visibility:'visible',limit:'30'}),undefined,controller.signal);if(!controller.signal.aborted){setProducts(data.products);setError('');}}catch(e){if(!controller.signal.aborted)setError((e as Error).message);}finally{if(!controller.signal.aborted)setLoading(false);}},200);return()=>{controller.abort();clearTimeout(timer);};},[query]);
 function choose(p:Product|null){setSelected(p);setError('');setDraft(p?{...line,sku:p.sku,name:p.name,unit:p.unit,price:p.priceStatus==='confirm'?'':String(p.pricePaise/100),productVersion:p.version,photo:!!p.imageUrl,step:p.quantityStep,saleMode:p.sellingPolicy?.saleMode,free:p.priceStatus==='free',manualConfirmed:false}:{...line,sku:undefined,productVersion:undefined,photo:false,step:undefined,saleMode:undefined,manualConfirmed:true});}
 function submit(){const invalid=validation([{...draft,manualConfirmed:true}]);if(invalid){setError(invalid);return;}onUse({...draft,manualConfirmed:true});}
 return <div className="rd-orders-picker">{original&&<div className="rd-orders-request"><small>{t("Customer asked for")}</small><p>{originalWords(original)}</p></div>}{selected===undefined?<><label className="rd-orders-picker-search">{t("Find a product · English or Tamil")}<input autoFocus type="search" placeholder={t("Search name, brand or size")} value={query} onChange={e=>setQuery(e.target.value)}/></label>{error?<p role="alert" className="rd-orders-warning">{t(error)}</p>:null}<div className="rd-orders-results" aria-busy={loading}>{loading?<p role="status">{t("Searching products…")}</p>:products.length?products.map(p=><button key={p.sku} onClick={()=>choose(p)}><span className="rd-orders-thumb"><Thumb line={{...line,sku:p.sku,name:p.name,photo:!!p.imageUrl,productVersion:p.version}}/></span><span><strong>{p.name}</strong><small>{p.priceStatus==='confirm'?t("Enter actual price"):formatMoney(p.pricePaise)} / {p.unit}</small><small>{p.stock===null?t("Recorded stock unknown"):p.stock<=0?t("Recorded stock: 0 · Check in store"):`Recorded stock: ${p.stock}`}</small></span><b aria-hidden="true">›</b></button>):<p>{t("No matching product. You can still use an item from your store.")}</p>}</div><div className="rd-orders-store"><span>{t("Have it in store, but not listed?")}</span><button onClick={()=>choose(null)}>{t("Use store item")}</button></div></>:<><h3>{selected?t("Use this product"):t("Use store item")}</h3><label className="rd-orders-field">{t("Item name")}<input autoFocus value={draft.name} readOnly={!!selected} onChange={e=>setDraft(d=>({...d,name:e.target.value}))} maxLength={200}/></label><div className="rd-orders-picker-grid"><label className="rd-orders-field">{t("Quantity")}<input type="number" min="0.001" max="100" step={draft.step??'any'} value={draft.quantity} onChange={e=>setDraft(d=>({...d,quantity:e.target.value}))}/></label><label className="rd-orders-field">{t("Selling unit")}{selected?<input readOnly value={draft.unit}/>:<select value={draft.unit} onChange={e=>setDraft(d=>({...d,unit:e.target.value}))}><option value="">{t("Choose unit")}</option>{[...new Set([...SELLING_UNITS,...(draft.unit?[draft.unit]:[])])].map(unit=><option key={unit}>{unit}</option>)}</select>}</label><label className="rd-orders-field">{t("Price each (₹)")}<input type="number" min="0" step="0.01" value={draft.price} onChange={e=>setDraft(d=>({...d,price:e.target.value,free:false}))}/></label></div>{draft.price!==''&&Number(draft.price)===0?<label className="rd-orders-free"><input type="checkbox" checked={draft.free} onChange={e=>setDraft(d=>({...d,free:e.target.checked}))}/>{' '}{t("This item is free")}</label>:null}{selected?.stock===0?<p className="rd-orders-notice is-warning">{t("Recorded stock is 0. You can use this item if you have it in store.")}</p>:null}{!selected?<p>{t("Added to this order only. Your product list stays the same.")}</p>:null}{error?<p role="alert" className="rd-orders-warning">{t(error)}</p>:null}<div className="rd-orders-picker-actions"><button onClick={()=>setSelected(undefined)}>{t("Back to search")}</button><button className="rd-orders-primary" onClick={submit}>{t("Use this item")}</button></div></>}</div>;
}
