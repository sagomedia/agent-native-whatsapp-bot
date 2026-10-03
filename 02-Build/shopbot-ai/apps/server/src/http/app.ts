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

export async function createApp(config: Config, pool: Pool, nativeTest?:Interpreter,nativeStore=fixtureStore) {
  const app = Fastify({ logger: true, bodyLimit: 16000 });
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
      if(nativeTest&&existsSync('resources/catalog/ksmc-demo/images')) await app.register(staticPlugin,{root:resolve('resources/catalog/ksmc-demo/images'),prefix:'/demo-images/',decorateReply:false});
      if(nativeTest) app.get('/native-test',async(_request,reply)=>reply.sendFile('index.html'));
    }
  }
  return app;
}
