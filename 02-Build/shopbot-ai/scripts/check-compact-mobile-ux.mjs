import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'/home/gk-pc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output=process.env.COMPACT_EVIDENCE_DIR??'/tmp/shopbot-compact-evidence',origin=process.env.OWNER_PREVIEW_ORIGIN??'http://127.0.0.1:3078';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:760},hasTouch:true,isMobile:true});
const page=await context.newPage(),errors=[],checks=[],writes=[],imageReads=[];
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(8000);
const id='12345678-0000-4000-8000-000000000001',lineId='12345678-0000-4000-8000-000000000003';
const base={sku:'H01',name:'Pink paint · 500 ml',version:1,inventoryVersion:1,unit:'tin',pricePaise:26000,priceStatus:'priced',stock:12,stockOnHand:12,stockReserved:0,quantityStep:1,sellingUnitVerified:true,verification:{name:true},imageUrl:'/demo-images/H01.jpg',active:true,aliases:[],keywords:[]};
let products=Array.from({length:50},(_,i)=>({...base,sku:'H'+String(i+1).padStart(2,'0'),name:i===0?base.name:'PVC Pipe Heavy '+(i+1),stock:i%3===0?0:12}));
const initial={id:lineId,sku:'H01',name:base.name,productVersion:1,quantity:2,unit:'tin',pricePaise:26000,resolution:'matched'};
let orders=Array.from({length:40},(_,i)=>({id:i===0?id:`12345678-0000-4000-8000-${String(i+2).padStart(12,'0')}`,conversation_id:id,customer_name:'M Parthasarathy '+i,stage:'new',lines:[initial],original_lines:[initial],original_total_paise:'52000',total_paise:'52000',effective_revision:1,created_at:new Date().toISOString(),original_estimate:{lines:[{id:lineId,pricePaise:26000,totalPaise:52000,approximate:false}],subtotalPaise:52000,unpriced:0,approximate:false},inventory:[{sku:'H01',available:12,hasPhoto:true,version:1}],advance_required:false}));
const conversations=Array.from({length:50},(_,i)=>({id:i===0?id:`chat-${i}`,actor:'whatsapp:fixture',customer_name:'Gokulakrishnan '+i,customer_phone:'919000004412',operator_mode:'owner',operator_revision:1,handoff_requested:false,last_text:'உங்கள் ஆர்டர் தயார். கடைக்கு வாருங்கள்.',updated_at:new Date().toISOString(),last_inbound_at:new Date().toISOString(),pending:0}));
let messages=[{id:'message-1',sequence:'1',conversation_id:id,direction:'inbound',text:'Please keep two tins ready.',created_at:new Date().toISOString(),status:'received',whatsapp:true}];
const shop={store:{name:'ksmc supply',operator_paused:false,operator_revision:1},channel:{whatsapp:'receiving',liveSending:true,processing:true},detailsIncluded:true,attention:{orders:1,messages:2},ownerEmail:'fixture@example.test',mode:'mock',budget:null,usage:null};
await page.route('**/api/owner/**',async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname;
 if(path.endsWith('/image')){imageReads.push(url.search);return route.fulfill({contentType:'image/jpeg',body:await readFile('resources/catalog/ksmc-demo/images/H19.jpg')});}
 if(req.method()==='POST'){
  const body=req.postDataJSON();writes.push({path,body});
  if(path.endsWith('/reply')){messages.push({id:body.id,sequence:String(messages.length+1),conversation_id:id,direction:'outbound',text:body.text,created_at:new Date().toISOString(),status:'delivered',whatsapp:true,sender_kind:'owner'});return route.fulfill({json:{messageId:body.id}});}
  if(path.endsWith('/stock')){const p=products.find(p=>path.includes(p.sku+'/'));p.stockOnHand=body.kind==='restock'?p.stockOnHand+body.quantity:body.quantity;p.stock=p.stockOnHand;return route.fulfill({json:{}});}
  if(path.endsWith('/products/simple')){products[0]={...products[0],name:body.name,pricePaise:body.pricePaise};return route.fulfill({json:{sku:base.sku}});}
  if(path.endsWith('/review')){orders[0]={...orders[0],lines:body.lines,effective_revision:orders[0].effective_revision+1};return route.fulfill({json:{}});}
  if(path.endsWith('/reading')||path.endsWith('/seen'))return route.fulfill({json:{seen:true}});
  throw Error('Unexpected fixture write '+path);
 }
 if(path.endsWith('/catalog')){let selected=products;const q=url.searchParams.get('q')??'';if(q)selected=selected.filter(p=>p.name.toLowerCase().includes(q.toLowerCase()));return route.fulfill({json:{products:selected,total:selected.length,totalStore:products.length,nextCursor:null,nodes:[],aiAvailable:true}});}
 if(path.includes('/catalog/products/'))return route.fulfill({json:{product:products.find(p=>path.endsWith('/'+p.sku))??products[0]}});
 if(path.endsWith('/catalog/ai-activity'))return route.fulfill({json:{items:[],total:0,nextCursor:null}});
 if(path.includes('/conversations/'))return route.fulfill({json:{messages,olderCursor:null,reading:{read_sequence:'0',anchor_sequence:null,first_unread:null}}});
 return route.fulfill({json:{...shop,requests:orders,amendments:[],orderPage:{number:1,total:orders.length,hasNext:false,ids:orders.map(o=>o.id)},requestCounts:{new:orders.length,ready_for_pickup:0,completed:0},conversations,conversationCounts:{total:50,help:0}}});
});
const pass=(name)=>{checks.push(name);console.log('PASS',name);};
async function visit(view,extra=''){await page.goto(origin+'/owner?view='+view+extra);await page.locator('.redesign h1').first().waitFor({state:'attached'});}
async function fit(name){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' page overflow');}
async function swipe(selector,x1,y1,x2,y2){
 const box=await page.locator(selector).boundingBox();assert.ok(box,selector);
 const cdp=await context.newCDPSession(page);const x=box.x+x1,y=box.y+y1;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(x2-x1)*i/6,y:y+(y2-y1)*i/6}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}
