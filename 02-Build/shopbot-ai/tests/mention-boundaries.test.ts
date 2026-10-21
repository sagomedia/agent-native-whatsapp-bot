import test from 'node:test';
import assert from 'node:assert/strict';
import {consolidateMentions} from '../apps/server/src/adapters/mention-reconciliation.js';
import {explicitPurchaseCount} from '../apps/server/src/services/quantity-evidence.js';
const item=(sourceText:string,count:number|null,ordinal:number)=>({ordinal,sourceText,query:sourceText,purchaseCount:count,unresolved:[]});
test('prefix, postfix, mixed and equal counts stay attached to their own literal clauses',()=>{
 for(const [source,a,b] of [['two pipes three elbows',2,3],['pipes two elbows three',2,3],['two pipes elbows three',2,3],['pipes two elbows two',2,2],['pipe rendu elbow moonu',2,3]] as const){const names=source.includes('moonu')?['pipe','elbow']:['pipes','elbows'];const rows=consolidateMentions(names.map((n,j)=>item(n,j?b:a,j)),source,false);assert.deepEqual(rows.map(r=>explicitPurchaseCount(r.sourceText)),[a,b],source);for(const row of rows)assert.ok(source.includes(row.sourceText));}
});
test('one intervening count cannot be borrowed by two items or assigned across an unresolved neighbour',()=>{
 assert.throws(()=>consolidateMentions([item('pipes',3,0),item('elbows',3,1)],'two pipes three elbows',false),/clarification/);
 assert.throws(()=>consolidateMentions([item('pipes',2,0),item('elbows',null,1)],'pipes two elbows',false),/clarification/);
});
