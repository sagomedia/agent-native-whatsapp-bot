import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'/home/gk-pc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const fixture=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=2400x1600','-vf','noise=alls=80:allf=t','-frames:v','1','-threads','1','-f','image2pipe','-vcodec','png','pipe:1'],{maxBuffer:11*1024*1024});assert.equal(fixture.status,0,fixture.stderr.toString());assert.ok(fixture.stdout.length>2097152&&fixture.stdout.length<10485760);
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},extraHTTPHeaders:{'accept-encoding':'identity'}});if(process.env.PHOTO_BROWSER_FALLBACK==='1')await page.addInitScript(()=>{globalThis.createImageBitmap=undefined;});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3044/owner?view=catalog');await page.getByRole('button',{name:'Add product',exact:false}).first().click();
 await page.getByText('JPG, PNG or WebP up to 10 MB. Photos are automatically optimized.').waitFor();
 const file=page.locator('input[type=file]');await file.setInputFiles({name:'redmi-camera.png',mimeType:'application/octet-stream',buffer:fixture.stdout});
 await page.getByText('Optimizing photo…',{exact:true}).waitFor({state:'hidden'});const preview=page.locator('.rd-products-photo-input img');await preview.waitFor();await preview.evaluate(img=>img.decode());
 const source=await preview.getAttribute('src');assert.ok(source.startsWith('data:image/jpeg;base64,'));const optimized=Buffer.from(source.split(',')[1],'base64');assert.ok(optimized.length<=512000);
 const form=page.locator('.rd-products-form');await form.locator('input[maxlength="160"]').fill('Synthetic phone compression product');await form.locator('input[inputmode="decimal"]').first().fill('123');
 await file.setInputFiles({name:'invalid.jpg',mimeType:'image/jpeg',buffer:Buffer.from('not a picture')});await page.getByText(/Choose an actual JPG/).waitFor();assert.equal(await preview.getAttribute('src'),source);assert.equal(await form.locator('input[maxlength="160"]').inputValue(),'Synthetic phone compression product');
 // A valid same-file retry clears the error and still uses compressed bytes.
 await file.setInputFiles({name:'redmi-camera.png',mimeType:'',buffer:fixture.stdout});await page.getByText('Optimizing photo…',{exact:true}).waitFor({state:'hidden'});
 let sentBytes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/products/simple'))sentBytes=Buffer.from(r.postDataJSON().photo.data,'base64').length;});
 const saved=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/products/simple'));await page.getByRole('button',{name:'Add product',exact:true}).click();const response=await saved;assert.equal(response.status(),200,await response.text());const product=await response.json();assert.ok(sentBytes<=512000);await page.getByText('Product added to your shop.').waitFor();
 await page.getByRole('button',{name:'Edit Synthetic phone compression product',exact:true}).first().click();await page.getByText('Change photo',{exact:true}).waitFor();assert.ok(await page.locator('.rd-products-photo-input img').getAttribute('src'));await page.locator('.rd-products-photo-input img').evaluate(img=>img.decode());
 await page.getByRole('heading',{name:'Edit product',exact:true}).scrollIntoViewIfNeeded();
 const directory=process.env.PHOTO_EVIDENCE_DIR;if(directory){await mkdir(directory,{recursive:true});await page.screenshot({path:directory+'/phone-product.png',fullPage:false});}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,inputBytes:fixture.stdout.length,uploadedBytes:sentBytes,savedSku:product.sku,failedSelectionPreservedPhoto:true,repeatSelection:true,phoneLayout:390},null,2));
}finally{await browser.close();}
