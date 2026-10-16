import {readWhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync} from 'node:fs';
import pg from 'pg';
import type {Interpretation,SimulatorEvent,RichReply} from '../packages/contracts/index.js';
import type {Interpreter} from '../apps/server/src/adapters/interpreter.js';
import {MockInterpreter} from '../apps/server/src/adapters/mock-interpreter.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {SimulatorService,simulatorContext} from '../apps/server/src/services/simulator.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {withConversation} from '../apps/server/src/services/context.js';
import {verifyManualAdvance,verifyManualRefund,upiUri,readUpiAdvance,qrImage} from '../apps/server/src/services/upi-advance.js';
import {decideAmendment,acknowledgementOnly} from '../apps/server/src/services/order-amendments.js';
import {offerOrderQuote,orderQuoteReply} from '../apps/server/src/services/order-quotes.js';
import {estimateLines,estimateText} from '../apps/server/src/services/order-estimate.js';
import {textPresentation} from '../apps/server/src/services/message-presentation.js';
import {renderWhatsAppReply} from '../apps/server/src/services/whatsapp-reply.js';
import {customerCopy} from '../packages/contracts/customer-copy.js';

const advance={vpa:'fixture.merchant@bank',name:'Fixture shop',hostname:'bot.example.com'};
class ControlledInterpreter implements Interpreter {
 name='offline-customer-ordering';mode='mock' as const;next:Interpretation|undefined;calls=0;private fallback=new MockInterpreter();
 async interpret(...args:Parameters<Interpreter['interpret']>){this.calls++;if(this.next){const output=this.next;this.next=undefined;return {output,usage:null,truncated:false};}return this.fallback.interpret(...args);}
}
async function fixture(run:(f:{pool:pg.Pool;inbox:SimulatorService;runtime:ConversationRuntime;provider:ControlledInterpreter;turn:(event:SimulatorEvent|string)=>Promise<any>})=>Promise<void>,extra:ConstructorParameters<typeof ConversationRuntime>[2]={}){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='customer_finish_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{
  await setupDatabase(pool,'mock');const provider=new ControlledInterpreter(),inbox=new SimulatorService(pool),runtime=new ConversationRuntime(pool,provider,{partialReviews:true,advance,...extra});
  const turn=async(value:SimulatorEvent|string)=>{await inbox.ingest(typeof value==='string'?{id:randomUUID(),type:'text',text:value}:value);assert.equal(await runtime.processNext(simulatorContext),true);return inbox.snapshot();};
  await run({pool,inbox,runtime,provider,turn});
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
async function submitKnown(turn:(e:SimulatorEvent|string)=>Promise<any>){await turn('I need two PTFE tape rolls');await turn('yes');}
const lastRich=(snapshot:any)=>snapshot.messages.filter((m:any)=>m.direction==='outbound').at(-1).rich as RichReply;

test('partial review keeps unknown items unpriced and one approved review creates one pending ₹10 advance',()=>fixture(async({pool,turn})=>{
 let s=await turn('I need two PTFE tape rolls and one unicorn bolt');assert.equal(s.conversation.draft.length,2);
 s=await turn({id:randomUUID(),type:'review_partial',expectedVersion:s.conversation.version});
 assert.equal(s.conversation.pending.kind,'review');assert.equal(s.conversation.pending.totalPaise,7000);assert.equal(s.conversation.pending.excludedLineIds.length,1);
 const bill=lastRich(s);assert.match(bill.text,/Known-price items only: ₹70/);assert.match(bill.text,/unicorn bolt/);assert.doesNotMatch(bill.text,/₹0(?:\D|$)/);
 const event={id:randomUUID(),type:'confirm' as const,reviewId:s.conversation.pending.id};s=await turn(event);
 const row=(await pool.query('SELECT * FROM order_requests')).rows[0];assert.equal(row.estimate_complete,false);assert.equal(row.advance_required,true);assert.equal(row.payment,'pending');assert.equal(row.lines.length,2);
 assert.equal((await pool.query('SELECT * FROM order_advances')).rowCount,1);assert.match(lastRich(s).text,/₹10/);assert.ok(lastRich(s).parts?.[0].cards[0].kind==='instruction');
 assert.equal((await turn('yes')).requests.length,1);assert.equal((await pool.query('SELECT * FROM order_advances')).rowCount,1);
}));

test('wholly unpriced estimates show no fabricated zero total and preserve every requested line',()=>fixture(async({turn})=>{
 let s=await turn('add one unicorn bolt');s=await turn({id:randomUUID(),type:'review_partial',expectedVersion:s.conversation.version});
 const text=lastRich(s).text;assert.match(text,/Prices are not confirmed/);assert.doesNotMatch(text,/₹0/);assert.equal(s.conversation.pending.excludedLineIds.length,1);
}));

test('payment claim remains unverified; owner verification is idempotent and bank references cannot be reused',()=>fixture(async({pool,provider,turn})=>{
 await submitKnown(turn);const order=(await pool.query('SELECT * FROM order_requests')).rows[0],calls=provider.calls;
 await turn('I paid');assert.equal(provider.calls,calls);assert.equal((await pool.query('SELECT state FROM order_advances')).rows[0].state,'claimed');
 const verify=()=>withConversation(pool,simulatorContext,c=>verifyManualAdvance(c,simulatorContext.storeId,order.id,'owner@test.invalid','BANK-12345678'));
 assert.equal((await verify()).replayed,false);assert.equal((await verify()).replayed,true);
 assert.equal((await pool.query('SELECT acceptance,fulfillment,payment FROM order_requests')).rows[0].acceptance,'awaiting_approval');
 await assert.rejects(withConversation(pool,simulatorContext,c=>verifyManualAdvance(c,simulatorContext.storeId,order.id,'owner@test.invalid','OTHER-123456')),/another reference/);
}));

test('after-order acknowledgements have an explicit silent outcome and never disable later status replies',()=>fixture(async({pool,provider,turn})=>{
 await submitKnown(turn);const count=Number((await pool.query("SELECT count(*) FROM messages WHERE direction='outbound'")).rows[0].count),calls=provider.calls;
 await turn('thanks 👍');assert.equal(Number((await pool.query("SELECT count(*) FROM messages WHERE direction='outbound'")).rows[0].count),count);assert.equal(provider.calls,calls);
 assert.equal((await pool.query("SELECT reply_decision,status FROM messages WHERE direction='inbound' ORDER BY sequence DESC LIMIT 1")).rows[0].reply_decision,'acknowledgement_only');
 const order=(await pool.query('SELECT id FROM order_requests')).rows[0];await withConversation(pool,simulatorContext,c=>verifyManualAdvance(c,simulatorContext.storeId,order.id,'owner@test.invalid','STATUS-12345678'));
 const s=await turn('status');assert.match(lastRich(s).text,/waiting for the shop/);assert.equal((await pool.query('SELECT operator_mode FROM conversations WHERE id=$1',[simulatorContext.conversationId])).rows[0].operator_mode,'assistant');
}));

test('thanks plus an edit stages an amendment; customer approval and owner decision preserve the original snapshot',()=>fixture(async({pool,inbox,provider,turn})=>{
 await submitKnown(turn);const original=(await pool.query('SELECT * FROM order_requests')).rows[0],line=original.lines[0];
 provider.next={operations:[{kind:'increment_quantity',reference:line.id,delta:2,supportingPhrase:'add two more tape rolls'}],next:'review'};
 let s=await turn('Thanks, add two more tape rolls');let proposal=(await pool.query('SELECT * FROM order_amendments')).rows[0];
 assert.equal(proposal.state,'proposed');assert.equal(proposal.proposed_lines[0].quantity,4);assert.deepEqual((await pool.query('SELECT lines FROM order_requests')).rows[0].lines,original.lines);
 const button=lastRich(s).buttons!.find(b=>b.event.type==='confirm_amendment')!;
 s=await turn('yes');proposal=(await pool.query('SELECT * FROM order_amendments')).rows[0];assert.equal(proposal.state,'owner_pending');
 const outboundBefore=Number((await pool.query("SELECT count(*) FROM messages WHERE direction='outbound'")).rows[0].count);await turn('yes');assert.equal(Number((await pool.query("SELECT count(*) FROM messages WHERE direction='outbound'")).rows[0].count),outboundBefore);
 await withConversation(pool,simulatorContext,c=>decideAmendment(c,simulatorContext.storeId,proposal.id,'owner@test.invalid','accepted'));
 const request=(await pool.query('SELECT * FROM order_requests')).rows[0];assert.deepEqual(request.lines,original.lines);assert.equal(request.effective_lines[0].quantity,4);assert.equal(request.effective_revision,2);
 assert.equal((await pool.query('SELECT count(*) FROM order_advances')).rows[0].count,'1');assert.equal((await inbox.snapshot()).conversation.lastRequestId,original.id);
}));

test('forged amendment approval and stale versions cannot reach the owner queue',()=>fixture(async({pool,provider,turn})=>{
 await submitKnown(turn);const line=(await pool.query('SELECT lines FROM order_requests')).rows[0].lines[0];
 provider.next={operations:[{kind:'set_quantity',reference:line.id,quantity:3}],next:'review'};
 let s=await turn('change tape quantity to three');const amendment=(await pool.query('SELECT * FROM order_amendments')).rows[0];
 await turn({id:randomUUID(),type:'confirm_amendment',amendmentId:amendment.id,expectedVersion:s.conversation.version});assert.equal((await pool.query('SELECT state FROM order_amendments')).rows[0].state,'proposed');
 assert.equal((await pool.query('SELECT lines FROM order_requests')).rows[0].lines[0].quantity,2);
}));

test('owner quotes an unknown line; only the customer’s bound final-bill approval sets the effective price',()=>fixture(async({pool,turn})=>{
 let s=await turn('I need two PTFE tape rolls and one unicorn bolt');s=await turn({id:randomUUID(),type:'review_partial',expectedVersion:s.conversation.version});await turn('yes');
 const original=(await pool.query('SELECT * FROM order_requests')).rows[0],id=randomUUID();
 const result=await withConversation(pool,simulatorContext,c=>offerOrderQuote(c,simulatorContext.storeId,original.id,'owner@test.invalid',{id,expectedRevision:1,lines:original.lines.map((l:any)=>({id:l.id,name:l.name,quantity:l.quantity??1,unit:l.unit??'piece',pricePaise:l.sku?l.pricePaise:2500}))}));assert.equal(result.replayed,false);
 const client=await pool.connect();let rich:RichReply;try{rich=await orderQuoteReply(client,simulatorContext.storeId,id);}finally{client.release();}
 assert.match(rich!.text,/₹95/);assert.equal((await pool.query('SELECT estimate_complete FROM order_requests')).rows[0].estimate_complete,false);
 await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload) VALUES($1,$2,'outbound',$3,'sent',$4::jsonb)",[randomUUID(),simulatorContext.conversationId,rich!.text,JSON.stringify(rich!)]);
 await turn(rich!.buttons![0].event);
 const row=(await pool.query('SELECT * FROM order_requests')).rows[0];assert.equal(row.estimate_complete,true);assert.equal(Number(row.effective_total_paise),9500);assert.deepEqual(row.lines,original.lines);assert.equal(row.effective_lines[1].pricePaise,2500);
}));

