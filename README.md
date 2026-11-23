# Rap-Proxy (`rprox`)

A CLI-based **HTTP reverse proxy and load balancer** with a **live dashboard**.
Every load-balancing decision, every rate-limit decision and every statistic is
made by a **C++17 engine**, compiled into a Node.js addon with `node-addon-api`.
Node.js only handles network I/O, timers, the CLI and serving the dashboard.

No `http-proxy`, no load-balancing libraries: just the core Node `http` module.

```
            ┌──────────────────────── Node.js ────────────────────────┐
 client ──► │ proxy.js ──ask──► C++ engine: allowed? which backend?   │ ──► backend 1
            │    │                                                     │ ──► backend 2
            │    └─ events.js ──► logger.js (terminal)                 │ ──► backend 3
            │                └──► dashboard-server.js ──SSE──► browser │
            │ health.js ──GET /health──► backends ──► C++ setHealthy   │
            └──────────────────────────────────────────────────────────┘
```

## Features

- 4 strategies: **round-robin**, **weighted-round-robin** (smooth, nginx-style), **least-connections**, **ip-hash**
- **Token-bucket rate limiting** per client IP (HTTP 429)
- **Active health checks**: unhealthy backends are skipped automatically and rejoin when they recover
- **Live dashboard** over Server-Sent Events: per-backend share of traffic, active connections, latency, live request feed
- **Dashboard control panel**: switch strategy, add/remove backends, change weights, make backends sick, crash/restart servers, change rate limits, start traffic
- **Test Lab**: one-click tests for every feature with PASS/FAIL results (see [TESTING.md](TESTING.md))
- **CLI** with `start`, `demo`, `backends`, `traffic` and `stats` commands
- Tests with the built-in `node:test` runner (unit tests for the engine + end-to-end proxy test)

## Quick start

Requirements: Node.js 20, Python 3, and a C++ compiler
(Windows: Visual Studio Build Tools with "Desktop development with C++"; macOS: Xcode CLI tools; Linux: `build-essential`).

```bash
npm install        # installs deps AND compiles the C++ addon
npm run demo       # backends + proxy + dashboard + traffic, all at once
```

Open **http://localhost:9090** to watch the dashboard.
Use the **Test Lab** buttons to run every test, or the buttons on each backend card to make it sick, crash it, change its weight or remove it.

## CLI usage

```bash
npx rprox backends -n 3 -p 5001                 # start 3 demo backends on 5001-5003
npx rprox start -c rprox.config.json            # start proxy (8080) + dashboard (9090)
npx rprox start -s least-connections -q         # override strategy, hide per-request logs
npx rprox traffic -r 50 -d 20 -k 8              # 50 req/s for 20s from 8 fake client IPs
npx rprox stats                                 # print live stats as a table
npx rprox demo -s ip-hash                       # one-command demo with any strategy
```

Run `npm link` once if you want to type `rprox` directly instead of `npx rprox`.

## Configuration (`rprox.config.json`)

```json
{
  "port": 8080,
  "dashboardPort": 9090,
  "strategy": "round-robin",
  "backends": [
    { "url": "http://localhost:5001", "weight": 3 },
    { "url": "http://localhost:5002", "weight": 1 }
  ],
  "healthCheck": { "intervalMs": 3000, "path": "/health", "timeoutMs": 1000 },
  "rateLimit": { "enabled": true, "capacity": 20, "refillPerSecond": 10 }
}
```

## Project files

| File | Language | Purpose |
|------|----------|---------|
| `native/engine.h` | C++ | Shared structs (`Backend`, `Balancer`, `RateLimiter`) and function declarations |
| `native/balancer.cpp` | C++ | Picks a backend: round-robin, weighted-round-robin, least-connections, ip-hash |
| `native/rate_limiter.cpp` | C++ | Token bucket per client IP; decides allow / block |
| `native/backend_state.cpp` | C++ | Health, active connections, request counts, failures, latency |
| `native/addon.cpp` | C++ | N-API bindings only: converts JS ⇄ C++ values, no logic |
| `binding.gyp` | Build config | Tells node-gyp how to compile the C++ files into `rap_proxy.node` |
| `src/engine.js` | Node.js | Loads the compiled addon and exposes small wrapper functions |
| `src/config.js` | Node.js | Loads the JSON config, fills defaults, validates it |
| `src/proxy.js` | Node.js | HTTP reverse proxy: asks C++ for decisions, streams request/response |
| `src/health.js` | Node.js | Periodic `GET /health` checks; reports results to C++ |
| `src/events.js` | Node.js | Shared EventEmitter connecting proxy/health to logger/dashboard |
| `src/logger.js` | Node.js | Colored terminal logs |
| `src/dashboard-server.js` | Node.js | Serves the dashboard files, SSE stream and `/api/stats` |
| `src/control.js` | Node.js | Control API for the dashboard buttons; passes every change to C++ |
| `src/traffic.js` | Node.js | Load generator with fake client IPs |
| `src/cli.js` | Node.js | `rprox` command built with commander |
| `demo/backends.js` | Node.js | Fake backend servers (`/health`, `/sick`, `/heal`, `/slow`, `/fast`) that can be crashed and restarted |
| `public/index.html` | HTML (browser) | Dashboard layout: backend cards, Test Lab, controls, live feed |
| `public/style.css` | CSS (browser) | Dark theme and layout |
| `public/dashboard.js` | JS (browser) | Receives SSE updates and draws cards, header and feed |
| `public/controls.js` | JS (browser) | Buttons and forms; each one sends a command to the control API |
| `public/lab.js` | JS (browser) | Test Lab helpers: output panel, result chips, test runner |
| `public/scenarios.js` | JS (browser) | The 10 one-click tests |
| `test/engine.test.js` | Node.js | Unit tests for every strategy, health and the rate limiter |
| `test/proxy.test.js` | Node.js | End-to-end test with real backends and a real proxy |

