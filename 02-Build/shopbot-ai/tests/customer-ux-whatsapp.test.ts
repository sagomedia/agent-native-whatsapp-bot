import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';
import type {RichReply} from '../packages/contracts/index.js';

const first={id:'first',type:'shopping_action' as const,action:'edit_list' as const,expectedVersion:1};
const second={id:'second',type:'shopping_action' as const,action:'handoff' as const,expectedVersion:1};
const duplicate='A very long customer action';
const buttons=[{label:duplicate+' one',event:first},{label:duplicate+' two',event:second}];

function assertDistinctBindings(rendered:ReturnType<typeof renderWhatsAppReply>,native:{id:string;title:string}[]){
 assert.equal(native.length,2);
 assert.equal(new Set(native.map(button=>button.title)).size,2);
 assert.deepEqual(native.map(button=>button.id),rendered.actions.map(action=>action.id));
 assert.deepEqual(rendered.actions.map(action=>action.label),native.map(button=>button.title));
 assert.deepEqual(rendered.actions.map(action=>action.event.id),['first','second']);
 assert.ok(native.every(button=>Array.from(button.title).length<=20));
}

test('clipped plain reply buttons remain visibly distinct and retain the correct event',()=>{
 const rich:RichReply={version:1,kind:'text',text:'Choose what to do next',presentation:'text',outboundMessages:1,buttons};
 const rendered=renderWhatsAppReply(rich,'plain-message','shop.example.test');
 assert.equal(rendered.format,'buttons');
 const native=(rendered.payload as any).interactive.action.buttons.map((button:any)=>button.reply);
 assertDistinctBindings(rendered,native);
});

test('clipped image buttons do not discard the product reply',()=>{
 const rich:RichReply={version:1,kind:'product_choices',text:'Choose what to do next',presentation:'carousel_preview',outboundMessages:1,buttons,cards:[{
  product:{sku:'H01',name:'Pipe',unit:'piece',pricePaise:12500,stock:null,version:1,aliases:[],quantityStep:1,imageUrl:'/demo-images/H01.jpg'},
  label:'Choose',
 }]};
 const rendered=renderWhatsAppReply(rich,'image-message','shop.example.test');
 assert.equal(rendered.format,'buttons');
 const native=(rendered.payload as any).interactive.action.buttons.map((button:any)=>button.reply);
 assertDistinctBindings(rendered,native);
});

test('legacy product carousel keeps both actions when their titles clip alike',()=>{
 const product={sku:'H01',name:'Pipe',unit:'piece',pricePaise:12500,stock:null,version:1,aliases:[],quantityStep:1,imageUrl:'/demo-images/H01.jpg'};
 const options={...second,action:'options' as const};
 const rich:RichReply={version:1,kind:'product_choices',text:'Choose a product',presentation:'carousel_preview',outboundMessages:1,
  cards:[{product,label:duplicate+' one',action:first},{product:{...product,sku:'H02',imageUrl:'/demo-images/H02.jpg'},label:duplicate+' one',action:first}],
  buttons:[{label:duplicate+' two',event:options}]};
 const rendered=renderWhatsAppReply(rich,'legacy-carousel','shop.example.test');
 assert.equal(rendered.format,'carousel');
 const native=(rendered.payload as any).interactive.action.cards[0].action.buttons.map((button:any)=>button.quick_reply);
 assertDistinctBindings({...rendered,actions:rendered.actions.slice(0,2)},native);
});

test('ordered carousel buttons disambiguate within each card without changing action IDs',()=>{
 const rich:RichReply={version:1,kind:'text',text:'Choose what to do next',presentation:'text',outboundMessages:1,parts:[{id:'part',text:'Choose what to do next',cards:[
  {kind:'instruction',imageUrl:'/demo-images/H01.jpg',caption:'First step',title:'First step',lines:[],buttons},
  {kind:'instruction',imageUrl:'/demo-images/H02.jpg',caption:'Second step',title:'Second step',lines:[],buttons},
 ]}]};
 const rendered=renderWhatsAppReply(rich,'carousel-message','shop.example.test');
 assert.equal(rendered.format,'carousel');
 const cards=(rendered.payload as any).interactive.action.cards;
 for(const [index,card] of cards.entries()){
  const native=card.action.buttons.map((button:any)=>button.quick_reply);
  assertDistinctBindings({...rendered,actions:rendered.actions.slice(index*2,index*2+2)},native);
 }
});
