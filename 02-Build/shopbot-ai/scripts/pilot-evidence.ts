import pg from 'pg';
import {z} from 'zod';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyRelease} from '../apps/server/src/services/release-manifest.js';
const scenarios=['five_item','pump_and_cutter','paint_missing_count','price_interrupt','keep_and_clear','owner_pickup','voice_noise','handwritten_list','printed_list','correction_recovery'] as const;
const config=z.object({DATABASE_URL:z.string().url(),SHOPBOT_PILOT_STORE_ID:z.uuid()}).parse(process.env);
const reviewFile=process.argv[2],output=process.argv[3];if(!reviewFile||!output)throw new Error('Usage: npm run pilot:evidence -- /private/reviews.json /private/evidence.json');
const review=z.object({releaseFingerprint:z.string().regex(/^[a-f0-9]{64}$/),reviewer:z.string().min(3).max(100),cases:z.array(z.object({conversationId:z.uuid(),requestId:z.uuid(),scenario:z.enum(scenarios),outcome:z.enum(['pass','fail']),merchantVerified:z.boolean(),tamilReviewed:z.boolean(),expectedLinesHash:z.string().regex(/^[a-f0-9]{64}$/),phoneScreenshot:z.string().min(1),realSourceMediaHashes:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(10),notes:z.string().max(1000)}).strict()).max(100)}).strict().parse(JSON.parse(await readFile(reviewFile,'utf8')));
const pool=new pg.Pool({connectionString:config.DATABASE_URL,max:1,statement_timeout:15000});
try{
 const release=await verifyRelease(process.cwd(),true);if(release.status!=='content_verified'||release.artifactHash!==review.releaseFingerprint)throw new Error('Run against the exact verified deployed artifact being reviewed.');
 const c=await pool.connect();const cases=[];
 try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  if(!(await c.query('SELECT 1 FROM runtime_releases WHERE artifact_hash=$1',[review.releaseFingerprint])).rowCount)throw new Error('This database has no record of that running artifact.');
  const store=(await c.query('SELECT synthetic,inventory_policy FROM stores WHERE id=$1',[config.SHOPBOT_PILOT_STORE_ID])).rows[0];
  const globalProblems:string[]=[];if(!store||store.synthetic!=='false')globalProblems.push('store_is_not_a_verified_real_merchant');
  for(const item of review.cases){
   const problems:string[]=[];
   const request=(await c.query('SELECT lines,acceptance,fulfillment FROM order_requests WHERE store_id=$1 AND conversation_id=$2 AND id=$3',[config.SHOPBOT_PILOT_STORE_ID,item.conversationId,item.requestId])).rows[0];
   if(!request)problems.push('request_missing');
   const lineHash=request?createHash('sha256').update(JSON.stringify(request.lines)).digest('hex'):null;
   if(lineHash!==item.expectedLinesHash)problems.push('requested_lines_differ_from_human_expectation');
   if(request&&(request.acceptance!=='accepted'||request.fulfillment!=='collected'))problems.push('pickup_not_completed');
   for(const line of request?.lines??[]){const product=(await c.query('SELECT version,catalog_origin,merchant_verification FROM products WHERE store_id=$1 AND sku=$2',[config.SHOPBOT_PILOT_STORE_ID,line.sku??''])).rows[0];if(!product||product.catalog_origin!=='owner'||product.version!==line.productVersion||!Object.values(product.merchant_verification).every(Boolean))problems.push('merchant_product_facts_not_verified:'+line.id);}
   const messages=(await c.query(`SELECT m.id,m.direction,m.payload->>'type' AS input_type,m.release_fingerprint,m.created_at,m.reply_group_id,m.part_count,o.state,o.provider_id,
     (SELECT min(to_timestamp(s.provider_timestamp)) FROM whatsapp_statuses s JOIN whatsapp_conversations w ON w.conversation_id=m.conversation_id WHERE s.phone_id=w.phone_id AND s.provider_id=o.provider_id AND s.recipient=w.recipient AND s.state IN ('delivered','read')) AS delivery_at
     FROM messages m JOIN conversations c ON c.id=m.conversation_id LEFT JOIN whatsapp_outbox o ON o.message_id=m.id WHERE c.store_id=$1 AND m.conversation_id=$2 ORDER BY m.sequence`,[config.SHOPBOT_PILOT_STORE_ID,item.conversationId])).rows;
   const outbound=messages.filter(m=>m.direction==='outbound');if(!outbound.length||outbound.some(m=>!m.provider_id||!m.delivery_at||!['delivered','read'].includes(m.state)))problems.push('phone_delivery_incomplete');
   if(outbound.some(m=>m.release_fingerprint!==review.releaseFingerprint))problems.push('mixed_or_unverified_release');
   const media=(await c.query('SELECT source_hash FROM voice_media WHERE store_id=$1 AND conversation_id=$2 UNION ALL SELECT source_hash FROM image_media WHERE store_id=$1 AND conversation_id=$2',[config.SHOPBOT_PILOT_STORE_ID,item.conversationId])).rows.map(r=>r.source_hash);
   if(item.realSourceMediaHashes.some(h=>!media.includes(h)))problems.push('source_media_not_in_conversation');
   if(['voice_noise','handwritten_list','printed_list'].includes(item.scenario)&&!item.realSourceMediaHashes.length)problems.push('real_media_review_missing');
   if(!item.merchantVerified||!item.tamilReviewed||item.outcome!=='pass')problems.push('human_review_not_passed');
   const bytes=await readFile(resolve(dirname(reviewFile),item.phoneScreenshot));if(bytes.length>10000000)throw new Error('Keep pilot screenshots below 10 MB.');
   const attempts=(await c.query('SELECT state,billing_state,estimated_cost_microusd,created_at,settled_at FROM provider_attempts WHERE store_id=$1 AND conversation_id=$2',[config.SHOPBOT_PILOT_STORE_ID,item.conversationId])).rows;
   if(attempts.some(a=>['started','unknown'].includes(a.state)||['held','unknown'].includes(a.billing_state)))problems.push('inference_cost_or_outcome_unknown');
   cases.push({conversationId:item.conversationId,requestId:item.requestId,scenario:item.scenario,lineHash,screenshotHash:createHash('sha256').update(bytes).digest('hex'),sourceMediaHashes:item.realSourceMediaHashes,passed:problems.length===0,problems,outboundParts:outbound.length,providerAttempts:attempts.length,estimatedMicrousd:attempts.reduce((n,a)=>n+BigInt(a.estimated_cost_microusd??0),0n).toString(),notes:item.notes});
  }
  const duplicateRequests=new Set(cases.map(c=>c.requestId)).size!==cases.length,covered=new Set(cases.filter(c=>c.passed).map(c=>c.scenario)),passed=globalProblems.length===0&&cases.length>=20&&cases.every(c=>c.passed)&&!duplicateRequests&&scenarios.every(s=>covered.has(s));
  await c.query('COMMIT');await mkdir(dirname(resolve(output)),{recursive:true,mode:0o700});await writeFile(output,JSON.stringify({generatedAt:new Date().toISOString(),release,reviewer:review.reviewer,status:passed?'pilot_gate_passed':'pilot_gate_incomplete',minimumCompletedRequests:20,globalProblems,duplicateRequests,missingScenarios:scenarios.filter(s=>!covered.has(s)),cases},null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({output:resolve(output),status:passed?'pilot_gate_passed':'pilot_gate_incomplete',cases:cases.length,passed:cases.filter(c=>c.passed).length}));if(!passed)process.exitCode=1;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}finally{await pool.end();}
