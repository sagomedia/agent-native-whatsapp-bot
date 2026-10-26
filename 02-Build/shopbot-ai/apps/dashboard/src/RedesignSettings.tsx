import {rupeeEstimate} from './owner-model.js';
import {RupeeConversion,useRupeeRate} from './RupeeConversion.js';
import {useEffect,useState} from 'react';
import type {RichReply} from '../../../packages/contracts/index.js';
import {useOwnerLocale} from './owner-locale.js';
import {VisualReplyView} from './VisualReplyView.js';
import {redesignApi} from './redesign-api.js';
import './redesign-settings.css';

type Snapshot={
  authMode?:string;
  store:{name:string;synthetic:string;operator_paused:boolean;operator_revision:number};
  channel:{whatsapp:string;liveSending:boolean;processing:boolean;lastReceivedAt:string|null;error:string|null;testOnly:boolean};
  ownerEmail:string;mode:string;
  budget:{limit_microusd:string;committed_microusd:string;held_microusd:string;blocked:boolean}|null;
  usage:{attempts:number;failures:number;unknown:number;estimated_microusd:string}|null;
  messaging?:{totals:{currency:string|null;delivered:number;unknown:number;conflicting:number;estimated_microunits:string|null}[];month:string|null}|null;
  inference?:{enabled:boolean;paidEnabled:boolean;rateHealth?:{status:string;validUntil:string|null}};
};
type Panel='shop'|'language'|'preview'|'connection'|'manage'|'usage'|'help'|'technical'|null;
type Entry={id:string;label:string;group:string;note:string;reply:RichReply};
type Props={snapshot:Snapshot;busy?:boolean;onSignOut?:()=>Promise<void>;onAct?:(path:string,body:unknown,success:string)=>Promise<void>};
const previewTypes=[{id:'welcome',label:'Greeting'},{id:'compare',label:'Products'},{id:'compact-cart',label:'Cart'},{id:'ready',label:'Pickup'}] as const;
const inventoryMcpUrl='https://demo.sagoautomation.tech/mcp';
const title:Record<Exclude<Panel,null>,string>={shop:'Shop details',language:'Language',preview:'Preview replies',connection:'WhatsApp connection',manage:'Manage connection',usage:'Usage and billing',help:'Help',technical:'Technical details'};
function Icon({kind}:{kind:string}){const path:Record<string,string>={shop:'M3 10h18M5 10V21h14V10M4 10l2-7h12l2 7M9 21v-7h6v7',language:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M2 12h20M12 2c-3 3-4 6-4 10s1 7 4 10M12 2c3 3 4 6 4 10s-1 7-4 10',replies:'M3 4h18v13H9l-6 4z',preview:'M5 3h11l4 4v14H5zM16 3v5h4M8 12h9M8 16h7',connection:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M7 8c1 6 4 9 9 9',manage:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',usage:'M4 20v-5h4v5M10 20V9h4v11M16 20V4h4v16',help:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5M12 18h.01',technical:'m8 8-4 4 4 4m8-8 4 4-4 4m-3-13-2 18'};return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path[kind]??path.shop}/></svg>}
function Row({icon,label,description,trailing,onClick}:{icon:string;label:string;description?:string;trailing?:string;onClick:()=>void}){const {t}=useOwnerLocale();return <button type="button" className="rd-settings-row" onClick={onClick}><span className="rd-settings-row-icon"><Icon kind={icon}/></span><span className="rd-settings-row-copy"><strong>{t(label)}</strong>{description&&<small>{t(description)}</small>}</span>{trailing&&<span className="rd-settings-trailing">{t(trailing)}</span>}<span className="rd-settings-chevron" aria-hidden="true">›</span></button>}

