# Testing Rap-Proxy

This guide shows how to check that every part of Rap-Proxy works, in three ways:

1. **Dashboard Test Lab**: click a button, and the test runs and shows PASS/FAIL. This is the easiest way.
2. **Automated tests**: `npm test`, about one second.
3. **Manual tests from the terminal**: the same tests by hand with `curl` and the CLI.

---

## The easiest way: test everything from the dashboard

```bash
npm run demo
```

Open **http://localhost:9090**. The dashboard has three areas.

### Test Lab: one button per test

| Button | What it does | What you should see |
|--------|--------------|---------------------|
| **1. Basic forwarding** | Sends one request | A `200 → :5001` chip and the backend's JSON answer |
| **2. Round-robin** | Switches to round-robin and sends 6 requests | Chips take turns: `:5001 :5002 :5003 :5001 ...` |
| **3. Weighted round-robin** | Resets counters, sends 20 requests | `:5001` (weight 3) appears about 3x as often; card percentages show about 60/20/20 |
| **4. Least-connections** | Sends slow (`/slow`) traffic for 10 s | **Active connections** stays about equal on every card |
| **5. IP-hash** | Sends 3 requests each from 3 client IPs | Each IP always lands on the same backend |
| **6. Rate limiting** | Sets the limit to burst 5 and sends 10 requests from one IP | 5 x `200`, then yellow `429` chips; another IP still gets 200; the old limit is restored |
| **7. Health check** | Makes one backend sick | Its card turns red and no chip goes to it; it heals after 3 s |
| **8. No healthy backends** | Makes every backend sick | Red `503` chips; everything heals after 3 s |
| **9. Backend crash** | Really stops the demo servers | `502` (connection refused), then `503` after the health check, then `200` after restart |
| **10. Add & remove server** | Starts a new server on port 5050, adds it, then removes it | `:5050` appears in the chips, then disappears |

**Run all tests** runs all 10 in order, in about 40 seconds. Every check prints a
green **PASS** or a red **FAIL** line. Most tests pause background traffic first,
so the result chips are easy to read. Restart it from **Controls → Background traffic**.

Each colored chip is one request. The color matches that backend's card. Yellow
means 429 and red means 5xx. Hover over a chip to see which client IP sent it.

### Backend cards: break things by hand

| Control | What it does |
|---------|--------------|
| **Weight** box | Changes the backend's weight in the C++ engine (used by weighted-round-robin) |
| **Make sick / Heal** | The backend starts or stops failing `/health`. It turns red or green at the next health check (within 3 s) |
| **Crash server / Restart server** | Really stops or starts the demo server process. Shown only for demo servers |
| **Remove** | Takes the backend out of the load-balancing pool |

### Controls panel

| Panel | Use it for |
|-------|------------|
| **Strategy** | Switch the algorithm live |
| **Add backend** | Add `localhost:<port>` to the pool, and optionally start a demo server on it |
| **Rate limit** | Turn the limiter on or off, and change burst capacity and refill rate |
| **Background traffic** | Start or stop generated traffic: rate, duration, number of fake clients, path (`/slow` for least-connections) |
| **Send test requests** | Send N requests, optionally from a fixed client IP, and see where each one went |
| **Tools** | Run a health check now, heal all backends, reset all counters |

> These buttons only send commands. The Node.js server passes them to the C++
> engine, and the dashboard shows whatever the engine reports back. The browser
> never picks a backend.

---

## 0. Before you start

```bash
npm install          # installs dependencies and compiles the C++ engine
```

Check that the C++ addon was built:

```bash
ls build/Release/rap_proxy.node
```

> **Changed a `.cpp` file?** Run `npm run build` to recompile. Node keeps using
> the old compiled engine until you do.

> **Windows users:** run the commands in **Git Bash**. In PowerShell, type
> `curl.exe` instead of `curl`, because `curl` in PowerShell is a different command.

---

## 1. Automated tests

```bash
npm test
```

Expected result:

```
# tests 16
# pass 16
# fail 0
```

To run one file only:

```bash
node --test test/engine.test.js     # C++ engine unit tests
node --test test/proxy.test.js      # end-to-end proxy test
```

### What the automated tests cover

