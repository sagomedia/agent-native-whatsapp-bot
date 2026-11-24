import type {PoolClient} from 'pg';

// Invalidate the complete unsent group, including text/image pages without
// their own buttons. Attempted pages keep their truthful delivery outcome.
export async function cancelSupersededReviews(client:PoolClient,conversationId:string,version:number,binding:string|null){
 const cancelled=await client.query(`UPDATE whatsapp_outbox o SET state='cancelled',last_error='review_superseded'
  FROM messages m WHERE m.id=o.message_id AND o.conversation_id=$1 AND o.state='queued' AND o.sender_kind='assistant'
  AND EXISTS(SELECT 1 FROM messages page JOIN whatsapp_actions a ON a.message_id=page.id
    WHERE page.conversation_id=o.conversation_id AND (page.id=m.id OR page.reply_group_id=m.reply_group_id)
    AND (a.source_version<>$2 OR a.binding_id IS DISTINCT FROM $3::uuid)) RETURNING o.message_id`,[conversationId,version,binding]);
 if(cancelled.rowCount)await client.query("UPDATE messages SET status='cancelled' WHERE id=ANY($1::uuid[])",[cancelled.rows.map(row=>row.message_id)]);
}

// Approval is attached to a complete visual reply group, never just its last
// accepted HTTP request. A bound tap can prove its own page while that receipt
// is delayed; every other page still needs a delivered/read receipt.
export async function reviewDeliveryReady(client:PoolClient,conversationId:string,binding:string,singleReplyTap=false,eventId?:string):Promise<boolean>{
 const group=(await client.query(`SELECT m.reply_group_id,m.part_count,m.id FROM messages m JOIN whatsapp_actions a ON a.message_id=m.id WHERE m.conversation_id=$1 AND a.binding_id=$2 AND m.payload ? 'parts' AND ($3::text IS NULL OR a.event->>'id'=$3) ORDER BY m.sequence DESC LIMIT 1`,[conversationId,binding,eventId??null])).rows[0];
 if(!group)return true;
 const row=(await client.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE o.state IN ('delivered','read') OR $4 AND o.state='accepted' AND ($3=1 OR m.id=$5::uuid))::int AS ready FROM messages m LEFT JOIN whatsapp_outbox o ON o.message_id=m.id WHERE m.conversation_id=$1 AND m.reply_group_id=$2`,[conversationId,group.reply_group_id,group.part_count,singleReplyTap,eventId?group.id:null])).rows[0];
 return row.total===group.part_count&&row.ready===group.part_count;
}

export async function actionDeliveryReady(client:PoolClient,conversationId:string,eventId:string,singleReplyTap=false):Promise<boolean>{
 const group=(await client.query("SELECT m.reply_group_id,m.part_count,o.message_id FROM whatsapp_actions a JOIN messages m ON m.id=a.message_id JOIN whatsapp_outbox o ON o.message_id=m.id WHERE a.conversation_id=$1 AND a.event->>'id'=$2 ORDER BY m.sequence DESC LIMIT 1",[conversationId,eventId])).rows[0];
 if(!group)return true; // The local simulator has no transport.
 const rows=(await client.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE o.state IN ('delivered','read') OR $4 AND o.state='accepted' AND ($3=1 OR m.id=$5::uuid))::int AS ready FROM messages m JOIN whatsapp_outbox o ON o.message_id=m.id WHERE m.conversation_id=$1 AND (m.reply_group_id=$2 OR m.id=$2)",[conversationId,group.reply_group_id??group.message_id,group.part_count,singleReplyTap,group.message_id])).rows[0];
 return rows.total===group.part_count&&rows.ready===rows.total;
}
