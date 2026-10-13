import type {ConversationState,Operation} from '../../../../packages/contracts/index.js';
import {referenceLine} from './tools.js';
import {quantityReply} from './shopping-language.js';
import {ToolError} from './context.js';

// An explicit replacement names its old item. A model-selected UUID must agree
// with that reference; otherwise keep the whole list and ask again.
export function bindExplicitCorrection(operations:Operation[],state:ConversationState,description:string):Operation[]{
 if(state.lastRequestId||!operations.some(op=>op.kind==='remove_item'||op.kind==='resolve_line'&&op.query))return operations;
 const named=/\b(?:replace|swap|change)\s+(?:(?:the|my|this)\s+)?(.+?)\s+(?:with|to|for)\s+/i.exec(description);
 if(!named||!operations.length)return operations;
 const following=description.slice((named.index??0)+named[0].length).split(/[,;.!?]|\band\b/i)[0].trim();
 if(quantityReply(following))return operations;
 const reference=named[1].replace(/^(?:only\s+)?(?:(?:the|my|this|that)\s+)?/i,'').replace(/\s+(?:item|product|back)$/i,'').trim();
 const focused=state.editingLineId??(state.pending?.kind==='question'?state.pending.lineId:undefined);
 let target;try{target=referenceLine(state,focused&&/^(?:this|it|that)$/i.test(reference)?focused:reference);}catch{throw new ToolError('Which listed item should be replaced? Choose its photo; your list is kept.','correction_target');}
 const resolve=operations.filter(op=>op.kind==='resolve_line');
 if(resolve.some(op=>op.lineId!==target.id))throw new ToolError('The proposed change did not match the item you named. Choose its photo; your list is kept.','correction_target');
 const removes=operations.filter(op=>op.kind==='remove_item'),adds=operations.filter(op=>op.kind==='add_item');
 if(removes.length){
  if(operations.length!==2||removes.length!==1||adds.length!==1||referenceLine(state,removes[0].reference).id!==target.id)throw new ToolError('The proposed replacement did not match the item you named. Choose its photo; your list is kept.','correction_target');
  const add=adds[0];return [{...add,kind:'resolve_line',lineId:target.id,quantity:add.quantity??undefined}];
 }
 if(!resolve.length)throw new ToolError('Choose the listed item to replace; your other items are kept.','correction_target');
 return operations;
}
