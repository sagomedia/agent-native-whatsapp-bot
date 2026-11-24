import {verifyVoiceDecoder} from './services/voice-media.js';
import {GoogleInterpreter,readNativeSettings} from './adapters/google-interpreter.js';
import {createRuntimePool} from './db/pool.js';
import { access, mkdir } from 'node:fs/promises';
import { readConnectedConfig } from './config.js';
import { setupDatabase } from './db/migrate.js';
import { createApp } from './http/app.js';
import {WhatsAppChannel} from './services/whatsapp-channel.js';
import {startWhatsAppJobs} from './jobs/whatsapp.js';
import {verifyRelease,bindRuntimeRelease} from './services/release-manifest.js';

await verifyRelease();
const config = readConnectedConfig();
const provider = new GoogleInterpreter(readNativeSettings());
if (!provider.supportsAudio || !provider.supportsImages) {
  throw new Error('Enable Gemini multimodal inference for WhatsApp voice and photos.');
}
await verifyVoiceDecoder();
await access('dist/dashboard/index.html').catch(() => {
  throw new Error('Owner dashboard assets are missing. Run npm run build before starting ShopBot.');
});
const pool = createRuntimePool(config.databaseUrl,()=>console.error('An idle database connection failed; new requests will reconnect.'));
let stopWhatsApp: (() => Promise<void>) | undefined;
let app: Awaited<ReturnType<typeof createApp>> | undefined;
try {
  // No HTTP readiness until the locked setup and queue startup complete.
  await setupDatabase(pool, 'live');
  const store = await pool.query('SELECT 1 FROM stores WHERE id=$1', [config.owner.storeId]);
  if (!store.rowCount) throw new Error('Provision the configured store in PostgreSQL before starting ShopBot.');
  await bindRuntimeRelease(pool);
  await mkdir(config.mediaDir, { recursive: true });
  const channel = new WhatsAppChannel(pool, config.whatsapp, undefined, provider);
  app = await createApp(config, pool, undefined, undefined, undefined, channel);
  stopWhatsApp = await startWhatsAppJobs(channel, () => app?.log.error('WhatsApp worker failed; durable work retained'));
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  console.error(error);
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
  await stopWhatsApp?.();
  await pool.end();
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
