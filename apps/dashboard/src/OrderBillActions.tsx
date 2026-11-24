import {useEffect,useState} from 'react';
import {formatMoney} from '../../../packages/contracts/money.js';
import {useOwnerLocale} from './owner-locale.js';
import {redesignApi} from './redesign-api.js';

type BillInfo={revision:number;issued_at:string;total_paise:string};
type Contact={conversationId?:string;phone?:string;name?:string;reason?:string};

export function OrderBillHistory({orderId}:{orderId:string}){
 const {t}=useOwnerLocale();
 const [bills,setBills]=useState<BillInfo[]>();
 const [error,setError]=useState('');
 useEffect(()=>{
  const request=new AbortController();
  redesignApi<{bills:BillInfo[]}>(`requests/${orderId}/bills`,undefined,request.signal)
   .then(result=>setBills(result.bills))
   .catch(e=>{if(!request.signal.aborted)setError(e.message);});
  return ()=>request.abort();
 },[orderId]);
 return <div className="rd-orders-bill">
  {error?<p role="alert">{t(error)}</p>:bills?.map(bill=><div className="rd-orders-bill-history" key={bill.revision}>
   <span>{t('Revision')} {bill.revision} · {new Date(bill.issued_at).toLocaleDateString('en-IN')} · {formatMoney(Number(bill.total_paise))}</span>
   <a href={billUrl(orderId,'download',bill.revision)} download>{t('Download')}</a>
  </div>)??<p role="status">{t('Loading bills…')}</p>}
  {bills?.length===0&&<p>{t('No final bills have been saved.')}</p>}
 </div>;
}

export function billUrl(id:string,mode:'print'|'download',revision:number){
 return `/api/owner/requests/${id}/bill?mode=${mode}&revision=${revision}`;
}

export function whatsappPhone(value:string){
 const phone=value.replace(/[\s()-]/g,'');
 return /^[6-9]\d{9}$/.test(phone)?'+91'+phone:phone;
}

export function ConfirmBillRecipient({orderId,phone:initialPhone,linked,busy,onSend}:{
 orderId:string;phone?:string;linked:boolean;busy:boolean;onSend:(id:string)=>void;
}){
 const {t}=useOwnerLocale();
 const [phone,setPhone]=useState(initialPhone??'');
 const [contact,setContact]=useState<Contact>();
 const [checked,setChecked]=useState(false);
 const [pending,setPending]=useState(false);
 const [error,setError]=useState('');
 async function find(){
  const number=whatsappPhone(phone);
  if(!linked&&!/^\+[1-9]\d{7,14}$/.test(number)){setError('Enter the customer’s WhatsApp number with its country code.');return;}
  setError('');setContact(undefined);setChecked(false);setPending(true);
  try{
   setContact(await redesignApi<Contact>(`requests/${orderId}/bill/recipient`,linked?{}:{phone:number}));
  }catch(e){setError((e as Error).message);}finally{setPending(false);}
 }
 return <div className="rd-orders-bill rd-orders-recipient">
  {!linked&&<label className="rd-orders-field">{t('Customer WhatsApp number')}
   <input type="tel" value={phone} readOnly={!!initialPhone} maxLength={24} placeholder="+91" onChange={e=>{setPhone(e.target.value);setContact(undefined);setChecked(false);}}/>
  </label>}
  <button type="button" className="rd-orders-quiet" disabled={busy||pending} onClick={()=>void find()}>{t(pending?'Checking…':'Find WhatsApp chat')}</button>
  {(error||contact?.reason)&&<p role="status">{t(error||contact?.reason||'')}</p>}
  {contact?.conversationId&&<>
   <p><strong>{contact.name??t('Customer')}</strong> {contact.phone}</p>
   <label className="rd-orders-free"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>{t('The customer agreed to receive this bill on WhatsApp.')}</label>
   <button type="button" className="rd-orders-primary" disabled={!checked||busy} onClick={()=>onSend(contact.conversationId!)}>{t('Send on WhatsApp')}</button>
  </>}
 </div>;
}
