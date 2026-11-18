import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {GenerateContentParameters,GenerateContentResponse} from '@google/genai';
import {GoogleInterpreter} from '../apps/server/src/adapters/google-interpreter.js';
import {understandingPrompt} from '../apps/server/src/adapters/turn-understanding.js';
import type {InterpretationInput} from '../apps/server/src/adapters/interpreter.js';
import {admitRequest,inputAdmissionLimits} from '../apps/server/src/services/inference-admission.js';
import type {CatalogObservation} from '../apps/server/src/services/agent-assistance.js';
import type {CatalogMap,DiscoveryFacet,Interpretation,Product} from '../packages/contracts/index.js';

const state={version:0,draft:[],pending:null,lastRequestId:null,fulfillment:'pickup' as const,replyLanguage:'en' as const};
const settings={allowPaidInference:true,apiKey:'offline-only',model:'gemini-3.5-flash-lite' as const,budgetMicrousd:5000000,unifiedUnderstanding:true};
const source='two inch PVC pipe and one inch steel pipe; replace the glue with solvent';
const proposal:Interpretation={
 operations:[],next:'continue',understanding:{
  schemaVersion:2,inputKind:'text',intents:['add','edit'],shopQuestions:[],unresolved:[],
  requestedItems:[
   {ordinal:2,query:'PVC pipe',sourceText:'two inch PVC pipe',purchaseCount:null,dimensions:[{role:'diameter',value:2,unit:'inch'}],material:'PVC',unresolved:[]},
   {ordinal:4,query:'steel pipe',sourceText:'one inch steel pipe',purchaseCount:null,dimensions:[{role:'diameter',value:1,unit:'inch'}],material:'steel',unresolved:[]},
   {ordinal:7,query:'unobserved',sourceText:'unobserved',purchaseCount:null,unresolved:[]},
  ],
  proposedEdits:[
   {kind:'remove_item',targetLineId:'00000000-0000-4000-8000-000000000000',sourceText:'old cart edit'},
   {kind:'replace',targetLineId:'00000000-0000-4000-8000-000000000001',targetQuery:'glue',query:'solvent',sourceText:'replace the glue with solvent'},
  ],
 },
};

function observe(query:string,index:number,grouped=false):CatalogObservation{
 const products:Product[]=Array.from({length:10},(_,i)=>({
  sku:`SKU-${index}-${i}`,name:`${query} variant ${i}`,familyId:'supplies',unit:'piece',brand:'Generic',pricePaise:100,stock:50,version:1,aliases:[],
  quantityStep:1, imageUrl:'/raw-image-path',specifications:{diameter:`${index+1} inch`,...Object.fromEntries(Array.from({length:19},(_,j)=>[`data_${j}`,'விவரக்குறிப்பு'.repeat(8)]))},
 }));
 const facets:DiscoveryFacet[]=Array.from({length:12},(_,i)=>({
  key:i===0?'spec:diameter':`spec:dimension_${i}`,label:i===0?'diameter':`dimension ${i}`,totalValues:9,
  values:Array.from({length:9},(_,j)=>({value:`${j+1} inch`,label:`${j+1} inch`,count:10-j,product:products[j]})),
 }));
 return {
  tool:'discover_products',query,totalCount:50,products,
  discovery:{query,plan:{keywords:[query]},products,rankings:[],totalCount:50,retrievedCount:10,facets,noExactMatch:false,
   ...(grouped?{matchStatus:'needs_detail' as const,groups:[
    {key:'family',value:'pipe',label:'Pipe',count:31,product:products[0]},
    {key:'family',value:'tube',label:'Tube',count:19,product:products[1]},
   ]}:{}),
   diagnostics:{canonicalQuery:query,appliedConstraints:{familyIds:[],specifications:{diameter:`${index+1} inch`},measurements:[]},sqlMatchCount:50,scannedCount:50,rejectedCount:0,identity:'none',candidateLimited:false,uncertainty:[]},
  },
 };
}
const observations=[observe('PVC pipe',0,true),observe('steel pipe',1),observe('solvent',2)];
const catalogMap:CatalogMap={store:{name:'Hardware',type:'hardware'},productCount:400,truncated:false,departments:Array.from({length:10},(_,department)=>({
 id:`dept-${department}`,label:`Department ${department}`,count:40,families:Array.from({length:20},(_,family)=>({
  id:`dept-${department}-family-${family}`,label:`Family ${family}`,count:2,aliases:['குழாய்'.repeat(20),'பொருட்கள்'.repeat(10)],
 })),
}))};

