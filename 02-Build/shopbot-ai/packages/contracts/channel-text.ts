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
