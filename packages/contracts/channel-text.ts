import type {Product} from './index.js';
import {measurementText,productName,productPriceText,productStockText,referencePhotoLabel,type LanguageContext} from './language.js';
import {fitText,productPhotoCaption} from './channel-caption.js';
export {fitText,cardMessageText,productPhotoCaption} from './channel-caption.js';

/** Catalog identity, variant and price come before optional request context. */
export function buildProductCaption(product:Product,context:LanguageContext,details:(string|undefined)[]=[],index?:number,limit=160):string {
 const count=(text:string)=>Array.from(text).length;
 const clean=(text:string)=>text.replace(/\s+/g,' ').trim();
 const normalize=(value:string)=>clean(value).toLowerCase();
 const name=clean(productName(product,context)),prefix=index?`${index}. `:'';
 const variant=clean(measurementText(product.specifications?.size??product.specifications?.weight??'',context));
 const variantText=variant&&!normalize(name).includes(normalize(variant))?variant:'';
 const label=referencePhotoLabel(product,context),price=productPriceText(product,context);
 const stockWarning=product.stock===0?productStockText(product,context):'';
 const seen=new Set([name,[name,variantText].filter(Boolean).join(' · '),variant,price,productStockText(product,context),product.brand??'',label??''].map(normalize));
 const optional=details.filter((value):value is string=>!!value).map(clean).filter(value=>{
  const key=normalize(value);if(!key||seen.has(key)||normalize(name).includes(key))return false;
  seen.add(key);return true;
 });
 // The first detail is the caller's important count or relevance warning. Reserve
 // it before fitting a long name, alongside factual out-of-stock information.
 const firstDetail=optional[0]?fitText(optional[0],30):'';
 // A malformed oversized catalog unit must not displace both the identity and
 // reference disclosure; real catalog prices fit without truncation.
 const boundedPrice=fitText(price,Math.max(0,limit-(label?count(label)+1:0)-25));
 const reserved=[boundedPrice,stockWarning,firstDetail,label].filter((v):v is string=>!!v).join('\n');
 const identityBudget=Math.max(0,limit-count(reserved)-(reserved?1:0));
 const boundedVariant=fitText(variantText,Math.min(40,Math.max(0,identityBudget-count(prefix)-21)));
 const identity=prefix+fitText(name,Math.max(0,identityBudget-count(prefix)-(boundedVariant?count(boundedVariant)+3:0)))+(boundedVariant?' · '+boundedVariant:'');
 const rows=[identity,boundedPrice,stockWarning].filter(Boolean);
 let result=rows.join('\n');
 const room=limit-count(result)-(label?count(label)+1:0)-1;
 if(optional.length&&room>1)result+='\n'+fitText(optional.join(' · '),room);
 return productPhotoCaption(result,product,context,limit);
}
