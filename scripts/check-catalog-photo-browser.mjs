import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'/home/gk-pc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN??'/usr/bin/google-chrome',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto('http://127.0.0.1:3055/');
 const results=await page.evaluate(async()=>{
  const {prepareCatalogPhoto,catalogPhotoDimensions}=await import('/src/catalog-photo.ts');const results=[];
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};
  const blob=async(canvas,type='image/jpeg',q=.9)=>new Promise(resolve=>canvas.toBlob(resolve,type,q));
  const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle='#d21e21';g.fillRect(0,0,w/2,h);g.fillStyle='#1564c5';g.fillRect(w/2,0,w/2,h);return c;};
  const inspect=async(name,file)=>{const start=performance.now(),p=await prepareCatalogPhoto(file);check(p.bytes<=512000,name+' output too large');check(Math.max(p.width,p.height)<=1280,name+' dimensions');check(p.mimeType==='image/jpeg',name+' format');results.push({name,inputBytes:file.size,bytes:p.bytes,width:p.width,height:p.height,ms:Math.round(performance.now()-start)});return p;};
  const camera=canvas(8000,6000),cameraBlob=await blob(camera);await inspect('48MP camera photo',new File([cameraBlob],'camera.jpg',{type:'image/jpeg'}));camera.width=1;camera.height=1;
  const noisy=canvas(2000,1500),ctx=noisy.getContext('2d'),pixels=ctx.createImageData(2000,1500);let n=145;for(let i=0;i<pixels.data.length;i+=4){for(let c=0;c<3;c++){n=(Math.imul(n,1664525)+1013904223)>>>0;pixels.data[i+c]=n>>>24;}pixels.data[i+3]=255;}ctx.putImageData(pixels,0,0);const large=await blob(noisy,'image/png');check(large.size>2*1024*1024&&large.size<=10*1024*1024,'large PNG fixture');await inspect('9MB PNG, empty Android MIME',new File([large],'camera.png',{type:''}));noisy.width=1;noisy.height=1;
  const small=await blob(canvas(320,240));const normal=await inspect('wrong Android MIME, correct JPEG bytes',new File([small],'download.jpg',{type:'application/octet-stream'}));check(normal.width===320&&normal.height===240,'must not upscale');
  const transparent=document.createElement('canvas');transparent.width=100;transparent.height=100;const t=await inspect('transparent PNG',new File([await blob(transparent,'image/png')],'clear.png',{type:'image/png'}));const ti=new Image();ti.src=t.preview;await ti.decode();const tc=canvas(100,100);tc.getContext('2d').drawImage(ti,0,0);const color=tc.getContext('2d').getImageData(10,10,1,1).data;check(color[0]>245&&color[1]>245&&color[2]>245,'transparent image must become white, not black');
  const bytes=new Uint8Array(await small.arrayBuffer());const exif=new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);const oriented=await inspect('EXIF portrait rotation',new File([bytes.slice(0,2),exif,bytes.slice(2)],'portrait.jpg',{type:'image/jpeg'}));check(oriented.width===240&&oriented.height===320,'EXIF portrait must be retained without upscaling');
  for(const [name,file,pattern] of [
   ['over 10MB',new File([new Uint8Array(10*1024*1024+1)],'huge.jpg'),/10 MB/],
   ['HEIF guidance',new File([new Uint8Array([0,0,0,24,...new TextEncoder().encode('ftypheic')])],'camera.heic'),/JPG|compatible/],
   ['fake JPG',new File(['not a photograph'],'fake.jpg',{type:'image/jpeg'}),/actual JPG/],
   ['empty file',new File([],'empty.jpg'),/empty/],
   ['corrupt raster',new File([new Uint8Array([255,216,255,224,0,2])],'broken.jpg'),/could not be opened/]
  ]){let message='';try{await prepareCatalogPhoto(file);}catch(e){message=e.message;}check(pattern.test(message),name+' wrong rejection '+message);results.push({name,rejected:true,message});}
  const bomb=new Uint8Array(32);bomb.set([137,80,78,71]);new DataView(bomb.buffer).setUint32(16,50000);new DataView(bomb.buffer).setUint32(20,50000);let message='';try{await prepareCatalogPhoto(new File([bomb],'huge.png'));}catch(e){message=e.message;}check(/too many pixels/.test(message),'oversized header must fail before decode');results.push({name:'pixel guard before decode',rejected:true});
  const original=globalThis.createImageBitmap;globalThis.createImageBitmap=undefined;try{const fallback=await inspect('older browser fallback',new File([small],'fallback.jpg'));check(fallback.width===320,'fallback dimensions');const portrait=await prepareCatalogPhoto(new File([bytes.slice(0,2),exif,bytes.slice(2)],'fallback-portrait.jpg'));check(portrait.width===240&&portrait.height===320,'fallback portrait dimensions');}finally{globalThis.createImageBitmap=original;}
  return results;
 });
 assert.equal(results.length,12);console.log(JSON.stringify({passed:true,results},null,2));
 const dir=process.env.PHOTO_EVIDENCE_DIR;if(dir){await mkdir(dir,{recursive:true});await writeFile(dir+'/browser-results.json',JSON.stringify({passed:true,results},null,2)+'\n');}
}finally{await browser.close();}
