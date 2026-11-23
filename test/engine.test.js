// engine.test.js
// Unit tests for the C++ engine, called through engine.js.
// Each test calls reset() first so tests never affect each other.

const test = require('node:test');
const assert = require('node:assert');
const engine = require('../src/engine');

// Helper: fresh engine with the given strategy and backend weights.
function setupEngine(strategy, weights) {
  engine.reset();
  engine.setStrategy(strategy);
  engine.configureRateLimit(false, 0, 0);
  for (let i = 0; i < weights.length; i++) {
    engine.addBackend(`http://localhost:${5001 + i}`, weights[i]);
  }
}

// Helper: pick `count` times and return the list of chosen ids.
function pickMany(count, clientIp) {
  const picks = [];
  for (let i = 0; i < count; i++) {
    picks.push(engine.pickBackend(clientIp || '1.1.1.1'));
  }
  return picks;
}

test('round-robin rotates through backends in order', () => {
  setupEngine('round-robin', [1, 1, 1]);
  assert.deepStrictEqual(pickMany(6), [0, 1, 2, 0, 1, 2]);
});

test('weighted-round-robin respects weights (3:1)', () => {
  setupEngine('weighted-round-robin', [3, 1]);
  const picks = pickMany(8);
  const countA = picks.filter((id) => id === 0).length;
  assert.strictEqual(countA, 6);
  // Smooth WRR should not send the light backend two in a row.
  assert.deepStrictEqual(picks.slice(0, 4), [0, 0, 1, 0]);
});

test('least-connections picks the least busy backend', () => {
  setupEngine('least-connections', [1, 1, 1]);
  engine.requestStarted(0);
  engine.requestStarted(0);
  engine.requestStarted(1);
  assert.strictEqual(engine.pickBackend('x'), 2);
});

test('ip-hash sends the same client to the same backend', () => {
  setupEngine('ip-hash', [1, 1, 1]);
  const first = engine.pickBackend('10.0.0.7');
  const again = pickMany(5, '10.0.0.7');
  assert.ok(again.every((id) => id === first));
});

test('unhealthy backends are skipped, and -1 when none are healthy', () => {
  setupEngine('round-robin', [1, 1]);
  engine.setHealthy(0, false);
  assert.deepStrictEqual(pickMany(3), [1, 1, 1]);
  engine.setHealthy(1, false);
  assert.strictEqual(engine.pickBackend('x'), -1);
  assert.strictEqual(engine.getStats().noBackendErrors, 1);
});

test('setHealthy reports only real changes', () => {
  setupEngine('round-robin', [1]);
  assert.strictEqual(engine.setHealthy(0, true), false);
  assert.strictEqual(engine.setHealthy(0, false), true);
  assert.strictEqual(engine.setHealthy(0, false), false);
});

test('stats track requests, failures and latency', () => {
  setupEngine('round-robin', [1]);
  engine.requestStarted(0);
  engine.requestFinished(0, 10, true);
  engine.requestStarted(0);
  engine.requestFinished(0, 30, false);
  const backend = engine.getStats().backends[0];
  assert.strictEqual(backend.totalRequests, 2);
  assert.strictEqual(backend.failedRequests, 1);
  assert.strictEqual(backend.activeConnections, 0);
  assert.strictEqual(backend.avgLatencyMs, 20);
});

test('token bucket allows a burst, blocks, then refills over time', () => {
  engine.reset();
  engine.configureRateLimit(true, 3, 1); // 3 burst, 1 token per second
  const start = 1000;
  assert.strictEqual(engine.allowRequest('9.9.9.9', start), true);
  assert.strictEqual(engine.allowRequest('9.9.9.9', start), true);
  assert.strictEqual(engine.allowRequest('9.9.9.9', start), true);
  assert.strictEqual(engine.allowRequest('9.9.9.9', start), false);
  // A different client has its own bucket.
  assert.strictEqual(engine.allowRequest('8.8.8.8', start), true);
  // One second later, exactly one token has dripped back in.
  assert.strictEqual(engine.allowRequest('9.9.9.9', start + 1000), true);
  assert.strictEqual(engine.allowRequest('9.9.9.9', start + 1000), false);
  assert.strictEqual(engine.getStats().rateLimitBlocked, 2);
});

test('removed backends are never picked and disappear from stats', () => {
  setupEngine('round-robin', [1, 1, 1]);
  assert.strictEqual(engine.removeBackend(1), true);
  assert.deepStrictEqual(pickMany(4), [0, 2, 0, 2]);
  assert.deepStrictEqual(engine.getStats().backends.map((b) => b.id), [0, 2]);
  // Removing twice, or changing a removed backend, is rejected.
  assert.strictEqual(engine.removeBackend(1), false);
  assert.strictEqual(engine.setWeight(1, 5), false);
});

test('setWeight changes the weighted-round-robin split', () => {
  setupEngine('weighted-round-robin', [1, 1]);
  engine.setWeight(1, 3);
  const picks = pickMany(8);
  assert.strictEqual(picks.filter((id) => id === 1).length, 6);
});

test('resetCounters zeroes request and rate-limit counters', () => {
  setupEngine('round-robin', [1]);
  engine.requestStarted(0);
  engine.requestFinished(0, 10, false);
  engine.resetCounters();
  const stats = engine.getStats();
  assert.strictEqual(stats.totalRequests, 0);
  assert.strictEqual(stats.backends[0].failedRequests, 0);
  assert.strictEqual(stats.rateLimitBlocked, 0);
});
