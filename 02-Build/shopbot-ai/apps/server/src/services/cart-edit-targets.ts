import type {ConversationState,DraftLine} from '../../../../packages/contracts/index.js';
import type {TurnUnderstanding} from '../../../../packages/contracts/understanding.js';
import {namedEditLines,editIdentityWords,editMeasuresMatch,editIdentityMatches,editObjectWords,editNormalizedText} from '../adapters/mention-reconciliation.js';

// Attribute-only corrections preserve the selected product noun and dimensions.
// Only a positive material after an explicit this/it reference is accepted here.
export function materialOnlyCorrection(edit:TurnUnderstanding['proposedEdits'][number]):string|undefined {
 if(edit.kind!=='replace'||editObjectWords(edit.sourceText).length||!/(?:இல்ல|\b(?:not|instead|change|make)\b)/iu.test(edit.sourceText))return;
 const text=editNormalizedText(edit.sourceText);
 const matches=[...text.matchAll(/(?:\b(?:this|it)(?:\s+(?:is|to))?|இது)\s+(?:an?\s+)?(stainless steel|aluminium|aluminum|steel|brass|copper|plastic|wood)(?![\p{L}])/giu)];
 const last=matches.at(-1);if(!last||/^\s+(?:(?:is|பொருள்)\s+)?(?:not\b|இல்ல|வேண்டாம்)/iu.test(text.slice(last.index!+last[0].length)))return;
 return last[1].toLowerCase().replace('aluminum','aluminium');
}
export function materialEditFocus(edit:TurnUnderstanding['proposedEdits'][number],state:ConversationState):DraftLine|undefined {
 const material=materialOnlyCorrection(edit),focused=state.editingLineId??state.activeItemId;
 if(!material||!focused)return;
 const line=state.draft.find(line=>line.id===focused);if(!line)return;
 const old=[...editNormalizedText(edit.sourceText).matchAll(/\b(stainless steel|aluminium|aluminum|steel|brass|copper|plastic|wood)\b/giu)].map(m=>m[1]).filter(value=>value!==material);
 const identity=editNormalizedText(line.query??line.name);
 return !old.length||old.some(value=>identity.includes(value))?line:undefined;
}
export function materialReplacementQuery(query:string,material:string):string {
 return material+' '+editNormalizedText(query).replace(/\b(?:stainless\s+steel|aluminium|aluminum|steel|brass|copper|plastic|wood)\b/giu,' ').replace(/\s+/g,' ').trim();
}
export function cartEditCandidates(edit:TurnUnderstanding['proposedEdits'][number],state:ConversationState):DraftLine[]{
 const focused=materialEditFocus(edit,state);if(focused)return [focused];
 const oldName=edit.kind==='replace'?/\b(?:replace|swap|change)\s+(?:(?:the|my|this)\s+)?(.+?)\s+(?:with|to|for)\b/i.exec(edit.sourceText)?.[1]??/^(.+?\b(?:item|line|entry|row))\s+(?:is|to)\b/i.exec(edit.sourceText)?.[1]:undefined;
 const ignoreMeasures=['set_amount','increment_amount'].includes(edit.kind)||edit.kind==='replace'&&!oldName;
 const literal=namedEditLines(oldName??edit.sourceText,state,{ignoreMeasures});
 // A normalized target name helps across languages; it cannot narrow an
 // already ambiguous literal noun to whichever ID the model happened to pick.
 if(literal.length)return literal;
 if(/\b(?:first|second|third|fourth|fifth|last|[1-9]|10)(?:st|nd|rd|th)?\s+(?:item|line|product|entry|row)\b|கடைசி|லாஸ்ட்/iu.test(oldName??edit.sourceText))return [];
 return edit.targetQuery&&editIdentityWords(edit.targetQuery).length?namedEditLines(edit.targetQuery,state).filter(line=>editIdentityMatches(oldName??edit.sourceText,line)&&(ignoreMeasures||editMeasuresMatch(oldName??edit.sourceText,line))):[];
}
