import {Component,lazy,Suspense,useCallback,useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {OwnerLocaleProvider,useOwnerLocale} from './owner-locale.js';
import {OwnerIcon} from './OwnerIcon.js';
import {navigateOwner,OwnerLink,OwnerLoading,useOwnerUrl} from './owner-ui.js';
import {visiblePoll} from './owner-polling.js';
import {prepareOwnerRead,redesignApi} from './redesign-api.js';
import {chatHistoryRead,inboxRead,orderReads,productListRead} from './owner-view-reads.js';
import './redesign.css';
import './compact-workspace.css';
import {useMobileWorkspace} from './mobile-workspace.js';
import {cancelCatalogEntry} from './owner-startup.js';
import {OwnerPhotoProvider} from './OwnerPhotoViewer.js';
const loadOrders=()=>import('./RedesignOrders.js');
const Orders=lazy(()=>loadOrders().then(m=>({default:m.RedesignOrders})));
const loadProducts=()=>import('./RedesignProducts.js');
const Products=lazy(()=>loadProducts().then(m=>({default:m.RedesignProducts})));
const loadChats=()=>import('./RedesignChats.js');
const Chats=lazy(()=>loadChats().then(m=>({default:m.RedesignChats})));
const loadSettings=()=>import('./RedesignSettings.js');
const Settings=lazy(()=>loadSettings().then(m=>({default:m.RedesignSettings})));
const ProductImport=lazy(()=>import('./ProductImport.js').then(m=>({default:m.ProductImport})));
const AdvancedCatalog=lazy(()=>import('./OwnerCatalog.js').then(m=>({default:m.OwnerCatalog})));
class ViewBoundary extends Component<{fallback: ReactNode; children: ReactNode}, {failed: boolean}> {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?this.props.fallback:this.props.children;}
}
export function RedesignDashboard(){return <OwnerLocaleProvider><OwnerPhotoProvider><Workspace/></OwnerPhotoProvider></OwnerLocaleProvider>;}
const preloadView=(view:string)=>{void (view==='requests'?loadOrders():view==='conversations'?loadChats():view==='catalog'?loadProducts():loadSettings()).catch(()=>{});};
const tabs=[{view:'requests',label:'Orders',icon:'orders'},{view:'conversations',label:'Chats',icon:'messages'},{view:'catalog',label:'Products',icon:'products'}] as const;
function Workspace(){
 const {locale,setLocale,t}=useOwnerLocale(),params=useOwnerUrl();
 const raw=params.get('view'),view=raw==='conversations'||raw==='catalog'||raw==='connections'?raw:raw==='message-review'?'connections':'requests';
 const workspace=useRef<HTMLDivElement>(null);
 const [snapshot,setSnapshot]=useState<any>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
 const advanced=view==='catalog'&&(params.get('bulk')==='1'||params.get('visibility')==='draft'||params.get('advanced')==='1'||params.get('drafts')==='1'||!!params.get('draft'));
 const importing=params.get('import')==='1';
 const firstView=useRef(true);
 const viewLabel=t(tabs.find(tab=>tab.view===view)?.label??'Settings');
 useLayoutEffect(()=>{
  const isFirstView=firstView.current;
  firstView.current=false;
  if(isFirstView&&view==='catalog'&&!advanced&&!importing)return cancelCatalogEntry;
  if(view==='connections'){preloadView(view);return;}
  if(document.hidden||navigator.onLine===false||view==='catalog'&&(advanced||importing))return;
  const controller=new AbortController();
  const current=new URLSearchParams(window.location.search);
  const path=view==='requests'?orderReads(current).readPath:view==='conversations'?inboxRead(current):productListRead();
  prepareOwnerRead(path,controller.signal);
  const conversation=current.get('conversation');
  if(view==='conversations'&&conversation)prepareOwnerRead(chatHistoryRead(conversation),controller.signal);
  return()=>controller.abort();
 },[view,advanced,importing]);
 async function refresh(signal?:AbortSignal){const next=await redesignApi(view==='connections'?'snapshot?details=1&scope=settings':'summary',undefined,signal);if(!signal?.aborted){setSnapshot(next);setError('');}}
 useEffect(()=>{const stop=visiblePoll(async signal=>{try{await refresh(signal);}catch(e){if(!signal.aborted)setError(e instanceof Error?e.message:'Could not load shop details.');throw e;}},{intervalMs:15000});return stop;},[attempt,view==='connections']);
 useEffect(()=>{const changed=()=>setAttempt(value=>value+1);window.addEventListener('owner-attention-changed',changed);return()=>window.removeEventListener('owner-attention-changed',changed);},[]);
 useEffect(()=>{document.title=t(tabs.find(x=>x.view===view)?.label??'Settings');},[view,locale,t]);
 async function act(path:string,body:unknown,success:string){if(busy)return;setBusy(true);setError('');setNotice('');try{await redesignApi(path,body);setNotice(success);void refresh().catch(e=>setError(e instanceof Error?e.message:'Saved, but shop details could not be refreshed.'));}catch(e){setError(e instanceof Error?e.message:'Could not save. Please try again.');}finally{setBusy(false);}}
 async function signOut(){if(busy)return;setBusy(true);try{await redesignApi('logout',{});window.location.replace('/login');}catch(e){setError(e instanceof Error?e.message:'Could not sign out. Please try again.');setBusy(false);}}
 const newRoute=(next:string)=>({view:next,order:null,conversation:null,orderSearch:null,orderPage:null,inboxSearch:null,inboxPage:null,inboxHelp:null,import:null,bulk:null,visibility:null,advanced:null,drafts:null,draft:null,product:null});
 const swipe=useCallback((direction:1|-1)=>{const index=tabs.findIndex(tab=>tab.view===view),next=tabs[index+direction];if(index>=0&&next)navigateOwner(newRoute(next.view));},[view]);
 useMobileWorkspace(workspace,view+':'+locale+':'+(params.get('order')??'')+':'+(params.get('conversation')??''),swipe);
 const unreadOrders=Number(snapshot?.attention?.orders??0),unreadChats=Number(snapshot?.attention?.messages??0);
 const badge=(view:string)=>view==='requests'?unreadOrders:view==='conversations'?unreadChats:0;
 const contentReady=view!=='connections'||snapshot?.detailsIncluded===true;
 const shopName=snapshot?.store.name??t('Your shop');
 const brandMark=Array.from(shopName.trim().split(/\s+/,1)[0]??'').slice(0,2).join('').toLocaleUpperCase();
 return <div ref={workspace} className="redesign" data-compact data-view={view}><a className="rd-skip" href="#rd-main">{t('Skip to main content')}</a><aside className="rd-sidebar"><div className="rd-shop-name" title={shopName}><span className="rd-brand-mark" aria-hidden="true">{brandMark}</span><strong>{shopName}</strong></div><nav aria-label="Main navigation">{tabs.map(tab=><OwnerLink key={tab.view} values={newRoute(tab.view)} onPointerEnter={()=>preloadView(tab.view)} onFocus={()=>preloadView(tab.view)} onPointerDown={()=>preloadView(tab.view)} aria-current={view===tab.view?'page':undefined} aria-label={t(tab.label)} title={t(tab.label)}><OwnerIcon name={tab.icon}/><span className="rd-nav-label">{t(tab.label)}</span>{badge(tab.view)>0?<span className="rd-count rd-unread-count" aria-label={tab.view==='requests'?`${badge(tab.view)} unread orders`:`${badge(tab.view)} unread customer messages`}>{badge(tab.view)>99?'99+':badge(tab.view)}</span>:null}</OwnerLink>)}</nav><div className="rd-sidebar-bottom"><OwnerLink values={newRoute('connections')} aria-current={view==='connections'?'page':undefined} aria-label={t('Settings')} title={t('Settings')}><OwnerIcon name="settings"/><span className="rd-nav-label">{t('Settings')}</span></OwnerLink>{snapshot?.authMode==='demo_password'?<button className="rd-sidebar-signout" type="button" disabled={busy} onClick={()=>void signOut()} aria-label={t('Sign out')} title={t('Sign out')}><OwnerIcon name="signOut"/><span className="rd-nav-label">{t('Sign out')}</span></button>:null}<label className="rd-language"><OwnerIcon name="globe"/><select aria-label={t("Dashboard language")} value={locale} onChange={e=>setLocale(e.target.value as 'en'|'ta')}><option value="en">English</option><option value="ta">தமிழ்</option></select></label></div></aside><div className="rd-body"><main id="rd-main" aria-label={viewLabel} className={'rd-main'+(view==='requests'||view==='conversations'?' rd-main-workspace':'')}>
 {error?<div className="rd-global-message rd-error" role="alert">{error}<button type="button" onClick={()=>setAttempt(n=>n+1)}>{t('Try again')}</button></div>:null}
 {notice?<div className="rd-global-message" role="status">{notice}<button type="button" aria-label="Dismiss notification" onClick={()=>setNotice('')}>×</button></div>:null}
 {!contentReady&&!error?<OwnerLoading label={t('Loading shop records…')}/>:contentReady?<ViewBoundary key={view+String(advanced)+String(importing)} fallback={
 <div className="rd-global-message rd-error" role="alert">{t('This view could not load.')}
  <button type="button" onClick={()=>window.location.reload()}>{t('Reload dashboard')}</button>
 </div>
 }><Suspense fallback={<OwnerLoading label={t(view==='requests'?'Loading orders…':view==='conversations'?'Loading chats…':view==='catalog'?'Loading products…':'Loading shop records…')}/>}>{view==='requests'?<Orders/>:view==='conversations'?<Chats/>:view==='catalog'?params.get('import')==='1'?<div className="rd-catalog-task" data-workspace-detail="true"><ProductImport/></div>:advanced?<div className="rd-advanced rd-catalog-task owner-shell" data-workspace-detail="true"><button type="button" className="rd-control rd-return" onClick={()=>navigateOwner({import:null,bulk:null,visibility:null,advanced:null,drafts:null,draft:null,product:null})}><OwnerIcon name="back"/>{t("Products")}</button><AdvancedCatalog/></div>:<Products/>:<Settings snapshot={snapshot} busy={busy} onAct={act} onSignOut={signOut}/>}</Suspense></ViewBoundary>:null}
 </main></div><nav className="rd-mobile-nav" aria-label="Mobile navigation">{tabs.map(tab=><OwnerLink key={tab.view} values={newRoute(tab.view)} onPointerEnter={()=>preloadView(tab.view)} onFocus={()=>preloadView(tab.view)} onPointerDown={()=>preloadView(tab.view)} aria-current={view===tab.view?'page':undefined}><span><OwnerIcon name={tab.icon}/>{badge(tab.view)>0?<b className="rd-count rd-unread-count" aria-label={tab.view==='requests'?`${badge(tab.view)} unread orders`:`${badge(tab.view)} unread customer messages`}>{badge(tab.view)>99?'99+':badge(tab.view)}</b>:null}</span><span className="rd-nav-label">{t(tab.label)}</span></OwnerLink>)}</nav></div>;
}
