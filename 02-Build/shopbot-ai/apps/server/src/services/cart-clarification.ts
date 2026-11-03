import type {ConversationState,DraftLine} from '../../../../packages/contracts/index.js';
import type {TurnUnderstanding} from '../../../../packages/contracts/understanding.js';
import {say,lineName} from '../../../../packages/contracts/language.js';
import type {AssistantMemory} from './agent-assistance.js';

export function totalQuantityQuestion(state:ConversationState,line:DraftLine):string {
 const name=lineName(line,state);
 const current=line.quantity===null?'':say(state,` Current count: ${line.quantity}.`,` இப்போது ${line.quantity} இருக்கு.`,` Ippo ${line.quantity} irukku.`);
 return say(state,`${name}.${current} How many do you want in total?`,`${name}.${current} மொத்தம் எத்தனை வேணும்?`,`${name}.${current} Moththam eththanai venum?`);
}

/** Render the missing decision from typed actions and actual current rows. */
export function cartTargetQuestion(state:ConversationState,lines:DraftLine[],edit?:TurnUnderstanding['proposedEdits'][number]):string {
 const names=lines.slice(0,4).map(line=>lineName(line,state)).join(' / ');
 const subject=names||say(state,'your listed items','பட்டியலில் உள்ள பொருட்கள்','list-la irukkura porutkal');
 if(edit?.kind==='remove_item')return say(state,`Which should I remove: ${subject}?`,`எதை நீக்கணும்: ${subject}?`,`Ethai neekkanum: ${subject}?`);
 if(edit?.kind==='replace')return say(state,`Which should I replace with ${edit.query}: ${subject}?`,`${edit.query} வேணும்னு சொன்னீங்க. எதை மாற்றணும்: ${subject}?`,`${edit.query} venum-nu sonneenga. Ethai maathanum: ${subject}?`);
 if(edit?.quantity!==undefined)return say(state,`Which item should I ${edit.kind==='increment_quantity'?'increase by':'set to'} ${edit.quantity}: ${subject}?`,`${edit.quantity} ${edit.kind==='increment_quantity'?'கூடுதலாக சேர்க்க':'மொத்தமாக மாற்ற'} எந்தப் பொருள்: ${subject}?`,`${edit.quantity} ${edit.kind==='increment_quantity'?'kooduthala serkka':'moththama maatha'} entha porul: ${subject}?`);
 return say(state,`Which item do you mean: ${subject}?`,`எந்தப் பொருளைச் சொல்றீங்க: ${subject}?`,`Entha porulai solreenga: ${subject}?`);
}

/** Rejected proposals may explain a question, but never authorize a write. */
export function rejectedPlanQuestion(state:ConversationState,proposal?:TurnUnderstanding):string {
 const edit=proposal?.proposedEdits[0];
 if(edit&&state.draft.length)return cartTargetQuestion(state,state.draft,edit);
 const item=proposal?.requestedItems.find(item=>item.query);
 if(item){
  const requested=`${item.purchaseCount===null?'':item.purchaseCount+' × '}${item.query!.slice(0,80)}`;
  return state.draft.length?say(state,`Is ${requested} a new item, or a change to a listed item?`,`${requested} புதிய பொருளா, பட்டியலில் உள்ள பொருளை மாற்றணுமா?`,`${requested} pudhu porula, list-la irukkura porulai maathanuma?`):say(state,`Start a new request for ${requested}?`,`${requested} புதிய கோரிக்கையாக சேர்க்கணுமா?`,`${requested} pudhu request-aa serkkanuma?`);
 }
 return cartTargetQuestion(state,state.draft);
}

/** A group answer covers exactly one offered removal scope, never the cart. */
export function offeredRemovalGroup(memory:AssistantMemory|null|undefined,state:ConversationState):string[] {
 const goal=memory?.cartEdit;
 if(memory?.purpose!=='cart_edit'||memory.sourceVersion!==state.version||!goal||goal.targets.length!==1||goal.understanding.requestedItems.length||goal.understanding.proposedEdits.length!==1)return [];
 const target=goal.targets[0];
 if(target.kind!=='edit'||goal.understanding.proposedEdits[target.index]?.kind!=='remove_item'||target.candidateLineIds.length<2||target.candidateLineIds.length>10)return [];
 return target.candidateLineIds.every(id=>state.draft.some(line=>line.id===id))?[...target.candidateLineIds]:[];
}
