import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{try{return new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}catch{return false;}});
export const messagingRateSchema=z.object({
  currency:z.literal('INR'),market:z.string().regex(/^[A-Z]{2}$/),recipientPrefix:z.string().regex(/^\d{1,4}$/),
  effectiveFrom:date,verifiedOn:date,validUntil:date,source:z.url().startsWith('https://'),
  rates:z.partialRecord(z.enum(['service','utility','marketing','authentication','authentication_international']),z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
}).strict().refine(r=>r.effectiveFrom<r.validUntil&&r.verifiedOn<r.validUntil&&Date.parse(r.validUntil)-Date.parse(r.verifiedOn)<=31*86400000,'Messaging rates need a bounded verification window');
export type MessagingRateCard=z.infer<typeof messagingRateSchema>;
export type PricingScope={storeId:string;phoneId:string;accountTimezone?:string;accountCurrency?:string;rateCard?:MessagingRateCard};
export function validAccountTimezone(value:string) {try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return true;}catch{return false;}}
export function billingMonth(seconds:number,timezone:string) {
  const parts=new Intl.DateTimeFormat('en',{timeZone:timezone,year:'numeric',month:'2-digit'}).formatToParts(new Date(seconds*1000));
  return parts.find(p=>p.type==='year')!.value+'-'+parts.find(p=>p.type==='month')!.value;
}
export function monthRange(month:string,timezone:string) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!validAccountTimezone(timezone))throw new Error('A valid month and configured Messaging account timezone are required.');
  const [year,m]=month.split('-').map(Number);
  const midnight=(year:number,month:number)=>{
    const target=Date.UTC(year,month,1),formatter=new Intl.DateTimeFormat('en',{timeZone:timezone,year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',hourCycle:'h23'});
    let value=target;
    for(let n=0;n<4;n++){
      const p=Object.fromEntries(formatter.formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
      const offset=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-value;
      const next=target-offset;if(next===value)return Math.floor(value/1000);value=next;
    }
    throw new Error('Could not determine the account month boundary.');
  };
  return {start:midnight(year,m-1),end:midnight(year,m)};
}
export function decimalMicrounits(value:string|number):bigint {
  const text=String(value);
  if(!/^\d+(?:\.\d{1,6})?$/.test(text))throw new Error('A nonnegative amount with at most six decimals is required.');
  const [whole,fraction='']=text.split('.');
  const result=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
  if(result>9223372036854775807n)throw new Error('Messaging amount exceeds the ledger range.');
  return result;
}
export function rateMicrounits(scope:PricingScope,recipient:string,category:string,seconds:number) {
  const rate=scope.rateCard;
  if(!rate||!messagingRateSchema.safeParse(rate).success||Date.parse(rate.verifiedOn)>Date.now()||!recipient.startsWith(rate.recipientPrefix)||seconds<Date.parse(rate.effectiveFrom)/1000||seconds>=Date.parse(rate.validUntil)/1000)return null;
  const amount=rate.rates[category as keyof typeof rate.rates];
  return amount===undefined?null:amount;
}
const pricingSchema=z.object({billable:z.boolean(),pricing_model:z.literal('PMP'),type:z.string().min(1).max(80),category:z.string().min(1).max(40)});
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Called only after signature, WABA and phone verification. Record all senders
// on that phone, even when the recipient is outside the chatbot's test list.
export async function recordDeliveryPricing(client:PoolClient,scope:PricingScope,event:{id:string;recipient_id:string;status:string;timestamp:string;pricing?:unknown}) {
  // One phone lock also serializes batches in different message orders.
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",['whatsapp-pricing:'+scope.phoneId]);
  const binding=(await client.query('SELECT store_id FROM whatsapp_channels WHERE phone_id=$1',[scope.phoneId])).rows[0];
  if(!binding||binding.store_id!==scope.storeId)throw new Error('Delivery pricing requires the bound shop and phone.');
  const raw=event.pricing??null,rawJson=JSON.stringify(raw),stored=Buffer.byteLength(rawJson)>8192?{invalid:'oversized_pricing'}:raw;
  await client.query(`INSERT INTO whatsapp_pricing_events(store_id,phone_id,provider_id,recipient,state,provider_timestamp,pricing,pricing_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT DO NOTHING`,[scope.storeId,scope.phoneId,event.id,event.recipient_id,event.status,Number(event.timestamp),JSON.stringify(stored),hash(raw)]);
  if(!['delivered','read'].includes(event.status))return;
  const events=(await client.query("SELECT recipient,state,provider_timestamp,pricing FROM whatsapp_pricing_events WHERE store_id=$1 AND phone_id=$2 AND provider_id=$3 AND state IN ('delivered','read') ORDER BY provider_timestamp",[scope.storeId,scope.phoneId,event.id])).rows;
  const delivered=events.filter(e=>e.state==='delivered'),seconds=Number((delivered[0]??events[0]).provider_timestamp);
  const facts=events.map(e=>pricingSchema.safeParse(e.pricing)).filter(p=>p.success).map(p=>p.data!);
  const distinct=new Set(facts.map(hash)),conflict=distinct.size>1||new Set(events.map(e=>e.recipient)).size>1;
  const p=facts[0],month=delivered.length&&scope.accountTimezone?billingMonth(seconds,scope.accountTimezone):null;
  const supported=p&&(p.billable?p.type==='regular':['free_customer_service','free_entry_point'].includes(p.type));
  const old=(await client.query('SELECT *,to_jsonb(c) AS snapshot FROM whatsapp_delivery_costs c WHERE store_id=$1 AND phone_id=$2 AND provider_id=$3 FOR UPDATE',[scope.storeId,scope.phoneId,event.id])).rows[0];
  const rateCard=old?.state==='estimated'?old.rate_snapshot:scope.rateCard;
  const currency=rateCard?.currency??scope.accountCurrency??null;
  const rate=p&&delivered.length?rateMicrounits({...scope,rateCard},event.recipient_id,p.category,seconds):null;
  const state=conflict?'conflicting':!supported?'unknown':!p.billable?'free':rate===null||rate===0?'unknown':'estimated';
  const amount=state==='free'?0:state==='estimated'?rate:null;
  if(old&&(old.state!==state||old.billing_month!==month||old.category!==(p?.category??null)||old.pricing_type!==(p?.type??null)||old.billable!==(p?.billable??null)||old.account_timezone!==(scope.accountTimezone??null)||old.currency!==currency||new Date(old.delivered_at).getTime()!==seconds*1000||String(old.estimated_microunits)!==String(amount)))await client.query('INSERT INTO whatsapp_delivery_cost_history(store_id,phone_id,provider_id,prior_snapshot) VALUES($1,$2,$3,$4::jsonb)',[scope.storeId,scope.phoneId,event.id,JSON.stringify(old.snapshot)]);
  await client.query(`INSERT INTO whatsapp_delivery_costs(store_id,phone_id,provider_id,recipient,delivered_at,account_timezone,billing_month,category,pricing_type,billable,pricing_model,currency,market,estimated_microunits,rate_snapshot,state)
    VALUES($1,$2,$3,$4,to_timestamp($5),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
    ON CONFLICT(phone_id,provider_id) DO UPDATE SET delivered_at=excluded.delivered_at,account_timezone=excluded.account_timezone,billing_month=excluded.billing_month,
      category=excluded.category,pricing_type=excluded.pricing_type,billable=excluded.billable,pricing_model=excluded.pricing_model,currency=excluded.currency,
      market=excluded.market,estimated_microunits=excluded.estimated_microunits,rate_snapshot=excluded.rate_snapshot,state=excluded.state`,
    [scope.storeId,scope.phoneId,event.id,event.recipient_id,seconds,scope.accountTimezone??null,month,p?.category??null,p?.type??null,p?.billable??null,p?.pricing_model??null,
      currency,rateCard&&event.recipient_id.startsWith(rateCard.recipientPrefix)?rateCard.market:null,amount,rateCard?JSON.stringify(rateCard):null,state]);
}

const analyticsPoint=z.object({start:z.number().int().nonnegative(),end:z.number().int().positive(),phone_number:z.string().regex(/^\d{7,15}$/),country:z.string().regex(/^[A-Z]{2}$/),pricing_category:z.string().max(80),pricing_type:z.string().max(80),volume:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),cost:z.union([z.string(),z.number()]).optional()}).passthrough();
const analyticsSchema=z.object({id:z.string(),pricing_analytics:z.object({data:z.array(z.object({data_points:z.array(analyticsPoint).max(5000)}).strict()).max(100)}).strict()}).strict();
export async function savePricingAnalytics(client:PoolClient,scope:PricingScope,options:{wabaId:string;businessPhone:string;currency:string;start:number;end:number},raw:unknown) {
  if(!scope.accountTimezone||!/^[A-Z]{3}$/.test(options.currency)||options.end<=options.start)throw new Error('Messaging account timezone, currency and date range are required.');
  if(raw&&typeof raw==='object'&&('paging' in raw||'pricing_analytics' in raw&&raw.pricing_analytics&&typeof raw.pricing_analytics==='object'&&'paging' in raw.pricing_analytics))throw new Error('Paginated pricing analytics require a complete bounded import.');
  const response=analyticsSchema.parse(raw);
  const binding=(await client.query('SELECT store_id,waba_id FROM whatsapp_channels WHERE phone_id=$1',[scope.phoneId])).rows[0];
  if(!binding||binding.store_id!==scope.storeId||binding.waba_id!==options.wabaId)throw new Error('Pricing analytics require the bound shop and Messaging account.');
  if(response.id!==options.wabaId)throw new Error('Pricing analytics belong to a different Messaging account.');
  const points=response.pricing_analytics.data.flatMap(d=>d.data_points),seen=new Set<string>();
  for(const point of points){
    if(point.phone_number!==options.businessPhone||point.start<options.start||point.end>options.end||point.start>=point.end)throw new Error('Pricing analytics exceed the requested phone or date range.');
    const key=JSON.stringify([point.start,point.end,point.phone_number,point.country,point.pricing_category,point.pricing_type,point.tier??null]);
    if(seen.has(key))throw new Error('Pricing analytics contain duplicate buckets.');seen.add(key);
    if(point.cost!==undefined)decimalMicrounits(point.cost);
  }
  await client.query(`INSERT INTO whatsapp_pricing_analytics(id,store_id,phone_id,account_timezone,currency,range_start,range_end,response_hash,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(phone_id,range_start,range_end,response_hash) DO NOTHING`,
    [randomUUID(),scope.storeId,scope.phoneId,scope.accountTimezone,options.currency,options.start,options.end,hash(response),JSON.stringify(response)]);
  return analyticsSummary(response,options.currency);
}

function analyticsSummary(response:z.infer<typeof analyticsSchema>,currency:string) {
  const points=response.pricing_analytics.data.flatMap(d=>d.data_points),delivered=points.reduce((n,p)=>n+BigInt(p.volume),0n);
  if(delivered>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Analytics delivery count exceeds the supported range.');
  return {points:points.length,delivered:Number(delivered),serviceDelivered:points.filter(p=>p.pricing_category==='SERVICE').reduce((n,p)=>n+p.volume,0),costMicrounits:points.every(p=>p.cost!==undefined)?points.reduce((n,p)=>n+decimalMicrounits(p.cost!),0n).toString():null,currency,source:'meta_pricing_analytics' as const,approximate:true as const};
}

export async function messagingCostSummary(client:PoolClient,scope:PricingScope) {
  const totals=(await client.query(`SELECT currency,count(*)::int AS delivered,count(*) FILTER(WHERE state IN ('unknown','conflicting'))::int AS unknown,
    count(*) FILTER(WHERE state='conflicting')::int AS conflicting,sum(estimated_microunits)::text AS estimated_microunits
    FROM whatsapp_delivery_costs WHERE store_id=$1 AND phone_id=$2 GROUP BY currency ORDER BY currency`,[scope.storeId,scope.phoneId])).rows;
  const month=scope.accountTimezone?billingMonth(Math.floor(Date.now()/1000),scope.accountTimezone):null;
  const observed=(await client.query(`SELECT count(*)::int AS service_delivered,count(*) FILTER(WHERE pricing_type='free_customer_service')::int AS free_tier_delivered
    FROM whatsapp_delivery_costs WHERE store_id=$1 AND phone_id=$2 AND billing_month=$3 AND category='service'`,[scope.storeId,scope.phoneId,month])).rows[0];
  const latest=(await client.query('SELECT currency,range_start,range_end,received_at,payload FROM whatsapp_pricing_analytics WHERE store_id=$1 AND phone_id=$2 ORDER BY received_at DESC LIMIT 1',[scope.storeId,scope.phoneId])).rows[0];
  let analytics=null;
  if(latest){
    const summary=analyticsSummary(analyticsSchema.parse(latest.payload),latest.currency);
    const local=(await client.query(`SELECT count(*)::int AS delivered,count(*) FILTER(WHERE state IN ('unknown','conflicting') OR state<>'free' AND currency IS DISTINCT FROM $5)::int AS unknown,
      sum(estimated_microunits) FILTER(WHERE currency=$5 OR state='free')::text AS known_microunits
      FROM whatsapp_delivery_costs WHERE store_id=$1 AND phone_id=$2 AND delivered_at>=to_timestamp($3) AND delivered_at<to_timestamp($4)`,[scope.storeId,scope.phoneId,latest.range_start,latest.range_end,latest.currency])).rows[0];
    analytics={...summary,received_at:latest.received_at,rangeStart:Number(latest.range_start),rangeEnd:Number(latest.range_end),observedDelivered:local.delivered,observedEstimateMicrounits:local.unknown?null:local.known_microunits,deliveryCountDifference:summary.delivered-local.delivered};
  }
  return {totals,month,accountTimezone:scope.accountTimezone??null,observedServiceDelivered:observed.service_delivered,observedFreeTierDelivered:observed.free_tier_delivered,monthlyServiceAllowance:1000,allowanceRemaining:null,analytics,estimateOnly:true};
}
