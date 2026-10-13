import type {ConversationState,DraftLine} from '../../../../packages/contracts/index.js';
import type {TurnUnderstanding} from '../../../../packages/contracts/understanding.js';
import {normalize,tokens} from '../../../../packages/contracts/catalog-text.js';
import {say,lineName} from '../../../../packages/contracts/language.js';
import {matchesProductMeasures,spokenMeasures,convertAmount,catalogPack} from '../services/quantity-evidence.js';
type Item=TurnUnderstanding['requestedItems'][number];
export const additionalMention=/(?:மேலும்|இன்னும்|கூடுதலா|எக்ஸ்ட்ரா|\b(?:extra|additional|more|innum|kooduthal(?:a)?|melum)\b)/i;
const repeatMention=/(?:ஆல்ரெடி|ஏற்கனவே|சொல்லிட்டேன்|அதே|\b(?:already|same|as i said|told you|sonnen|sollitten|adhe)\b)/i;
const correctionMention=/(?:இல்லை|இல்ல|\b(?:actually|sorry|correction|instead|no)\b)/i;
function identity(query:string){return tokens(normalize(query).replace(/\b\d+(?:\.\d+)?\s*(?:inch|inches|mm|cm|ml|litre|litres|kg|metre|metres|m)\b/g,' ')).join(' ');}
// These nouns name several physically different shop products. A one-word
// mention does not identify a previously selected type by itself.
const ambiguousHeads=new Set(['pipe','tube','hose']);
function ambiguousIdentity(query:string){const words=identity(query).split(' ');return words.length===1&&ambiguousHeads.has(words[0]);}
function refersToCurrentItem(item:Item,state:ConversationState,line:DraftLine){
 return repeatMention.test(item.sourceText)||correctionMention.test(item.sourceText)||state.editingLineId===line.id||state.pending?.kind==='question'&&state.pending.lineId===line.id||state.pending?.kind==='products'&&state.pending.groups.length===1&&state.pending.groups[0].lineId===line.id;
}
export function sameMention(a:string,b:string){
 const left=identity(a),right=identity(b);if(!left||!right)return false;
 if(left===right)return true;
 const l=left.split(' '),r=right.split(' ');
 return (l.length===1||r.length===1)&&l.at(-1)===r.at(-1);
}
// Include the spoken count and referential wording omitted by a terse sourceText.
// The result is always one literal substring, never reconstructed evidence.
export function mentionClause(source:string,phrase:string){
 const pieces=source.split(/[,;\n]|[.!?](?:\s|$)|\b(?:and|plus|next|then|aduthu|appuram)\b|அடுத்து|அப்புறம்|அதுக்கப்புறம்|அண்ட்|நெக்ஸ்ட்/iu);
 const hits=pieces.filter(p=>p.includes(phrase)),clause=hits[0]?.trim();return clause&&clause.length<=500?clause:phrase;
}
function compatibleItems(a:Item,b:Item){
 if(!a.query||!b.query||!sameMention(a.query,b.query))return false;
 for(const field of ['brand','colour','material'] as const)if(a[field]&&b[field]&&normalize(a[field]!)!==normalize(b[field]!))return false;
 if(a.packSize&&b.packSize&&convertAmount(b.packSize,a.packSize.unit)!==a.packSize.value)return false;
 for(const m of a.dimensions??[])for(const n of b.dimensions??[])if(m.role===n.role&&convertAmount(n,m.unit)!==m.value)return false;
 if(a.targetLineId&&b.targetLineId&&a.targetLineId!==b.targetLineId)return false;
 return true;
}
export function consolidateMentions(items:Item[],source:string,image:boolean):Item[]{
 if(image){if(items.some(i=>i.targetLineId!==undefined||i.sameItemOrdinal!==undefined||i.requestMode==='additional'))throw new Error('Images cannot edit existing lines or consolidate list rows');return items;}
 const result:Item[]=[],references=new Map<number,Item>();
 for(const raw of items){
  const item={...raw,sourceText:mentionClause(source,raw.sourceText)};
  // A self-reference says nothing about another row. Some providers include
  // it on an already consolidated item; discard it without changing evidence.
  if(item.sameItemOrdinal===item.ordinal)delete item.sameItemOrdinal;
  const location=source.indexOf(raw.sourceText),context=location<0?'':source.slice(location,location+raw.sourceText.length+70);
  const matches=result.filter(old=>compatibleItems(old,item));
  const old=item.sameItemOrdinal!==undefined?references.get(item.sameItemOrdinal):!additionalMention.test(item.sourceText)&&(repeatMention.test(context)||correctionMention.test(item.sourceText))&&matches.length===1?matches[0]:undefined;
  if(item.sameItemOrdinal!==undefined&&(!old||old.ordinal>=item.ordinal||!compatibleItems(old,item)))throw new Error('Repeated mention must reference a compatible earlier item');
  if(!old){result.push(item);references.set(item.ordinal,item);continue;}
  if(item.requestMode==='additional'||additionalMention.test(item.sourceText))throw new Error('Keep explicitly additional mentions separate from refinements');
  const changedCount=old.purchaseCount!==null&&item.purchaseCount!==null&&old.purchaseCount!==item.purchaseCount;
  if(changedCount&&!correctionMention.test(item.sourceText))throw new Error('Conflicting repeated counts need clarification');
  const dimensions=[...(old.dimensions??[])];for(const d of item.dimensions??[])if(!dimensions.some(m=>m.role===d.role&&convertAmount(d,m.unit)===m.value))dimensions.push(d);
  references.set(item.ordinal,old);
  Object.assign(old,{...item,ordinal:old.ordinal,sourceText:changedCount?item.sourceText:old.sourceText,query:identity(item.query!).split(' ').length>identity(old.query!).split(' ').length?item.query:old.query,purchaseCount:changedCount?item.purchaseCount:old.purchaseCount??item.purchaseCount,targetLineId:old.targetLineId??item.targetLineId,packSize:old.packSize??item.packSize,dimensions:dimensions.length?dimensions:undefined,unresolved:[...new Set([...old.unresolved,...item.unresolved])]});
 }
 return result;
}
export function compatibleLine(item:Item,line:DraftLine){
 const product=line.candidates?.find(p=>p.sku===line.sku);
 if(!item.query||![line.query??line.name,product?.name,...(product?.aliases??[]),...Object.values(product?.localNames??{})].some(name=>name&&sameMention(item.query!,name)))return false;
 // A shared head noun is insufficient when the new request contains a brand,
 // material or use qualifier. Those words can be in query even when the model
 // leaves the structured fields empty. Keep the old SKU only if its catalog
 // identity actually supports every such word.
 const known=new Set([line.query,line.name,line.sku,product?.name,product?.brand,...(product?.aliases??[]),...(product?.keywords??[]),...Object.values(product?.localNames??{})].filter((name):name is string=>!!name).flatMap(name=>identity(name).split(' ')));
 if(identity(item.query).split(' ').some(word=>!known.has(word)))return false;
 const named=normalize([line.query,line.name,product?.brand,...Object.values(product?.specifications??{})].filter(Boolean).join(' '));
 if([item.brand,item.colour,item.material].some(value=>value&&!named.includes(normalize(value))))return false;
 const dimensions=item.dimensions??spokenMeasures(item.query);
 if(product&&dimensions.length&&!matchesProductMeasures(product,dimensions))return false;
 const pack=line.packSize??(product?catalogPack(product):undefined);
 if(pack&&item.packSize&&convertAmount(item.packSize,pack.unit)!==pack.value)return false;
 return true;
}
export function existingMention(item:Item,state:ConversationState):{line?:DraftLine;clarify?:string}{
 if(item.targetLineId){
  const line=state.draft.find(l=>l.id===item.targetLineId);if(!line)throw new Error('Repeated item target is not current');
  if(!refersToCurrentItem(item,state,line)){
   if(!compatibleLine(item,line))return {};
   if(item.query&&ambiguousIdentity(item.query))return {clarify:say(state,`Do you mean your existing ${lineName(line,state)}, or a different ${item.query}?`,`ஏற்கனவே உள்ள ${lineName(line,state)}-ஐ சொல்கிறீர்களா, வேறு ${item.query} வேண்டுமா?`,`Irukkura ${lineName(line,state)}-a solreengala, vera ${item.query} venuma?`)};
  }
  return {line};
 }
 const lines=state.draft.filter(l=>compatibleLine(item,l));
 if(lines.length>1)return {clarify:say(state,`Which existing item should change: ${lines.map(l=>`${state.draft.indexOf(l)+1}. ${lineName(l,state)}`).join('; ')}?`,`எந்தப் பொருளை மாற்றணும்: ${lines.map(l=>`${state.draft.indexOf(l)+1}. ${lineName(l,state)}`).join('; ')}?`,`Entha porulai maathanum: ${lines.map(l=>`${state.draft.indexOf(l)+1}. ${lineName(l,state)}`).join('; ')}?`)};
 if(lines.length===1&&item.query&&ambiguousIdentity(item.query)&&!refersToCurrentItem(item,state,lines[0]))return {clarify:say(state,`Do you mean your existing ${lineName(lines[0],state)}, or a different ${item.query}?`,`ஏற்கனவே உள்ள ${lineName(lines[0],state)}-ஐ சொல்கிறீர்களா, வேறு ${item.query} வேண்டுமா?`,`Irukkura ${lineName(lines[0],state)}-a solreengala, vera ${item.query} venuma?`)};
 if(!lines.length&&item.query){
  // A correction may change the type entirely. It can replace one clearly
  // referenced pipe line, but a new BSA/pump pipe without correction remains
  // a separate request even when another pipe is already on the list.
  const related=state.draft.filter(line=>sameMention(item.query!,line.query??line.name)&&refersToCurrentItem(item,state,line));
  if(related.length===1)return {line:related[0]};
  if(related.length>1)return {clarify:say(state,'Which existing item should I change?','ஏற்கனவே உள்ள எந்தப் பொருளை மாற்றணும்?','Irukkura entha porulai maathanum?')};
 }
 return {line:lines[0]};
}
