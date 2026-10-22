import test from 'node:test';
import assert from 'node:assert/strict';
import {productPublicationIssues} from '../apps/dashboard/src/owner-product-review.js';
const product={name:'Test switch',unit:'piece',price:'',priceStatus:'confirm',stock:'',quantityStep:'1',packValue:'',packUnit:'',continuousLength:'',specs:[],saleMode:'' as const,cutAllowed:false,hasPhoto:false,withoutPhoto:true};
test('publication review preserves explicit unknown price and stock without requiring five acknowledgments',()=>{
 assert.deepEqual(productPublicationIssues(product),[]);
 assert.deepEqual(productPublicationIssues({...product,stock:'0'}),[]);
});
test('publication review directs missing identity, selling unit and photo choice to their actual sections',()=>{
 const issues=productPublicationIssues({...product,name:'',unit:'',withoutPhoto:false});
 assert.deepEqual(issues.map(issue=>[issue.field,issue.section]),[['productName','general'],['unit','general'],['photoMode','photos']]);
 assert.equal(productPublicationIssues({...product,withoutPhoto:false,hasPhoto:true}).length,0);
});
test('publication review rejects invalid commercial numbers and distinguishes free from unpriced',()=>{
 assert.ok(productPublicationIssues({...product,priceStatus:'priced',price:'0'}).some(issue=>issue.field==='price'));
 assert.deepEqual(productPublicationIssues({...product,priceStatus:'free',price:'0'}),[]);
 assert.ok(productPublicationIssues({...product,priceStatus:'free',price:'5'}).some(issue=>issue.field==='price'));
 for(const quantityStep of ['0','101','NaN','0.0001'])assert.ok(productPublicationIssues({...product,quantityStep}).some(issue=>issue.field==='quantityStep'&&issue.section==='selling'));
 for(const stock of ['-1','NaN','1.0001'])assert.ok(productPublicationIssues({...product,stock}).some(issue=>issue.field==='stock'));
});
test('publication review sends ambiguous pack selling decisions to Selling details',()=>{
 const paint={...product,name:'Paint 10 litre',unit:'litre'};
 assert.ok(productPublicationIssues(paint).some(issue=>issue.field==='saleMode'&&issue.section==='selling'));
 assert.deepEqual(productPublicationIssues({...paint,saleMode:'measured'}),[]);
 assert.ok(productPublicationIssues({...product,packValue:'10'}).some(issue=>issue.field==='packValue'));
});
test('publication review catches duplicate or malformed specifications before preparing a draft',()=>{
 for(const specs of [[{key:'size',value:'1'},{key:'size',value:'2'}],[{key:'bad key!',value:'1'}],[{key:'size',value:''}]])assert.ok(productPublicationIssues({...product,specs}).some(issue=>issue.field==='specifications'&&issue.section==='selling'));
});
