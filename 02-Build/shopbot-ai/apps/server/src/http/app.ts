import {readFile} from 'node:fs/promises';
import {readVisualImage} from '../services/visual-images.js';
import type {CatalogGenerator} from '../services/catalog-assistant.js';
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

export async function createApp(config: Config, pool: Pool, nativeTest?:Interpreter,nativeStore=fixtureStore,ownerVerifier?:AccessVerifier,channel?:WhatsAppChannel,catalogGenerator?:CatalogGenerator) {
  if(config.owner&&(config.mode!=='mock'||nativeTest))throw new Error('Hosted owner preview requires mock mode with local AI disabled');
  if(config.owner&&!['127.0.0.1','::1','localhost'].includes(config.host))throw new Error('Owner preview must listen on loopback');
  if(config.whatsapp&&(!['127.0.0.1','::1','localhost'].includes(config.host)||nativeTest||config.mode!=='mock'))throw new Error('WhatsApp test connection requires loopback with local test endpoints disabled');
  const app = Fastify({ logger: {serializers:{req:(req:any)=>({method:req.method,url:req.url?.split('?')[0]})}}, bodyLimit: 16000 });
  if(config.whatsapp){
    const hookPath=config.whatsapp.path??whatsappPath;
    app.addHook('onRequest',async(req,reply)=>{
      const publicCatalog=req.method==='GET'&&/^\/catalog-images\/(?:H\d{2}\.jpg|custom\/[a-f0-9-]{36}\.jpg|messages\/[a-f0-9]{64}\.png)$/.test(req.url.split('?')[0]);
      const publicPayment=req.method==='GET'&&/^\/pay\/[a-f0-9-]{36}$/.test(req.url.split('?')[0]);
      const publicAudio=req.method==='GET'&&/^\/welcome-audio\/[a-f0-9]{64}\.ogg$/.test(req.url.split('?')[0]);
      const publicPrivacy=config.whatsapp!.privacyPublished&&req.url.split('?')[0]==='/privacy'&&req.method==='GET';
      if(req.headers.host===config.whatsapp!.hostname&&!publicPrivacy&&!publicCatalog&&!publicPayment&&!publicAudio&& (req.url.split('?')[0]!==hookPath||!['GET','POST'].includes(req.method)))return reply.code(404).send({error:'Not found'});
      if(req.url.split('?')[0]===hookPath&&req.headers.host!==config.whatsapp!.hostname)return reply.code(404).send({error:'Not found'});
    });
  }
  const whatsapp=config.whatsapp?(channel??new WhatsAppChannel(pool,config.whatsapp)):undefined;
  await registerOwner(app,pool,config,ownerVerifier,catalogGenerator,whatsapp);
  if(whatsapp)await registerWhatsApp(app,whatsapp);
  const privacyPolicy="default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  if(config.whatsapp?.privacyPublished)app.get('/privacy',async(_req,reply)=>reply.header('Cache-Control','no-store').header('Content-Security-Policy',privacyPolicy).type('text/html').send(renderPrivacy(config.whatsapp?.aiEnabled,config.whatsapp?.mediaEnabled)));
  if(config.owner)app.get('/api/owner/privacy-draft',async(_req,reply)=>reply.header('Content-Security-Policy',privacyPolicy).type('text/html').send(renderPrivacy(config.whatsapp?.aiEnabled,config.whatsapp?.mediaEnabled)));
  app.get('/catalog-images/messages/:hash',async(req,reply)=>{const image=readVisualImage((req.params as {hash:string}).hash);if(!image)return reply.code(404).send();return reply.type('image/png').header('Cache-Control','public, max-age=86400, immutable').header('X-Content-Type-Options','nosniff').send(image);});

  const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  app.get('/pay/:id',async(req,reply)=>{
    const id=(req.params as {id:string}).id;
    if(!config.whatsapp?.advance||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))return reply.code(404).send();
    const advance=(await pool.query("SELECT a.payee_name,a.payee_vpa,a.upi_uri,a.state FROM order_advances a JOIN order_requests r ON r.id=a.request_id WHERE a.id=$1 AND a.store_id=$2 AND r.acceptance<>'rejected' AND r.fulfillment<>'cancelled'",[id,config.whatsapp.storeId])).rows[0];
    if(!advance)return reply.code(404).send();
    const pending=['requested','claimed'].includes(advance.state);
    return reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer').header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'").type('text/html').send(`<!doctype html><html lang="ta"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>₹10 order advance</title><style>body{font:18px/1.7 system-ui;margin:40px auto;padding:20px;max-width:540px}a{display:block;padding:16px;background:#146b40;color:white;text-align:center;border-radius:8px}small{display:block;overflow-wrap:anywhere}</style><main><h1>₹10 order advance</h1><p>${escapeHtml(advance.payee_name)}</p><small>${escapeHtml(advance.payee_vpa)}</small>${pending?`<p>இதே phone-ல UPI app திறந்து pay பண்ணலாம்.</p><a href="${escapeHtml(advance.upi_uri)}">UPI app-ல pay பண்ணு — ₹10</a><p>இந்த ₹10 final bill-ல கழிச்சுக்குவோம். Payment வந்ததை கடை check பண்ணும்.</p><p>ஏற்கனவே pay பண்ணியிருந்தா மறுபடியும் pay பண்ண வேண்டாம்.</p>`:'<p>இந்த advance-ஐ கடை check பண்ணியிருக்கு. மறுபடியும் pay பண்ண வேண்டாம்.</p>'}</main></html>`);
  });
  app.get('/welcome-audio/:hash',async(req,reply)=>{
    const hash=(req.params as {hash:string}).hash;
    if(!/^[a-f0-9]{64}\.ogg$/.test(hash))return reply.code(404).send();
    const file=resolve('resources/welcome',hash);
    if(!existsSync(file))return reply.code(404).send();
    return reply.type('audio/ogg').header('Cache-Control','public, max-age=86400, immutable').header('X-Content-Type-Options','nosniff').send(await readFile(file));
  });
  app.get('/health/live', async () => ({ status: 'alive' }));
  app.get('/health/ready', async (_request, reply) => {
    try { await pool.query('SELECT 1'); return { status: 'ready', mode: config.mode }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  if (config.mode === 'mock') {
    if(nativeTest) await registerNativeTest(app,pool,nativeTest,nativeStore,config.whatsAppPlanningPaise??0,process.env.LOCAL_VISUAL_ORDERING_ENABLED==='true');
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