## How each file works

**`native/engine.h`** — The "contract" between the C++ files. It defines what a backend
looks like (url, weight, health, counters) and declares every engine function, so
`balancer.cpp`, `rate_limiter.cpp` and `backend_state.cpp` all agree on the same data.

**`native/balancer.cpp`** — First collects the ids of healthy backends, then applies the
chosen strategy. Round-robin rotates an index; weighted-round-robin uses the "smooth"
algorithm so heavy backends are spread out (A A B A, not A A A B); least-connections
picks the smallest `activeConnections`; ip-hash hashes the client IP so it is sticky.

**`native/rate_limiter.cpp`** — Each client IP gets a bucket of tokens. A request costs
one token, and tokens refill at a fixed rate up to a maximum (`capacity`). An empty
bucket means "block". The current time is passed in, which makes it easy to test.

**`native/backend_state.cpp`** — Holds the live numbers. `requestStarted` increments
active connections and totals; `requestFinished` decrements active connections,
counts failures and updates a running average latency. `setHealthy` returns whether
the health actually changed so Node only logs real transitions.

**`native/addon.cpp`** — The bridge between JavaScript and C++. Each exported function
reads JS arguments, calls one engine function, and returns the result as a JS value.
It holds the single global engine object; there is no business logic here.

**`src/engine.js`** — Loads `build/Release/rap_proxy.node` and wraps it in friendly
functions like `pickBackend(ip)`. `setup(config)` resets the engine and loads the
strategy, rate limits and backends. It is the only file that touches the addon.

**`src/config.js`** — Reads the JSON config and merges it with defaults, so you only
write the values you want to change. It validates the strategy name and backend URLs
so mistakes are reported at startup, not in the middle of serving traffic.

**`src/proxy.js`** — For every request: get the client IP, ask C++ "allowed?" (else 429),
ask C++ "which backend?" (else 503), then stream the request to that backend with
`http.request` and pipe the answer back. When the response closes, it reports the
latency and success to C++ and emits a `request` event.

**`src/health.js`** — On a timer, sends `GET /health` to every backend with a timeout.
The result (healthy or not) is passed to C++ via `setHealthy`. When C++ says the
status changed, it logs it and emits a `health` event.

**`src/events.js`** — A single `EventEmitter` shared by the whole app. The proxy and
health checker publish events, and the logger and dashboard listen. This keeps the
files independent of each other.

**`src/logger.js`** — Prints timestamped, colored lines using ANSI codes (no library).
Request lines are green/yellow/red by status code, and can be silenced with quiet
mode when traffic is heavy.

**`src/dashboard-server.js`** — A small HTTP server. `/` returns the dashboard page,
`/events` keeps an SSE connection open and pushes C++ stats every 500 ms plus each
request as it happens, and `/api/stats` returns the stats as JSON for the CLI.

**`src/traffic.js`** — Sends GET requests at a fixed rate to random paths, each with a
fake `X-Forwarded-For` IP so the proxy sees many different clients. It does not wait
for answers, so slow backends do not lower the request rate.

**`src/cli.js`** — Defines the `rprox` commands with commander. `start` loads the config
and starts everything, `demo` also launches demo backends and traffic, `stats` fetches
`/api/stats` and prints it with `console.table`.

**`demo/backends.js`** — Starts simple HTTP servers that reply with their name after a
small random delay. `/health` reports health, `/sick` and `/heal` change it, and `/slow`
responds slowly to show least-connections. It remembers the servers it started, so the
dashboard can crash and restart them.

**`src/control.js`** — The control API behind the dashboard buttons. Each route
(`POST /api/strategy`, `/api/backends/add`, `/api/rate-limit` ...) reads a small JSON
body and calls one engine function, or does I/O such as starting a demo server or
calling a backend's `/sick`. It never makes a load-balancing decision itself.

**`public/index.html`** + **`style.css`** — The page layout and theme: header counters,
one card per backend, the Test Lab, the control panels and the live request feed.
There is no framework and no build step. The browser loads the files as they are.

**`public/dashboard.js`** — Opens an `EventSource('/events')`. Every 500 ms it gets
C++ stats and updates the cards (built once, then only their text changes). It adds
each request to the live feed and flashes the card of the backend that served it.

**`public/controls.js`** — One small `api()` helper that POSTs JSON, plus a handler
for every button and form. Errors from the server appear as a red message in the
corner, so a bad input never breaks the page.

**`public/lab.js`** + **`scenarios.js`** — The Test Lab. Each scenario is a short
list of API calls (set strategy, send requests, make a backend sick) followed by
PASS/FAIL checks on the results. Only one test runs at a time, because tests
change shared settings.

## Testing

```bash
npm test
```

See **[TESTING.md](TESTING.md)** for step-by-step manual tests of every feature
(each strategy, rate limiting, health checks, 502/503 handling and the dashboard).