| Test file | Test | What it proves |
|-----------|------|----------------|
| `engine.test.js` | round-robin rotates | Picks go `0, 1, 2, 0, 1, 2` |
| `engine.test.js` | weighted-round-robin | Weights 3:1 give 6 of 8 picks to backend 0, in smooth order `0, 0, 1, 0` |
| `engine.test.js` | least-connections | The backend with the fewest active connections is chosen |
| `engine.test.js` | ip-hash | The same client IP always goes to the same backend |
| `engine.test.js` | unhealthy skipped | DOWN backends are never picked; `-1` when none are healthy |
| `engine.test.js` | setHealthy changes | C++ reports a change only when health really flips |
| `engine.test.js` | stats | Totals, failures, active connections and average latency are correct |
| `engine.test.js` | token bucket | Burst allowed, then blocked, then refilled over time, with a separate bucket per IP |
| `engine.test.js` | remove backend | Removed backends are never picked and vanish from stats |
| `engine.test.js` | setWeight | Changing a weight live changes the weighted split |
| `engine.test.js` | resetCounters | All request and rate-limit counters go back to 0 |
| `proxy.test.js` | forwards requests | Real HTTP requests reach real backends in round-robin order |
| `proxy.test.js` | C++ stats updated | The proxy reports every request to the C++ engine |
| `proxy.test.js` | 429 | The 6th request in a burst (capacity 5) is rate-limited |
| `proxy.test.js` | 503 | With every backend DOWN, the proxy answers 503 |

The engine tests pass their own timestamps to `allowRequest(ip, nowMs)`, so the
rate-limiter test never has to wait and always gives the same result.

---

## 2. Manual tests

You need **three terminals** open in the project folder.

**Terminal 1: start 3 demo backends** (ports 5001, 5002, 5003)

```bash
npx rprox backends
```

**Terminal 2: start the proxy** (port 8080) **and the dashboard** (port 9090)

```bash
npx rprox start
```

**Terminal 3:** run the test commands below.

Open **http://localhost:9090** in your browser to watch everything live.

> Every proxied response carries an `x-rprox-backend` header that names the
> backend that served it. Most tests below read this header.

---

### Test 1: Basic forwarding

```bash
curl http://localhost:8080/hello
```

**Expected:** JSON from one of the backends:

```json
{"servedBy":"backend-1","port":5001,"path":"/hello","delayMs":30}
```

Terminal 2 shows a green `200` line, and the dashboard feed shows the request.

---

### Test 2: Round-robin

Start the proxy with `npx rprox start -s round-robin`.

```bash
for i in 1 2 3 4; do
  curl -s -D - -o /dev/null http://localhost:8080/ | grep -i x-rprox
done
```

**Expected:** the backends take turns:

```
x-rprox-backend: http://localhost:5001
x-rprox-backend: http://localhost:5002
x-rprox-backend: http://localhost:5003
x-rprox-backend: http://localhost:5001
```

---

### Test 3: Weighted round-robin

`rprox.config.json` gives the weights **5001 = 3, 5002 = 1, 5003 = 1**.
Restart terminal 2 with:

```bash
npx rprox start -s weighted-round-robin -q
```

Send traffic:

```bash
npx rprox traffic -r 20 -d 10
npx rprox stats
```

**Expected:** backend 5001 gets about **60%** of requests and the other two about **20%** each.
The dashboard's "share of traffic" bars show the same split.

---

### Test 4: Least-connections

The `/slow` route keeps a connection open for about 1 second, so backends build up
active connections. Restart terminal 2 with:

```bash
npx rprox start -s least-connections -q
```

```bash
npx rprox traffic -r 40 -d 15
```

**Expected:** on the dashboard, **Active connections** stays about the same on all
backends. Each new request goes to whichever backend is least busy at that moment.

---

### Test 5: IP-hash (sticky sessions)

Restart terminal 2 with `npx rprox start -s ip-hash`.

```bash
for ip in 1.1.1.1 1.1.1.1 1.1.1.1 2.2.2.2 2.2.2.2 3.3.3.3 3.3.3.3; do
  echo -n "$ip  "
  curl -s -D - -o /dev/null -H "x-forwarded-for: $ip" http://localhost:8080/ | grep -i x-rprox
done
```

**Expected:** the same IP always lands on the **same** backend. Different IPs may
land on different backends, or on the same one:

```
1.1.1.1  x-rprox-backend: http://localhost:5001
1.1.1.1  x-rprox-backend: http://localhost:5001
1.1.1.1  x-rprox-backend: http://localhost:5001
2.2.2.2  x-rprox-backend: http://localhost:5003
2.2.2.2  x-rprox-backend: http://localhost:5003
...
```

---

### Test 6: Rate limiting (HTTP 429)

The default limit (20 burst, 10 per second) is hard to hit by hand. For this test,
lower it in `rprox.config.json`:

