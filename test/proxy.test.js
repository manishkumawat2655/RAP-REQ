// proxy.test.js
// End-to-end test: real demo backends + real proxy on localhost.
// Checks that requests are forwarded, spread across backends,
// rate-limited, and answered with 503 when every backend is down.

const test = require('node:test');
const assert = require('node:assert');
const engine = require('../src/engine');
const { buildConfig } = require('../src/config');
const { startProxy } = require('../src/proxy');
const { startBackends } = require('../demo/backends');

const PROXY_PORT = 18080;

async function get(path, clientIp) {
  const response = await fetch(`http://localhost:${PROXY_PORT}${path}`, {
    headers: { 'x-forwarded-for': clientIp || '127.0.0.1' },
  });
  const text = await response.text();
  return { status: response.status, text, backend: response.headers.get('x-rprox-backend') };
}

test('proxy end-to-end', async (t) => {
  const backends = await startBackends(2, 15001);
  const config = buildConfig({
    port: PROXY_PORT,
    strategy: 'round-robin',
    backends: ['http://localhost:15001', 'http://localhost:15002'],
    rateLimit: { capacity: 5, refillPerSecond: 0.001 },
  });
  engine.setup(config);
  const proxy = await startProxy(config);

  // Close all servers even if an assertion fails.
  t.after(() => {
    proxy.close();
    proxy.closeAllConnections();
    for (const server of backends) {
      server.close();
      server.closeAllConnections();
    }
  });

  await t.test('forwards requests with round-robin', async () => {
    const first = await get('/hello', 'a');
    const second = await get('/hello', 'a');
    assert.strictEqual(first.status, 200);
    assert.match(first.text, /backend-15001/);
    assert.match(second.text, /backend-15002/);
  });

  await t.test('C++ stats were updated', () => {
    const stats = engine.getStats();
    assert.strictEqual(stats.backends[0].totalRequests, 1);
    assert.strictEqual(stats.backends[1].totalRequests, 1);
  });

  await t.test('rate limiter returns 429 after the burst', async () => {
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await get('/', 'b')).status);
    }
    assert.deepStrictEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
  });

  await t.test('returns 503 when no backend is healthy', async () => {
    engine.setHealthy(0, false);
    engine.setHealthy(1, false);
    const result = await get('/', 'c');
    assert.strictEqual(result.status, 503);
  });
});
