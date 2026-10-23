import {verifyVoiceDecoder} from './services/voice-media.js';
import {setupImageDemo} from './services/demo-catalog.js';
import {GoogleInterpreter,readNativeSettings} from './adapters/google-interpreter.js';
import {createRuntimePool} from './db/pool.js';
import { mkdir } from 'node:fs/promises';
import { readConfig } from './config.js';
import { setupDatabase } from './db/migrate.js';
import { createApp } from './http/app.js';
import { SimulatorService } from './services/simulator.js';
import { startSimulatorJobs } from './jobs/simulator.js';
import {WhatsAppChannel} from './services/whatsapp-channel.js';
import {startWhatsAppJobs} from './jobs/whatsapp.js';
import {verifyRelease,bindRuntimeRelease} from './services/release-manifest.js';

await verifyRelease();
const config = readConfig();
if(config.whatsapp?.mediaEnabled)await verifyVoiceDecoder();
const pool = createRuntimePool(config.databaseUrl,()=>console.error('An idle database connection failed; new requests will reconnect.'));
let stopJobs: (() => Promise<void>) | undefined;
let stopWhatsApp: (() => Promise<void>) | undefined;
let app: Awaited<ReturnType<typeof createApp>> | undefined;
try {
  // No HTTP readiness until the locked setup and queue startup complete.
  await setupDatabase(pool, config.mode);
  await bindRuntimeRelease(pool);
  await mkdir(config.mediaDir, { recursive: true });
  const nativeTest=process.env.ALLOW_LOCAL_AI_TEST==='true'?new GoogleInterpreter(readNativeSettings()):undefined;
  const nativeStore=nativeTest?await setupImageDemo(pool):undefined;
  const whatsappAI=config.whatsapp?.aiEnabled?new GoogleInterpreter(readNativeSettings()):undefined;
  const channel=config.whatsapp?new WhatsAppChannel(pool,config.whatsapp,undefined,whatsappAI):undefined;
  app = await createApp(config, pool,nativeTest,nativeStore,undefined,channel);
  if(channel)stopWhatsApp=await startWhatsAppJobs(channel,()=>app?.log.error('WhatsApp worker failed; durable work retained'));
  if (config.mode === 'mock') stopJobs = await startSimulatorJobs(config.databaseUrl, new SimulatorService(pool), error => app?.log.error(error));
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  console.error(error);
  await stopJobs?.();
  await stopWhatsApp?.();
  await app?.close();
  await pool.end();
  process.exit(1);
}
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await app?.close();
  await stopJobs?.();
  await stopWhatsApp?.();
  await pool.end();
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
