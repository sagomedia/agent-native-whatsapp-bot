import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {fixtureStore,fixtureConversation} from '../profiles/hardware.js';
import {createApp} from '../apps/server/src/http/app.js';
import {WhatsAppChannel,webhookSchema} from '../apps/server/src/services/whatsapp-channel.js';
import {readWhatsAppConfig,type WhatsAppConfig} from '../apps/server/src/services/whatsapp-config.js';
import {billingMonth,monthRange,decimalMicrounits,messagingCostSummary,recordDeliveryPricing,savePricingAnalytics,type MessagingRateCard} from '../apps/server/src/services/messaging-cost.js';
import {planWhatsAppReply} from '../apps/server/src/services/whatsapp-plan.js';
import {microCurrency} from '../apps/dashboard/src/owner-model.js';

// Synthetic fractional rate. This is NOT a claim about Meta's actual INR rate.
const rate:MessagingRateCard={currency:'INR',market:'IN',recipientPrefix:'91',effectiveFrom:'2026-10-01',verifiedOn:'2026-10-14',validUntil:'2026-11-01',source:'https://example.test/synthetic-rate-card',rates:{service:115000}};
const cfg:WhatsAppConfig={hostname:'shopbot-api.example.test',storeId:fixtureStore,appId:'123456789',wabaId:'987654321',phoneId:'123987654',appSecret:'synthetic-secret-only',verifyToken:'synthetic-verify-token',accessToken:'synthetic-access-token-not-a-real-credential',graphVersion:'v25.0',recipients:['919000000001'],processEnabled:false,sendEnabled:false,accountTimezone:'Asia/Kolkata',businessPhoneNumber:'919000000099',accountCurrency:'INR',pricingRateCard:rate};
const owner={hostname:'shopbot-preview.example.test',issuer:'https://shopbot-test.cloudflareaccess.com',audience:'test_application_audience_123',email:'owner@example.test',storeId:fixtureStore};
const scope={storeId:cfg.storeId,phoneId:cfg.phoneId,accountTimezone:cfg.accountTimezone,rateCard:rate};
const regular={billable:true,pricing_model:'PMP',type:'regular',category:'service'};
const free={...regular,billable:false,type:'free_customer_service'};
const seconds=Date.parse('2026-10-14T12:00:00Z')/1000;
const receipt=(id:string,status='delivered',pricing:unknown=regular,time=seconds,recipient=cfg.recipients[0])=>({id,status,pricing,timestamp:String(time),recipient_id:recipient});
const webhook=(statuses:ReturnType<typeof receipt>[])=>({object:'whatsapp_business_account',entry:[{id:cfg.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:cfg.phoneId},statuses}}]}]});

