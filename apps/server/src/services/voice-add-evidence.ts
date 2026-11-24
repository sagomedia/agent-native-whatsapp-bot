import {additionalMention,mutationNegated,negativeProductMention} from '../../../../packages/contracts/intent-language.js';
import type {TurnUnderstanding} from '../../../../packages/contracts/understanding.js';
import {convertAmount,countExpressionIsMeasurement,explicitPurchaseCount,spokenMeasures} from './quantity-evidence.js';

type Item=TurnUnderstanding['requestedItems'][number];
type Span={start:number;end:number};

function wordSpans(text:string,phrase:string):Span[]{
 const escaped=phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const whole=new RegExp('(?<![\\p{L}\\p{M}\\p{N}])'+escaped+'(?![\\p{L}\\p{M}\\p{N}])','gu');
 return [...text.matchAll(whole)].map(m=>({start:m.index,end:m.index+m[0].length}));
}
const clauseBoundary=/[,;!?\n]|\s+(?:and|but|next|then|plus|அடுத்து|அப்புறம்|ஆனா)\s+/iu;
function clauseFor(source:string,span:Span){
 const before=source.slice(0,span.start).split(clauseBoundary).at(-1)??'';
 const after=source.slice(span.end).split(clauseBoundary)[0];
 return before+source.slice(span.start,span.end)+after;
}
function overlaps(a:Span,b:Span){return a.start<b.end&&b.start<a.end;}
function adjacent(a:Span,b:Span,source:string){
 return !overlaps(a,b)&&/^\s+$/u.test(a.start<b.start?source.slice(a.end,b.start):source.slice(b.end,a.start));
}

/** Rejoin a noun-only model quote with a literal adjacent count. This
 * repairs evidence for new items only. Edits require their original proof. */
export function bindVoiceAddCounts(items:Item[],source:string,isNew:(item:Item)=>boolean):Item[]{
 const anchors=items.map(i=>wordSpans(source,i.sourceText));
 const independent=items.map(item=>!item.targetLineId&&item.sameItemOrdinal===undefined&&
  item.requestMode!=='additional'&&!item.additionalEvidence&&!item.crossedOut&&isNew(item));
 const repairable=items.map((item,index)=>!!item.countEvidence&&!item.sourceText.includes(item.countEvidence.sourceText)&&
  independent[index]&&
  !item.unresolved.includes('quantity')&&!additionalMention.test(item.sourceText)&&!mutationNegated(item.sourceText,source)&&
  !anchors[index].some(anchor=>negativeProductMention.test(clauseFor(source,anchor))));
 const bindings=items.map((item,index)=>{
  if(!repairable[index]||!item.countEvidence||item.countEvidence.mode!=='total'||item.countEvidence.value!==item.purchaseCount)return [];
  const expression=item.countEvidence.sourceText;
  if(explicitPurchaseCount(expression)!==item.purchaseCount||spokenMeasures(expression).length)return [];
  return wordSpans(source,expression).flatMap(count=>anchors[index].flatMap(anchor=>{
   if(!adjacent(count,anchor,source))return [];
   const span={start:Math.min(count.start,anchor.start),end:Math.max(count.end,anchor.end)};
   if(anchors.some((other,j)=>j!==index&&other.some(o=>overlaps(o,span)||adjacent(o,count,source))))return [];
   const phrase=source.slice(span.start,span.end);
   const localContext=clauseFor(source,span);
   if(phrase.length>500||negativeProductMention.test(localContext)||mutationNegated(phrase,source)||
    countExpressionIsMeasurement(localContext,expression)||explicitPurchaseCount(localContext)!==item.purchaseCount)return [];
   return [phrase];
  }));
 });
 return items.map((item,index)=>{
  const phrases=bindings[index];
  const spoken=phrases.length===1?phrases[0]:item.sourceText;
  const pack=item.packSize;
  // One item or pair is a purchase count. A separate measured pack or an
  // explicitly stated inner count needs its own evidence to become a filter.
  if(independent[index]&&pack&&pack.value===item.purchaseCount&&item.countEvidence?.value===item.purchaseCount&&
    convertAmount(pack,pack.unit)===null&&
    (explicitPurchaseCount(spoken)===item.purchaseCount||repairable[index]&&!phrases.length&&explicitPurchaseCount(item.sourceText)===undefined)){
   const {packSize,...withoutPack}=item;
   item=withoutPack;
  }
  if(!repairable[index])return item;
  if(phrases.length===1)return {...item,sourceText:spoken};
  // A disputed count cannot discard the rest of a clear new shopping list.
  const {countEvidence,...rest}=item;
  return {...rest,purchaseCount:null,unresolved:[...item.unresolved.slice(0,6),'quantity']};
 });
}
