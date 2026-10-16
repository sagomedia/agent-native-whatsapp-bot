import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {ConversationState,DraftLine,SimulatorEvent} from '../../../../packages/contracts/index.js';
import {say,unitName} from '../../../../packages/contracts/language.js';
import {formatMoney,lineTotal} from '../../../../packages/contracts/money.js';
import {messageBlocks} from '../../../../packages/contracts/customer-copy.js';
import {digest} from './tools.js';
import {textPresentation} from './message-presentation.js';
import {ToolError,type ActorContext} from './context.js';
import {sellingBasisIssues} from '../../../../packages/contracts/selling-basis.js';

const count=z.number().positive().max(100).refine(n=>Math.abs(n*1000-Math.round(n*1000))<1e-7);
export const orderQuoteSchema=z.object({id:z.uuid(),amendmentId:z.uuid().optional(),expectedRevision:z.number().int().positive(),lines:z.array(z.object({id:z.uuid(),name:z.string().trim().min(1).max(200),quantity:count,unit:z.string().trim().min(1).max(30),saleMode:z.enum(['pack','measured']).optional(),pricePaise:z.number().int().min(0).max(100000000),free:z.boolean().optional()}).strict()).min(1).max(50)}).strict();
export async function offerOrderQuote(client:PoolClient,storeId:string,requestId:string,actor:string,input:unknown) {
 const p=orderQuoteSchema.parse(input),hash=digest(p);
 const request=(await client.query('SELECT * FROM order_requests WHERE id=$1 AND store_id=$2 FOR UPDATE',[requestId,storeId])).rows[0];
 if(!request||['collected','cancelled'].includes(request.fulfillment)||request.acceptance==='rejected')throw new ToolError('The request is not available for a quote.');
 const previous=(await client.query('SELECT * FROM order_quotes WHERE id=$1 AND store_id=$2',[p.id,storeId])).rows[0];
 if(previous){if(previous.request_id!==requestId||previous.input_hash!==hash)throw new ToolError('This quote ID represents different details.');return {quote:previous,replayed:true};}
 if(request.effective_revision!==p.expectedRevision)throw new ToolError('The order changed. Refresh the quote.','stale_version');
 const amendment=(await client.query("SELECT * FROM order_amendments WHERE request_id=$1 AND state IN ('proposed','owner_pending')",[requestId])).rows[0];
 if(amendment&&(!p.amendmentId||amendment.id!==p.amendmentId||amendment.state!=='owner_pending'||amendment.kind!=='change'))throw new ToolError('Choose the customer-confirmed amendment before quoting its items.');
 if(p.amendmentId&&!amendment)throw new ToolError('That amendment is no longer awaiting a quote.');
 const old:DraftLine[]=amendment?.proposed_lines??request.effective_lines??request.lines;
 if(p.lines.length!==old.length||new Set(p.lines.map(l=>l.id)).size!==old.length||p.lines.some(l=>!old.some(o=>o.id===l.id)))throw new ToolError('Quote every requested line exactly once. Use an amendment to add or remove products.');
 const at=new Date().toISOString();
 const lines:DraftLine[]=p.lines.map(line=>{
  if(!line.pricePaise&&!line.free)throw new ToolError('An unknown price cannot be zero. Explicitly mark a free item.');
  const original=old.find(o=>o.id===line.id)!;
  const unchanged=line.name===original.name&&line.unit===original.unit,product=unchanged?original.candidates?.find(p=>p.sku===original.sku):undefined;
  const saleMode=line.saleMode??(unchanged?original.merchantConfirmed?.saleMode??product?.sellingPolicy?.saleMode:undefined);
  const issues=sellingBasisIssues({name:line.name,unit:line.unit,specifications:product?.specifications,sellingPolicy:{...(product?.sellingPolicy??{cutAllowed:false,continuousLengthAvailable:null}),...(saleMode?{saleMode}:{})}});
  if(issues.length)throw new ToolError(`${line.name}: ${issues.join(' ')}`);
  return {...original,sku:unchanged?original.sku:undefined,candidates:unchanged?original.candidates:[],name:line.name,quantity:line.quantity,unit:line.unit,pricePaise:line.pricePaise,resolution:'matched',catalogIssue:undefined,requestedUnit:undefined,requestedAmount:undefined,merchantConfirmed:{actor,at,free:!!line.free,...(saleMode?{saleMode}:{})}};
 });
 const total=lines.reduce((n,line)=>n+lineTotal(line.pricePaise!,line.quantity!),0);
 await client.query("UPDATE order_quotes SET state='superseded' WHERE request_id=$1 AND state='offered'",[requestId]);
 const quote=(await client.query("INSERT INTO order_quotes(id,store_id,request_id,expected_revision,lines,total_paise,input_hash,actor,amendment_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) RETURNING *",[p.id,storeId,requestId,p.expectedRevision,JSON.stringify(lines),total,hash,actor,p.amendmentId??null])).rows[0];
 await client.query('UPDATE conversations SET version=version+1 WHERE id=$1',[request.conversation_id]);
 return {quote,replayed:false};
}
export async function orderQuoteReply(client:PoolClient,storeId:string,quoteId:string) {
 const row=(await client.query('SELECT q.*,c.version,c.reply_language,a.state AS advance_state FROM order_quotes q JOIN order_requests r ON r.id=q.request_id JOIN conversations c ON c.id=r.conversation_id LEFT JOIN order_advances a ON a.request_id=r.id WHERE q.store_id=$1 AND q.id=$2',[storeId,quoteId])).rows[0];
 if(!row)throw new ToolError('Quote not found.');
 const state={replyLanguage:row.reply_language},lines:DraftLine[]=row.lines;
 const itemBlocks=lines.map((l,index)=>`${index+1}. ${l.name}\n   ${l.quantity} ${unitName(l.unit!,state,l.quantity!)} × ${formatMoney(l.pricePaise!)} = ${formatMoney(lineTotal(l.pricePaise!,l.quantity!))}`);
 const paid=row.advance_state==='verified'?1000:0;
 const text=messageBlocks(say(state,'Final shop quote','கடை check பண்ணிய bill','Kadai check pannina bill'),...itemBlocks,`${say(state,'Total','மொத்தம்','Moththam')}: ${formatMoney(Number(row.total_paise))}`,`${say(state,'Verified advance','Advance வந்தது','Advance vanthathu')}: ${formatMoney(paid)}`,Number(row.total_paise)>=paid?`${say(state,'Remaining balance','இன்னும் செலுத்த வேண்டியது','Innum seluththa vendiyathu')}: ${formatMoney(Number(row.total_paise)-paid)}`:say(state,`Excess advance: ${formatMoney(paid-Number(row.total_paise))}. The shop must arrange its refund.`,`Advance-ல ${formatMoney(paid-Number(row.total_paise))} மீதி இருக்கு. கடை refund check பண்ணணும்.`,`Advance-la ${formatMoney(paid-Number(row.total_paise))} meethi irukku. Kadai refund check pannanum.`),say(state,'Is this final quote correct?','இந்த bill சரியா?','Intha bill sariyaa?'));
 return textPresentation(text,[{label:say(state,'Bill is correct','Bill சரி','Bill sari'),event:{id:randomUUID(),type:'confirm_order_quote',quoteId:row.id,expectedVersion:row.version}},{label:say(state,'Ask the shop','உதவி வேணும்','Help venum'),event:{id:randomUUID(),type:'shopping_action',action:'handoff',expectedVersion:row.version}}],'bill');
}
export async function acceptOrderQuote(client:PoolClient,ctx:ActorContext,state:ConversationState,event:Extract<SimulatorEvent,{type:'confirm_order_quote'}>,sourceMessageId=event.id) {
 if(event.expectedVersion!==state.version)throw new ToolError('Use the latest quote.','stale_version');
 const q=(await client.query('SELECT q.*,r.effective_revision,r.conversation_id,r.actor,r.fulfillment,r.acceptance FROM order_quotes q JOIN order_requests r ON r.id=q.request_id WHERE q.id=$1 AND q.store_id=$2 FOR UPDATE OF q,r',[event.quoteId,ctx.storeId])).rows[0];
 if(!q||q.conversation_id!==ctx.conversationId||q.actor!==ctx.actor||q.request_id!==state.lastRequestId)throw new ToolError('That quote belongs to another order.','forbidden');
 if(q.state==='accepted')return {accepted:true,replayed:true};
 if(q.state!=='offered'||q.expected_revision!==q.effective_revision||['collected','cancelled'].includes(q.fulfillment)||q.acceptance==='rejected'||Date.now()-new Date(q.created_at).getTime()>24*3600000)throw new ToolError('The quote is no longer current. Ask the shop for a new one.');
 await client.query("UPDATE order_quotes SET state='accepted',consent_message_id=$1,accepted_at=now() WHERE id=$2",[sourceMessageId,q.id]);
 await client.query("UPDATE order_requests SET effective_lines=$1::jsonb,effective_total_paise=$2,estimate_complete=true,excluded_line_ids='[]',effective_revision=effective_revision+1 WHERE id=$3",[JSON.stringify(q.lines),q.total_paise,q.request_id]);
 await client.query('UPDATE conversations SET draft=$1::jsonb,version=version+1 WHERE id=$2 AND last_request_id=$3',[JSON.stringify(q.lines),ctx.conversationId,q.request_id]);
 if(q.amendment_id)await client.query("UPDATE order_amendments SET state='accepted',decided_by=$1,decided_at=now(),updated_at=now() WHERE id=$2 AND state='owner_pending'",[q.actor,q.amendment_id]);
 return {accepted:true,replayed:false};
}
