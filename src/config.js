// config.js
// Loads rprox.config.json (or any path you pass), fills in defaults
// for missing values and checks for obvious mistakes early, so the
// proxy fails at startup with a clear message instead of at runtime.

const fs = require('node:fs');
const path = require('node:path');

const STRATEGIES = ['round-robin', 'weighted-round-robin', 'least-connections', 'ip-hash'];

const DEFAULTS = {
  port: 8080,
  dashboardPort: 9090,
  strategy: 'round-robin',
  backends: [],
  healthCheck: { intervalMs: 3000, path: '/health', timeoutMs: 1000 },
  rateLimit: { enabled: true, capacity: 20, refillPerSecond: 10 },
};

function validate(config) {
  if (!STRATEGIES.includes(config.strategy)) {
    throw new Error(`Unknown strategy "${config.strategy}". Use one of: ${STRATEGIES.join(', ')}`);
  }
  if (config.backends.length === 0) {
    throw new Error('Config must list at least one backend.');
  }
  for (const backend of config.backends) {
    if (!backend.url || !backend.url.startsWith('http://')) {
      throw new Error(`Backend url must start with http:// (got "${backend.url}")`);
    }
  }
}

// Builds a full config: defaults first, then values from the user.
// Nested objects are merged one level deep so a user can override
// just one field, e.g. { "rateLimit": { "capacity": 5 } }.
function buildConfig(userConfig) {
  const config = {
    ...DEFAULTS,
    ...userConfig,
    healthCheck: { ...DEFAULTS.healthCheck, ...(userConfig.healthCheck || {}) },
    rateLimit: { ...DEFAULTS.rateLimit, ...(userConfig.rateLimit || {}) },
  };

  // Backends can be written as plain strings for convenience.
  config.backends = config.backends.map((backend) => {
    if (typeof backend === 'string') {
      return { url: backend, weight: 1 };
    }
    return { url: backend.url, weight: backend.weight || 1 };
  });

  validate(config);
  return config;
}

function loadConfig(filePath) {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Config file not found: ${fullPath}`);
  }
  const userConfig = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  return buildConfig(userConfig);
}

module.exports = { loadConfig, buildConfig, STRATEGIES };
