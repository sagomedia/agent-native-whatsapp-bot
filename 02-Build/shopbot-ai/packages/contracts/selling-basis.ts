import {canonicalMeasurementUnit,measurementUnitPattern} from './measurements.js';

type Basis={name:string;unit:string;specifications?:Record<string,string>;sellingPolicy?:{saleMode?:'pack'|'measured';packContents?:{value:number;unit:string};cutAllowed:boolean;continuousLengthAvailable:number|null}};
const measured=new Set(['litre','kg','metre','foot']);
const family=(unit:string)=>['litre','ml'].includes(unit)?'volume':['kg','g'].includes(unit)?'weight':null;
const scale=(unit:string)=>['ml','g'].includes(unit)?0.001:1;
/** Warnings require a merchant decision; a product title never authorizes a conversion. */
export function sellingBasisIssues(product:Basis):string[]{
 const policy=product.sellingPolicy,unit=product.unit,issues:string[]=[];
 const text=[product.name,...Object.entries(product.specifications??{}).filter(([k])=>['size','weight','volume','pack_volume','pack_size'].includes(k)).map(([,v])=>v)].join(' ');
 const matches=[...text.matchAll(new RegExp('(\\d+(?:\\.\\d+)?)\\s*('+measurementUnitPattern+')(?![\\p{L}\\p{N}])','giu'))]
  .map(m=>({value:Number(m[1]),unit:canonicalMeasurementUnit(m[2])})).filter(m=>family(m.unit));
 const contents=policy?.packContents;
 if(contents&&family(contents.unit))matches.push({value:contents.value,unit:contents.unit});
 if(measured.has(unit)){
  if(matches.some(m=>family(m.unit)&&family(unit)&&family(m.unit)!==family(unit)))issues.push('Pack weight and volume must agree with the selling unit.');
  if(matches.some(m=>family(m.unit)===family(unit)&&Math.abs(m.value*scale(m.unit)-1)>1e-8)&&policy?.saleMode!=='measured')issues.push('Confirm measured/loose sale or choose the sealed pack selling unit. Price and stock must use that unit.');
  if(policy?.saleMode==='pack')issues.push('A sealed pack needs a count unit such as can, bucket, bottle or pack.');
 }else if(policy?.saleMode==='measured')issues.push('Measured sale needs a selling unit such as litre, kg, metre or foot.');
 if(contents&&family(contents.unit)&&matches.some(m=>family(m.unit)===family(contents.unit)&&Math.abs(m.value*scale(m.unit)-contents.value*scale(contents.unit))>1e-8))issues.push('Product label and recorded pack contents disagree. Confirm the exact variant.');
 return [...new Set(issues)];
}
export function sellingBasisPreview(product:Basis):string {
 const contents=product.sellingPolicy?.packContents;
 return `Customer buys 1 ${product.unit||'selling unit'}${contents?` containing ${contents.value} ${contents.unit}`:''}. Price is per ${product.unit||'selling unit'}; stock is counted in ${product.unit||'selling units'}.`;
}
