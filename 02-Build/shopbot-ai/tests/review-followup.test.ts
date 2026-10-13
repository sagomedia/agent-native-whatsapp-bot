import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {ConversationState,Operation} from '../packages/contracts/index.js';
import {safeQuestion} from '../packages/contracts/language.js';
import {additionalMention,removalMention} from '../packages/contracts/intent-language.js';
import {protectQuantityEvidence,spokenMeasures} from '../apps/server/src/services/quantity-evidence.js';
import {validateCurrentTurn} from '../apps/server/src/services/current-turn.js';
import {spokenClearCommand,negatedSpokenClear} from '../apps/server/src/services/shopping-language.js';
import {understandingPrompt,understandingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';

const state:ConversationState={version:0,draft:[],pending:null,fulfillment:'pickup',lastRequestId:null,replyLanguage:'en'};
const base={schemaVersion:2,inputKind:'text',intents:['add'],requestedItems:[],proposedEdits:[],shopQuestions:[],unresolved:[]};

for(const [description,query,evidence] of [
 ["I don't want the PVC pipe, I want a garden pipe",'garden pipe','I want a garden pipe'],
 ['PVC பைப் வேண்டாம், பம்ப் பைப் வேணும்','pump pipe','பம்ப் பைப் வேணும்'],
 ["I don't want the PVC pipe, I want a garden pipe",'garden pipe',"I don't want the PVC pipe, I want a garden pipe"],
] as const)test(`replacement scopes rejection to its product: ${description} (${evidence})`,()=>{
 const operation:Operation={kind:'add_item',query,quantity:1,supportingPhrase:evidence};
 assert.equal(validateCurrentTurn([operation],description,state)[0].kind,'add_item');
});
test('a declined product remains rejected',()=>{
 const description="I don't want the PVC pipe, I want a garden pipe";
 assert.throws(()=>validateCurrentTurn([{kind:'add_item',query:'PVC pipe',quantity:1,supportingPhrase:description}],description,state),/declined|negated/);
 assert.throws(()=>validateCurrentTurn([{kind:'add_item',query:'garden pipe',quantity:1,supportingPhrase:"I don't want garden pipe"}],"I don't want garden pipe",state),/negated/);
});

for(const [unit,canonical] of [['ltr','litre'],['lt','litre'],['kgs','kg'],['mtr','m'],['அங்குலம்','inch'],['லிட்டரு','litre']] as const){
 test(`unit alias ${unit} cannot become a count`,()=>{
  const phrase=`10 ${unit} paint`;
  const op=protectQuantityEvidence([{kind:'add_item',query:'paint',quantity:10,supportingPhrase:phrase}],phrase)[0];
  assert.equal(op.kind==='add_item'?op.quantity:undefined,null);
  assert.deepEqual(spokenMeasures(phrase),[{value:10,unit:canonical}]);
 });
}
test('an explicit pack count survives an abbreviated physical unit',()=>{
 const phrase='two 10 ltr cans';
 const op=protectQuantityEvidence([{kind:'add_item',query:'paint',quantity:2,supportingPhrase:phrase}],phrase)[0];
 assert.equal(op.kind==='add_item'?op.quantity:undefined,2);
});

test('numeric questions use current product dimensions and line numbers only',()=>{
 const current:ConversationState={...state,draft:[{id:randomUUID(),query:'1 inch pipe',name:'1 inch pipe',quantity:2,resolution:'needs_choice'}]};
 assert.equal(safeQuestion('Which brand of 1 inch pipe?',current),'Which brand of 1 inch pipe?');
 assert.equal(safeQuestion('Which existing item: 1. pipe?',current),'Which existing item: 1. pipe?');
 assert.equal(safeQuestion('Which brand of 42mm pipe?',current),undefined);
 for(const question of ['Is the price ₹2?','Is stock 2?','Can I guarantee this fits?'])assert.equal(safeQuestion(question,current),undefined);
});

for(const phrase of ['பட்டியலை காலி செய்யுங்க','பட்டியலை காலி பண்ணுங்க','லிஸ்ட்டை கிளியர் பண்ணுங்க','list ellam clear pannidu','ok clear my list please','no more items, பட்டியலை காலி செய்']){
 test(`clear-list command: ${phrase}`,()=>{
  assert.equal(spokenClearCommand(phrase),'clear my list');
  assert.equal(negatedSpokenClear(phrase),false);
 });
}
for(const phrase of ["don't clear my list",'பட்டியலை காலி செய்யுங்க வேண்டாம்','list clear pannu venam','clear my list and add a hose','Should I clear my list?']){
 test(`clear-list protection: ${phrase}`,()=>assert.equal(spokenClearCommand(phrase),undefined));
}

test('repair receives failure, previous proposal and observations with text modality',()=>{
 const proposal={operations:[],next:'continue' as const};
 const input={text:'two pipes',state,proposal,planningFeedback:'Choose a current target',repairSourceKind:'audio' as const,observations:[]};
 const prompt=JSON.parse(understandingPrompt(input));
 assert.equal(prompt.inputKind,'text');assert.equal(prompt.customerText,'two pipes');
 assert.equal(prompt.repair.originalInputKind,'audio');assert.equal(prompt.repair.feedback,input.planningFeedback);
 assert.deepEqual(prompt.repair.priorProposal,proposal);assert.deepEqual(prompt.repair.observations,[]);
 assert.notEqual(understandingPrompt(input),understandingPrompt({...input,planningFeedback:undefined}));
});
test('clear_list is a no-op proposal and cannot contain shopping operations',()=>{
 const clear={...base,intents:['clear_list']};
 assert.deepEqual(understandingToInterpretation(clear,{text:'clear this entire basket',state},false).operations,[]);
 assert.throws(()=>understandingToInterpretation({...clear,requestedItems:[{ordinal:0,query:'pipe',sourceText:'pipe',purchaseCount:1,unresolved:[]}]},{text:'pipe',state},false),/cannot include/);
});
test('shared edit vocabulary covers normal Tamil and Tanglish wording',()=>{
 for(const phrase of ['two extra pipes','இன்னும் ரெண்டு','rendu more'])assert.equal(additionalMention.test(phrase),true);
 for(const phrase of ['venam','vena','வேணாங்க','நீக்கிடு','எடுத்துடு'])assert.equal(removalMention.test(phrase),true);
});
