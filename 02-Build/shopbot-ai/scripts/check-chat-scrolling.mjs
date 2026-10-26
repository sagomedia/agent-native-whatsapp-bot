import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'/home/gk-pc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=process.env.CHAT_PREVIEW_ORIGIN??'http://127.0.0.1:3054';
const output=process.env.CHAT_EVIDENCE_DIR??'/tmp/shopbot-chat-scrolling';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],reads=[];
page.on('pageerror',e=>errors.push(e.message));
const conversations=Array.from({length:60},(_,i)=>({id:`chat-${i}`,actor:'whatsapp:fixture',customer_name:`Customer ${i}`,customer_phone:'919000000000',operator_mode:'assistant',operator_revision:0,handoff_requested:false,last_text:'Latest customer message',updated_at:new Date().toISOString(),last_inbound_at:new Date().toISOString(),pending:0}));
function message(n,id='chat-0'){return {id:`${id}-message-${n}`,sequence:String(n),conversation_id:id,direction:n%2?'inbound':'outbound',text:`Message ${n}: synthetic chat history for scrolling checks.`,created_at:new Date(1792600000000+n*60000).toISOString(),status:'delivered',whatsapp:true,media_available:null};}
let latest=650,delayOlder=0,failOlder=false;
const lines=Array.from({length:25},(_,i)=>({id:`line-${i}`,name:`Fixture item ${i}`,quantity:1,unit:'piece',pricePaise:10000,resolution:'matched',merchantConfirmed:{free:false}}));
const orders=Array.from({length:30},(_,i)=>({id:`order-${i}`,conversation_id:'chat-0',customer_name:`Order customer ${i}`,stage:'new',lines,original_lines:lines,original_total_paise:'250000',total_paise:'250000',effective_revision:1,created_at:new Date().toISOString(),advance_required:false}));
await page.route('**/api/owner/**',async route=>{
 const url=new URL(route.request().url()),path=url.pathname.replace('/api/owner/','');
 let data;
 if(path==='snapshot'||path==='summary')data={conversations,conversationCounts:{help:0,total:60},inboxPage:{number:1,total:60,hasNext:false,ids:conversations.map(c=>c.id)},store:{name:'Scrolling fixture',operator_paused:false},channel:{liveSending:true},requests:orders,amendments:[],orderPage:{number:1,total:30,hasNext:false,ids:orders.map(o=>o.id)},requestCounts:{new:30,ready_for_pickup:0,completed:0,active:30,history:0}};
 else if(path.endsWith('/control')){const c=conversations.find(c=>path.includes(c.id));c.operator_mode=JSON.parse(route.request().postData()).mode;c.operator_revision++;data={};}
 else if(path.endsWith('/seen'))data={};
 else if(/^conversations\/chat-\d+$/.test(path)){
  const id=path.split('/')[1],before=url.searchParams.get('before');reads.push({id,before});
  if(before&&delayOlder)await new Promise(r=>setTimeout(r,delayOlder));
  if(before&&failOlder){failOlder=false;return route.fulfill({status:503,json:{error:'Synthetic history retry'}});}
  const end=before?Number(before)-1:id==='chat-0'?latest:4,start=Math.max(1,end-199);
  data={messages:Array.from({length:end-start+1},(_,i)=>message(start+i,id)),olderCursor:start>1?String(start):null,reading:{read_sequence:'0',anchor_sequence:null,anchor_offset:0,first_unread:null}};
 }else throw new Error('Unexpected fixture API '+path);
 await route.fulfill({json:data});
});
const count=()=>page.locator('.rd-chats-bubble').count();
const metric=()=>page.locator('.rd-chats-messages').evaluate(n=>({top:n.scrollTop,height:n.clientHeight,total:n.scrollHeight,bottom:n.scrollHeight-n.clientHeight-n.scrollTop}));
async function fit(){const m=await page.evaluate(()=>({height:innerHeight,document:document.documentElement.scrollHeight,width:innerWidth,documentWidth:document.documentElement.scrollWidth,bottom:document.querySelector('.rd-chats-bottom')?.getBoundingClientRect().bottom,nav:document.querySelector('.rd-mobile-nav')?.getBoundingClientRect().top}));assert.ok(m.document<=m.height+1,JSON.stringify(m));assert.ok(m.documentWidth<=m.width+1,JSON.stringify(m));if(m.bottom)assert.ok(m.bottom<=m.height,JSON.stringify(m));return m;}
async function poll(){await page.evaluate(()=>window.dispatchEvent(new Event('online')));}
try{
 await page.goto(base+'/owner?view=conversations&conversation=chat-0');await page.waitForFunction(()=>document.querySelectorAll('.rd-chats-bubble').length===200);
 assert.ok((await metric()).bottom<2);assert.equal(reads.filter(r=>r.before).length,0);await fit();console.log('PASS latest 200 messages only, opens at bottom, composer fits viewport');
 const threadTop=(await metric()).top;await page.locator('.rd-chats-rows').evaluate(n=>n.scrollTop=500);assert.equal((await metric()).top,threadTop);assert.equal(await page.evaluate(()=>scrollY),0);console.log('PASS chat list scrolls independently');
 await page.locator('.rd-chats-messages').evaluate(n=>n.scrollTop=20);
 await page.waitForFunction(()=>document.querySelectorAll('.rd-chats-bubble').length===400);const prepended=await metric();assert.ok(prepended.top>1000);assert.ok(prepended.bottom>1000);await page.waitForTimeout(100);
 const beforePoll=await metric();latest++;await poll();await page.getByRole('button',{name:'New messages ↓'}).waitFor();assert.equal(await count(),401);assert.ok(Math.abs((await metric()).top-beforePoll.top)<2);console.log('PASS older messages prepend, latest poll preserves history and reading position');
 await page.getByRole('button',{name:'New messages ↓'}).click();await page.waitForFunction(()=>{const n=document.querySelector('.rd-chats-messages');return n.scrollHeight-n.scrollTop-n.clientHeight<2;});
 assert.equal(await count(),200);latest++;await poll();await page.waitForFunction(()=>document.querySelectorAll('.rd-chats-bubble').length===201);assert.ok((await metric()).bottom<2);console.log('PASS jump to latest drops old pages and automatically follows new replies at bottom');
 // A failed older-page fetch leaves loaded messages and the composer available.
 failOlder=true;await page.locator('.rd-chats-messages').evaluate(n=>n.scrollTop=20);await page.getByRole('alert').filter({hasText:'Messages are not updating'}).waitFor();assert.equal(await count(),201);await page.getByRole('button',{name:'Earlier messages',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.rd-chats-bubble').length===401);console.log('PASS older-page failure can retry without discarding loaded messages');
 await page.getByRole('button',{name:'Reply myself',exact:true}).click();await page.getByRole('textbox',{name:'Reply to customer'}).fill('Draft remains available while reading history');assert.ok((await fit()).bottom>800);console.log('PASS takeover and reply composer stay available while reading history');
 // An old conversation response must never appear in a newly selected conversation.
 delayOlder=500;await page.locator('.rd-chats-messages').evaluate(n=>n.scrollTop=20);await page.waitForTimeout(50);await page.locator('.rd-chats-row').filter({hasText:'Customer 1'}).first().click();await page.waitForFunction(()=>document.querySelectorAll('.rd-chats-bubble').length===4);await page.waitForTimeout(600);assert.equal(await count(),4);assert.ok((await metric()).bottom<2);console.log('PASS switching chats cancels in-flight older history');
 for(const [width,height] of [[390,844],[320,740],[800,700],[1440,480]]){await page.setViewportSize({width,height});await page.waitForTimeout(100);await fit();assert.ok((await metric()).bottom<2);const footer=await page.locator('.rd-chats-bottom').boundingBox();assert.ok(footer.y>=0);await page.screenshot({path:`${output}/chat-${width}.png`});}console.log('PASS mobile, tablet, desktop and short viewport controls fit');
 await page.setViewportSize({width:1440,height:900});await page.goto(base+'/owner?view=requests&order=order-0');await page.locator('.rd-orders-item').first().waitFor();await fit();await page.locator('.rd-orders-detail').evaluate(n=>n.scrollTop=500);assert.ok(await page.locator('.rd-orders-detail').evaluate(n=>n.scrollTop)>400);assert.equal(await page.locator('.rd-orders-rows').evaluate(n=>n.scrollTop),0);await page.locator('.rd-orders-rows').evaluate(n=>n.scrollTop=500);assert.ok(await page.locator('.rd-orders-rows').evaluate(n=>n.scrollTop)>400);assert.equal(await page.evaluate(()=>scrollY),0);console.log('PASS order columns scroll independently');
 assert.deepEqual(errors,[]);console.log('PASS no uncaught browser errors');
}finally{await browser.close();}
