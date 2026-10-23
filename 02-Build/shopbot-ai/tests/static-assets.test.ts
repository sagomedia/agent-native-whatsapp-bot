import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import type {Pool} from 'pg';
import {createApp} from '../apps/server/src/http/app.js';

test('built dashboard assets negotiate lossless compression and private caching after authentication',async()=>{
 const owner={hostname:'assets.example.test',issuer:'https://offline.cloudflareaccess.com',audience:'offline-only',email:'owner@example.test',storeId:'12345678-0000-4000-8000-000000000001'};
 const pool={query:async()=>({rowCount:1,rows:[{id:owner.storeId}]})} as unknown as Pool;
 const app=await createApp({mode:'mock',host:'127.0.0.1',port:3017,databaseUrl:'postgres://unused',mediaDir:'/tmp/assets-test',owner},pool,undefined,undefined,async()=>({email:owner.email,subject:'synthetic'}));
 try{
  const filename=(await readdir('dist/dashboard/assets')).find(name=>/^index-.*\.js$/.test(name))!;
  const original=await readFile('dist/dashboard/assets/'+filename),headers={host:owner.hostname,'cf-access-jwt-assertion':'synthetic'};
  for(const [encoding,decode] of [['gzip',gunzipSync],['br',brotliDecompressSync]] as const){
   const result=await app.inject({url:'/assets/'+filename,headers:{...headers,'accept-encoding':encoding}});
   assert.equal(result.statusCode,200);assert.equal(result.headers['content-encoding'],encoding);assert.match(result.headers.vary!,/Accept-Encoding/i);
   assert.match(result.headers['cache-control']!,/^private,.*immutable/);assert.ok(result.rawPayload.length<original.length/2);assert.deepEqual(decode(result.rawPayload),original);
  }
  const plain=await app.inject({url:'/assets/'+filename,headers:{...headers,'accept-encoding':'identity'}});assert.deepEqual(plain.rawPayload,original);assert.equal(plain.headers['content-encoding'],undefined);
  assert.equal((await app.inject({url:'/assets/'+filename,headers:{host:owner.hostname,'accept-encoding':'br'}})).statusCode,403);
  const html=await app.inject({url:'/owner',headers});assert.match(html.headers['cache-control']!,/no-store/);
  const missing=await app.inject({url:'/assets/missing.js',headers});assert.equal(missing.statusCode,404);assert.match(missing.headers['cache-control']!,/no-store/);
 }finally{await app.close();}
});