test('a long estimate is paginated without dropping prices, exclusions, or final consent',()=>{
 const text=Array.from({length:45},(_,i)=>`${i+1}. Product ${i} — 2 pieces\n   ₹45 / piece\n   This item: ₹90`).join('\n\n')+'\n\nKnown-price items only: ₹4050\n\nMissing pump price is excluded.\n\nIs this list correct?';
 const rich=textPresentation(text,[{label:'List is correct',event:{id:randomUUID(),type:'confirm',reviewId:randomUUID()}}],'bill');
 assert.equal(rich.parts!.map(p=>p.text).join('\n\n'),text);assert.ok(rich.parts!.length>1);
 for(const part of rich.parts!){const rendered=renderWhatsAppReply({...rich,text:part.text,parts:[part]},randomUUID(),'bot.example.com');assert.ok(rendered.payload);}
 assert.equal(rich.parts!.slice(0,-1).flatMap(p=>p.buttons??[]).length,0);assert.equal(rich.parts!.at(-1)!.buttons!.length,1);
});

test('UPI QR uses the supplied VPA, INR and exactly ₹10; a phone-only destination is rejected',async()=>{
 const uri=upiUri(advance,'SAGO-12345'),parsed=new URL(uri);assert.equal(parsed.searchParams.get('pa'),advance.vpa);assert.equal(parsed.searchParams.get('am'),'10.00');assert.equal(parsed.searchParams.get('cu'),'INR');
 assert.throws(()=>upiUri({vpa:'8939237308',name:'Shop'},'SAGO-1'),/recipient/);assert.throws(()=>readUpiAdvance({UPI_ADVANCE_ENABLED:'true',UPI_PAYEE_VPA:'8939237308',UPI_PAYEE_NAME:'Shop'},'bot.example.com'),/VPA/);
 const directory=mkdtempSync('/tmp/shopbot-qr-'),path=await qrImage(uri,directory),bytes=readFileSync(directory+'/'+path.split('/').at(-1));assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(await qrImage(uri,directory),path);
});

