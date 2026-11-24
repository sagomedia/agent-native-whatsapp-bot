import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {normalizeImage} from '../apps/server/src/services/image-media.js';
import {prepareCatalogImageVariants,catalogVariantByteLimits} from '../apps/server/src/services/catalog-image-variants.js';
import {catalogPhotoDimensions} from '../apps/dashboard/src/catalog-photo.js';
function raster(width:number,height:number){const r=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i',`testsrc2=size=${width}x${height}`,'-vf','noise=alls=80:allf=t','-frames:v','1','-threads','1','-q:v','8','-f','image2pipe','-vcodec','mjpeg','pipe:1'],{maxBuffer:5*1024*1024});assert.equal(r.status,0,r.stderr.toString());return r.stdout;}
test('catalog masters and all three previews have enforceable storage bounds, preserving proportions',async()=>{
 const bytes=raster(1600,1200);assert.ok(bytes.length<2097152);const media=await normalizeImage({id:randomUUID(),mimeType:'image/jpeg',data:bytes.toString('base64'),caption:''},{catalog:true});
 assert.ok(media.image.length<=500*1024);assert.ok(media.width<=1280&&media.height<=1280);assert.ok(Math.abs(media.width/media.height-4/3)<.01);
 const variants=await prepareCatalogImageVariants(media.image);for(const v of variants){assert.ok(v.image.length<=catalogVariantByteLimits[v.size],String(v.size));assert.ok(v.image.length>0);assert.equal(v.image[0],255);}
 const dims=catalogPhotoDimensions(bytes);assert.deepEqual(dims,{width:1600,height:1200});
});
test('dimension inspection handles malformed and oversized image headers without allocating a bitmap',()=>{
 assert.equal(catalogPhotoDimensions(new Uint8Array([255,216,255])),undefined);
 const png=new Uint8Array(24);png.set([137,80,78,71]);const view=new DataView(png.buffer);view.setUint32(16,50000);view.setUint32(20,50000);assert.deepEqual(catalogPhotoDimensions(png),{width:50000,height:50000});
 const webp=new Uint8Array(30);webp.set(Buffer.from('RIFF'),0);webp.set(Buffer.from('WEBPVP8X'),8);webp[24]=127;webp[27]=255;assert.deepEqual(catalogPhotoDimensions(webp),{width:128,height:256});
});
test('catalog optimization never broadens incoming customer image limits or accepted byte formats',async()=>{
 const id=randomUUID();await assert.rejects(normalizeImage({id,mimeType:'image/jpeg',data:Buffer.alloc(2097153).toString('base64'),caption:''}),/under 2 MB/);
 await assert.rejects(normalizeImage({id,mimeType:'image/jpeg',data:Buffer.from('not a raster').toString('base64'),caption:''},{catalog:true}),/not a supported/);
});
