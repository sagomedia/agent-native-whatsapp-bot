import {z} from 'zod';
import type {PoolClient} from 'pg';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const line=z.object({sku:z.string().min(1).max(100),unit:z.string().min(1).max(80),quantity:z.string().regex(/^\d+(?:\.\d{1,3})?$/)}).strict();
const caseSchema=z.object({
 caseId:z.string().regex(/^T(?:0[1-9]|10)$/),sessionId:z.string().min(1).max(100),
 source:z.enum(['fixture','demo_customer']),outcome:z.enum(['pass','fail','blocked_by_merchant_fact','abandoned','not_executed']),
 conversationId:z.uuid().optional(),requestIds:z.array(z.uuid()).max(20).default([]),
 startedAt:z.iso.datetime({offset:true}).optional(),endedAt:z.iso.datetime({offset:true}).optional(),
 inputTypes:z.array(z.enum(['voice','text','photo','buttons'])).max(4).default([]),
 intendedMeaning:z.string().max(2000).default(''),expectedLines:z.array(line).max(100).default([]),observedLines:z.array(line).max(100).default([]),
 priceStatus:z.enum(['shop_value','indicative','unknown','mixed']).default('unknown'),
 extraClarificationTurns:z.number().int().nonnegative().nullable().default(null),humanInterventions:z.number().int().nonnegative().nullable().default(null),
 correctionSuccessful:z.boolean().nullable().default(null),requestVisible:z.boolean().nullable().default(null),ownerNextActionClear:z.boolean().nullable().default(null),
 phoneLayoutReviewed:z.boolean().default(false),tamilReviewed:z.boolean().default(false),
 screenshots:z.array(z.string().min(1).max(1000)).max(20).default([]),recordings:z.array(z.string().min(1).max(1000)).max(20).default([]),
 failureCategories:z.array(z.enum(['speech','retrieval','selection_or_correction','merchant_facts','presentation','transaction_or_delivery'])).max(6).default([]),
 releaseBlockingFailure:z.boolean().default(false),notes:z.string().max(4000).default(''),
}).strict().superRefine((c,ctx)=>{
 if(new Set(c.requestIds).size!==c.requestIds.length)ctx.addIssue({code:'custom',message:'Duplicate request IDs.'});
 if(c.outcome!=='not_executed'&&(!c.startedAt||!c.endedAt))ctx.addIssue({code:'custom',message:'Executed sessions require start and end times.'});
 if(c.startedAt&&c.endedAt&&Date.parse(c.endedAt)<=Date.parse(c.startedAt))ctx.addIssue({code:'custom',message:'End must follow start.'});
 if(c.startedAt&&c.endedAt&&Date.parse(c.endedAt)-Date.parse(c.startedAt)>24*3600000)ctx.addIssue({code:'custom',message:'Keep a session within 24 hours.'});
 if(c.outcome==='not_executed'&&(c.requestIds.length||c.phoneLayoutReviewed||c.tamilReviewed||c.releaseBlockingFailure))ctx.addIssue({code:'custom',message:'An unexecuted case cannot claim completed reviews or requests.'});
 if(c.releaseBlockingFailure&&c.outcome==='pass')ctx.addIssue({code:'custom',message:'A release-blocking failure cannot pass.'});
});
export const demoReviewSchema=z.object({
 schemaVersion:z.literal(1),kind:z.literal('demo_usability_review'),reviewer:z.string().min(1).max(100),
 manifest:z.object({releaseFingerprint:hash,catalogRevision:z.number().int().positive(),demoOptions:z.record(z.string().max(80),z.union([z.string().max(200),z.boolean(),z.number().finite(),z.null()])),sourceCommit:z.string().regex(/^[a-f0-9]{40}$/).optional()}).strict(),
 cases:z.array(caseSchema).max(100),
}).strict().superRefine((r,ctx)=>{
 if(new Set(r.cases.map(c=>c.sessionId)).size!==r.cases.length)ctx.addIssue({code:'custom',message:'Each session ID must be unique; keep retries as separate sessions.'});
 const requestIds=r.cases.flatMap(c=>c.requestIds);
 if(new Set(requestIds).size!==requestIds.length)ctx.addIssue({code:'custom',message:'A request cannot be counted in multiple sessions.'});
 const windows=r.cases.filter(c=>c.conversationId&&c.startedAt&&c.endedAt);
 for(let i=0;i<windows.length;i++)for(let j=i+1;j<windows.length;j++){
  const a=windows[i],b=windows[j];
  if(a.conversationId===b.conversationId&&Date.parse(a.startedAt!)<Date.parse(b.endedAt!)&&Date.parse(b.startedAt!)<Date.parse(a.endedAt!))ctx.addIssue({code:'custom',message:'Sessions in one conversation cannot overlap; message attribution would be ambiguous.'});
 }
});
export type DemoReview=z.infer<typeof demoReviewSchema>;
export type DemoCase=DemoReview['cases'][number];

