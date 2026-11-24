import test from 'node:test';
import assert from 'node:assert/strict';
import {observeUnderstanding,perceptionEnvelope} from '../apps/server/src/services/perception-observation.js';
import {understandingToInterpretation} from '../apps/server/src/adapters/turn-understanding.js';
const state={version:0,draft:[],pending:null,fulfillment:'pickup' as const,lastRequestId:null,replyLanguage:'en' as const};
const base={schemaVersion:2,inputKind:'handwritten_list',observedText:'',intents:['add'],requestedItems:[],proposedEdits:[],shopQuestions:[],unresolved:[]};
test('one malformed row in twenty keeps every original observation and diagnostic but admits no partial list',()=>{
 const requestedItems=Array.from({length:20},(_,ordinal)=>({ordinal,sourceText:`Item ${ordinal+1}`,query:`Item ${ordinal+1}`,purchaseCount:ordinal===16?-1:1,unresolved:[]}));
 const value={...base,observedText:requestedItems.map(i=>i.sourceText).join('\n'),requestedItems},raw=JSON.stringify(value),observation=observeUnderstanding(raw);
 assert.equal(observation.rawText,raw);assert.equal(observation.envelopeValid,true);assert.equal(observation.rows.length,20);assert.deepEqual(observation.rows.filter(r=>!r.valid).map(r=>r.position),[16]);assert.ok(observation.rows[16].issues.some(i=>i.path==='purchaseCount'));assert.ok(perceptionEnvelope(value));
 assert.throws(()=>understandingToInterpretation(value,{text:'',image:{mimeType:'image/jpeg',data:'AAAA'},state},true));
});
test('broken envelopes and truncated JSON retain bytes without fabricated transcript, intent or executable rows',()=>{
 for(const raw of ['{"schemaVersion":2,"requestedItems":[',JSON.stringify({...base,intents:['fabricated'],transcript:'do not invent intent'})]){const o=observeUnderstanding(raw);assert.equal(o.rawText,raw);assert.equal(o.envelopeValid,false);assert.equal(o.transcript,undefined);}
 const large=observeUnderstanding('x'.repeat(262145));assert.equal(large.oversized,true);assert.equal(large.rawText,undefined);assert.equal(large.bytes,262145);assert.equal(large.sha256.length,64);
});
