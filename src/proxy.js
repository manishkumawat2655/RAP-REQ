// proxy.js
// The reverse proxy itself, built on the core `http` module.
// For each incoming request it asks the C++ engine two questions:
//   1. "Is this client allowed?"   (rate limiter)
//   2. "Which backend should serve it?"  (load balancer)
// then streams the request to that backend and the response back.

const http = require('node:http');
const { performance } = require('node:perf_hooks');
const engine = require('./engine');
const bus = require('./events');

// NOTE: trusting X-Forwarded-For lets the traffic generator pretend to be
// many different clients. A real public proxy should NOT trust it blindly.
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function sendError(res, status, message) {
  res.writeHead(status, { 'content-type': 'text/plain' });
  res.end(message + '\n');
}

// Publishes one finished request so the logger and dashboard can show it.
function publish(req, clientIp, status, latencyMs, backendId, backendUrl) {
  bus.emit('request', {
    time: Date.now(),
    method: req.method,
    path: req.url,
    clientIp,
    status,
    latencyMs,
    backendId,
    backendUrl,
  });
}

// Streams the request to the chosen backend and the response back.
function forward(req, res, clientIp, backendUrl) {
  const target = new URL(req.url, backendUrl);
  const headers = { ...req.headers, host: target.host, 'x-forwarded-for': clientIp };

  const proxyReq = http.request(target, { method: req.method, headers, timeout: 10000 }, (proxyRes) => {
    const responseHeaders = { ...proxyRes.headers, 'x-rprox-backend': backendUrl };
    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Backend timed out'));
  });

  // Backend is down or broke mid-way: answer 502 Bad Gateway.
  proxyReq.on('error', () => {
    if (!res.headersSent) {
      sendError(res, 502, 'Bad Gateway');
    } else {
      res.destroy();
    }
  });

  // If the client hangs up early, stop talking to the backend too.
  res.on('close', () => {
    proxyReq.destroy();
  });

  req.pipe(proxyReq);
}

function handleRequest(req, res) {
  const startedAt = performance.now();
  const clientIp = getClientIp(req);

  // Question 1 for C++: may this client send another request?
  if (!engine.allowRequest(clientIp)) {
    sendError(res, 429, 'Too Many Requests');
    publish(req, clientIp, 429, performance.now() - startedAt, -1, null);
    return;
  }

  // Question 2 for C++: which backend? (-1 means none are healthy)
  const backendId = engine.pickBackend(clientIp);
  if (backendId === -1) {
    sendError(res, 503, 'No healthy backends');
    publish(req, clientIp, 503, performance.now() - startedAt, -1, null);
    return;
  }

  const backendUrl = engine.getBackendUrl(backendId);
  engine.requestStarted(backendId);

  // 'close' fires exactly once per response (success, error or abort),
  // so it is the single safe place to report the result to C++.
  res.on('close', () => {
    const latencyMs = performance.now() - startedAt;
    const success = res.writableFinished && res.statusCode < 500;
    engine.requestFinished(backendId, latencyMs, success);
    publish(req, clientIp, res.statusCode, latencyMs, backendId, backendUrl);
  });

  forward(req, res, clientIp, backendUrl);
}

// Starts listening and resolves once the port is open.
function startProxy(config) {
  const server = http.createServer(handleRequest);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, () => resolve(server));
  });
}

module.exports = { startProxy, getClientIp };
