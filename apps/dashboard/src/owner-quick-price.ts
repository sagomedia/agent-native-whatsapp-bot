import type {Product} from '../../../packages/contracts/index.js';
import {factColumns} from '../../../packages/contracts/catalog-facts.js';
export function quickPriceCsv(product:Pick<Product,'sku'|'version'|'inventoryVersion'|'name'|'unit'>,price:string,status:'priced'|'free'){
 if(!/^\d+(?:\.\d{1,2})?$/.test(price)||Number(price)>21474836.47)throw new Error('Enter a valid shop price in rupees with up to two decimal places.');
 if(status==='priced'&&Number(price)===0||status==='free'&&Number(price)!==0)throw new Error('Confirm a free item explicitly, or enter a price above zero.');
 const values=[product.sku,String(product.version),String(product.inventoryVersion??1),product.name,product.unit,price,status,'yes','','','Price checked in product inventory'];
 return factColumns.join(',')+'\r\n'+values.map(value=>'"'+value.replaceAll('"','""')+'"').join(',')+'\r\n';
}
