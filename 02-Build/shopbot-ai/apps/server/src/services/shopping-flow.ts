import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {ConversationState,RichReply,CatalogMap,SimulatorEvent} from '../../../../packages/contracts/index.js';
import {say,localName,lineName} from '../../../../packages/contracts/language.js';
import {ToolError,type ActorContext} from './context.js';
import {loadAssistantMemory} from './agent-assistance.js';

type Action=Extract<SimulatorEvent,{type:'shopping_action'}>['action'];
export function shoppingButton(state:ConversationState,action:Action,label:string){return {label,event:{id:randomUUID(),type:'shopping_action' as const,action,expectedVersion:state.version}};}
export function editListReply(state:ConversationState):RichReply {
  return {version:1,kind:'text',presentation:'list',outboundMessages:1,text:say(state,'Which item would you like to change?','எந்தப் பொருளை மாற்ற வேண்டும்?','Entha porulai maathanum?'),buttons:state.draft.slice(0,10).map((line,index)=>({label:`${index+1}. ${lineName(line,state)}`,event:{id:randomUUID(),type:'edit_item',lineId:line.id,expectedVersion:state.version}}))};
}
export async function handleShoppingAction(client:PoolClient,ctx:ActorContext,state:ConversationState,event:Extract<SimulatorEvent,{type:'shopping_action'|'edit_item'}>,map?:CatalogMap):Promise<RichReply> {
  if(event.expectedVersion!==state.version)throw new ToolError('Your list changed. Please use the latest choices.','stale_version');
  const reply=(text:string):RichReply=>({version:1,kind:'text',presentation:'text',outboundMessages:1,text});
  if(event.type==='shopping_action'&&event.action==='options'){
    const memory=await loadAssistantMemory(client,ctx),facet=memory?.sourceVersion===state.version&&memory.purpose==='discovery'&&!state.pending?memory.observations[0]?.discovery?.facets[0]:undefined;
    const filters:NonNullable<RichReply['buttons']>=facet&&memory?facet.values.slice(0,3).map(v=>({label:localName(v.label,v.localNames,state),event:{id:randomUUID(),type:'refine_discovery' as const,memoryId:memory.id,facet:facet.key,value:v.value}})):[];
    if(state.pending?.kind==='products'){
      const batch=state.pending,group=batch.groups.find(g=>g.discovery?.facets.length),offered=group?.discovery?.facets[0];
      if(group&&offered)filters.push(...offered.values.slice(0,3).map(v=>({label:localName(v.label,v.localNames,state),event:{id:randomUUID(),type:'refine_search' as const,batchId:batch.id,lineId:group.lineId,facet:offered.key,value:v.value}})));
    }
    return {...reply(say(state,'What would you like to do?','அடுத்து என்ன செய்ய வேண்டும்?','Aduthu enna pannanum?')),presentation:'list',buttons:[...filters,...(state.draft.length&&!state.lastRequestId?[shoppingButton(state,'edit_list',say(state,'Change an item','பொருளை மாற்று','Porulai maathu'))]:[]),...(state.lastRequestId?[shoppingButton(state,'new_list',say(state,'New list','புதிய பட்டியல்','Pudhu list'))]:[]),shoppingButton(state,'browse',say(state,'Browse items','பொருட்களைப் பார்','Porutkal paaru')),shoppingButton(state,'handoff',say(state,'Talk to shop','கடையிடம் பேசு','Kadaiyila pesu'))]};
  }
  if(event.type==='edit_item'){
    if(state.lastRequestId)throw new ToolError('The submitted request cannot be edited. Please talk to the shop.');
    const line=state.draft.find(l=>l.id===event.lineId);if(!line)throw new ToolError('That item is no longer on your list.');
    await client.query('UPDATE conversations SET editing_line_id=$1,pending=NULL,assistant_memory=NULL,version=version+1 WHERE id=$2',[line.id,ctx.conversationId]);
    const next={...state,version:state.version+1};
    return {...reply(say(state,`What should change for ${lineName(line,state)}? Send the correct name, size or quantity. Other items will stay as they are.`,`${lineName(line,state)} என்ன மாற்ற வேண்டும்? பெயர், அளவு அல்லது எண்ணிக்கையைச் சொல்லுங்கள். மற்ற பொருட்கள் மாறாது.`,`${lineName(line,state)} enna maathanum? Peyar, size illa quantity sollunga. Maththa porutkal maaraathu.`)),buttons:[{label:say(state,'Remove item','பொருளை நீக்கு','Porulai neekku'),event:{id:randomUUID(),type:'set_quantity',lineId:line.id,quantity:0,expectedVersion:next.version}},shoppingButton(next,'keep_list',say(state,'Keep unchanged','மாற்ற வேண்டாம்','Maatha venaam'))]};
  }
  if(event.action==='edit_list'){if(state.lastRequestId)throw new ToolError('The submitted request cannot be edited. Please talk to the shop.');return editListReply(state);}
  if(event.action==='browse')return {...reply(say(state,'What would you like to find?','என்ன பொருள் தேட வேண்டும்?','Enna porul thedanum?')),buttons:map?.departments.filter(d=>d.count>0).slice(0,10).map(d=>({label:localName(d.label,d.localNames,state),event:{id:randomUUID(),type:'browse',query:d.id,expectedVersion:state.version}}))};
  if(event.action==='help')return reply(say(state,'What are you working on? Send a short message, voice note or photo.','என்ன வேலைக்கு பொருள் வேண்டும்? சுருக்கமாகச் சொல்லுங்கள். படம் அல்லது குரல் பதிவும் அனுப்பலாம்.','Enna velaikku porul venum? Konjam sollunga. Photo illa voice note-um anuppalaam.'));
  if(event.action==='keep_list'){
    await client.query('UPDATE conversations SET pending=NULL,editing_line_id=NULL,assistant_memory=NULL,version=version+1 WHERE id=$1',[ctx.conversationId]);
    return reply(say(state,'Your list is saved. Nothing new has been sent to the shop.','உங்கள் பட்டியல் அப்படியே இருக்கிறது. பிறகு தொடரலாம். புதிதாக எதையும் கடைக்கு அனுப்பவில்லை.','Unga list appadiye irukku. Appuram thodaralaam. Pudhusaa edhuvum kadaikku anuppala.'));
  }
  if(event.action==='new_list'){
    if(!state.lastRequestId)throw new ToolError('Your current list is still in progress. Edit it or review it first.');
    await client.query("UPDATE conversations SET draft='[]',pending=NULL,assistant_memory=NULL,editing_line_id=NULL,last_request_id=NULL,version=version+1,session_started_at=now() WHERE id=$1",[ctx.conversationId]);
    return reply(say(state,'Your previous request stays with the shop. What would you like on your new list?','முந்தைய கோரிக்கை கடையிடம் உள்ளது. புதிய பட்டியலில் என்ன வேண்டும்?','Munthaya request kadaiyila irukku. Pudhu list-la enna venum?'));
  }
  if(event.action==='handoff'){
    await client.query("UPDATE conversations SET operator_mode='owner',handoff_requested=true,editing_line_id=NULL,operator_revision=operator_revision+1 WHERE id=$1",[ctx.conversationId]);
    await client.query("UPDATE whatsapp_outbox SET state='cancelled',last_error='customer_handoff' WHERE conversation_id=$1 AND state='queued' AND sender_kind='assistant'",[ctx.conversationId]);
    await client.query("UPDATE messages SET status='cancelled' WHERE id IN (SELECT message_id FROM whatsapp_outbox WHERE conversation_id=$1 AND state='cancelled')",[ctx.conversationId]);
    return {...reply(say(state,'I’ve asked the shop to help. Your list and messages are kept; the assistant is paused while the shop handles this conversation.','கடைக்கு தகவல் கொடுத்துள்ளேன். உங்கள் பட்டியலும் செய்திகளும் அப்படியே இருக்கின்றன. இனி கடையிடம் நேராகப் பேசலாம். நான் இப்போது பதிலளிக்க மாட்டேன்.','Kadaikku thagaval kuduthirukken. Unga list-um messages-um appadiye irukku. Ini kadaiyila neradiyaa pesalaam. Naan ippo reply panna maatten.')),handoffRequested:true};
  }
  throw new ToolError('Use the current request status action.');
}
