import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { setupDatabase, resetMock } from '../apps/server/src/db/migrate.js';
import { SimulatorService } from '../apps/server/src/services/simulator.js';
import { createApp } from '../apps/server/src/http/app.js';
import { readConfig, assertMock } from '../apps/server/src/config.js';
import { eventSchema } from '../packages/contracts/index.js';

// Integration suite creates and drops an isolated PostgreSQL schema, never the app schema.
test('local foundation: locking, seed, durable drafts, replay, stale edits and mock boundaries', async () => {
  const config = readConfig();
  assertMock(config.mode);
  const admin = new pg.Pool({ connectionString: config.databaseUrl });
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, options: `-c search_path=${schema}` });
  try {
    await Promise.all([setupDatabase(pool, 'mock'), setupDatabase(pool, 'mock')]);
    const service = new SimulatorService(pool);
    let state = await service.snapshot();
    assert.equal(state.catalog.length, 6);
    assert.equal(state.conversation.version, 0);
    assert.equal(state.catalog.filter(p => p.stock === null).length, 1);
    // Whole multi-line draft survives subsequent setup; five different products preserved.
    for (const product of state.catalog.slice(0, 5)) {
      const event = { id: randomUUID(), type: 'add_item' as const, sku: product.sku, quantity: 2, expectedVersion: state.conversation.version };
      await service.ingest(event);
      assert.equal(await service.processNext(), true);
      state = await service.snapshot();
    }
    assert.equal(state.conversation.draft.length, 5);
    assert.equal(state.conversation.draft.reduce((sum,l)=>sum+(l.quantity??0),0), 10);
    const before = state;
    await setupDatabase(pool, 'mock');
    assert.deepEqual((await new SimulatorService(pool).snapshot()).conversation, before.conversation);
    const duplicate = { id: randomUUID(), type: 'add_item' as const, sku: state.catalog[0].sku, quantity: 1, expectedVersion: state.conversation.version };
    assert.equal((await service.ingest(duplicate)).duplicate, false);
    assert.equal((await service.ingest(duplicate)).duplicate, true);
    await Promise.all([service.processNext(), service.processNext()]);
    assert.equal((await service.snapshot()).messages.filter(m=>m.direction==='outbound').length, 6);
    assert.equal((await service.ingest(duplicate)).duplicate, true);
    assert.equal(await service.processNext(), false);
    await assert.rejects(service.ingest({...duplicate, quantity: 2}), /different content/);
    state = await service.snapshot();
    const stale = { id: randomUUID(), type: 'set_quantity' as const, lineId: state.conversation.draft[0].id, quantity: 50, expectedVersion: state.conversation.version - 1 };
    await service.ingest(stale); await service.processNext();
    assert.deepEqual((await service.snapshot()).conversation, state.conversation);
    assert.match((await service.snapshot()).messages.at(-1)!.text, /draft changed/);
    // Competing current-version writes: one applies, the second is safely rejected.
    const first = { id: randomUUID(), type: 'set_quantity' as const, lineId: state.conversation.draft[0].id, quantity: 4, expectedVersion: state.conversation.version };
    const second = {...first, id: randomUUID(), quantity: 8};
    await Promise.all([service.ingest(first), service.ingest(second)]);
    await Promise.all([service.processNext(), service.processNext()]);
    assert.equal((await service.snapshot()).conversation.version, state.conversation.version + 1);
    assert.equal(eventSchema.safeParse({...first, storeId: randomUUID()}).success, false);
    assert.equal(eventSchema.safeParse({...first, quantity: -2}).success, false);
    assert.equal(eventSchema.safeParse({...first, quantity: 1.5}).success, false);
    const app = await createApp(config, pool);
    try {
      assert.equal((await app.inject({method:'GET',url:'/health/ready'})).statusCode,200);
      assert.equal((await app.inject({method:'POST',url:'/api/simulator/events',payload:{...first,tenant:'other'}})).statusCode,400);
    } finally { await app.close(); }
    const liveApp = await createApp({...config,mode:'live'}, pool);
    try { assert.equal((await liveApp.inject({method:'GET',url:'/api/simulator'})).statusCode,404); }
    finally { await liveApp.close(); }
    await assert.rejects(resetMock(pool,'live'), /forbidden/);
    const liveSchema = schema + '_live';
    await admin.query(`CREATE SCHEMA "${liveSchema}"`);
    const livePool = new pg.Pool({connectionString:config.databaseUrl, options:`-c search_path=${liveSchema}`});
    try {
      await setupDatabase(livePool,'live');
      assert.equal((await livePool.query('SELECT * FROM products')).rowCount,0);
      assert.equal((await livePool.query('SELECT * FROM stores')).rowCount,0);
    } finally { await livePool.end(); await admin.query(`DROP SCHEMA "${liveSchema}" CASCADE`); }
    await resetMock(pool,'mock');
    assert.equal((await service.snapshot()).conversation.draft.length,0);
    assert.equal((await service.snapshot()).messages.length,0);
  } finally { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
});
