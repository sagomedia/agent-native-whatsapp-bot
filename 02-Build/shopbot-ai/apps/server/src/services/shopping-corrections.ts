import type {ConversationState,Operation,DraftLine} from '../../../../packages/contracts/index.js';
import type {TurnUnderstanding} from '../../../../packages/contracts/understanding.js';
import {compatibleLine,namedEditLines} from '../adapters/mention-reconciliation.js';
import {say} from '../../../../packages/contracts/language.js';
import {referenceLine} from './tools.js';
import {quantityReply} from './shopping-language.js';
import {ToolError} from './context.js';
import {tokens} from '../../../../packages/contracts/catalog-text.js';

export type KeepSelection={targetIndex:number;lineId:string};
const negatedAction=/\b(?:do not|don't|never)\s+(?:keep|retain|leave|remove|delete|drop)|(?:நீக்க|எடுக்க|எடுத்துர|காலி|வைங்க|வைக்க|வைத்திரு|வச்சிரு).{0,16}(?:வேண்டாம்|வேணாம்)/iu;
function sourceContexts(description:string,source:string):{clause:string;fromSource:string}[]{
 const result:{clause:string;fromSource:string}[]=[];
 for(let start=description.indexOf(source);start>=0;start=description.indexOf(source,start+1)){
  const prefix=description.slice(0,start),end=start+source.length,suffix=description.slice(end);
  const before=prefix.split(/[;.!?\n]/u).at(-1)??'';
  result.push({clause:before+source+suffix.split(/[;.!?\n]/u)[0],fromSource:description.slice(start)});
 }
 return result;
}
function revokedKeep(source:string):boolean {
 return /\b(?:keep|retain|leave)\s+(?:(?:the|my)\s+)?(?:everything|all\s+(?:items|products|entries|of them)|(?:whole|entire)\s+list)\b|\b(?:cancel|forget|ignore)\s+(?:that|this|the correction)\b|\b(?:no|wait|actually|instead)\s*[,;.!?]?\s*(?:keep|retain|leave|don't|do not)\b|(?:எல்லாத்தையும்|எல்லாவற்றையும்|எல்லா\s*பொருட்களையும்|எல்லாம்)[\s\S]{0,35}(?:வச்ச|வைத்த|வைங்க|இருக்கட்டும்)|(?:இல்லை|இல்ல)\s*[,;.!?]?\s*(?:வேண்டாம்|வேணாம்|எல்லா)|(?:மட்டும்[\s\S]{0,35}(?:வைங்க|வைக்க|வைத்திரு|வச்சிரு)[\s\S]{0,16}(?:வேண்டாம்|வேணாம்))/iu.test(source);
}
// This vocabulary checks the scope of a structured proposal. Product identity
// and the keep set still come from the current grounded understanding and IDs.
export function keepOnlyIntent(source:string):boolean {
 if(negatedAction.test(source))return false;
 return /\b(?:keep|retain|leave)\b[\s\S]*\bonly\b|\bonly\b[\s\S]*\b(?:keep|retain|leave)\b|\b(?:remove|delete|drop)\b[\s\S]*\b(?:the rest|everything else|all other)\b|மட்டும்[\s\S]*(?:போதும்|வேணும்|வேண்டும்|வை|வச்சு)|(?:மற்ற|மத்த|மீத)[\s\S]*(?:நீக்க|எடு|வேண்டாம்|வேணாம்)/iu.test(source);
}
export function keepTargetCandidates(target:NonNullable<TurnUnderstanding['keepOnly']>['targets'][number],state:ConversationState):DraftLine[]{
 const named=namedEditLines(target.sourceText,state);
 const compatible=state.draft.filter(line=>compatibleLine({ordinal:0,sourceText:target.sourceText,query:target.query,purchaseCount:null,unresolved:[]},line));
 // A precise row reference can distinguish two equal SKUs without merging
 // their counts. Otherwise every matching identity remains a separate choice.
 return named.length===1&&compatible.some(line=>line.id===named[0].id)?named:compatible;
}
function repeatedEntryKeeper(target:NonNullable<TurnUnderstanding['keepOnly']>['targets'][number],choices:DraftLine[],description:string):string|undefined {
 const evidence=target.duplicateSourceText;
 const generic=new Set(['this','that','it','one','item','entry','line','product','இந்த','அந்த','இது','அது','ஒரு','ஒன்று','பொருள்']);
 const meaningful=tokens(target.sourceText).some(word=>word.length>2&&!generic.has(word)&&!/^\d/.test(word));
 if(!evidence||!meaningful||!evidence.includes(target.sourceText)||!/\b(?:duplicate|repeated|twice|two entries|two times)\b|(?:ரெண்டு|இரண்டு)\s*(?:தடவை|முறை)|இருமுறை/iu.test(evidence)||!/\b(?:remove|delete|drop)\b|நீக்க|எடுத்த|எடு/iu.test(evidence))return;
 const contexts=sourceContexts(description,evidence);
 if(!contexts.length||contexts.some(context=>negatedAction.test(context.clause)||revokedKeep(context.fromSource)))return;
 if(choices.length<2||!choices[0].sku||choices.some(line=>line.sku!==choices[0].sku))return;
 const measures=(line:DraftLine)=>JSON.stringify({packSize:line.packSize,productMeasures:line.productMeasures,requestedAmount:line.requestedAmount,requestedUnit:line.requestedUnit,specifications:line.candidates?.find(product=>product.sku===line.sku)?.specifications});
 if(choices.some(line=>measures(line)!==measures(choices[0])))return;
 const known=choices.filter(line=>line.quantity!==null);
 // Never sum, default or overwrite a count during duplicate-entry cleanup.
 if(known.length===1)return known[0].id;
 if(known.length&&known.every(line=>line.quantity===known[0].quantity))return known[0].id;
 return;
}
export function compileKeepOnly(keep:NonNullable<TurnUnderstanding['keepOnly']>,state:ConversationState,description:string,selections:KeepSelection[]=[]):{operations:Operation[];targetIndex?:number;choices?:DraftLine[];question?:string}{
 const contexts=sourceContexts(description,keep.sourceText);
 if(state.lastRequestId||!contexts.length||!keepOnlyIntent(keep.sourceText)||contexts.some(context=>negatedAction.test(context.clause)||revokedKeep(context.fromSource))||keep.sourceText.includes('?')||description.slice(description.indexOf(keep.sourceText)+keep.sourceText.length).trimStart().startsWith('?'))throw new ToolError('The keep-only instruction needs explicit current-message evidence. Your list is kept.','correction_evidence');
 if(!keep.complete)return {operations:[],question:say(state,'Which items should I keep? Tell me the complete keep list; your current list is kept.','எந்தெந்தப் பொருட்களை மட்டும் வைத்திருக்கணும்? முழுவதையும் சொல்லுங்கள். தற்போதைய பட்டியல் அப்படியே உள்ளது.','Enthentha porutkalai mattum vechchukkanum? Muzhu list-ai sollunga. Ippothaiya list appadiye irukku.')};
 const keepIds=new Set<string>();let unresolved:{targetIndex:number;choices:DraftLine[]}|undefined;
 for(const [targetIndex,target] of keep.targets.entries()){
  if(!description.includes(target.sourceText))throw new ToolError('The kept item needs exact source evidence.','correction_evidence');
  if(target.targetLineId&&!state.draft.some(line=>line.id===target.targetLineId))throw new ToolError('The keep list changed. Describe the current items again.','stale_version');
  const choices=keepTargetCandidates(target,state),selected=selections.find(selection=>selection.targetIndex===targetIndex);
  const repeated=!selected?repeatedEntryKeeper(target,choices,description):undefined;
  const id=selected?.lineId??repeated??target.targetLineId;
  if(id&&!state.draft.some(line=>line.id===id))throw new ToolError('The keep list changed. Describe the current items again.','stale_version');
  if(selected&&!choices.some(line=>line.id===selected.lineId))throw new ToolError('Choose one of the current keep-item choices.','stale_question');
  if(!id||!choices.some(line=>line.id===id)||choices.length!==1&&!selected&&!repeated){unresolved??={targetIndex,choices};continue;}
  if(keepIds.has(id))throw new ToolError('The same line was included twice in the keep list. Your list is kept.','correction_evidence');
  keepIds.add(id);
 }
 if(unresolved){const name=keep.targets[unresolved.targetIndex].sourceText;return {operations:[],...unresolved,question:say(state,`Which “${name}” should I keep? The linked changes will be saved together.`,`“${name}” எந்தப் பொருள்? தேர்வு முடிந்ததும் மாற்றங்களை ஒன்றாகச் செய்கிறேன்.`,`“${name}” entha porul? Choose panninathum maaththangalai onna seyyuren.`).slice(0,180)};}
 return {operations:state.draft.filter(line=>!keepIds.has(line.id)).map(line=>({kind:'remove_item',reference:line.id,supportingPhrase:keep.sourceText}))};
}

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
