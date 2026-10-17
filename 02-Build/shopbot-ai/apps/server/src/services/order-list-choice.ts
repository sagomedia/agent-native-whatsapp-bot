import type {PoolClient} from 'pg';
import type {ConversationState,RichReply} from '../../../../packages/contracts/index.js';
import {say} from '../../../../packages/contracts/language.js';
import {shoppingButton} from './shopping-flow.js';
import {orderReference} from './visual-ordering.js';
import type {ActorContext} from './context.js';

export async function canAddToOrder(client:PoolClient,ctx:ActorContext,state:ConversationState){
 const row=(await client.query('SELECT acceptance,fulfillment FROM order_requests WHERE id=$1 AND store_id=$2 AND conversation_id=$3 AND actor=$4',[state.lastRequestId,ctx.storeId,ctx.conversationId,ctx.actor])).rows[0];
 return !!row&&!['collected','cancelled'].includes(row.fulfillment)&&row.acceptance!=='rejected';
}
export function orderListChoice(state:ConversationState,canAdd:boolean,count?:number):RichReply {
 const noted=count?say(state,`${count} requested items saved.`,`${count} items குறிச்சுக்கிட்டேன்.`,`${count} items kurichchukkitten.`):'';
 const question=canAdd?say(state,'New list, or add to this order?','புது list வேணுமா, இந்த order-ல சேர்க்கணுமா?','Pudhu list venumaa, intha order-la serkkanumaa?'):say(state,'This order is closed. Start a new list?','இந்த order முடிஞ்சிருக்கு. புது list தொடங்கலாமா?','Intha order mudinjirukku. Pudhu list thodangalaamaa?');
 return {version:1,kind:'text',presentation:'text',outboundMessages:1,stage:'returning',clarificationReason:'order_list_choice',readOnly:true,text:[state.lastRequestId?orderReference(state.lastRequestId):'',noted,question].filter(Boolean).join('\n'),buttons:[shoppingButton(state,'new_list',say(state,'New list','புது list','Pudhu list')),...(canAdd?[shoppingButton(state,'continue_list',say(state,'Add to this order','இந்த order-ல சேர்','Intha order-la seru'))]:[])]};
}
export function askOrderItems(state:ConversationState):RichReply {
 return {version:1,kind:'text',presentation:'text',outboundMessages:1,readOnly:true,stage:'returning',text:say(state,'What should I add to this order? Send text or voice.','இந்த order-ல என்ன சேர்க்கணும்? Text அல்லது voice-ல சொல்லுங்க.','Intha order-la enna serkkanum? Text illa voice-la sollunga.')};
}
