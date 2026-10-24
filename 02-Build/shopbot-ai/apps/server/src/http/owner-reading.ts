import type {FastifyInstance} from 'fastify';
import type {Pool} from 'pg';
import {z} from 'zod';
import {messageSequence,orderAttentionSql} from '../services/owner-reading.js';
export function registerOwnerReading(app:FastifyInstance,pool:Pool,storeId:string){
 app.post<{Params:{id:string}}>('/api/owner/requests/:id/seen',async(req,reply)=>{
  const body=z.object({attentionKey:z.string().regex(/^[a-f0-9]{32}$/)}).strict().safeParse(req.body);
  if(!z.uuid().safeParse(req.params.id).success||!body.success)return reply.code(400).send({error:'Invalid order read receipt'});
  // Bind to the exact displayed snapshot; a concurrent update stays unread.
  const result=await pool.query(`INSERT INTO owner_order_reads(request_id,attention_key) SELECT r.id,$3 FROM order_requests r WHERE r.store_id=$1 AND r.id=$2 AND ${orderAttentionSql}=$3 ON CONFLICT(request_id) DO UPDATE SET attention_key=EXCLUDED.attention_key,seen_at=now() RETURNING request_id`,[storeId,req.params.id,body.data.attentionKey]);
  return {seen:!!result.rowCount};
 });
 app.post<{Params:{id:string}}>('/api/owner/conversations/:id/seen',async(req,reply)=>{
  const body=z.object({through:messageSequence,anchor:messageSequence,offset:z.number().int().min(-100000).max(100000)}).strict().safeParse(req.body);
  if(!z.uuid().safeParse(req.params.id).success||!body.success)return reply.code(400).send({error:'Invalid chat reading position'});
  const {through,anchor,offset}=body.data;
  const result=await pool.query(`INSERT INTO owner_chat_reads(conversation_id,read_sequence,anchor_sequence,anchor_offset)
   SELECT c.id,m.sequence,a.sequence,$5 FROM conversations c JOIN messages m ON m.conversation_id=c.id AND m.sequence=$3 JOIN messages a ON a.conversation_id=c.id AND a.sequence=$4 WHERE c.store_id=$1 AND c.id=$2
   ON CONFLICT(conversation_id) DO UPDATE SET read_sequence=greatest(owner_chat_reads.read_sequence,EXCLUDED.read_sequence),anchor_sequence=EXCLUDED.anchor_sequence,anchor_offset=EXCLUDED.anchor_offset,seen_at=now() RETURNING read_sequence,anchor_sequence,anchor_offset`,[storeId,req.params.id,through,anchor,offset]);
  if(!result.rowCount)return reply.code(404).send({error:'Chat or messages not found'});
  return {reading:result.rows[0]};
 });
}
