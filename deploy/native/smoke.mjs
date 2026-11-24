import assert from 'node:assert/strict';

const origin = process.env.SHOPBOT_SMOKE_ORIGIN ?? 'http://127.0.0.1:3017';
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);

const response = await fetch(`${origin}/health/ready`, {
  signal: AbortSignal.timeout(5000),
});
assert.equal(response.status, 200);
const {status, mode, processing, sending} = await response.json();
assert.equal(status, 'ready');
assert.equal(mode, 'connected');
assert.equal(processing, true, 'WhatsApp processing is disabled');
assert.equal(sending, true, 'WhatsApp sending is disabled');
console.log('Connected ShopBot is ready. Check the protected owner UI and WhatsApp delivery separately.');
