// scenarios.js
// The Test Lab: one button per test from TESTING.md. Each scenario is a
// short list of API calls (set strategy, send requests, make a backend
// sick...) plus text explaining what you should see.

const SCENARIOS = [
  { title: '1. Basic forwarding', info: 'One request reaches a backend', run: async () => {
    await pauseTraffic();
    const results = await send(1, '', '/hello');
    addOutput('Backend answered: ' + results[0].body);
    check(results[0].status === 200, 'request was forwarded and got 200');
  } },
  { title: '2. Round-robin', info: 'Backends take turns', run: async () => {
    await pauseTraffic();
    await useStrategy('round-robin');
    const results = await send(backends().length * 2);
    const first = results.slice(0, backends().length).map((r) => r.backend);
    check(new Set(first).size === backends().length, 'every backend was used once per round');
  } },
  { title: '3. Weighted round-robin', info: 'Heavier backends get more', run: async () => {
    await pauseTraffic();
    await useStrategy('weighted-round-robin');
    await api('/api/reset-counters');
    addOutput('Weights: ' + backends().map((b) => ':' + new URL(b.url).port + '=' + b.weight).join(', '));
    await send(20);
    addOutput('Look at the "Requests (%)" on each card: shares follow the weights.');
    addOutput('Tip: change a weight on a card and run this test again.');
  } },
  { title: '4. Least-connections', info: 'Slow requests, balanced load', run: async () => {
    await useStrategy('least-connections');
    await api('/api/reset-counters');
    await api('/api/traffic/start', { rps: 30, durationSec: 10, clients: 8, path: '/slow' });
    addOutput('Sending 30 slow requests/second for 10 seconds...');
    addOutput('Watch "Active connections": it stays about equal on every backend.');
    await wait(10000);
    addOutput('Done.', 'pass');
  } },
  { title: '5. IP-hash', info: 'Same client → same backend', run: async () => {
    await pauseTraffic();
    await useStrategy('ip-hash');
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      addOutput('Client ' + ip + ':');
      const results = await send(3, ip);
      check(new Set(results.map((r) => r.backend)).size === 1, ip + ' always went to the same backend');
    }
  } },
  { title: '6. Rate limiting', info: 'Burst of 5, then 429', run: async () => {
    await pauseTraffic();
    const old = { enabled: latestStats.rateLimitEnabled, capacity: latestStats.rateLimitCapacity, refillPerSecond: latestStats.rateLimitRefillPerSecond };
    await api('/api/rate-limit', { enabled: true, capacity: 5, refillPerSecond: 1 });
    addOutput('Temporary limit: burst 5, refill 1 token per second. Sending 10 requests from 6.6.6.6:');
    const results = await send(10, '6.6.6.6');
    check(allStatus(results.slice(0, 5), 200), 'first 5 requests allowed (200)');
    check(results.slice(5).some((r) => r.status === 429), 'then blocked with 429 Too Many Requests');
    const other = await send(1, '7.7.7.7');
    check(other[0].status === 200, 'a different client IP has its own bucket (200)');
    await api('/api/rate-limit', old);
    addOutput('Restored the previous rate limit settings.');
  } },
  { title: '7. Health check', info: 'Sick backend gets no traffic', run: async () => {
    await pauseTraffic();
    await useStrategy('round-robin');
    const target = backends()[1] || backends()[0];
    await api('/api/backends/sick', { id: target.id });
    await healthCheck('Made ' + target.url + ' sick and ran a health check: its card is now red.');
    const results = await send(6);
    check(results.every((r) => r.backend !== target.url), 'no request went to the sick backend');
    addOutput('Healing it in 3 seconds...');
    await wait(3000);
    await api('/api/backends/heal', { id: target.id });
    await healthCheck('Healed: the backend is UP and back in rotation.');
  } },
  { title: '8. No healthy backends', info: 'Everything down → 503', run: async () => {
    await pauseTraffic();
    for (const backend of backends()) {
      await api('/api/backends/sick', { id: backend.id });
    }
    await healthCheck('Made every backend sick and ran a health check.');
    const results = await send(3);
    check(allStatus(results, 503), 'proxy answered 503 Service Unavailable');
    addOutput('Healing everything in 3 seconds...');
    await wait(3000);
    await healAll();
    addOutput('All backends are UP again.');
  } },
  { title: '9. Backend crash', info: 'Crash → 502, then 503', run: async () => {
    await pauseTraffic();
    const targets = backends().filter((b) => demoServerFor(latestStats, b.url));
    if (targets.length === 0) {
      check(false, 'needs demo servers started by this process (use "npm run demo")');
      return;
    }
    for (const backend of targets) {
      await api('/api/backends/crash', { id: backend.id });
    }
    addOutput('Crashed ' + targets.length + ' demo server(s). The engine still thinks they are UP:');
    const before = await send(3);
    check(before.some((r) => r.status === 502), 'connection refused → 502 Bad Gateway');
    await healthCheck('Health check found the crashed servers and marked them DOWN.');
    await send(3);
    addOutput('Restarting the servers in 3 seconds...');
    await wait(3000);
    for (const backend of targets) {
      await api('/api/backends/restart', { id: backend.id });
    }
    await healthCheck('Servers restarted and passed the health check.');
    const after = await send(3);
    check(allStatus(after, 200), 'traffic flows again (200)');
  } },
  { title: '10. Add & remove server', info: 'Change the pool live', run: async () => {
    await pauseTraffic();
    await useStrategy('round-robin');
    const added = await api('/api/backends/add', { port: 5050, weight: 1, startDemo: true });
    addOutput('Started a demo server and added ' + added.url + ' to the pool:');
    let results = await send(backends().length + 1);
    check(results.some((r) => r.backend === added.url), 'the new server receives traffic');
    await api('/api/backends/remove', { id: added.id });
    addOutput('Removed it from the pool:');
    results = await send(4);
    check(results.every((r) => r.backend !== added.url), 'the removed server gets no more traffic');
  } },
];

// ---------- buttons ----------

for (const scenario of SCENARIOS) {
  const button = document.createElement('button');
  button.innerHTML = '<b></b><small></small>';
  button.querySelector('b').textContent = scenario.title;
  button.querySelector('small').textContent = scenario.info;
  button.addEventListener('click', () => runExclusive([scenario]));
  byId('scenarios').appendChild(button);
}
byId('runAll').addEventListener('click', () => runExclusive(SCENARIOS));
byId('clearOutput').addEventListener('click', clearOutput);
