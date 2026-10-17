import {canonicalMeasurementUnit,measurementUnitPattern,normalizeFractionNumbers} from './measurements.js';

export type CatalogMeasurement={value:number;unit:string};
const pattern=new RegExp('(?<![\\p{L}\\p{N}./])(\\d+(?:\\.\\d+)?)\\s*('+measurementUnitPattern+'|in|["″])(?![\\p{L}\\p{N}])','giu');
/** Typed identity evidence only. No litre/kg or magnitude conversions. */
export function catalogMeasurements(text:string):CatalogMeasurement[]{
 return [...normalizeFractionNumbers(text).matchAll(pattern)].map(m=>({value:Number(m[1]),unit:/^(?:in|["″])$/i.test(m[2])?'inch':canonicalMeasurementUnit(m[2])}));
}
export function withoutCatalogMeasurements(text:string):string{return normalizeFractionNumbers(text).replace(pattern,' ').replace(/\s+/g,' ').trim();}
export function sameCatalogMeasurement(a:CatalogMeasurement,b:CatalogMeasurement){return a.value===b.value&&a.unit===b.unit;}
export function measurementSpecEqual(a:string,b:string):boolean|undefined{
 const first=catalogMeasurements(a),second=catalogMeasurements(b);
 if(first.length!==1||second.length!==1||withoutCatalogMeasurements(a)||withoutCatalogMeasurements(b))return undefined;
 return sameCatalogMeasurement(first[0],second[0]);
}
const unitPatterns:Record<string,string>={litre:'lit(re|er)s?|ltrs?|lt|l|லிட்டர்|லிட்டரு',kg:'kilograms?|kilos?|kgs?|கிலோ',g:'g|கிராம்',inch:'inch(es)?|in|["″]|இன்ச்|இஞ்ச்|அங்குலம்',m:'met(re|er)s?|mtrs?|m|மீட்டர்|மீட்ர்',foot:'feet|foot|ft|அடி',ml:'ml',mm:'mm',cm:'cm'};
/** PostgreSQL POSIX expression, matching the exact value and physical unit. */
export function catalogMeasurementSqlPattern(measure:CatalogMeasurement):string{
 const whole=Math.floor(measure.value),fraction=Number((measure.value-whole).toFixed(8));
 const variants=[String(measure.value).replace('.', '[.]')+(Number.isInteger(measure.value)?'([.]0+)?':'0*')];
 for(const [symbol,numerator,denominator] of [['½',1,2],['¼',1,4],['¾',3,4],['⅛',1,8],['⅜',3,8],['⅝',5,8],['⅞',7,8]] as const){
  if(fraction===numerator/denominator){variants.push((whole?whole+'[[:space:]]*':'')+symbol);variants.push((whole?whole+'[[:space:]]+':'')+numerator+'[[:space:]]*/[[:space:]]*'+denominator);}
 }
 return '(^|[^[:alnum:]./])('+variants.join('|')+')[[:space:]]*('+unitPatterns[measure.unit]+')([^[:alnum:]]|$)';
}
