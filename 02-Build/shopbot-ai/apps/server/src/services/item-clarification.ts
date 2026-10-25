import {createHash} from 'node:crypto';
import type {ConversationState,DraftLine} from '../../../../packages/contracts/index.js';

function signature(line:DraftLine):string {
 return createHash('sha256').update(JSON.stringify([line.query,line.sku,line.quantity,line.requestedUnit,line.packSize,line.productMeasures,line.discovery?.plan.brand,line.discovery?.plan.specifications,line.resolution,(line.candidates??[]).map(p=>[p.sku,p.version]).sort()])).digest('hex');
}
/** Count actual unsuccessful conversational replies, never internal searches,
 * delivery retries, other cart lines, or newly supplied item details. */
export function trackItemClarification(before:ConversationState,after:ConversationState,targetId?:string):boolean {
 const focused=targetId??(before.pending?.kind==='question'?before.pending.lineId:before.pending?.kind==='products'&&before.pending.groups.length===1?before.pending.groups[0].lineId:undefined);
 const line=after.draft.find(l=>l.id===focused);
 if(!line||line.sku||line.resolution==='matched'||after.lastRequestId)return false;
 const previous=before.draft.find(l=>l.id===line.id),key=signature(line);
 const turns=previous&&signature(previous)===key?(previous.clarification?.unproductiveTurns??0)+1:0;
 line.clarification={signature:key,unproductiveTurns:turns};
 return true;
}
