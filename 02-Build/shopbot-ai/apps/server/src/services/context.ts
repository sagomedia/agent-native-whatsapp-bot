import type { Pool, PoolClient } from 'pg';
export type ActorContext = { storeId: string; conversationId: string; actor: string; role: 'customer' | 'staff'; consentReviewId?: string;consentProductBatchId?:string;selectedCatalogSku?:string };
export class ToolError extends Error { constructor(message: string, public code = 'invalid_action') { super(message); } }
export async function withConversation<T>(pool: Pool, context: ActorContext, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query('BEGIN'); await authorize(client, context); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function authorize(client: PoolClient, context: ActorContext) {
  if (context.role !== 'customer') throw new ToolError('Customer tools require a verified customer identity', 'forbidden');
  const row = await client.query('SELECT id FROM conversations WHERE id=$1 AND store_id=$2 AND actor=$3 FOR UPDATE', [context.conversationId, context.storeId, context.actor]);
  if (!row.rowCount) throw new ToolError('Conversation is not accessible to this identity', 'forbidden');
}
