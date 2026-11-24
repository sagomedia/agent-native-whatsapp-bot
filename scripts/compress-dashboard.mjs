import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {brotliCompressSync,gzipSync,constants} from 'node:zlib';

// Compression runs during the off-server build, never on the small VPS.
let original=0,gzip=0,brotli=0;
async function compress(directory){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=join(directory,entry.name);
  if(entry.isDirectory()){await compress(path);continue;}
  if(!/\.(?:html|js|css|svg|ttf)$/.test(entry.name))continue;
  const bytes=await readFile(path),gz=gzipSync(bytes,{level:9}),br=brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:9}});
  // Keep the originals for clients that do not accept compression.
  await writeFile(path+'.gz',gz);await writeFile(path+'.br',br);
  original+=bytes.length;gzip+=gz.length;brotli+=br.length;
 }
}
await compress('dist/dashboard');
console.log(JSON.stringify({dashboardCompression:{original,gzip,brotli}}));
