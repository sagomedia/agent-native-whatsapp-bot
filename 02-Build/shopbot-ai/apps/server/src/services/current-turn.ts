import type {Operation,ConversationState} from '../../../../packages/contracts/index.js';
import {ToolError} from './context.js';
import {validateProductMeaningEvidence} from './product-meaning.js';
import {tokens} from '../../../../packages/contracts/catalog-text.js';
import {protectQuantityEvidence} from './quantity-evidence.js';
import {negatedSpokenClear} from './shopping-language.js';
import {amountEvidence} from './amount-edits.js';

export function submissionIntent(text:string):boolean {
 const value=text.trim().toLowerCase().replace(/[.!?,]+$/,'');
 // A complete short command, never a substring of a shopping correction.
 return /^(?:(?:ok(?:ay)?|seri|sari|சரி|ஓகே|perfect|yes)\s*[, ]*\s*)*(?:anup(?:p)?ir?lam|anuppalaam|anupalaam|அனுப்பலாம்|அனுப்பிரலாம்|அனுப்பிடலாம்|கடைக்கு அனுப்புங்க|kadaikku anupp(?:u|unga|irunga)|send (?:it|this|the order|my order|the list|my list)(?: to (?:the )?(?:shop|store))?|(?:place|submit|finish) (?:the |my )?order|(?:ஆர்டரை|ஆர்டர்) (?:பிளேஸ் பண்ணிடலாம்|பிளேஸ் பண்ணலாம்|போட்டுடலாம்|அனுப்புங்க)|(?:இந்த )?பட்டியலை(?:க்)? கடைக்கு அனுப்புங்க)(?:\s+(?:naan vandhu collect pannikkiren|நான் வந்து.*))?$/.test(value);
}
const negative=/(?:வேண்டாம்|வெண்டாம்|வேணாம்|வெனாம்|\b(?:venda(?:m)?|vendam|vena(?:am)?|venam|don't want|do not want|not needed)\b)/i;
const extra=/(?:மேலும்|இன்னும்|கூடுதலா|எக்ஸ்ட்ரா|\b(?:extra|additional|more|innum|kooduthal(?:a)?|melum)\b)/i;
export function validateCurrentTurn(operations:Operation[],description:string,state:ConversationState):Operation[] {
 validateProductMeaningEvidence(operations,description);
 const removals=operations.filter(op=>op.kind==='remove_item');
 if(removals.length&&(state.pending?.kind==='products'||state.pending?.kind==='question')){
  const focused=state.pending.kind==='question'?[state.pending.lineId]:state.pending.groups.map(g=>g.lineId);
  const focusedOnly=operations.length===1&&removals.length===1&&focused.includes(removals[0].reference);
  // Replacement plans are bound to the explicitly named item before mutation.
  // Keep that stronger binding check instead of treating a replace as a removal.
  const replacement=removals.length===1&&operations.length===2&&operations.some(op=>op.kind==='add_item');
  const clearThenAdd=/^clear my list[.!?,;: ]+(?:(?:yes|please|and|then) )*add\b/i.test(description)&&!negatedSpokenClear(description)&&removals.length===state.draft.length;
  if(!focusedOnly&&!replacement&&!clearThenAdd&&!namedRemovalsExplicit(operations,description,state))throw new ToolError('The removal targets need exact current-message evidence. Include supportingPhrase for each named removal; a refusal of photos must not remove the list.','interpretation_evidence');
 }

 const clauses=description.split(/[,;.!?\n]|\s+and\s+|\s+அடுத்து\s+/i).filter(Boolean);
 for(const op of operations){
  if((op.kind==='set_amount'||op.kind==='increment_amount')&&!amountEvidence(op,description))throw new ToolError('Use the exact measured amount and supporting phrase from the current message. Additional amounts need explicit extra wording.','interpretation_evidence');
  if('supportingPhrase' in op&&op.supportingPhrase&&!description.includes(op.supportingPhrase))throw new ToolError('Use the exact supporting phrase from the current message.','interpretation_evidence');
  if(op.kind==='increment_quantity'&&!extra.test(op.supportingPhrase))throw new ToolError('An increment requires an explicitly additional count.','interpretation_evidence');
  if(op.kind==='add_item'||op.kind==='resolve_line'){
   const evidence=op.supportingPhrase??(op.productIntent?.sourcePhrase);
   if(evidence&&negative.test(evidence))throw new ToolError('A negated product cannot be added or replaced.','interpretation_polarity');
   const name=op.kind==='add_item'?op.query:op.query??'';
   const words=name.toLowerCase().split(/\s+/).filter(w=>w.length>3);
   if(clauses.some(c=>negative.test(c)&&words.some(w=>c.toLowerCase().includes(w))))throw new ToolError('The customer declined this product; do not add it.','interpretation_polarity');
   if(/\bscrews?\b/i.test(name)&&/ஆணி/.test(evidence??description)&&!/(?:ஸ்க்ரூ|திருகு)/.test(evidence??description))throw new ToolError('Nails and screws are different products. Keep the requested nail.','interpretation_identity');
  }
  if(op.kind==='set_quantity'||op.kind==='resolve_line'&&op.quantity!==undefined){
   const phrase=op.supportingPhrase;
   if(phrase&&extra.test(phrase))throw new ToolError('Use increment_quantity for the explicitly additional amount.','interpretation_evidence');
  }
  if('reference' in op&&!state.draft.some(l=>l.id===op.reference))throw new ToolError('Choose the current item to change.','correction_target');
 }
 return protectQuantityEvidence(operations,description);
}

export function namedRemovalsExplicit(operations:Operation[],description:string,state:ConversationState):boolean {
 const words=tokens(description),lower=description.toLowerCase();
 return operations.filter(op=>op.kind==='remove_item').every(op=>{
  if(op.supportingPhrase&&description.includes(op.supportingPhrase))return true;
  const line=state.draft.find(l=>l.id===op.reference);if(!line)return false;
  const names=[line.query??'',line.name,...(line.candidates??[]).flatMap(p=>[...p.aliases,...Object.values(p.localNames??{})])].filter((n):n is string=>!!n);
  return names.some(name=>{
   if(lower.includes(name.toLowerCase()))return true;
   const core=tokens(name).filter(w=>!['missing','unavailable','unknown'].includes(w));
   return core.length>=2&&core.every(w=>words.includes(w));
  });
 });
}