async function fixture(run:(pool:pg.Pool,channel:WhatsAppChannel)=>Promise<void>,fetcher?:typeof fetch,config=cfg){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='cost_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
 try{await setupDatabase(pool,'mock');const channel=new WhatsAppChannel(pool,config,fetcher);await channel.setup();await run(pool,channel);}
 finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
const receive=(channel:WhatsAppChannel,...events:ReturnType<typeof receipt>[])=>channel.receive(webhookSchema.parse(webhook(events)));
async function costs(pool:pg.Pool){return (await pool.query('SELECT * FROM whatsapp_delivery_costs ORDER BY provider_id')).rows;}
async function summary(pool:pg.Pool){const client=await pool.connect();try{return await messagingCostSummary(client,scope);}finally{client.release();}}
const options={wabaId:cfg.wabaId,businessPhone:cfg.businessPhoneNumber!,currency:'INR',start:seconds-60,end:seconds+60};
const point={start:options.start,end:options.end,phone_number:options.businessPhone,country:'IN',pricing_category:'SERVICE',pricing_type:'REGULAR',volume:3,cost:'0.345'};
const analytics=(points:unknown[]=[point])=>({id:cfg.wabaId,pricing_analytics:{data:[{data_points:points}]}});
async function save(pool:pg.Pool,raw:unknown){const client=await pool.connect();try{await client.query('BEGIN');const result=await savePricingAnalytics(client,scope,options,raw);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}

test('fractional INR is summed before display and budgets compare exact micro-INR',()=>{
 assert.equal(decimalMicrounits('0.115'),115000n);
 assert.equal(decimalMicrounits('9007199254.740993'),9007199254740993n);
 for(const bad of ['-1','0.0000001','1e4','NaN'])assert.throws(()=>decimalMicrounits(bad));
 const reply={parts:[{cards:[{}]},{cards:[{}]},{cards:[{}]}]} as any;
 const caps={serviceWindowOpen:true,catalogConnected:false,serviceRatePaise:0,serviceRateMicroInr:115000,allowMarketingCarousel:false,approvedCarousels:[],maxPaisePerTurn:100};
 assert.equal(planWhatsAppReply(reply,caps).estimatedMicroInr,345000);
 assert.equal(planWhatsAppReply(reply,{...caps,maxMicroInrPerTurn:340000}).format,'blocked');
 assert.equal(planWhatsAppReply(reply,{...caps,serviceRateMicroInr:undefined,serviceRatePaise:12}).estimatedPaise,36);
 assert.equal(microCurrency('345000','INR'),'₹0.345000');
 assert.match(microCurrency('9007199254740993','INR'),/\.740993$/);
 assert.equal(microCurrency(null,'INR'),'Amount unavailable');
});

test('account months use the configured timezone including DST and the exact month boundary',()=>{
 const before=Date.parse('2026-10-31T18:29:59Z')/1000;
 assert.equal(billingMonth(before,'Asia/Kolkata'),'2026-10');
 assert.equal(billingMonth(before+1,'Asia/Kolkata'),'2026-11');
 assert.deepEqual(monthRange('2026-10','Asia/Kolkata'),{start:Date.parse('2026-09-30T18:30:00Z')/1000,end:before+1});
 assert.deepEqual(monthRange('2026-03','America/New_York'),{start:Date.parse('2026-03-01T05:00:00Z')/1000,end:Date.parse('2026-04-01T04:00:00Z')/1000});
 assert.throws(()=>monthRange('2026-13','UTC'));
 assert.throws(()=>monthRange('2026-10','Unknown/Zone'));
});

test('signed status ingress rejects forgery and wrong accounts, but counts other senders on the bound phone',()=>fixture(async(pool,channel)=>{
 const app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/p2-cost-test',owner,whatsapp:cfg},pool,undefined,undefined,async()=>({email:owner.email,subject:'offline-owner'}),channel);
 try{
  const post=(raw:unknown,signature?:string)=>{const payload=JSON.stringify(raw);return app.inject({method:'POST',url:'/webhooks/whatsapp',payload,headers:{host:cfg.hostname,'content-type':'application/json','x-hub-signature-256':signature??'sha256='+createHmac('sha256',cfg.appSecret).update(payload).digest('hex')}});};
  assert.equal((await post(webhook([receipt('forged')]),'sha256='+'0'.repeat(64))).statusCode,403);
  const foreign=webhook([receipt('wrong-account')]);foreign.entry[0].id='other-waba';assert.equal((await post(foreign)).statusCode,200);
  const wrongPhone=webhook([receipt('wrong-phone')]);wrongPhone.entry[0].changes[0].value.metadata.phone_number_id='999999';await post(wrongPhone);
  assert.equal((await costs(pool)).length,0);
  const raw=webhook([receipt('other-sender','delivered',regular,seconds,'919000000003')]);
  const responses=await Promise.all([post(raw),post(raw)]);assert.ok(responses.every(r=>r.statusCode===200));
  assert.equal((await costs(pool)).length,1);assert.equal((await costs(pool))[0].estimated_microunits,'115000');
  assert.equal((await pool.query('SELECT * FROM whatsapp_pricing_events')).rowCount,1);
  assert.equal((await pool.query('SELECT * FROM whatsapp_conversations')).rowCount,0);
  assert.equal((await pool.query('SELECT * FROM whatsapp_outbox')).rowCount,0);
 }finally{await app.close();}
}));

test('sent/failed callbacks have no charge; duplicate delivery/read records settle one cost with a frozen rate',()=>fixture(async(pool,channel)=>{
 await receive(channel,receipt('one','sent'),receipt('failed','failed'));
 assert.equal((await costs(pool)).length,0);
 await receive(channel,receipt('one'),receipt('one','read',regular,seconds+1),receipt('one'));
 const changed=new WhatsAppChannel(pool,{...cfg,pricingRateCard:{...rate,rates:{service:999999}}});
 await receive(changed,receipt('one','read',regular,seconds+2));
 const rows=await costs(pool);assert.equal(rows.length,1);assert.equal(rows[0].estimated_microunits,'115000');
 assert.equal(rows[0].rate_snapshot.rates.service,115000);
 assert.equal((await pool.query('SELECT * FROM whatsapp_delivery_cost_history')).rowCount,0);
}));

test('conflicting provider facts remove the usable estimate and retain prior receipts and cost history',()=>fixture(async(pool,channel)=>{
 await receive(channel,receipt('conflict'));
 await receive(channel,receipt('conflict','read',free,seconds+1));
 const row=(await costs(pool))[0];assert.equal(row.state,'conflicting');assert.equal(row.estimated_microunits,null);
 assert.equal((await pool.query('SELECT prior_snapshot FROM whatsapp_delivery_cost_history')).rows[0].prior_snapshot.estimated_microunits,115000);
 assert.equal((await pool.query('SELECT * FROM whatsapp_pricing_events')).rowCount,2);
 const result=await summary(pool);assert.equal(result.totals[0].unknown,1);assert.equal(result.totals[0].estimated_microunits,null);
 await receive(channel,receipt('recipient-conflict'));
 await receive(channel,receipt('recipient-conflict','delivered',regular,seconds,'919000000003'));
 assert.equal((await costs(pool)).find(r=>r.provider_id==='recipient-conflict')!.state,'conflicting');
 assert.equal((await pool.query("SELECT * FROM whatsapp_pricing_events WHERE provider_id='recipient-conflict'")).rowCount,2);
}));

test('missing, unsupported and unpriced billable receipts remain unknown; signed free delivery is exactly zero',()=>fixture(async(pool,channel)=>{
 await receive(channel,receipt('missing','delivered',null),receipt('unknown-model','delivered',{...regular,pricing_model:'CBP'}),receipt('foreign-market','delivered',regular,seconds,'12025550123'),receipt('free','delivered',free),receipt('entry','delivered',{...free,type:'free_entry_point'}));
 const rows=await costs(pool);assert.equal(rows.filter(r=>r.state==='unknown'&&r.estimated_microunits===null).length,3);
 assert.equal(rows.filter(r=>r.state==='free'&&r.estimated_microunits==='0').length,2);
 const noRate=new WhatsAppChannel(pool,{...cfg,pricingRateCard:undefined});await receive(noRate,receipt('no-rate'));
 assert.equal((await costs(pool)).find(r=>r.provider_id==='no-rate')!.state,'unknown');
 await receive(noRate,receipt('free-no-rate','delivered',free));
 const freeWithoutRate=(await costs(pool)).find(r=>r.provider_id==='free-no-rate')!;
 assert.equal(freeWithoutRate.currency,'INR');assert.equal(freeWithoutRate.estimated_microunits,'0');assert.equal(freeWithoutRate.state,'free');
 await receive(channel,receipt('no-rate','read',regular,seconds+1));
 assert.equal((await costs(pool)).find(r=>r.provider_id==='no-rate')!.estimated_microunits,'115000');
 assert.equal((await pool.query('SELECT * FROM whatsapp_delivery_cost_history')).rowCount,1);
}));

test('read before delivered proves delivery without inventing its billing month or charging at read time',()=>fixture(async(pool,channel)=>{
 await receive(channel,receipt('late','read',regular,seconds+86400));
 let row=(await costs(pool))[0];assert.equal(row.billing_month,null);assert.equal(row.state,'unknown');
 await receive(channel,receipt('late','delivered',regular,seconds));
 row=(await costs(pool))[0];assert.equal(row.billing_month,'2026-10');assert.equal(row.estimated_microunits,'115000');
 assert.equal(new Date(row.delivered_at).getTime(),seconds*1000);
}));

test('the thousandth signed free delivery and next billable delivery never imply a complete local allowance',()=>fixture(async(pool,channel)=>{
 await pool.query(`INSERT INTO whatsapp_delivery_costs(store_id,phone_id,provider_id,recipient,delivered_at,account_timezone,billing_month,category,pricing_type,billable,pricing_model,currency,estimated_microunits,state)
   SELECT $1,$2,'synthetic-free-'||n,'919000000003',to_timestamp($3),'Asia/Kolkata','2026-10','service','free_customer_service',false,'PMP','INR',0,'free' FROM generate_series(1,999) n`,[cfg.storeId,cfg.phoneId,seconds]);
 await receive(channel,receipt('1000','delivered',free),receipt('1001'));
 const result=await summary(pool);assert.equal(result.observedServiceDelivered,1001);assert.equal(result.observedFreeTierDelivered,1000);
 assert.equal(result.allowanceRemaining,null);assert.equal(result.totals[0].estimated_microunits,'115000');
}));

test('pricing writes reject a different shop even when the provider message ID matches',()=>fixture(async(pool,channel)=>{
 await receive(channel,receipt('bound'));
 const other=randomUUID();await pool.query("INSERT INTO stores(id,name,synthetic) VALUES($1,'Other synthetic shop','true')",[other]);
 const client=await pool.connect();try{await client.query('BEGIN');await assert.rejects(recordDeliveryPricing(client,{...scope,storeId:other},receipt('bound','read',free)),/bound shop/);await client.query('ROLLBACK');}finally{client.release();}
 assert.equal((await costs(pool))[0].estimated_microunits,'115000');
}));

test('analytics reconciliation is idempotent, compares matching intervals and preserves unavailable costs',()=>fixture(async(pool,channel)=>{
 await receive(channel,receipt('local'));
 const first=await save(pool,analytics());assert.equal(first.costMicrounits,'345000');assert.equal(first.approximate,true);
 await save(pool,analytics());assert.equal((await pool.query('SELECT * FROM whatsapp_pricing_analytics')).rowCount,1);
 let result=await summary(pool);assert.equal(result.analytics!.deliveryCountDifference,2);assert.equal(result.analytics!.observedEstimateMicrounits,'115000');
 const {cost:_,...withoutCost}=point;await save(pool,analytics([withoutCost]));
 result=await summary(pool);assert.equal(result.analytics!.costMicrounits,null);
 for(const raw of [analytics([{...point,phone_number:'12025550123'}]),analytics([{...point,cost:'0.0000001'}]),analytics([point,point]),{...analytics(),paging:{}},{id:cfg.wabaId,pricing_analytics:{data:[{data_points:[point],paging:{next:'untrusted'}}]}}])await assert.rejects(save(pool,raw));
 assert.equal((await pool.query('SELECT * FROM whatsapp_pricing_analytics')).rowCount,2);
}));

test('owner analytics refresh is scoped, authenticated, audited and read-only at the provider',async()=>{
 let calls=0;
 await fixture(async(pool,channel)=>{
  const app=await createApp({mode:'mock',databaseUrl:process.env.DATABASE_URL!,port:3017,host:'127.0.0.1',mediaDir:'/tmp/p2-cost-owner',owner,whatsapp:cfg},pool,undefined,undefined,async(token)=>{if(token!=='synthetic-owner')throw new Error();return {email:owner.email,subject:'offline-owner'};},channel);
  try{
   const headers={host:owner.hostname,'cf-access-jwt-assertion':'synthetic-owner',origin:'https://'+owner.hostname,'x-shopbot-owner':'1','content-type':'application/json'};
   const post=(h=headers,payload:unknown={month:'2026-09'})=>app.inject({method:'POST',url:'/api/owner/pricing/refresh',headers:h,payload:JSON.stringify(payload)});
   assert.equal((await post({...headers,'cf-access-jwt-assertion':'forged'})).statusCode,403);
   assert.equal((await post({...headers,origin:'https://foreign.example'})).statusCode,403);
   assert.equal((await post(headers,{month:'2026-13'})).statusCode,400);assert.equal(calls,0);
   const response=await post();assert.equal(response.statusCode,200,response.body);assert.equal(calls,1);
   assert.equal((await pool.query("SELECT * FROM owner_audit WHERE action='pricing_analytics_refresh'")).rowCount,1);
   const snapshot=(await app.inject({url:'/api/owner/snapshot',headers})).json();assert.equal(snapshot.messaging.analytics.currency,'INR');assert.equal(snapshot.messaging.allowanceRemaining,null);assert.equal(snapshot.messaging.analyticsAvailable,true);assert.equal(snapshot.inference.rateHealth.validUntil,'2026-11-01');
  }finally{await app.close();}
 },async(url,init)=>{
  calls++;const u=new URL(String(url)),fields=u.searchParams.get('fields')!;
  assert.equal(u.pathname,'/v25.0/'+cfg.wabaId);assert.ok(fields.includes('phone_numbers('+cfg.businessPhoneNumber+')'));assert.ok(fields.includes('metric_types(COST,VOLUME)'));
  assert.equal(init?.method,undefined);assert.equal(init?.redirect,'error');assert.ok(init?.signal);assert.equal((init?.headers as any).authorization,'Bearer '+cfg.accessToken);
  const range=monthRange('2026-09',cfg.accountTimezone!);return new Response(JSON.stringify(analytics([{...point,...range}])));
 });
});

test('oversized analytics streams are cancelled and never replace prior snapshots',async()=>{
 let cancelled=false;
 await fixture(async(pool,channel)=>{
  await assert.rejects(channel.refreshPricingAnalytics('2026-09'),/too large/);
  assert.equal(cancelled,true);assert.equal((await pool.query('SELECT * FROM whatsapp_pricing_analytics')).rowCount,0);
 },async()=>new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(600000));},cancel(){cancelled=true;}})));
});

