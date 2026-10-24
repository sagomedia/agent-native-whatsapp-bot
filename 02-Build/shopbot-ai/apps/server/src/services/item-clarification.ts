import {createHash} from 'node:crypto';
import type {ConversationState,DraftLine} from '../../../../packages/contracts/index.js';

function signature(line:DraftLine):string {
 return createHash('sha256').update(JSON.stringify([line.query,line.sku,line.quantity,line.requestedUnit,line.packSize,line.productMeasures,line.discovery?.plan.brand,line.discovery?.plan.specifications])).digest('hex');
}
/** Count actual unsuccessful conversational replies, never internal searches,
 * delivery retries, other cart lines, or newly supplied item details. */
export function trackItemClarification(before:ConversationState,after:ConversationState,targetId?:string):boolean {
 const focused=targetId??(after.pending?.kind==='question'?after.pending.lineId:after.pending?.kind==='products'?after.pending.groups.find(g=>!after.draft.find(l=>l.id===g.lineId)?.sku)?.lineId:undefined);
 const line=after.draft.find(l=>l.id===focused)??after.draft.find(l=>!l.sku&&!l.shopCheckDeferred);
 if(!line||line.sku||line.resolution==='matched'||after.lastRequestId)return false;
 const previous=before.draft.find(l=>l.id===line.id),key=signature(line);
 const turns=previous&&signature(previous)===key?(previous.clarification?.unproductiveTurns??0)+1:0;
 line.clarification={signature:key,unproductiveTurns:turns};
 return true;
}