/** Caller supplies a read-only transaction. Absence of an order is a valid case. */
export async function collectDemoCase(c:PoolClient,storeId:string,item:DemoCase,releaseFingerprint:string){
 if(item.outcome==='not_executed'||!item.conversationId||!item.startedAt||!item.endedAt)return null;
 const scoped=(await c.query('SELECT 1 FROM conversations WHERE id=$1 AND store_id=$2',[item.conversationId,storeId])).rowCount;
 if(!scoped)return {problems:['conversation_not_in_shop']};
 const values=[storeId,item.conversationId,item.startedAt,item.endedAt];
 const turns=(await c.query(`SELECT count(*) FILTER(WHERE direction='inbound')::int AS "customerTurns",
 count(*) FILTER(WHERE direction='outbound')::int AS "outboundPartsCreated",
 count(*) FILTER(WHERE direction='outbound' AND clarification_reason IS NOT NULL)::int AS "clarificationParts",
 count(*) FILTER(WHERE release_fingerprint IS DISTINCT FROM $5)::int AS "unmatchedReleaseMessages"
 FROM messages WHERE conversation_id=$2 AND created_at >= $3 AND created_at < $4 AND EXISTS(SELECT 1 FROM conversations WHERE id=$2 AND store_id=$1)`,[...values,releaseFingerprint])).rows[0];
 const delivery=(await c.query(`SELECT o.state,count(*)::int AS count FROM whatsapp_outbox o JOIN messages m ON m.id=o.message_id
 JOIN conversations c ON c.id=m.conversation_id WHERE c.store_id=$1 AND c.id=$2 AND m.created_at >= $3 AND m.created_at < $4 GROUP BY o.state ORDER BY o.state`,values)).rows;
 const media=(await c.query(`SELECT w.state,count(*)::int AS count FROM whatsapp_media w JOIN messages m ON m.id=w.message_id JOIN conversations c ON c.id=m.conversation_id
 WHERE c.store_id=$1 AND c.id=$2 AND m.created_at >= $3 AND m.created_at < $4 GROUP BY w.state ORDER BY w.state`,values)).rows;
 const inference=(await c.query(`SELECT count(*)::int AS attempts,count(*) FILTER(WHERE state='failed')::int AS failed,
 count(*) FILTER(WHERE state IN ('started','unknown'))::int AS "unknownOutcomes",count(*) FILTER(WHERE attempt>1)::int AS retries,
 count(*) FILTER(WHERE billing_state='unknown')::int AS "unknownCharges",count(*) FILTER(WHERE billing_state='held')::int AS "heldCharges",
 coalesce(sum(estimated_cost_microusd),0)::text AS "estimatedMicrousd" FROM provider_attempts a
 WHERE a.store_id=$1 AND a.conversation_id=$2 AND EXISTS(SELECT 1 FROM messages m WHERE m.id=a.message_id AND m.created_at >= $3 AND m.created_at < $4)`,values)).rows[0];
 const requests=(await c.query(`SELECT id,acceptance,fulfillment,payment FROM order_requests WHERE store_id=$1 AND conversation_id=$2 AND id=ANY($3::uuid[]) ORDER BY id`,[storeId,item.conversationId,item.requestIds])).rows;
 const problems:string[]=[];
 if(requests.length!==item.requestIds.length)problems.push('request_missing_or_outside_shop_or_conversation');
 if(turns.unmatchedReleaseMessages)problems.push('mixed_or_unrecorded_message_release');
 return {problems,...turns,delivery,media,inference,requests,
  firstUsefulReplyTiming:null,timingReason:'No reliable persisted server receipt / useful-reply stage timing; created_at can be a WhatsApp timestamp.',
  costAttribution:'Conversation-window attempts only, not per-order cost. Estimates can be partial; held/unknown charges remain unknown.'};
}

export function demoReviewSummary(review:DemoReview){
 const outcomes=Object.fromEntries(['pass','fail','blocked_by_merchant_fact','abandoned','not_executed'].map(o=>[o,review.cases.filter(c=>c.outcome===o).length]));
 return {totalSessions:review.cases.length,executedSessions:review.cases.filter(c=>c.outcome!=='not_executed').length,
  customerSessions:review.cases.filter(c=>c.source==='demo_customer'&&c.outcome!=='not_executed').length,
  fixtureSessions:review.cases.filter(c=>c.source==='fixture'&&c.outcome!=='not_executed').length,
  outcomes,releaseBlockingFailures:review.cases.filter(c=>c.releaseBlockingFailure).length,
  missingScenarioIds:Array.from({length:10},(_,i)=>'T'+String(i+1).padStart(2,'0')).filter(id=>!review.cases.some(c=>c.caseId===id&&c.outcome!=='not_executed'))};
}
