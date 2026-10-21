import {execFileSync} from 'node:child_process';
import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {GEMINI_MODEL_ID,UNDERSTANDING_VERSION,UNDERSTANDING_PROMPT_VERSION} from '../packages/contracts/model-policy.js';
import {releaseFiles,artifactHash,releaseManifestSchema} from '../apps/server/src/services/release-manifest.js';
const root=process.cwd();let repo=root;while(true){try{await access(resolve(repo,'.git'));break;}catch{const parent=dirname(repo);if(parent===repo)throw new Error('A Git checkout is required.');repo=parent;}}
const dotgit=resolve(repo,'.git');let gitDir=dotgit;try{const text=await readFile(dotgit,'utf8');const match=/^gitdir: (.+)\s*$/.exec(text);if(!match)throw new Error('Invalid worktree metadata.');gitDir=resolve(repo,match[1]);}catch(e){if(!(e&&typeof e==='object'&&'code' in e&&e.code==='EISDIR'))throw e;}
const git=(...args:string[])=>execFileSync('git',['--work-tree='+repo,'--git-dir='+gitDir,...args],{cwd:repo,encoding:'utf8'}).trim();
if(git('status','--porcelain'))throw new Error('Commit the reviewed source before creating a release manifest.');
const sourceCommit=git('rev-parse','HEAD');
// Rebuild from the checked clean source here: hashing an arbitrary old dist
// directory and attaching the current HEAD would not prove the source link.
execFileSync('npm',['run','build'],{cwd:root,stdio:'inherit'});
if(git('status','--porcelain')||git('rev-parse','HEAD')!==sourceCommit)throw new Error('Source changed during the release build.');
await access(resolve(root,'dist/apps/server/src/index.js'));
const files=await releaseFiles(root),manifest=releaseManifestSchema.parse({version:1,gitCommit:git('rev-parse','HEAD'),gitTree:git('rev-parse','HEAD^{tree}'),clean:true,createdAt:new Date().toISOString(),model:GEMINI_MODEL_ID,understandingVersion:UNDERSTANDING_VERSION,promptVersion:UNDERSTANDING_PROMPT_VERSION,artifactHash:artifactHash(files),files});
await writeFile(resolve(root,'dist/release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({gitCommit:manifest.gitCommit,artifactHash:manifest.artifactHash,files:files.length,manifest:resolve(root,'dist/release-manifest.json')}));
