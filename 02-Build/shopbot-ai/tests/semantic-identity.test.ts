import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {ConversationState,DraftLine,Product} from '../packages/contracts/index.js';
import {compatibleLine,existingMention} from '../apps/server/src/adapters/mention-reconciliation.js';
import {understandingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';

const pvc:Product={sku:'H02',name:'1 inch PVC Pipe Blueguard ISI',brand:'Blueguard',familyId:'pvc-pipes',unit:'piece',pricePaise:38000,stock:60,version:1,aliases:['1 inch pipe','Blueguard PVC pipe'],quantityStep:1,specifications:{size:'1 inch'}};
const line:DraftLine={id:randomUUID(),sku:pvc.sku,name:pvc.name,query:'1 inch pipe',quantity:2,unit:'piece',pricePaise:pvc.pricePaise,productVersion:1,resolution:'matched',candidates:[pvc]};
const state:ConversationState={version:1,draft:[line],pending:null,fulfillment:'pickup',lastRequestId:null,replyLanguage:'en'};
const item=(sourceText:string,query:string,count:number|null=2,targetLineId?:string)=>({ordinal:0,sourceText,query,purchaseCount:count,unresolved:[],...(targetLineId?{targetLineId}:{})});
const interpretation=(source:string,query:string,targetLineId?:string,count=2)=>understandingToInterpretation({schemaVersion:2,inputKind:'text',intents:['add','edit'],requestedItems:[item(source,query,count,targetLineId)],proposedEdits:[],shopQuestions:[],unresolved:[]},{text:source,state},true);

test('query-only pump type and brand cannot inherit a PVC catalog identity',()=>{
 for(const [source,query] of [['two BSA one-inch pipes','BSA 1 inch pipe'],['two water pumping pipes','water pumping pipe'],['two rubber suction pipes','rubber suction pipe']] as const){
  assert.equal(compatibleLine(item(source,query),line),false,query);
  const plan=interpretation(source,query);
  assert.equal(plan.operations.length,1);
  assert.equal(plan.operations[0].kind,'add_item',query);
  assert.match((plan.operations[0] as {query:string}).query,new RegExp(query.split(' ')[0],'i'));
 }
});

test('a model target alone cannot replace an unrelated PVC item; an explicit correction can',()=>{
 const newProduct=interpretation('two BSA water pumping pipes','BSA water pumping pipe',line.id);
 assert.equal(newProduct.operations[0].kind,'add_item');
 const correction=interpretation('No, replace that with two BSA water pumping pipes','BSA water pumping pipe',line.id);
 assert.equal(correction.operations[0].kind,'resolve_line');
 assert.equal((correction.operations[0] as {query:string}).query,'BSA water pumping pipe');
 assert.equal((correction.operations[0] as {lineId:string}).lineId,line.id);
 const unboundCorrection=interpretation('No, replace that pipe with two BSA water pumping pipes','BSA water pumping pipe');
 assert.equal(unboundCorrection.operations[0].kind,'resolve_line');
 assert.equal((unboundCorrection.operations[0] as {lineId:string}).lineId,line.id);
});

test('a bare pipe count asks whether it changes the current typed item',()=>{
 const plan=interpretation('two pipes','pipe');
 assert.deepEqual(plan.operations,[]);
 assert.match(plan.clarifyQuestion??'',/existing|different/);
 assert.ok(plan.understanding?.unresolved.includes('cart_target'));
 const modelTarget=interpretation('two pipes','pipe',line.id);
 assert.deepEqual(modelTarget.operations,[]);
 assert.match(modelTarget.clarifyQuestion??'',/existing|different/);
});

test('explicit same-item references set total count and preserve a compatible SKU',()=>{
 const plan=interpretation('make the same one-inch pipe three in total','1 inch pipe',line.id,3);
 assert.equal(plan.operations[0].kind,'resolve_line');
 assert.equal((plan.operations[0] as {quantity:number}).quantity,3);
 assert.equal('query' in plan.operations[0],false);
 const generic=interpretation('the same pipe, two total','pipe');
 assert.equal(generic.operations[0].kind,'resolve_line');
 assert.equal('query' in generic.operations[0],false);
});

test('PVC heard for the cutter cannot turn an earlier bare pipe into a PVC pipe',()=>{
 const transcript='எனக்கு வந்து ரெண்டு பைப்பு வேணும், ஒரு இன்ச் பைப்பு. அடுத்து இது பைப்பு கட்டர், பிவிசி பைப்பு கட்டர் இருந்தா அவ்வளவுதான்.';
 const output={schemaVersion:2,inputKind:'audio',transcript,intents:['add'],requestedItems:[
  {ordinal:1,sourceText:'ரெண்டு பைப்பு வேணும், ஒரு இன்ச் பைப்பு',query:'1 inch PVC pipe',material:'PVC',purchaseCount:2,dimensions:[{role:'diameter',value:1,unit:'inch'}],unresolved:[]},
  {ordinal:2,sourceText:'பைப்பு கட்டர், பிவிசி பைப்பு கட்டர்',query:'PVC pipe cutter',purchaseCount:null,unresolved:[]},
 ],proposedEdits:[],shopQuestions:[],unresolved:[]};
 const plan=understandingToInterpretation(output,{text:'audio',audio:{mimeType:'audio/wav',data:'AAAA',durationSeconds:23},state},true);
 assert.equal(plan.operations.length,1);
 assert.equal(plan.operations[0].kind,'add_item');
 assert.equal((plan.operations[0] as {query:string}).query,'PVC pipe cutter');
 assert.match(plan.clarifyQuestion??'',/existing|different/);
 assert.ok(plan.understanding?.unresolved.includes('cart_target'));
});

test('a brand borrowed from the old cart is removed when the customer did not say it',()=>{
 const source='two one inch pipes';
 const output={schemaVersion:2,inputKind:'text',intents:['add'],requestedItems:[{...item(source,'Blueguard 1 inch pipe'),brand:'Blueguard',dimensions:[{role:'diameter',value:1,unit:'inch'}]}],proposedEdits:[],shopQuestions:[],unresolved:[]};
 const plan=understandingToInterpretation(output,{text:source,state},true);
 assert.deepEqual(plan.operations,[]);
 assert.match(plan.clarifyQuestion??'',/existing|different/);
 assert.ok(plan.understanding?.unresolved.includes('cart_target'));
});

test('a model pointer cannot select one of several pipes even with an already-said cue',()=>{
 const second={...line,id:randomUUID()};const multi={...state,draft:[line,second]};
 const source='the pipe already listed, two extra';const plan=understandingToInterpretation({schemaVersion:2,inputKind:'text',intents:['edit'],requestedItems:[{...item(source,'PVC pipe',2,line.id),requestMode:'additional'}],proposedEdits:[],shopQuestions:[],unresolved:[]},{text:source,state:multi},true);
 assert.deepEqual(plan.operations,[]);assert.ok(plan.understanding?.unresolved.includes('cart_target'));
});
test('an extra request for a different brand cannot increment a focused old SKU',()=>{
 const source='two extra BSA water pumping pipes';const plan=understandingToInterpretation({schemaVersion:2,inputKind:'text',intents:['add'],requestedItems:[{...item(source,'BSA water pumping pipe',2,line.id),requestMode:'additional'}],proposedEdits:[],shopQuestions:[],unresolved:[]},{text:source,state:{...state,editingLineId:line.id}},true);
 assert.deepEqual(plan.operations,[]);assert.match(plan.clarifyQuestion??'',/different product/);
});
