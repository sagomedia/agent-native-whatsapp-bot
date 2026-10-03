import { PgBoss } from 'pg-boss';
import type { SimulatorService } from '../services/simulator.js';

export async function startSimulatorJobs(databaseUrl: string, service: SimulatorService, onError: (error: unknown) => void) {
  const boss = new PgBoss({ connectionString: databaseUrl });
  boss.on('error', onError);
  await boss.start();
  await boss.createQueue('simulator-turn');
  await boss.work('simulator-turn', { pollingIntervalSeconds: 1, batchSize: 1 }, async () => {
    // Bounded batch; the durable pending rows remain authoritative after crash/replay.
    for (let count = 0; count < 25 && await service.processNext(); count++) { /* drain */ }
  });
  let dispatching = false;
  async function dispatch() {
    if (dispatching) return;
    dispatching = true;
    try {
      if (await service.hasPending()) await boss.send('simulator-turn', {}, { singletonKey: 'local-simulator', retryLimit: 3, retryDelay: 2, expireInSeconds: 60 });
    } finally { dispatching = false; }
  }
  await dispatch();
  const timer = setInterval(() => { void dispatch().catch(onError); }, 1000);
  return async () => { clearInterval(timer); await boss.stop({ graceful: true, timeout: 5000 }); };
}