test('Tamil copy preserves section spacing and ordinary English shop terms',()=>{
 const text=customerCopy('welcome','ta');assert.match(text,/வேணும்/);assert.match(text,/Voice/);assert.ok(text.includes('\n\n'));assert.doesNotMatch(text,/விவரிக்கவும்|கோரிக்கை/);
 assert.equal(acknowledgementOnly('thanks, add two more'),false);assert.equal(acknowledgementOnly('சரி 👍'),true);
});

test('welcome voice is queued once per conversation and every later greeting can still receive text',()=>fixture(async({pool,turn})=>{
 await turn('hello');await turn('hello');
 const rows=(await pool.query("SELECT payload FROM messages WHERE direction='outbound'")).rows;
 assert.equal(rows.filter(r=>r.payload.audio).length,1);assert.equal(rows.filter(r=>!r.payload.audio).length,2);
},{visualOrdering:true,welcomeAudio:'/welcome-audio/'+'a'.repeat(64)+'.ogg'}));


test('a late advance is recorded for refund without reopening a cancelled order',()=>fixture(async({pool,turn})=>{
 await submitKnown(turn);const order=(await pool.query('SELECT * FROM order_requests')).rows[0];
 await pool.query("UPDATE order_requests SET fulfillment='cancelled',acceptance='rejected' WHERE id=$1",[order.id]);
 const result=await withConversation(pool,simulatorContext,c=>verifyManualAdvance(c,simulatorContext.storeId,order.id,'owner@test.invalid','LATE-12345678'));
 assert.equal(result.refundRequired,true);assert.equal((await pool.query('SELECT state FROM order_advances')).rows[0].state,'refund_pending');
 await turn('I paid');assert.match(lastRich(await turn('I paid')).text,/closed order/);
 await withConversation(pool,simulatorContext,c=>verifyManualRefund(c,simulatorContext.storeId,order.id,'REFUND-123456'));
 assert.equal((await pool.query('SELECT state FROM order_advances')).rows[0].state,'refunded');
 assert.equal((await pool.query('SELECT fulfillment FROM order_requests')).rows[0].fulfillment,'cancelled');
}));

