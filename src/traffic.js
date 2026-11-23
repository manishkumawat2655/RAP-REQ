// traffic.js
// Two ways to send requests through the proxy:
//   1. startTraffic / stopTraffic: a steady background stream at N req/s,
//      pretending to be several clients (via X-Forwarded-For).
//   2. sendTestRequests: send a few requests one by one and return what
//      happened to each (status + which backend served it).
//      The dashboard's Test Lab uses this.

const http = require('node:http');

const PATHS = ['/', '/api/users', '/api/orders', '/products', '/slow'];

// Only one background traffic stream runs at a time.
let trafficTimer = null;
let stopTimer = null;

// Gives every test request without a fixed IP its own fake address.
let uniqueIpCounter = 0;

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Builds fake client IPs like 10.0.0.1, 10.0.0.2, ...
function makeClientIps(count) {
  const ips = [];
  for (let i = 1; i <= count; i++) {
    ips.push(`10.0.0.${i}`);
  }
  return ips;
}

function nextUniqueIp() {
  uniqueIpCounter += 1;
  return `172.16.${Math.floor(uniqueIpCounter / 250) % 250}.${(uniqueIpCounter % 250) + 1}`;
}

// Fire-and-forget: we never wait for the answer, because a slow backend
// must not slow down the rate at which we generate traffic.
function sendOne(baseUrl, path, clientIp) {
  const url = new URL(path, baseUrl);
  const req = http.get(url, { headers: { 'x-forwarded-for': clientIp } }, (res) => {
    res.resume(); // drain the body so the socket is freed
  });
  req.on('error', () => {
    // Proxy not running or connection reset: ignore and keep going.
  });
}

function stopTraffic() {
  clearInterval(trafficTimer);
  clearTimeout(stopTimer);
  trafficTimer = null;
  stopTimer = null;
}

function isTrafficRunning() {
  return trafficTimer !== null;
}

// `path` is optional: without it every request picks a random path.
// durationSec = 0 means "run until stopTraffic() is called".
function startTraffic({ url, rps, durationSec, clients, path }) {
  stopTraffic();
  const ips = makeClientIps(clients);
  trafficTimer = setInterval(() => {
    sendOne(url, path || randomItem(PATHS), randomItem(ips));
  }, 1000 / rps);

  if (durationSec > 0) {
    stopTimer = setTimeout(stopTraffic, durationSec * 1000);
  }
}

// Used by the CLI: resolves when the duration is over (never if 0).
function runTraffic(options) {
  startTraffic(options);
  return new Promise((resolve) => {
    if (options.durationSec > 0) {
      setTimeout(resolve, options.durationSec * 1000);
    }
  });
}

// Sends `count` requests one after another (not in parallel), so the
// order of results shows the order in which the balancer picked backends.
// clientIp empty → every request gets a different fake IP.
async function sendTestRequests({ url, count, clientIp, path }) {
  const results = [];
  for (let i = 0; i < count; i++) {
    const ip = clientIp || nextUniqueIp();
    try {
      const response = await fetch(new URL(path || '/', url), { headers: { 'x-forwarded-for': ip } });
      const body = await response.text();
      results.push({
        status: response.status,
        backend: response.headers.get('x-rprox-backend'),
        clientIp: ip,
        body: body.slice(0, 200),
      });
    } catch (err) {
      results.push({ status: 0, backend: null, clientIp: ip, body: err.message });
    }
  }
  return results;
}

module.exports = { startTraffic, stopTraffic, isTrafficRunning, runTraffic, sendTestRequests, makeClientIps };
