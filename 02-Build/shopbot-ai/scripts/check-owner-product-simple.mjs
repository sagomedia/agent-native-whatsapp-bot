// Exercise the actual editor and owner services against a disposable synthetic preview.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setOwnerLanguage} from './owner-browser-tools.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.OWNER_UI_URL??'http://127.0.0.1:3044';assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const read=async path=>(await fetch(base+path)).json(),snapshot=await read('/api/owner/snapshot?details=0');
assert.equal(snapshot.store.synthetic,'true');assert.equal(snapshot.channel.liveSending,false);assert.equal(snapshot.inference.enabled,false);
const output=resolve(process.env.PRODUCT_EVIDENCE_DIR??'artifacts/owner-product-simple');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN??'/usr/bin/google-chrome'}),page=await browser.newPage();const errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(12000);
const button=name=>page.getByRole('button',{name,exact:true}),visit=async()=>{await page.goto(base+'/owner?view=catalog&inventory=0&product=H01');await page.locator('[name=productName]').waitFor();};
const current=async()=> (await read('/api/owner/catalog/products/H01')).product;
const publish=async()=>{await button('Review & publish changes').click();await button('Confirm & publish').click();await page.getByText(/Published · catalog/).waitFor();};
try{
 for(const locale of ['en','ta'])for(const width of [1440,800,390,320]){
  await page.setViewportSize({width,height:width<=800?844:1000});await visit();await setOwnerLanguage(page,locale);
  assert.equal(await page.locator('.owner-product-extra').getAttribute('open'),null);
  const controls=await page.locator('#product-panel-general input,#product-panel-general select').evaluateAll(elements=>elements.filter(el=>el.checkVisibility()).length);assert.equal(controls,3,'Everyday form should ask only name, price and unit');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
  const bar=await page.locator('.owner-save-actions').boundingBox();assert.ok(bar.x>=0&&bar.x+bar.width<=width+1);
  await page.screenshot({path:resolve(output,`product-${locale}-${width}.png`)});results.push({locale,width,everydayControls:controls,overflow:false});
 }
 await setOwnerLanguage(page,'en');await page.setViewportSize({width:1440,height:1000});await visit();const before=await current();
 await button('Update stock').click();await button('Correct count').waitFor();await page.locator('#product-tab-general').click();
 await page.locator('.owner-product-extra>summary').click();await page.getByLabel('Brand',{exact:true}).fill('Synthetic checked brand');
 await page.locator('[name=price]').fill('123.45');await page.locator('#product-tab-selling').click();await page.locator('[name=quantityStep]').fill('0');await page.locator('#product-tab-general').click();await button('Review & publish changes').click();
 assert.equal(await page.locator('#product-tab-selling').getAttribute('aria-selected'),'true');assert.equal(await page.locator('[name=quantityStep]').evaluate(el=>el===document.activeElement),true);await page.locator('[name=quantityStep]').fill('1');
 await page.locator('#product-tab-general').click();await button('Save draft').click();await page.getByText('Draft saved for review. Published products keep their current details.',{exact:true}).waitFor();assert.equal((await current()).pricePaise,before.pricePaise,'Draft cannot change live price');await page.getByText('Publish this draft or reload the current product before updating stock.',{exact:true}).waitFor();
 await publish();const priced=await current();assert.equal(priced.pricePaise,12345);assert.equal(priced.brand,'Synthetic checked brand');assert.equal(priced.stockOnHand,before.stockOnHand);assert.equal(priced.stockReserved,before.stockReserved);assert.equal(priced.quantityStep,1);
 await page.locator('[name=price]').fill('0');await button('Review & publish changes').click();assert.equal(await page.locator('[name=price]').getAttribute('aria-invalid'),'true');assert.equal(await button('Confirm & publish').count(),0);
 await button('Mark this item as free').click();await publish();assert.equal((await current()).priceStatus,'free');assert.equal((await current()).pricePaise,0);
 await page.locator('[name=price]').fill('');await page.getByText('Leave the price blank if you need to confirm it with the customer.',{exact:true}).waitFor();await publish();assert.equal((await current()).priceStatus,'confirm');assert.equal((await current()).stockOnHand,before.stockOnHand);
 await page.locator('[name=productName]').fill('Uncommitted name');await button('Back to inventory').click();await page.getByRole('dialog').waitFor();await page.getByRole('dialog').getByRole('button',{name:'Keep working',exact:true}).click();assert.equal(await page.locator('[name=productName]').inputValue(),'Uncommitted name');
 await visit();await button('Back to inventory').click();await button('New product').click();await page.locator('[name=productName]').fill('Synthetic unknown-stock fitting');await page.locator('[name=unit]').selectOption('piece');await page.locator('#product-tab-photos').click();await page.getByLabel('Photo to publish',{exact:true}).selectOption('without');
 await button('Review & publish product').click();const responsePromise=page.waitForResponse(r=>r.url().endsWith('/proposals/publish')&&r.request().method()==='POST');await button('Confirm & publish').click();const response=await responsePromise;assert.equal(response.status(),200);const published=await response.json();await page.getByText(/Published · catalog/).waitFor();const unknown=(await read('/api/owner/catalog/products/'+published.sku)).product;assert.equal(unknown.stockOnHand,null);assert.equal(unknown.priceStatus,'confirm');
 assert.deepEqual(errors,[]);await writeFile(resolve(output,'results.json'),JSON.stringify({layouts:results,realLocalServices:true,draftPreservesLivePrice:true,publishedPricePaise:12345,advancedBrandPreserved:true,holdsPreserved:true,quantityErrorOpensAndFocusesSelling:true,zeroRequiresExplicitFree:true,blankPriceRemainsUnknown:true,newUnknownStockPreserved:true,unsavedNavigationGuard:true,pageErrors:errors},null,2));console.log('Product editor checks passed: eight layouts, advanced facts, draft/publish, price/unknown/free, stock holds, validation focus and navigation guard.');
}catch(error){console.error((await page.locator('body').innerText()).slice(-6500));await page.screenshot({path:resolve(output,'failure.png'),fullPage:true});throw error;}finally{await browser.close();}
