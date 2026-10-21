// Local synthetic rehearsal. Real APIs supply page reads; mutations are blocked.
// A CSV preview response is intercepted solely to inspect the responsive rows.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.OWNER_UI_URL??'http://127.0.0.1:3044';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const snapshot=await (await fetch(base+'/api/owner/snapshot?details=0')).json();
assert.equal(snapshot.store.synthetic,'true');assert.equal(snapshot.channel.liveSending,false);assert.equal(snapshot.inference.enabled,false);
const catalog=await (await fetch(base+'/api/owner/catalog?limit=25')).json();
const out=resolve(process.env.DESIGN_EVIDENCE_DIR??'artifacts/owner-design');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN??'/usr/bin/google-chrome'}),page=await browser.newPage();
page.setDefaultTimeout(18000);const errors=[],blockedWrites=[],layouts=[],phoneOrders=[];page.on('pageerror',error=>errors.push(error.message));
const csvBatch={batchId:'design-fixture',fileHash:'synthetic-only',status:'preview',filename:'Checked shop facts.csv',nextChunk:0,nextCursor:null,expiresAt:new Date(Date.now()+3600000).toISOString(),counts:{total:2,changed:2,committed:0,unchanged:0,errors:0,remaining:2},receipt:{chunks:[]},rows:catalog.products.slice(0,2).map((p,index)=>({rowNumber:index+1,sku:p.sku,name:p.name,unit:p.unit,state:'ready',changes:{price:true,stock:true},before:{priceStatus:'priced',pricePaise:p.pricePaise,onHand:p.stockOnHand},after:{priceStatus:'priced',pricePaise:p.pricePaise+100,onHand:(p.stockOnHand??0)+2},errors:[]}))};
let previewReads=0,heldRead=null,releaseRead=null;
await page.route('**/api/**',async route=>{
 if(route.request().method()==='GET'){const url=new URL(route.request().url());if(heldRead&&url.pathname==='/api/owner/snapshot'&&(url.searchParams.get('orderStage')==='history'||url.searchParams.get('inboxHelp')==='1')){const wait=heldRead;heldRead=null;await wait;}return route.continue();}
 if(new URL(route.request().url()).pathname==='/api/owner/catalog/facts/preview'){previewReads++;return route.fulfill({json:csvBatch});}
 blockedWrites.push(route.request().url());return route.abort('blockedbyclient');
});
async function visit(view,extra=''){
 await page.goto(base+'/owner?view='+view+extra);
 const selector={overview:'.owner-overview-order',requests:'.orders-queue-row',conversations:'.owner-thread-rows>button',catalog:'.owner-inventory-table tbody tr',connections:'#owner-connection','message-review':'.owner-gallery-entry'}[view];
 await page.locator(view==='catalog'&&extra.includes('product=')?'.owner-product-workspace':selector).first().waitFor();
}
async function contained(selector){return page.locator(selector).evaluate(element=>{const bounds=element.getBoundingClientRect();return [...element.querySelectorAll('button')].every(button=>{const r=button.getBoundingClientRect();return r.left>=bounds.left-1&&r.right<=bounds.right+1&&button.scrollWidth<=button.clientWidth+1;});});}
function luminance(value){const channels=value.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;}
function contrast(a,b){const first=luminance(a),second=luminance(b);return (Math.max(first,second)+.05)/(Math.min(first,second)+.05);}
try{
 for(const [width,height] of [[1920,1080],[1440,1000],[1024,600],[768,1024],[390,844],[320,640]]){
  await page.setViewportSize({width,height});
  for(const view of ['overview','requests','conversations','catalog','connections','message-review']){
   await visit(view);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),view+' overflow at '+width);
   const rail=await page.locator('.owner-appbar').boundingBox();
   if(width>800)assert.ok(rail.width>=180&&rail.width<=220,'Desktop navigation rail');
   else{
    const nav=await page.locator('.owner-daily-nav').boundingBox();assert.ok(nav.y+nav.height<=height+1);assert.equal(await page.locator('.owner-daily-nav>a').count(),4);
    for(const item of await page.locator('.owner-daily-nav>a').all())assert.ok((await item.boundingBox()).height>=44);
   }
   if(view==='overview'&&width===390){const order=await page.locator('.owner-overview-order').first().boundingBox(),main=await page.locator('.owner-main').boundingBox();assert.ok(order.y+order.height<=main.y+main.height,'A real order should fit the first phone screen');}
   if(view==='catalog'&&width<=800){const actions=page.locator('.owner-inventory-edit-actions').first(),box=await actions.boundingBox();assert.ok(box.height<=110,'Product actions should not occupy three vertical rows');assert.ok(await actions.evaluate(el=>el.scrollWidth<=el.clientWidth+1));}
   if(view==='requests'&&width<=800)await page.getByLabel('Order stage',{exact:true}).waitFor();
   if([1440,390,320].includes(width))await page.screenshot({path:resolve(out,view+'-'+width+'.png')});
   layouts.push({view,width,height});
  }
 }
 await page.setViewportSize({width:390,height:844});await visit('requests');heldRead=new Promise(resolve=>{releaseRead=resolve;});await page.getByLabel('Order stage',{exact:true}).selectOption('history');await page.getByText('Loading orders…',{exact:true}).waitFor();assert.equal(await page.getByText('Nothing waiting here',{exact:true}).count(),0);releaseRead();await page.waitForURL(/requests=history/);await page.getByRole('link',{name:/Collected/}).first().waitFor();await page.getByLabel('Order stage',{exact:true}).selectOption('ready');await page.waitForURL(/requests=ready/);await page.locator('.orders-queue-row').first().waitFor();
 await visit('conversations');heldRead=new Promise(resolve=>{releaseRead=resolve;});await page.getByRole('button',{name:/^Needs help/}).click();await page.getByText('Loading conversations…',{exact:true}).waitFor();assert.equal(await page.getByText('No conversations yet',{exact:true}).count(),0);releaseRead();await page.locator('.owner-thread-rows>button').first().waitFor();
 await page.setViewportSize({width:1440,height:1000});await visit('connections');await page.getByRole('link',{name:'Usage & costs',exact:true}).click();const usage=await page.locator('#owner-usage h2').boundingBox(),main=await page.locator('.owner-main').boundingBox(),sections=await page.locator('.owner-settings>.owner-section-nav').boundingBox();assert.ok(usage.y>=sections.y+sections.height-1&&usage.y+usage.height<=main.y+main.height,'Section navigation must reveal the heading below the sticky navigation');
 await visit('catalog','&inventory=0&product='+encodeURIComponent(catalog.products[0].sku));await page.getByLabel('Product name',{exact:true}).waitFor();await page.getByRole('tab',{name:'Selling details',exact:true}).click();assert.equal(await page.locator('#product-panel-selling').isVisible(),true);assert.equal(await page.locator('.owner-product-workspace input[type=checkbox]').count(),0);await page.getByRole('tab',{name:'General',exact:true}).click();await page.screenshot({path:resolve(out,'product-editor-1440.png')});
 await page.setViewportSize({width:320,height:640});await visit('catalog');await page.locator('.owner-inventory-edit-actions').first().getByRole('button',{name:'Update price',exact:true}).click();await page.getByRole('dialog').waitFor();assert.ok((await page.getByRole('dialog').boundingBox()).width<=304);await page.screenshot({path:resolve(out,'price-dialog-320.png')});await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 await page.goto(base+'/owner?view=catalog&bulk=1');await page.getByLabel('Upload the edited CSV',{exact:false}).setInputFiles({name:'Checked shop facts.csv',mimeType:'text/csv',buffer:Buffer.from('sku,price_rupees\nH01,246\n')});await page.getByText('Review the proposed changes',{exact:true}).waitFor();assert.equal(await page.locator('.owner-bulk-table tbody tr').count(),2);assert.ok(await page.locator('.owner-bulk-table').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.locator('.owner-bulk-table tbody tr').first().scrollIntoViewIfNeeded();assert.equal(await page.locator('.owner-bulk-table tbody tr').first().evaluate(el=>getComputedStyle(el).display),'grid');await page.screenshot({path:resolve(out,'csv-preview-320.png')});
 // The read-only rehearsal never applies that intercepted preview.
 await page.getByRole('button',{name:'Back to products',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Back to products',exact:true}).click();
 for(const language of ['en','ta']){
  await visit('overview');await page.getByLabel('Dashboard language / மொழி').selectOption(language);
  for(const request of snapshot.requests){
   await page.goto(base+'/owner?view=requests&order='+request.id);await page.locator('.order-items-scroll').waitFor();await page.getByText('Loading your saved quote…',{exact:true}).waitFor({state:'hidden'});
   const content=await page.locator('.order-items-scroll').boundingBox();assert.ok(content.height>=120,language+' '+request.fulfillment+' content height '+content.height);assert.ok(await contained('.order-footer-actions'),language+' action labels must fit');phoneOrders.push({language,state:request.fulfillment,complete:request.estimate_complete,contentHeight:content.height});
   if(request.fulfillment==='ready_for_pickup')await page.screenshot({path:resolve(out,'ready-order-'+language+'-320.png')});
  }
 }
 await visit('overview');await page.getByLabel('Dashboard language / மொழி').selectOption('en');const colors=await page.locator('.owner-primary').first().evaluate(el=>{const style=getComputedStyle(el);return {text:style.color,background:style.backgroundColor};});assert.ok(contrast(colors.text,colors.background)>=4.5,'Primary button contrast');
 assert.deepEqual(errors,[]);assert.deepEqual(blockedWrites,[]);assert.equal(previewReads,1);
 await writeFile(resolve(out,'results.json'),JSON.stringify({synthetic:true,realReads:true,realWrites:0,csvPreviewIntercepts:previewReads,layouts,phoneOrders,primaryContrast:contrast(colors.text,colors.background),errors},null,2));console.log('Owner design checks passed: six pages, six viewport sizes, stage/section navigation, product actions, dialogs, CSV cards, 12 English/Tamil order states and contrast.');
}catch(error){console.error('Browser errors:',errors);console.error((await page.locator('body').innerText()).slice(0,4000));await page.screenshot({path:resolve(out,'failure.png')});throw error;}finally{await browser.close();}
