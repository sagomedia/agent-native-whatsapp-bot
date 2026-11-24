import {useState} from 'react';
import {rupeeRate,DEFAULT_RUPEES_PER_USD,RUPEE_RATE_STORAGE_KEY} from './owner-model.js';

export function useRupeeRate() {
  return useState(() => {try {return rupeeRate(localStorage.getItem(RUPEE_RATE_STORAGE_KEY)) ?? DEFAULT_RUPEES_PER_USD;} catch {return DEFAULT_RUPEES_PER_USD;}});
}
export function RupeeConversion({rate,onChange}:{rate:number;onChange:(rate:number)=>void}) {
  const [input,setInput]=useState(()=>String(rate));
  const [notice,setNotice]=useState('');
  return <div><p>Display estimate: ₹{rate} per US dollar. This changes estimates only, not spending limits.</p><details><summary>Update rupee estimate</summary><form className="rd-settings-shop-form" onSubmit={event=>{
    event.preventDefault();const next=rupeeRate(input);
    if(next===null){setNotice('Enter a positive conversion rate with up to four decimal places.');return;}
    onChange(next);
    try{localStorage.setItem(RUPEE_RATE_STORAGE_KEY,String(next));setNotice('Rupee estimates updated on this browser.');}catch{setNotice('Rupee estimates updated for this page. Browser storage is unavailable.');}
  }}><label className="rd-settings-field">Rupees per US dollar <input type="number" min="0.0001" max="10000" step="0.0001" required value={input} onChange={event=>setInput(event.target.value)}/></label><button type="submit">Update rupee estimate</button></form>{notice&&<p role="status">{notice}</p>}</details><p>The initial ₹95 conversion is a planning estimate. Use the conversion on your Google bill for a closer comparison. Rupee estimates exclude taxes.</p><p><a href="https://aistudio.google.com/spend" target="_blank" rel="noreferrer">View Google spending and cap</a></p></div>;
}