export function RedesignSettings({snapshot,busy=false,onAct,onSignOut}:Props){
  const [conversionRate,setConversionRate]=useRupeeRate();
  const money=(micros:string|undefined)=>rupeeEstimate(micros??null,'USD',conversionRate);
  const {locale,setLocale,t}=useOwnerLocale();
  const [panel,setPanel]=useState<Panel>(null);
  const [chatgptCopy,setChatgptCopy]=useState<'idle'|'copying'|'failed'>('idle');
  async function openChatgpt(){
    if(chatgptCopy==='copying')return;
    setChatgptCopy('copying');
    try{
      await navigator.clipboard.writeText(inventoryMcpUrl);
    }catch{
      setChatgptCopy('failed');
      return;
    }
    setChatgptCopy('idle');
    window.location.assign('https://chatgpt.com/');
  }
  const [previewLanguage,setPreviewLanguage]=useState('en');
  const [previewKind,setPreviewKind]=useState<string>('compare');
  const [entries,setEntries]=useState<Entry[]>([]);
  const [previewLoading,setPreviewLoading]=useState(false);
  const [previewError,setPreviewError]=useState('');
  const [previewRetry,setPreviewRetry]=useState(0);
  const [shopName,setShopName]=useState(snapshot.store.name);
  useEffect(()=>setShopName(snapshot.store.name),[snapshot.store.name]);
  const paused=snapshot.store.operator_paused;
  const connected=['receiving','webhook_verified'].includes(snapshot.channel.whatsapp)&&!snapshot.channel.error;
  useEffect(()=>{if(panel!=='preview')return;const controller=new AbortController();setPreviewLoading(true);setPreviewError('');redesignApi<{entries:Entry[]}>(`message-gallery?language=${encodeURIComponent(previewLanguage)}`,undefined,controller.signal).then(data=>{if(!controller.signal.aborted)setEntries(data.entries??[]);}).catch(error=>{if(!controller.signal.aborted)setPreviewError(error instanceof Error?error.message:'Could not load replies.');}).finally(()=>{if(!controller.signal.aborted)setPreviewLoading(false);});return()=>controller.abort();},[panel,previewLanguage,previewRetry]);
  const chosen=entries.find(entry=>entry.id===previewKind);
  const toggle=()=>{if(!onAct||busy)return;void onAct('pause',{paused:!paused,revision:snapshot.store.operator_revision},paused?'Automatic replies are on.':'Automatic replies are off.');};
  return <section className="rd-settings" aria-label={t('Settings')}>
    {panel&&<button type="button" className="rd-settings-back" onClick={()=>setPanel(null)}><span aria-hidden="true">←</span>{t('Settings')}</button>}
    <div className="rd-settings-title-row"><h1>{t(panel?title[panel]:'Settings')}</h1>{snapshot.authMode==='demo_password'&&onSignOut?<button type="button" className="rd-demo-signout" disabled={busy} onClick={()=>void onSignOut()}>{t('Sign out')}</button>:null}</div>
    {!panel&&<div className="rd-settings-main">
      <div className="rd-settings-shop"><div className="rd-settings-avatar" aria-hidden="true"><Icon kind="shop"/></div><div><strong>{snapshot.store.name}</strong><small>{t("Shop profile")}</small></div><button type="button" onClick={()=>setPanel('shop')}>{t("View shop")}</button></div>
      <div className="rd-settings-rows">
        <Row icon="shop" label="Shop details" description="Name and account details" onClick={()=>setPanel('shop')}/>
        <Row icon="language" label="Language" trailing={locale==='ta'?'தமிழ்':t("English")} onClick={()=>setPanel('language')}/>
        <div className="rd-settings-row rd-settings-switch-row"><span className="rd-settings-row-icon"><Icon kind="replies"/></span><span className="rd-settings-row-copy"><strong>{t("Automatic replies")}</strong><small>{paused?t("Paused for all chats"):t("Let the bot answer customers")}</small></span><button type="button" role="switch" aria-label={t("Automatic replies")} aria-checked={!paused} className="rd-settings-switch" disabled={busy||!onAct} onClick={toggle}><span/></button></div>
        <Row icon="preview" label="Preview replies" description="See how your replies look to customers" onClick={()=>setPanel('preview')}/>
        <h2>{t("ChatGPT")}</h2>
        <button type="button" className="rd-settings-row rd-settings-inventory" aria-describedby="chatgpt-connect-help" disabled={chatgptCopy==='copying'} onClick={()=>{void openChatgpt();}}><span className="rd-settings-row-icon"><Icon kind="manage"/></span><span className="rd-settings-row-copy"><strong>{t('Inventory in ChatGPT')}</strong><small id="chatgpt-connect-help">{t(chatgptCopy==='copying'?'Copying link…':'Copy link and open ChatGPT')}</small></span><span aria-hidden="true">↗</span></button>
        {chatgptCopy==='failed'&&<div className="rd-settings-detail"><p role="alert">{t('Automatic copying was blocked. Copy the link below, then open ChatGPT.')}</p><label className="rd-settings-field">{t('Inventory connection link')}<input readOnly value={inventoryMcpUrl} onFocus={event=>event.currentTarget.select()}/></label><a href="https://chatgpt.com/">{t('Open ChatGPT')}</a></div>}
        <h2>{t("WhatsApp")}</h2>
        <Row icon="connection" label="WhatsApp connection" description={connected?t("Connection is active"):snapshot.channel.error?t("Connection needs attention"):t("Connection is not active")} onClick={()=>setPanel('connection')}/>
        <Row icon="manage" label="Manage connection" description="Connection details" onClick={()=>setPanel('manage')}/>
        <Row icon="usage" label="Usage and billing" description="View recorded usage" onClick={()=>setPanel('usage')}/>
        <Row icon="help" label="Help" description="Find answers" onClick={()=>setPanel('help')}/>
        <Row icon="technical" label="Technical details" description="For advanced users" onClick={()=>setPanel('technical')}/>
      </div>
    </div>}
    {panel==='shop'&&<div className="rd-settings-detail"><form className="rd-settings-shop-form" onSubmit={event=>{event.preventDefault();const name=shopName.trim();if(name.length>=2&&name!==snapshot.store.name&&onAct)void onAct('store/details',{name,expectedName:snapshot.store.name},'Shop name updated.');}}><label className="rd-settings-field">{t("Shop name")}<input value={shopName} onChange={event=>setShopName(event.target.value)} minLength={2} maxLength={120} required/></label><button type="submit" disabled={busy||!onAct||shopName.trim().length<2||shopName.trim()===snapshot.store.name}>{t("Save shop name")}</button></form><div className="rd-settings-facts"><div><span>{t("Account")}</span><strong>{snapshot.ownerEmail}</strong></div></div><p className="rd-settings-hint">{t("Address and contact editing are not available in this dashboard yet.")}</p></div>}
    {panel==='language'&&<div className="rd-settings-detail"><label className="rd-settings-field">{t("Dashboard language")}<select value={locale} onChange={event=>setLocale(event.target.value as 'en'|'ta')}><option value="en">{t("English")}</option><option value="ta">தமிழ்</option></select></label><p className="rd-settings-hint">{t("This setting changes the owner dashboard language on this device.")}</p></div>}
    {panel==='preview'&&<div className="rd-settings-preview"><p className="rd-settings-preview-disclaimer">{t("Preview only · Nothing is sent")}</p><div className="rd-settings-preview-grid"><div className="rd-settings-preview-controls"><label className="rd-settings-field">{t("Language")}<select value={previewLanguage} onChange={event=>setPreviewLanguage(event.target.value)}><option value="en">{t("English")}</option><option value="ta">தமிழ்</option><option value="ta-Latn">{t("Tanglish")}</option></select></label><span className="rd-settings-show">{t("Show")}</span><div className="rd-settings-preview-tabs" role="group" aria-label={t("Reply example")}>{previewTypes.map(item=><button type="button" key={item.id} aria-pressed={previewKind===item.id} onClick={()=>setPreviewKind(item.id)}><Icon kind={item.id==='welcome'?'replies':item.id==='compare'?'shop':item.id==='compact-cart'?'usage':'connection'}/>{item.label}</button>)}</div></div><div className="rd-settings-preview-card"><header><span className="rd-settings-avatar"><Icon kind="shop"/></span><strong>{snapshot.store.name}</strong><span className="rd-settings-preview-pill">{t("Preview")}</span></header><div className="rd-settings-chat-surface">{previewLoading?<p role="status">{t("Loading replies…")}</p>:previewError?<p role="alert">{t(previewError)} <button type="button" onClick={()=>setPreviewRetry(n=>n+1)}>{t("Try again")}</button></p>:chosen?<><p className="rd-settings-sample-label">{chosen.label}</p><div className="rd-settings-reply"><VisualReplyView reply={chosen.reply} disabled showText productImage={sku=>'/api/owner/message-gallery/products/'+encodeURIComponent(sku)+'/image'} messageImage={url=>'/api/owner/message-images/'+url.split('/').at(-1)}/></div><p className="rd-settings-preview-footnote">{t("Buttons are shown for preview.")}</p></>:<p>{t("There is no sample for this reply yet.")}</p>}</div></div></div></div>}
    {panel==='connection'&&<div className="rd-settings-detail"><p className={'rd-settings-state'+(connected?'':' is-warning')}>{connected?t("Connected"):snapshot.channel.error?t("Connection needs attention"):t("Not connected")}</p>{snapshot.channel.error&&<p>{snapshot.channel.error.replaceAll('_',' ')}</p>}<div className="rd-settings-facts"><div><span>{t("Customer messages")}</span><strong>{snapshot.channel.processing?t("Processing on"):t("Processing off")}</strong></div><div><span>{t("Replies")}</span><strong>{snapshot.channel.liveSending?t("Sending on"):t("Sending off")}</strong></div>{snapshot.channel.testOnly&&<div><span>{t("Recipients")}</span><strong>{t("Approved test numbers only")}</strong></div>}</div></div>}
    {panel==='manage'&&<div className="rd-settings-detail"><p>{t("Connection settings are managed by the platform. If the connection needs attention, contact the person who set up this shop.")}</p>{snapshot.channel.error&&<p className="rd-settings-state is-warning">{snapshot.channel.error.replaceAll('_',' ')}</p>}</div>}
    {panel==='usage'&&<div className="rd-settings-detail rd-settings-costs"><p>All recorded usage · rupee estimates</p><div className="rd-settings-facts"><div><span>Estimated AI usage</span><strong>{money(snapshot.usage?.estimated_microusd)}</strong></div>{snapshot.budget&&<><div><span>Application safety allowance</span><strong>{money(snapshot.budget.limit_microusd)}</strong></div><div><span>Available after reservations</span><strong>{money(String(Math.max(0,Number(snapshot.budget.limit_microusd)-Number(snapshot.budget.committed_microusd)-Number(snapshot.budget.held_microusd))))}</strong></div></>}<div><span>AI calls</span><strong>{snapshot.usage?.attempts??0}</strong></div>{snapshot.messaging?.totals.map(item=><div key={item.currency??'unknown'}><span>Known WhatsApp delivery estimate</span><strong>{rupeeEstimate(item.estimated_microunits,item.currency,conversionRate)}</strong></div>)}</div>{snapshot.budget?.blocked&&<p role="alert">The application safety allowance needs attention. Check usage before continuing.</p>}<p className="rd-settings-hint">Recorded usage is not your Google balance or its monthly spend cap. Unsettled reservations are not billed charges. Check provider invoices for final amounts.</p><details><summary>Detailed rupee estimates</summary><div className="rd-settings-facts"><div><span>Recorded AI usage</span><strong>{rupeeEstimate(snapshot.usage?.estimated_microusd??null,'USD',conversionRate,true)}</strong></div>{snapshot.budget&&<div><span>Unsettled reservations</span><strong>{rupeeEstimate(snapshot.budget.held_microusd,'USD',conversionRate,true)}</strong></div>}</div></details><RupeeConversion rate={conversionRate} onChange={setConversionRate}/></div>}
    {panel==='help'&&<div className="rd-settings-detail rd-settings-help"><details><summary>{t("How do I reply myself?")}</summary><p>{t("Open a chat, choose Reply myself, and send your message. You can let the bot reply again when you finish.")}</p></details><details><summary>{t("How do I update a product?")}</summary><p>{t("Open Products, search for the item, then change its price or recorded quantity.")}</p></details><details><summary>{t("How do I finish an order?")}</summary><p>{t("Review it in New, mark it Ready for pickup, and close it after collection.")}</p></details></div>}
    {panel==='technical'&&<div className="rd-settings-detail"><div className="rd-settings-facts"><div><span>{t("Mode")}</span><strong>{snapshot.mode}</strong></div><div><span>{t("Channel state")}</span><strong>{snapshot.channel.whatsapp.replaceAll('_',' ')}</strong></div><div><span>{t("AI processing")}</span><strong>{snapshot.inference?.enabled?t("Enabled"):t("Disabled")}</strong></div>{snapshot.inference?.rateHealth&&<div><span>{t("AI cost settings")}</span><strong>{snapshot.inference.rateHealth.status==='invalid'?t('Needs attention'):t('Estimates available · no date cutoff')}</strong></div>}</div></div>}
  </section>;
}
