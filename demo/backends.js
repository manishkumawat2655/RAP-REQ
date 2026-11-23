// demo/backends.js
// Starts fake backend servers on localhost for demos and tests.
// Each one answers with its name after a small random delay, so you
// can SEE which backend served a request and how latency changes.
//
// Routes:
//   GET /health  → 200 when healthy, 500 when "sick"
//   GET /sick    → make this backend fail its health check
//   GET /heal    → make it healthy again
//   GET /toggle  → flip between healthy and sick
//   GET /slow    → responds after ~800ms (useful for least-connections)
//   GET /fast    → responds immediately (useful for performance tests)
//   anything else → JSON saying which backend answered

const http = require('node:http');

// Servers started by this process, by port. A crashed server stays in
// the map with value null, so the dashboard can offer "Restart".
const servers = new Map();

function randomDelay(minMs, maxMs) {
  return minMs + Math.floor(Math.random() * (maxMs - minMs));
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body) + '\n');
}

function createBackend(name, port) {
  let sick = false;

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      if (sick) {
        sendJson(res, 500, { name, healthy: false });
      } else {
        sendJson(res, 200, { name, healthy: true });
      }
    } else if (req.url === '/sick' || req.url === '/heal' || req.url === '/toggle') {
      if (req.url === '/toggle') {
        sick = !sick;
      } else {
        sick = req.url === '/sick';
      }
      sendJson(res, 200, { name, healthy: !sick });
    } else if (req.url === '/fast') {
      // No delay: used by performance tests to measure the proxy itself.
      sendJson(res, 200, { servedBy: name, port, path: req.url, delayMs: 0 });
    } else {
      let delay = randomDelay(10, 80);
      if (req.url === '/slow') {
        delay = randomDelay(600, 1000);
      }
      setTimeout(() => {
        sendJson(res, 200, { servedBy: name, port, path: req.url, delayMs: delay });
      }, delay);
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
}

// Starts one backend on `port` (does nothing if it is already running).
async function startBackend(port) {
  if (servers.get(port)) {
    return servers.get(port);
  }
  const server = await createBackend(`backend-${port}`, port);
  servers.set(port, server);
  return server;
}

// Simulates a crash: closes the server AND cuts open connections.
function stopBackend(port) {
  const server = servers.get(port);
  if (!server) {
    throw new Error(`No running demo server on port ${port}`);
  }
  server.close();
  server.closeAllConnections();
  servers.set(port, null);
}

// e.g. [{ port: 5001, running: true }, { port: 5002, running: false }]
function listBackends() {
  const list = [];
  for (const [port, server] of servers) {
    list.push({ port, running: server !== null });
  }
  return list;
}

// Starts `count` backends on consecutive ports. Returns their servers.
async function startBackends(count, startPort) {
  const started = [];
  for (let i = 0; i < count; i++) {
    started.push(await startBackend(startPort + i));
  }
  return started;
}

// Allows running this file directly: node demo/backends.js 3 5001
if (require.main === module) {
  const count = Number(process.argv[2] || 3);
  const startPort = Number(process.argv[3] || 5001);
  startBackends(count, startPort).then(() => {
    console.log(`Started ${count} demo backends on ports ${startPort}-${startPort + count - 1}`);
  });
}

module.exports = { startBackends, startBackend, stopBackend, listBackends, createBackend };