test('an unresolved amendment can receive a shop quote and a current typed approval',()=>fixture(async({pool,provider,turn})=>{
 await submitKnown(turn);const original=(await pool.query('SELECT * FROM order_requests')).rows[0];
 provider.next={operations:[{kind:'add_item',query:'unicorn bolt',quantity:1}],next:'review'};
 let s=await turn('add one unicorn bolt');s=await turn('yes');
 const amendment=(await pool.query('SELECT * FROM order_amendments')).rows[0];assert.equal(amendment.state,'owner_pending');assert.equal(amendment.estimate_complete,false);
 const id=randomUUID();await withConversation(pool,simulatorContext,c=>offerOrderQuote(c,simulatorContext.storeId,original.id,'owner@test.invalid',{id,amendmentId:amendment.id,expectedRevision:1,lines:amendment.proposed_lines.map((l:any)=>({id:l.id,name:l.name,quantity:l.quantity,unit:l.unit??'piece',pricePaise:l.pricePaise??2500}))}));
 const c=await pool.connect();let rich:RichReply;try{rich=await orderQuoteReply(c,simulatorContext.storeId,id);}finally{c.release();}
 await pool.query("INSERT INTO messages(id,conversation_id,direction,text,status,payload) VALUES($1,$2,'outbound',$3,'sent',$4::jsonb)",[randomUUID(),simulatorContext.conversationId,rich!.text,JSON.stringify(rich!)]);
 await turn('yes');assert.equal((await pool.query('SELECT state FROM order_amendments')).rows[0].state,'accepted');
 const order=(await pool.query('SELECT * FROM order_requests')).rows[0];assert.equal(order.effective_lines.length,2);assert.deepEqual(order.lines,original.lines);assert.equal(Number(order.effective_total_paise),9500);
}));