```json
"rateLimit": { "enabled": true, "capacity": 5, "refillPerSecond": 1 }
```

Restart terminal 2, then send 10 quick requests from one client:

```bash
for i in $(seq 1 10); do
  curl -s -o /dev/null -w "%{http_code} " -H "x-forwarded-for: 1.2.3.4" http://localhost:8080/
done; echo
```

PowerShell version:

```powershell
1..10 | ForEach-Object { curl.exe -s -o NUL -w "%{http_code} " -H "x-forwarded-for: 1.2.3.4" http://localhost:8080/ }
```

**Expected:**

```
200 200 200 200 200 429 429 429 429 200
```

- The first 5 succeed because the bucket starts full.
- Then the client is blocked with **429**.
- About one second later, one token has refilled, so a request succeeds again.
- Send the same loop with a **different** IP and it succeeds again, because every IP has its own bucket.
- The dashboard's **Rate-limited** counter goes up.

**Remember to set the limit back to `20` / `10` afterwards.**

---

### Test 7: Health checks (backend goes DOWN, then UP)

Make backend 2 "sick":

```bash
curl http://localhost:5002/toggle
```

**Expected within about 3 seconds** (the health check interval):

- Terminal 2 shows: `WARN  Backend http://localhost:5002 is DOWN`
- On the dashboard, the backend 2 card turns red.
- New requests never go to 5002. Check with the round-robin loop from Test 2.

Bring it back:

```bash
curl http://localhost:5002/toggle
```

**Expected:** `INFO  Backend http://localhost:5002 is UP again`, and the backend gets traffic again.

---

### Test 8: No healthy backends (HTTP 503)

```bash
curl http://localhost:5001/toggle
curl http://localhost:5002/toggle
curl http://localhost:5003/toggle
# wait about 3 seconds
curl -i http://localhost:8080/
```

**Expected:**

```
HTTP/1.1 503 Service Unavailable
No healthy backends
```

The dashboard's **No backend (503)** counter goes up. Run the three `toggle`
commands again to bring all backends back.

---

### Test 9: Backend crash (HTTP 502)

1. Start traffic: `npx rprox traffic -r 20 -d 30`
2. Stop terminal 1 (`Ctrl + C`) to kill all the backends.

**Expected:**

- For a moment, requests fail with **502 Bad Gateway** (red lines in terminal 2),
  because the proxy cannot connect to the backend.
- Within about 3 seconds, health checks mark every backend DOWN and the proxy switches to **503**.
- Restart terminal 1 (`npx rprox backends`). The backends come back UP and traffic returns to **200**.

---

### Test 10: Live dashboard

With the proxy running, open **http://localhost:9090** and run `npx rprox traffic -r 30 -d 60`.

Check that:

- [ ] The dot at the top says **live** (green).
- [ ] Total requests keeps increasing.
- [ ] Each backend card flashes blue when it serves a request.
- [ ] The live request feed scrolls with new lines (green 200, yellow 429, red 5xx).
- [ ] Stopping terminal 2 makes the dot say **disconnected, retrying…**, and
      restarting it reconnects by itself.

You can also check the raw data feeds:

```bash
curl http://localhost:9090/api/stats          # JSON snapshot
curl -N http://localhost:9090/events          # SSE stream (Ctrl + C to stop)
```

---

### Test 11: CLI and config errors

```bash
npx rprox --help
npx rprox start -s random
npx rprox start -c does-not-exist.json
```

**Expected:** clear one-line errors instead of crashes:

```
ERROR Unknown strategy "random". Use one of: round-robin, weighted-round-robin, least-connections, ip-hash
ERROR Config file not found: ...\does-not-exist.json
```

---

### Test 12: All-in-one demo

```bash
npm run demo
```

This one command starts the backends, the proxy, the dashboard and traffic.
Open http://localhost:9090 and click **Run all tests** in the Test Lab.
The demo uses a tight rate limit, so yellow **429** lines also appear in the feed.

---

## 3. Troubleshooting

| Problem | Fix |
|---------|-----|
| `Could not load the C++ engine` | Run `npm run build`. On Windows, install Visual Studio Build Tools with "Desktop development with C++". |
| `EADDRINUSE: address already in use :::8080` | Another proxy or demo is still running. Stop it with `Ctrl + C`, or change `port` in the config. |
| All requests return 503 | The backends are not running, or they are toggled sick. Start `npx rprox backends`, or toggle them back. |
| Dashboard shows "disconnected" | The proxy (terminal 2) is not running. |
| C++ change has no effect | Run `npm run build` again. |
