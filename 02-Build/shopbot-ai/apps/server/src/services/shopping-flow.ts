import {discoveryFacetChoices} from './discovery-facet-actions.js';
import {requestStoreAssistance} from './store-assistance.js';
import {orderReference,visualProductReview} from './visual-ordering.js';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {ConversationState,RichReply,CatalogMap,SimulatorEvent} from '../../../../packages/contracts/index.js';
import {say,localName,lineName} from '../../../../packages/contracts/language.js';
import {ToolError,type ActorContext} from './context.js';
import {loadAssistantMemory} from './agent-assistance.js';
import {makeProductCheck,productConfirmed} from './product-verification.js';
import {presentReply} from './replies.js';

type Action=Extract<SimulatorEvent,{type:'shopping_action'}>['action'];
export function shoppingButton(state:ConversationState,action:Action,label:string){return {label,event:{id:randomUUID(),type:'shopping_action' as const,action,expectedVersion:state.version}};}
export function editListReply(state:ConversationState):RichReply {
  return {version:1,kind:'text',presentation:'list',outboundMessages:1,text:say(state,'Which item would you like to change?','எந்தப் பொருளை மாற்ற வேண்டும்?','Entha porulai maathanum?'),buttons:state.draft.slice(0,10).map((line,index)=>({label:`${index+1}. ${lineName(line,state)}`,event:{id:randomUUID(),type:'edit_item',lineId:line.id,expectedVersion:state.version}}))};
}
export async function handleShoppingAction(client:PoolClient,ctx:ActorContext,state:ConversationState,event:Extract<SimulatorEvent,{type:'shopping_action'|'edit_item'}>,map?:CatalogMap):Promise<RichReply> {
  if(event.expectedVersion!==state.version)throw new ToolError('Your list changed. Please use the latest choices.','stale_version');
  const reply=(text:string):RichReply=>({version:1,kind:'text',presentation:'text',outboundMessages:1,text});
  if(event.type==='shopping_action'&&event.action==='edit_quote'){
    if(!state.lastRequestId||!(await client.query("SELECT 1 FROM order_quotes WHERE store_id=$1 AND request_id=$2 AND state='offered'",[ctx.storeId,state.lastRequestId])).rowCount)throw new ToolError('Use the latest offered shop bill.','stale_question');
    return {...reply(say(state,'What should change in this bill? Tell me the item, count or pack by voice/text. Your order and bill stay unchanged until the change is checked.','இந்த Bill-ல என்ன மாற்றணும்? Item, count அல்லது pack-ஐ voice / text-ல சொல்லுங்க. Change confirm ஆகுற வரைக்கும் பழைய order அப்படியே இருக்கும்.','Intha Bill-la enna maathanum? Item, count illa pack-ai voice / text-la sollunga. Change confirm aagura varaikkum pazhaiya order appadiye irukkum.')),readOnly:true};
  }
  if(event.type==='shopping_action'&&event.action==='view_products'){
    if(state.pending?.kind!=='products'||state.lastRequestId)throw new ToolError('Use the latest product-photo button.','stale_question');
    return {...visualProductReview(state),readOnly:true};
  }
  if(event.type==='shopping_action'&&event.action==='next_item'){
    const pending=state.pending,line=pending?.kind==='question'?state.draft.find(l=>l.id===pending.lineId):undefined;
    const others=state.draft.filter(l=>l.id!==line?.id&&!l.shopCheckDeferred&&(l.resolution!=='matched'||state.requireProductConfirmation&&!productConfirmed(l)));
    if(state.lastRequestId||!line||line.resolution==='matched'||line.shopCheckDeferred||!others.length)throw new ToolError('Use the latest next-item choice.','stale_question');
    line.shopCheckDeferred=true;state.version++;
    state.pending=makeProductCheck(state,true)??{kind:'question',id:randomUUID(),lineId:others[0].id,version:state.version};
    await client.query('UPDATE conversations SET draft=$1::jsonb,pending=$2::jsonb,version=$3,assistant_memory=NULL,editing_line_id=NULL WHERE id=$4 AND store_id=$5 AND actor=$6',[JSON.stringify(state.draft),JSON.stringify(state.pending),state.version,ctx.conversationId,ctx.storeId,ctx.actor]);
    const result=presentReply({state,message:''},state);
    return {...result,text:say(state,`I’ve kept ${lineName(line,state)} for the shop to check. Let’s check the next item.`,`${lineName(line,state)} கடை சரிபார்க்கப் பட்டியலில் உள்ளது. அடுத்த பொருளைப் பார்ப்போம்.`,`${lineName(line,state)} kadai check panna list-la irukku. Adutha porulai paarppom.`)+'\n\n'+result.text};
  }
  if(event.type==='shopping_action'&&event.action==='options'){
    const memory=await loadAssistantMemory(client,ctx),facet=memory?.sourceVersion===state.version&&memory.purpose==='discovery'&&!state.pending?memory.observations[0]?.discovery?.facets[0]:undefined;
    const filters:NonNullable<RichReply['buttons']>=facet&&memory?discoveryFacetChoices(facet,state).map(v=>({label:v.label,event:{id:randomUUID(),type:'refine_discovery' as const,memoryId:memory.id,facet:facet.key,value:v.value}})):[];
    if(state.pending?.kind==='products'){
      const batch=state.pending,group=batch.groups.find(g=>g.discovery?.facets.length),offered=group?.discovery?.facets[0];
      if(group&&offered)filters.push(...discoveryFacetChoices(offered,state).map(v=>({label:v.label,event:{id:randomUUID(),type:'refine_search' as const,batchId:batch.id,lineId:group.lineId,facet:offered.key,value:v.value}})));
    }
    return {...reply(say(state,'What would you like to do?','அடுத்து என்ன செய்ய வேண்டும்?','Aduthu enna pannanum?')),presentation:'list',buttons:[...filters,...(state.draft.length&&!state.lastRequestId?[shoppingButton(state,'edit_list',say(state,'Change an item','மாற்றணும்','Porulai maathu'))]:[]),...(state.lastRequestId?[shoppingButton(state,'new_list',say(state,'New list','புதிய பட்டியல்','Pudhu list'))]:[]),shoppingButton(state,'browse',say(state,'Browse items','பொருட்களைப் பார்','Porutkal paaru')),shoppingButton(state,'handoff',say(state,'Talk to shop','உதவி வேணும்','Kadaiyila pesu'))]};
  }
  if(event.type==='edit_item'){
    if(state.lastRequestId)throw new ToolError('The submitted request cannot be edited. Please talk to the shop.');
    const line=state.draft.find(l=>l.id===event.lineId);if(!line)throw new ToolError('That item is no longer on your list.');
    await client.query('UPDATE conversations SET editing_line_id=$1,pending=NULL,product_review=NULL,assistant_memory=NULL,version=version+1 WHERE id=$2',[line.id,ctx.conversationId]);
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
  if(event.action==='confirm_clear'){
    if(state.lastRequestId)throw new ToolError('A sent request cannot be cleared. Ask the shop about it.','stale_confirmation');
    await client.query("UPDATE conversations SET draft='[]',pending=NULL,product_review=NULL,assistant_memory=NULL,editing_line_id=NULL,version=version+1,session_started_at=now() WHERE id=$1 AND store_id=$2 AND actor=$3",[ctx.conversationId,ctx.storeId,ctx.actor]);
    return reply(say(state,'Your list is cleared. No order was sent. What do you need now?','பட்டியல் காலி செய்யப்பட்டது. ஆர்டர் அனுப்பவில்லை. இப்போது என்ன வேண்டும்?','List clear panniyachu. Order anuppala. Ippo enna venum?'));
  }
  if(event.action==='continue_list'){return presentReply({state,message:''},state);}
  if(event.action==='new_list'){
    if(!state.lastRequestId&&!state.visualOrdering)throw new ToolError('Your current list is still in progress. Edit it or review it first.');
    await client.query("UPDATE conversations SET draft='[]',pending=NULL,product_review=NULL,assistant_memory=NULL,editing_line_id=NULL,last_request_id=NULL,version=version+1,session_started_at=now() WHERE id=$1",[ctx.conversationId]);
    return reply(state.lastRequestId?orderReference(state.lastRequestId)+'\n'+say(state,'Your previous order stays with the shop. What do you need on the new list?','முந்தைய ஆர்டர் கடையிடம் இருக்கு. புதிய பட்டியலில் என்ன வேணும்?','Munthaya order kadaiyila irukku. Pudhu list-la enna venum?'):say(state,'A new list is started. What items do you need?','புதிய பட்டியல் தொடங்கியாச்சு. என்ன பொருள் வேணும்?','Pudhu list thodangiyaachu. Enna porul venum?'));
  }
  if(event.action==='handoff'){const result=await requestStoreAssistance(client,ctx,state,event.expectedVersion);return {...reply(result.message),handoffRequested:true};}
  throw new ToolError('Use the current request status action.');
}
