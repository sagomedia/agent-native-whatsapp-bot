import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cartChangeFeedback} from '../apps/server/src/services/cart-change-feedback.js';
import type {ConversationState,DraftLine} from '../packages/contracts/index.js';

const line=(id:string,name:string,quantity:number|null,extra:Partial<DraftLine>={}):DraftLine=>({id,name,query:name,quantity,resolution:quantity===null?'needs_quantity':'matched',...extra});
const cart=(draft:DraftLine[],replyLanguage:ConversationState['replyLanguage']='en')=>({draft,replyLanguage});

test('names an actual removal rather than echoing the new item count',()=>{
 const a=line('a','screwdriver',2,{unit:'piece'}),b=line('b','screw box',1,{unit:'box'});
 assert.equal(cartChangeFeedback(cart([a,b]),cart([b])),'Removed screwdriver');
});

test('reports a known count edit in the chosen language',()=>{
 const before=line('a','PVC pipe',2,{unit:'piece'}),after={...before,quantity:3};
 assert.equal(cartChangeFeedback(cart([before]),cart([after])),'Changed PVC pipe (3 pieces)');
 assert.equal(cartChangeFeedback(cart([before],'ta'),cart([after],'ta')),'PVC pipe மாற்றப்பட்டது (3 எண்ணம்)');
 assert.equal(cartChangeFeedback(cart([before],'ta-Latn'),cart([after],'ta-Latn')),'PVC pipe maaththiyaachu (3 ennam)');
});

test('unknown count stays unknown and a requested physical amount is labeled requested',()=>{
 const unknown=line('a','garden hose',null);
 assert.equal(cartChangeFeedback(cart([]),cart([unknown])),'Added garden hose');
 const requested={...unknown,requestedAmount:{value:50,unit:'metre'}};
 assert.equal(cartChangeFeedback(cart([unknown]),cart([requested])),'Changed garden hose (requested 50 metres)');
 const continuous={...requested,amountMode:'continuous' as const};
 assert.equal(cartChangeFeedback(cart([requested]),cart([continuous])),'Changed garden hose (requested 50 metres in one continuous length)');
 assert.equal(cartChangeFeedback(cart([requested],'ta'),cart([continuous],'ta')),'garden hose மாற்றப்பட்டது (கேட்ட அளவு 50 மீட்டர் ஒரே நீளமாக)');
 const counted={...requested,quantity:5,unit:'roll'};
 assert.equal(cartChangeFeedback(cart([requested]),cart([counted])),'Changed garden hose (list count 5 rolls)');
 const clearing={...requested,quantity:null,requestedAmount:undefined};
 assert.equal(cartChangeFeedback(cart([requested]),cart([clearing])),'Changed garden hose (count to confirm)');
});

test('requested count is not presented as a verified selling count',()=>{
 const unknown=line('a','paint',null,{requestedQuantity:2,requestedUnit:'can'});
 assert.equal(cartChangeFeedback(cart([]),cart([unknown])),'Added paint (requested 2 cans)');
});

test('no-op, price refresh and issue changes produce no mutation claim',()=>{
 const a=line('a','paint',2,{unit:'can'});
 assert.equal(cartChangeFeedback(cart([a]),cart([structuredClone(a)])),undefined);
 assert.equal(cartChangeFeedback(cart([a]),cart([{...a,pricePaise:999,catalogIssue:'insufficient_stock'}])),undefined);
});

test('compound replacement only reports the persisted before/after difference',()=>{
 const old=line('a','screwdriver',1,{unit:'piece'}),kept=line('b','hammer',1,{unit:'piece'}),next=line('c','screw box',2,{unit:'box'});
 assert.equal(cartChangeFeedback(cart([old,kept]),cart([kept,next])),'Removed screwdriver; Added screw box (2 boxes)');
 assert.equal(cartChangeFeedback(cart([old,kept]),cart([old,kept])),undefined);
});

test('large compound edits remain one compact, truthful line',()=>{
 const removed=Array.from({length:6},(_,i)=>line(String(i),`item ${i}`,1));
 const text=cartChangeFeedback(cart(removed),cart([]))!;
 assert.match(text,/Removed item 0; Removed item 1; Removed item 2; 3 more changes/);
 assert.ok(text.length<=250);
});

test('three ordinary removals name every target, and long names stay readable',()=>{
 const three=['Fevicol','drill machine','screw box'].map((name,i)=>line(String(i),name,1));
 assert.equal(cartChangeFeedback(cart(three),cart([])),'Removed Fevicol; Removed drill machine; Removed screw box');
 const text=cartChangeFeedback(cart([line('long','Premium product '.repeat(30),1)]),cart([]))!;assert.match(text,/^Removed Premium product/);assert.ok(text.length<=250);
});
