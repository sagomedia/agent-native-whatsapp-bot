import pg from 'pg';
import {z} from 'zod';
import {readFile,writeFile,mkdir,rm,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {demoReviewSchema,demoReviewSummary,collectDemoCase} from '../apps/server/src/services/demo-evidence.js';

const args=process.argv.slice(2),withDatabase=args.includes('--database'),paths=args.filter(a=>a!=='--database');
if(paths.length!==2||paths.some(p=>p.startsWith('--')))throw new Error('Usage: npm run demo:evidence -- /private/reviews.json /private/report.json [--database]');
const [reviewFile,output]=paths.map(p=>resolve(p));
if(!output.endsWith('.json'))throw new Error('Output must end with .json (a companion .md is also created).');
if((await stat(reviewFile)).size>2*1024*1024)throw new Error('Keep reviews below 2 MiB.');
const bytes=await readFile(reviewFile),review=demoReviewSchema.parse(JSON.parse(bytes.toString('utf8')));
const pool=withDatabase?new pg.Pool({connectionString:z.url().parse(process.env.DATABASE_URL),max:1,statement_timeout:15000}):null;
const storeId=withDatabase?z.uuid().parse(process.env.SHOPBOT_DEMO_STORE_ID):null;
const c=pool?await pool.connect():null;
try{
 if(c)await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 if(c&&!(await c.query('SELECT 1 FROM stores WHERE id=$1',[storeId])).rowCount)throw new Error('Demo store not found.');
 const databaseBaseline=c?{storeId,catalogRevision:(await c.query('SELECT catalog_revision FROM stores WHERE id=$1',[storeId])).rows[0].catalog_revision,
  releaseRecorded:!!(await c.query('SELECT 1 FROM runtime_releases WHERE artifact_hash=$1',[review.manifest.releaseFingerprint])).rowCount}:null;
 const cases=[];
 for(const item of review.cases){
  const evidence=[];
  for(const [kind,refs] of [['screenshot',item.screenshots],['recording',item.recordings]] as const){
   for(const ref of refs){
    const path=resolve(dirname(reviewFile),ref);
    if((await stat(path)).size>50*1024*1024)throw new Error('Keep each private evidence file below 50 MiB.');
    const data=await readFile(path);evidence.push({kind,reference:ref,sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length});
   }
  }
  const observed=c?await collectDemoCase(c,storeId!,item,review.manifest.releaseFingerprint):null;
  cases.push({...item,evidence,databaseObservation:observed,evidenceProblems:item.outcome==='not_executed'?[]:[
   ...(!item.screenshots.length?['phone_screenshot_missing']:[]),...(!item.phoneLayoutReviewed?['phone_layout_not_reviewed']:[]),...(!item.tamilReviewed?['tamil_not_reviewed']:[]),
  ]});
 }
 if(c)await c.query('COMMIT');
 const summary=demoReviewSummary(review),report={schemaVersion:1,kind:'demo_usability_review',generatedAt:new Date().toISOString(),
  status:summary.executedSessions?'review_recorded':'prepared',productionPilotGate:'not_evaluated',
  notice:'Human demo reviews, including fixtures, failures and no-order sessions. This report does not establish real-merchant readiness or satisfy the separate 20-completed-request pilot gate.',
  reviewer:review.reviewer,manifest:review.manifest,reviewSha256:createHash('sha256').update(bytes).digest('hex'),
  basis:c?'human_review_with_database':'human_review_only',databaseBaseline,summary,cases};
 const md=['# Demo usability review','',report.notice,'',`Status: ${report.status}. Executed sessions: ${summary.executedSessions} / ${summary.totalSessions}; customer: ${summary.customerSessions}; fixtures: ${summary.fixtureSessions}.`,
  `Human outcomes: ${Object.entries(summary.outcomes).map(([k,v])=>`${k}: ${v}`).join('; ')}.`,`Release-blocking failures: ${summary.releaseBlockingFailures}.`,
  `Release: ${review.manifest.releaseFingerprint}; catalog revision: ${review.manifest.catalogRevision}.`,'',
  'Private JSON contains session evidence and local references. Keep both reports private. Outcomes are human labels; database observations and evidence gaps remain separate. No broad accuracy percentage is inferred.','',
  ...cases.map(item=>`- ${item.caseId} / ${item.source} / ${item.outcome}${item.releaseBlockingFailure?' — RELEASE BLOCKER':''}; private session details in JSON.`),''].join('\n');
 await mkdir(dirname(output),{recursive:true,mode:0o700});
 // Exclusive creates protect previous sessions; remove only our first new file if the second already exists.
 await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 try{await writeFile(output.slice(0,-5)+'.md',md,{mode:0o600,flag:'wx'});}catch(error){await rm(output);throw error;}
 console.log(JSON.stringify({output,status:report.status,summary,productionPilotGate:'not_evaluated'}));
}catch(error){if(c)await c.query('ROLLBACK');throw error;}finally{c?.release();await pool?.end();}
