import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore,fixtureConversation} from '../profiles/hardware.js';
import {catalogWrite} from '../apps/server/src/services/catalog-proposals.js';
import {offerPaymentQuote,acceptPaymentQuote,createPaymentAttempt,receivePaymentEvent,reconcilePayment,refundPayment,type PaymentProvider,type PaymentFact} from '../apps/server/src/services/payments.js';

// This HMAC adapter is synthetic. It is never registered with the application
// and is not evidence that a real provider account/webhook is connected.
class SyntheticProvider implements PaymentProvider {
 readonly name='synthetic-only';readonly accountId='account-test';readonly checkoutHosts=['checkout.example.test'];creates=0;refunds=0;failCreate=false;failRefund=false;fact:PaymentFact|null=null;
 async createLink(input:{attemptId:string}){this.creates++;if(this.failCreate)throw new Error('network outcome unknown');return {id:'link-'+input.attemptId,url:'https://checkout.example.test/'+input.attemptId};}
 async verifyEvent(raw:Buffer,headers:Record<string,string|undefined>){const expected=createHmac('sha256','synthetic-only-secret').update(raw).digest(),actual=Buffer.from(headers.signature??'','hex');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error('Signature verification failed');return JSON.parse(raw.toString());}
 async reconcile(){if(!this.fact)throw new Error('Unknown provider outcome');return this.fact;}
 async requestRefund(){this.refunds++;if(this.failRefund)throw new Error('network outcome unknown');return {id:'refund-fixture'};}
}
async function fixture(run:(p:pg.Pool,provider:SyntheticProvider,ids:{requestId:string;quoteId:string;actor:string})=>Promise<void>){const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='payment_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});try{await setupDatabase(pool,'mock');const actor=(await pool.query('SELECT actor FROM conversations WHERE id=$1',[fixtureConversation])).rows[0].actor,requestId=randomUUID(),quoteId=randomUUID();await pool.query("INSERT INTO order_requests(id,store_id,conversation_id,actor,review_id,lines,total_paise,acceptance,fulfillment) VALUES($1,$2,$3,$4,$5,'[]',10000,'accepted','preparing')",[requestId,fixtureStore,fixtureConversation,actor,randomUUID()]);await run(pool,new SyntheticProvider(),{requestId,quoteId,actor});}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}}
const write=<T>(p:pg.Pool,id:string,run:Parameters<typeof catalogWrite<T>>[5])=>catalogWrite(p,fixtureStore,'payment-test','payment_test',id,run);
async function consent(pool:pg.Pool,ids:{quoteId:string;requestId:string;actor:string}){await write(pool,ids.quoteId,c=>offerPaymentQuote(c,fixtureStore,{id:ids.quoteId,requestId:ids.requestId,amountPaise:11000,reason:'Synthetic final price after shop review'}));const messageId=randomUUID();await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload) VALUES($1,$2,'inbound','approve final bill','processed',$3)",[messageId,fixtureConversation,JSON.stringify({type:'accept_payment_quote',quoteId:ids.quoteId})]);await write(pool,ids.quoteId,c=>acceptPaymentQuote(c,{storeId:fixtureStore,conversationId:fixtureConversation,actor:ids.actor},ids.quoteId,messageId));return messageId;}
const fact=(id:string,state:PaymentFact['state']='paid'):PaymentFact=>({eventId:'event-'+randomUUID(),accountId:'account-test',attemptId:id,linkId:'link-'+id,amountPaise:11000,currency:'INR',state,...(state==='paid'||state==='refunded'?{paymentId:'captured-fixture'}:{}),...(state==='refunded'?{refundId:'refund-fixture'}:{})});
function deliver(pool:pg.Pool,p:SyntheticProvider,f:PaymentFact,signed=true){const raw=Buffer.from(JSON.stringify(f));return receivePaymentEvent(pool,fixtureStore,p,raw,{signature:signed?createHmac('sha256','synthetic-only-secret').update(raw).digest('hex'):'00'});}

test('payments stay disabled without a provider and require the bound customer’s current final-bill consent',()=>fixture(async(pool,p,ids)=>{
 await assert.rejects(createPaymentAttempt(pool,fixtureStore,ids.quoteId,randomUUID()),/disabled/);
 await write(pool,ids.quoteId,c=>offerPaymentQuote(c,fixtureStore,{id:ids.quoteId,requestId:ids.requestId,amountPaise:11000,reason:'Final fixture bill'}));
 await assert.rejects(createPaymentAttempt(pool,fixtureStore,ids.quoteId,randomUUID(),p),/approve/);
 const fakeMessage=randomUUID();await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload) VALUES($1,$2,'inbound','I paid; screenshot attached','processed',$3)",[fakeMessage,fixtureConversation,JSON.stringify({type:'text',text:'I paid'})]);
 await assert.rejects(write(pool,ids.quoteId,c=>acceptPaymentQuote(c,{storeId:fixtureStore,conversationId:fixtureConversation,actor:ids.actor},ids.quoteId,fakeMessage)),/approval action/);
 assert.equal(p.creates,0);assert.equal((await pool.query('SELECT total_paise,payment FROM order_requests WHERE id=$1',[ids.requestId])).rows[0].total_paise,'10000');
}));
test('payment link creation is idempotent and an uncertain result holds the attempt until verified reconciliation',()=>fixture(async(pool,p,ids)=>{
 await consent(pool,ids);const id=randomUUID();p.failCreate=true;assert.equal((await createPaymentAttempt(pool,fixtureStore,ids.quoteId,id,p)).state,'unknown');assert.equal((await createPaymentAttempt(pool,fixtureStore,ids.quoteId,id,p)).replayed,true);assert.equal(p.creates,1);
 await assert.rejects(createPaymentAttempt(pool,fixtureStore,ids.quoteId,randomUUID(),p),/unknown outcome/);p.fact=fact(id);assert.equal((await reconcilePayment(pool,fixtureStore,id,p)).state,'paid');
 const order=(await pool.query('SELECT payment,fulfillment,total_paise FROM order_requests WHERE id=$1',[ids.requestId])).rows[0];assert.equal(order.payment,'paid');assert.equal(order.fulfillment,'preparing');assert.equal(order.total_paise,'10000');
}));
test('only signed, correctly bound captures settle; duplicates and reordered events cannot regress a captured payment',()=>fixture(async(pool,p,ids)=>{
 await consent(pool,ids);const id=randomUUID();await createPaymentAttempt(pool,fixtureStore,ids.quoteId,id,p);const capture=fact(id);
 for(const value of [{...capture,amountPaise:100},{...capture,accountId:'other-account'},{...capture,linkId:'other-link'}])await assert.rejects(deliver(pool,p,value),/mismatch/);
 await assert.rejects(deliver(pool,p,capture,false),/Signature/);assert.equal((await pool.query('SELECT payment FROM order_requests WHERE id=$1',[ids.requestId])).rows[0].payment,'pending');
 assert.equal((await deliver(pool,p,capture)).state,'paid');assert.equal((await deliver(pool,p,capture)).replayed,true);assert.equal((await deliver(pool,p,fact(id,'pending'))).state,'paid');await assert.rejects(deliver(pool,p,{...capture,state:'failed'}),/Conflicting/);
 assert.equal((await pool.query('SELECT count(*) FROM payment_events')).rows[0].count,'2');
}));
test('late captures record money for cancelled orders; refund requests remain pending until verified full refund evidence',()=>fixture(async(pool,p,ids)=>{
 await consent(pool,ids);const id=randomUUID();await createPaymentAttempt(pool,fixtureStore,ids.quoteId,id,p);await pool.query("UPDATE order_requests SET fulfillment='cancelled' WHERE id=$1",[ids.requestId]);await deliver(pool,p,fact(id));
 p.failRefund=true;assert.equal((await refundPayment(pool,fixtureStore,id,p)).state,'refund_pending');assert.equal((await refundPayment(pool,fixtureStore,id,p)).replayed,true);assert.equal(p.refunds,1);assert.equal((await deliver(pool,p,fact(id))).state,'refund_pending');
 const refunded=await deliver(pool,p,fact(id,'refunded'));assert.equal(refunded.state,'refunded');assert.equal((await deliver(pool,p,fact(id))).state,'refunded');
 const row=(await pool.query('SELECT payment,fulfillment FROM order_requests WHERE id=$1',[ids.requestId])).rows[0];assert.deepEqual(row,{payment:'refunded',fulfillment:'cancelled'});
}));
test('expired consent and changed or rejected final bills never create a checkout',()=>fixture(async(pool,p,ids)=>{
 await consent(pool,ids);await pool.query("UPDATE payment_quotes SET expires_at=now()-interval '1 second' WHERE id=$1",[ids.quoteId]);await assert.rejects(createPaymentAttempt(pool,fixtureStore,ids.quoteId,randomUUID(),p),/approve/);assert.equal(p.creates,0);
 await pool.query("UPDATE order_requests SET fulfillment='cancelled' WHERE id=$1",[ids.requestId]);await assert.rejects(write(pool,ids.quoteId,c=>offerPaymentQuote(c,fixtureStore,{id:randomUUID(),requestId:ids.requestId,amountPaise:12000,reason:'Changed'})),/Accept and check/);
}));
