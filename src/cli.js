#!/usr/bin/env node
// cli.js
// Entry point for the `rprox` command. Uses commander to define:
//   rprox start     → run proxy + dashboard + health checks from a config file
//   rprox backends  → start fake backend servers
//   rprox traffic   → generate load against the proxy
//   rprox demo      → everything above in one command
//   rprox stats     → print live stats as a table

const { Command } = require('commander');
const { loadConfig, buildConfig, STRATEGIES } = require('./config');
const engine = require('./engine');
const bus = require('./events');
const logger = require('./logger');
const { startProxy } = require('./proxy');
const { startDashboard } = require('./dashboard-server');
const { startHealthChecks } = require('./health');
const { runTraffic, startTraffic } = require('./traffic');
const { startBackends } = require('../demo/backends');

// Shared by `start` and `demo`: loads config into C++ and opens the ports.
async function startAll(config, quiet) {
  logger.setQuiet(quiet);
  engine.setup(config);
  bus.on('request', logger.request);

  await startProxy(config);
  await startDashboard(config);
  startHealthChecks(config);

  logger.info(`Proxy listening on      http://localhost:${config.port}`);
  logger.info(`Dashboard available at  http://localhost:${config.dashboardPort}`);
  logger.info(`Strategy: ${config.strategy} | Backends: ${config.backends.length}`);
}

// Turns C++ stats into rows that look nice in console.table.
function printStatsTable(stats) {
  const rows = stats.backends.map((b) => ({
    backend: b.url,
    healthy: b.healthy ? 'UP' : 'DOWN',
    weight: b.weight,
    active: b.activeConnections,
    total: b.totalRequests,
    failed: b.failedRequests,
    'avg ms': b.avgLatencyMs.toFixed(1),
  }));
  console.log(`Strategy: ${stats.strategy}   Total requests: ${stats.totalRequests}`);
  console.log(`Rate limiter: ${stats.rateLimitAllowed} allowed, ${stats.rateLimitBlocked} blocked`);
  console.table(rows);
}

const program = new Command();
program.name('rprox').description('Rap-Proxy: reverse proxy + load balancer with a C++ engine').version('1.0.0');

program
  .command('start')
  .description('start the proxy using a config file')
  .option('-c, --config <file>', 'path to config file', 'rprox.config.json')
  .option('-s, --strategy <name>', `override strategy (${STRATEGIES.join(' | ')})`)
  .option('-q, --quiet', 'do not log every request', false)
  .action(async (opts) => {
    const config = loadConfig(opts.config);
    if (opts.strategy) {
      config.strategy = opts.strategy;
    }
    // Build again so the overridden strategy is validated too.
    await startAll(buildConfig(config), opts.quiet);
  });

program
  .command('backends')
  .description('start demo backend servers')
  .option('-n, --count <n>', 'how many backends', '3')
  .option('-p, --port <port>', 'first port', '5001')
  .action(async (opts) => {
    const count = Number(opts.count);
    const port = Number(opts.port);
    await startBackends(count, port);
    logger.info(`Started ${count} demo backends on ports ${port}-${port + count - 1}`);
  });

program
  .command('traffic')
  .description('send generated traffic to the proxy')
  .option('-u, --url <url>', 'proxy url', 'http://localhost:8080')
  .option('-r, --rps <n>', 'requests per second', '20')
  .option('-d, --duration <sec>', 'seconds to run (0 = forever)', '30')
  .option('-k, --clients <n>', 'number of fake client IPs', '8')
  .action(async (opts) => {
    logger.info(`Sending ${opts.rps} req/s to ${opts.url} from ${opts.clients} fake clients`);
    await runTraffic({
      url: opts.url,
      rps: Number(opts.rps),
      durationSec: Number(opts.duration),
      clients: Number(opts.clients),
    });
    logger.info('Traffic finished. Run "rprox stats" to see the results.');
  });

program
  .command('demo')
  .description('start backends, proxy, dashboard and traffic in one go')
  .option('-s, --strategy <name>', 'load-balancing strategy', 'weighted-round-robin')
  .option('-r, --rps <n>', 'requests per second', '25')
  .action(async (opts) => {
    await startBackends(3, 5001);
    const config = buildConfig({
      strategy: opts.strategy,
      backends: [
        { url: 'http://localhost:5001', weight: 3 },
        { url: 'http://localhost:5002', weight: 1 },
        { url: 'http://localhost:5003', weight: 1 },
      ],
      // Tight limit on purpose, so some 429s show up on the dashboard.
      rateLimit: { capacity: 10, refillPerSecond: 2 },
    });
    await startAll(config, true);
    logger.info('Open the dashboard: every test can be run from its Test Lab panel');
    // Background traffic; it can be stopped and restarted from the dashboard.
    startTraffic({ url: `http://localhost:${config.port}`, rps: Number(opts.rps), durationSec: 0, clients: 8 });
  });

program
  .command('stats')
  .description('print live stats from a running proxy')
  .option('-p, --port <port>', 'dashboard port', '9090')
  .action(async (opts) => {
    const response = await fetch(`http://localhost:${opts.port}/api/stats`);
    printStatsTable(await response.json());
  });

// Show errors as a single friendly line instead of a stack trace.
program.parseAsync(process.argv).catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