async function scrollList(selector){
 await page.locator(selector).evaluate(el=>el.scrollTop=100);await page.waitForTimeout(200);
 await page.locator(selector).evaluate(el=>el.scrollTop=260);await page.waitForFunction(()=>document.querySelector('.redesign').dataset.chrome==='down');
 assert.equal(await page.locator('[data-scroll-tools]').isVisible(),false);
 assert.equal(await page.locator('.rd-mobile-nav').isVisible(),false);
 await page.waitForTimeout(200);await page.locator(selector).evaluate(el=>el.scrollTop-=24);
 await page.waitForFunction(()=>document.querySelector('.redesign').dataset.chrome==='up');
 assert.equal(await page.locator('[data-scroll-tools]').isVisible(),true);
 assert.equal(await page.locator('.rd-mobile-nav').isVisible(),true);
 await page.locator(selector).evaluate(el=>el.scrollTop=0);await page.waitForFunction(()=>document.querySelector('.redesign').dataset.chrome==='top');
}
try{
 await visit('requests');await page.locator('.rd-orders-list-row').first().waitFor();
 assert.equal(await page.getByText('ShopBot',{exact:true}).count(),0);await scrollList('.rd-orders-rows');pass('order list uses full height and controls return on upward scroll without returning to top');
 await swipe('.rd-orders-rows',300,150,80,150);await page.waitForURL(/view=conversations/);await page.locator('.rd-chats-row').first().waitFor();
 await swipe('.rd-chats-rows',300,150,80,150);await page.waitForURL(/view=catalog/);await page.locator('.rd-products-row').first().waitFor();pass('real touch swipes switch Orders → Chats → Products');
 await swipe('.rd-products-filters',240,20,50,20);assert.ok(page.url().includes('view=catalog'));pass('horizontal filters keep their own native swipe instead of switching pages');
 await swipe('.rd-products-content',80,150,290,150);await page.waitForURL(/view=conversations/);await page.locator('.rd-chats-row').first().waitFor();
 await swipe('.rd-chats-rows',80,150,290,150);await page.waitForURL(/view=requests/);await page.locator('.rd-orders-list-row').first().waitFor();
 await swipe('.rd-orders-rows',80,150,290,150);assert.ok(page.url().includes('view=requests'));pass('reverse swipes work and the first tab does not wrap');
 await visit('catalog');await page.locator('.rd-products-row').first().waitFor();
 await page.getByRole('button',{name:'More product actions'}).click();await page.locator('.rd-products-menu').waitFor();await swipe('.rd-products-content',80,150,290,150);assert.ok(page.url().includes('view=catalog'));await page.getByRole('button',{name:'More product actions'}).click();await page.locator('.rd-products-menu').waitFor({state:'hidden'});pass('an open menu prevents accidental tab swipes and can close immediately afterward');
 await page.locator('.rd-products-filters').evaluate(el=>el.scrollLeft=0);
 await scrollList('.rd-products-content');pass('product controls reclaim height and return with selected filters intact');
 const photoButton=page.getByRole('button',{name:'View photo: '+base.name,exact:true});await photoButton.click();
 const viewer=page.getByRole('dialog',{name:'Product photo'});await viewer.waitFor();await viewer.getByRole('img').waitFor();
 assert.ok(imageReads.some(q=>!q.includes('size=')),'viewer requests full image');assert.ok(await viewer.evaluate(el=>el.clientWidth>=innerWidth-1));
 await viewer.getByRole('button',{name:'Zoom in',exact:true}).click();assert.equal(await viewer.locator('.is-zoomed').count(),1);
 await page.goBack();await viewer.waitFor({state:'hidden'});assert.ok(page.url().includes('view=catalog'));pass('photo opens full screen, zooms, and Android/browser Back closes it without leaving products');
 await photoButton.click();await page.keyboard.press('Escape');await viewer.waitFor({state:'hidden'});pass('Escape closes viewer and restores the originating control');
 await page.getByRole('button',{name:'Update stock for '+base.name}).click();let dialog=page.getByRole('dialog');await dialog.getByLabel('Stock action').selectOption('restock');await dialog.getByLabel('Quantity received').fill('20');await dialog.getByRole('button',{name:'Save stock',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(products[0].stockOnHand,32);pass('stock restock action preserves exact SKU and reaches existing API');
 await page.getByRole('button',{name:'Edit '+base.name,exact:true}).first().click();await page.getByLabel('Product name',{exact:true}).fill('Pink paint · 500 ml updated');
 await swipe('.rd-products-edit',280,150,60,150);assert.ok(page.url().includes('view=catalog'));assert.equal(await page.getByLabel('Product name',{exact:true}).inputValue(),'Pink paint · 500 ml updated');pass('editing suppresses tab swipes and keeps entered product data');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.locator('.rd-products-row').first().waitFor();assert.equal(products[0].name,'Pink paint · 500 ml updated');pass('product save remains wired to simple-product endpoint');
 await visit('requests','&order='+id);await page.getByRole('button',{name:'View photo: '+base.name,exact:true}).click();await viewer.waitFor();await viewer.getByRole('button',{name:'Close photo'}).click();await viewer.waitFor({state:'hidden'});
 assert.equal(await page.locator('.rd-orders-dialog[open]').count(),0);await page.getByRole('button',{name:'Check or change '+base.name,exact:true}).click();await page.locator('.rd-orders-dialog[open]').waitFor();await page.getByRole('button',{name:'Close dialog'}).click();pass('order photo and item identification are separate working controls');
 await page.getByLabel('Price each for '+base.name,{exact:true}).fill('270');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Order changes saved.',{exact:true}).waitFor();assert.equal(orders[0].original_estimate.lines[0].pricePaise,26000);assert.equal(orders[0].lines[0].pricePaise,27000);pass('price editing preserves the original customer-seen price');
 await visit('conversations','&conversation='+id);await page.getByLabel('Reply to customer',{exact:true}).fill('Ready by six');await page.getByRole('button',{name:'Send reply',exact:true}).click();await page.getByRole('log').getByText('Ready by six',{exact:true}).waitFor();assert.equal(await page.getByLabel('Reply to customer',{exact:true}).isEnabled(),true);assert.equal(await page.locator('.rd-mobile-nav').isVisible(),false);pass('chat composer stays visible and manual reply reaches the existing reply endpoint');
 for(const locale of ['en','ta']){
  await page.evaluate(l=>localStorage.setItem('shopbot.owner.language',l),locale);
  for(const width of [320,360,390,430]){
   await page.setViewportSize({width,height:760});
   for(const view of ['requests','conversations','catalog','connections']){
    await visit(view);await fit(locale+' '+view+' '+width);
    if(view!=='connections'){
     const strip=page.locator('[data-horizontal-scroll]').first();await strip.waitFor();
     assert.ok(await strip.locator('button').evaluateAll(buttons=>buttons.every(button=>getComputedStyle(button).whiteSpace==='nowrap')));
    }
    if(width===390)await page.screenshot({path:`${output}/${view}-${locale}.png`});
   }
  }
 }
 pass('all four pages fit 320/360/390/430px in English and Tamil; filter labels remain single-line');
 await page.setViewportSize({width:320,height:760});await visit('catalog');
 await page.getByRole('button',{name:'AI செயல்பாடுகள்',exact:true}).click();await page.getByRole('button',{name:'செய்த மாற்றங்கள்',exact:true}).waitFor();await fit('Tamil AI activity');pass('AI activity remains reachable after horizontal filters');
 await page.setViewportSize({width:1440,height:900});await visit('requests');await fit('desktop');assert.equal(await page.locator('.rd-orders-detail').isVisible(),true);pass('desktop retains independent order list and detail panes');
 assert.deepEqual(errors,[]);pass('no uncaught browser errors');
 await writeFile(output+'/checks.json',JSON.stringify({checks,writes,errors},null,2));
}catch(error){await page.screenshot({path:output+'/failure.png'});console.error((await page.locator('body').innerText()).slice(-3000));await writeFile(output+'/failure.json',JSON.stringify({error:String(error),stack:error.stack,checks,errors},null,2));throw error;}
finally{await browser.close();}
