// control.js
// The control API behind the dashboard buttons. Every route is a POST
// with a small JSON body, for example:
//   POST /api/strategy   { "strategy": "ip-hash" }
// Node only passes these changes on to the C++ engine (or does network
// I/O such as starting a demo server). It never picks a backend itself.

const engine = require('./engine');
const logger = require('./logger');
const { checkAll } = require('./health');
const traffic = require('./traffic');
const demo = require('../demo/backends');

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Collects the request body and parses it as JSON ({} if empty).
async function readJson(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
  }
  if (text === '') {
    return {};
  }
  return JSON.parse(text);
}

// Looks up a backend's URL in C++ and fails clearly if the id is unknown.
function backendUrl(id) {
  const url = engine.getBackendUrl(Number(id));
  if (!url) {
    throw new Error(`Unknown backend id ${id}`);
  }
  return url;
}

function portOf(url) {
  return Number(new URL(url).port);
}

// Sends GET /sick or /heal to a demo backend.
async function setSick(id, sick) {
  const path = sick ? '/sick' : '/heal';
  const response = await fetch(backendUrl(id) + path);
  return response.json();
}

async function addBackend(body) {
  const url = body.url || `http://localhost:${body.port}`;
  if (!url.startsWith('http://')) {
    throw new Error('Backend url must start with http://');
  }
  if (body.startDemo) {
    await demo.startBackend(portOf(url));
  }
  const id = engine.addBackend(url, Number(body.weight) || 1);
  logger.info(`Dashboard added backend ${url} (weight ${body.weight || 1})`);
  return { id, url };
}

function setRateLimit(body) {
  const capacity = Number(body.capacity);
  const refill = Number(body.refillPerSecond);
  if (!(capacity > 0) || !(refill > 0)) {
    throw new Error('Capacity and refill must be positive numbers');
  }
  engine.configureRateLimit(Boolean(body.enabled), capacity, refill);
  return { ok: true };
}

// One function per route. `ctx` holds the proxy config.
const ROUTES = {
  '/api/strategy': (body) => {
    engine.setStrategy(String(body.strategy));
    logger.info(`Dashboard switched strategy to ${body.strategy}`);
    return { ok: true };
  },
  '/api/backends/add': (body) => addBackend(body),
  '/api/backends/remove': (body) => {
    logger.info(`Dashboard removed backend ${backendUrl(body.id)}`);
    return { ok: engine.removeBackend(Number(body.id)) };
  },
  '/api/backends/weight': (body) => ({ ok: engine.setWeight(Number(body.id), Number(body.weight)) }),
  '/api/backends/sick': (body) => setSick(body.id, true),
  '/api/backends/heal': (body) => setSick(body.id, false),
  '/api/backends/crash': (body) => {
    demo.stopBackend(portOf(backendUrl(body.id)));
    logger.warn(`Dashboard crashed demo server ${backendUrl(body.id)}`);
    return { ok: true };
  },
  '/api/backends/restart': async (body) => {
    await demo.startBackend(portOf(backendUrl(body.id)));
    logger.info(`Dashboard restarted demo server ${backendUrl(body.id)}`);
    return { ok: true };
  },
  '/api/rate-limit': (body) => setRateLimit(body),
  '/api/health-check': async (body, ctx) => {
    await checkAll(ctx.config);
    return { ok: true };
  },
  '/api/reset-counters': () => {
    engine.resetCounters();
    return { ok: true };
  },
  '/api/traffic/start': (body, ctx) => {
    traffic.startTraffic({
      url: ctx.proxyUrl,
      rps: Number(body.rps) || 20,
      durationSec: Number(body.durationSec) || 0,
      clients: Number(body.clients) || 8,
      path: body.path || null,
    });
    return { ok: true };
  },
  '/api/traffic/stop': () => {
    traffic.stopTraffic();
    return { ok: true };
  },
  '/api/send': async (body, ctx) => {
    const results = await traffic.sendTestRequests({
      url: ctx.proxyUrl,
      count: Math.min(Number(body.count) || 1, 100),
      clientIp: body.clientIp || '',
      path: body.path || '/',
    });
    return { results };
  },
};

// Returns true if this module handled the request.
async function handleControl(req, res, ctx) {
  const route = ROUTES[req.url];
  if (!route || req.method !== 'POST') {
    return false;
  }
  try {
    const body = await readJson(req);
    sendJson(res, 200, await route(body, ctx));
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
  return true;
}

module.exports = { handleControl };
