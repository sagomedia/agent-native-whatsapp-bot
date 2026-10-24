import {normalize} from '../../../../packages/contracts/catalog-text.js';
import type {DiscoveryPlan,Product} from '../../../../packages/contracts/index.js';

// These are wording equivalents, never permission to change a product's rating,
// material, brand or physical unit. The original query remains in the result.
export function naturalCatalogQuery(input:string):string {
 return input.normalize('NFKC').toLowerCase().replace(/[?!,]/g,' ')
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
const colours=['white','red','blue','green','black','yellow','grey','gray','brown','orange','pink'];
export function queryColour(query:string):string|undefined {return colours.find(c=>new RegExp('\\b'+c+'\\b').test(query));}
export function removeTerm(query:string,value:string):string {
 const term=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return query.replace(new RegExp('(^|\\s)'+term+'(?=\\s|$)','gi'),' ').replace(/\s+/g,' ').trim();
}
export function specificationKeys(key:string):string[] {
 return key==='colour'||key==='color'?['colour','color']:key==='diameter'?['diameter','size']:['capacity','volume','pack_volume','pack_size'].includes(key)?[key,'pack_size','pack_volume','volume','size']:['weight','pack_weight'].includes(key)?[key,'weight','pack_weight','size']:[key];
}
export function specificationValue(product:Product,key:string):string|undefined {return specificationKeys(key).map(k=>product.specifications?.[k]).find(Boolean);}
export function specificationTextMatch(actual:string,requested:string):boolean {
 const a=normalize(actual).replace(/\bgray\b/g,'grey'),b=normalize(requested).replace(/\bgray\b/g,'grey');
 return a===b||(' '+a+' ').includes(' '+b+' ');
}
export function understandingSearch(item:{query?:string|null;brand?:string;colour?:string;material?:string;packSize?:{value:number;unit:string}}):DiscoveryPlan|undefined {
 if(!item.query)return;
 const brand=item.brand&&!/^(?:teflon|ptfe|pvc|cpvc|upvc|n95|n99|n100|p100|ffp1|ffp2|ffp3)$/i.test(item.brand)?item.brand:undefined;
 if(!brand&&!item.colour&&!item.material&&!item.packSize)return;
 return {keywords:[item.query.slice(0,120)],allowAlternatives:true,...(brand?{brand}:{}),...((item.colour||item.material||item.packSize)?{specifications:{...(item.colour?{colour:item.colour}:{}),...(item.material?{material:item.material}:{}),...(item.packSize?{pack_size:`${item.packSize.value} ${item.packSize.unit}`}:{})}}:{})};
}
