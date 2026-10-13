import {chromium} from '/home/gk-pc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const output=new URL('../artifacts/voice-operations/',import.meta.url).pathname;await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const snap=()=>page.evaluate(async()=>(await fetch('/api/native-test')).json());
async function settle(before){for(let n=0;n<90;n++){const s=await snap();if(!s.pending&&s.messages.filter(m=>m.direction==='outbound').length>before)return s;await page.waitForTimeout(300);}throw Error('Conversation did not settle');}
async function message(text){const old=await snap();await page.locator('#chat-message').fill(text);await page.locator('#chat-message').press('Enter');return settle(old.messages.filter(m=>m.direction==='outbound').length);}
async function picture(name){await page.waitForTimeout(350);await page.screenshot({path:output+name+'.png',fullPage:true});}
const report={mode:'Synthetic inventory and controlled recognized transcript; no fresh ASR or external sends',customer:{},owner:{},errors};
try{
 await page.goto('http://127.0.0.1:3056/native-test');await page.locator('.shop-chat-header button').click();await page.waitForFunction(()=>!document.querySelector('#chat-message')?.disabled);
 let s=await message('ஹோஸ் ஒன்னு, எல்போ ஒன்னு வேண்டும்');assert.equal(s.conversation.draft.length,2);await picture('products-tamil');
 s=await message('H13 விலை என்ன');assert.match(s.messages.at(-1).text,/450/);assert.equal(s.conversation.draft.length,2);await picture('known-price-and-stock');
 s=await message('bill');assert.match(s.messages.at(-1).text,/475/);await picture('estimated-bill');
 // The previous quote creates a read-only memory. Review the full current list
 // before sending, exactly as a customer can do by speech or text.
 // Explicit speech can send the same list after a read-only quote.
 await page.waitForTimeout(6500); // Observe the free fixture's six-second request interval.
 const id=randomUUID(),pcm=Buffer.alloc(32000),h=Buffer.alloc(44);for(let n=0;n<16000;n++)pcm.writeInt16LE(Math.round(Math.sin(n*.17)*1500),n*2);h.write('RIFF');h.writeUInt32LE(36+pcm.length,4);h.write('WAVE',8);h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(16000,24);h.writeUInt32LE(32000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);
 const before=s.messages.filter(m=>m.direction==='outbound').length;
 const response=await page.evaluate(async body=>{const r=await fetch('/api/native-test/voice',{method:'POST',headers:{'content-type':'application/json','x-shopbot-local-test':'1'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};},{id,mimeType:'audio/wav',data:Buffer.concat([h,pcm]).toString('base64')});assert.equal(response.status,200);
 s=await settle(before);assert.equal(s.requests.length,1);assert.equal(s.requests[0].totalPaise,47500);assert.equal(s.messages.at(-1).rich.stage,'submitted');await picture('voice-submitted');report.customer={requests:1,totalPaise:47500,voiceSubmission:true};
 await page.locator('.shop-chat-header button').click();await page.waitForFunction(()=>!document.querySelector('#chat-message')?.disabled);await page.waitForTimeout(6500);await message('ஹோஸ் ஒன்னு, எல்போ ஒன்னு வேண்டும்');s=await message('Speak with Store');assert.equal(s.conversation.handoffRequested,true);await picture('store-assistance-sent');
 const owner=await browser.newContext({viewport:{width:1280,height:900},extraHTTPHeaders:{'cf-access-jwt-assertion':'offline-owner'}}),op=await owner.newPage();op.on('pageerror',e=>errors.push(e.message));
 await op.route('**/api/owner/**',async route=>{const request=route.request();const response=await route.fetch({headers:{...await request.allHeaders(),origin:'https://owner.example.test','x-shopbot-owner':'1'}});await route.fulfill({response});});
 await op.goto('http://127.0.0.1:3057/owner?view=requests');await op.getByRole('heading',{name:'Requests',exact:true}).waitFor();await op.getByRole('button',{name:'Acknowledge & reply',exact:true}).waitFor();await op.waitForTimeout(400);
 assert.match(await op.locator('.owner-tabs button').first().innerText(),/Active\s+2/);assert.equal(await op.locator('.owner-request').count(),2);await op.screenshot({path:output+'owner-active-requests.png',fullPage:true});
 await op.setViewportSize({width:390,height:900});await op.waitForTimeout(300);assert.ok(await op.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await op.screenshot({path:output+'owner-active-mobile.png',fullPage:true});
 await op.getByRole('button',{name:'Acknowledge & reply',exact:true}).click();await op.getByText(/Shop-assistance request acknowledged/).waitFor();assert.match(await op.locator('.owner-tabs button').first().innerText(),/Active\s+1/);report.owner={activeBeforeAcknowledgement:2,activeAfterAcknowledgement:1,helpRequestVisible:true,mobileOverflow:false};
 const broken=await page.evaluate(()=>[...document.images].filter(img=>!img.complete||img.naturalWidth===0).map(img=>img.src));assert.deepEqual(broken,[]);assert.deepEqual(errors,[]);await owner.close();
 await writeFile(output+'browser-evidence.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await context.close();await browser.close();}
