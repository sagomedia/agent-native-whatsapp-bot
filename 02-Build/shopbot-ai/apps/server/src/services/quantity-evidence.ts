import {measurementNumber,measurementNumberPattern,measurementUnitPattern,canonicalMeasurementUnit} from '../../../../packages/contracts/measurements.js';
import type {Operation,DraftLine,Product} from '../../../../packages/contracts/index.js';
import {sameUnit} from './catalog.js';
import {quantityReply} from './shopping-language.js';

type Measure={value:number;unit:string;role?:'size'|'diameter'|'length'|'width'|'height'|'thickness'};
const countWords='a|an|mukkal|முக்கால்|kaal|ara|arai|கால்|அரை|one|two|three|four|five|six|seven|eight|nine|ten|twenty|fifty|hundred|oru|onnu|ondru|rendu|moonu|naalu|anju|paththu|pathu|ஒரு|ஒன்று|ஒன்னு|ஒண்ணு|இரண்டு|ரெண்டு|மூன்று|மூணு|நான்கு|நாலு|ஐந்து|அஞ்சு|பத்து|இருபது|ஐம்பது|நூறு';
const measures=new RegExp('(?<![\\p{L}\\p{N}./])('+measurementNumberPattern+'|'+countWords+')\\s*[- ]?\\s*('+measurementUnitPattern+')(?=\\s|$|[^\\p{L}])','giu');
const measureUnit=canonicalMeasurementUnit;
export const physicalMeasure=(measure:Measure)=>['inch','mm','cm','m','foot'].includes(measureUnit(measure.unit));
function number(s:string){return (/^[\d½¼¾⅛⅜⅝⅞]/.test(s)?measurementNumber(s):undefined)??({a:1,an:1,mukkal:.75,'முக்கால்':.75,kaal:.25,ara:.5,arai:.5,'கால்':.25,'அரை':.5,'ஒண்ணு':1,'மூணு':3,fifty:50,hundred:100,'இருபது':20,'ஐம்பது':50,'நூறு':100} as Record<string,number>)[s.toLowerCase()]??quantityReply(s)?.quantity;}
export function spokenMeasures(text:string):Measure[]{return [...text.matchAll(measures)].flatMap(m=>{const value=number(m[1]);return value?[{value,unit:measureUnit(m[2])}]:[];});}
export function explicitPurchaseCount(phrase:string):number|undefined {
 const remainder=phrase.replace(measures,' '),re=new RegExp('(?:^|[^\\p{L}\\p{N}.])(\\d+(?:\\.\\d+)?|'+countWords+')(?=$|[^\\p{L}\\p{N}.])','giu');
 const counts=[...remainder.matchAll(re)].map(m=>number(m[1])).filter((n):n is number=>n!==undefined);
 return counts.length===1?counts[0]:undefined;
}
export function packSearchQuery(query:string,pack?:Measure,removeContainer=false):string {
 if(!pack)return query;
 let cleaned=query.replace(measures,match=>{const measure=spokenMeasures(match)[0];return measure&&sameUnit(measure.unit,pack.unit)&&measure.value===pack.value?' ':match;}).replace(/\s+/g,' ').trim();
 if(removeContainer)cleaned=cleaned.replace(/\s+(?:cans?|tins?|buckets?|box(?:es)?|bottles?|packs?)$/i,'').trim();
 return cleaned||query;
}
// This guard only separates explicit dimensions from counts. Catalog resolution
// remains authoritative; an unsupported conversion always leaves a question.
export function protectQuantityEvidence(operations:Operation[],description:string):Operation[]{
 const pieces=description.split(/[,;\n]|[.!?](?:\s|$)|\b(?:plus|and|aduthu|adutha|appuram|apparam|next|then)\b|அடுத்து|அப்புறம்|அண்ட்|அண்டு/iu);
 return operations.map(op=>{
  if(op.kind!=='add_item'&&op.kind!=='resolve_line')return op;
  if(op.requestedUnit){const countWord=quantityReply(op.requestedUnit);if(countWord&&!countWord.unit)op={...op,requestedUnit:undefined};}
  const supplied=op.productIntent?.sourcePhrase??op.supportingPhrase;
  const keyword=(op.query??'').toLowerCase().split(/\s+/).filter(w=>w.length>2&&!/^\d/.test(w)&&!['wall','interior','exterior','pack','box','can','bucket'].includes(w));
  const possible=pieces.filter(p=>keyword.some(w=>p.toLowerCase().includes(w)));
  const phrase=supplied&&description.includes(supplied)?supplied:possible.length===1?possible[0].trim():operations.filter(o=>o.kind==='add_item'||o.kind==='resolve_line').length===1?description:undefined;
  if(!phrase)return op;
  // A planner can echo a named pack's contents as a total even when no
  // purchase count was heard. That must not silently become one whole pack.
  const explicitCount=explicitPurchaseCount(phrase);
  const total=/(?:\b(?:total|altogether|moththam|mottam|continuous)\b|மொத்தம்|ஒரே\s*(?:நீள|துண்டு))/iu.test(phrase);
  if(op.requestedAmount&&op.packSize&&sameUnit(op.requestedAmount.unit,op.packSize.unit)&&op.requestedAmount.value===op.packSize.value&&!total){
   if(explicitCount===undefined)op=op.kind==='add_item'?{...op,requestedAmount:undefined,quantity:null}:{...op,requestedAmount:undefined,quantity:undefined};
   else op={...op,requestedAmount:undefined};
  }
  if(op.sourceUncertainty?.includes('quantity'))return op.kind==='add_item'?{...op,quantity:null,supportingPhrase:phrase}:{...op,quantity:undefined,supportingPhrase:phrase};
  if(op.requestedAmount&&convertAmount(op.requestedAmount,op.requestedAmount.unit)===null&&/^(?:cans?|tins?|buckets?|box(?:es)?|bottles?|packs?|pieces?)$/i.test(op.requestedAmount.unit)&&explicitPurchaseCount(phrase)===op.requestedAmount.value)op={...op,quantity:op.requestedAmount.value,requestedUnit:op.requestedUnit??op.requestedAmount.unit,requestedAmount:undefined};
  // A repeated pack-content field from the planner is not a second request
  // when the customer explicitly counted that pack. Preserve the spoken count.
  if(op.requestedAmount&&op.packSize&&explicitPurchaseCount(phrase)!==undefined&&sameUnit(op.requestedAmount.unit,op.packSize.unit)&&op.requestedAmount.value===op.packSize.value)op={...op,requestedAmount:undefined};
  if(op.requestedAmount&&convertAmount(op.requestedAmount,op.requestedAmount.unit)!==null){
    const amount=op.requestedAmount;
    const dimensions=op.productMeasures?.filter(m=>{const value=convertAmount(m,amount.unit);return value===null||Math.abs(value-amount.value)>1e-8;});
    return {...op,productMeasures:dimensions?.length?dimensions:undefined,supportingPhrase:phrase};
  }
  const found=[...phrase.matchAll(measures)];
  if(found.length>1){
    const dimensions=op.productMeasures??found.flatMap(m=>{const value=number(m[1]),unit=measureUnit(m[2]);return value&&physicalMeasure({value,unit})?[{value,unit}]:[];});
    return {...op,...(dimensions.length?{productMeasures:dimensions}:{}),supportingPhrase:phrase};
  }
  if(!found.length)return {...op,supportingPhrase:phrase};
  const m=found[0],value=number(m[1]);if(!value)return op;
  const packSize:Measure={value,unit:measureUnit(m[2])};
  const before=phrase.slice(0,m.index).trim().match(/(?:^|\s)(\d+(?:\.\d+)?|one|two|ten|oru|rendu|pathu|paththu|ஒரு|இரண்டு|ரெண்டு|பத்து)\s*$/i)?.[1];
  const after=phrase.slice((m.index??0)+m[0].length).match(/^\s*(?:cans?|box(?:es)?|buckets?|tins?|pipes?|பெட்டி|கேன்)/i)?.[0]?.trim();
  let quantity=op.quantity;
  const explicit=explicitPurchaseCount(phrase);
  if(explicit!==undefined)quantity=explicit;
  else if(before&&after)quantity=number(before)!;
  else if(!physicalMeasure(packSize)||quantity===value||op.requestedUnit&&sameUnit(op.requestedUnit,packSize.unit))quantity=op.kind==='add_item'?null:undefined;
  const requestedUnit=after?(/box|பெட்டி/i.test(after)?'box':/bucket/i.test(after)?'bucket':/can|tin|கேன்/i.test(after)?'can':'piece'):op.requestedUnit&&!sameUnit(op.requestedUnit,packSize.unit)?op.requestedUnit:undefined;
  const requestedAmount=before&&after&&op.requestedAmount&&sameUnit(op.requestedAmount.unit,requestedUnit??'')?undefined:op.requestedAmount;
  return {...op,quantity,...(physicalMeasure(packSize)?{productMeasures:op.productMeasures??[packSize],packSize:undefined}:{packSize}),requestedUnit,requestedAmount,supportingPhrase:phrase} as Operation;
 });
}
export function parsePackSize(verified:string):Measure|undefined {const m=verified.match(new RegExp('^('+measurementNumberPattern+')\\s*(L|litre|liter|ml|kg|g|inch|mm|cm)$','i'));const value=m?measurementNumber(m[1]):undefined;return m&&value?{value,unit:measureUnit(m[2])}:undefined;}
export function catalogPack(product:Product):Measure|undefined {
 const verified=product.specifications?.pack_volume??product.specifications?.volume??product.specifications?.weight??product.specifications?.size;
 const pack=verified?parsePackSize(verified):undefined;
 return pack&&!physicalMeasure(pack)?pack:undefined;
}
export function catalogMeasures(product:Product):Measure[] {
 const result:Measure[]=[];
 for(const [key,value] of Object.entries(product.specifications??{})){
  if(!['size','diameter','length','width','height','thickness'].includes(key))continue;
  for(const m of spokenMeasures(value))if(physicalMeasure(m))result.push({...m,role:key as Measure['role']});
 }
 return result;
}
export function matchesProductMeasures(product:Product,requested:Measure[]):boolean {
 const verified=catalogMeasures(product);
 return requested.every(m=>verified.some(v=>(!m.role||m.role==='size'||v.role===m.role||v.role==='size'&&(verified.filter(x=>x.role==='size').length===1||m.role==='length'&&['m','foot'].includes(v.unit)&&verified.filter(x=>x.role==='size'&&['m','foot'].includes(x.unit)).length===1))&&Math.abs((convertAmount(v,m.unit)??NaN)-m.value)<1e-8));
}
export function amountToCount(line:DraftLine,product:Product):number|null {
 const amount=line.requestedAmount,pack=catalogContent(product);
 if(!amount)return null;
 // quantity is always in the merchant selling unit: ten litres sold per
 // litre remains ten, even when the photo depicts a ten-litre can.
 if(['litre','kg','metre','foot'].includes(product.unit)&&convertAmount(amount,product.unit)!==null){
  if(!product.sellingUnitVerified)return null;
  const value=convertAmount(amount,product.unit)!;
  if(['metre','foot'].includes(product.unit)&&product.sellingPolicy?.cutAllowed!==true)return null;
  if(line.amountMode==='continuous'){const available=product.sellingPolicy?.continuousLengthAvailable;if(available===undefined||available===null||value>available)return null;}
  return value<=100&&Math.abs(value/product.quantityStep-Math.round(value/product.quantityStep))<1e-8?Math.round(value*1000)/1000:null;
 }
 if(!pack)return null;
 if(physicalMeasure(pack)&&!product.sellingUnitVerified)return null;
 const converted=convertAmount(amount,pack.unit);if(converted===null)return null;
 if(line.amountMode==='continuous'&&converted!==pack.value)return null;
 const count=converted/pack.value,steps=Math.round(count/product.quantityStep);
 if(physicalMeasure(pack)&&Math.abs(count-Math.round(count))>1e-8&&product.sellingPolicy?.cutAllowed!==true)return null;
 return count>0&&Math.abs(count-steps*product.quantityStep)<1e-8&&count<=100?Math.round(count*1000)/1000:null;
}
export function catalogContent(product:Product):Measure|undefined {
 if(product.sellingPolicy?.packContents)return product.sellingPolicy.packContents;
 const pack=catalogPack(product);if(pack)return pack;
 const explicit=product.specifications?.length;
 if(explicit){const ms=spokenMeasures(explicit);if(ms.length===1&&physicalMeasure(ms[0]))return ms[0];}
 const lengths=catalogMeasures(product).filter(m=>['m','foot'].includes(m.unit));
 return lengths.length===1?lengths[0]:undefined;
}
export function convertAmount(amount:Measure,to:string):number|null {
 const units:Record<string,[string,number]>={litre:['volume',1],ml:['volume',.001],kg:['weight',1],g:['weight',.001],m:['length',1],foot:['length',.3048],cm:['length',.01],mm:['length',.001],inch:['length',.0254]};
 const a=units[measureUnit(amount.unit)],b=units[measureUnit(to)];return a&&b&&a[0]===b[0]?amount.value*a[1]/b[1]:null;
}
