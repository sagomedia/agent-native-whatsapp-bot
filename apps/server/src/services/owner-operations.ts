import type {Pool,PoolClient} from 'pg';

type WorkAge={count:number;oldestAgeSeconds:number|null};
type DeliveryCounts={queued:number;sending:number;failed:number;unknown:number;blocked:number};
type InferenceCounts={attempts:number;failed:number;unknown:number;unknownChargeAttempts:number;heldChargeAttempts:number;estimatedMicrousd:string};
export type OperationsIssue={kind:'pending'|'processing'|'failed_media'|'failed_delivery'|'unknown_delivery'|'blocked_delivery';messageId:string;conversationId:string;createdAt:string;ageSeconds:number|null;ageBasis:'message_created_at'|'outbox_created_at'};
export type OwnerOperationsSummary={
 schemaVersion:1;generatedAt:string;recentSince:string;recentHours:24;
 store:{id:string;operatorPaused:boolean;catalogRevision:number};
 current:{pending:WorkAge;processing:WorkAge;failedMedia:number;delivery:DeliveryCounts;budgetBlocked:boolean|null;sendBlockedChannels:number};
 catalog:{scope:'active_products';active:number;pendingActualPrice:number;indicativePrice:number;missingPhoto:number;unknownStock:number};
 recent:{inbound:number;outbound:number;submittedRequests:number;collectedRequests:number;failedMedia:number;delivery:DeliveryCounts;inference:InferenceCounts};
 history:{failedMedia:number;delivery:DeliveryCounts;inference:InferenceCounts};
 issues:OperationsIssue[];issueLimit:25;
 timing:{serverReceiptToUsefulReply:null;reason:string};
 messagingCosts:{currency:string|null;delivered:number;unknown:number;estimatedMicrounits:string|null}[];
 releases:{fingerprint:string;messages:number;recorded:boolean}[];
 notes:string[];
};

// No joins to message parts: each attempt and delivery-cost ledger row is counted once.
async function inferenceCounts(c:PoolClient,storeId:string,since:string|null):Promise<InferenceCounts>{
 return (await c.query(`SELECT count(*)::int AS attempts,count(*) FILTER(WHERE state='failed')::int AS failed,
 count(*) FILTER(WHERE state IN ('started','unknown'))::int AS unknown,
 count(*) FILTER(WHERE billing_state='unknown')::int AS "unknownChargeAttempts",
 count(*) FILTER(WHERE billing_state='held')::int AS "heldChargeAttempts",
 coalesce(sum(estimated_cost_microusd),0)::text AS "estimatedMicrousd"
 FROM (SELECT state,billing_state,estimated_cost_microusd,created_at FROM provider_attempts WHERE store_id=$1
 UNION ALL SELECT state,billing_state,estimated_cost_microusd,created_at FROM catalog_suggestions WHERE store_id=$1) a
 WHERE ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)`,[storeId,since])).rows[0];
}
async function deliveries(c:PoolClient,storeId:string,since:string|null,current=false):Promise<DeliveryCounts>{
 return (await c.query(`SELECT count(*) FILTER(WHERE o.state='queued')::int AS queued,count(*) FILTER(WHERE o.state='sending')::int AS sending,
 count(*) FILTER(WHERE o.state='failed')::int AS failed,count(*) FILTER(WHERE o.state='unknown')::int AS unknown,
 count(*) FILTER(WHERE o.state='blocked')::int AS blocked
 FROM whatsapp_outbox o JOIN conversations c ON c.id=o.conversation_id WHERE c.store_id=$1 AND ($2::timestamptz IS NULL OR o.created_at >= $2::timestamptz)
 AND (NOT $3::boolean OR o.operator_revision=c.operator_revision AND (o.state IN ('queued','sending','unknown','blocked') OR o.state='failed' AND o.created_at>=now()-interval '24 hours'))`,[storeId,since,current])).rows[0];
}

