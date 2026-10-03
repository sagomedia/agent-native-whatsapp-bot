import {setupImageDemo} from './services/demo-catalog.js';
import {GoogleInterpreter,readNativeSettings} from './adapters/google-interpreter.js';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';
import { readConfig } from './config.js';
import { setupDatabase } from './db/migrate.js';
import { createApp } from './http/app.js';
import { SimulatorService } from './services/simulator.js';
import { startSimulatorJobs } from './jobs/simulator.js';

const config = readConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
let stopJobs: (() => Promise<void>) | undefined;
let app: Awaited<ReturnType<typeof createApp>> | undefined;
try {
  // No HTTP readiness until the locked setup and queue startup complete.
  await setupDatabase(pool, config.mode);
  await mkdir(config.mediaDir, { recursive: true });
  const nativeTest=process.env.ALLOW_LOCAL_AI_TEST==='true'?new GoogleInterpreter(readNativeSettings()):undefined;
  const nativeStore=nativeTest?await setupImageDemo(pool):undefined;
  app = await createApp(config, pool,nativeTest,nativeStore);
  if (config.mode === 'mock') stopJobs = await startSimulatorJobs(config.databaseUrl, new SimulatorService(pool), error => app?.log.error(error));
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  console.error(error);
  await stopJobs?.();
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
  await pool.end();
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
