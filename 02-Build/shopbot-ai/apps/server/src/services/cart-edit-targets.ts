import type {ConversationState,DraftLine} from '../../../../packages/contracts/index.js';
import type {TurnUnderstanding} from '../../../../packages/contracts/understanding.js';
import {namedEditLines,editIdentityWords,editMeasuresMatch,editIdentityMatches} from '../adapters/mention-reconciliation.js';

export function cartEditCandidates(edit:TurnUnderstanding['proposedEdits'][number],state:ConversationState):DraftLine[]{
 const oldName=edit.kind==='replace'?/\b(?:replace|swap|change)\s+(?:(?:the|my|this)\s+)?(.+?)\s+(?:with|to|for)\b/i.exec(edit.sourceText)?.[1]??/^(.+?\b(?:item|line|entry|row))\s+(?:is|to)\b/i.exec(edit.sourceText)?.[1]:undefined;
 const ignoreMeasures=['set_amount','increment_amount'].includes(edit.kind)||edit.kind==='replace'&&!oldName;
 const literal=namedEditLines(oldName??edit.sourceText,state,{ignoreMeasures});
 // A normalized target name helps across languages; it cannot narrow an
 // already ambiguous literal noun to whichever ID the model happened to pick.
 if(literal.length)return literal;
 if(/\b(?:first|second|third|fourth|fifth|last|[1-9]|10)(?:st|nd|rd|th)?\s+(?:item|line|product|entry|row)\b|கடைசி|லாஸ்ட்/iu.test(oldName??edit.sourceText))return [];
 return edit.targetQuery&&editIdentityWords(edit.targetQuery).length?namedEditLines(edit.targetQuery,state).filter(line=>editIdentityMatches(oldName??edit.sourceText,line)&&(ignoreMeasures||editMeasuresMatch(oldName??edit.sourceText,line))):[];
}
