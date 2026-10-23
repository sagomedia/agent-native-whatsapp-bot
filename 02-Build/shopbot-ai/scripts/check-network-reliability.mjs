import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'/home/gk-pc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output=process.env.REDESIGN_EVIDENCE_DIR;
if(!output)throw new Error('Set REDESIGN_EVIDENCE_DIR to the disposable preview evidence directory.');
const fixture=JSON.parse(await readFile(output+'/fixture.json','utf8')),base=fixture.origin;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw new Error('Use only the local synthetic preview.');
const browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']}),context=await browser.newContext(),page=await context.newPage();
const errors=[],reads=[],checks=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='GET'&&request.url().includes('/api/owner/'))reads.push(request.url());});
const cdp=await context.newCDPSession(page);
const pass=(name,details={})=>{checks.push({name,...details});console.log('PASS '+name+' '+JSON.stringify(details));};
try{
 await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:600,downloadThroughput:32768,uploadThroughput:16384,connectionType:'cellular3g'});
 const start=performance.now();await page.goto(base+'/owner?view=catalog',{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('heading',{name:'Products',exact:true}).waitFor({timeout:60000});await page.getByRole('button',{name:/Edit /}).first().waitFor({timeout:60000});
 const images=await page.locator('.rd-products-image img').evaluateAll(nodes=>nodes.map(node=>({src:node.getAttribute('src'),loading:node.loading,decoding:node.decoding})));
 assert.ok(images.length>0);assert.ok(images.every(image=>image.src.includes('size=128')&&image.loading==='lazy'&&image.decoding==='async'));
 pass('products load on a 256 kbps connection with 600 ms latency and request small lazy thumbnails',{elapsedMs:Math.round(performance.now()-start),images:images.length});
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 // Enable only the synthetic browser's composer; no sender or live channel is
 // enabled on the server, and this check never submits a customer reply.
 await page.route('**/api/owner/snapshot?**',async route=>{const response=await route.fetch(),data=await response.json();data.channel.liveSending=true;await route.fulfill({response,json:data});});
 await page.goto(base+'/owner?view=conversations&conversation='+fixture.conversation0);
 const takeover=page.getByRole('button',{name:'Reply myself',exact:true});await page.getByRole('heading',{name:'Ramesh Kumar',exact:true}).waitFor();if(await takeover.isVisible())await takeover.click();
 const draft=page.getByRole('textbox',{name:'Reply to customer'});await draft.fill('Keep this unsent reply while my connection is unavailable.');
 await context.setOffline(true);await page.waitForTimeout(300);const before=reads.length;await page.waitForTimeout(5500);
 assert.equal(reads.length,before);assert.equal(await draft.inputValue(),'Keep this unsent reply while my connection is unavailable.');assert.ok(await page.getByRole('log').locator('.rd-chats-bubble').count()>0);
 pass('disconnect pauses API polling and preserves loaded messages and the unsent draft');
 await context.setOffline(false);await page.waitForFunction(()=>navigator.onLine);await page.waitForTimeout(500);
 assert.ok(reads.length>before);assert.equal(await draft.inputValue(),'Keep this unsent reply while my connection is unavailable.');pass('reconnect resumes polling without clearing the draft');
 await page.route('**/api/owner/snapshot?details=1',async route=>{await new Promise(resolve=>setTimeout(resolve,800));await route.continue();});
 await page.getByRole('link',{name:'Settings',exact:true}).first().click();await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
 assert.deepEqual(errors,[]);pass('switching from a lightweight summary to delayed settings data renders without a crash');
 await page.screenshot({path:output+'/network-recovery.png'});
 const samples=[];
 for(const path of ['summary','snapshot?details=0']){
  const times=[],bytes=[];
  for(let batch=0;batch<10;batch++)await Promise.all(Array.from({length:12},async()=>{const started=performance.now(),response=await fetch(base+'/api/owner/'+path,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);const body=await response.text();times.push(performance.now()-started);bytes.push(Buffer.byteLength(body));}));
  times.sort((a,b)=>a-b);samples.push({path,requests:times.length,concurrency:12,p50Ms:Math.round(times[Math.floor(times.length*.5)]),p95Ms:Math.round(times[Math.floor(times.length*.95)]),bytes:bytes[0]});
 }
 assert.ok(samples[0].bytes<samples[1].bytes/4);pass('bounded concurrent read test completes without failed requests',{samples});
 await writeFile(output+'/network-reliability.json',JSON.stringify({synthetic:true,checks,errors},null,2));
}catch(error){await page.screenshot({path:output+'/network-failure.png'}).catch(()=>{});throw error;}finally{await browser.close();}
