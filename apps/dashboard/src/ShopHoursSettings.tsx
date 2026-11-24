import {useEffect,useState} from 'react';
import {redesignApi} from './redesign-api.js';
import {useOwnerLocale} from './owner-locale.js';
type Schedule={timezone:string;opensAt:string;closesAt:string;days:number[]};
type Hours={schedule:Schedule|null;revision:number;status:string};
export function ShopHoursSettings(){
 const {locale}=useOwnerLocale(),ta=locale==='ta';
 const [saved,setSaved]=useState<Hours>(),[draft,setDraft]=useState<Schedule>({timezone:'Asia/Kolkata',opensAt:'',closesAt:'',days:[0,1,2,3,4,5,6]}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();setError('');redesignApi<Hours>('store/hours',undefined,controller.signal).then(v=>{if(!controller.signal.aborted){setSaved(v);if(v.schedule)setDraft(v.schedule);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[retry]);
 async function save(){if(!saved||busy)return;setBusy(true);setError('');setNotice('');try{const v=await redesignApi<Hours>('store/hours',{expectedRevision:saved.revision,schedule:draft});setSaved(v);setDraft(v.schedule!);setNotice(ta?'கடை நேரம் சேமிக்கப்பட்டது.':'Shop hours saved.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const days=ta?['ஞாயிறு','திங்கள்','செவ்வாய்','புதன்','வியாழன்','வெள்ளி','சனி']:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
 return <form className="rd-settings-shop-form rd-settings-hours" onSubmit={e=>{e.preventDefault();void save();}}><h2>{ta?'கடை நேரம்':'Shop hours'}</h2><p>{ta?'கடை திறக்கும் நாட்களையும் நேரத்தையும் ஒருமுறை அமைக்கவும். காலை அறிக்கையும் வாடிக்கையாளர் தகவலும் இதைப் பயன்படுத்தும்.':'Set the opening days and hours once. Morning reports and customer closing notes use this schedule.'}</p>
 <div className="rd-settings-hours-times"><label className="rd-settings-field">{ta?'திறக்கும் நேரம்':'Opening time'}<input type="time" required value={draft.opensAt} onChange={e=>setDraft(d=>({...d,opensAt:e.target.value}))}/></label><label className="rd-settings-field">{ta?'மூடும் நேரம்':'Closing time'}<input type="time" required value={draft.closesAt} onChange={e=>setDraft(d=>({...d,closesAt:e.target.value}))}/></label></div>
 <label className="rd-settings-field">{ta?'நேர மண்டலம்':'Timezone'}<input required value={draft.timezone} maxLength={80} onChange={e=>setDraft(d=>({...d,timezone:e.target.value}))}/></label>
 <fieldset className="rd-settings-hours-days"><legend>{ta?'கடை திறக்கும் நாட்கள்':'Opening days'}</legend>{days.map((day,index)=><label key={index}><input type="checkbox" checked={draft.days.includes(index)} onChange={e=>setDraft(d=>({...d,days:e.target.checked?[...d.days,index].sort():d.days.filter(v=>v!==index)}))}/>{day}</label>)}</fieldset>
 <p className="rd-settings-hint">{ta?'மூடும் நேரம் திறக்கும் நேரத்திற்கு முன் இருந்தால், அடுத்த நாள் மூடுவதாகக் கருதப்படும்.':'If closing time is earlier than opening time, the shift closes the following day.'}</p>
 {error?<p role="alert">{error} <button type="button" onClick={()=>setRetry(n=>n+1)}>{ta?'மீண்டும் ஏற்று':'Reload hours'}</button></p>:null}{notice?<p role="status">{notice}</p>:null}
 <button type="submit" disabled={!saved||busy||!draft.opensAt||!draft.closesAt||draft.opensAt===draft.closesAt||!draft.days.length||JSON.stringify(saved.schedule)===JSON.stringify(draft)}>{busy?(ta?'சேமிக்கிறது…':'Saving…'):(ta?'கடை நேரத்தைச் சேமி':'Save shop hours')}</button></form>;
}
