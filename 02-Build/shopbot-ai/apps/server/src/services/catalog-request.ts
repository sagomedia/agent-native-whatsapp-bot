import {normalize,tokens} from '../../../../packages/contracts/catalog-text.js';
import {catalogMeasurements,catalogMeasurementSqlPattern,sameCatalogMeasurement,withoutCatalogMeasurements,type CatalogMeasurement} from '../../../../packages/contracts/catalog-measurements.js';
import {canonicalMeasurementUnit,normalizeFractionNumbers} from '../../../../packages/contracts/measurements.js';
import type {DiscoveryPlan,Product} from '../../../../packages/contracts/index.js';

// These are wording equivalents, never permission to change a product's rating,
// material, brand or physical unit. The original query remains in the result.
export function naturalCatalogQuery(input:string):string {
 return input.replace(/(?:\d+\s*)?[½¼¾⅛⅜⅝⅞]/gu,normalizeFractionNumbers).normalize('NFKC').toLowerCase().replace(/[?!,]/g,' ')
  .replace(/முகத்துல போடுற மாஸ்க்|முகக் கவசம்|முகக்கவசம்|ஃபேஸ் மாஸ்க்|face\s+masks?/gu,'mask')
  .replace(/மாஸ்க்|மாஸ்கு|\b(?:maask|mugakavasa[mn]|mugathula podra mask)\b/gu,'mask')
  .replace(/தூசி|\bthoosi\b/gu,'dust').replace(/பெயிண்ட்ஸ்|பெயின்ட்ஸ்|பெயிண்ட்|பெயின்ட்|\b(?:peint|peyin[t]?|paintu)\b/gu,'paint')
  .replace(/ஏஷியன்|ஏசியன்|\b(?:asain|asiyan)\b/gu,'asian')
  .replace(/வெள்ளை|\bvellai\b/gu,'white').replace(/சிவப்பு|\bsivappu\b/gu,'red')
  .replace(/லிட்டர்|\blitt?er\b|\bltr\b/gu,'litre')
  .replace(/\b(?:one|oru)\s+(?=litres?\b)/g,'1 ').replace(/\bfour\s*[- ]\s*(?=litres?\b)/g,'4 ')
  .replace(/^(?:(?:please|hi|hello)\s+)*(?:(?:i\s+(?:want|need))|(?:do you have)|(?:can i get)|(?:show me))\s+/i,'')
  .replace(/\b(?:rate enna|enna rate|price please|what is the price|how much|available ah|irukka|venum|vendum|please)\b/g,' ')
  .replace(/(?:வேண்டும்|வேணும்|இருக்கா|என்ன விலை)[?.!]?/gu,' ')
  .replace(/\b(?:colou?r|shade)\b/g,' ').replace(/[?!,]/g,' ').replace(/\s+/g,' ').trim();
}
export function namedObjectPhrase(query:string):string {return query.split(/\s+(?:for|with|on)\s+/i,1)[0].trim();}
export function numericDimensions(text:string):string {
 const numbers:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
 return text.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+|-)(?=inch(?:es)?\b|in\b|mm\b|cm\b)/gi,(_,word)=>String(numbers[word.toLowerCase()])+' ');
}
export function discoveryIdentityQuery(customerQuery:string,identityQuery=customerQuery,dimensions:CatalogMeasurement[]=[]):string {
 const customer=numericDimensions(naturalCatalogQuery(customerQuery)||customerQuery);
 const identity=numericDimensions(naturalCatalogQuery(identityQuery)||identityQuery);
 const customerObject=namedObjectPhrase(customer),identityObject=namedObjectPhrase(identity);
 const customerWords=tokens(withoutCatalogMeasurements(customerObject)),identityWords=tokens(withoutCatalogMeasurements(identityObject));
 // A shorter description of the same item cannot discard stated modifiers.
 const query=identityWords.length&&customerWords.length>identityWords.length&&identityWords.every((word,index)=>word===customerWords[customerWords.length-identityWords.length+index])?customer:identity;
 const object=namedObjectPhrase(query),actual=catalogMeasurements(object),missing:CatalogMeasurement[]=[];
 for(const measure of [...catalogMeasurements(customerObject),...dimensions.map(m=>({...m,unit:canonicalMeasurementUnit(m.unit)}))]){
  if(![...actual,...missing].some(existing=>sameCatalogMeasurement(existing,measure)))missing.push(measure);
 }
 return missing.length?[object,...missing.map(m=>`${m.value} ${m.unit}`),query.slice(object.length).trim()].filter(Boolean).join(' '):query;
}
const colours=['white','red','blue','green','black','yellow','grey','gray','brown','orange','pink'];
export function queryColour(query:string):string|undefined {return colours.find(c=>new RegExp('\\b'+c+'\\b').test(query));}
export function removeTerm(query:string,value:string):string {
 const term=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return query.replace(new RegExp('(^|\\s)'+term+'(?=\\s|$)','gi'),' ').replace(/\s+/g,' ').trim();
}
export function specificationKeys(key:string):string[] {
 return key==='colour'||key==='color'?['colour','color']:key==='diameter'?['diameter','size']:['capacity','volume','pack_volume','pack_size'].includes(key)?[key,'pack_size','pack_volume','volume','size']:['weight','pack_weight'].includes(key)?[key,'weight','pack_weight','size']:[key];
}
export const catalogMeasurementSourceSql=`concat_ws('; ',p.name,(SELECT string_agg(value,'; ') FROM jsonb_each_text(p.specifications) WHERE key IN ('size','diameter','length','width','height','thickness','pack_size','pack_volume','volume','capacity','weight','pack_weight')),concat_ws(' ',p.selling_policy->'packContents'->>'value',p.selling_policy->'packContents'->>'unit'))`;
export function normalizedSpec(s:string){return normalize(numericDimensions(s.toLowerCase()).replace(/(\d)\s*(?:["\u2033]|inches?\b|in\b)/g,'$1 inch')).replace(/\s+/g,'').replace(/^(\d+(?:\.\d+)?)(?:l|litres?|liters?)$/,'$1litre');}
export function catalogSpecificationSql(key:string,value:string,bind:(value:string)=>string):string {
 const keys=[...new Set(specificationKeys(key))];
 if(['colour','color','material'].includes(key)){
  const pattern=bind('(^|[^[:alnum:]])'+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^[:alnum:]]|$)');
  const fields=keys.map(k=>`nullif(p.specifications->>${bind(k)},'')`);
  return `(coalesce(${fields.join(',')},p.name) ~* ${pattern} AND ${fields.map(f=>`(${f} IS NULL OR ${f} ~* ${pattern})`).join(' AND ')})`;
 }
 const measures=catalogMeasurements(value);
 if(measures.length===1&&!withoutCatalogMeasurements(value)){
  const pattern=bind(catalogMeasurementSqlPattern(measures[0]));
  return '('+keys.map(k=>`coalesce(p.specifications->>${bind(k)},'') ~* ${pattern}`).join(' OR ')+')';
 }
 const target=bind(normalizedSpec(value));
 return '('+keys.map(k=>`regexp_replace(regexp_replace(regexp_replace(lower(p.specifications->>${bind(k)}),'([0-9])[[:space:]]*(inches?\\M|in\\M|["\u2033])','\\1 inch','g'),'[^[:alnum:].]+','','g'),'^([0-9]+(?:[.][0-9]+)?)(l|litres?|liters?)$','\\1litre')=${target}`).join(' OR ')+')';
}
export function specificationValue(product:Product,key:string):string|undefined {return specificationKeys(key).map(k=>product.specifications?.[k]).find(Boolean);}
export function specificationTextMatch(actual:string,requested:string):boolean {
 const a=normalize(actual).replace(/\bgray\b/g,'grey'),b=normalize(requested).replace(/\bgray\b/g,'grey');
 return a===b||(' '+a+' ').includes(' '+b+' ');
}
export function understandingSearch(item:{query?:string|null;brand?:string;colour?:string;material?:string;packSize?:{value:number;unit:string};dimensions?:CatalogMeasurement[];unresolved?:string[];search?:import('../../../../packages/contracts/understanding.js').TurnUnderstanding['requestedItems'][number]['search']}):DiscoveryPlan|undefined {
 if(!item.query)return;
 const brand=item.brand;
 if(!brand&&!item.colour&&!item.material&&!item.packSize&&!item.dimensions?.length&&!item.search)return;
 const groundedBrand=item.unresolved?.includes('brand')?undefined:brand;
 const identity=item.dimensions?.length?discoveryIdentityQuery(item.query,item.search?.identityQuery,item.dimensions):undefined;
 return {...item.search,...(identity&&identity.length<=200?{identityQuery:identity}:{}),keywords:[...new Set([...(item.search?.keywords??[]),item.query.slice(0,120)])].slice(0,8),allowAlternatives:true,...(groundedBrand?{brand:groundedBrand}:{}),...((item.colour||item.material||item.packSize)?{specifications:{...(item.colour?{colour:item.colour}:{}),...(item.material?{material:item.material}:{}),...(item.packSize?{pack_size:`${item.packSize.value} ${item.packSize.unit}`}:{})}}:{})};
}
