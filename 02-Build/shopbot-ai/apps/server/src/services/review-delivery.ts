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