test('inventory patches fit admission across three queries and retain independent criteria and grouped facts',async()=>{
 assert.ok(Buffer.byteLength(JSON.stringify(observations))>inputAdmissionLimits.textBytes);
 let request:GenerateContentParameters|undefined;
 const provider=new GoogleInterpreter(settings,{generateContent:async value=>{request=value;return {} as GenerateContentResponse;}});
 const input:InterpretationInput={text:source,state,proposal,catalogMap,observations,inventoryReplan:true,planningFeedback:'Ground the requested items.'};
 const prepared=provider.prepareInput(input);
 await prepared.interpret(new AbortController().signal);
 assert.equal(prepared.admission.requestHash,admitRequest(request!).requestHash);
 assert.ok(prepared.admission.textBytes<inputAdmissionLimits.textBytes);
 const content=(request!.contents as {parts:{text:string}[]}[])[0].parts[0].text;
 const prompt=JSON.parse(content);
 assert.deepEqual(prompt.groundingTargets,{items:[{ordinal:2,query:'PVC pipe'},{ordinal:4,query:'steel pipe'}],replacements:[{index:1,query:'solvent'}]});
 assert.deepEqual(prompt.repair.priorProposal.understanding.requestedItems,proposal.understanding!.requestedItems.slice(0,2));
 assert.deepEqual(prompt.repair.priorProposal.understanding.proposedEdits,[{index:1,...proposal.understanding!.proposedEdits[1]}]);
 assert.equal(prompt.repair.observations,undefined);
 assert.equal(prompt.storeContext,undefined);
 assert.deepEqual(prompt.catalogObservations.map((fact:typeof observations[number])=>[fact.query,fact.products.map(p=>p.sku)]),observations.map(fact=>[fact.query,fact.products.map(p=>p.sku)]));
 assert.deepEqual(prompt.catalogObservations[0].groups.map(({value,count}:{value:string;count:number})=>({value,count})),[{value:'pipe',count:31},{value:'tube',count:19}]);
 assert.equal(prompt.catalogObservations[0].facets[0].values[0].value,'1 inch');
 assert.equal(prompt.catalogObservations[1].products[0].specifications.diameter,'2 inch');
 assert.deepEqual(prompt.catalogObservations[2].diagnostics.appliedConstraints.specifications,{diameter:'3 inch'});
 assert.doesNotMatch(content,/raw-image-path/);
});

test('evidence repairs carry the rejected proposal and one bounded set of catalog facts',async()=>{
 let request:GenerateContentParameters|undefined;
 const provider=new GoogleInterpreter(settings,{generateContent:async value=>{request=value;return {} as GenerateContentResponse;}});
 const prepared=provider.prepareInput({text:source,state,proposal,observations,planningFeedback:'Check the size.',repairSourceKind:'audio'});
 await prepared.interpret(new AbortController().signal);
 const prompt=JSON.parse((request!.contents as {parts:{text:string}[]}[])[0].parts[0].text);
 assert.equal(prompt.repair.originalInputKind,'audio');
 assert.deepEqual(prompt.repair.priorProposal,proposal);
 assert.equal(prompt.repair.observations,undefined);
 assert.equal(prompt.catalogObservations.length,3);
 assert.equal(prepared.admission.requestHash,admitRequest(request!).requestHash);
 assert.throws(()=>provider.validateInput({text:'x'.repeat(inputAdmissionLimits.textBytes),state}),/including instructions and schema/);
});

test('one bounded grounding request can retain the SQL candidates for five independent items',()=>{
 const names=['sandpaper','hardware tape','wire cutter','safety gloves','safety glasses'];
 const observations=names.map((name,index)=>observe(name,index));
 const items=names.map((query,ordinal)=>({ordinal,query,sourceText:query,purchaseCount:null,unresolved:[] as []}));
 const input:InterpretationInput={
  text:names.join(', '),state,observations,inventoryReplan:true,planningFeedback:'Ground these requests independently.',
  proposal:{operations:[],next:'continue',understanding:{...proposal.understanding!,requestedItems:items,proposedEdits:[]}},
 };
 const provider=new GoogleInterpreter(settings,{generateContent:async()=>{throw new Error('Offline test');}});
 assert.ok(provider.prepareInput(input).admission.textBytes<inputAdmissionLimits.textBytes);
 const prompt=JSON.parse(understandingPrompt(input));
 assert.deepEqual(prompt.groundingTargets.items,items.map(({ordinal,query})=>({ordinal,query})));
 assert.deepEqual(prompt.catalogObservations.map((fact:CatalogObservation)=>fact.products.map(p=>p.sku)),observations.map(fact=>fact.products.map(p=>p.sku)));
});
