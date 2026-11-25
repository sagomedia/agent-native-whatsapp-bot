import {customerContact} from './customer-contact.js';
import {cachedOwnerRead,ownerReadGeneration} from './owner-read-cache.js';
import {useEffect,useId,useRef,useState} from 'react';
import type {DraftLine} from '../../../packages/contracts/index.js';
import {formatMoney,lineTotal} from '../../../packages/contracts/money.js';
import {initialQuoteLines} from '../../../packages/contracts/owner-quote-fields.js';
import {SELLING_UNITS} from '../../../packages/contracts/selling-unit-values.js';
import {navigateOwner,useOwnerUrl,photoVariant,OwnerLoading} from './owner-ui.js';
import {OwnerIcon} from './OwnerIcon.js';
import {visiblePoll} from './owner-polling.js';
import {readOwnerView,redesignApi} from './redesign-api.js';
import {orderReads} from './owner-view-reads.js';
import './redesign-orders.css';
import {useOwnerLocale} from './owner-locale.js';
import {PageHeading} from './mobile-workspace.js';
import {ConfirmBillRecipient,OrderBillHistory,billUrl,whatsappPhone} from './OrderBillActions.js';
import {useOwnerPhoto} from './OwnerPhotoViewer.js';
import {OrderActionMenu,type OrderMenuAction} from './OrderActionMenu.js';

type Product={sku:string;version:number;name:string;unit:string;pricePaise:number;priceStatus:string;stock:number|null;quantityStep?:number;imageUrl?:string;sellingPolicy?:{saleMode?:'pack'|'measured'}};
type OriginalEstimate={lines:{id:string;pricePaise?:number;totalPaise?:number;approximate:boolean}[];subtotalPaise:number;unpriced:number;approximate:boolean};
type Order={unread?:boolean;attention_key?:string;original_estimate:OriginalEstimate;id:string;conversation_id:string|null;source?:'chat'|'in_store';has_final_bill?:boolean;bill_reply_window_closed?:boolean;bill_delivery?:string|null;customer_name?:string;customer_phone?:string;actor?:string;stage:'new'|'ready'|'completed'|'cancelled';lines:DraftLine[];original_lines:DraftLine[];original_total_paise:string;total_paise:string;effective_revision:number;created_at:string;advance_required:boolean;advance_state?:string;advance_amount_paise?:number;inventory?:{sku:string;name?:string;unit?:string;active?:boolean;quantityStep?:number;available:number|null;hasPhoto:boolean;version:number}[]};
type Amendment={id:string;request_id:string;state:string;kind:string;summary:string;proposed_lines:DraftLine[]};
type OrderListRow=Pick<Order,'id'|'actor'|'source'|'customer_name'|'customer_phone'|'unread'|'attention_key'|'stage'|'created_at'>&{item_count:number;item_names:(string|null)[]};
type Snapshot={store?:{name:string;bill_address?:string|null};requests:OrderListRow[];selectedOrder:Order|null;amendments:Amendment[];orderPage:{number:number;total:number;hasNext:boolean;ids:string[]};requestCounts:{new:number;ready_for_pickup:number;completed:number;active:number;history:number}};
type EditLine={id:string;sku?:string;productVersion?:number;name:string;quantity:string;unit:string;price:string;manualConfirmed?:boolean;free:boolean;saleMode?:'pack'|'measured';photo?:boolean;step?:number;needsMatch?:boolean};
type Editor={orderId:string;revision:number;amendmentId?:string;source:string;lines:EditLine[];baseIds:string[];removed:{line:EditLine;index:number}[];dirty:boolean};
const workflowStages=['new','ready','completed'] as const;
const stages=[['new','New'],['ready','Ready'],['completed','Completed'],['all','All']] as const;
const code=(id:string)=>id.replaceAll('-','').slice(0,8).toUpperCase();
const person=(r:OrderListRow|Order)=>r.customer_name||r.customer_phone||r.actor?.replace(/^whatsapp:/,'')||(r.source==='in_store'?'Walk-in customer':'Customer');
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
type DialogView='revise'|'ready'|'update_ready'|'counter'|'history'|'original'|'recipient'|null;
const originalWords=(line:DraftLine|undefined)=>line?.supportingPhrase||line?.query||line?.name||'Requested item';
const date=(value:string)=>new Date(value).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
function sourceKey(r:Order,a?:Amendment){return JSON.stringify([r.effective_revision,r.stage,a?.id,a?.state,a?.proposed_lines]);}
function makeEditor(r:Order,a?:Amendment):Editor{
 const accepted=a?.state==='owner_pending'&&a.kind==='change'?a:undefined;
 const lines=(accepted?.proposed_lines??r.lines).map(l=>{
  const initial=initialQuoteLines([l])[0]!,original=r.original_lines?.find(original=>original.id===l.id),estimate=r.original_estimate?.lines.find(original=>original.id===l.id);
  // Only reuse the submitted estimate for the same product and selling unit.
  const originalPrice=original?.sku===l.sku&&original?.unit===l.unit?estimate?.pricePaise:undefined;
  const product=r.inventory?.find(p=>p.sku===l.sku);
  const retained=l.candidates?.find(p=>p.sku===l.sku&&p.name===l.name&&p.unit===l.unit);
  const step=product?.active!==false&&product?.name===l.name&&product.unit===l.unit?product.quantityStep??retained?.quantityStep:retained?.quantityStep;
  return {id:l.id,sku:l.sku,productVersion:l.productVersion,name:l.name,quantity:l.quantity===null?'':String(l.quantity),
   unit:l.unit??'',price:initial.price||(originalPrice!==undefined?String(originalPrice/100):''),manualConfirmed:!!l.merchantConfirmed,
   free:initial.free,saleMode:l.merchantConfirmed?.saleMode,photo:product?.hasPhoto,step,
   needsMatch:!l.merchantConfirmed&&l.resolution==='needs_choice'};
 });
 return {orderId:r.id,revision:r.effective_revision,source:sourceKey(r,a),amendmentId:accepted?.id,dirty:false,lines,baseIds:lines.map(l=>l.id),removed:[]};
}
function validation(lines:EditLine[]):string{
 if(!lines.length)return 'Add at least one item to the order.';
 if(lines.length>50)return 'An order can contain up to 50 items.';
 for(const l of lines){
  const qty=Number(l.quantity),price=Number(l.price);
  if(!l.name.trim()||!l.unit.trim()||!l.quantity||!Number.isFinite(qty)||qty<=0||qty>100||
    Math.abs(qty*1000-Math.round(qty*1000))>1e-7||!l.price||!Number.isFinite(price)||price<0||price>1000000||
    Math.abs(price*100-Math.round(price*100))>1e-7){
   return `${l.name||'Item'}: enter a name, quantity (up to 100), selling unit and price with up to two decimals.`;
  }
  const step=Math.round((l.step??0)*1000);
  if(step&&Math.round(qty*1000)%step)return `${l.name}: use increments of ${l.step} ${l.unit}.`;
  if(price===0&&!l.free)return `${l.name}: enter a price or mark the item free.`;
  if(!l.sku&&!l.manualConfirmed)return `${l.name}: choose the item or confirm it with Use store item.`;
 }
 return '';
}

