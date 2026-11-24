import {test} from 'node:test';
import assert from 'node:assert/strict';
import {productName} from '../packages/contracts/language.js';
import type {Product} from '../packages/contracts/index.js';
const product={sku:'N95',name:'3M 8210 N95 mask',brand:'3M',unit:'piece',pricePaise:22000,stock:10,version:1,aliases:[],quantityStep:1} satisfies Product;
for(const language of ['en','ta','ta-Latn'] as const)test(`catalog brand is literal while actual measures translate in ${language}`,()=>{
 assert.equal(productName(product,language),'3M 8210 N95 mask');
 const label=productName({...product,name:'3M tape 3m'},language);assert.match(label,/^3M tape 3 (?:metres|மீட்டர்|metre)$/);
 assert.match(productName({...product,name:'ACME+ pipe 3m',brand:'ACME+'},language),/^ACME\+ pipe 3 /);
 assert.match(productName({...product,name:'13m hose',brand:'3M'},language),/^13 /,'embedded digits must not be protected as a brand');
});
