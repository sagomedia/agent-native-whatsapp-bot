/** Fractions are parsed as a whole; a denominator can never become the size. */
const fractions:Record<string,number>={'½':.5,'¼':.25,'¾':.75,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875};
export const measurementNumberPattern='(?:\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d+(?:\\.\\d+)?|[½¼¾⅛⅜⅝⅞])';
export function measurementNumber(value:string):number|undefined {
 const text=value.trim();if(fractions[text]!==undefined)return fractions[text];
 const fraction=/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(text);
 const result=fraction?Number(fraction[3])>0?Number(fraction[1]??0)+Number(fraction[2])/Number(fraction[3]):NaN:/^\d+(?:\.\d+)?$/.test(text)?Number(text):NaN;
 return Number.isFinite(result)&&result>0?result:undefined;
}
export function normalizeFractionNumbers(text:string):string {
 return text.replace(/(\d+)\s*([½¼¾⅛⅜⅝⅞])/g,(_,n,f)=>String(Number(n)+fractions[f]))
 .replace(/[½¼¾⅛⅜⅝⅞]/g,f=>String(fractions[f]))
 .replace(new RegExp('(?<![\\p{L}\\p{N}./])'+measurementNumberPattern+'(?![\\p{N}./])','gu'),value=>{
  if(!value.includes('/'))return value;const number=measurementNumber(value);return number===undefined?value:String(number);
 });
}
