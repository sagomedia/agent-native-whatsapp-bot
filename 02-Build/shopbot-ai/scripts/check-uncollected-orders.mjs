import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'/home/gk-pc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const output=process.env.UNCOLLECTED_EVIDENCE_DIR??'/tmp/shopbot-uncollected-evidence';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
const id='12345678-0000-4000-8000-000000000001',line={id:'line-1',name:'Fixture valve',sku:'H01',quantity:2,unit:'piece',pricePaise:10000,resolution:'matched'};
let order;
const reset=()=>order={id,conversation_id:'fixture-conversation',customer_name:'Fixture customer',stage:'ready',lines:[line],original_lines:[line],original_total_paise:'20000',total_paise:'20000',effective_revision:1,created_at:'2026-10-22T03:00:00Z',advance_required:true,advance_state:'verified',original_estimate:{lines:[{id:line.id,pricePaise:10000,totalPaise:20000,approximate:false}],subtotalPaise:20000,unpriced:0,approximate:false}};reset();
await page.route('**/api/owner/**',async route=>{
 const url=new URL(route.request().url());
 if(route.request().method()==='POST'){
  const payload=route.request().postDataJSON();writes.push({path:url.pathname,payload});
  assert.equal(url.pathname,`/api/owner/requests/${id}/fulfillment`);assert.deepEqual(payload,{expected:'ready_for_pickup',status:'cancelled',expectedRevision:1,reason:'not_picked_up',notify:false});
  order={...order,stage:'cancelled',advance_state:'refund_pending'};
  return route.fulfill({json:{fulfillment:'cancelled',reason:'not_picked_up',customerNotification:'not_requested'}});
 }
 const stage=url.searchParams.get('orderStage')??'all',listed=stage==='all'||stage===order.stage;
 await route.fulfill({json:{store:{name:'Uncollected order fixture'},conversationCounts:{help:0},requests:[order],amendments:[],orderPage:{number:1,total:listed?1:0,hasNext:false,ids:listed?[id]:[]},requestCounts:{new:order.stage==='new'?1:0,ready_for_pickup:order.stage==='ready'?1:0,completed:order.stage==='completed'?1:0,active:order.stage==='ready'?1:0,history:order.stage==='cancelled'?1:0}}});
});
async function visit(){await page.goto((process.env.OWNER_PREVIEW_ORIGIN??'http://127.0.0.1:3054')+'/owner?view=requests&orderStage=ready&order='+id);await page.getByRole('button',{name:'Not picked up · Cancel order',exact:true}).waitFor();}
try{
 await visit();await page.getByRole('button',{name:'Not picked up · Cancel order',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'Cancel uncollected order?'}).waitFor();await dialog.getByText(/advance needs a separate refund check/).waitFor();
 await dialog.getByRole('button',{name:'Keep ready for pickup',exact:true}).click();assert.equal(writes.length,0);assert.equal(order.stage,'ready');console.log('PASS dismiss keeps order ready and performs no mutation');
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:844});await page.getByRole('button',{name:'Not picked up · Cancel order',exact:true}).click();await dialog.waitFor({state:'visible'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0);await page.screenshot({path:`${output}/confirm-${width}.png`});await dialog.getByRole('button',{name:'Keep ready for pickup',exact:true}).click();}console.log('PASS desktop and narrow mobile confirmation fits');
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Not picked up · Cancel order',exact:true}).click();await dialog.getByRole('button',{name:'Cancel order',exact:true}).click();
 await page.getByText('Order cancelled: customer did not pick up.',{exact:true}).waitFor();await page.getByRole('button',{name:'All',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'All',exact:true}).getAttribute('aria-pressed'),'true');await page.getByText('This order is cancelled.',{exact:true}).waitFor();await page.getByText('₹10 advance · Refund check needed',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Picked up · Close order',exact:true}).count(),0);assert.equal(writes.length,1);assert.equal(await page.getByRole('button',{name:'Completed 0',exact:true}).count(),1);console.log('PASS confirmed cancellation uses guarded API, moves to All, shows refund check, and does not count as collected');
 reset();await visit();await page.getByRole('button',{name:'Not picked up · Cancel order',exact:true}).click();order={...order,effective_revision:2};await page.evaluate(()=>window.dispatchEvent(new Event('online')));await dialog.getByRole('alert').waitFor();assert.equal(await dialog.getByRole('button',{name:'Cancel order',exact:true}).isDisabled(),true);assert.equal(writes.length,1);console.log('PASS order changed during confirmation cannot be cancelled using the stale dialog');
 assert.deepEqual(errors,[]);console.log('PASS no uncaught browser errors');
}finally{await browser.close();}
