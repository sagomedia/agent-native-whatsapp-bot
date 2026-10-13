import type {Interpretation,Operation,ConversationState,DraftLine} from '../../../../packages/contracts/index.js';
import {normalize,sameUnit,tokens} from './catalog.js';
import {spokenMeasures,convertAmount,matchesProductMeasures} from './quantity-evidence.js';
const extra=/(?:மேலும்|இன்னும்|கூடுதலா|எக்ஸ்ட்ரா|\b(?:extra|additional|more|innum|kooduthal(?:a)?|melum)\b)/i;
const change=/(?:மட்டும்|வேணும்|வேண்டும்|மாற்ற|மாத்த|\b(?:only|instead|mattum|venum|maathu|change|make|set|need|want)\b)/i;
const identityChange=/\b(?:brand|diameter|colour|color|replace|different|another type)\b|பிராண்ட்|விட்டம்|நிறம்|வேறு வகை/i;
export const continuousAmount=(text:string)=>/\b(?:continuous|unbroken|single length)\b|ஒரே\s*(?:நீள|துண்டு)|ore\s+neelam/i.test(text);
const totalUnits=new Set(['m','foot','litre','ml','kg','g']);
function phraseAmount(text:string){return spokenMeasures(text).filter(m=>totalUnits.has(m.unit)).at(-1);}
function sameTarget(line:DraftLine,query?:string){const product=line.candidates?.find(p=>p.sku===line.sku),names=[line.sku,line.query,line.name,...product?.aliases??[]].filter((n):n is string=>!!n);if(!query||names.some(n=>normalize(n)===normalize(query)))return true;const words=tokens(query);return !!product&&words.length>0&&words.every(w=>names.some(n=>tokens(n).includes(w)));}
function namedLine(state:ConversationState,query:string){const lines=state.draft.filter(l=>sameTarget(l,query));return lines.length===1?lines[0]:undefined;}
// Recover the observed old plans without treating a pure price inquiry as an edit.
// Catalog facts and conversion remain backend responsibilities after this step.
export function normalizeAmountEdits(plan:Interpretation,text:string,state:ConversationState):Interpretation {
 if(state.lastRequestId||!state.draft.length||identityChange.test(text))return plan;
 const amount=phraseAmount(text),mode=continuousAmount(text)?'continuous' as const:'total' as const;
 let changed=false;
 let operations=plan.operations.map(op=>{
  if(op.kind!=='resolve_line')return op;
  const line=state.draft.find(l=>l.id===op.lineId);if(!line||!sameTarget(line,op.query))return op;
  const product=line.candidates?.find(p=>p.sku===line.sku);
  if(op.search?.brand&&normalize(op.search.brand)!==normalize(product?.brand??'')||op.search?.familyId&&op.search.familyId!==product?.familyId)return op;
  const fromUnit=op.quantity!==undefined&&op.requestedUnit?spokenMeasures(`${op.quantity} ${op.requestedUnit}`).find(m=>totalUnits.has(m.unit)):undefined;
  const fromFilter=op.search?.specifications?.length?spokenMeasures(op.search.specifications.length).find(m=>totalUnits.has(m.unit)):undefined;
  const wanted=op.requestedAmount??(op.productMeasures?.filter(m=>totalUnits.has(m.unit)).at(-1))??fromUnit??fromFilter;
  if(!wanted||!amount||convertAmount(amount,wanted.unit)===null||Math.abs(convertAmount(amount,wanted.unit)!-wanted.value)>1e-8)return op;
  const otherMeasures=op.productMeasures?.filter(m=>{const value=convertAmount(m,wanted.unit);return value===null||Math.abs(value-wanted.value)>1e-8;});
  if(product&&otherMeasures?.length&&!matchesProductMeasures(product,otherMeasures))return op;
  changed=true;const phrase=op.supportingPhrase&&text.includes(op.supportingPhrase)?op.supportingPhrase:text.slice(0,500);
  return extra.test(phrase)?{kind:'increment_amount' as const,reference:line.id,delta:wanted,supportingPhrase:phrase}:{kind:'set_amount' as const,reference:line.id,amount:wanted,mode,supportingPhrase:phrase};
 });
 const priceOnly=/\b(?:price only|only (?:the )?price|just (?:the )?price)\b|விலை மட்டும்|vilai mattum/i.test(text);
 const linkedChange=/\b(?:this|that|indha|intha|change|make|set|instead)\b|இந்த|இதை|மாற்ற|மாத்த/i.test(text);
 if(plan.next==='price'&&plan.priceQuery&&amount&&change.test(text)&&linkedChange&&!priceOnly&&!operations.length){
  const line=namedLine(state,plan.priceQuery);
  if(line&&plan.priceQuantity!==undefined&&plan.priceUnit&&sameUnit(plan.priceUnit,amount.unit)&&plan.priceQuantity===amount.value){
   operations=[{kind:'set_amount',reference:line.id,amount,mode,supportingPhrase:text.slice(0,500)}];changed=true;
  }
 }
 if(!changed)return plan;
 const {priceQuery,priceQuantity,priceUnit,...rest}=plan;
 return {...rest,operations,next:'review',estimateRequested:plan.estimateRequested||plan.next==='price'||/\bbill\b|பில்|மொத்தம்|calculate/i.test(text)};
}
export function amountEvidence(op:Extract<Operation,{kind:'set_amount'|'increment_amount'}>,text:string):boolean {
 const amount=op.kind==='set_amount'?op.amount:op.delta;
 return text.includes(op.supportingPhrase)&&spokenMeasures(op.supportingPhrase).some(m=>{const n=convertAmount(m,amount.unit);return n!==null&&Math.abs(n-amount.value)<1e-8;})&&(op.kind!=='increment_amount'||extra.test(op.supportingPhrase))&&(op.kind!=='set_amount'||op.mode!=='continuous'||continuousAmount(op.supportingPhrase));
}
