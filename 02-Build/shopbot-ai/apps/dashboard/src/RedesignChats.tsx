import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {RichReply} from '../../../packages/contracts/index.js';
import {customerLabel, clockTime, day, replyWindowOpen, type CustomerIdentity} from './owner-model.js';
import {navigateOwner, OwnerLink, useOwnerUrl} from './owner-ui.js';
import {visiblePoll} from './owner-polling.js';
import {VisualReplyView} from './VisualReplyView.js';
import {redesignApi} from './redesign-api.js';
import './redesign-chats.css';

type Conversation = CustomerIdentity & {
  id:string; actor:string; operator_mode:'assistant'|'owner'; operator_revision:number;
  handoff_requested:boolean; needs_reply?:boolean; last_text:string|null;
  updated_at:string|null; last_inbound_at:string|null; pending:number;
};
type Inbox = {
  conversations:Conversation[];
  conversationCounts?:{help:number; total:number};
  inboxPage?:{number:number; total:number; hasNext:boolean; ids:string[]};
  store:{operator_paused:boolean};
  channel:{liveSending:boolean};
};
type Message = {
  sequence:string; id:string; conversation_id:string; direction:'inbound'|'outbound'; text:string;
  created_at:string; status:string; whatsapp:boolean; sender_kind?:string;
  media_available:boolean|null; media_state?:string; payload?:Partial<RichReply>&{type?:string;mediaId?:string};
};
type History = {messages:Message[]; olderCursor:string|null};
type Attempt = {id:string; text:string};

// Keep previously loaded history while refreshing delivery status and new replies.
function mergeMessages(current:Message[],incoming:Message[]){
  const byId=new Map(current.map(message=>[message.id,message]));
  for(const message of incoming)byId.set(message.id,message);
  return [...byId.values()].sort((a,b)=>BigInt(a.sequence)<BigInt(b.sequence)?-1:BigInt(a.sequence)>BigInt(b.sequence)?1:0);
}

