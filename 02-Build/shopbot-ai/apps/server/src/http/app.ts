import type {Interpreter} from '../adapters/interpreter.js';
import {fixtureStore} from '../../../../profiles/hardware.js';
import {registerNativeTest} from './native-test.js';
import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { Pool } from 'pg';
import { eventSchema } from '../../../../packages/contracts/index.js';
import type { Config } from '../config.js';
import { toolDefinitions } from '../services/tools.js';
import { SimulatorService } from '../services/simulator.js';
import {registerOwner} from './owner.js';
import type {AccessVerifier} from './access.js';
import {WhatsAppChannel} from '../services/whatsapp-channel.js';
import {registerWhatsApp,whatsappPath} from './whatsapp.js';
import {renderPrivacy} from './privacy.js';

export async function createApp(config: Config, pool: Pool, nativeTest?:Interpreter,nativeStore=fixtureStore,ownerVerifier?:AccessVerifier,channel?:WhatsAppChannel) {
  if(config.owner&&(config.mode!=='mock'||nativeTest))throw new Error('Hosted owner preview requires mock mode with local AI disabled');
  if(config.owner&&!['127.0.0.1','::1','localhost'].includes(config.host))throw new Error('Owner preview must listen on loopback');
  if(config.whatsapp&&(!['127.0.0.1','::1','localhost'].includes(config.host)||nativeTest||config.mode!=='mock'))throw new Error('WhatsApp test connection requires loopback with local test endpoints disabled');
  const app = Fastify({ logger: {serializers:{req:(req:any)=>({method:req.method,url:req.url?.split('?')[0]})}}, bodyLimit: 16000 });
  if(config.whatsapp){
    const hookPath=config.whatsapp.path??whatsappPath;
    app.addHook('onRequest',async(req,reply)=>{
      const publicPrivacy=config.whatsapp!.privacyPublished&&req.url.split('?')[0]==='/privacy'&&req.method==='GET';
      if(req.headers.host===config.whatsapp!.hostname&&!publicPrivacy&& (req.url.split('?')[0]!==hookPath||!['GET','POST'].includes(req.method)))return reply.code(404).send({error:'Not found'});
      if(req.url.split('?')[0]===hookPath&&req.headers.host!==config.whatsapp!.hostname)return reply.code(404).send({error:'Not found'});
    });
  }
  await registerOwner(app,pool,config,ownerVerifier);
  if(config.whatsapp)await registerWhatsApp(app,channel??new WhatsAppChannel(pool,config.whatsapp));
  const privacyPolicy="default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  if(config.whatsapp?.privacyPublished)app.get('/privacy',async(_req,reply)=>reply.header('Cache-Control','no-store').header('Content-Security-Policy',privacyPolicy).type('text/html').send(renderPrivacy(config.whatsapp?.aiEnabled)));
  if(config.owner)app.get('/api/owner/privacy-draft',async(_req,reply)=>reply.header('Content-Security-Policy',privacyPolicy).type('text/html').send(renderPrivacy(config.whatsapp?.aiEnabled)));
  app.get('/health/live', async () => ({ status: 'alive' }));
  app.get('/health/ready', async (_request, reply) => {
    try { await pool.query('SELECT 1'); return { status: 'ready', mode: config.mode }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  if (config.mode === 'mock') {
    if(nativeTest) await registerNativeTest(app,pool,nativeTest,nativeStore,config.whatsAppPlanningPaise??50);
    const service = new SimulatorService(pool);
    // The simulator is intentionally unauthenticated, mock-only, and exposed on loopback by Compose.
    app.get('/api/simulator/tools', async () => ({tools:toolDefinitions, provider:'mock-text-v1', liveInference:false}));
    app.get('/api/simulator', async () => service.snapshot());
    app.post('/api/simulator/events', async (request, reply) => {
      const parsed = eventSchema.safeParse(request.body);
      if (!parsed.success||parsed.data.type==='voice') return reply.code(400).send({ error: 'Invalid simulator event', details: parsed.success?undefined:parsed.error.issues });
      return reply.code(202).send(await service.ingest(parsed.data));
    });
    const dashboard = resolve('dist/dashboard');
    if (existsSync(dashboard)) {
      await app.register(staticPlugin, { root: dashboard });
      if(config.owner){app.get('/owner',async(_request,reply)=>reply.sendFile('index.html'));app.get('/',async(_request,reply)=>reply.redirect('/owner'));}
      if(nativeTest&&existsSync('resources/catalog/ksmc-demo/images')) await app.register(staticPlugin,{root:resolve('resources/catalog/ksmc-demo/images'),prefix:'/demo-images/',decorateReply:false});
      if(nativeTest) app.get('/native-test',async(_request,reply)=>reply.sendFile('index.html'));
    }
  }
  return app;
}
