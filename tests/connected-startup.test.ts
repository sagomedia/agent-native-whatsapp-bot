import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Pool} from 'pg';
import {readConnectedConfig} from '../apps/server/src/config.js';
import {createApp} from '../apps/server/src/http/app.js';
import type {WhatsAppChannel} from '../apps/server/src/services/whatsapp-channel.js';

const storeId = '12345678-0000-4000-8000-000000000001';
const profile = {
  DATABASE_URL: 'postgres://unused.invalid/shopbot_dev',
  OWNER_HOSTNAME: 'owner.example.test',
  OWNER_EMAIL: 'owner@example.test',
  OWNER_STORE_ID: storeId,
  CF_ACCESS_ISSUER: 'https://offline.cloudflareaccess.com',
  CF_ACCESS_AUD: 'synthetic-audience',
  WHATSAPP_HOSTNAME: 'channel.example.test',
  WHATSAPP_STORE_ID: storeId,
  WHATSAPP_APP_ID: '11111',
  WHATSAPP_WABA_ID: '22222',
  WHATSAPP_PHONE_ID: '33333',
  WHATSAPP_APP_SECRET: 'synthetic-app-secret',
  WHATSAPP_VERIFY_TOKEN: 'synthetic-verify-token',
  WHATSAPP_ACCESS_TOKEN: 'synthetic-access-token-used-only-in-tests',
  WHATSAPP_TEST_RECIPIENTS: '15555550123',
  WHATSAPP_ENABLED: 'true',
  WHATSAPP_PROCESS_ENABLED: 'true',
  WHATSAPP_SEND_ENABLED: 'true',
  WHATSAPP_AI_ENABLED: 'true',
  WHATSAPP_MEDIA_ENABLED: 'true',
  WHATSAPP_VISUAL_ORDERING_ENABLED: 'true',
  GEMINI_UNIFIED_UNDERSTANDING_ENABLED: 'true',
  ALLOW_MULTIMODAL_INFERENCE: 'true',
  ALLOW_PAID_INFERENCE: 'true',
  AI_BUDGET_USD: '0.50',
  GEMINI_API_KEY: 'synthetic-gemini-key',
};

test('connected startup rejects incomplete profiles before starting the app', () => {
  for (const overrides of [
    {WHATSAPP_ENABLED: 'false'},
    {OWNER_EMAIL: ''},
    {WHATSAPP_ACCESS_TOKEN: ''},
    {WHATSAPP_MEDIA_ENABLED: 'false'},
    {WHATSAPP_VISUAL_ORDERING_ENABLED: 'false'},
    {ALLOW_LOCAL_AI_TEST: 'true'},
  ]) {
    assert.throws(() => readConnectedConfig({...profile, ...overrides}), Error, JSON.stringify(overrides));
  }
});

for (const mode of ['live', 'mock']) {
  test(`connected startup with APP_MODE=${mode} serves the owner dashboard and excludes test routes`, async t => {
    const config = readConnectedConfig({...profile, APP_MODE: mode});
    const pool = {query: async () => ({rowCount: 1, rows: [{id: storeId}]})} as unknown as Pool;
    const channel = {config: config.whatsapp, setup: async () => {}} as WhatsAppChannel;
    const verify = async () => ({email: profile.OWNER_EMAIL, subject: 'synthetic-owner'});
    const app = await createApp(config, pool, undefined, undefined, verify, channel);
    t.after(() => app.close());

    const loopback = {host: '127.0.0.1'};
    const readiness = await app.inject({url: '/health/ready', headers: loopback});
    assert.equal(readiness.statusCode, 200);
    const health = readiness.json();
    assert.equal(health.status, 'ready');
    assert.equal(health.mode, 'connected');

    const owner = {host: profile.OWNER_HOSTNAME};
    assert.equal((await app.inject({url: '/owner', headers: owner})).statusCode, 403);
    const dashboard = await app.inject({url: '/owner', headers: {...owner, 'cf-access-jwt-assertion': 'synthetic'}});
    assert.equal(dashboard.statusCode, 200);
    assert.match(dashboard.headers['content-type']!, /text\/html/);
    assert.match(dashboard.body, /id="root"/);

    for (const url of ['/api/simulator/tools', '/api/simulator', '/native-test', '/api/native-test']) {
      assert.equal((await app.inject({url, headers: loopback})).statusCode, 404, url);
    }
    for (const url of ['/api/simulator/events', '/api/native-test/session']) {
      assert.equal((await app.inject({method: 'POST', url, headers: loopback})).statusCode, 404, url);
    }
  });
}
