// engine.js
// The ONLY place that loads the compiled C++ addon.
// Every other Node.js file talks to C++ through these small wrappers,
// so if the addon's API ever changes we only fix it here.

const path = require('node:path');

const addonPath = path.join(__dirname, '..', 'build', 'Release', 'rap_proxy.node');

let native;
try {
  native = require(addonPath);
} catch (err) {
  // Give a helpful message instead of a confusing stack trace.
  console.error('Could not load the C++ engine. Did you run "npm run build"?');
  throw err;
}

// Clears all backends, counters and rate-limit buckets, then loads
// the config into the C++ engine. Returns the backend ids in order.
function setup(config) {
  native.reset();
  native.setStrategy(config.strategy);

  const rl = config.rateLimit;
  native.configureRateLimit(rl.enabled, rl.capacity, rl.refillPerSecond);

  const ids = [];
  for (const backend of config.backends) {
    ids.push(native.addBackend(backend.url, backend.weight));
  }
  return ids;
}

function allowRequest(clientIp, nowMs) {
  return native.allowRequest(clientIp, nowMs);
}

// Returns a backend id, or -1 if no healthy backend exists.
function pickBackend(clientIp) {
  return native.pickBackend(clientIp);
}

function requestStarted(backendId) {
  native.requestStarted(backendId);
}

function requestFinished(backendId, latencyMs, success) {
  native.requestFinished(backendId, latencyMs, success);
}

// Returns true when the health status changed.
function setHealthy(backendId, healthy) {
  return native.setHealthy(backendId, healthy);
}

function getStats() {
  return native.getStats();
}

// Backends can be added and removed at runtime, so the proxy asks C++
// for the URL instead of reading it from the startup config.
function getBackendUrl(backendId) {
  return native.getBackendUrl(backendId);
}

module.exports = {
  setup,
  allowRequest,
  pickBackend,
  requestStarted,
  requestFinished,
  setHealthy,
  getStats,
  getBackendUrl,
  reset: native.reset,
  setStrategy: native.setStrategy,
  addBackend: native.addBackend,
  removeBackend: native.removeBackend,
  setWeight: native.setWeight,
  resetCounters: native.resetCounters,
  configureRateLimit: native.configureRateLimit,
};
