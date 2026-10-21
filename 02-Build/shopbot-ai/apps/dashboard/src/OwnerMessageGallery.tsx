import {useEffect,useState} from 'react';
import type {RichReply} from '../../../packages/contracts/index.js';
import {VisualReplyView} from './VisualReplyView.js';
import {useOwnerLocale} from './owner-locale.js';
import {Notice} from './owner-ui.js';
type Entry={id:string;label:string;group:string;note:string;reply:RichReply};
export function OwnerMessageGallery(){
 const {t}=useOwnerLocale();
 const [retry,setRetry]=useState(0);
 const [language,setLanguage]=useState('ta'),[group,setGroup]=useState(''),[entries,setEntries]=useState<Entry[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();setLoading(true);setEntries([]);setError('');fetch('/api/owner/message-gallery?language='+language,{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('Could not load message previews.');return r.json();}).then(data=>{if(!controller.signal.aborted){setEntries(data.entries);setLoading(false);}}).catch(e=>{if(e.name!=='AbortError'){setError(e.message);setLoading(false);}});return()=>controller.abort();},[language,retry]);
 const shown=entries.filter(entry=>!group||entry.group===group);
 return <section className="owner-gallery" aria-label="Customer message review"><p>Review the bot’s current replies with sample products. Buttons are disabled. These previews do not send WhatsApp messages, place orders or record payments.</p><div className="owner-gallery-filters"><label>Language<select value={language} onChange={e=>setLanguage(e.target.value)}><option value="ta">தமிழ்</option><option value="ta-Latn">Tanglish</option><option value="en">English</option></select></label><label>Flow stage<select value={group} onChange={e=>setGroup(e.target.value)}><option value="">All stages</option>{['Shopping','Checkout','After order','Recovery'].map(g=><option key={g}>{g}</option>)}</select></label></div>
  {error&&<Notice error>{error} <button type="button" onClick={()=>setRetry(value=>value+1)}>{t("Try again")}</button></Notice>}{!loading&&!error&&!shown.length?<div className="owner-empty"><h2>{t('No message previews in this stage')}</h2><p>{t('Choose another stage or check again.')}</p><button type="button" onClick={()=>group?setGroup(''):setRetry(value=>value+1)}>{t(group?'Show all stages':'Check again')}</button></div>:null}{loading?<p role="status">Loading current message previews…</p>:<div className="owner-gallery-list">{shown.map(entry=><article className="owner-gallery-entry" key={entry.id}><header><span>{entry.group}</span><h2>{entry.label}</h2>{entry.note&&<p>{entry.note}</p>}</header><div className="owner-gallery-phone"><VisualReplyView showText reply={entry.reply} disabled productImage={sku=>'/api/owner/message-gallery/products/'+encodeURIComponent(sku)+'/image'} messageImage={url=>'/api/owner/message-images/'+url.split('/').at(-1)}/></div><details><summary>Full accessible text</summary><p className="owner-message-text">{entry.reply.accessibleText??entry.reply.text}</p></details></article>)}</div>}
 </section>;
}
