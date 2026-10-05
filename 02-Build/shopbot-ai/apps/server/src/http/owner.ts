import type {FastifyInstance} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import type {Config} from '../config.js';
import {createAccessVerifier,type AccessVerifier} from './access.js';

const uuid=z.uuid();
const revision=z.number().int().nonnegative();
export async function registerOwner(app:FastifyInstance,pool:Pool,config:Config,verify?:AccessVerifier){
  const owner=config.owner;
  if(!owner)return;
  verify??=createAccessVerifier(owner);
  if(!(await pool.query('SELECT id FROM stores WHERE id=$1',[owner.storeId])).rowCount)throw new Error('Owner store must already exist');
  app.addHook('onRequest',async(request,reply)=>{
    const host=request.headers.host?.toLowerCase();
    const local=host!==undefined&&/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    const publicOwner=host===owner.hostname;
    if(config.whatsapp?.privacyPublished&&host===config.whatsapp.hostname&&request.url.split('?')[0]==='/privacy'&&request.method==='GET')return;
    if(config.whatsapp&&host===config.whatsapp.hostname&&request.url.split('?')[0]===(config.whatsapp.path??'/webhooks/whatsapp')&&['GET','POST'].includes(request.method))return;
    if(!local&&!publicOwner)return reply.code(404).send({error:'Not found'});
    const path=request.url.split('?')[0];
    if(publicOwner&&!['/','/owner'].includes(path)&&!path.startsWith('/api/owner/')&&!path.startsWith('/assets/'))return reply.code(404).send({error:'Not found'});
    if(publicOwner||path.startsWith('/api/owner/')){
      reply.header('Cache-Control','private, no-store');
      reply.header('Referrer-Policy','same-origin');
      reply.header('X-Content-Type-Options','nosniff');
      reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      const token=request.headers['cf-access-jwt-assertion'];
      try{if(typeof token!=='string')throw new Error();await verify!(token);}
      catch{return reply.code(403).send({error:'Owner sign-in required'});}
      if(!['GET','HEAD'].includes(request.method)&&(request.headers.origin!=='https://'+owner.hostname||request.headers['x-shopbot-owner']!=='1'||!request.headers['content-type']?.startsWith('application/json')))return reply.code(403).send({error:'Invalid owner request origin'});
    }
  });
  async function write(action:string,target:string,run:(client:PoolClient)=>Promise<unknown>){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      // All controls and worker turns take store, then conversation, in this order.
      await client.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE',[owner!.storeId]);
      const result=await run(client);
      await client.query('INSERT INTO owner_audit(store_id,email,action,target_id,details) VALUES($1,$2,$3,$4,$5::jsonb)',[owner!.storeId,owner!.email,action,target,JSON.stringify(result)]);
      await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  app.get('/api/owner/snapshot',async()=>{
    const client=await pool.connect();
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const store=(await client.query('SELECT id,name,synthetic,operator_paused,operator_revision FROM stores WHERE id=$1',[owner.storeId])).rows[0];
      const conversations=(await client.query(`SELECT c.id,c.actor,c.operator_mode,c.operator_revision,c.reply_language,c.draft,c.version,
        (SELECT text FROM messages WHERE conversation_id=c.id ORDER BY sequence DESC LIMIT 1) AS last_text,
        (SELECT max(created_at) FROM messages WHERE conversation_id=c.id) AS updated_at,
        (SELECT count(*)::int FROM messages WHERE conversation_id=c.id AND status IN ('pending','processing')) AS pending
        FROM conversations c WHERE store_id=$1 ORDER BY updated_at DESC NULLS LAST,id LIMIT 100`,[owner.storeId])).rows;
      const requests=(await client.query('SELECT id,conversation_id,acceptance,payment,fulfillment,total_paise,lines,created_at FROM order_requests WHERE store_id=$1 ORDER BY created_at DESC LIMIT 100',[owner.storeId])).rows;
      const usage=(await client.query(`SELECT count(*)::int AS attempts,count(*) FILTER(WHERE state='failed')::int AS failures,count(*) FILTER(WHERE state='unknown')::int AS unknown,coalesce(sum(estimated_cost_microusd),0)::text AS estimated_microusd FROM provider_attempts WHERE store_id=$1`,[owner.storeId])).rows[0];
      const audit=(await client.query('SELECT action,target_id,details,created_at FROM owner_audit WHERE store_id=$1 ORDER BY sequence DESC LIMIT 20',[owner.storeId])).rows;
      const wa=config.whatsapp?(await client.query('SELECT verified_at,last_webhook_at,last_received_at,send_blocked,last_error FROM whatsapp_channels WHERE phone_id=$1 AND store_id=$2',[config.whatsapp.phoneId,owner.storeId])).rows[0]:undefined;
      const channel={whatsapp:!wa?'not_connected':wa.send_blocked?'attention_required':wa.last_received_at?'receiving':wa.verified_at||wa.last_webhook_at?'webhook_verified':'awaiting_verification',liveSending:Boolean(wa&&config.whatsapp?.sendEnabled&&!wa.send_blocked),processing:Boolean(config.whatsapp?.processEnabled),lastReceivedAt:wa?.last_webhook_at??null,error:wa?.last_error??null,testOnly:true};
      await client.query('COMMIT');
      return {store,conversations,requests,usage,audit,mode:config.mode,ownerEmail:owner.email,channel,inference:{enabled:!!(wa&&config.whatsapp?.aiEnabled&&config.whatsapp.processEnabled),paidEnabled:false},limits:{conversations:100,requests:100},generatedAt:new Date().toISOString()};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  });
  app.get<{Params:{id:string}}>('/api/owner/conversations/:id',async(request,reply)=>{
    if(!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Invalid conversation'});
    const messages=(await pool.query(`SELECT m.id,m.direction,m.text,m.status,m.created_at,(w.conversation_id IS NOT NULL) AS whatsapp FROM messages m JOIN conversations c ON c.id=m.conversation_id LEFT JOIN whatsapp_conversations w ON w.conversation_id=c.id WHERE c.store_id=$1 AND c.id=$2 ORDER BY m.sequence DESC LIMIT 200`,[owner.storeId,request.params.id])).rows.reverse();
    if(!(await pool.query('SELECT id FROM conversations WHERE store_id=$1 AND id=$2',[owner.storeId,request.params.id])).rowCount)return reply.code(404).send({error:'Conversation not found'});
    return {messages,limit:200};
  });
  app.post<{Params:{id:string}}>('/api/owner/conversations/:id/control',async(request,reply)=>{
    const input=z.object({mode:z.enum(['assistant','owner']),revision}).strict().safeParse(request.body);
    if(!input.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Invalid control'});
    return write('conversation_control',request.params.id,async client=>{
      const updated=await client.query('UPDATE conversations SET operator_mode=$1,operator_revision=operator_revision+1 WHERE store_id=$2 AND id=$3 AND operator_revision=$4 RETURNING operator_mode,operator_revision',[input.data.mode,owner.storeId,request.params.id,input.data.revision]);
      if(!updated.rowCount)throw Object.assign(new Error('Conversation changed or is unavailable. Refresh and try again.'),{statusCode:409});
      if(input.data.mode==='owner')await client.query("UPDATE messages SET status='pending',claim_token=NULL,lease_until=NULL WHERE conversation_id=$1 AND status='processing'",[request.params.id]);
      return updated.rows[0];
    });
  });
  app.post('/api/owner/pause',async(request,reply)=>{
    const input=z.object({paused:z.boolean(),revision}).strict().safeParse(request.body);
    if(!input.success)return reply.code(400).send({error:'Invalid pause control'});
    return write('store_pause',owner.storeId,async client=>{
      const updated=await client.query('UPDATE stores SET operator_paused=$1,operator_revision=operator_revision+1 WHERE id=$2 AND operator_revision=$3 RETURNING operator_paused,operator_revision',[input.data.paused,owner.storeId,input.data.revision]);
      if(!updated.rowCount)throw Object.assign(new Error('Pause setting changed. Refresh and try again.'),{statusCode:409});
      if(input.data.paused)await client.query("UPDATE messages m SET status='pending',claim_token=NULL,lease_until=NULL FROM conversations c WHERE m.conversation_id=c.id AND c.store_id=$1 AND m.status='processing'",[owner.storeId]);
      return updated.rows[0];
    });
  });
  app.post<{Params:{id:string}}>('/api/owner/requests/:id/decision',async(request,reply)=>{
    const input=z.object({decision:z.enum(['accepted','rejected'])}).strict().safeParse(request.body);
    if(!input.success||!uuid.safeParse(request.params.id).success)return reply.code(400).send({error:'Invalid request decision'});
    return write('request_decision',request.params.id,async client=>{
      const updated=await client.query("UPDATE order_requests SET acceptance=$1 WHERE store_id=$2 AND id=$3 AND acceptance='awaiting_approval' RETURNING acceptance",[input.data.decision,owner.storeId,request.params.id]);
      if(!updated.rowCount)throw Object.assign(new Error('Request is already decided or unavailable. Refresh the list.'),{statusCode:409});
      return {acceptance:updated.rows[0].acceptance,customerNotification:'not_sent'};
    });
  });
}
