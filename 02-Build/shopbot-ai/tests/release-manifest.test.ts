import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyRelease,releaseFiles,artifactHash} from '../apps/server/src/services/release-manifest.js';
import {GEMINI_MODEL_ID,UNDERSTANDING_VERSION,UNDERSTANDING_PROMPT_VERSION} from '../packages/contracts/model-policy.js';
test('release proof checks installed bytes, unexpected files, missing assets and model versions; required mode fails before startup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shopbot-release-'));try{await mkdir(join(root,'dist'));await mkdir(join(root,'resources'));await writeFile(join(root,'dist/server.js'),'verified fixture');await writeFile(join(root,'resources/photo.jpg'),'fixture image');await writeFile(join(root,'package.json'),'{}');await writeFile(join(root,'package-lock.json'),'{}');
 assert.equal((await verifyRelease(root,false)).status,'unverified');await assert.rejects(verifyRelease(root,true));
 const files=await releaseFiles(root),manifest={version:1,gitCommit:'a'.repeat(40),gitTree:'b'.repeat(40),clean:true,createdAt:new Date().toISOString(),model:GEMINI_MODEL_ID,understandingVersion:UNDERSTANDING_VERSION,promptVersion:UNDERSTANDING_PROMPT_VERSION,files,artifactHash:artifactHash(files)};
 const save=async(m:unknown=manifest)=>writeFile(join(root,'dist/release-manifest.json'),JSON.stringify(m));await save();assert.equal((await verifyRelease(root,true)).status,'content_verified');
 await writeFile(join(root,'dist/server.js'),'tampered');await assert.rejects(verifyRelease(root,true));await writeFile(join(root,'dist/server.js'),'verified fixture');await writeFile(join(root,'dist/unexpected.js'),'extra');await assert.rejects(verifyRelease(root,true));await rm(join(root,'dist/unexpected.js'));await save({...manifest,model:'unreviewed-model'});await assert.rejects(verifyRelease(root,true));await save();await rm(join(root,'resources/photo.jpg'));await assert.rejects(verifyRelease(root,true));
 }finally{await rm(root,{recursive:true,force:true});}
});
