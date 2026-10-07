import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {readConfig} from '../apps/server/src/config.js';
import {setupDatabase} from '../apps/server/src/db/migrate.js';
import {readNativeSettings,GoogleInterpreter} from '../apps/server/src/adapters/google-interpreter.js';
import {geminiTextRate,freeQuotaLimits,initializeBudget,worstCaseReservation} from '../apps/server/src/services/inference-budget.js';
import {ConversationRuntime} from '../apps/server/src/runtime/conversation.js';
import {SimulatorService} from '../apps/server/src/services/simulator.js';
import {hardwareFixtures} from '../profiles/hardware.js';
import type {ActorContext} from '../apps/server/src/services/context.js';

async function main() {
  let settings:ReturnType<typeof readNativeSettings>;
  try {settings=readNativeSettings();}
  catch(error) {console.error(error instanceof Error?error.message:'Invalid native configuration.');process.exitCode=1;return;}
  if(process.argv.includes('--preflight')) {
    console.log(JSON.stringify({configured:true,model:settings.model,tier:settings.freeQuota?'free':'paid',quota:settings.freeQuota?freeQuotaLimits:null,currency:'USD',budgetMicrousd:settings.budgetMicrousd,reservationMicrousd:settings.freeQuota?0:worstCaseReservation(geminiTextRate),rateVerifiedOn:geminiTextRate.verifiedOn,networkCalls:0}));return;
  }
  const config=readConfig();
  if(config.mode!=='mock') throw new Error('Native evaluation is restricted to the local synthetic database.');
  const pool=new pg.Pool({connectionString:config.databaseUrl});
  const ctx:ActorContext={storeId:'44444444-4444-4444-8444-444444444444',conversationId:randomUUID(),actor:'native-evaluation',role:'customer'};
  try {
    await setupDatabase(pool,'mock');
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO stores VALUES($1,'Native evaluation fixtures','true') ON CONFLICT DO NOTHING",[ctx.storeId]);
      const store=await client.query('SELECT name,synthetic FROM stores WHERE id=$1 FOR UPDATE',[ctx.storeId]);
      if(store.rows[0].synthetic!=='true'||store.rows[0].name!=='Native evaluation fixtures') throw new Error('Evaluation store identity conflict.');
      await client.query('INSERT INTO conversations(id,store_id,actor) VALUES($1,$2,$3)',[ctx.conversationId,ctx.storeId,ctx.actor]);
      for(const p of hardwareFixtures) await client.query('INSERT INTO products(store_id,sku,name,unit,price_paise,stock) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[ctx.storeId,p.sku,p.name,p.unit,p.pricePaise,p.stock]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    if(!settings.freeQuota) await initializeBudget(pool,ctx,settings.budgetMicrousd);
    const provider=new GoogleInterpreter(settings);
    if(process.argv.includes('--diagnose')) {
      const interpret=provider.interpret.bind(provider);
      provider.interpret=async(input,signal)=>{const result=await interpret(input,signal);console.log(JSON.stringify({syntheticDiagnostic:result.output,truncated:result.truncated}));return result;};
    }
    const runtime=new ConversationRuntime(pool,provider,{allowPaidInference:settings.allowPaidInference,allowFreeInference:!!settings.freeQuota});
    const inbox=new SimulatorService(pool,ctx);
    const messageId=randomUUID();
    await inbox.ingest({id:messageId,type:'text',text:'I need three half-inch PVC elbows, two PTFE tape rolls, one ten-inch adjustable wrench, four M4 screws and one claw hammer'});
    await runtime.processNext(ctx);
    const snapshot=await inbox.snapshot();
    const attempts=(await pool.query('SELECT state,billing_state,usage,estimated_cost_microusd,reserved_microusd,response_model,rate_snapshot,quota_scope,failure_code FROM provider_attempts WHERE message_id=$1',[messageId])).rows;
    const budget=(await pool.query('SELECT limit_microusd,committed_microusd,held_microusd,blocked FROM inference_budgets WHERE store_id=$1',[ctx.storeId])).rows[0];
    console.log(JSON.stringify({conversationId:ctx.conversationId,provider:`google:${settings.model}${settings.freeQuota?':free':''}`,tier:settings.freeQuota?'free':'paid',billingVerified:false,model:settings.model,lines:snapshot.conversation.draft,review:snapshot.conversation.pending,reply:snapshot.messages.at(-1)?.text,attempts,budget},null,2));
    if(snapshot.conversation.draft.length!==5||snapshot.conversation.pending?.kind!=='review'||snapshot.conversation.pending.totalPaise!==91400||attempts.length!==1||attempts[0].state!=='succeeded'||(settings.freeQuota?!attempts[0].quota_scope:attempts[0].billing_state!=='estimated')) process.exitCode=1;
  }finally{await pool.end();}
}
main().catch(()=>{console.error('Native evaluation could not complete. Check configuration, dated rates, database and retained budget holds. No credentials or provider errors are printed.');process.exitCode=1;});
