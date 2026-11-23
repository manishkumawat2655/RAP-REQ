// dashboard-server.js
// A tiny web server for the live dashboard:
//   GET  /             → public/index.html (+ its .css and .js files)
//   GET  /events       → Server-Sent Events stream (live updates)
//   GET  /api/stats    → current stats as JSON (used by `rprox stats`)
//   POST /api/...      → control buttons, handled by control.js
// All numbers come straight from engine.getStats() (the C++ engine).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('./engine');
const bus = require('./events');
const { handleControl } = require('./control');
const { listBackends } = require('../demo/backends');
const { isTrafficRunning } = require('./traffic');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STATS_INTERVAL_MS = 500;

// Only these files are served, so nobody can read other files on disk.
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css'],
  '/dashboard.js': ['dashboard.js', 'text/javascript'],
  '/controls.js': ['controls.js', 'text/javascript'],
  '/lab.js': ['lab.js', 'text/javascript'],
  '/scenarios.js': ['scenarios.js', 'text/javascript'],
};

// C++ stats plus two facts only Node knows: which demo servers this
// process runs (for Crash/Restart buttons) and whether traffic is on.
function snapshot() {
  const stats = engine.getStats();
  stats.demoServers = listBackends();
  stats.trafficRunning = isTrafficRunning();
  return stats;
}

// SSE format: "event: <name>\ndata: <json>\n\n"
function sendEvent(res, name, data) {
  res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Keeps one browser connection open and pushes updates into it.
function handleEvents(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  sendEvent(res, 'stats', snapshot());

  const onRequest = (event) => sendEvent(res, 'request', event);
  const onHealth = (event) => sendEvent(res, 'health', event);
  bus.on('request', onRequest);
  bus.on('health', onHealth);
  const timer = setInterval(() => sendEvent(res, 'stats', snapshot()), STATS_INTERVAL_MS);

  // Browser tab closed: stop sending, or we would leak listeners.
  req.on('close', () => {
    clearInterval(timer);
    bus.off('request', onRequest);
    bus.off('health', onHealth);
  });
}

function serveStatic(res, file) {
  const [name, contentType] = file;
  res.writeHead(200, { 'content-type': contentType });
  fs.createReadStream(path.join(PUBLIC_DIR, name)).pipe(res);
}

async function handle(req, res, ctx) {
  if (await handleControl(req, res, ctx)) {
    return;
  }
  if (STATIC_FILES[req.url]) {
    serveStatic(res, STATIC_FILES[req.url]);
  } else if (req.url === '/events') {
    handleEvents(req, res);
  } else if (req.url === '/favicon.ico') {
    res.writeHead(204); // no icon, but avoid a 404 in the browser console
    res.end();
  } else if (req.url === '/api/stats') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(snapshot()));
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found\n');
  }
}

function startDashboard(config) {
  const ctx = { config, proxyUrl: `http://localhost:${config.port}` };
  const server = http.createServer((req, res) => handle(req, res, ctx));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.dashboardPort, () => resolve(server));
  });
}

module.exports = { startDashboard };