test('fractional rate configuration is explicit and cannot silently round or mix units',()=>{
 const env={WHATSAPP_ENABLED:'true',WHATSAPP_HOSTNAME:cfg.hostname,WHATSAPP_STORE_ID:cfg.storeId,WHATSAPP_APP_ID:cfg.appId,WHATSAPP_WABA_ID:cfg.wabaId,WHATSAPP_PHONE_ID:cfg.phoneId,WHATSAPP_APP_SECRET:cfg.appSecret,WHATSAPP_VERIFY_TOKEN:cfg.verifyToken,WHATSAPP_ACCESS_TOKEN:cfg.accessToken,WHATSAPP_TEST_RECIPIENTS:cfg.recipients.join(',')};
 assert.equal(readWhatsAppConfig(env)!.serviceRatePaise,undefined);
 assert.equal(readWhatsAppConfig({...env,WHATSAPP_SERVICE_RATE_MICRO_INR:'115000'})!.serviceRateMicroInr,115000);
 assert.throws(()=>readWhatsAppConfig({...env,WHATSAPP_SERVICE_RATE_MICRO_INR:'115000',WHATSAPP_SERVICE_RATE_PAISE:'12'}));
 assert.throws(()=>readWhatsAppConfig({...env,WHATSAPP_ACCOUNT_TIMEZONE:'Invalid/Zone'}));
 assert.throws(()=>readWhatsAppConfig({...env,WHATSAPP_RATE_CARD_JSON:JSON.stringify(rate),WHATSAPP_ACCOUNT_CURRENCY:'USD'}));
});
