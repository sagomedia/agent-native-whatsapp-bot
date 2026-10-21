import {test} from 'node:test';
import assert from 'node:assert/strict';
import {namedEditLines} from '../apps/server/src/adapters/mention-reconciliation.js';
import {cartEditCandidates} from '../apps/server/src/services/cart-edit-targets.js';
import type {ConversationState,DraftLine} from '../packages/contracts/index.js';
import type {TurnUnderstanding} from '../packages/contracts/understanding.js';

function state(...names:string[]):ConversationState {
 const draft:DraftLine[]=names.map((name,index)=>({id:`line-${index}`,query:name,name,quantity:1,resolution:'unavailable'}));
 return {version:1,draft,pending:null,fulfillment:'pickup',lastRequestId:null,replyLanguage:'en',visualOrdering:true};
}

test('a named cutter or brush variant cannot delete a different variant with a shared noun',()=>{
 const cart=state('pipe cutter','wire brush');
 assert.deepEqual(namedEditLines('remove wire cutter',cart),[]);
 assert.deepEqual(namedEditLines('remove paint brush',cart),[]);
 assert.deepEqual(namedEditLines('remove pipe cutter',cart).map(line=>line.id),['line-0']);
 assert.deepEqual(namedEditLines('remove wire brush',cart).map(line=>line.id),['line-1']);
});

test('a model target cannot override an explicitly different spoken product variant',()=>{
 const cart=state('pipe cutter');
 const edit={kind:'remove_item',targetLineId:'line-0',targetQuery:'pipe cutter',sourceText:'remove wire cutter'} as TurnUnderstanding['proposedEdits'][number];
 assert.deepEqual(cartEditCandidates(edit,cart),[]);
});
