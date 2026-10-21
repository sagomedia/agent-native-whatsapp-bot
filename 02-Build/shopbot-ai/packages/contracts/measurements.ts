/** Fractions are parsed as a whole; a denominator can never become the size. */
const fractions:Record<string,number>={'½':.5,'¼':.25,'¾':.75,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875};
export const measurementUnitPattern = 'lit(?:re|er)s?|ltr?s?|l|லிட்டர்|லிட்டரு|inch(?:es)?|இன்ச்|இஞ்ச்|அங்குலம்|mm|cm|ml|kilograms?|kilos?|kgs?|g|கிலோ|கிராம்|met(?:re|er)s?|mtrs?|m|மீட்டர்|மீட்ர்|feet|foot|ft|அடி';
export function canonicalMeasurementUnit(value: string): string {
 const unit = value.toLowerCase();
 if (/^(?:l|lt|ltr|ltrs|litres?|liters?|லிட்டர்|லிட்டரு)$/.test(unit)) return 'litre';
 if (/^(?:inch(?:es)?|இன்ச்|இஞ்ச்|அங்குலம்)$/.test(unit)) return 'inch';
 if (/^(?:metres?|meters?|mtr|mtrs|m|மீட்டர்|மீட்ர்)$/.test(unit)) return 'm';
 if (/^(?:feet|foot|ft|அடி)$/.test(unit)) return 'foot';
 if (/^(?:kilograms?|kilos?|kgs?|கிலோ)$/.test(unit)) return 'kg';
 return unit === 'கிராம்' ? 'g' : unit;
}
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

/** Literal current-input numbers for clarification, never catalog inference. */
export function spokenNumberValues(text:string):string[] {
 const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,twenty:20,fifty:50,hundred:100,oru:1,onnu:1,ondru:1,rendu:2,irandu:2,moonu:3,moondru:3,naalu:4,anju:5,pathu:10,paththu:10,'ஒரு':1,'ஒன்று':1,'ஒன்னு':1,'ஒண்ணு':1,'இரண்டு':2,'ரெண்டு':2,'மூன்று':3,'மூணு':3,'நான்கு':4,'நாலு':4,'ஐந்து':5,'அஞ்சு':5,'பத்து':10,'இருபது':20,'ஐம்பது':50,'நூறு':100};
 return [...normalizeFractionNumbers(text).match(/\d+(?:\.\d+)?/g)??[],...[...text.toLowerCase().matchAll(/[\p{L}\p{M}]+/gu)].flatMap(m=>words[m[0]]===undefined?[]:[String(words[m[0]])])];
}
