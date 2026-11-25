import {listRecoverySchema,type ListRecovery,type TurnUnderstanding} from '../../../../packages/contracts/understanding.js';
import type {ConversationState,Interpretation} from '../../../../packages/contracts/index.js';
import {say} from '../../../../packages/contracts/language.js';
import {understandingToInterpretation} from '../adapters/turn-understanding.js';
import type {InterpretationInput} from '../adapters/interpreter.js';

function independentAdds(plan:TurnUnderstanding){
  return plan.intents.length===1&&plan.intents[0]==='add'&&!plan.proposedEdits.length&&!plan.shopQuestions.length&&!plan.unresolved.length&&!plan.explicitLanguageRequest&&
    !plan.keepOnly&&!plan.keepOnlyAnswer&&!plan.cartGroupAnswer&&!plan.cartTargetAnswer&&
    plan.requestedItems.every(row=>!row.crossedOut&&!row.targetLineId&&row.sameItemOrdinal===undefined&&row.requestMode!=='additional');
}

function compile(list:ListRecovery,input:InterpretationInput):Interpretation{
  const requestedItems=list.rows.flatMap((row,ordinal)=>row?[{...row,ordinal}]:[]);
  const proposal:TurnUnderstanding={schemaVersion:2,inputKind:'text',intents:['add'],requestedItems,proposedEdits:[],unresolved:[],shopQuestions:[]};
  return understandingToInterpretation(proposal,{...input,text:list.evidence,audio:undefined,voiceTranscript:list.fromVoice,proposal:undefined},false);
}

export function recoverListLines(plan:TurnUnderstanding,input:InterpretationInput):ListRecovery|undefined{
  if(!independentAdds(plan)||plan.requestedItems.length<2||plan.requestedItems.some((row,i,rows)=>i>0&&row.ordinal<=rows[i-1].ordinal))return;
  const rows=plan.requestedItems.map(row=>input.text.includes(row.sourceText)?row:null);
  if(rows.every(Boolean)||rows.every(row=>!row))return;
  const list={fromVoice:!!(input.audio||input.voiceTranscript),evidence:input.text,rows};
  // Validate retained rows against the whole utterance, including surrounding negations.
  try{
    const checked=compile(list,input);
    if(checked.operations.length!==rows.filter(Boolean).length||checked.operations.some(op=>op.kind!=='add_item'))return;
    return list;
  }catch{return;}
}

export function correctListLine(list:ListRecovery,answer:Interpretation,input:InterpretationInput){
  const plan=answer.understanding,position=list.rows.indexOf(null);
  if(position<0||!plan||!independentAdds(plan)||plan.requestedItems.length!==1||
     answer.operations.length!==1||answer.operations[0].kind!=='add_item'||!input.text.includes(plan.requestedItems[0].sourceText))return;
  const rows=list.rows.slice();
  rows[position]=plan.requestedItems[0];
  const updated={...list,rows,evidence:list.evidence+'\n'+input.text};
  if(!listRecoverySchema.safeParse(updated).success)return;
  let compiled:Interpretation;
  try{compiled=compile(updated,input);}catch{return;}
  if(compiled.operations.length!==rows.filter(Boolean).length||compiled.operations.some(op=>op.kind!=='add_item'))return;
  return {updated,completed:rows.every(Boolean)?compiled:undefined};
}

export function listLineQuestion(list:ListRecovery,state:ConversationState){
  const position=list.rows.indexOf(null),total=list.rows.length,kept=list.rows.filter(Boolean).length;
  return say(state,`I’ve kept ${kept} of ${total} items for checking. What is item ${position+1}, and how many do you need?`,
    `${total} பொருட்களில் ${kept} பொருட்களைக் குறித்து வைத்துள்ளேன். ${position+1}-வது பொருளின் பெயரும் அளவும் மட்டும் சொல்லுங்கள்.`,
    `${total} porutkalil ${kept} kurichu vechchirukken. ${position+1}-aavathu porul peyarum alavum mattum sollunga.`);
}
