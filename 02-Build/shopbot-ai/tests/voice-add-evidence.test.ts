import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {understandingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';
import {validateCurrentTurn} from '../apps/server/src/services/current-turn.js';
import type {ConversationState} from '../packages/contracts/index.js';

const state:ConversationState={version:0,draft:[],pending:null,fulfillment:'pickup',lastRequestId:null,replyLanguage:'ta'};
function item(ordinal:number,query:string,sourceText:string,countText:string,purchaseCount:number,targetLineId?:string){
 return {ordinal,query,sourceText,purchaseCount,targetLineId,countEvidence:{sourceText:countText,value:purchaseCount,mode:'total'},unresolved:[]};
}
function compile(text:string,requestedItems:ReturnType<typeof item>[],current=state,voiceTranscript=true){
 return understandingToInterpretation({schemaVersion:2,inputKind:'text',intents:['add'],requestedItems,proposedEdits:[],shopQuestions:[],unresolved:[]},{text,state:current,inventoryGrounding:true,voiceTranscript},false);
}

test('voice item names quoted without counts reattach their own prefix or suffix, including repeated nouns',()=>{
 const text='வேணும் ஒரு கத்தரி, அடுத்து வந்து ஒரு கரண்டி, கரண்டி ஒன்னு, தூரிகை, தூரிகை ஒன்னு, அடுத்து வந்து ஒரு குவளை, சமையல் கையுறை ஒன்னு.';
 const rows=[
  item(1,'scissors','கத்தரி','ஒரு',1),
  item(2,'spoon','கரண்டி','ஒன்னு',1),
  item(3,'brush','தூரிகை','ஒன்னு',1),
  item(4,'mug','குவளை','ஒரு',1),
  item(5,'oven mitt','சமையல் கையுறை','ஒன்னு',1),
 ];
 const plan=compile(text,rows),operations=validateCurrentTurn(plan.operations,text,state);
 assert.deepEqual(operations.map(op=>op.kind==='add_item'?[op.query,op.quantity,op.supportingPhrase]:null),[
  ['scissors',1,'ஒரு கத்தரி'],['spoon',1,'கரண்டி ஒன்னு'],['brush',1,'தூரிகை ஒன்னு'],['mug',1,'ஒரு குவளை'],['oven mitt',1,'சமையல் கையுறை ஒன்னு'],
 ]);
 assert.throws(()=>compile(text,rows,state,false),/Purchase count evidence/,'the alternate strict text path is unchanged');
});

test('a neighboring item or measurement cannot supply a new voice item count',()=>{
 const text='Mango, two apples, 2 litre juice, gloves one masks.';
 const rows=[
  item(1,'mango','Mango','two',2),item(2,'apples','apples','two',2),item(3,'juice','juice','2',2),
  item(4,'gloves','gloves','one',1),item(5,'masks','masks','one',1),
 ];
 const operations=validateCurrentTurn(compile(text,rows).operations,text,state);
 assert.deepEqual(operations.map(op=>op.kind==='add_item'?[op.query,op.quantity]:null),[['mango',null],['apples',2],['juice',null],['gloves',null],['masks',null]]);
});

test('a voice add count cannot bypass evidence for an existing item or negated action',()=>{
 const id=randomUUID();
 const current:ConversationState={...state,draft:[{id,name:'gloves',query:'gloves',quantity:4,resolution:'unavailable'}]};
 assert.throws(()=>compile('gloves, two masks',[item(1,'gloves','gloves','two',2,id),item(2,'masks','masks','two',2)],current),/Purchase count evidence/);
 assert.throws(()=>compile("don't add two gloves",[item(1,'gloves','gloves','two',2)]),/Purchase count evidence|negates/);
});
