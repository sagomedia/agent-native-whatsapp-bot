// Synthetic owner browser acceptance. Intercepts every API request; no live data or customer sends.
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const output=resolve(process.env.ORDERS_EVIDENCE_DIR??'artifacts/orders-workbench');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN??'/usr/bin/google-chrome'});
const page=await browser.newPage({viewport:{width:1586,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,now=new Date().toISOString(),customer=uuid(1),order=uuid(2);
const products=[{sku:'H01',name:'1 inch PVC Heavy Pipe Local'},{sku:'H02',name:'1 inch PVC Pipe Blueguard ISI'},{sku:'H03',name:'0.75 inch PVC Pipe Local'},{sku:'H19',name:'Ratchet PVC Pipe Cutter 42mm'},{sku:'H20',name:'Measuring Tape 5m'}].map(p=>({...p,unit:'piece',pricePaise:2500,version:1,quantityStep:1,priceStatus:'priced',stock:20,active:true,imageUrl:'/fixture.jpg'}));
const names=['1 inch PVC Heavy Pipe Local','pipe','socket','MCP','valve','Ratchet PVC Pipe Cutter 42mm','Measuring Tape 5m','Ratchet PVC Pipe Cutter 42mm'];
const lines=names.map((name,i)=>({id:uuid(100+i),query:name,name,quantity:i===7?null:i<5?2:1,unit:[0,5,6,7].includes(i)?'piece':undefined,resolution:[0,5,6].includes(i)?'matched':'unavailable',...([0,5,6,7].includes(i)?{sku:i===7||i===5?'H19':i===6?'H20':'H01',productVersion:1}:{}),...(i===7?{sourceUncertainty:['check duplicate quantity']}:{})}));
const request={id:order,conversation_id:customer,acceptance:'awaiting_approval',fulfillment:'awaiting_approval',payment:'pending',total_paise:'0',lines,original_lines:structuredClone(lines),created_at:now,effective_revision:1,estimate_complete:false,advance_required:true,advance_state:'verified',advance_amount_paise:1000};
const data={store:{name:'ShopBot hardware store',synthetic:'true',operator_paused:false,operator_revision:1},requests:[request,...Array.from({length:4},(_,i)=>({...structuredClone(request),id:uuid(10+i),lines:structuredClone(lines.slice(0,3)),advance_required:false}))],conversations:[{id:customer,actor:'whatsapp',operator_mode:'assistant',operator_revision:1,reply_language:'ta',handoff_requested:false,draft:lines,last_inbound_at:now,last_text:'Please check this list.',pending:0,updated_at:now}],quotes:[],amendments:[],channel:{processing:true,liveSending:true,whatsapp:'receiving',testOnly:false},inference:{enabled:true},ownerEmail:'owner@example.test',generatedAt:now};
let saved=null,failSave=false,lastQuote=null;
await page.route('**/api/**',async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname;
 if(path.endsWith('/snapshot'))return route.fulfill({json:{...data,generatedAt:new Date().toISOString()}});
 if(path.endsWith('/quote-draft')){
  if(req.method()==='GET')return route.fulfill({json:{draft:saved}});
  const input=req.postDataJSON();if(failSave)return route.fulfill({status:409,json:{error:'This draft was changed in another window. Load the saved draft before saving again.'}});
  assert.equal(input.expectedVersion,saved?.version??0);
  saved={version:(saved?.version??0)+1,expectedRevision:input.expectedRevision,amendmentId:input.amendmentId,lines:input.lines,updatedAt:new Date().toISOString()};return route.fulfill({json:{draft:saved}});
 }
 if(path.endsWith('/quote/notify'))return route.fulfill({json:{quoteId:data.quotes[0].id,customerNotification:'not_sent',reason:'Synthetic fixture: no real WhatsApp sending.'}});
 if(path.endsWith('/quote')){
  lastQuote=req.postDataJSON();data.quotes=[{id:lastQuote.id,request_id:order,state:'offered',created_at:now,total_paise:String(lastQuote.lines.reduce((n,l)=>n+l.quantity*l.pricePaise,0)),lines:lastQuote.lines.map(l=>({...l,query:lines.find(o=>o.id===l.id).query,resolution:'matched',merchantConfirmed:{free:l.free}}))}];saved=null;return route.fulfill({json:{quoteId:lastQuote.id,customerNotification:lastQuote.notify?'queued':'not_requested'}});
 }
 if(path==='/api/owner/catalog')return route.fulfill({json:{products:products.filter(p=>[p.name,p.sku].join(' ').toLowerCase().includes((url.searchParams.get('q')??'').trim().toLowerCase())),revision:1,nodes:[],total:5,nextCursor:null}});
 if(path.endsWith('/image')){const sku=decodeURIComponent(path.split('/')[4]);if(!products.some(p=>p.sku===sku))return route.fulfill({status:404});return route.fulfill({contentType:'image/jpeg',body:await readFile('resources/catalog/ksmc-demo/images/'+sku+'.jpg')});}
 if(path.includes('/conversations/'))return route.fulfill({json:{messages:[]}});
 return route.fulfill({json:{products:[],nodes:[],revision:1,proposals:[],limit:100}});
});
const base=process.env.OWNER_UI_URL??'http://127.0.0.1:5181';
async function loaded(){await page.getByRole('button',{name:'Save draft',exact:true}).waitFor();await page.getByRole('button',{name:'Save draft',exact:true}).isEnabled();await page.getByText('Loading saved quote…').waitFor({state:'hidden'});}
async function refresh(){await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('button',{name:'Refresh',exact:true}).waitFor();}
async function noOverflow(label){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' has horizontal overflow');}
await page.goto(base+'/owner?view=requests&order='+order);await loaded();await noOverflow('1586 desktop');assert.ok(await page.getByRole('button',{name:'Send quote for approval',exact:true}).isDisabled());
await page.screenshot({path:resolve(output,'orders-desktop.png'),fullPage:true});
await page.getByRole('button',{name:'Go to first item check',exact:true}).click();assert.equal(await page.locator('#quote-options-'+lines[0].id).getAttribute('open'),'');
await page.getByLabel('Unit price 1 (₹)',{exact:true}).fill('25');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Draft saved. You can safely return to it later.').waitFor();assert.equal(saved.lines[0].price,'25');assert.equal(saved.lines[0].quantity,'2');
await page.reload();await loaded();assert.equal(await page.getByLabel('Unit price 1 (₹)',{exact:true}).inputValue(),'25');
await page.getByLabel('Unit price 1 (₹)',{exact:true}).fill('31');failSave=true;await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('alert').getByText('Couldn’t complete this action').waitFor();assert.equal(await page.getByLabel('Unit price 1 (₹)',{exact:true}).inputValue(),'31');
await page.getByRole('alert').getByRole('button',{name:'Load current order',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Load saved draft',exact:true}).click();await page.getByText('Saved draft loaded.',{exact:true}).waitFor();assert.equal(await page.getByLabel('Unit price 1 (₹)',{exact:true}).inputValue(),'25');failSave=false;
await page.getByRole('button',{name:'Review item 1 checks and options',exact:true}).click();
for(const [width,height] of [[1366,900],[1024,900],[390,844],[360,800]]){
 await page.setViewportSize({width,height});await noOverflow(width+' detail');await page.screenshot({path:resolve(output,'orders-'+width+'.png'),fullPage:true});
 if(width<800){const bar=page.locator('.order-mobile-actionbar');assert.equal(await bar.isVisible(),true);const box=await bar.boundingBox();assert.ok(box.y+box.height<=height+1,'Mobile actions stay in viewport');}
}
await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'← Orders',exact:true}).click();assert.equal(await page.locator('.orders-queue').isVisible(),true);assert.equal(await page.locator('.orders-selected-order').isVisible(),false);await page.screenshot({path:resolve(output,'orders-mobile-queue.png'),fullPage:true});await page.locator('#order-row-'+order).click();await loaded();assert.equal(await page.getByLabel('Unit price 1 (₹)',{exact:true}).inputValue(),'25');await page.screenshot({path:resolve(output,'orders-phone.png'),fullPage:false});
await page.setViewportSize({width:1586,height:1100});
// Resolve a requested item in place; its original text remains attached to the row.
await page.locator('.order-line').nth(1).getByRole('button',{name:'● Match product',exact:true}).click();await page.getByLabel('Search catalog',{exact:true}).fill('blueguard');await page.getByRole('button',{name:/1 inch PVC Pipe Blueguard ISI.*Choose/}).click();assert.equal(await page.getByLabel('Product 2',{exact:true}).inputValue(),'1 inch PVC Pipe Blueguard ISI');assert.equal(await page.getByLabel('Quantity 2',{exact:true}).inputValue(),'2');assert.equal(await page.getByLabel('Unit price 2 (₹)',{exact:true}).inputValue(),'25.00');await page.locator('.order-line').nth(1).getByText('Requested: pipe',{exact:true}).waitFor();
for(const i of [2,3,4]){await page.getByLabel('Selling unit '+(i+1),{exact:true}).fill('piece');await page.getByLabel('Unit price '+(i+1)+' (₹)',{exact:true}).fill('25');await page.getByRole('button',{name:'Review item '+(i+1)+' checks and options',exact:true}).click();await page.locator('.order-line').nth(i).getByLabel('I checked this manual item’s identity and selling unit.',{exact:true}).check();}
for(const i of [5,6,7])await page.getByLabel('Unit price '+(i+1)+' (₹)',{exact:true}).fill('25');
await page.getByLabel('Quantity 8',{exact:true}).fill('1');for(const i of [5,7]){await page.getByRole('button',{name:'Review item '+(i+1)+' checks and options',exact:true}).click();await page.locator('.order-line').nth(i).getByLabel('I checked the original request, quantity, pack size and any duplicate.',{exact:true}).check();}
await page.getByRole('button',{name:'Send quote for approval',exact:true}).isEnabled();await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Draft saved. You can safely return to it later.').waitFor();
await page.screenshot({path:resolve(output,'orders-resolved.png'),fullPage:true});
await page.getByRole('checkbox',{name:'Notify on WhatsApp',exact:true}).uncheck();await page.getByRole('button',{name:'Send quote for approval',exact:true}).click();await page.getByText('Waiting for customer approval',{exact:true}).waitFor();assert.equal(lastQuote.lines.length,8);assert.equal(lastQuote.notify,false);assert.equal(lastQuote.lines[1].sku,'H02');assert.ok(lastQuote.draftVersion>0);assert.equal(new URL(page.url()).searchParams.get('requests'),'customer');assert.equal(await page.getByLabel('Quantity 1',{exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Accept & reserve stock',exact:true}).count(),0);
assert.ok(await page.getByRole('button',{name:'Send saved quote on WhatsApp',exact:true}).isDisabled());await page.getByRole('checkbox',{name:'Notify on WhatsApp',exact:true}).check();await page.getByRole('button',{name:'Send saved quote on WhatsApp',exact:true}).click();await page.getByText('Synthetic fixture: no real WhatsApp sending.',{exact:true}).waitFor();
 await page.screenshot({path:resolve(output,'orders-awaiting-customer.png'),fullPage:true});
// A real customer change makes the old saved quote stale and preserves local edits.
data.quotes=[];request.effective_revision=2;await refresh();await loaded();await page.getByLabel('Unit price 1 (₹)',{exact:true}).fill('42');request.effective_revision=3;await refresh();await page.getByText('The order changed while this draft was open.',{exact:true}).waitFor();assert.equal(await page.getByLabel('Unit price 1 (₹)',{exact:true}).inputValue(),'42');assert.ok(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled());
await page.screenshot({path:resolve(output,'orders-customer-change.png'),fullPage:true});
assert.deepEqual(errors,[]);await browser.close();console.log('Orders browser checks passed: desktop/laptop/mobile layouts; sticky mobile actions; row checks; partial draft save/reload; conflict recovery; inline matching and source wording; manual items and duplicates; quote payload and customer stage; notification choice; changed-order protection. All API calls used synthetic fixtures.');
