// health.js
// Every few seconds, sends GET /health to each backend.
// The result goes to the C++ engine (setHealthy), which then stops or
// resumes sending traffic to that backend. Node only does the network call.

const http = require('node:http');
const engine = require('./engine');
const bus = require('./events');
const logger = require('./logger');

// Resolves to true if the backend answered 2xx in time, false otherwise.
// It never rejects, which keeps the calling code simple.
function checkOnce(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume(); // we only need the status code, discard the body
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

// Checks every backend currently in the pool. The list comes from C++
// because backends can be added or removed from the dashboard.
async function checkAll(config) {
  const backends = engine.getStats().backends;
  const checks = backends.map(async (backend) => {
    const id = backend.id;
    const healthUrl = new URL(config.healthCheck.path, backend.url).toString();
    const healthy = await checkOnce(healthUrl, config.healthCheck.timeoutMs);

    // C++ tells us whether this is a change, so we only log transitions.
    const changed = engine.setHealthy(id, healthy);
    if (changed) {
      if (healthy) {
        logger.info(`Backend ${backend.url} is UP again`);
      } else {
        logger.warn(`Backend ${backend.url} is DOWN`);
      }
      bus.emit('health', { backendId: id, url: backend.url, healthy });
    }
  });
  await Promise.all(checks);
}

// Runs one check right away, then repeats. Returns a stop() function.
function startHealthChecks(config) {
  checkAll(config);
  const timer = setInterval(() => checkAll(config), config.healthCheck.intervalMs);
  return function stop() {
    clearInterval(timer);
  };
}

module.exports = { startHealthChecks, checkAll, checkOnce };
