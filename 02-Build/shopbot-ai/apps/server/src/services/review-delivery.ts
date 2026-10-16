import type {PoolClient} from 'pg';
// Approval is attached to a complete visual reply group, never just its last
// accepted HTTP request. A tap on a single reply proves that reply was shown;
// it cannot prove that the other parts of a multi-message review arrived.
export async function reviewDeliveryReady(client:PoolClient,conversationId:string,binding:string,singleReplyTap=false):Promise<boolean>{
 const group=(await client.query(`SELECT m.reply_group_id,m.part_count FROM messages m JOIN whatsapp_actions a ON a.message_id=m.id WHERE m.conversation_id=$1 AND a.binding_id=$2 AND m.payload ? 'parts' ORDER BY m.sequence DESC LIMIT 1`,[conversationId,binding])).rows[0];
 if(!group)return true;
 const row=(await client.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE o.state IN ('delivered','read') OR $3=1 AND $4 AND o.state='accepted')::int AS ready FROM messages m LEFT JOIN whatsapp_outbox o ON o.message_id=m.id WHERE m.conversation_id=$1 AND m.reply_group_id=$2`,[conversationId,group.reply_group_id,group.part_count,singleReplyTap])).rows[0];
 return row.total===group.part_count&&row.ready===group.part_count;
}

export async function actionDeliveryReady(client:PoolClient,conversationId:string,eventId:string,singleReplyTap=false):Promise<boolean>{
 const group=(await client.query("SELECT m.reply_group_id,m.part_count,o.message_id FROM whatsapp_actions a JOIN messages m ON m.id=a.message_id JOIN whatsapp_outbox o ON o.message_id=m.id WHERE a.conversation_id=$1 AND a.event->>'id'=$2 ORDER BY m.sequence DESC LIMIT 1",[conversationId,eventId])).rows[0];
 if(!group)return true; // The local simulator has no transport.
 const rows=(await client.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE o.state IN ('delivered','read') OR $3=1 AND $4 AND o.state='accepted')::int AS ready FROM messages m JOIN whatsapp_outbox o ON o.message_id=m.id WHERE m.conversation_id=$1 AND (m.reply_group_id=$2 OR m.id=$2)",[conversationId,group.reply_group_id??group.message_id,group.part_count,singleReplyTap])).rows[0];
 return rows.total===group.part_count&&rows.ready===rows.total;
}
