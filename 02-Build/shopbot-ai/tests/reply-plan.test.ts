import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {planReply} from '../apps/server/src/services/reply-plan.js';
import {visualReply} from '../apps/server/src/services/visual-ordering.js';
import {shoppingActions} from '../apps/server/src/services/shopping-actions.js';
import {requestStatusText} from '../apps/server/src/services/request-status.js';
import type {ConversationState,DraftLine,Product,RichReply} from '../packages/contracts/index.js';
const product:Product={sku:'P',name:'Verified fixture',unit:'piece',pricePaise:100,stock:10,version:1,aliases:[],quantityStep:2};
const line:DraftLine={id:randomUUID(),sku:'P',name:product.name,quantity:2,unit:'piece',pricePaise:100,productVersion:1,resolution:'matched',candidates:[product]};
const reply:RichReply={version:1,kind:'text',text:'Which pipe type?',presentation:'text',outboundMessages:1,stage:'identify'};
function state():ConversationState{return {version:1,draft:[structuredClone(line)],pending:null,fulfillment:'pickup',lastRequestId:null,visualOrdering:true,replyLanguage:'en'};}
test('the shared planner respects the current line and refuses quantity-step, stale-price and missing-consent bills',()=>{
 const s=state(),other={...structuredClone(line),id:randomUUID(),quantity:null,resolution:'needs_quantity' as const};s.draft.push(other);s.pending={kind:'question',id:randomUUID(),lineId:other.id,version:1};assert.equal(planReply(reply,s).line?.id,other.id);
 s.draft=[{...line,quantity:1}];s.pending={kind:'review',id:randomUUID(),version:1,hash:'fixture',expiresAt:new Date(Date.now()+60000).toISOString(),lines:s.draft,totalPaise:100,fulfillment:'pickup'};
 const base={...reply,kind:'order_review' as const,buttons:[{label:'Send',event:{id:randomUUID(),type:'confirm' as const,reviewId:s.pending.id}}]};assert.equal(planReply(base,s).mayOfferSubmission,false);assert.ok(!shoppingActions(base,s).buttons?.some(b=>b.event.type==='confirm'));const guarded=visualReply(base,s);assert.ok(![...(guarded.buttons??[]),...(guarded.parts??[]).flatMap(p=>[...(p.buttons??[]),...p.cards.flatMap(c=>c.buttons??[])])].some(b=>b.event.type==='confirm'));
 s.draft=[{...line}];assert.equal(planReply(base,s).mayOfferSubmission,true);s.requireProductConfirmation=true;assert.equal(planReply(base,s).mayOfferSubmission,false);
});
for(const language of ['en','ta','ta-Latn'] as const)test(`${language}: simple pipe clarification is a native version-bound reply and read-only interruptions preserve the active question`,()=>{
 const s=state();s.replyLanguage=language;s.draft=[{id:line.id,name:'1 inch pipe',query:'1 inch pipe',quantity:2,productMeasures:[{value:1,unit:'inch'}],resolution:'needs_choice'}];s.pending={kind:'question',id:randomUUID(),lineId:line.id,version:1};
 const before=JSON.stringify(s),native=visualReply(reply,s);assert.equal(native.outboundMessages,1);const cards=native.parts![0].cards;assert.equal(cards.length,3);assert.ok(cards.every(c=>c.kind==='instruction'));const buttons=cards.flatMap(c=>c.buttons??[]);assert.equal(buttons.length,3);assert.ok(buttons.every(b=>b.event.type==='choose_pipe_type'&&b.event.questionId===(s.pending as {id:string}).id&&b.event.expectedVersion===s.version));
 assert.deepEqual(buttons.map(b=>b.event.type==='choose_pipe_type'&&b.event.pipeType),['pvc','hose','pump']);const price={...reply,text:'Price: ₹1.00 / piece',readOnly:true as const};assert.deepEqual(visualReply(shoppingActions(price,s),s),price);assert.equal(JSON.stringify(s),before);
});
test('verified payment status does not claim pickup collection or erase a cancelled fulfillment',()=>{
 const request={id:randomUUID(),acceptance:'accepted' as const,payment:'paid' as const,fulfillment:'cancelled' as const,totalPaise:10000,lines:[]};const text=requestStatusText(request);assert.match(text,/cancelled/);assert.match(text,/Payment captured/);assert.doesNotMatch(text,/not record a payment|waiting for.*approval/);assert.match(text,/Original request estimate/);
});
