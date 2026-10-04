import {imageUploadSchema,normalizeImage,loadImage} from '../services/image-media.js';
import {voiceUploadSchema,normalizeVoice,loadVoice} from '../services/voice-media.js';
import {randomUUID,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Pool} from 'pg';
import type {Interpreter} from '../adapters/interpreter.js';
import {ConversationRuntime} from '../runtime/conversation.js';
import {SimulatorService} from '../services/simulator.js';
import {fixtureStore} from '../../../../profiles/hardware.js';
import {eventSchema} from '../../../../packages/contracts/index.js';

// Explicit, free-only local test channel. No customer delivery or production identities.
export async function registerNativeTest(app:FastifyInstance,pool:Pool,provider:Interpreter,storeId=fixtureStore,planningPaise=50) {
  if(provider.mode!=='live'||!provider.freeQuota) throw new Error('Local AI testing requires the explicitly configured free-tier adapter.');
  const secret=randomBytes(32),sign=(id:string)=>createHmac('sha256',secret).update(id).digest('hex');
  const runtime=new ConversationRuntime(pool,provider,{allowFreeInference:true});
  async function channel(request:FastifyRequest) {
    const cookie=String(request.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('shopbot_test='))?.slice(13)??'';
    const [id='',signature='']=cookie.split('.');
    if(!/^[0-9a-f-]{36}$/.test(id)||!/^[0-9a-f]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(sign(id)))) return null;
    const row=(await pool.query('SELECT store_id FROM conversations WHERE id=$1 AND actor=$2 AND store_id=ANY($3::uuid[])',[id,'local-ai-test',[storeId,fixtureStore]])).rows[0];if(!row)return null;
    return new SimulatorService(pool,{storeId:row.store_id,conversationId:id,actor:'local-ai-test',role:'customer'});
  }
  await app.register(async routes=>{
    routes.addHook('onRequest',async(request,reply)=>{
      const host=String(request.headers.host??'');
      if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return reply.code(403).send({error:'AI testing is local-only.'});
      if(request.headers.origin&&request.headers.origin!==`http://${host}`) return reply.code(403).send({error:'Use the local test page.'});
      if(request.method==='POST'&&request.headers['x-shopbot-local-test']!=='1') return reply.code(403).send({error:'Use the local test page.'});
    });
    routes.post('/api/native-test/session',async(_request,reply)=>{
      const id=randomUUID();
      await pool.query("INSERT INTO conversations(id,store_id,actor,reply_language) VALUES($1,$2,$3,'ta')",[id,storeId,'local-ai-test']);
      reply.header('Set-Cookie',`shopbot_test=${id}.${sign(id)}; HttpOnly; SameSite=Strict; Path=/api/native-test`);
      return {created:true};
    });
    routes.get('/api/native-test',async(request,reply)=>{
      const inbox=await channel(request);if(!inbox)return reply.code(401).send({error:'Start a new AI test conversation.'});
      const snapshot=await inbox.snapshot();
      const a=(await pool.query('SELECT failure_code,validation_issues FROM provider_attempts WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 1',[inbox.context.conversationId])).rows[0];
      return {...snapshot,provider:provider.name,lastFailure:a?.failure_code??null,lastValidationIssues:a?.validation_issues??null,deliveryPreview:{outboundMessages:snapshot.messages.filter(m=>m.direction==='outbound').length,planningPaisePerMessage:planningPaise,estimateOnly:true,whatsAppConnected:false}};
    });
    routes.post('/api/native-test/image',{bodyLimit:2850000},async(request,reply)=>{
      const inbox=await channel(request);if(!inbox)return reply.code(401).send({error:'Start a new AI test conversation.'});
      if(!provider.supportsImages)return reply.code(503).send({error:'Image search is not configured. Describe the product instead.'});
      const parsed=imageUploadSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'Use a JPG, PNG or WebP photo under 2 MB and a caption up to 1000 characters.'});
      try{const media=await normalizeImage(parsed.data),saved=await inbox.ingest({id:parsed.data.id,type:'image',mediaId:parsed.data.id,caption:parsed.data.caption},undefined,media);await runtime.processNext(inbox.context);return saved;}catch(error){return reply.code((error as {statusCode?:number}).statusCode??400).send({error:error instanceof Error?error.message:'Photo could not be saved.'});}
    });
    routes.get('/api/native-test/image/:id',async(request,reply)=>{const inbox=await channel(request);if(!inbox)return reply.code(401).send({error:'Start a new AI test conversation.'});const id=(request.params as {id:string}).id;if(!/^[0-9a-f-]{36}$/.test(id))return reply.code(400).send({error:'Invalid image.'});try{const media=await loadImage(pool,inbox.context,id);return reply.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').type('image/jpeg').send(Buffer.from(media.data,'base64'));}catch{return reply.code(404).send({error:'Image not found.'});}});
    routes.post('/api/native-test/voice',{bodyLimit:1450000},async(request,reply)=>{
      const inbox=await channel(request);if(!inbox)return reply.code(401).send({error:'Start a new AI test conversation.'});
      if(!provider.supportsAudio)return reply.code(503).send({error:'Voice input is not configured. Please type your request.'});
      const parsed=voiceUploadSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'Use a supported voice recording under 1 MB.'});
      try{const media=await normalizeVoice(parsed.data),saved=await inbox.ingest({id:parsed.data.id,type:'voice',mediaId:parsed.data.id},media);await runtime.processNext(inbox.context);return saved;}catch(error){return reply.code((error as {statusCode?:number}).statusCode??400).send({error:error instanceof Error?error.message:'Voice note could not be saved.'});}
    });
    routes.get('/api/native-test/voice/:id',async(request,reply)=>{const inbox=await channel(request);if(!inbox)return reply.code(401).send({error:'Start a new AI test conversation.'});const id=(request.params as {id:string}).id;if(!/^[0-9a-f-]{36}$/.test(id))return reply.code(400).send({error:'Invalid recording.'});try{const media=await loadVoice(pool,inbox.context,id);return reply.header('Cache-Control','private, no-store').type('audio/wav').send(Buffer.from(media.data,'base64'));}catch{return reply.code(404).send({error:'Voice note not found.'});}});
    routes.post('/api/native-test/events',async(request,reply)=>{
      const inbox=await channel(request);if(!inbox)return reply.code(401).send({error:'Start a new AI test conversation.'});
      const parsed=eventSchema.safeParse(request.body);if(!parsed.success||(parsed.data.type==='voice'||parsed.data.type==='image'))return reply.code(400).send({error:'Invalid test message.'});
      const saved=await inbox.ingest(parsed.data);
      await runtime.processNext(inbox.context);
      return saved;
    });
  });
}
