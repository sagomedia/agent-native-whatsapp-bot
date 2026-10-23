import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'/home/gk-pc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[];
page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());page.setDefaultTimeout(10000);
const id='12345678-0000-4000-8000-000000000001',other='12345678-0000-4000-8000-000000000002';
const conversation={id,actor:'whatsapp:fixture',customer_name:'Reply fixture',operator_mode:'owner',operator_revision:4,handoff_requested:false,last_text:'Customer question',updated_at:new Date().toISOString(),last_inbound_at:new Date().toISOString(),pending:0};
let persisted=[],holdReads=false,failReads=false,loseResponse=false,releaseReads;
let readGate=Promise.resolve();
const output=process.env.REPLY_EVIDENCE_DIR??'/tmp/shopbot-reply-evidence';await mkdir(output,{recursive:true});
await page.route('**/api/owner/**',async route=>{
 const request=route.request(),url=new URL(request.url());
 if(request.method()==='POST'){
  assert.equal(url.pathname,`/api/owner/conversations/${id}/reply`);
  const body=request.postDataJSON();writes.push(body);assert.equal(body.revision,4);
  if(!persisted.some(message=>message.id===body.id))persisted.push({id:body.id,sequence:String(persisted.length+1),conversation_id:id,direction:'outbound',text:body.text,created_at:new Date().toISOString(),status:'delivered',whatsapp:true,sender_kind:'owner',media_available:null});
  if(loseResponse){loseResponse=false;return route.abort('failed');}
  return route.fulfill({json:{messageId:body.id,queued:true}});
 }
 if(holdReads)await readGate;
 if(failReads)return route.fulfill({status:503,json:{error:'Fixture refresh unavailable'}}).catch(()=>{});
 if(url.pathname.includes('/conversations/'))return route.fulfill({json:{messages:url.pathname.endsWith(id)?persisted:[],olderCursor:null}}).catch(()=>{});
 return route.fulfill({json:{store:{name:'Reply test',operator_paused:false},channel:{liveSending:true},conversations:[conversation,{...conversation,id:other,customer_name:'Other fixture'}],conversationCounts:{help:0,total:2}}}).catch(()=>{});
});
const textarea=page.getByRole('textbox',{name:'Reply to customer'});
const send=page.getByRole('button',{name:'Send reply',exact:true});
async function visit(){await page.goto((process.env.OWNER_PREVIEW_ORIGIN??'http://127.0.0.1:3054')+'/owner?view=conversations&conversation='+id);await page.getByText('No messages yet.',{exact:true}).waitFor();}
try{
 await visit();holdReads=true;readGate=new Promise(resolve=>releaseReads=resolve);
 await textarea.fill('Confirmed reply');await send.click();
 await page.locator('textarea:enabled').waitFor({timeout:1500});
 await page.getByRole('log').getByText('Confirmed reply',{exact:true}).waitFor({timeout:1500});
 assert.equal(await textarea.inputValue(),'');assert.equal(await page.getByRole('log').getByText(/You · Queued/).count(),1);
 await textarea.fill('Next reply draft');assert.equal(await send.isEnabled(),true);
 await page.getByRole('button').filter({hasText:'Other fixture'}).click();await textarea.waitFor();assert.equal(await textarea.inputValue(),'');
 await page.getByRole('button').filter({hasText:'Reply fixture'}).click();assert.equal(await textarea.inputValue(),'Next reply draft');
 console.log('PASS accepted reply appears and composer/chat navigation unlock while follow-up reads remain blocked; drafts stay per chat');
 failReads=true;holdReads=false;releaseReads();
 await page.getByText('Messages are not updating.',{exact:false}).waitFor();
 assert.equal(await page.getByRole('log').getByText('Confirmed reply',{exact:true}).count(),1);
 assert.equal(await textarea.isEnabled(),true);assert.equal(await textarea.inputValue(),'Next reply draft');assert.equal(writes.length,1);
 assert.equal(await page.getByText(/Could not send your reply/).count(),0);
 console.log('PASS refresh failure preserves confirmed reply and new draft without reporting a send failure');
 failReads=false;await page.getByRole('log').getByRole('button',{name:'Try again',exact:true}).click();
 await page.getByRole('log').getByText(/You · Delivered/).waitFor();assert.equal(await page.getByRole('log').getByText('Confirmed reply',{exact:true}).count(),1);
 console.log('PASS history reconciles queued bubble to delivered without a duplicate');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/mobile.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 persisted=[];await visit();loseResponse=true;await textarea.fill('Safe retry');await send.click();
 await page.getByText('Failed to fetch',{exact:true}).waitFor();assert.equal(await textarea.inputValue(),'Safe retry');
 await send.click();await page.getByText('Reply queued. Its delivery status will appear here.',{exact:true}).waitFor();
 assert.equal(writes.at(-1).id,writes.at(-2).id);assert.equal(persisted.length,1);
 await page.getByRole('log').getByText(/You · Delivered/).waitFor();assert.equal(await page.getByRole('log').getByText('Safe retry',{exact:true}).count(),1);
 console.log('PASS ambiguous POST failure preserves draft and reuses its idempotency ID on retry');
 assert.deepEqual(errors,[]);console.log('PASS mobile layout and no uncaught browser errors');
}catch(error){console.error((await page.locator('body').innerText()).slice(-2200));await page.screenshot({path:output+'/failure.png'});throw error;}
finally{releaseReads?.();await browser.close();}
