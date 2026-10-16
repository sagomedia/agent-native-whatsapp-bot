import type {ConversationState,RichReply,OrderRequest} from '../../../../packages/contracts/index.js';
import {counterLine,nextCounterLine} from './counter-state.js';

// One derived decision shared by action selection and visual presentation.
// It grants no write permissions; the versioned retail tools remain authoritative.
export function planReply(reply:RichReply,state:ConversationState,request?:OrderRequest|null){
 const line=state.draft.find(l=>l.id===state.editingLineId)
   ??(state.pending?.kind==='question'?state.draft.find(l=>l.id===(state.pending as {lineId:string}).lineId):undefined)
   ??nextCounterLine(state);
 const purpose=reply.readOnly?'read_only':reply.stage==='error'?'error':reply.handoffRequested||state.handoffRequested?'shop_help':request?'request_status':state.editingLineId?'correction':reply.stage==='returning'?'returning':reply.stage==='identify'&&reply.cards?.length?'discovery':state.pending?.kind==='review'?'bill':state.pending?.kind==='products'?'product_review':state.pending?.kind==='question'?'clarification':'conversation';
 return {purpose,line,facts:line?counterLine(line):null,mayOfferSubmission:purpose==='bill'&&state.draft.length>0&&(state.pending?.kind==='review'&&!!state.pending.excludedLineIds||state.draft.every(l=>{const f=counterLine(l);return f.canQuote&&(!state.requireProductConfirmation||f.ready);}))};
}
