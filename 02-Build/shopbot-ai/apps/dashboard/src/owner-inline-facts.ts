import type {Product} from '../../../packages/contracts/index.js';
import {factColumns} from '../../../packages/contracts/catalog-facts.js';
import {quickPriceCsv} from './owner-quick-price.js';
import {stockChangePreview} from './owner-stock-preview.js';
export type InlineFactEdit={product:Product;price?:string;free?:boolean;stock?:string};
export function inlineFactsCsv(edits:InlineFactEdit[]){
 if(!edits.length)throw new Error('Change a price or physical count first.');
 const rows=edits.map(edit=>{
  const p=edit.product,price=edit.price?.trim(),stock=edit.stock?.trim();
  if(edit.price!==undefined)quickPriceCsv(p,price??'',edit.free?'free':'priced');
  if(edit.stock!==undefined){const preview=stockChangePreview(p,'count',stock??'');if(!stock||preview.error||preview.onHand===null)throw new Error(p.name+': '+(preview.error||'Enter a physical count or remove this row’s edits.'));}
  const values=[p.sku,String(p.version),String(p.inventoryVersion??1),p.name,p.unit,price??'',price===undefined?'':edit.free?'free':'priced',price===undefined?'':'yes',stock??'',stock===undefined?'':'yes','Shop checked in the price and stock grid'];
  return values.map(value=>'"'+value.replaceAll('"','""')+'"').join(',');
 });
 return factColumns.join(',')+'\r\n'+rows.join('\r\n')+'\r\n';
}