/** One private, store-scoped snapshot. Reading never claims work or retries a send. */
export async function ownerOperationsSummary(pool:Pool,storeId:string):Promise<OwnerOperationsSummary>{
 const c=await pool.connect();
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await c.query("SET LOCAL statement_timeout='10s'");
  const times=(await c.query("SELECT now() AS generated,now()-interval '24 hours' AS since")).rows[0];
  const generatedAt=new Date(times.generated).toISOString(),recentSince=new Date(times.since).toISOString();
  const store=(await c.query('SELECT id,operator_paused AS "operatorPaused",catalog_revision AS "catalogRevision" FROM stores WHERE id=$1',[storeId])).rows[0];
  if(!store)throw Object.assign(new Error('Shop not found'),{statusCode:404});
  const work=(await c.query(`SELECT m.status,count(*)::int AS count,
   greatest(0,extract(epoch FROM now()-min(m.created_at)))::double precision AS "oldestAgeSeconds"
   FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.store_id=$1 AND m.direction='inbound' AND m.status IN ('pending','processing') GROUP BY m.status`,[storeId])).rows;
  const age=(state:string):WorkAge=>{const row=work.find(r=>r.status===state);return row?{count:row.count,oldestAgeSeconds:Number.isFinite(row.oldestAgeSeconds)?row.oldestAgeSeconds:null}:{count:0,oldestAgeSeconds:null};};
  const media=(await c.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE m.created_at >= $2)::int AS recent
   FROM whatsapp_media w JOIN messages m ON m.id=w.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.store_id=$1 AND w.state='failed'`,[storeId,recentSince])).rows[0];
 const delivery=await deliveries(c,storeId,null,true),historicalDelivery=await deliveries(c,storeId,null),recentDelivery=await deliveries(c,storeId,recentSince);
  const budget=(await c.query('SELECT blocked FROM inference_budgets WHERE store_id=$1',[storeId])).rows[0];
  const channels=(await c.query('SELECT count(*)::int AS blocked FROM whatsapp_channels WHERE store_id=$1 AND send_blocked',[storeId])).rows[0];
  const catalog=(await c.query(`SELECT count(*)::int AS active,count(*) FILTER(WHERE price_status='confirm')::int AS "pendingActualPrice",
   count(*) FILTER(WHERE indicative_price IS NOT NULL)::int AS "indicativePrice",count(*) FILTER(WHERE image_path IS NULL OR image_path='')::int AS "missingPhoto",
   count(*) FILTER(WHERE stock IS NULL)::int AS "unknownStock" FROM products WHERE store_id=$1 AND active`,[storeId])).rows[0];
  const messages=(await c.query(`SELECT count(*) FILTER(WHERE m.direction='inbound')::int AS inbound,count(*) FILTER(WHERE m.direction='outbound')::int AS outbound
   FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.store_id=$1 AND m.created_at >= $2`,[storeId,recentSince])).rows[0];
  const requests=(await c.query(`SELECT count(*)::int AS "submittedRequests",count(*) FILTER(WHERE fulfillment='collected')::int AS "collectedRequests" FROM order_requests WHERE store_id=$1 AND created_at >= $2`,[storeId,recentSince])).rows[0];
  const issues=(await c.query(`SELECT kind,"messageId","conversationId","createdAt",greatest(0,extract(epoch FROM now()-"createdAt"))::double precision AS "ageSeconds","ageBasis" FROM (
   SELECT m.status AS kind,m.id AS "messageId",m.conversation_id AS "conversationId",m.created_at AS "createdAt",'message_created_at' AS "ageBasis"
   FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.store_id=$1 AND m.direction='inbound' AND m.status IN ('pending','processing')
   UNION ALL SELECT 'failed_media',m.id,m.conversation_id,m.created_at,'message_created_at'
   FROM whatsapp_media w JOIN messages m ON m.id=w.message_id JOIN conversations c ON c.id=m.conversation_id WHERE c.store_id=$1 AND w.state='failed' AND m.created_at >= $2
   UNION ALL SELECT o.state||'_delivery',o.message_id,o.conversation_id,o.created_at,'outbox_created_at'
   FROM whatsapp_outbox o JOIN conversations c ON c.id=o.conversation_id WHERE c.store_id=$1 AND o.operator_revision=c.operator_revision AND (o.state IN ('unknown','blocked') OR o.state='failed' AND o.created_at >= $2)
   ) issues ORDER BY "createdAt","messageId",kind LIMIT 25`,[storeId,recentSince])).rows.map(r=>({...r,createdAt:new Date(r.createdAt).toISOString(),ageSeconds:Number.isFinite(r.ageSeconds)?r.ageSeconds:null})) as OperationsIssue[];
  const messagingCosts=(await c.query(`SELECT currency,count(*)::int AS delivered,count(*) FILTER(WHERE state IN ('unknown','conflicting'))::int AS unknown,
   sum(estimated_microunits)::text AS "estimatedMicrounits" FROM whatsapp_delivery_costs WHERE store_id=$1 GROUP BY currency ORDER BY currency`,[storeId])).rows;
  const releases=(await c.query(`SELECT m.release_fingerprint AS fingerprint,count(*)::int AS messages,bool_or(r.artifact_hash IS NOT NULL) AS recorded FROM messages m
   JOIN conversations c ON c.id=m.conversation_id LEFT JOIN runtime_releases r ON r.artifact_hash=m.release_fingerprint
   WHERE c.store_id=$1 AND m.release_fingerprint IS NOT NULL AND m.created_at >= $2 GROUP BY m.release_fingerprint ORDER BY max(m.sequence) DESC LIMIT 5`,[storeId,recentSince])).rows;
  const recentInference=await inferenceCounts(c,storeId,recentSince),historicalInference=await inferenceCounts(c,storeId,null);
  await c.query('COMMIT');
  return {schemaVersion:1,generatedAt,recentSince,recentHours:24,store,
   current:{pending:age('pending'),processing:age('processing'),failedMedia:media.recent,delivery,budgetBlocked:budget?.blocked??null,sendBlockedChannels:channels.blocked},
   catalog:{scope:'active_products',...catalog},recent:{...messages,...requests,failedMedia:media.recent,delivery:recentDelivery,inference:recentInference},
   history:{failedMedia:media.total,delivery:historicalDelivery,inference:historicalInference},issues,issueLimit:25,messagingCosts,releases,
   timing:{serverReceiptToUsefulReply:null,reason:'Inbound created_at can be a WhatsApp timestamp. Server receipt and useful-reply stage times are not recorded reliably; latency is unknown.'},
   notes:['Current pending work is unfinished. Current send issues match the conversation operator revision: queued/sending/unknown/blocked are retained; terminal failed sends and media failures appear here only for messages created in the last 24 hours. Recorded failures are not proof that the customer remains stuck. History covers all stored rows; recent covers rows created in the last 24 hours.',
    'Work ages use message creation time, which may originate on WhatsApp; they are not server queue latency. Media failure time is not recorded.',
    'Outbound counts include queued message parts, not confirmed phone deliveries. Collected requests are requests created in the window that are now collected.',
    'Inference includes conversation and catalog attempts, failed attempts and retries. Estimated amounts are partial when charges are held or unknown; no per-order attribution is inferred.',
    'Messaging costs are all-history ledger estimates grouped by currency, not invoices. Release fingerprints describe recent messages, not proof of the currently running artifact.']};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
