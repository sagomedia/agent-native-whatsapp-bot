import {randomUUID} from 'node:crypto';
import type {ConversationState,RichReply,CatalogMap} from '../../../../packages/contracts/index.js';
import {say,localName,unitName} from '../../../../packages/contracts/language.js';
import {shoppingButton} from './shopping-flow.js';

// Backend-owned UI policy: choosing/ordering uses concrete, version-bound actions.
export function shoppingActions(reply:RichReply,state:ConversationState,map?:CatalogMap):RichReply {
  const id=()=>randomUUID();
  const flow=(action:Parameters<typeof shoppingButton>[1],en:string,ta:string,latin:string)=>shoppingButton(state,action,say(state,en,ta,latin));
  if(reply.handoffRequested||state.handoffRequested)return reply;
  if(state.lastRequestId&&!reply.cards?.length)return reply.buttons?.length?reply:{...reply,buttons:[flow('status','Request status','கோரிக்கை நிலை','Request status'),flow('new_list','New list','புதிய பட்டியல்','Pudhu list'),flow('handoff','Talk to shop','கடையிடம் பேசு','Kadaiyila pesu')]};
  if(reply.kind==='order_review')return {...reply,presentation:'text',buttons:[...(reply.buttons??[]).slice(0,1),flow('edit_list','Edit list','பட்டியலை மாற்று','List maathu'),flow('keep_list','Keep for later','பிறகு தொடரலாம்','Piragu thodarlaam')]};
  if(state.editingLineId)return reply;
  const line=state.pending?.kind==='question'?state.draft.find(l=>l.id===(state.pending as {lineId:string}).lineId):undefined;
  if(line?.resolution==='needs_quantity'){
    const product=line.candidates?.find(p=>p.sku===line.sku),step=product?.quantityStep??1;
    const amounts=[1,2].filter(q=>Math.abs(q/step-Math.round(q/step))<1e-7);
    return {...reply,buttons:[...amounts.map(quantity=>({label:`${quantity} ${unitName(line.unit??'unit',state,quantity)}`,event:{id:id(),type:'set_quantity' as const,lineId:line.id,quantity,expectedVersion:state.version}})),{label:say(state,'Other amount','வேறு எண்ணிக்கை','Vera quantity'),event:{id:id(),type:'edit_item',lineId:line.id,expectedVersion:state.version}}]};
  }
  if(line?.resolution==='unavailable'||line?.resolution==='needs_unit')return {...reply,buttons:[...(reply.buttons??[]).slice(0,2),flow('handoff','Talk to shop','கடையிடம் பேசு','Kadaiyila pesu')]};
  if(reply.cards?.length)return {...reply,buttons:[...(reply.buttons??[]),flow('options','More options','மேலும் தேர்வுகள்','Innum options')]};
  if(!reply.cards?.length&&!reply.buttons?.length&&!state.pending){
    if(state.draft.length)return {...reply,buttons:[{label:say(state,'Review list','பட்டியலைப் பார்','List paaru'),event:{id:id(),type:'review',expectedVersion:state.version}},flow('edit_list','Change an item','பொருளை மாற்று','Porulai maathu'),flow('handoff','Talk to shop','கடையிடம் பேசு','Kadaiyila pesu')]};
    return {...reply,buttons:[flow('browse','Browse items','பொருட்களைப் பார்','Porutkal paaru'),flow('help','Help me choose','உதவி வேண்டும்','Help venum'),flow('handoff','Talk to shop','கடையிடம் பேசு','Kadaiyila pesu')]};
  }
  return reply;
}
