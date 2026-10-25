import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROME_BIN||existsSync('/opt/google/chrome/chrome')?{executablePath:process.env.CHROME_BIN??'/opt/google/chrome/chrome'}:{}),args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
const output=process.env.AI_ACTIVITY_EVIDENCE_DIR??'/tmp/shopbot-ai-activity-browser';await mkdir(output,{recursive:true});
const product={sku:'FIXTURE-ELBOW',version:3,inventoryVersion:2,name:'Fixture PVC elbow',aliases:['elbow'],keywords:[],localNames:{},pricePaise:1800,priceStatus:'priced',unit:'piece',stock:20,stockOnHand:20,stockReserved:0,quantityStep:1,sellingUnitVerified:true,verification:{identity:true,photo:true,sellingUnit:true,price:true,stock:true},active:true,brand:'Fixture',familyId:'plumbing',specifications:{},imageUrl:'/fixture-photo.svg'};
const event=n=>({id:'event-'+n,sku:product.sku,name:n===1?product.name:'Fixture product '+n,action:n===1?'audit_apply':'commit',source:n===1?'audit':'mcp',applicationName:'ChatGPT',status:'live',live:true,createdAt:'2026-10-25T08:00:00Z',changes:[{field:'aliases',before:['elbow'],after:['elbow','local elbow name']}],reason:n===1?'The owner confirmed this regional name in ChatGPT.':null,conversationId:n===1?'12345678-0000-4000-8000-000000000001':null});
let releaseSlow,slowRead;
await page.route('**/api/owner/**',async route=>{
 const req=route.request(),url=new URL(req.url());requests.push(url.pathname+url.search);
 if(req.method()!=='GET'){writes.push(req.postDataJSON());return route.fulfill({status:500,json:{error:'Browser fixture must never write'}});}
 if(url.pathname==='/api/owner/catalog/ai-activity'){
  const q=url.searchParams.get('q');
  if(q==='offline')return route.fulfill({status:503,json:{error:'Fixture connection unavailable'}});
  if(q==='slow'){slowRead?.();await new Promise(resolve=>releaseSlow=resolve);}
  const mode=url.searchParams.get('mode');
  if(mode==='review')return route.fulfill({json:{mode,total:2,nextCursor:null,items:[{id:'finding-1',sku:product.sku,name:product.name,category:'alias_gap',wording:'local elbow name',explanation:'Ask the owner to confirm this exact product.',patch:{aliases:{add:['local elbow name'],remove:[]},keywords:{add:[],remove:[]}},createdAt:'2026-10-25T08:00:00Z',live:false,conversationId:'12345678-0000-4000-8000-000000000001'},{id:'finding-2',sku:null,name:null,category:'insufficient_evidence',wording:'unrecognized shop term',explanation:'The product has not been identified.',createdAt:'2026-10-25T08:00:00Z',live:false}]}}).catch(()=>{});
  return route.fulfill({json:{mode,total:26,nextCursor:url.searchParams.has('cursor')?null:'next-fixture-page',items:url.searchParams.has('cursor')?[event(25),event(26)]:Array.from({length:25},(_,i)=>event(i+1))}}).catch(()=>{});
 }
 if(url.pathname==='/api/owner/catalog/products/'+product.sku)return route.fulfill({json:{product}});
 if(url.pathname==='/api/owner/catalog')return route.fulfill({json:{products:[product],nodes:[{id:'plumbing',kind:'family',label:'Plumbing'}],total:1,totalStore:1,nextCursor:null,aiAvailable:false}});
 return route.fulfill({json:{store:{name:'Synthetic shop'},attention:{orders:0,messages:0},channel:{liveSending:false},requests:[],conversations:[]}});
});
await page.route('**/fixture-photo.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect x="20" y="20" width="80" height="80" fill="#d9e0e8"/></svg>'}));
const activity=()=>page.getByRole('region',{name:'AI activity',exact:true});
try{
 await page.goto((process.env.OWNER_PREVIEW_ORIGIN??'http://127.0.0.1:3059')+'/owner?view=catalog');
 await page.getByRole('button',{name:'AI activity',exact:true}).click();
 await activity().getByText('Live in inventory',{exact:true}).first().waitFor();
 assert.equal(await activity().getByRole('listitem').count(),25);assert.equal(await activity().getByRole('button',{name:'Applied',exact:true}).getAttribute('aria-pressed'),'true');
 await activity().getByText('See changes',{exact:false}).first().click();
 await activity().getByText('Before: elbow',{exact:true}).first().waitFor();await activity().getByText('After: elbow, local elbow name',{exact:true}).first().waitFor();
 await activity().getByRole('button',{name:'Load more',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.rd-ai-event').length===26);
 assert.equal(await activity().getByRole('listitem').count(),26);console.log('PASS default applied history, live status, before/after values and deduplicated pagination');
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844],['narrow',320,720]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' horizontal overflow');await page.getByRole('button',{name:'Applied',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:output+'/'+name+'.png'});}
 console.log('PASS desktop, mobile and 320 px layout');
 await activity().getByRole('button',{name:'Needs review',exact:true}).click();await activity().getByText('Product not identified',{exact:true}).waitFor();assert.equal(await activity().getByText('Suggestion',{exact:true}).count(),2);assert.equal(await activity().getByRole('button',{name:/^(Approve|Apply changes|Publish)$/}).count(),0);
 assert.match(await activity().getByRole('link',{name:'Conversation evidence'}).getAttribute('href'),/conversation=/);console.log('PASS unmatched suggestions, evidence links and no additional approval gate');
 await activity().getByRole('button',{name:'Applied',exact:true}).click();await activity().getByRole('button',{name:'Open product',exact:true}).first().waitFor();await activity().getByRole('button',{name:'Open product',exact:true}).first().click();await page.getByRole('heading',{name:'Edit product',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Product name',exact:true}).inputValue(),product.name);
 await page.getByRole('button',{name:'← Products',exact:true}).click();await activity().getByRole('button',{name:'Applied',exact:true}).waitFor();console.log('PASS opening exact product and returning to AI activity');
 await page.getByRole('textbox',{name:'Search products',exact:true}).fill('offline');await page.getByText('Fixture connection unavailable',{exact:false}).waitFor();await page.getByRole('textbox',{name:'Search products',exact:true}).fill('');await activity().getByText('Live in inventory',{exact:true}).first().waitFor();console.log('PASS failed reads and search recovery');
 const started=new Promise(resolve=>slowRead=resolve);await page.getByRole('textbox',{name:'Search products',exact:true}).fill('slow');await started;await page.getByRole('button',{name:'Low stock',exact:true}).click();releaseSlow?.();await page.waitForTimeout(300);assert.equal(await activity().count(),0);console.log('PASS stale in-flight activity request cannot replace a different Products filter');
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.ok(!requests.some(v=>v.includes('/catalog?')&&v.includes('stock=ai')));console.log('PASS no merchant writes, page errors or invalid stock-filter requests');
}catch(error){await page.screenshot({path:output+'/failure.png'});console.error((await page.locator('body').innerText()).slice(-2500));throw error;}
finally{releaseSlow?.();await browser.close();}