function quantityAfterStep(line:EditLine,direction:-1|1){
 const step=Math.round((line.step??0)*1000);
 const input=Number(line.quantity);
 const current=Number.isFinite(input)?Math.round(input*1000):0;
 const next=step
  ?(direction>0?Math.floor(current/step)+1:Math.ceil(current/step)-1)*step
  :current+direction*1000;
 return next>0&&next<=100000?String(next/1000):undefined;
}

function Thumb({line}:{line:EditLine}){return line.sku&&line.photo?<img alt="" src={photoVariant('/api/owner/products/'+encodeURIComponent(line.sku)+'/image'+(line.productVersion?'?v='+line.productVersion:''),128)} loading="lazy" decoding="async" onError={e=>{e.currentTarget.style.display='none';}}/>:<span aria-hidden="true">{line.name.slice(0,1)||'?'}</span>;}

export function RedesignOrders(){
 const {t}=useOwnerLocale();
 const {stage,page,search,selectedId,listPath,readPath}=orderReads(useOwnerUrl());
 const [loaded,setLoaded]=useState<{path:string;listPath:string;snapshot:Snapshot}|undefined>(()=>{
  const retained=cachedOwnerRead<Snapshot>(readPath);
  return retained?{path:readPath,listPath,snapshot:retained}:undefined;
 });
 const [confirmed,setConfirmed]=useState<{id:string;name:string;stage:'ready'|'completed'}>();
 const cached=loaded?.path!==readPath?cachedOwnerRead<Snapshot>(readPath):undefined;
 const snapshot=cached??loaded?.snapshot;
 const listSnapshot=cached??(loaded?.listPath===listPath?snapshot:undefined);
 const [readFailure,setReadFailure]=useState<{path:string;message:string}>();
 const readError=readFailure?.path===readPath?readFailure.message:'';
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[deliveryNotice,setDeliveryNotice]=useState(''),[busy,setBusy]=useState(false),[editor,setEditor]=useState<Editor>(),[refresh,setRefresh]=useState(0),[query,setQuery]=useState(search),[picker,setPicker]=useState<string>(),[bill,setBill]=useState<DialogView>(null),[cancelTarget,setCancelTarget]=useState<{id:string;revision:number}|null>(null);
 const orderWrite=useRef(false);
 const [pendingAction,setPendingAction]=useState<OrderAction|null>(null);
 const previewTarget=useRef<{id:string;source:string}|null>(null);
 const [counter,setCounter]=useState<CounterDraft|null>(null);
 const [dialogError,setDialogError]=useState('');
 const [pickerIsNew,setPickerIsNew]=useState(false);
 const [counterStage,setCounterStage]=useState<'new'|'completed'|null>(null);
 const retry=useRef<{key:string;id:string}|undefined>(undefined),dialog=useRef<HTMLDialogElement>(null),returnFocus=useRef<HTMLElement|null>(null);
 useEffect(()=>setQuery(search),[search]);
 useEffect(()=>{const timer=setTimeout(()=>{if(query!==search)navigateOwner({orderSearch:query||null,orderPage:null,order:null},true);},250);return()=>clearTimeout(timer);},[query,search]);
 useEffect(()=>visiblePoll(async signal=>{
  try{
   const generation=ownerReadGeneration();
   const data=await readOwnerView<Snapshot>(readPath,signal);
   if(!signal.aborted&&generation===ownerReadGeneration()){setConfirmed(undefined);setLoaded({path:readPath,listPath,snapshot:data});setReadFailure(undefined);}
  }catch(e){if(!signal.aborted)setReadFailure({path:readPath,message:(e as Error).message});throw e;}
 },{intervalMs:5000}),[readPath,refresh]);
 // Warm just the next stage once the foreground list has loaded. Navigation can
 // join the same in-flight GET. Skip speculative reads on metered connections.
 const hasList=!!listSnapshot;
 useEffect(()=>{
  if(!hasList||search||page!==1||!['new','ready'].includes(stage))return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{
   const network=(navigator as Navigator&{connection?:{saveData?:boolean;effectiveType?:string}}).connection;
   if(document.hidden||!navigator.onLine||network?.saveData||/2g/.test(network?.effectiveType??'')||orderWrite.current)return;
   const path=orderReads(new URLSearchParams({orderStage:stage==='new'?'ready':'completed'})).readPath;
   if(!cachedOwnerRead(path,15000))void redesignApi(path,undefined,controller.signal).catch(()=>{});
  },1200);
  return ()=>{clearTimeout(timer);controller.abort();};
 },[stage,hasList,search,page]);
 const listed=listSnapshot?.requests??[],wantedOrder=selectedId??listed[0]?.id;
 const order=listSnapshot?.selectedOrder?.id===wantedOrder?listSnapshot?.selectedOrder??undefined:undefined;
 const loadingDetail=!!listSnapshot&&!order&&loaded?.path!==readPath&&!readError;
 const amendment=snapshot?.amendments.find(a=>a.request_id===order?.id),source=order?sourceKey(order,amendment):'';
 useEffect(()=>{if(!order)return;setEditor(old=>old?.orderId===order.id&&old.dirty?old:makeEditor(order,amendment));},[order?.id,source]);
 const [seenKeys,setSeenKeys]=useState(()=>new Set<string>());
 const seen=useRef(new Set<string>());
 useEffect(()=>{
  if(!selectedId||!order||order.id!==selectedId||!order.attention_key||!order.unread)return;
  const key=order.id+':'+order.attention_key;
  const updateDot=(visible:boolean)=>setSeenKeys(previous=>{
   const next=new Set(previous);
   if(visible)next.delete(key);else next.add(key);
   return next;
  });
  let cancelled=false,retryTimer:number|undefined;
  const mark=()=>{
   if(cancelled||document.hidden||!document.querySelector('.rd-orders-detail')?.getClientRects().length||seen.current.has(key))return;
   seen.current.add(key);updateDot(false);
   void redesignApi<{seen:boolean}>(`requests/${order.id}/seen`,{attentionKey:order.attention_key}).then(result=>{
    if(result.seen)window.dispatchEvent(new Event('owner-attention-changed'));
    else{
     seen.current.delete(key);
     updateDot(true);
     if(!cancelled)setRefresh(n=>n+1);
    }
   }).catch(()=>{
    seen.current.delete(key);
    updateDot(true);
    if(!cancelled)retryTimer=window.setTimeout(mark,3000);
   });
  };
  const frame=requestAnimationFrame(mark);
  document.addEventListener('visibilitychange',mark);
  return()=>{cancelled=true;cancelAnimationFrame(frame);window.clearTimeout(retryTimer);document.removeEventListener('visibilitychange',mark);};
 },[selectedId,order?.id,order?.attention_key,order?.unread]);
 const originalLines=order?.original_lines??[],originalEstimate=order?.original_estimate;
 const current=editor?.orderId===order?.id?editor:undefined,stale=!!(current&&source!==current.source),closed=order?.stage!=='new'&&order?.stage!=='ready',pendingBlocked=!!amendment&&(amendment.state!=='owner_pending'||amendment.kind!=='change');
 useEffect(()=>{if(!current?.dirty)return;const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};const navigate=(event:globalThis.MouseEvent)=>{const anchor=(event.target as Element).closest?.('a[href]') as HTMLAnchorElement|null;if(!anchor||event.defaultPrevented||event.metaKey||event.ctrlKey||event.shiftKey||anchor.target==='_blank'||anchor.hasAttribute('download')||anchor.getAttribute('href')?.startsWith('#'))return;if(!window.confirm('Discard unsaved order changes?')){event.preventDefault();event.stopPropagation();}else window.removeEventListener('beforeunload',unload);};window.addEventListener('beforeunload',unload);document.addEventListener('click',navigate,true);return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',navigate,true);};},[current?.dirty]);
 const modalOpen=!!(picker||bill||cancelTarget);
 useEffect(()=>{
  if(modalOpen){returnFocus.current=document.activeElement as HTMLElement;dialog.current?.showModal();}
  else if(dialog.current?.open){dialog.current.close();returnFocus.current?.focus();}
 },[modalOpen]);
 useEffect(()=>{
  if(picker)dialog.current?.querySelector<HTMLInputElement>('.rd-orders-picker-search input')?.focus();
 },[picker]);
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
  else if(order&&current){previewTarget.current={id:order.id,source:current.source};setError('');setDialogError('');setBill(action);}
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
  setDeliveryNotice((result.customerNotification&&messages[result.customerNotification])?(result.reason||messages[result.customerNotification]):'');
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
  if(!order||!current||busy||orderWrite.current)return;
  if((action==='revise'||action==='ready'||action==='update_ready')&&
     (previewTarget.current?.id!==order.id||previewTarget.current.source!==current.source)){
   setBill(null);setError('This order changed. Load the latest order before continuing.');return;
  }
  if(action==='complete'&&current.dirty){setError('Save your item changes before recording pickup.');return;}
  if(action!=='payment'&&(stale||(action!=='cancel'&&pendingBlocked))){setError('This order changed. Load the latest order before continuing.');return;}
  if(action==='cancel'&&(!cancelTarget||cancelTarget.id!==order.id||cancelTarget.revision!==current.revision||order.stage!=='ready')){
   setCancelTarget(null);setError('This ready order changed. Refresh it before cancelling.');return;
  }
  if(['save','revise','ready','update_ready'].includes(action)){
   const invalid=validation(current.lines);if(invalid){setError(invalid);return;}
  }
  orderWrite.current=true;setPendingAction(action);setBusy(true);setError('');setNotice('');setDeliveryNotice('');
  const startRoute=window.location.search;
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
   if(action!=='payment')setEditor(old=>old===current?{...old,dirty:false}:old);
   if(window.location.search!==startRoute){setRefresh(n=>n+1);return;}
   setBill(null);setCancelTarget(null);
   const notices:Record<OrderAction,string>={
    save:'Order changes saved.',revise:'Revised bill saved. Order stays in New.',ready:'Order is ready for pickup.',
    update_ready:'Updated pickup bill saved.',complete:'Pickup recorded. Order completed.',
    cancel:'Order cancelled: customer did not pick up.',payment:'₹10 advance marked received.',
   };
   setNotice(notices[action]);notifyResult(result);
   if(action==='ready'||action==='complete'||action==='cancel'){
    if(result.requestId===order.id&&(result.stage==='ready'||result.stage==='completed'))setConfirmed({id:order.id,name:person(order),stage:result.stage});
    navigateOwner({orderStage:action==='ready'?'ready':action==='cancel'?'all':'completed',orderPage:null,order:order.id});
   }
   setRefresh(n=>n+1);
  }catch(e){
   if(window.location.search===startRoute){
    setError((e as Error).message);setBill(null);setCancelTarget(null);setRefresh(n=>n+1);
   }
  }finally{orderWrite.current=false;setPendingAction(null);setBusy(false);}
 }
 function warning(l:EditLine){
  const issues=[];
  if(l.needsMatch||!l.sku&&!l.manualConfirmed)issues.push('Choose the exact item');
  if(l.price==='')issues.push('Enter the final price');
  if(l.quantity==='')issues.push('Enter the quantity');
  if(issues.length)return issues;
  const p=order?.inventory?.find(p=>p.sku===l.sku);if(!p||p.available===null)return !l.sku&&l.manualConfirmed?[]:['Recorded stock unknown · Check in store'];if(p.available<=0)return ['Recorded stock: 0 · Check in store'];if(Number(l.quantity)>p.available)return [`Recorded stock: ${p.available} · Check in store`];return [];}
 const currentStep=workflowStages.findIndex(step=>step===order?.stage);
 return <div className={'rd-orders'+(selectedId?' rd-orders-selected':'')}>
  <aside className="rd-orders-list" aria-label={t("Order list")}><header className="rd-orders-list-head" data-scroll-tools><div className="rd-orders-heading"><PageHeading title={t("Orders")}/><button type="button" className="rd-orders-quiet" onClick={startCounter}><OwnerIcon name="plus"/>{t("New in-store order")}</button></div><label className="rd-orders-search"><OwnerIcon name="search"/><input aria-label={t("Search customers or orders")} type="search" placeholder={t("Search customers or orders")} value={query} onChange={e=>{if(current?.dirty){if(!window.confirm('Discard unsaved order changes?'))return;if(order)setEditor(makeEditor(order,amendment));}setQuery(e.target.value);}} maxLength={200}/></label><nav data-horizontal-scroll className="rd-orders-tabs" aria-label={t("Order stages")}>{stages.map(([value,label])=><button key={value} aria-pressed={stage===value} onClick={()=>leave({orderStage:value,order:null,orderPage:null})}>{t(label)}{value!=='all'&&snapshot?<span>{value==='ready'?snapshot.requestCounts.ready_for_pickup:snapshot.requestCounts[value]}</span>:null}</button>)}</nav></header><div className="rd-orders-rows" data-scroll-list tabIndex={0} role="region" aria-label={t("Order list")}>
  {!listSnapshot&&!readError?<OwnerLoading label={t("Loading orders…")} variant="rows"/>:null}
  {readError&&!listSnapshot?<div className="rd-orders-empty" role="alert">{t(readError)}<button onClick={()=>setRefresh(n=>n+1)}>{t("Try again")}</button></div>:null}
  {listed.map(r=><button key={r.id} className={'rd-orders-list-row'+(wantedOrder===r.id?' is-active':'')} aria-current={wantedOrder===r.id?'true':undefined} onClick={()=>{setNotice('');setError('');leave({order:r.id});}}><span className="rd-orders-avatar">{person(r).slice(0,1).toUpperCase()}</span><span className="rd-orders-list-copy"><strong>{t(person(r))}{r.source==='in_store'&&<span className="rd-orders-source">{t("In store")}</span>}{r.unread&&!seenKeys.has(r.id+':'+r.attention_key)&&<span className="rd-orders-unread" role="img" aria-label={t("Unread order")} title={t("Not opened yet")}/>}</strong><small>{r.item_count}{' '}{t(r.item_count===1?"item ·":"items ·")}{' '}{r.item_names.filter(name=>name!==null).join(', ')}</small><span>#{code(r.id)} · {date(r.created_at)}</span></span>{stage==='all'&&<span className={'rd-orders-stage rd-orders-stage-'+r.stage}>{t(stageLabel(r.stage))}</span>}<span aria-hidden="true">›</span></button>)}
  {listSnapshot&&!listed.length?<div className="rd-orders-empty"><strong>{search?t("No matching orders"):t("No orders here")}</strong><p>{search?t("Try a customer, order number or item name."):t("Orders will appear here as customers place them.")}</p></div>:null}
  {listSnapshot&&(page>1||listSnapshot.orderPage.hasNext)?<div className="rd-orders-pages"><button disabled={page<=1} onClick={()=>leave({orderPage:String(page-1),order:null})}>{t("Previous")}</button><span>{t("Page")}{' '}{page} · {listSnapshot.orderPage.total}{' '}{t("orders")}</span><button disabled={!listSnapshot.orderPage.hasNext} onClick={()=>leave({orderPage:String(page+1),order:null})}>{t("Next")}</button></div>:null}</div></aside>
  <section className="rd-orders-detail" aria-label={t("Selected order")}>{order&&current?<><header className="rd-orders-detail-head"><div><button className="rd-orders-back" onClick={()=>leave({order:null})}>{t("← Orders")}</button><h2>{t(person(order))}{order.source==='in_store'&&<span className="rd-orders-source">{t("In store")}</span>}</h2>{customerContact(order.customer_phone)?<a className="rd-orders-quiet rd-orders-call" href={customerContact(order.customer_phone)!.href} aria-label={(t('Call customer'))+': '+customerContact(order.customer_phone)!.number}>{t('Call')} {customerContact(order.customer_phone)!.number}</a>:null}<p>{t("Order #")}{code(order.id)} · {date(order.created_at)}</p></div><div className="rd-orders-head-actions">{order.conversation_id&&<button className="rd-orders-quiet" onClick={openChat}><OwnerIcon name="messages"/>{' '}{t("Open chat")}</button>}<span className={'rd-orders-stage rd-orders-stage-'+order.stage}>{t(stageLabel(order.stage))}</span></div></header>
   {order.stage!=='cancelled'&&<ol className="rd-orders-progress" aria-label={t("Order progress")}>
    {workflowStages.map((step,index)=><li key={step} aria-current={order.stage===step?'step':undefined}
      className={index<currentStep?'is-done':undefined}>
     <span className="rd-orders-step-marker" aria-hidden="true">{index<currentStep?<OwnerIcon name="check"/>:index+1}</span>
     <span>{t(stageLabel(step))}</span>
    </li>)}
   </ol>}
   {error?<p className="rd-orders-notice is-error" role="alert">{t(error)}</p>:null}
   {readError?<p className="rd-orders-notice is-warning" role="status">{t(readError)}</p>:null}
   {pendingAction&&!bill&&!cancelTarget?<p className="rd-orders-notice" role="status">{t(pendingAction==='complete'?'Recording pickup…':pendingAction==='payment'?'Recording payment…':'Saving…')}</p>:null}
   {notice?<p className="rd-orders-notice" role="status">{t(notice)}</p>:null}{deliveryNotice?<p className="rd-orders-notice is-warning" role="status">{t(deliveryNotice)} {order.conversation_id&&<button onClick={openChat}>{t("Open chat")}</button>}</p>:null}
   {stale?<div className="rd-orders-notice is-warning" role="alert">{t("This order changed while you were editing. Your edits are still here.")}{' '}<button onClick={()=>{setEditor(makeEditor(order,amendment));setError('');}}>{t("Load latest order")}</button><small>{t("Loading the latest order replaces your unsaved edits.")}</small></div>:null}
   {amendment&&order.stage!=='cancelled'&&order.stage!=='completed'?<div className="rd-orders-notice is-warning"><strong>{pendingBlocked?t("Customer change awaiting confirmation"):t("Customer confirmed a change")}</strong><p>{amendment.summary}</p><small>{pendingBlocked?t("Open chat to resolve the customer change before continuing."):t("Review the updated items below. Saving applies this change to the order.")}</small>{pendingBlocked?<button onClick={openChat}>{t("Open chat")}</button>:null}</div>:null}
   <OrderItems lines={current.lines} removed={current.removed}
    disabled={busy||stale||pendingBlocked} readOnly={closed} warning={closed?undefined:warning}
    onAdd={()=>pick()} onPick={pick} onUpdate={update} onRemove={removeItem} onUndo={undoRemove}/>
   {(order.advance_required||order.advance_state)?<div className="rd-orders-payment"><span className="rd-orders-payment-icon" aria-hidden="true">₹</span><div><strong>{order.advance_state==='refund_pending'?t("₹10 advance · Refund check needed"):order.advance_state==='verified'?t("₹10 advance received"):order.advance_state==='claimed'?t("Customer says ₹10 paid"):'₹10 advance'}</strong><p>{order.advance_state==='refund_pending'?t("This advance needs a separate refund check. Cancelling does not record a refund."):order.advance_state==='verified'?t("Checked by shop. The remaining bill is settled separately."):['requested','claimed','pay_at_shop'].includes(order.advance_state??'')?t("Check your bank or UPI app before marking received."):(order.advance_state??'Payment not recorded').replaceAll('_',' ')}</p></div>{['requested','claimed','pay_at_shop'].includes(order.advance_state??'')?<button className="rd-orders-quiet" disabled={busy} onClick={()=>void run('payment')}>{t("Mark received")}</button>:null}</div>:null}
   <OrdersTotalPanel order={order} current={current} busy={busy} stale={stale} pendingBlocked={pendingBlocked}
    pendingAmendment={!!amendment} onRun={run} onPreview={showPreview} onView={setBill}
    onSend={()=>{
     if(order.source==='in_store'){setDialogError('');setBill('recipient');}
     else void sendFinalBill();
    }}
    onCancel={()=>setCancelTarget({id:order.id,revision:current.revision})}/>
  </>:confirmed&&confirmed.id===selectedId&&confirmed.stage===stage?<div className="rd-orders-empty" role="status"><h2>{t(confirmed.name)}</h2><p>{t("Order #")}{code(confirmed.id)} · {t(stageLabel(confirmed.stage))}</p><p>{t(notice)}</p>{readError&&<button onClick={()=>setRefresh(n=>n+1)}>{t("Try again")}</button>}</div>:loadingDetail?<OwnerLoading label={t("Loading order…")} variant="rows"/>
   :!listSnapshot?null:readError?<div className="rd-orders-empty" role="alert">{t(readError)}<button onClick={()=>setRefresh(n=>n+1)}>{t("Try again")}</button></div>
   :<div className="rd-orders-empty"><h2>{selectedId?t("Order unavailable"):t("Choose an order")}</h2><p>{selectedId?t("Return to the list or try refreshing."):t("Review items and arrange pickup here.")}</p></div>}</section>
  <dialog className="rd-orders-dialog" ref={dialog} onCancel={event=>{event.preventDefault();closeDialog();}} aria-labelledby="rd-orders-dialog-title">
   <div className="rd-orders-dialog-head">
    <h2 id="rd-orders-dialog-title">{t(cancelTarget?'Cancel uncollected order?':picker?pickerIsNew?'Add item':'Replace item':bill==='counter'?'New in-store order':bill==='history'?'Bill history':bill==='original'?'Original estimate':bill==='recipient'?'Send on WhatsApp':bill==='revise'?'Revised bill':bill==='update_ready'?'Updated pickup bill':'Pickup bill')}</h2>
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
   :bill==='original'&&order?<div className="rd-orders-bill">
    {originalLines.map((line,index)=>{
     const estimate=originalEstimate?.lines.find(item=>item.id===line.id);
     return <div key={line.id}><span>{index+1}. {line.name}<br/><small>{originalWords(line)}</small></span>
      <strong>{estimate?.totalPaise===undefined?t('Price pending'):
       (estimate.approximate?'≈ ':'')+formatMoney(estimate.totalPaise)}</strong></div>;
    })}
    {!!originalEstimate?.lines.some(line=>line.totalPaise!==undefined)&&<div>
     <span>{t(originalEstimate.unpriced?'Known subtotal':'Total')}</span>
     <strong>{originalEstimate.approximate?'≈ ':''}{formatMoney(originalEstimate.subtotalPaise)}</strong>
    </div>}
   </div>
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
function OrdersTotalPanel({order,current,busy,stale,pendingBlocked,pendingAmendment,onRun,onPreview,onView,onSend,onCancel}:{
 order:Order;current:Editor;busy:boolean;stale:boolean;pendingBlocked:boolean;pendingAmendment:boolean;
 onRun:(action:OrderAction)=>Promise<void>;onPreview:(action:'ready'|'revise'|'update_ready')=>void;
 onView:(view:DialogView)=>void;onSend:()=>void;onCancel:()=>void;
}){
 const {t}=useOwnerLocale();
 const isNew=order.stage==='new',ready=order.stage==='ready',completed=order.stage==='completed';
 const inStore=order.source==='in_store',unsaved=current.dirty||!!current.amendmentId;
 const locked=busy||stale||pendingBlocked;
 const delivery=order.bill_delivery;
 const canSend=(ready||completed)&&!['queued','accepted','delivered','unknown'].includes(delivery??'');
 const windowClosed=canSend&&order.bill_reply_window_closed;
 const menuLabel=t(completed?'Invoice actions':'Bill actions');
 const menu:OrderMenuAction[]=[];
 if(isNew&&!inStore)menu.push({label:t('Send revised bill'),icon:<OwnerIcon name="messages"/>,disabled:locked,onSelect:()=>onPreview('revise')});
 if(order.has_final_bill)menu.push(
  {label:t(completed?'Download invoice':'Download bill'),icon:<OwnerIcon name="download"/>,href:billUrl(order.id,'download',current.revision),download:true},
  {label:t(completed?'Print invoice':'Print bill'),icon:<OwnerIcon name="print"/>,href:billUrl(order.id,'print',current.revision),newTab:true},
  {label:t('Bill history'),icon:<OwnerIcon name="history"/>,onSelect:()=>onView('history')},
 );
 if(!inStore&&(order.original_lines??order.lines).length)menu.push({label:t('View original estimate'),icon:<OwnerIcon name="preview"/>,onSelect:()=>onView('original')});

 const next=isNew?{
  label:inStore?'Mark ready':'Mark ready & send bill',onClick:()=>onPreview('ready'),disabled:locked,
 }:ready&&unsaved?{
  label:inStore?'Save updated bill':'Save & send updated bill',onClick:()=>onPreview('update_ready'),disabled:locked,
 }:ready?{
  label:inStore?'Picked up · Close order':'Picked up · Send invoice',onClick:()=>void onRun('complete'),disabled:locked||pendingAmendment,
 }:null;

 return <footer className="rd-orders-footer">
  <section className="rd-orders-summary" aria-label={t('Order total and bills')}>
   <div className="rd-orders-total"><span>{t('Total')}</span><strong aria-live="polite">
    {isNew||ready?validation(current.lines)?t('Check items'):formatMoney(total(current.lines)):formatMoney(Number(order.total_paise))}
   </strong></div>
   {unsaved&&ready&&<p className="rd-orders-summary-note">{t('Save the item changes before recording pickup.')}</p>}
   {completed&&<p className="rd-orders-summary-note">{t('Pickup recorded. This order is completed.')}</p>}
   {order.stage==='cancelled'&&<p className="rd-orders-summary-note">{t('This order is cancelled.')}</p>}
   {(canSend||menu.length>0||delivery||isNew&&unsaved)&&<div className="rd-orders-share">
    {canSend&&<button type="button" className="rd-orders-quiet rd-orders-whatsapp" disabled={locked||unsaved||pendingAmendment||windowClosed} onClick={onSend}>
     <OwnerIcon name="messages"/>{t(completed?'Send invoice':inStore?'Send on WhatsApp':'Send pickup bill')}
    </button>}
    {menu.length>0&&<OrderActionMenu label={menuLabel} preferAbove
     trigger={<><OwnerIcon name="orders"/>{menuLabel}<OwnerIcon name="chevron"/></>} actions={menu}/>}
    {isNew&&unsaved&&<button type="button" className="rd-orders-quiet" disabled={locked} onClick={()=>void onRun('save')}>{t('Save changes')}</button>}
    {(windowClosed||delivery)&&<span className={'rd-orders-delivery '+(windowClosed||delivery==='failed'||delivery==='unknown'?'is-warning':'')} role="status">
     {t(windowClosed?'The 24-hour WhatsApp reply window is closed.':billStatus[delivery??'']??'')}
    </span>}
   </div>}
  </section>
  {next&&<div className="rd-orders-workflow">
   {ready&&<button type="button" className="rd-orders-quiet rd-orders-cancel-option" disabled={busy||stale||unsaved}
    onClick={onCancel}>{t('Cancel order')}</button>}
   <button className="rd-orders-primary" disabled={next.disabled} onClick={next.onClick}>
    {ready&&!unsaved&&<OwnerIcon name="check"/>}{t(next.label)}
   </button>
  </div>}
 </footer>;
}

function OrderItems({lines,removed,warning,readOnly=false,disabled,onAdd,onPick,onUpdate,onRemove,onUndo}:{
 lines:EditLine[];removed:{line:EditLine;index:number}[];warning?:(line:EditLine)=>string[];
 readOnly?:boolean;disabled:boolean;onAdd:()=>void;onPick:(id:string)=>void;onUpdate:(id:string,patch:Partial<EditLine>)=>void;
 onRemove:(id:string)=>void;onUndo:(id:string)=>void;
}){
 const {t}=useOwnerLocale(),openPhoto=useOwnerPhoto(),heading=useId();
 const undoFocus=useRef<string|undefined>(undefined),itemFocus=useRef<string|undefined>(undefined);
 return <section className="rd-orders-items" aria-labelledby={heading}>
  <div className="rd-orders-items-head"><h3 id={heading}>{t('Items')} <span>({lines.length})</span></h3>
   {!readOnly&&<button type="button" className="rd-orders-quiet" disabled={disabled||lines.length>=50} onClick={onAdd}>
    <OwnerIcon name="plus"/>{t('Add item')}</button>}
  </div>
  {!lines.length?<p className="rd-orders-empty-items">{t('Add at least one item to the order.')}</p>:<div className="rd-orders-table-frame">
   <table className="rd-orders-table" aria-labelledby={heading}>
    <colgroup><col/><col className="rd-order-qty-col"/><col className="rd-order-price-col"/><col className="rd-order-amount-col"/>
     {!readOnly&&<col className="rd-order-menu-col"/>}</colgroup>
    <thead><tr><th scope="col">{t('Item')}</th><th scope="col">{t('Qty')}</th>
     <th scope="col">{t('Price each (₹)')}</th><th scope="col" className="rd-order-amount">{t('Amount')}</th>
     {!readOnly&&<th scope="col" aria-label={t('Item actions')}/>}</tr></thead>
    <tbody>{lines.map(line=>{
     const issues=warning?.(line);
     const less=quantityAfterStep(line,-1),more=quantityAfterStep(line,1);
     const amount=Number(line.quantity)>0&&Number(line.quantity)<=100&&line.price!==''&&Number(line.price)>=0&&Number(line.price)<=1000000
      ?formatMoney(lineAmount(line)):'—';
     return <tr key={line.id}>
      <td className="rd-order-product-cell"><div className="rd-orders-item-identity">
       {line.sku&&line.photo?<button type="button" className="rd-photo-trigger rd-orders-thumb" aria-label={t('View photo')+' '+line.name}
        onClick={()=>openPhoto({src:'/api/owner/products/'+encodeURIComponent(line.sku!)+'/image'+(line.productVersion?'?v='+line.productVersion:''),name:line.name})}>
        <Thumb line={line}/></button>:<span className="rd-orders-thumb"><Thumb line={line}/></span>}
       <div className="rd-orders-item-name">
        {readOnly?<strong>{line.name}</strong>:<button type="button" className="rd-orders-product-button"
         ref={node=>{if(node&&itemFocus.current===line.id){node.focus();itemFocus.current=undefined;}}}
         aria-label={t('Replace item')+' '+line.name} disabled={disabled} onClick={()=>onPick(line.id)}>
         {line.name||t('Choose item')}<OwnerIcon name="chevron"/>
        </button>}
        {issues?.map(issue=><small className="rd-orders-warning" key={issue}>{t(issue)}</small>)}
       </div>
      </div></td>
      <td className="rd-order-qty"><span className="rd-orders-mobile-label">{t('Qty')}</span>
       {readOnly?<strong>{line.quantity}</strong>:<div className="rd-orders-quantity">
        <button type="button" disabled={disabled||less===undefined} aria-label={t('Decrease quantity')+' '+line.name}
         onClick={()=>{if(less!==undefined)onUpdate(line.id,{quantity:less});}}>−</button>
        <input aria-label={t('Quantity')+' '+line.name} type="number" min={line.step??0.001} max="100"
         step={line.step??'any'} inputMode="decimal" disabled={disabled} value={line.quantity}
         onChange={event=>onUpdate(line.id,{quantity:event.target.value})}/>
        <button type="button" disabled={disabled||more===undefined} aria-label={t('Increase quantity')+' '+line.name}
         onClick={()=>{if(more!==undefined)onUpdate(line.id,{quantity:more});}}>+</button>
       </div>}
       {line.unit&&<small className="rd-orders-unit">{line.unit}</small>}
      </td>
      <td className="rd-order-price"><span className="rd-orders-mobile-label">{t('Price each (₹)')}</span>
       {readOnly?<strong>{line.price===''?'—':formatMoney(Math.round(Number(line.price)*100))}</strong>
        :<input aria-label={t('Price each (₹)')+' '+line.name} className="rd-orders-rate" type="number" min="0" step=".01"
         inputMode="decimal" disabled={disabled} value={line.price} placeholder={t('Enter price')}
         onChange={event=>onUpdate(line.id,{price:event.target.value,manualConfirmed:true,free:false})}/>}
       {!readOnly&&line.price!==''&&Number(line.price)===0&&<label className="rd-orders-free">
        <input aria-label={t('Free item')+' '+line.name} type="checkbox" checked={line.free} disabled={disabled}
         onChange={event=>onUpdate(line.id,{free:event.target.checked,manualConfirmed:true})}/>{t('Free item')}</label>}
      </td>
      <td className="rd-order-amount"><span className="rd-orders-mobile-label">{t('Amount')}</span><strong>{amount}</strong></td>
      {!readOnly&&<td className="rd-order-row-menu"><OrderActionMenu label={t('Item actions')+' '+line.name} iconOnly disabled={disabled}
       trigger={<OwnerIcon name="more"/>} actions={[{label:t('Remove item'),icon:<OwnerIcon name="remove"/>,danger:true,
        onSelect:()=>{undoFocus.current=line.id;onRemove(line.id);}}]}/></td>}
     </tr>;
    })}</tbody>
   </table>
  </div>}
  {!readOnly&&removed.map(({line})=><div className="rd-orders-removed" key={line.id}>
   <span>{line.name} · {t('Removed')}</span>
   <button type="button" className="rd-orders-quiet" disabled={disabled||lines.length>=50}
    ref={node=>{if(node&&undoFocus.current===line.id){node.focus();undoFocus.current=undefined;}}}
    onClick={()=>{itemFocus.current=line.id;onUndo(line.id);}}>{t('Undo')}</button>
  </div>)}
 </section>;
}

function ItemPicker({line,original,onUse}:{line:EditLine;original?:DraftLine;onUse:(patch:Partial<EditLine>)=>void}){
 const {t}=useOwnerLocale();
 const [query,setQuery]=useState(''),[products,setProducts]=useState<Product[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState<Product|null|undefined>(),[draft,setDraft]=useState<EditLine>(line);
 useEffect(()=>{const controller=new AbortController(),timer=setTimeout(async()=>{setLoading(true);try{const data=await redesignApi<{products:Product[]}>('catalog?'+new URLSearchParams({q:query,visibility:'visible',limit:'30'}),undefined,controller.signal);if(!controller.signal.aborted){setProducts(data.products);setError('');}}catch(e){if(!controller.signal.aborted)setError((e as Error).message);}finally{if(!controller.signal.aborted)setLoading(false);}},200);return()=>{controller.abort();clearTimeout(timer);};},[query]);
 function choose(p:Product|null){setSelected(p);setError('');setDraft(p?{...line,sku:p.sku,name:p.name,unit:p.unit,price:p.priceStatus==='confirm'?'':String(p.pricePaise/100),productVersion:p.version,photo:!!p.imageUrl,step:p.quantityStep,needsMatch:false,saleMode:p.sellingPolicy?.saleMode,free:p.priceStatus==='free',manualConfirmed:false}:{...line,sku:undefined,productVersion:undefined,photo:false,step:undefined,needsMatch:false,saleMode:undefined,manualConfirmed:true});}
 function submit(){const invalid=validation([{...draft,manualConfirmed:true}]);if(invalid){setError(invalid);return;}onUse({...draft,manualConfirmed:true});}
 return <div className="rd-orders-picker">{line.name&&<p className="rd-orders-picker-current">{t('Current item')} <strong>{line.name}</strong></p>}{original&&<div className="rd-orders-request"><small>{t("Customer asked for")}</small><p>{originalWords(original)}</p></div>}{selected===undefined?<><label className="rd-orders-picker-search">{t("Find a product · English or Tamil")}<input autoFocus type="search" placeholder={t("Search name, brand or size")} value={query} onChange={e=>setQuery(e.target.value)}/></label>{error?<p role="alert" className="rd-orders-warning">{t(error)}</p>:null}<div className="rd-orders-results" aria-busy={loading}>{loading?<p role="status">{t("Searching products…")}</p>:products.length?products.map(p=><button key={p.sku} onClick={()=>choose(p)}><span className="rd-orders-thumb"><Thumb line={{...line,sku:p.sku,name:p.name,photo:!!p.imageUrl,productVersion:p.version}}/></span><span><strong>{p.name}</strong><small>{p.priceStatus==='confirm'?t("Enter actual price"):formatMoney(p.pricePaise)} / {p.unit}</small><small>{p.stock===null?t("Recorded stock unknown"):p.stock<=0?t("Recorded stock: 0 · Check in store"):`Recorded stock: ${p.stock}`}</small></span><b aria-hidden="true">›</b></button>):<p>{t("No matching product. You can still use an item from your store.")}</p>}</div><div className="rd-orders-store"><span>{t("Have it in store, but not listed?")}</span><button onClick={()=>choose(null)}>{t("Use store item")}</button></div></>:<><h3>{selected?t("Use this product"):t("Use store item")}</h3><label className="rd-orders-field">{t("Item name")}<input autoFocus value={draft.name} readOnly={!!selected} onChange={e=>setDraft(d=>({...d,name:e.target.value}))} maxLength={200}/></label><div className="rd-orders-picker-grid"><label className="rd-orders-field">{t("Quantity")}<input type="number" min="0.001" max="100" step={draft.step??'any'} value={draft.quantity} onChange={e=>setDraft(d=>({...d,quantity:e.target.value}))}/></label><label className="rd-orders-field">{t("Selling unit")}{selected?<input readOnly value={draft.unit}/>:<select value={draft.unit} onChange={e=>setDraft(d=>({...d,unit:e.target.value}))}><option value="">{t("Choose unit")}</option>{[...new Set([...SELLING_UNITS,...(draft.unit?[draft.unit]:[])])].map(unit=><option key={unit}>{unit}</option>)}</select>}</label><label className="rd-orders-field">{t("Price each (₹)")}<input type="number" min="0" step="0.01" value={draft.price} onChange={e=>setDraft(d=>({...d,price:e.target.value,free:false}))}/></label></div>{draft.price!==''&&Number(draft.price)===0?<label className="rd-orders-free"><input type="checkbox" checked={draft.free} onChange={e=>setDraft(d=>({...d,free:e.target.checked}))}/>{' '}{t("This item is free")}</label>:null}{selected?.stock===0?<p className="rd-orders-notice is-warning">{t("Recorded stock is 0. You can use this item if you have it in store.")}</p>:null}{!selected?<p>{t("Added to this order only. Your product list stays the same.")}</p>:null}{error?<p role="alert" className="rd-orders-warning">{t(error)}</p>:null}<div className="rd-orders-picker-actions"><button onClick={()=>setSelected(undefined)}>{t("Back to search")}</button><button className="rd-orders-primary" onClick={submit}>{t("Use this item")}</button></div></>}</div>;
}
