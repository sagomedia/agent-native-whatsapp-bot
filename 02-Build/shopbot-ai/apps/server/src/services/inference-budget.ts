import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {Interpreter,ProviderResult} from '../adapters/interpreter.js';
import {ToolError,withConversation,type ActorContext} from './context.js';

export type RateCard={model:string;currency:'USD';verifiedOn:string;validUntil:string;source:string;inputMicrousdPerMillion:number;outputMicrousdPerMillion:number;inputTokenLimit:number;maxOutputTokens:number};
// Text-only, standard tier. Cached input is conservatively priced as uncached.
export const geminiTextRate:Readonly<RateCard>=Object.freeze({model:'gemini-3.5-flash-lite',currency:'USD',verifiedOn:'2026-10-02',validUntil:'2026-11-01',source:'https://ai.google.dev/gemini-api/docs/pricing',inputMicrousdPerMillion:300000,outputMicrousdPerMillion:2500000,inputTokenLimit:1048576,maxOutputTokens:4096});
export const freeQuotaLimits=Object.freeze({requestsPerMinute:10,inputTokensPerMinute:200000,requestsPerDay:100,minIntervalSeconds:6,reservedInputTokens:64000});
const integer=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
export function validateRateCard(rate:RateCard,now=Date.now()) {
  const verified=Date.parse(rate.verifiedOn+'T00:00:00Z'),expires=Date.parse(rate.validUntil+'T00:00:00Z');
  if(rate.currency!=='USD'||!rate.model||!integer(rate.inputMicrousdPerMillion)||!integer(rate.outputMicrousdPerMillion)||!integer(rate.inputTokenLimit)||!integer(rate.maxOutputTokens)||!rate.inputTokenLimit||!rate.maxOutputTokens||!Number.isFinite(verified)||!Number.isFinite(expires)||verified>now||expires<=now||expires-verified>31*86400000) throw new ToolError('Native model rates are missing, expired or invalid. Live interpretation is disabled.');
}
function cost(rate:RateCard,input:number,output:number) {
  const numerator=BigInt(input)*BigInt(rate.inputMicrousdPerMillion)+BigInt(output)*BigInt(rate.outputMicrousdPerMillion);
  const value=Number((numerator+999999n)/1000000n);
  if(!Number.isSafeInteger(value)) throw new ToolError('Inference amount exceeds supported accounting range.');
  return value;
}
export function worstCaseReservation(rate:RateCard) {return cost(rate,rate.inputTokenLimit,rate.maxOutputTokens);}
export function usageEstimate(rate:RateCard,result:ProviderResult):{microusd:number|null;violation:boolean} {
  const u=result.usage;
  if(result.responseModel!==rate.model||!u||!integer(u.promptTokenCount)||!integer(u.candidatesTokenCount)||!integer(u.totalTokenCount)) return {microusd:null,violation:false};
  if(Object.values(u).some(n=>!integer(n))||(u.toolUsePromptTokenCount??0)!==0) return {microusd:null,violation:true};
  const thinking=u.thoughtsTokenCount;
  const generated=u.totalTokenCount-u.promptTokenCount;
  if(generated<0||generated<u.candidatesTokenCount||(thinking!==undefined&&generated!==u.candidatesTokenCount+thinking)||(u.cachedContentTokenCount??0)>u.promptTokenCount) return {microusd:null,violation:true};
  // total - prompt includes hidden thinking even when its separate field is absent.
  const estimated=cost(rate,u.promptTokenCount,generated);
  return {microusd:estimated,violation:u.promptTokenCount>rate.inputTokenLimit||generated>rate.maxOutputTokens};
}
export async function initializeBudget(pool:Pool,ctx:ActorContext,limitMicrousd:number) {
  if(!integer(limitMicrousd)||limitMicrousd<=0) throw new ToolError('A positive explicitly configured USD inference budget is required.');
  await withConversation(pool,ctx,async client=>{
    await client.query('INSERT INTO inference_budgets(store_id,limit_microusd) VALUES($1,$2) ON CONFLICT DO NOTHING',[ctx.storeId,limitMicrousd]);
    const b=await client.query('SELECT limit_microusd FROM inference_budgets WHERE store_id=$1 FOR UPDATE',[ctx.storeId]);
    if(Number(b.rows[0].limit_microusd)!==limitMicrousd) throw new ToolError('Stored inference budget differs. Budget increases require an explicit administrative change; this run cannot reset it.');
  });
}
export async function reserveAttempt(client:PoolClient,ctx:ActorContext,messageId:string,sourceVersion:number,provider:Interpreter) {
  const previous=await client.query('SELECT * FROM provider_attempts WHERE message_id=$1 ORDER BY attempt DESC',[messageId]);
  const cached=previous.rows.find(p=>p.state==='succeeded'&&p.source_version===sourceVersion&&p.provider===provider.name&&p.provider_mode===provider.mode);
  if(cached) return {cached:cached.response,id:null,exhausted:false};
  await client.query("UPDATE provider_attempts SET state='unknown',billing_state=CASE WHEN billing_state='held' THEN 'unknown' ELSE billing_state END WHERE message_id=$1 AND state='started'",[messageId]);
  if((previous.rowCount??0)>=(provider.freeQuota?1:2)) return {cached:null,id:null,exhausted:true};
  let reserved=0,rate:RateCard|null=null;
  if(provider.freeQuota) {
    const {scope,model}=provider.freeQuota;
    await client.query('INSERT INTO free_inference_quota(scope,model) VALUES($1,$2) ON CONFLICT DO NOTHING',[scope,model]);
    const q=(await client.query('SELECT cooldown_until>now() AS cooling FROM free_inference_quota WHERE scope=$1 AND model=$2 FOR UPDATE',[scope,model])).rows[0];
    // Reserve 64K for pending/unknown usage; settled verified usage releases
    // that allowance. Serialize all stores on this project/model.
    const counts=(await client.query(`SELECT count(*) FILTER(WHERE created_at>now()-interval '1 minute') AS minute,
      count(*) FILTER(WHERE created_at>now()-($3*interval '1 second')) AS recent,
      COALESCE(sum(CASE WHEN settled_at IS NOT NULL AND response_model=$4
        AND jsonb_typeof(usage->'promptTokenCount')='number' AND usage->>'promptTokenCount' ~ '^[0-9]{1,5}$'
        THEN (usage->>'promptTokenCount')::integer ELSE $5 END)
        FILTER(WHERE created_at>now()-interval '1 minute'),0) AS input_tokens,
      count(*) FILTER(WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles') AS daily
      FROM provider_attempts WHERE quota_scope=$1 AND provider=$2`,[scope,provider.name,freeQuotaLimits.minIntervalSeconds,model,freeQuotaLimits.reservedInputTokens])).rows[0];
    if(q.cooling||Number(counts.minute)>=freeQuotaLimits.requestsPerMinute||Number(counts.recent)>0||Number(counts.daily)>=freeQuotaLimits.requestsPerDay||Number(counts.input_tokens)+freeQuotaLimits.reservedInputTokens>freeQuotaLimits.inputTokensPerMinute) return {cached:null,id:null,exhausted:false,denied:true};
  } else if(provider.mode==='live') {
    rate=provider.billing!;validateRateCard(rate);reserved=worstCaseReservation(rate);
    const b=(await client.query('SELECT * FROM inference_budgets WHERE store_id=$1 FOR UPDATE',[ctx.storeId])).rows[0];
    if(!b||b.blocked||BigInt(b.committed_microusd)+BigInt(b.held_microusd)+BigInt(reserved)>BigInt(b.limit_microusd)) return {cached:null,id:null,exhausted:false,denied:true};
    await client.query('UPDATE inference_budgets SET held_microusd=held_microusd+$2 WHERE store_id=$1',[ctx.storeId,reserved]);
  }
  const id=randomUUID();
  await client.query("INSERT INTO provider_attempts(id,store_id,conversation_id,actor,message_id,attempt,provider,source_version,state,provider_cost_paise,provider_mode,billing_state,rate_snapshot,reserved_microusd,quota_scope) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'started',$9,$10,$11,$12::jsonb,$13,$14)",[id,ctx.storeId,ctx.conversationId,ctx.actor,messageId,(previous.rowCount??0)+1,provider.name,sourceVersion,provider.mode==='mock'?0:null,provider.mode,provider.freeQuota?'free_declared':rate?'held':'not_billable',JSON.stringify(rate),reserved,provider.freeQuota?.scope??null]);
  return {cached:null,id,exhausted:false};
}
export async function settleAttempt(pool:Pool,ctx:ActorContext,id:string,result?:ProviderResult) {
  return withConversation(pool,ctx,async client=>{
    // Consistent lock order: conversation -> store budget -> attempt.
    await client.query('SELECT store_id FROM inference_budgets WHERE store_id=$1 FOR UPDATE',[ctx.storeId]);
    const a=(await client.query('SELECT * FROM provider_attempts WHERE id=$1 AND store_id=$2 AND conversation_id=$3 AND actor=$4 FOR UPDATE',[id,ctx.storeId,ctx.conversationId,ctx.actor])).rows[0];
    if(!a) throw new ToolError('Inference attempt is not accessible.');
    if(a.quota_scope) {
      if(!result) return true;
      const quote=usageEstimate(geminiTextRate,result);
      const violation=quote.violation||(result.usage?.promptTokenCount??0)>64000;
      await client.query('UPDATE provider_attempts SET usage=$2::jsonb,response_model=$3,settled_at=now() WHERE id=$1',[id,JSON.stringify(result.usage),result.responseModel??null]);
      if(violation) await client.query("UPDATE free_inference_quota SET cooldown_until=now()+interval '1 day' WHERE scope=$1 AND model=$2",[a.quota_scope,geminiTextRate.model]);
      return !violation;
    }
    if(a.provider_mode==='mock') {if(result)await client.query('UPDATE provider_attempts SET usage=$2::jsonb WHERE id=$1',[id,JSON.stringify(result.usage)]);return true;}
    if(a.billing_state==='estimated') return true;
    const quote=result?usageEstimate(a.rate_snapshot,result):{microusd:null,violation:false};
    const estimated=quote.microusd;
    if(estimated!==null&&!quote.violation) {
      await client.query('UPDATE inference_budgets SET held_microusd=held_microusd-$2,committed_microusd=committed_microusd+$3 WHERE store_id=$1',[ctx.storeId,a.reserved_microusd,estimated]);
      await client.query("UPDATE provider_attempts SET billing_state='estimated',estimated_cost_microusd=$2,usage=$3::jsonb,response_model=$4,settled_at=now() WHERE id=$1",[id,estimated,JSON.stringify(result!.usage),result!.responseModel]);
    } else {
      // No automatic release after timeout/crash/missing usage. It may still be billed.
      await client.query("UPDATE provider_attempts SET billing_state='unknown',usage=$2::jsonb,response_model=$3 WHERE id=$1",[id,JSON.stringify(result?.usage??null),result?.responseModel??null]);
      if(quote.violation) await client.query('UPDATE inference_budgets SET blocked=true WHERE store_id=$1',[ctx.storeId]);
    }
    return !quote.violation;
  });
}

export async function coolDownFreeQuota(pool:Pool,quota:{scope:string;model:string}) {
  await pool.query("UPDATE free_inference_quota SET cooldown_until=GREATEST(COALESCE(cooldown_until,now()),now()+interval '15 minutes') WHERE scope=$1 AND model=$2",[quota.scope,quota.model]);
}
