import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {access,chmod,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {normalizeImage} from '../apps/server/src/services/image-media.js';
import {prepareProposalAsset} from '../apps/server/src/services/catalog-proposals.js';

const rasterPath=join(import.meta.dirname,'..','resources/catalog/ksmc-demo/images/H14.jpg');
const timeoutError=/took too long to read/;

async function withFakeDecoders<T>(delayMs:number,run:(raster:Buffer,markerPath:string,spawnMarkerPath:string)=>Promise<T>){
  const root=await mkdtemp(join(tmpdir(),'shopbot-image-timeout-'));
  const bin=join(root,'bin'),markerPath=join(root,'completed'),spawnMarkerPath=join(root,'spawned'),outputPath=join(root,'valid-output.jpg');
  await (await import('node:fs/promises')).mkdir(bin);
  const raster=await readFile(rasterPath);
  await writeFile(outputPath,raster);
  const ffprobe=[
    `#!${process.execPath}`,
    `require('node:fs').writeFileSync(${JSON.stringify(spawnMarkerPath)},'spawned');`,
    `process.stdout.write(JSON.stringify({streams:[{width:640,height:480}]}));`,
    '',
  ].join('\n');
  const ffmpeg=[
    `#!${process.execPath}`,
    `const fs=require('node:fs');`,
    `const outputPath=${JSON.stringify(outputPath)};`,
    `const markerPath=${JSON.stringify(markerPath)};`,
    `process.stdin.resume();`,
    `process.stdin.on('end',()=>setTimeout(()=>{process.stdout.write(fs.readFileSync(outputPath));${delayMs?`fs.writeFileSync(markerPath,'completed');`:''}},${delayMs}));`,
    '',
  ].join('\n');
  await writeFile(join(bin,'ffprobe'),ffprobe);
  await writeFile(join(bin,'ffmpeg'),ffmpeg);
  await chmod(join(bin,'ffprobe'),0o755);
  await chmod(join(bin,'ffmpeg'),0o755);
  const previousPath=process.env.PATH;
  process.env.PATH=`${bin}${previousPath?`:${previousPath}`:''}`;
  try{return await run(raster,markerPath,spawnMarkerPath);}finally{
    if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;
    await rm(root,{recursive:true,force:true});
  }
}

function preparedInput(raster:Buffer){
  return {proposalId:randomUUID(),version:1,photo:{id:randomUUID(),mimeType:'image/jpeg' as const,data:raster.toString('base64'),caption:''},matchKind:'unconfirmed' as const};
}

test('bulk proposal asset processing honors a longer bounded timeout while the one-second limit kills a slow decoder child',async()=>{
  await withFakeDecoders(1100,async(raster,markerPath)=>{
    const prepared=await prepareProposalAsset(preparedInput(raster),{processingTimeoutMs:3000});
    assert.ok(prepared.media.image.length>0);
    assert.equal(prepared.media.width,640);
    assert.match(prepared.media.sourceHash,/^[a-f0-9]{64}$/);
    await rm(markerPath,{force:true});
    await assert.rejects(normalizeImage({id:randomUUID(),mimeType:'image/jpeg',data:raster.toString('base64'),caption:''},{processingTimeoutMs:1000}),timeoutError);
    await new Promise(resolve=>setTimeout(resolve,250));
    await assert.rejects(access(markerPath));
  });
});

test('invalid internal timeouts start no decoder and an omitted override processes the image normally',async()=>{
  await withFakeDecoders(1100,async(raster,_markerPath,spawnMarkerPath)=>{
    for(const processingTimeoutMs of [999,60001,1000.5,Number.NaN]){
      await assert.rejects(normalizeImage({id:randomUUID(),mimeType:'image/jpeg',data:raster.toString('base64'),caption:''},{processingTimeoutMs}),/integer from 1000 to 60000/);
    }
    await assert.rejects(access(spawnMarkerPath));
    const media=await normalizeImage({id:randomUUID(),mimeType:'image/jpeg',data:raster.toString('base64'),caption:''});
    assert.ok(media.image.length>0);
    await access(spawnMarkerPath);
  });
});
