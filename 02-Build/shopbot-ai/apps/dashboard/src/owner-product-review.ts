import {sellingBasisIssues} from '../../../packages/contracts/selling-basis.js';
import type {Product} from '../../../packages/contracts/index.js';
import type {ProductSection} from './OwnerProductTabs.js';
export type ProductReviewIssue={field:string;section:ProductSection;message:string};
type Input={name:string;unit:string;price:string;priceStatus:string;stock:string;quantityStep:string;packValue:string;packUnit:string;continuousLength:string;specs:{key:string;value:string}[];saleMode:''|'pack'|'measured';cutAllowed:boolean;hasPhoto:boolean;withoutPhoto:boolean};
export function productPublicationIssues(input:Input):ProductReviewIssue[]{
 const issues:ProductReviewIssue[]=[],add=(field:string,section:ProductSection,message:string)=>issues.push({field,section,message});
 if(input.name.trim().length<2)add('productName','general','Enter a product name with at least two characters.');
 if(!input.unit)add('unit','general','Choose the selling unit.');
 if(input.priceStatus!=='confirm'&&!/^\d+(?:\.\d{1,2})?$/.test(input.price))add('price','general','Enter the shop price with up to two decimal places.');
 else if(input.priceStatus==='priced'&&Number(input.price)<=0)add('price','general','Enter a price above zero, or choose the free-item price status.');
 else if(input.priceStatus==='free'&&Number(input.price)!==0)add('price','general','A free item must have a price of zero.');
 if(!/^\d+(?:\.\d{1,3})?$/.test(input.quantityStep)||Number(input.quantityStep)<=0||Number(input.quantityStep)>100)add('quantityStep','general','Enter a quantity increment above zero and no more than 100.');
 if(input.stock.trim()&&(!/^\d+(?:\.\d{1,3})?$/.test(input.stock)||!Number.isFinite(Number(input.stock))))add('stock','general','Enter a non-negative physical count, or leave it unknown.');
 if((input.packValue&&!input.packUnit)||(!input.packValue&&input.packUnit))add('packValue','selling','Enter both the pack content amount and unit, or leave both blank.');
 else if(input.packValue&&(!Number.isFinite(Number(input.packValue))||Number(input.packValue)<=0))add('packValue','selling','Enter a pack content amount above zero.');
 if(input.continuousLength&&(!Number.isFinite(Number(input.continuousLength))||Number(input.continuousLength)<0))add('continuousLength','selling','Enter a non-negative continuous length, or leave it unknown.');
 const specifications:Record<string,string>={};
 for(const spec of input.specs){if(!spec.key.trim()&&!spec.value.trim())continue;const key=spec.key.trim().toLowerCase().replaceAll(' ','_');if(!/^[a-z][a-z0-9_]{0,39}$/.test(key)||!spec.value.trim()||key in specifications){add('specifications','selling','Give each specification a unique name and a value.');break;}specifications[key]=spec.value.trim();}
 const sellingPolicy={...(input.saleMode?{saleMode:input.saleMode}:{}),...(input.packValue&&input.packUnit?{packContents:{value:Number(input.packValue),unit:input.packUnit}}:{}),cutAllowed:input.cutAllowed,continuousLengthAvailable:input.continuousLength?Number(input.continuousLength):null};
 if(input.unit)for(const message of sellingBasisIssues({name:input.name,unit:input.unit,specifications,sellingPolicy:sellingPolicy as Product['sellingPolicy']}))add('saleMode','selling',message);
 if(!input.hasPhoto&&!input.withoutPhoto)add('photoMode','photos','Add an exact product photo or choose to publish without a photo.');
 return issues;
}
