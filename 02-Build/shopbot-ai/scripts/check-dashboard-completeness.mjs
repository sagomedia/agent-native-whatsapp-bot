// Page context and recovery checks. Isolated fixtures; all writes are rejected.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.OWNER_UI_URL??'http://127.0.0.1:5187',seed='http://127.0.0.1:3044';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Use a local dashboard.');
const read=async path=>{const response=await fetch(seed+path);assert.ok(response.ok);return response.json();};
const [snapshot,operations,catalog]=await Promise.all([read('/api/owner/snapshot?details=1'),read('/api/owner/operations/summary'),read('/api/owner/catalog?limit=100')]);
assert.equal(snapshot.store.synthetic,'true');assert.equal(snapshot.channel.liveSending,false);
const conversation=snapshot.conversations[0],order=snapshot.requests.find(row=>row.estimate_complete&&row.acceptance==='awaiting_approval');assert.ok(order);
const output=resolve(process.env.DASHBOARD_EVIDENCE_DIR??'artifacts/dashboard-completeness');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN??'/usr/bin/google-chrome'}),page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(12000);const errors=[],results=[],writes=[];page.on('pageerror',error=>errors.push(error.stack??error.message));
const button=name=>page.getByRole('button',{name,exact:true});
let operationsFail=false,galleryFail=false,proposalFail=false,historyFail=false,observationsFail=false,productFail=false,stockHistoryFail=false;
let historyReads=0;
operations.current.delivery={...operations.current.delivery,failed:2,unknown:1,blocked:0};
operations.issues=[{kind:'failed_delivery',messageId:'failed-message',conversationId:conversation.id,createdAt:new Date().toISOString()}];
snapshot.messaging={totals:[{currency:'INR',delivered:1,unknown:0,conflicting:1,estimated_microunits:null}],accountTimezone:null,analyticsAvailable:false};
await page.route('**/api/**',async route=>{
 const request=route.request(),url=new URL(request.url()),path=url.pathname,json=data=>route.fulfill({json:data}),fail=message=>route.fulfill({status:503,json:{error:message}});
 if(request.method()!=='GET'){writes.push(path);return route.fulfill({status:500,json:{error:'Writes are disabled in this check.'}});}
 if(path.endsWith('/image')||path.includes('/photos/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="176" height="140"><rect width="176" height="140" fill="#ddd"/></svg>'});
 if(path==='/api/owner/snapshot'){
  const result=structuredClone(snapshot);
  if(url.searchParams.get('inboxHelp')==='1'){result.inboxPage={number:1,size:25,total:0,hasNext:false,ids:[]};result.conversationCounts.help=0;}
  return json(result);
 }
 if(path==='/api/owner/operations/summary')return operationsFail?fail('Shop checks unavailable in this test.'):json(operations);
 if(path==='/api/owner/catalog'){
  const q=url.searchParams.get('q')??'',brand=url.searchParams.get('brand')??'',rows=catalog.products.filter(p=>(!q||[p.name,p.sku].join(' ').toLowerCase().includes(q.toLowerCase()))&&(!brand||p.brand===brand));
  return json({...catalog,products:rows.slice(0,25),total:rows.length,totalStore:catalog.products.length,nextCursor:rows.length>25?'next-page':null});
 }
 if(path.startsWith('/api/owner/catalog/products/')&&path.endsWith('/stock'))return stockHistoryFail?fail('Stock history unavailable.'):json({movements:[]});
 if(path.startsWith('/api/owner/catalog/products/'))return productFail?fail('Product read failed.'):json({product:catalog.products.find(p=>p.sku===decodeURIComponent(path.split('/').at(-1)))});
 if(path.endsWith('/quote-draft'))return json({draft:null});
 if(path==='/api/owner/catalog/proposals')return proposalFail?fail('Draft list unavailable.'):json({proposals:[],total:0,nextCursor:null,summary:{total:0,conflicts:0,issues:0,missingPhoto:0,pendingPrice:0,unknownStock:0}});
 if(path==='/api/owner/catalog/intake')return json({batches:[]});
 if(path.endsWith('/observations'))return observationsFail?fail('Evidence read failed.'):json({attempts:[]});
 if(path.startsWith('/api/owner/conversations/')){
  historyReads++;if(historyFail)return fail('Message history temporarily unavailable.');
  const end=Number(url.searchParams.get('before')??405),start=Math.max(0,end-200);
  return json({messages:Array.from({length:end-start},(_,offset)=>{const index=start+offset;return {id:'history-'+index,sequence:String(index+1),conversation_id:path.split('/')[4],direction:'inbound',text:'Retained message '+index,status:'processed',created_at:new Date().toISOString(),whatsapp:false};}),limit:200,olderCursor:start?String(start):null});
 }
 if(path==='/api/owner/message-gallery')return galleryFail?fail('Preview read failed.'):json({entries:[{id:'example',label:'Product choices',group:'Shopping',note:'Synthetic sample',reply:{version:1,kind:'text',replyLanguage:url.searchParams.get('language'),text:'Sample reply',accessibleText:'Sample reply',parts:[]}}]});
 return route.fulfill({status:404,json:{error:'Unexpected test read: '+path}});
});
async function visit(search){await page.goto(base+'/owner?'+search);await page.locator('.owner-footer').waitFor({state:'attached'});}
try{
 await visit('view=overview&bulk=1&product=old&q=no-match&brand=old&family=old&exception=missing_photo&stock=unknown&orderSearch=old&inboxSearch=old');
 await page.getByRole('heading',{name:'Message checks need attention',exact:true}).waitFor();assert.equal(await page.locator('.owner-home-diagnostics').getAttribute('open'),null);
 assert.match(await page.locator('.owner-mode-note').innerText(),/Customer messages are not being sent/);assert.doesNotMatch(await page.locator('.owner-mode-note').innerText(),/Messages can reach/);
 await button('Review message checks').click();assert.equal(await page.locator('.owner-home-diagnostics').getAttribute('open'),'');
 await page.screenshot({path:resolve(output,'today-visible-exceptions-desktop.png')});
 await page.getByRole('link',{name:'Update prices & stock',exact:true}).click();await page.getByRole('heading',{name:'Update prices & stock',exact:true}).waitFor();
 let params=new URL(page.url()).searchParams;for(const key of ['bulk','product','q','brand','family','exception','stock','cursor','page'])assert.equal(params.has(key),false,key);assert.equal(params.get('quick'),'1');
 results.push('Today exposes send failures and disabled channel truth; task shortcuts clear unrelated filters and selections');
 operationsFail=true;await visit('view=overview');await page.getByRole('alert').filter({hasText:'Shop checks unavailable'}).waitFor();operationsFail=false;await page.getByRole('alert').getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('heading',{name:'Message checks need attention',exact:true}).waitFor();assert.equal(await page.getByRole('alert').count(),0);
 results.push('Failed shop checks have a visible retry outside the closed diagnostics section');
 await visit('view=catalog&inventory=1&quick=1&brand=unlisted-brand&family=pipes&exception=missing_photo&sort=sku');await page.getByText('No products match these filters. Clear filters to see the full catalog.',{exact:true}).waitFor();
 const filters=page.getByLabel('Applied filters',{exact:true});await filters.waitFor();for(const text of ['unlisted-brand','pipes','Missing photo','Product code'])assert.ok((await filters.innerText()).includes(text));assert.equal(await page.locator('.owner-catalog-filters').count(),0);
 await page.screenshot({path:resolve(output,'products-filter-context.png')});await filters.getByRole('button',{name:'Clear filters',exact:true}).click();await page.getByRole('row').filter({hasText:catalog.products[0].name}).waitFor();assert.equal(new URL(page.url()).searchParams.has('brand'),false);await page.getByRole('link',{name:'Back to products',exact:true}).click();
 proposalFail=true;await button('Review unpublished drafts').click();await button('Retry loading drafts').waitFor();proposalFail=false;await button('Retry loading drafts').click();await page.getByText('No drafts match this group. Choose another exception group or clear the search.',{exact:true}).waitFor();
 results.push('All applied product filters remain visible when controls are closed; clear and draft retry recover in place');
 productFail=true;await page.getByRole('row').filter({hasText:catalog.products[0].name}).getByRole('button',{name:'Edit product',exact:true}).click();await page.getByRole('alert').filter({hasText:'Product read failed.'}).waitFor();assert.equal(await page.getByLabel('Product name',{exact:true}).isVisible(),false);
 productFail=false;stockHistoryFail=true;await page.getByRole('alert').getByRole('button',{name:'Try again',exact:true}).click();await page.getByLabel('Product name',{exact:true}).waitFor();assert.equal(await page.getByLabel('Product name',{exact:true}).inputValue(),catalog.products[0].name);
 await page.getByRole('tab',{name:'Stock',exact:true}).click();await page.getByText('Recent stock history · Unavailable',{exact:true}).click();await button('Retry stock history').waitFor();assert.equal(await page.getByText('No movements recorded yet. Existing catalog counts have not been physically rechecked.',{exact:true}).count(),0);stockHistoryFail=false;await button('Retry stock history').click();await page.getByText('No movements recorded yet. Existing catalog counts have not been physically rechecked.',{exact:true}).waitFor();
 results.push('Failed product reads never leave the previous product editable; stock history errors never masquerade as no movements; both retry in place');
 order.payment='unknown';await visit('view=requests&order='+order.id);await page.getByLabel('Order facts',{exact:true}).waitFor();assert.match(await page.getByLabel('Order facts',{exact:true}).innerText(),/Not yet accepted[\s\S]*Payment outcome unknown/);assert.equal(await button('Accept order').isVisible(),true);
 await page.screenshot({path:resolve(output,'order-payment-stock-context.png')});
 const item=order.inventory[0];item.available=0;item.held=0;await visit('view=requests&order='+order.id+'&bulk=1&q=stale&brand=stale');await button('Review recorded stock').click();await page.locator('#product-panel-stock').waitFor();assert.equal(await page.getByLabel('Stock movements',{exact:true}).isVisible(),true);params=new URL(page.url()).searchParams;assert.equal(params.get('product'),item.sku);assert.equal(params.has('bulk'),false);assert.equal(params.has('q'),false);assert.equal(params.has('brand'),false);
 results.push('Order acceptance, pickup, payment and stock are visible; stock repair opens the actual product even after a CSV task');
 await visit('view=conversations&inboxHelp=1');await page.getByRole('heading',{name:'No customers need help',exact:true}).waitFor();await button('View all conversations').click();await page.locator('.owner-thread-rows>button').first().waitFor();
 historyFail=true;await visit('view=conversations&conversation='+conversation.id);await page.locator('.owner-message-list').getByRole('alert').waitFor();assert.equal(await page.getByRole('heading',{name:'No messages yet',exact:true}).count(),0);historyFail=false;await page.locator('.owner-message-list').getByRole('button',{name:'Try again',exact:true}).click();await page.getByText('Retained message 404',{exact:true}).waitFor();await page.getByText('WhatsApp sending is disabled.',{exact:false}).first().waitFor();
 await page.locator('.owner-message-list').getByRole('button',{name:'Earlier messages',exact:true}).click();await page.getByText('Retained message 204',{exact:true}).waitFor();assert.equal(await page.getByText('Retained message 404',{exact:true}).count(),0);assert.equal(await page.getByLabel('Reply to customer',{exact:true}).count(),0);
 await page.locator('.owner-message-list').getByRole('button',{name:'Earlier messages',exact:true}).click();await page.getByText('Retained message 0',{exact:true}).waitFor();assert.equal(await page.locator('.owner-message').count(),5);
 await page.screenshot({path:resolve(output,'earlier-message-history.png')});await page.locator('.owner-message-list').getByRole('button',{name:'Newer messages',exact:true}).click();await page.getByText('Retained message 204',{exact:true}).waitFor();await page.locator('.owner-message-list').getByRole('button',{name:'Latest messages',exact:true}).click();await page.getByText('Retained message 404',{exact:true}).waitFor();
 await page.getByRole('link',{name:'Review this customer’s orders',exact:true}).click();assert.equal(new URL(page.url()).searchParams.get('orderSearch'),conversation.id);assert.equal(new URL(page.url()).searchParams.get('requests'),'all');
 results.push('Message filters have truthful empty states; read failures retry; all 405 retained messages are reachable in bounded pages with a direct order link');
 observationsFail=true;await visit('view=conversations&conversation='+conversation.id);await button('Interpretation evidence').click();await page.getByRole('alert').filter({hasText:'Could not load interpretation evidence.'}).waitFor();observationsFail=false;await page.getByRole('alert').getByRole('button',{name:'Try again',exact:true}).click();await page.getByText('No retained observations for this conversation.',{exact:true}).waitFor();
 galleryFail=true;await visit('view=message-review');await page.getByRole('alert').waitFor();galleryFail=false;await page.getByRole('alert').getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('heading',{name:'Product choices',exact:true}).waitFor();await page.getByLabel('Flow stage').selectOption('Recovery');await page.getByRole('heading',{name:'No message previews in this stage',exact:true}).waitFor();await button('Show all stages').click();await page.getByRole('heading',{name:'Product choices',exact:true}).waitFor();
 await visit('view=connections');await page.getByRole('alert').filter({hasText:'unknown or conflicting charges'}).waitFor();results.push('Evidence and preview errors offer retry; empty preview filters can reset; conflicting-only charges retain the incomplete-total warning');
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:width<=390?640:1000});
  for(const view of ['overview','requests','conversations','catalog','connections','message-review']){
   await visit('view='+view+(view==='requests'?'&order='+order.id:view==='conversations'?'&conversation='+conversation.id:''));await page.waitForTimeout(180);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),view+' horizontal overflow at '+width);
   if(view==='requests'&&width===320){const viewport=await page.locator('.order-items-scroll').boundingBox();assert.ok(viewport.height>=120,'Phone order items need a usable scroll area: '+viewport.height);await page.locator('.order-items-scroll').evaluate(element=>element.scrollTo({top:0}));await page.getByLabel('Order facts',{exact:true}).waitFor();}
   if(width===320||width===1440)await page.screenshot({path:resolve(output,view+'-'+width+'.png')});
  }
 }
 await page.getByLabel('Dashboard language / மொழி',{exact:true}).selectOption('ta');await visit('view=requests&order='+order.id);await page.getByLabel('ஆர்டர் விவரங்கள்',{exact:true}).waitFor();assert.ok((await page.locator('.order-items-scroll').boundingBox()).height>=120,'Tamil order contents need a usable scroll area');assert.ok(await page.locator('.order-footer-actions').evaluate(element=>{const bounds=element.getBoundingClientRect();return [...element.querySelectorAll('button')].every(button=>{const rect=button.getBoundingClientRect();return rect.left>=bounds.left-1&&rect.right<=bounds.right+1&&button.scrollWidth<=button.clientWidth+1;});}),'Tamil actions must fit their container');await page.screenshot({path:resolve(output,'order-context-tamil-320.png')});
 for(const language of ['en','ta']){
  await page.getByLabel('Dashboard language / மொழி',{exact:true}).selectOption(language);
  for(const request of snapshot.requests){
   await visit('view=requests&order='+request.id);await page.locator('.order-items-scroll').waitFor();
   assert.ok((await page.locator('.order-items-scroll').boundingBox()).height>=120,language+' '+request.fulfillment+' requires usable item space');
   assert.ok(await page.locator('.order-footer-actions').evaluate(element=>element.scrollWidth<=element.clientWidth+1),language+' order actions must fit');
  }
 }
 results.push('Six pages fit desktop, tablet and 320/390-pixel phones; every seeded order state retains usable content and actions in English and Tamil');
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.ok(historyReads>=5);
 await writeFile(resolve(output,'results.json'),JSON.stringify({synthetic:true,writes,passed:results,viewports:[1440,768,390,320],pageErrors:errors},null,2));console.log(results.join('\n'));
}catch(error){console.error('Browser errors:',errors);console.error((await page.locator('body').innerText()).slice(0,5000));await page.screenshot({path:resolve(output,'failure.png')});throw error;}finally{await browser.close();}
