import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {quoteDraftLineSchema,type SavedQuoteDraft} from '../../../../packages/contracts/owner-quote.js';
import type {DraftLine} from '../../../../packages/contracts/index.js';
import {ToolError} from './context.js';
export const saveQuoteDraftSchema=z.object({expectedVersion:z.number().int().nonnegative(),expectedRevision:z.number().int().positive(),amendmentId:z.uuid().optional(),lines:z.array(quoteDraftLineSchema).min(1).max(50)}).strict();
export function quoteDraftRow(row:any):SavedQuoteDraft{return {version:row.version,expectedRevision:row.expected_revision,...(row.amendment_id?{amendmentId:row.amendment_id}:{}),lines:row.lines,updatedAt:new Date(row.updated_at).toISOString()};}
export async function saveQuoteDraft(c:PoolClient,storeId:string,requestId:string,actor:string,input:unknown){
 const p=saveQuoteDraftSchema.parse(input);
 const r=(await c.query('SELECT * FROM order_requests WHERE store_id=$1 AND id=$2 FOR UPDATE',[storeId,requestId])).rows[0];
 if(!r||['collected','cancelled'].includes(r.fulfillment)||r.acceptance==='rejected')throw new ToolError('This order is no longer open for quote edits.');
 if(r.effective_revision!==p.expectedRevision)throw new ToolError('The customer’s order changed. Load the current order before saving.','stale_version');
 if((await c.query("SELECT 1 FROM order_quotes WHERE request_id=$1 AND state='offered' AND created_at>now()-interval '24 hours'",[r.id])).rowCount)throw new ToolError('A quote is awaiting customer approval. Wait for their response before editing.');
 const pending=(await c.query("SELECT * FROM order_amendments WHERE request_id=$1 AND state IN ('proposed','owner_pending')",[r.id])).rows[0];
 if(pending&&(!p.amendmentId||p.amendmentId!==pending.id||pending.state!=='owner_pending'||pending.kind!=='change')||p.amendmentId&&!pending)throw new ToolError('Review the current customer change before saving its quote.','stale_version');
 const source:DraftLine[]=pending?.proposed_lines??r.effective_lines??r.lines;
 if(p.lines.length!==source.length||new Set(p.lines.map(l=>l.id)).size!==source.length||p.lines.some(l=>!source.some(s=>s.id===l.id)))throw new ToolError('Keep every requested line. Product additions and removals require a customer amendment.');
 const old=(await c.query('SELECT * FROM order_quote_drafts WHERE store_id=$1 AND request_id=$2 FOR UPDATE',[storeId,r.id])).rows[0];
 if((old?.version??0)!==p.expectedVersion){
  if(old?.version===p.expectedVersion+1&&old.expected_revision===p.expectedRevision&&(old.amendment_id??undefined)===p.amendmentId&&isDeepStrictEqual(old.lines,p.lines))return {draft:quoteDraftRow(old)};
  throw new ToolError('This draft was changed in another window. Load the saved draft before saving again.','stale_version');
 }
 const row=(await c.query(`INSERT INTO order_quote_drafts(store_id,request_id,expected_revision,amendment_id,lines,version,updated_by) VALUES($1,$2,$3,$4,$5::jsonb,1,$6)
 ON CONFLICT(request_id) DO UPDATE SET expected_revision=excluded.expected_revision,amendment_id=excluded.amendment_id,lines=excluded.lines,version=order_quote_drafts.version+1,updated_at=now(),updated_by=excluded.updated_by RETURNING *`,[storeId,r.id,p.expectedRevision,p.amendmentId??null,JSON.stringify(p.lines),actor])).rows[0];
 return {draft:quoteDraftRow(row)};
}
