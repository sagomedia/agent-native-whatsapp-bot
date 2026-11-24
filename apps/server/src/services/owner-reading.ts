import type {Pool} from 'pg';
import {z} from 'zod';
// One configured authenticated owner per shop. These receipts are dashboard
// attention only; they never touch customer WhatsApp receipts or order stages.
export const messageSequence=z.string().regex(/^[1-9]\d{0,18}$/).refine(value=>/^[1-9]\d{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n);
export const orderAttentionSql=`md5(jsonb_build_array(r.effective_revision,r.acceptance,r.fulfillment,
 (SELECT max(am.updated_at)::text FROM order_amendments am WHERE am.request_id=r.id AND am.store_id=r.store_id),
 (SELECT ad.state FROM order_advances ad WHERE ad.request_id=r.id AND ad.store_id=r.store_id))::text)`;
export const orderUnreadSql=`NOT EXISTS(SELECT 1 FROM owner_order_reads rd WHERE rd.request_id=r.id AND rd.attention_key=${orderAttentionSql})`;
export const chatUnreadSql=`(SELECT count(*)::int FROM messages unread WHERE unread.conversation_id=c.id AND unread.direction='inbound' AND unread.sequence>coalesce((SELECT rd.read_sequence FROM owner_chat_reads rd WHERE rd.conversation_id=c.id),0))`;
export async function ownerAttentionCounts(pool:Pick<Pool,'query'>,storeId:string){
 const [orders,chats]=await Promise.all([
  pool.query(`SELECT count(*)::int AS count FROM order_requests r WHERE r.store_id=$1 AND ${orderUnreadSql}`,[storeId]),
  pool.query(`SELECT coalesce(sum(n),0)::int AS messages,count(*) FILTER(WHERE n>0)::int AS chats FROM (SELECT ${chatUnreadSql} AS n FROM conversations c WHERE c.store_id=$1) counts`,[storeId])
 ]);
 return {orders:orders.rows[0].count,chats:chats.rows[0].chats,messages:chats.rows[0].messages};
}
