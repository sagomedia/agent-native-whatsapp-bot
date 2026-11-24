import {readFile,readdir,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Pool} from 'pg';
import {GEMINI_MODEL_ID,GEMINI_TRANSCRIPTION_MODEL_ID,UNDERSTANDING_VERSION,UNDERSTANDING_PROMPT_VERSION} from '../../../../packages/contracts/model-policy.js';
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const releaseManifestSchema=z.object({version:z.literal(1),gitCommit:z.string().regex(/^[a-f0-9]{40}$/),gitTree:z.string().regex(/^[a-f0-9]{40}$/),clean:z.literal(true),createdAt:z.iso.datetime(),model:z.literal(GEMINI_MODEL_ID),transcriptionModel:z.literal(GEMINI_TRANSCRIPTION_MODEL_ID).optional(),understandingVersion:z.literal(UNDERSTANDING_VERSION),promptVersion:z.literal(UNDERSTANDING_PROMPT_VERSION),artifactHash:sha,files:z.array(z.object({path:z.string().regex(/^(?:dist\/(?!release-manifest\.json$)|resources\/|package(?:-lock)?\.json$)[A-Za-z0-9_.\/-]*$/).refine(s=>!s.split('/').includes('..')),sha256:sha}).strict()).min(1)}).strict();
export type ReleaseManifest=z.infer<typeof releaseManifestSchema>;
let processRelease:string|null=null;
let runtimeMetadata:Awaited<ReturnType<typeof verifyRelease>>={status:'unverified',model:GEMINI_MODEL_ID,promptVersion:UNDERSTANDING_PROMPT_VERSION,understandingVersion:UNDERSTANDING_VERSION};
export const currentReleaseFingerprint=()=>processRelease;
export const runtimeReleaseMetadata=()=>runtimeMetadata;
export async function bindRuntimeRelease(pool:Pool){
 if(!import.meta.url.endsWith('/dist/apps/server/src/services/release-manifest.js')){if(process.env.SHOPBOT_REQUIRE_VERIFIED_RELEASE==='true')throw new Error('Verified releases must execute their compiled entrypoint.');processRelease=null;return runtimeMetadata;}
 const release=await verifyRelease();runtimeMetadata=release;
 if(release.status==='content_verified'){await pool.query('INSERT INTO runtime_releases(artifact_hash,metadata) VALUES($1,$2) ON CONFLICT DO NOTHING',[release.artifactHash,JSON.stringify(release)]);processRelease=release.artifactHash;}else processRelease=null;return release;
}
export const artifactHash=(files:ReleaseManifest['files'])=>createHash('sha256').update(JSON.stringify(files)).digest('hex');
export async function releaseFiles(root:string){
 const files:ReleaseManifest['files']=[];
 async function visit(path:string){
  if(path.split('/').includes('owner-only'))return;
  const stat=await lstat(resolve(root,path));if(stat.isSymbolicLink())throw new Error('Release artifacts cannot contain symlinks.');
  // These source review files are deliberately absent from deployment. Hash
  // the runtime catalog/map/photos and fonts, not private onboarding evidence.
  const catalogSource=/^resources\/catalog\/ksmc-demo\/([^/]+)$/.exec(path);
  if(stat.isFile()&&catalogSource&&!['catalog.json','catalog-map.json'].includes(catalogSource[1]))return;
  if(stat.isDirectory()){for(const item of (await readdir(resolve(root,path))).sort())await visit(path+'/'+item);}else if(stat.isFile()&&path!=='dist/release-manifest.json')files.push({path,sha256:createHash('sha256').update(await readFile(resolve(root,path))).digest('hex')});
 }
 for(const p of ['dist','resources','package.json','package-lock.json'])await visit(p);
 return files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export async function verifyRelease(root=process.cwd(),required=process.env.SHOPBOT_REQUIRE_VERIFIED_RELEASE==='true'){
 try{
  const manifest=releaseManifestSchema.parse(JSON.parse(await readFile(resolve(root,'dist/release-manifest.json'),'utf8'))),files=await releaseFiles(root);
  if(new Set(manifest.files.map(f=>f.path)).size!==manifest.files.length||JSON.stringify(files)!==JSON.stringify(manifest.files)||artifactHash(files)!==manifest.artifactHash)throw new Error('Artifact content does not match its release manifest.');
  return {status:'content_verified' as const,gitCommit:manifest.gitCommit,gitTree:manifest.gitTree,artifactHash:manifest.artifactHash,model:manifest.model,transcriptionModel:manifest.transcriptionModel,promptVersion:manifest.promptVersion,understandingVersion:manifest.understandingVersion,createdAt:manifest.createdAt};
 }catch(error){if(required)throw new Error('A valid release manifest matching the installed artifacts is required before startup.');return {status:'unverified' as const,model:GEMINI_MODEL_ID,promptVersion:UNDERSTANDING_PROMPT_VERSION,understandingVersion:UNDERSTANDING_VERSION};}
}
