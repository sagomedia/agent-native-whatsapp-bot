import {test} from 'node:test';import assert from 'node:assert/strict';
import {understandingPrompt,understandingInstruction} from '../apps/server/src/adapters/turn-understanding.js';
import type {InterpretationInput} from '../apps/server/src/adapters/interpreter.js';
test('shopping interpretation receives the actual store type and bounded real families without changing customer evidence',()=>{
 const input={text:'nalli venum',state:{version:0,draft:[],pending:null,lastRequestId:null,fulfillment:'pickup'},catalogMap:{revision:1,store:{name:'KSMC',type:'hardware'},productCount:3,departments:[{id:'plumbing',label:'Plumbing',count:3,families:[{id:'taps',label:'Taps and faucets',aliases:[],count:3}]}],truncated:false}} as InterpretationInput;
 const prompt=JSON.parse(understandingPrompt(input));assert.deepEqual(prompt.storeContext,{name:'KSMC',type:'hardware',productFamilies:['Taps and faucets'],familiesMayBeIncomplete:false});assert.equal(prompt.customerText,'nalli venum');
 assert.match(understandingInstruction,/preserving the verbatim sourceText/);assert.match(understandingInstruction,/If multiple distinct types remain plausible/);
});
