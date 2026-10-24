import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {redesignApi} from './redesign-api.js';
export type ChatReading={read_sequence:string;anchor_sequence:string|null;anchor_offset:number;first_unread?:string|null};
type Message={id:string;sequence:string;direction:'inbound'|'outbound'};
type Position={through:string;anchor:string;offset:number};
export const sequenceAfter=(value:string,boundary:string)=>BigInt(value)>BigInt(boundary);
/** The highest visible sequence is monotonic; the viewport anchor is independent. */
export function visibleChatPosition(node:HTMLElement,previous='0'):Position|undefined {
 const viewport=node.getBoundingClientRect();
 const visible=[...node.querySelectorAll<HTMLElement>('[data-message-sequence]')].filter(element=>{if(!/^[1-9]\d*$/.test(element.dataset.messageSequence??''))return false;const rect=element.getBoundingClientRect();return rect.bottom>viewport.top&&rect.top<viewport.bottom;});
 if(!visible.length)return;
 const first=visible[0],last=visible.at(-1)!;
 return {through:sequenceAfter(last.dataset.messageSequence!,previous)?last.dataset.messageSequence!:previous,anchor:first.dataset.messageSequence!,offset:Math.max(-100000,Math.min(100000,Math.round(first.getBoundingClientRect().top-viewport.top)))};
}
export function useOwnerChatReading(id:string,opened:boolean,messages:Message[],loading:boolean,reading:ChatReading|null){
 const session=useMemo(()=>({timeline:{current:null as HTMLDivElement|null},nearBottom:{current:false},initialized:{current:false},position:{current:null as Position|null},readSequence:{current:'0'},lastSaved:{current:''},saveTimer:{current:undefined as ReturnType<typeof setTimeout>|undefined},saving:{current:false},rerun:{current:false},lastNotified:{current:'0'}}),[id]);
 const {timeline,nearBottom,initialized,position,readSequence,lastSaved,saveTimer,saving,rerun,lastNotified}=session;
 const [away,setAway]=useState(false),[boundary,setBoundary]=useState<string|null>(null),[readError,setReadError]=useState('');
 const activeId=useRef(id);
 const active=useCallback(()=>opened&&!document.hidden&&!!timeline.current?.getClientRects().length,[opened,id]);
 const save=useCallback(async()=>{
  if(saving.current){rerun.current=true;return;}
  const value=position.current,chat=id;if(!value||lastSaved.current===JSON.stringify(value))return;
  saving.current=true;rerun.current=false;
  try{await redesignApi(`conversations/${encodeURIComponent(chat)}/seen`,value,undefined,{keepalive:true});if(activeId.current===chat){lastSaved.current=JSON.stringify(value);setReadError('');if(sequenceAfter(value.through,lastNotified.current)){lastNotified.current=value.through;window.dispatchEvent(new Event('owner-attention-changed'));}}}
  catch{if(activeId.current===chat)setReadError('Reading position could not be saved. It will retry while this chat is open.');}
  finally{saving.current=false;if(activeId.current===chat&&rerun.current)void save();}
 },[id]);
 const record=useCallback(()=>{
  const node=timeline.current;if(!node||!initialized.current||!active())return;
  const value=visibleChatPosition(node,readSequence.current);if(!value)return;
  readSequence.current=value.through;position.current=value;
  nearBottom.current=node.scrollHeight-node.scrollTop-node.clientHeight<80;setAway(!nearBottom.current);
  if(!saveTimer.current)saveTimer.current=setTimeout(()=>{saveTimer.current=undefined;void save();},700);
 },[active,save]);
 useLayoutEffect(()=>{
  activeId.current=id;initialized.current=false;nearBottom.current=false;position.current=null;readSequence.current='0';lastSaved.current='';setBoundary(null);setAway(false);setReadError('');
 },[id]);
 useLayoutEffect(()=>{
  const node=timeline.current;if(!node||loading||!messages.length||!reading||initialized.current||!active())return;
  const find=(sequence:string|null)=>sequence?node.querySelector<HTMLElement>(`[data-message-sequence="${sequence}"]`):null;
  const saved=find(reading.anchor_sequence),unread=find(reading.first_unread??null),target=saved??unread;
  readSequence.current=reading.read_sequence;lastNotified.current=reading.read_sequence;setBoundary(reading.first_unread??null);
  if(target)node.scrollTop+=target.getBoundingClientRect().top-node.getBoundingClientRect().top-(saved?reading.anchor_offset:18);
  else node.scrollTop=node.scrollHeight;
  initialized.current=true;nearBottom.current=node.scrollHeight-node.scrollTop-node.clientHeight<80;setAway(!nearBottom.current);
  const frame=requestAnimationFrame(record);return()=>cancelAnimationFrame(frame);
 },[messages,loading,reading,record]);
 useEffect(()=>{
  const node=timeline.current;if(!node)return;
  const content=node.querySelector('[data-chat-content]');if(!content)return;
  // Preserve a message anchor as images/cards acquire their actual height.
  const resize=new ResizeObserver(()=>{
   if(!initialized.current)return;
   if(nearBottom.current)node.scrollTop=node.scrollHeight;
   else if(position.current){const anchor=node.querySelector<HTMLElement>(`[data-message-sequence="${position.current.anchor}"]`);if(anchor)node.scrollTop+=anchor.getBoundingClientRect().top-node.getBoundingClientRect().top-position.current.offset;}
   record();
  });resize.observe(content);return()=>resize.disconnect();
 },[id,loading,record]);
 useEffect(()=>{
  const visibility=()=>{if(document.hidden)void save();else record();};
  const timer=setInterval(()=>{if(active()){record();void save();}},5000);
  const leaving=()=>{void save();};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',leaving);
  return()=>{clearInterval(timer);if(saveTimer.current)clearTimeout(saveTimer.current);saveTimer.current=undefined;void save();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',leaving);};
 },[id,active,record,save]);
 return {timeline,nearBottom,initialized,away,boundary,readError,record,save};
}