test('an amendment whose catalog price changed cannot be accepted at a stale price',()=>fixture(async({pool,provider,turn})=>{
 await submitKnown(turn);const line=(await pool.query('SELECT lines FROM order_requests')).rows[0].lines[0];
 provider.next={operations:[{kind:'set_quantity',reference:line.id,quantity:3}],next:'review'};
 await turn('change tape quantity to three');await turn('yes');const amendment=(await pool.query('SELECT * FROM order_amendments')).rows[0];
 await pool.query('UPDATE products SET price_paise=price_paise+100,version=version+1 WHERE store_id=$1 AND sku=$2',[simulatorContext.storeId,line.sku]);
 await assert.rejects(withConversation(pool,simulatorContext,c=>decideAmendment(c,simulatorContext.storeId,amendment.id,'owner@test.invalid','accepted')),/Catalog price/);
 assert.equal((await pool.query('SELECT effective_revision FROM order_requests')).rows[0].effective_revision,1);
}));


test('deployment environment wires the partial estimate, exact UPI recipient and fixed welcome recording',()=>{
 const config=readWhatsAppConfig({WHATSAPP_ENABLED:'true',WHATSAPP_HOSTNAME:'bot.example.com',WHATSAPP_STORE_ID:simulatorContext.storeId,WHATSAPP_APP_ID:'12345678',WHATSAPP_WABA_ID:'12345678',WHATSAPP_PHONE_ID:'12345678',WHATSAPP_APP_SECRET:'offline-fixture-secret',WHATSAPP_VERIFY_TOKEN:'offline-fixture-token',WHATSAPP_ACCESS_TOKEN:'offline-only-access-token-never-used-12345',WHATSAPP_TEST_RECIPIENTS:'919000000001',WHATSAPP_PARTIAL_REVIEWS_ENABLED:'true',UPI_ADVANCE_ENABLED:'true',UPI_PAYEE_VPA:advance.vpa,UPI_PAYEE_NAME:advance.name,WHATSAPP_WELCOME_AUDIO_HASH:'b'.repeat(64)});
 assert.equal(config?.partialReviews,true);assert.equal(config?.advance?.vpa,advance.vpa);assert.equal(config?.welcomeAudio,'/welcome-audio/'+'b'.repeat(64)+'.ogg');
});


test('a completed order cannot accumulate an amendment the shop can never accept',()=>fixture(async({pool,provider,turn})=>{
 await submitKnown(turn);const request=(await pool.query('SELECT * FROM order_requests')).rows[0];
 await pool.query("UPDATE order_requests SET acceptance='accepted',fulfillment='collected' WHERE id=$1",[request.id]);
 provider.next={operations:[{kind:'set_quantity',reference:request.lines[0].id,quantity:3}],next:'review'};
 const snapshot=await turn('change tape quantity to three');assert.match(lastRich(snapshot).text,/closed/);assert.equal((await pool.query('SELECT id FROM order_amendments')).rowCount,0);assert.deepEqual((await pool.query('SELECT lines FROM order_requests')).rows[0].lines,request.lines);
}));


test('fifty unknown long product names remain fully visible across estimate pages',()=>{
 const lines=Array.from({length:50},(_,i)=>({id:randomUUID(),name:`Unknown requested item ${i} `+'long hardware description '.repeat(6),quantity:1,resolution:'unavailable' as const}));
 const text=estimateText({replyLanguage:'en',draft:lines} as any,lines,true,true),rich=textPresentation(text,[{label:'List is correct',event:{id:randomUUID(),type:'confirm',reviewId:randomUUID()}}],'bill');
 assert.equal(rich.parts!.map(part=>part.text).join('\n\n'),text);assert.match(text,/50 items still need checking/);assert.doesNotMatch(text,/₹0/);
 for(const line of lines)assert.ok(text.includes(line.name));
 for(const [index,part] of rich.parts!.entries()){assert.ok(Array.from(part.text).length<=(index===rich.parts!.length-1?950:3900));assert.equal(part.buttons?.length??0,index===rich.parts!.length-1?1:0);}
});
