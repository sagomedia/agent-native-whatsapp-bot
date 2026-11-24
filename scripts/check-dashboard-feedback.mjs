import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'/home/gk-pc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=process.cwd()+'/dist/dashboard';
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 try {
  const asset=path.startsWith('/assets/'), file=asset?path:'/index.html';
  res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html');
  res.end(await readFile(root+file));
 } catch {res.writeHead(404).end();}
}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN??'/usr/bin/google-chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
const pause=()=>Promise.withResolvers();
function bounded(promise, message) {
 let timeout;
 return Promise.race([promise,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error(message)),6000);})])
  .finally(()=>clearTimeout(timeout));
}
const catalog=pause(),photo=pause(),completed=pause(),history=pause(),historyStarted=pause();
const imageSizes=[];let catalogReads=0;
const stockResponse=pause(),stockStarted=pause(),stockBodies=[];
const seenResponse=pause();
const context={store:{name:'Fixture shop'},channel:{liveSending:false},attention:{orders:0,messages:0},amendments:[],requestCounts:{new:0,ready_for_pickup:0,completed:1},conversationCounts:{help:0,total:2}};
const row={id:'o1',stage:'completed',item_count:1,item_names:['Fixture valve'],created_at:'2026-11-24T12:00:00Z'};
const chat=id=>({id,actor:'local-simulator',customer_name:'Fixture chat '+id,operator_mode:'assistant',operator_revision:1,last_text:'Fixture preview',updated_at:row.created_at,owner_read_sequence:'0',unread_count:id==='b'?1:0});
const message=id=>({id,conversation_id:id,sequence:id==='a'?'1':'2',direction:'inbound',text:'Fixture message '+id,status:'processed',created_at:row.created_at});
await page.route('**/api/owner/**',async route=>{
 const url=new URL(route.request().url());
 let json=context;
 if(url.pathname.endsWith('/seen')){await seenResponse.promise;return route.fulfill({json:{reading:{read_sequence:'2'}}}).catch(()=>{});}
 else if(url.pathname.endsWith('/stock')&&route.request().method()==='POST'){
  stockBodies.push(route.request().postDataJSON());
  if(stockBodies.length===1){stockStarted.resolve();await stockResponse.promise;return route.abort('failed');}
  json={inventoryVersion:2,onHand:7,available:7};
 }else if(url.pathname.endsWith('/catalog')){
  catalogReads++;await catalog.promise;
  json={products:[{sku:'sku',name:'Fixture valve',imageUrl:'/fixture.jpg',version:1,inventoryVersion:1,stockReserved:0,stockOnHand:1,stock:1,unit:'piece',pricePaise:2000,active:true}],total:1};
 }else if(url.pathname.endsWith('/image')){
  imageSizes.push(url.searchParams.get('size'));await photo.promise;
  return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>'}).catch(()=>{});
 }else if(url.pathname.includes('/conversations/')){
  const id=url.pathname.split('/').at(-1);
  if(id==='b'){historyStarted.resolve();await history.promise;}
  json={messages:[message(id)],reading:{read_sequence:'0',anchor_sequence:null,anchor_offset:0},olderCursor:null};
 }else if(url.searchParams.get('scope')==='inbox'){
  json={...context,conversations:[chat('a'),chat('b')]};
 }else if(url.searchParams.get('scope')==='orders'){
  const done=url.searchParams.get('orderStage')==='completed';
  if(done)await completed.promise;
  json={...context,requests:done?[row]:[],selectedOrder:null,orderPage:{number:1,total:done?1:0,hasNext:false}};
 }
 await route.fulfill({json}).catch(()=>{});
});
const products=page.getByRole('link',{name:'Products',exact:true}).first();
try{
 await page.goto(origin+'/owner?view=conversations');
 const thread=page.getByRole('log');
 await thread.getByText('Fixture message a').waitFor();
 await page.getByRole('button',{name:/Fixture chat b/}).click();
 await bounded(historyStarted.promise,'Selected chat did not request history.');
 const unread=page.getByRole('button',{name:/Fixture chat b/}).locator('.rd-chats-unread-count');
 await unread.waitFor();
 await thread.getByText('Loading messages…').waitFor();
 assert.equal(await thread.getByText('Fixture message b').count(),0);
 history.resolve();
 await thread.getByText('Fixture message b').waitFor();
 await unread.waitFor({state:'hidden'});
 console.log('Chat row clears locally after the message becomes visible, with the read response held.');
 seenResponse.resolve();
 await page.getByRole('link',{name:'Orders',exact:true}).first().click();
 await page.getByText('No orders here',{exact:true}).waitFor();
 await page.getByRole('button',{name:/Completed/}).click();
 await page.locator('button[aria-pressed=true]').filter({hasText:'Completed'}).waitFor();
 assert.equal(await page.getByText('No orders here',{exact:true}).isVisible(),false);
 completed.resolve();
 await page.locator('.rd-orders-list-row').waitFor();
 console.log('Completed waits for its own response without showing the empty New state.');
 await products.click();
 await page.getByRole('status').filter({hasText:'Loading products…'}).waitFor();
 assert.equal(await page.locator('.rd-products-row').count(),0);
 catalog.resolve();
 const image=page.locator('.rd-products-row img');
 await page.locator('.rd-products-row').waitFor();
 assert.equal(await image.evaluate(node=>node.naturalWidth),0);
 photo.resolve();
 await page.waitForFunction(()=>document.querySelector('.rd-products-row img')?.naturalWidth===10);
 console.log('Observed independent product list and image waits.');
 await page.getByRole('button',{name:'View photo: Fixture valve'}).click();
 const dialog=page.getByRole('dialog');
 await dialog.locator('img[aria-busy="false"]').waitFor();
 assert.deepEqual(imageSizes,['128','640']);
 await dialog.getByRole('button',{name:'Zoom in'}).click();
 await dialog.locator('img[aria-busy="false"]').waitFor();
 assert.deepEqual(imageSizes,['128','640',null]);
 await page.keyboard.press('Escape');
 await dialog.waitFor({state:'hidden'});
 assert.equal(catalogReads,1);
 assert.deepEqual(errors,[]);
 console.log('Preview requests 640 px, zoom requests the original, and Escape closes the viewer.');
 await page.setViewportSize({width:390,height:844});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('button',{name:/1 piece.*Update stock for Fixture valve/}).click();
 await dialog.getByLabel('Stock action').selectOption('restock');
 await dialog.locator('input').fill('6');
 await dialog.getByRole('button',{name:'Save stock'}).evaluate(button=>{button.click();button.click();});
 await bounded(stockStarted.promise,'Stock POST did not start.');
 await dialog.getByRole('button',{name:'Receiving stock…'}).waitFor();
 assert.equal(stockBodies.length,1);
 assert.equal(await dialog.locator('input').isDisabled(),true);
 stockResponse.resolve();
 await dialog.getByRole('button',{name:'Retry same update'}).waitFor();
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await page.getByRole('button',{name:/1 piece.*Update stock for Fixture valve/}).click();
 await dialog.getByRole('button',{name:'Retry same update'}).click();
 await page.locator('.rd-products-notice').filter({hasText:'Stock updated.'}).waitFor();
 assert.equal(stockBodies.length,2);
 assert.deepEqual(stockBodies[1],stockBodies[0]);
 console.log('Mobile stock gives immediate pending feedback, blocks double-submit and retries the same payload after reopening.');
 const cold=await browser.newPage({viewport:{width:390,height:844}});
 const entry=pause(),chunk=pause(),earlyCatalog=pause();
 let coldReads=0;
 await cold.route('**/assets/index-*.js',async route=>{await entry.promise;await route.continue();});
 await cold.route('**/assets/RedesignProducts-*.js',async route=>{await chunk.promise;await route.continue();});
 await cold.route('**/api/owner/**',async route=>{
  if(new URL(route.request().url()).pathname.endsWith('/catalog')){
   coldReads++;
   await route.fulfill({json:{products:[],total:0}});
   earlyCatalog.resolve();
  }else await route.fulfill({json:context});
 });
 await cold.goto(origin+'/owner?view=catalog&orderStage=completed',{waitUntil:'commit'});
 await cold.getByRole('status').filter({hasText:'Opening ShopBot…'}).waitFor();
 try{
  await bounded(earlyCatalog.promise,'Catalog waited for the route module.');
 }finally{entry.resolve();chunk.resolve();}
 await cold.getByText('No products here yet.',{exact:true}).waitFor();
 assert.equal(coldReads,1);
 console.log('On cold mobile entry the API finishes while the entry and route chunks are held. Mount consumes that result once.');
 const longList=await browser.newPage({viewport:{width:390,height:844}});
 const catalogRows=Array.from({length:50},(_,index)=>({sku:'fixture-'+index,name:'Fixture product '+index,imageUrl:'/fixture.jpg',version:1,inventoryVersion:1,stockReserved:0,stockOnHand:1,stock:1,unit:'piece',pricePaise:2000,active:true}));
 const requested=new Set();
 await longList.route('**/api/owner/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/image')){
   requested.add(path);
   return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'});
  }
  return route.fulfill({json:path.endsWith('/catalog')?{products:catalogRows,total:3000,nextCursor:'fixture-cursor'}:context});
 });
 await longList.goto(origin+'/owner?view=catalog');
 await longList.locator('.rd-products-row img').first().waitFor();
 assert.equal(await longList.locator('.rd-products-row').count(),50);
 const lastImage='/api/owner/products/fixture-49/image';
 assert.ok(!requested.has(lastImage));
 await longList.getByRole('button',{name:'View photo: Fixture product 49',exact:true}).scrollIntoViewIfNeeded();
 await longList.locator('.rd-products-row').last().locator('img').waitFor();
 assert.ok(requested.has(lastImage));
 console.log('Mobile list renders all page rows, requests nearby thumbnails, and loads the last thumbnail on scroll.');
 const broken=await browser.newPage();
 await broken.route('**/assets/RedesignProducts-*.js',route=>route.fulfill({status:404}));
 await broken.route('**/api/owner/**',route=>route.fulfill({json:context}));
 await broken.goto(origin+'/owner?view=catalog');
 await broken.getByRole('alert').filter({hasText:'This view could not load.'}).waitFor({timeout:7000});
 assert.equal(await broken.getByRole('button',{name:'Reload dashboard'}).isVisible(),true);
 assert.equal(await broken.getByRole('link',{name:'Orders',exact:true}).first().isVisible(),true);
 console.log('A failed route chunk leaves the navigation visible and offers reload.');
 assert.deepEqual(errors,[]);
}finally{
 catalog.resolve();photo.resolve();completed.resolve();history.resolve();stockResponse.resolve();seenResponse.resolve();
 await browser.close();server.close();
}
