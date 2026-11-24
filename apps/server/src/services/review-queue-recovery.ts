import type {PoolClient} from 'pg';

// A historical system notice has no response_to, so it cannot use the sender's
// obsolete-review exception. Quarantine its unsent backlog when a newer customer
// turn already has a reply. Retain the notice for owner review, never replay an
// old invoice/payment notice or guess whether an uncertain send was delivered.
export async function recoverReviewQueue(client:PoolClient,storeId:string,phoneId:string){
 const candidate=(await client.query(`SELECT c.id,latest.id AS reply_id,turn.sequence AS turn_sequence
  FROM conversations c JOIN stores s ON s.id=c.store_id JOIN whatsapp_conversations w ON w.conversation_id=c.id
  JOIN messages turn ON turn.conversation_id=c.id AND turn.direction='inbound'
  JOIN messages latest ON latest.response_to=turn.id AND latest.conversation_id=c.id
  JOIN whatsapp_outbox current ON current.message_id=latest.id
  WHERE c.store_id=$1 AND w.phone_id=$2 AND NOT s.operator_paused AND c.operator_mode='assistant'
   AND current.state='queued' AND current.attempts=0 AND current.sender_kind='assistant' AND current.operator_revision=c.operator_revision
   AND NOT EXISTS(SELECT 1 FROM messages newer WHERE newer.conversation_id=c.id AND newer.direction='inbound' AND newer.sequence>turn.sequence)
   AND EXISTS(SELECT 1 FROM messages old JOIN whatsapp_outbox uncertain ON uncertain.message_id=old.id
    JOIN messages old_turn ON old_turn.id=old.response_to AND old_turn.conversation_id=c.id AND old_turn.direction='inbound'
    WHERE old.conversation_id=c.id AND old.sequence<turn.sequence AND old_turn.sequence<turn.sequence
     AND uncertain.operator_revision=c.operator_revision AND uncertain.sender_kind='assistant' AND uncertain.state='unknown'
     AND old.reply_group_id IS NOT NULL AND latest.reply_group_id IS DISTINCT FROM old.reply_group_id
     AND EXISTS(SELECT 1 FROM messages page JOIN whatsapp_outbox cancelled ON cancelled.message_id=page.id
      WHERE page.conversation_id=c.id AND page.reply_group_id=old.reply_group_id AND cancelled.state='cancelled' AND cancelled.last_error='review_superseded')
     AND EXISTS(SELECT 1 FROM messages notice JOIN whatsapp_outbox queued ON queued.message_id=notice.id
      WHERE notice.conversation_id=c.id AND notice.sequence>old.sequence AND notice.sequence<turn.sequence
       AND queued.operator_revision=c.operator_revision AND queued.sender_kind='system' AND queued.state='queued' AND queued.attempts=0))
  ORDER BY turn.sequence,latest.sequence LIMIT 1 FOR UPDATE OF c SKIP LOCKED`,[storeId,phoneId])).rows[0];
 if(!candidate)return;
 const moved=await client.query(`UPDATE whatsapp_outbox o SET
   state=CASE WHEN o.sender_kind='system' THEN 'blocked' ELSE 'cancelled' END,
   last_error=CASE WHEN o.sender_kind='system' THEN 'delivery_recovery_review_required' ELSE 'reply_superseded_recovery' END
  FROM messages m WHERE m.id=o.message_id AND o.conversation_id=$1 AND o.state='queued' AND o.attempts=0
   AND o.operator_revision=(SELECT operator_revision FROM conversations WHERE id=$1)
   AND m.sequence<$2
   AND m.sequence>(SELECT min(old.sequence) FROM messages old JOIN whatsapp_outbox uncertain ON uncertain.message_id=old.id
    WHERE old.conversation_id=$1 AND uncertain.operator_revision=o.operator_revision AND uncertain.state='unknown' AND uncertain.sender_kind='assistant'
     AND EXISTS(SELECT 1 FROM messages page JOIN whatsapp_outbox cancelled ON cancelled.message_id=page.id WHERE page.conversation_id=$1 AND page.reply_group_id=old.reply_group_id AND cancelled.state='cancelled' AND cancelled.last_error='review_superseded'))
   AND (o.sender_kind='system' OR o.sender_kind='assistant' AND EXISTS(
    SELECT 1 FROM messages prior_turn WHERE prior_turn.id=m.response_to AND prior_turn.conversation_id=$1 AND prior_turn.direction='inbound' AND prior_turn.sequence<$2))
  RETURNING o.message_id,o.state`,[candidate.id,candidate.turn_sequence]);
 for(const state of ['blocked','cancelled']){
  const ids=moved.rows.filter(row=>row.state===state).map(row=>row.message_id);
  if(ids.length)await client.query('UPDATE messages SET status=$1 WHERE id=ANY($2::uuid[])',[state,ids]);
 }
 if(moved.rowCount)await client.query(`INSERT INTO owner_audit(store_id,email,action,target_id,details)
  VALUES($1,'system:delivery-recovery','delivery_queue_recovery',$2,$3::jsonb)`,[storeId,candidate.id,JSON.stringify({reason:'obsolete_review_dependency',replyId:candidate.reply_id,blockedNotices:moved.rows.filter(r=>r.state==='blocked').length,cancelledStaleReplies:moved.rows.filter(r=>r.state==='cancelled').length,unknownDeliveryPreserved:true})]);
}
