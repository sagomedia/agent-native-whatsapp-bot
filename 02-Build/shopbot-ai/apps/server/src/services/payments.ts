import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {catalogWrite} from './catalog-proposals.js';

const fail=(message:string,statusCode=409)=>Object.assign(new Error(message),{statusCode});
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const paymentQuoteSchema=z.object({id:z.uuid(),requestId:z.uuid(),amountPaise:z.number().int().positive().max(2147483647),reason:z.string().trim().min(1).max(500)}).strict();
const factSchema=z.object({eventId:z.string().min(1).max(200),accountId:z.string().min(1).max(200),attemptId:z.uuid(),linkId:z.string().min(1).max(200),paymentId:z.string().max(200).optional(),refundId:z.string().max(200).optional(),amountPaise:z.number().int().positive().max(2147483647),currency:z.literal('INR'),state:z.enum(['pending','paid','failed','expired','cancelled','refunded'])}).strict();
export type PaymentFact=z.infer<typeof factSchema>;
export interface PaymentProvider {
 readonly name:string;readonly accountId:string;readonly checkoutHosts:readonly string[];
 createLink(input:{attemptId:string;requestId:string;amountPaise:number;currency:'INR';expiresAt:string},signal:AbortSignal):Promise<{id:string;url:string}>;
 // Adapter verifies exact raw bytes, account identity, status and amount. A
 // customer message, screenshot or unsigned JSON never reaches settlement.
 verifyEvent(raw:Buffer,headers:Record<string,string|undefined>):Promise<unknown>;
 reconcile(attempt:{id:string;providerLinkId:string|null},signal:AbortSignal):Promise<unknown>;
 requestRefund(input:{attemptId:string;paymentId:string;amountPaise:number;idempotencyKey:string},signal:AbortSignal):Promise<{id:string}>;
}
export async function offerPaymentQuote(c:PoolClient,storeId:string,input:unknown){
 const p=paymentQuoteSchema.parse(input),hash=digest(p),prior=(await c.query('SELECT id,state,input_hash FROM payment_quotes WHERE store_id=$1 AND id=$2',[storeId,p.id])).rows[0];
 if(prior){if(prior.input_hash!==hash)throw fail('That quote ID already represents a different final bill.');return {id:prior.id,state:prior.state,replayed:true};}
 const request=(await c.query('SELECT * FROM order_requests WHERE store_id=$1 AND id=$2 FOR UPDATE',[storeId,p.requestId])).rows[0];
 if(!request||request.acceptance!=='accepted'||!['preparing','ready_for_pickup'].includes(request.fulfillment))throw fail('Accept and check the request before offering its final bill.');
 if((await c.query("SELECT 1 FROM payment_attempts WHERE store_id=$1 AND request_id=$2 AND state IN ('creating','pending','paid','unknown','refund_pending','refunded','conflicting')",[storeId,p.requestId])).rowCount)throw fail('Resolve the existing payment attempt before changing the final bill.');
 await c.query("UPDATE payment_quotes SET state='superseded' WHERE store_id=$1 AND request_id=$2 AND state IN ('offered','accepted')",[storeId,p.requestId]);
 await c.query("INSERT INTO payment_quotes(id,store_id,request_id,amount_paise,currency,original_total_paise,lines,reason,input_hash,state,expires_at) VALUES($1,$2,$3,$4,'INR',$5,$6,$7,$8,'offered',clock_timestamp()+interval '15 minutes')",[p.id,storeId,p.requestId,p.amountPaise,request.total_paise,JSON.stringify(request.lines),p.reason,hash]);
 return {id:p.id,state:'offered',replayed:false,amountPaise:p.amountPaise,currency:'INR',requiresCustomerConsent:true};
}
export async function acceptPaymentQuote(c:PoolClient,scope:{storeId:string;conversationId:string;actor:string},quoteId:string,messageId:string){
 const row=(await c.query('SELECT q.*,r.conversation_id,r.actor,r.acceptance,r.fulfillment FROM payment_quotes q JOIN order_requests r ON r.id=q.request_id AND r.store_id=q.store_id WHERE q.store_id=$1 AND q.id=$2 FOR UPDATE OF q',[scope.storeId,z.uuid().parse(quoteId)])).rows[0];
 if(!row||row.conversation_id!==scope.conversationId||row.actor!==scope.actor)throw fail('The final bill does not belong to this customer.',403);
 const message=(await c.query("SELECT payload FROM messages WHERE conversation_id=$1 AND id=$2 AND direction='inbound'",[scope.conversationId,z.uuid().parse(messageId)])).rows[0];
 if(message?.payload?.type!=='accept_payment_quote'||message.payload.quoteId!==quoteId)throw fail('Use the current final-bill approval action.',403);
 if(row.state==='accepted'&&row.consent_message_id===messageId)return {id:quoteId,accepted:true,replayed:true};
 if(row.state!=='offered'||Date.parse(row.expires_at)<=Date.now()||row.acceptance!=='accepted'||!['preparing','ready_for_pickup'].includes(row.fulfillment))throw fail('This final bill is no longer current. Ask the shop for a new one.');
 await c.query("UPDATE payment_quotes SET state='accepted',consent_message_id=$1 WHERE store_id=$2 AND id=$3",[messageId,scope.storeId,quoteId]);return {id:quoteId,accepted:true,replayed:false};
}
const transaction=<T>(pool:Pool,storeId:string,id:string,action:string,run:(c:PoolClient)=>Promise<T>)=>catalogWrite(pool,storeId,'payment-service',action,id,run);
export async function createPaymentAttempt(pool:Pool,storeId:string,quoteId:string,attemptId:string,provider?:PaymentProvider){
 if(!provider)throw fail('Online payments are disabled until a provider account is configured.',503);
 z.uuid().parse(attemptId);z.uuid().parse(quoteId);
 const prepared=await transaction(pool,storeId,attemptId,'payment_create',async c=>{
  const q=(await c.query('SELECT q.*,r.acceptance,r.fulfillment FROM payment_quotes q JOIN order_requests r ON r.id=q.request_id AND r.store_id=q.store_id WHERE q.store_id=$1 AND q.id=$2 FOR UPDATE OF q',[storeId,quoteId])).rows[0];
  if(!q)throw fail('The final bill was not found.');
  const prior=(await c.query('SELECT * FROM payment_attempts WHERE store_id=$1 AND id=$2',[storeId,attemptId])).rows[0];if(prior){if(prior.quote_id!==quoteId||prior.provider!==provider.name||prior.account_id!==provider.accountId)throw fail('Payment idempotency key belongs to a different attempt.');return {row:prior,replayed:true};}
  if(q.state!=='accepted'||Date.parse(q.expires_at)<=Date.now()||q.acceptance!=='accepted'||!['preparing','ready_for_pickup'].includes(q.fulfillment))throw fail('The customer must approve the current final bill before payment.');
  if((await c.query("SELECT 1 FROM payment_attempts WHERE store_id=$1 AND quote_id=$2 AND state IN ('creating','pending','unknown','paid','refund_pending','refunded','conflicting')",[storeId,quoteId])).rowCount)throw fail('A payment already exists or has an unknown outcome. Reconcile it before retrying.');
  const row=(await c.query("INSERT INTO payment_attempts(id,store_id,quote_id,request_id,provider,account_id,amount_paise,currency,state,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'INR','creating',$8) RETURNING *",[attemptId,storeId,quoteId,q.request_id,provider.name,provider.accountId,q.amount_paise,q.expires_at])).rows[0];await c.query("UPDATE order_requests SET payment='creating' WHERE store_id=$1 AND id=$2",[storeId,q.request_id]);return {row,replayed:false};
 });
 if(prepared.replayed)return {id:prepared.row.id,state:prepared.row.state,url:prepared.row.checkout_url??null,replayed:true};
 try{
  const link=await bounded(signal=>provider.createLink({attemptId,requestId:prepared.row.request_id,amountPaise:prepared.row.amount_paise,currency:'INR',expiresAt:new Date(prepared.row.expires_at).toISOString()},signal));
  const url=new URL(link.url);if(link.url.length>2000||url.hash||url.protocol!=='https:'||url.username||url.password||url.port||!provider.checkoutHosts.includes(url.hostname)||!link.id||link.id.length>200)throw new Error('Invalid checkout link.');
  return await transaction(pool,storeId,attemptId,'payment_link',async c=>{const row=(await c.query("UPDATE payment_attempts SET provider_link_id=$1,checkout_url=$2,state=CASE WHEN state='creating' THEN 'pending' ELSE state END,updated_at=now() WHERE store_id=$3 AND id=$4 AND (provider_link_id IS NULL OR provider_link_id=$1) RETURNING id,state,checkout_url",[link.id,link.url,storeId,attemptId])).rows[0];if(!row)throw new Error('Conflicting provider link identity.');await c.query('UPDATE order_requests SET payment=$1 WHERE store_id=$2 AND id=$3',[row.state,storeId,prepared.row.request_id]);return {id:row.id,state:row.state,url:row.checkout_url,replayed:false};});
 }catch{await pool.query("UPDATE payment_attempts SET state=CASE WHEN state='creating' THEN 'unknown' ELSE state END,last_error='creation_outcome_unknown',updated_at=now() WHERE store_id=$1 AND id=$2",[storeId,attemptId]);await pool.query("UPDATE order_requests SET payment='unknown' WHERE store_id=$1 AND id=$2 AND payment='creating'",[storeId,prepared.row.request_id]);return {id:attemptId,state:'unknown',url:null,replayed:false};}
}
async function bounded<T>(run:(signal:AbortSignal)=>Promise<T>){const signal=AbortSignal.timeout(10000);return Promise.race([run(signal),new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('Provider outcome unknown')),{once:true}))]);}
async function settleFact(pool:Pool,storeId:string,provider:PaymentProvider,raw:unknown,payloadHash:string){
 const fact=factSchema.parse(raw);if(fact.accountId!==provider.accountId)throw fail('Payment account mismatch.',403);
 return transaction(pool,storeId,fact.attemptId,'payment_fact',async c=>{
  const row=(await c.query('SELECT * FROM payment_attempts WHERE store_id=$1 AND id=$2 AND provider=$3 AND account_id=$4 FOR UPDATE',[storeId,fact.attemptId,provider.name,provider.accountId])).rows[0];if(!row)throw fail('Payment attempt not found.',404);
  if(row.amount_paise!==fact.amountPaise||row.currency!==fact.currency||row.provider_link_id&&row.provider_link_id!==fact.linkId)throw fail('Payment amount, currency or link mismatch.',403);
  const prior=(await c.query('SELECT payload_hash FROM payment_events WHERE provider=$1 AND account_id=$2 AND event_id=$3',[provider.name,provider.accountId,fact.eventId])).rows[0];
  if(prior){if(prior.payload_hash!==payloadHash)throw fail('Conflicting payment event identity.',403);return {id:row.id,state:row.state,replayed:true};}
  if(fact.state==='paid'&&!fact.paymentId||fact.state==='refunded'&&(!fact.paymentId||!fact.refundId))throw fail('Settlement needs provider payment and refund identifiers.',403);
  await c.query('INSERT INTO payment_events(provider,account_id,event_id,store_id,attempt_id,payload_hash,fact) VALUES($1,$2,$3,$4,$5,$6,$7)',[provider.name,provider.accountId,fact.eventId,storeId,row.id,payloadHash,JSON.stringify(fact)]);
  let state=fact.state as string;
  if(row.payment_id&&fact.paymentId&&row.payment_id!==fact.paymentId)state='conflicting';
  else if(['failed','expired','cancelled'].includes(row.state)&&fact.state==='pending')state=row.state;
  else if(['paid','refund_pending','refunded','conflicting'].includes(row.state)&&!['paid','refunded'].includes(fact.state))state=row.state;
  else if(['refund_pending','refunded','conflicting'].includes(row.state)&&fact.state==='paid')state=row.state;
  else if(fact.state==='refunded'&&(!row.payment_id||row.payment_id!==fact.paymentId||row.refund_id&&row.refund_id!==fact.refundId))state='conflicting';
  await c.query('UPDATE payment_attempts SET state=$1,provider_link_id=coalesce(provider_link_id,$2),payment_id=coalesce(payment_id,$3),refund_id=coalesce(refund_id,$4),updated_at=now() WHERE store_id=$5 AND id=$6',[state,fact.linkId,fact.paymentId??null,fact.refundId??null,storeId,row.id]);
  // Payment and fulfillment are independent. Even a late paid event for a
  // cancelled request records the money received without marking collection.
  await c.query('UPDATE order_requests SET payment=$1 WHERE store_id=$2 AND id=$3',[state,storeId,row.request_id]);return {id:row.id,state,replayed:false};
 });
}
export async function receivePaymentEvent(pool:Pool,storeId:string,provider:PaymentProvider|undefined,raw:Buffer,headers:Record<string,string|undefined>){
 if(!provider)throw fail('Online payments are disabled.',503);if(raw.length>262144)throw fail('Payment event is too large.',413);
 const fact=await provider.verifyEvent(raw,headers);return settleFact(pool,storeId,provider,fact,createHash('sha256').update(raw).digest('hex'));
}
export async function reconcilePayment(pool:Pool,storeId:string,attemptId:string,provider?:PaymentProvider){
 if(!provider)throw fail('Online payments are disabled.',503);const row=(await pool.query('SELECT id,provider_link_id FROM payment_attempts WHERE store_id=$1 AND id=$2 AND provider=$3 AND account_id=$4',[storeId,z.uuid().parse(attemptId),provider.name,provider.accountId])).rows[0];if(!row)throw fail('Payment attempt not found.',404);
 const fact=await bounded(signal=>provider.reconcile({id:row.id,providerLinkId:row.provider_link_id},signal));return settleFact(pool,storeId,provider,fact,digest(fact));
}
export async function refundPayment(pool:Pool,storeId:string,attemptId:string,provider?:PaymentProvider){
 if(!provider)throw fail('Online payments are disabled.',503);
 const row=await transaction(pool,storeId,z.uuid().parse(attemptId),'payment_refund_request',async c=>{const r=(await c.query('SELECT * FROM payment_attempts WHERE store_id=$1 AND id=$2 AND provider=$3 AND account_id=$4 FOR UPDATE',[storeId,attemptId,provider.name,provider.accountId])).rows[0];if(!r||!['paid','refund_pending','refunded'].includes(r.state)||!r.payment_id)throw fail('Only a verified captured payment can be refunded.');if(r.state!=='paid')return {...r,replayed:true};await c.query("UPDATE payment_attempts SET state='refund_pending',updated_at=now() WHERE store_id=$1 AND id=$2",[storeId,attemptId]);await c.query("UPDATE order_requests SET payment='refund_pending' WHERE store_id=$1 AND id=$2",[storeId,r.request_id]);return {...r,replayed:false};});
 if(row.replayed)return {id:attemptId,state:row.state,replayed:true};
 try{const refund=await bounded(signal=>provider.requestRefund({attemptId,paymentId:row.payment_id,amountPaise:row.amount_paise,idempotencyKey:attemptId+'-full-refund'},signal));if(!refund.id||refund.id.length>200)throw new Error();await pool.query('UPDATE payment_attempts SET refund_id=$1 WHERE store_id=$2 AND id=$3',[refund.id,storeId,attemptId]);}catch{await pool.query("UPDATE payment_attempts SET last_error='refund_outcome_unknown' WHERE store_id=$1 AND id=$2",[storeId,attemptId]);}
 return {id:attemptId,state:'refund_pending',replayed:false};
}
