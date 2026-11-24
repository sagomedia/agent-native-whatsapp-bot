import {test} from 'node:test';
import assert from 'node:assert/strict';
import {quickPriceCsv} from '../apps/dashboard/src/owner-quick-price.js';
import {parseFactCsv} from '../apps/server/src/services/catalog-fact-imports.js';
import {factColumns} from '../packages/contracts/catalog-facts.js';
const product={sku:'PIPE-1',version:7,inventoryVersion:12,name:'PVC, "heavy"\nகுழாய்',unit:'piece' as const};
test('quick price uses the established facts CSV with exact captured identity and no stock mutation',()=>{
 const rows=parseFactCsv(quickPriceCsv(product,'125.50','priced'));
 assert.equal(rows.length,1);const row=Object.fromEntries(factColumns.map((key,index)=>[key,rows[0][index]]));
 assert.equal(row.sku,product.sku);assert.equal(row.product_version,'7');assert.equal(row.inventory_version,'12');assert.equal(row.product_name,product.name);assert.equal(row.selling_unit,'piece');assert.equal(row.shop_price_inr,'125.50');assert.equal(row.price_status,'priced');assert.equal(row.confirm_price,'yes');assert.equal(row.on_hand_quantity,'');assert.equal(row.confirm_stock,'');
 assert.ok(!Object.keys(row).includes('active'));assert.ok(!Object.keys(row).includes('verified'));
});
test('quick price requires explicit free status and rejects invalid or excessive amounts',()=>{
 assert.equal(parseFactCsv(quickPriceCsv(product,'0','free'))[0][6],'free');
 for(const value of ['','-1','1.001','NaN','Infinity','21474836.48','1e2'])assert.throws(()=>quickPriceCsv(product,value,'priced'),/valid shop price/);
 assert.throws(()=>quickPriceCsv(product,'0','priced'),/free item explicitly/);assert.throws(()=>quickPriceCsv(product,'1','free'),/free item explicitly/);
 assert.equal(parseFactCsv(quickPriceCsv(product,'21474836.47','priced'))[0][5],'21474836.47');
});
