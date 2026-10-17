import type {Product} from './index.js';
import {referencePhotoLabel,type LanguageContext} from './language.js';
/** Channel limits count code points, while truncation must preserve Tamil graphemes. */
export function fitText(text:string,limit:number):string {
 if(Array.from(text).length<=limit)return text;
 let result='';
 for(const {segment} of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)){
  if(Array.from(result+segment+'…').length>limit)break;
  result+=segment;
 }
 return result+'…';
}
/** An image and its message share one caption. Do not display duplicate copy. */
export function cardMessageText(text:string,caption:string){
 return fitText(caption.includes(text)?caption:text.includes(caption)?text:[text,caption].filter(Boolean).join('\n'),1024);
}

/** Reserve the reference label even when channel captions must be shortened. */
export function productPhotoCaption(caption:string,product:Pick<Product,'imageReference'|'imageUrl'>,context:LanguageContext,limit=160):string {
 const label=referencePhotoLabel(product,context);
 if(!label)return fitText(caption,limit);
 const text=caption.endsWith('\n'+label)?caption.slice(0,-label.length-1):caption;
 return fitText(text,limit-Array.from(label).length-1)+'\n'+label;
}