function initials(name:string){return (name.replace(/\s*·.*$/,'').trim().split(/\s+/).map(part=>part[0]).slice(0,2).join('')||'?').toUpperCase();}
function displayName(c:Conversation){return c.customer_name?.trim()||customerLabel(c.actor,c.id,c).replace(/ · \+\d+$/,'');}
function phone(c:Conversation){return c.customer_phone?`+${c.customer_phone.replace(/^\+/,'')}`:c.actor==='local-simulator'?'Demo conversation':'';}
function needsReply(c:Conversation){return c.needs_reply??c.handoff_requested;}
function delivery(status:string,whatsapp:boolean){
  if(!whatsapp)return 'Preview';
  const labels:Record<string,string>={queued:'Queued',accepted:'Sending',sent:'Sent',delivered:'Delivered',read:'Read',unknown:'Delivery uncertain',failed:'Could not send',cancelled:'Not sent'};
  return labels[status]??status.replaceAll('_',' ');
}
function SearchIcon(){return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.8" cy="10.8" r="6.7"/><path d="m16 16 5 5"/></svg>;}
function SendIcon(){return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="m3 4 18 8-18 8 3-7 8-1-8-1-3-7Z" fill="currentColor"/></svg>;}

export function RedesignChats(){
  const params=useOwnerUrl();
  const urlConversation=params.get('conversation')??'';
  const inboxPage=Math.max(1,Number(params.get('inboxPage')??1)||1);
  const serverQuery=params.get('inboxSearch')??'';
  const [query,setQuery]=useState(serverQuery);
  const [filter,setFilter]=useState<'all'|'needs'>('all');
  const [inbox,setInbox]=useState<Inbox|null>(null);
  const [inboxError,setInboxError]=useState('');
  const [messages,setMessages]=useState<Message[]>([]);
  const [confirmedReplies,setConfirmedReplies]=useState<Message[]>([]);
  const [historyError,setHistoryError]=useState('');
  const [historyLoading,setHistoryLoading]=useState(false);
  const [olderCursor,setOlderCursor]=useState<string|null>(null);
  const [olderLoading,setOlderLoading]=useState(false);
  const olderRequest=useRef<AbortController|null>(null);
  const olderCursorRef=useRef<string|null>(null);
  const hasOlderPages=useRef(false);
  const prependAnchor=useRef<{height:number;top:number}|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [actionError,setActionError]=useState('');
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const attempts=useRef<Record<string,Attempt>>({});
  const actionBusy=useRef(false);
  const selectedRef=useRef('');
  const timeline=useRef<HTMLDivElement>(null);
  const nearBottom=useRef(true);
  const [unseen,setUnseen]=useState(false);
  const [awayFromLatest,setAwayFromLatest]=useState(false);
  const lastMessageId=useRef('');
  const [reloadHistory,setReloadHistory]=useState(0);

  useEffect(()=>setQuery(serverQuery),[serverQuery]);
  useEffect(()=>{
    const timer=setTimeout(()=>{if(query!==serverQuery)navigateOwner({inboxSearch:query||null,inboxPage:null},true);},250);
    return()=>clearTimeout(timer);
  },[query,serverQuery]);

  useEffect(()=>visiblePoll(async signal=>{
    try{
      const read=new URLSearchParams({details:'0',inboxPage:String(inboxPage),inboxSearch:serverQuery,inboxHelp:filter==='needs'?'1':'0'});
      if(urlConversation)read.set('conversation',urlConversation);
      const next=await redesignApi<Inbox>('snapshot?'+read,undefined,signal);
      if(signal.aborted)return;
      setInbox(next);setInboxError('');
    }catch(error){if(!signal.aborted)setInboxError(error instanceof Error?error.message:'Chats could not be loaded.');throw error;}
  },{intervalMs:5000}),[inboxPage,serverQuery,urlConversation,filter]);

  const listed=inbox?.conversations.filter(c=>inbox.inboxPage?.ids?.includes(c.id)??true)??[];
  const shown=filter==='needs'?listed.filter(needsReply):listed;
  const selectedId=urlConversation||listed[0]?.id||'';
  selectedRef.current=selectedId;
  const conversation=inbox?.conversations.find(c=>c.id===selectedId);
  const draft=drafts[selectedId]??'';
  const needsCount=inbox?.conversationCounts?.help??listed.filter(needsReply).length;
  const mobileDetail=!!urlConversation;
  // A successful POST confirms persistence; history refreshes only reconcile status.
  const sortedMessages=useMemo(()=>{
    const known=new Set(messages.map(message=>message.id));
    return [...messages,...confirmedReplies.filter(message=>!known.has(message.id))].filter(message=>message.conversation_id===selectedId);
  },[messages,confirmedReplies,selectedId]);
  const awaitingDelivery=sortedMessages.some(message=>message.direction==='outbound'&&['queued','accepted','sent'].includes(message.status));
  useEffect(()=>{
    const known=new Set(messages.map(message=>message.id));
    setConfirmedReplies(current=>current.some(message=>known.has(message.id))?current.filter(message=>!known.has(message.id)):current);
  },[messages]);

  useEffect(()=>{
    olderRequest.current?.abort();olderRequest.current=null;
    olderCursorRef.current=null;hasOlderPages.current=false;prependAnchor.current=null;
    setMessages([]);setHistoryLoading(!!selectedId);setOlderLoading(false);setHistoryError('');setOlderCursor(null);setNotice('');setActionError('');
    nearBottom.current=true;lastMessageId.current='';setUnseen(false);setAwayFromLatest(false);
    return ()=>{olderRequest.current?.abort();};
  },[selectedId]);

  useEffect(()=>{
    if(!selectedId)return;
    return visiblePoll(async signal=>{
      try{
        const next=await redesignApi<History>(`conversations/${encodeURIComponent(selectedId)}`,undefined,signal);
        if(signal.aborted)return;
        setMessages(current=>mergeMessages(current,next.messages));
        if(!hasOlderPages.current){olderCursorRef.current=next.olderCursor;setOlderCursor(next.olderCursor);}
        setHistoryError('');setHistoryLoading(false);
      }catch(error){if(!signal.aborted){setHistoryError(error instanceof Error?error.message:'Messages could not be loaded.');setHistoryLoading(false);}throw error;}
    },{intervalMs:awaitingDelivery?1500:5000});
  },[selectedId,reloadHistory,awaitingDelivery]);

  useLayoutEffect(()=>{
    const node=timeline.current;
    if(!node)return;
    const latest=sortedMessages.at(-1)?.id??'';
    if(prependAnchor.current){
      const anchor=prependAnchor.current;
      node.scrollTop=anchor.top+node.scrollHeight-anchor.height;
      prependAnchor.current=null;
    }else if(nearBottom.current){
      node.scrollTop=node.scrollHeight;setUnseen(false);
    }else if(latest&&latest!==lastMessageId.current){setUnseen(true);}
    lastMessageId.current=latest;
  },[sortedMessages,historyLoading]);

  useEffect(()=>{
    const node=timeline.current;
    if(!node)return;
    const resize=new ResizeObserver(()=>{if(nearBottom.current)node.scrollTop=node.scrollHeight;});
    resize.observe(node);
    return ()=>resize.disconnect();
  },[selectedId,!!conversation]);

  async function loadOlder(){
    const cursor=olderCursorRef.current,node=timeline.current;
    if(!cursor||!node||olderRequest.current||historyLoading)return;
    const id=selectedId,controller=new AbortController();olderRequest.current=controller;
    setOlderLoading(true);setHistoryError('');
    try{
      const next=await redesignApi<History>(`conversations/${encodeURIComponent(id)}?before=${encodeURIComponent(cursor)}`,undefined,controller.signal);
      if(controller.signal.aborted||selectedRef.current!==id)return;
      // Measure immediately before prepending so scrolling during the request is respected.
      prependAnchor.current={height:node.scrollHeight,top:node.scrollTop};
      hasOlderPages.current=true;olderCursorRef.current=next.olderCursor;setOlderCursor(next.olderCursor);
      setMessages(current=>mergeMessages(current,next.messages));
    }catch(error){if(!controller.signal.aborted)setHistoryError(error instanceof Error?error.message:'Older messages could not be loaded.');}
    finally{if(olderRequest.current===controller){olderRequest.current=null;setOlderLoading(false);}}
  }

  useEffect(()=>{
    const hasDraft=Object.values(drafts).some(value=>value.trim());
    if(!hasDraft)return;
    const warn=(event:BeforeUnloadEvent)=>event.preventDefault();
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[drafts]);

  async function refresh(){
    const read=new URLSearchParams({details:'0',inboxPage:String(inboxPage),inboxSearch:serverQuery,inboxHelp:filter==='needs'?'1':'0'});
    if(selectedRef.current)read.set('conversation',selectedRef.current);
    const next=await redesignApi<Inbox>('snapshot?'+read);
    setInbox(next);setInboxError('');
  }
  async function control(mode:'owner'|'assistant'){
    if(!conversation||actionBusy.current)return;
    actionBusy.current=true;setBusy(true);setActionError('');setNotice('');
    try{
      const acknowledge=mode==='owner'&&conversation.handoff_requested;
      await redesignApi(`conversations/${conversation.id}/control`,{mode,revision:conversation.operator_revision,acknowledge,notify:mode==='assistant'});
      await refresh();
      if(selectedRef.current===conversation.id)setNotice(mode==='owner'?"You're replying to this customer.":'The bot is handling this chat.');
    }catch(error){if(selectedRef.current===conversation.id)setActionError(error instanceof Error?error.message:'Could not change who replies.');}
    finally{actionBusy.current=false;setBusy(false);}
  }
  async function send(){
    if(!conversation||!draft.trim()||actionBusy.current||conversation.operator_mode!=='owner')return;
    const text=draft.trim();
    const attempt=attempts.current[conversation.id]?.text===text?attempts.current[conversation.id]:{id:crypto.randomUUID(),text};
    attempts.current[conversation.id]=attempt;
    actionBusy.current=true;setBusy(true);setActionError('');setNotice('');
    try{
      const result=await redesignApi<{messageId:string}>(`conversations/${conversation.id}/reply`,{id:attempt.id,text,revision:conversation.operator_revision});
      delete attempts.current[conversation.id];
      setDrafts(current=>({...current,[conversation.id]:''}));
      setConfirmedReplies(current=>[...current.filter(message=>message.id!==result.messageId),{
        id:result.messageId,sequence:'0',conversation_id:conversation.id,direction:'outbound',text,
        created_at:new Date().toISOString(),status:'queued',whatsapp:true,sender_kind:'owner',media_available:null,
      }]);
      if(selectedRef.current===conversation.id){
        nearBottom.current=true;setNotice('Reply queued. Its delivery status will appear here.');
        // Restart the existing history poll, cancelling any pre-send stale read.
        setReloadHistory(value=>value+1);
      }
      // Refresh failures must never turn a committed reply into a send failure.
      void refresh().catch(error=>setInboxError(error instanceof Error?error.message:'Chats could not be updated.'));
    }catch(error){if(selectedRef.current===conversation.id)setActionError(error instanceof Error?error.message:'Could not send your reply. Try again.');}
    finally{actionBusy.current=false;setBusy(false);}
  }

  const canSend=!!conversation&&conversation.actor!=='local-simulator'&&inbox?.channel.liveSending&&replyWindowOpen(conversation.last_inbound_at);
  function choose(id:string){if(busy)return;navigateOwner({view:'conversations',conversation:id});}

  return <div className={`rd-chats ${mobileDetail?'rd-chats-detail-open':''}`}>
    <section className="rd-chats-list" aria-label="Chats">
      <header className="rd-chats-list-head"><h1>Chats</h1><label className="rd-chats-search"><SearchIcon/><span className="rd-chats-sr-only">Search chats</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search chats" autoComplete="off"/></label><div className="rd-chats-filters" role="group" aria-label="Filter chats"><button type="button" className={filter==='all'?'is-active':''} aria-pressed={filter==='all'} onClick={()=>{setFilter('all');navigateOwner({inboxPage:null,conversation:null},true);}}>All</button><button type="button" className={filter==='needs'?'is-active':''} aria-pressed={filter==='needs'} onClick={()=>{setFilter('needs');navigateOwner({inboxPage:null,conversation:null},true);}}>Needs reply {needsCount>0&&<span className="rd-chats-count">{needsCount}</span>}</button></div></header>
      {inboxError&&<p className="rd-chats-alert" role="alert">Chats are not updating. <button type="button" onClick={()=>void refresh().catch(()=>{})}>Try again</button></p>}
      {!inbox&&!inboxError?<p className="rd-chats-empty">Loading chats…</p>:shown.length===0?<div className="rd-chats-empty"><p>{query?'No matching chats.':filter==='needs'?'No chats need your reply.':'No chats yet.'}</p>{filter==='needs'&&<button type="button" className="rd-chats-outline" onClick={()=>setFilter('all')}>View all chats</button>}</div>:<div className="rd-chats-rows" role="region" aria-label="Chat list" tabIndex={0}>{shown.map(c=><button type="button" key={c.id} disabled={busy} className={`rd-chats-row ${selectedId===c.id?'is-selected':''}`} aria-current={selectedId===c.id?'true':undefined} onClick={()=>choose(c.id)}><span className="rd-chats-avatar" aria-hidden="true">{initials(displayName(c))}</span><span className="rd-chats-row-main"><span className="rd-chats-row-top"><strong>{displayName(c)}</strong><time>{c.updated_at?clockTime(c.updated_at):''}</time></span><span className="rd-chats-preview">{c.last_text||'No messages yet'}</span>{needsReply(c)?<span className="rd-chats-needs-label">Needs your reply</span>:c.operator_mode==='owner'?<span className="rd-chats-owner-label">You’re replying</span>:null}</span>{needsReply(c)&&<span className="rd-chats-dot" aria-label="Needs reply"/>}</button>)}</div>}
      {inbox?.inboxPage&&inbox.inboxPage.total>inbox.inboxPage.ids.length&&<div className="rd-chats-pages"><button type="button" disabled={inboxPage<=1} onClick={()=>navigateOwner({inboxPage:String(inboxPage-1),conversation:null})}>Previous</button><span>Page {inboxPage}</span><button type="button" disabled={!inbox.inboxPage.hasNext} onClick={()=>navigateOwner({inboxPage:String(inboxPage+1),conversation:null})}>Next</button></div>}
      {filter==='needs'&&shown.length>0&&<div className="rd-chats-list-foot"><span>Other chats are handled by the bot</span><button type="button" className="rd-chats-outline" onClick={()=>setFilter('all')}>View all chats</button></div>}
    </section>
    <section className="rd-chats-thread" aria-label="Selected chat">
      {conversation?<>
        <header className="rd-chats-thread-head"><button type="button" className="rd-chats-back" aria-label="Back to chats" disabled={busy} onClick={()=>navigateOwner({conversation:null})}>←</button><span className="rd-chats-avatar" aria-hidden="true">{initials(displayName(conversation))}</span><div className="rd-chats-thread-person"><h2>{displayName(conversation)}</h2><span>{phone(conversation)}</span></div><span className={`rd-chats-status ${conversation.operator_mode==='owner'?'is-owner':''}`}>{conversation.operator_mode==='owner'?"You're replying":'Bot handling this chat'}</span></header>
        {conversation.operator_mode==='owner'&&<div className="rd-chats-control"><strong>You’re replying</strong><button type="button" className="rd-chats-outline" disabled={busy} onClick={()=>void control('assistant')}>Let bot reply</button></div>}
        {actionError&&<div className="rd-chats-thread-alert" role="alert">{actionError}</div>}
        {notice&&<div className="rd-chats-thread-notice" role="status">{notice}</div>}
        <div className="rd-chats-messages" role="log" aria-live="polite" aria-label="Messages" tabIndex={0} ref={timeline} onLoadCapture={()=>{if(nearBottom.current&&timeline.current)timeline.current.scrollTop=timeline.current.scrollHeight;}} onScroll={()=>{const node=timeline.current;if(node){nearBottom.current=node.scrollHeight-node.scrollTop-node.clientHeight<80;setAwayFromLatest(!nearBottom.current);if(nearBottom.current)setUnseen(false);if(node.scrollTop<100)void loadOlder();}}}>
          {historyError&&<div className="rd-chats-history-error" role="alert">Messages are not updating. <button type="button" onClick={()=>setReloadHistory(value=>value+1)}>Try again</button></div>}
          {historyLoading?<p className="rd-chats-history-empty">Loading messages…</p>:sortedMessages.length===0?<p className="rd-chats-history-empty">No messages yet.</p>:<>
            <div className="rd-chats-history-actions">{olderCursor?<button type="button" disabled={olderLoading} onClick={()=>void loadOlder()}>{olderLoading?'Loading older messages…':'Earlier messages'}</button>:null}</div>
            {sortedMessages.map((m,index)=><div key={m.id} className="rd-chats-message-group">{index===0||day(sortedMessages[index-1].created_at)!==day(m.created_at)?<div className="rd-chats-date"><span>{day(m.created_at)}</span></div>:null}<article className={`rd-chats-bubble ${m.direction==='outbound'?'is-outbound':''}`}><p>{m.text}</p>{m.payload?.type==='image'&&m.payload.mediaId&&m.media_available&&<img src={`/api/owner/conversations/${encodeURIComponent(selectedId)}/media/image/${encodeURIComponent(m.payload.mediaId)}`} alt="Customer photo" loading="lazy"/>}{m.payload?.type==='voice'&&m.payload.mediaId&&m.media_available&&<audio controls preload="none" src={`/api/owner/conversations/${encodeURIComponent(selectedId)}/media/voice/${encodeURIComponent(m.payload.mediaId)}`}/> }{m.media_available===false&&m.payload?.type&&<small className="rd-chats-media-note">{m.media_state==='pending'||m.media_state==='fetching'?'Attachment is loading.':'Attachment is unavailable.'}</small>}{m.direction==='outbound'&&m.payload?.version===1&&m.payload.parts&&<VisualReplyView reply={m.payload as RichReply} productImage={sku=>`/api/owner/products/${encodeURIComponent(sku)}/image`} messageImage={url=>`/api/owner/message-images/${encodeURIComponent(url.split('/').at(-1)??'')}`}/>}<small className="rd-chats-message-meta">{clockTime(m.created_at)}{m.direction==='outbound'?` · ${m.sender_kind==='owner'?'You':'Bot'} · ${delivery(m.status,m.whatsapp)}`:''}</small></article></div>)}
          </>}
          {awayFromLatest&&<button type="button" className="rd-chats-new" onClick={()=>{nearBottom.current=true;timeline.current?.scrollTo({top:timeline.current.scrollHeight});setUnseen(false);setAwayFromLatest(false);}}>{unseen?'New messages ↓':'Latest messages ↓'}</button>}
        </div>
        <div className="rd-chats-bottom">{conversation.operator_mode==='assistant'?<button type="button" className="rd-chats-primary" disabled={busy} onClick={()=>void control('owner')}>Reply myself</button>:!canSend?<p className="rd-chats-cannot-send">{conversation.actor==='local-simulator'?'This demo chat cannot send replies.':!inbox?.channel.liveSending?'Customer replies are unavailable right now.':'The WhatsApp reply window has closed.'}</p>:<form className="rd-chats-compose" onSubmit={event=>{event.preventDefault();void send();}}><label className="rd-chats-sr-only" htmlFor="rd-chats-reply">Reply to customer</label><textarea id="rd-chats-reply" rows={1} maxLength={4096} placeholder="Write your reply…" value={draft} disabled={busy} onChange={event=>{const value=event.target.value;setDrafts(current=>({...current,[selectedId]:value}));if(attempts.current[selectedId]?.text!==value.trim())delete attempts.current[selectedId];}}/><button type="submit" className="rd-chats-send" disabled={busy||!draft.trim()} aria-label="Send reply"><SendIcon/></button></form>}</div>
        <div className="rd-chats-order-link"><OwnerLink values={{view:'requests',requests:'all',order:null,orderSearch:conversation.id,orderPage:null}}>View this customer’s orders</OwnerLink></div>
      </>:<div className="rd-chats-no-selection">Choose a chat to read its messages.</div>}
    </section>
  </div>;
}
