import type {PoolClient} from 'pg';
import type {ConversationState} from '../../../../packages/contracts/index.js';
import {say} from '../../../../packages/contracts/language.js';
import {ToolError,type ActorContext} from './context.js';

export async function requestStoreAssistance(client:PoolClient,ctx:ActorContext,state:ConversationState,expectedVersion:number) {
 if(state.version!==expectedVersion)throw new ToolError('Your list changed. Please use the latest choices.','stale_version');
 await client.query("UPDATE conversations SET operator_mode='owner',handoff_requested=true,editing_line_id=NULL,operator_revision=operator_revision+CASE WHEN handoff_requested THEN 0 ELSE 1 END WHERE id=$1 AND store_id=$2 AND actor=$3",[ctx.conversationId,ctx.storeId,ctx.actor]);
 await client.query("UPDATE whatsapp_outbox SET state='cancelled',last_error='customer_handoff' WHERE conversation_id=$1 AND state='queued' AND sender_kind='assistant'",[ctx.conversationId]);
 await client.query("UPDATE messages SET status='cancelled' WHERE id IN (SELECT message_id FROM whatsapp_outbox WHERE conversation_id=$1 AND state='cancelled')",[ctx.conversationId]);
 return {state:{...state,handoffRequested:true,editingLineId:null},handoffRequested:true as const,message:say(state,'Shop assistance requested. Your list is with the store. They will confirm the remaining details and reply here.','உங்கள் பட்டியலும் உதவிக் கோரிக்கையும் கடைக்கு அனுப்பியாச்சு. மீதமுள்ள விவரங்களைக் கடை சரிபார்த்து இங்கே பதில் தரும்.','Unga list-um udhavi request-um kadaikku anuppiyaachu. Meethi vivarangalai kadai check panni ingeye bathil tharum.')};
}
