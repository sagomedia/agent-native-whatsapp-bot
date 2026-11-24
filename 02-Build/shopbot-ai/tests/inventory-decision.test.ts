import assert from 'node:assert/strict';
import test from 'node:test';
import {InventoryDecisionProvider,compactDecisionLines} from '../apps/server/src/adapters/inventory-decision.js';
import {understandingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';
import type {InterpretationInput} from '../apps/server/src/adapters/interpreter.js';
import {validateInventoryReplan} from '../apps/server/src/services/inventory-grounding.js';
import {geminiDecisionRate,usageEstimate,worstCaseReservation} from '../apps/server/src/services/inference-budget.js';
import type {DiscoveryResult,Interpretation} from '../packages/contracts/index.js';

function groceryInput():InterpretationInput{
 const state={version:0,draft:[],pending:null,lastRequestId:null,fulfillment:'pickup' as const,replyLanguage:'en' as const};
 const text='Set aside two cartons of oat drink for me';
 const item={ordinal:0,sourceText:'two cartons of oat drink',query:'oat drink',purchaseCount:2,unresolved:[],search:{keywords:['oat drink']}};
 const proposal=understandingToInterpretation({schemaVersion:2,inputKind:'text',intents:['add'],requestedItems:[item],proposedEdits:[],shopQuestions:[],unresolved:[]},{text,state},false);
 const products=['Plain oat drink','Barista oat drink','Oat drink frother'].map((name,i)=>({sku:'SKU'+i,name,unit:'carton',pricePaise:100,stock:4,version:1,aliases:[],quantityStep:1}));
 const discovery:DiscoveryResult={query:'oat drink',plan:{keywords:['oat drink']},products,rankings:[],totalCount:3,retrievedCount:3,facets:[],noExactMatch:false,matchStatus:'ambiguous'};
 return {state,text,proposal,inventoryReplan:true,observations:[{tool:'discover_products',query:'oat drink',products,totalCount:3,discovery}]};
}

function reviewer(scores:number[]){
 return new InventoryDecisionProvider('offline',async(_url,request)=>{
   const body=JSON.parse(String(request?.body));
   const answers=Object.fromEntries(scores.map((noul,i)=>[Object.keys(body.questions)[i],{type:'noul',noul}]));
   return Response.json({answers,usage:{total_input_tokens:123,total_output_tokens:0,total_tokens:123}});
 });
}

test('compact review keeps both oat drinks and the stated count while excluding the appliance',async()=>{
 const input=groceryInput(),provider=reviewer([.96,.91,.03]);
 const result=await provider.interpret(input,AbortSignal.timeout(2000));
 const plan=validateInventoryReplan(input.proposal!,result.output as Interpretation,input.observations!);
 const line=plan.understanding!.requestedItems[0];
 assert.deepEqual(line.search?.selectedSkus,['SKU0','SKU1']);assert.equal(line.purchaseCount,2);
 assert.deepEqual(usageEstimate(geminiDecisionRate,result),{microusd:13,violation:false});
 assert.equal(worstCaseReservation(geminiDecisionRate),26215);
});

test('absent, weak and incomplete decisions abstain with accounted usage',async()=>{
 for(const scores of [[.02,.1,.15],[.95,.5,.02],[.98]]){
   const result=await reviewer(scores).interpret(groceryInput(),AbortSignal.timeout(2000));
   assert.deepEqual(result.output,{operations:[],next:'continue'});assert.equal(result.usage?.promptTokenCount,123);
 }
});

test('broad, empty, alternative and indistinguishable line observations use existing review',()=>{
 for(const reason of ['broad','empty','alternative','duplicate']){
   const input=groceryInput(),obs=input.observations![0];
   if(reason==='broad')obs.totalCount=20;
   if(reason==='empty')obs.products=[];
   if(reason==='alternative')obs.discovery!.matchStatus='alternatives';
   if(reason==='duplicate')input.proposal!.understanding!.requestedItems.push({...input.proposal!.understanding!.requestedItems[0],ordinal:1});
   assert.equal(compactDecisionLines(input),undefined);
 }
});
