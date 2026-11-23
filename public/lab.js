// lab.js
// Shared helpers for the Test Lab: the output panel (text lines and
// colored result chips), small test steps used by scenarios.js, and the
// runner that makes sure only one test runs at a time.

const outputEl = document.getElementById('output');

// ---------- output panel ----------

function clearOutput() {
  outputEl.innerHTML = '';
}

// kind: 'title', 'step', 'pass' or 'fail'
function addOutput(text, kind) {
  const line = document.createElement('div');
  line.className = kind || 'step';
  line.textContent = text;
  outputEl.appendChild(line);
  outputEl.scrollTop = outputEl.scrollHeight;
}

// Draws one colored chip per request: "200 → :5001".
// Color = the backend's card color, yellow for 429, red for errors.
function showResults(results) {
  const row = document.createElement('div');
  row.className = 'chips';
  for (const result of results) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.title = 'client IP ' + result.clientIp;
    if (result.status === 200 && result.backend) {
      // A just-added backend may not be in latestStats yet: use gray.
      const backend = latestStats.backends.find((b) => b.url === result.backend);
      chip.style.background = backend ? colorFor(backend.id) : '#9aa4b2';
      chip.textContent = '200 → :' + new URL(result.backend).port;
    } else {
      chip.style.background = result.status === 429 ? '#d29922' : '#e5534b';
      chip.textContent = String(result.status || 'ERR');
    }
    row.appendChild(chip);
  }
  outputEl.appendChild(row);
  outputEl.scrollTop = outputEl.scrollHeight;
}

// ---------- test steps ----------

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backends() {
  return latestStats.backends;
}

// Background traffic would mix into the results, so most tests pause it.
async function pauseTraffic() {
  if (latestStats.trafficRunning) {
    await api('/api/traffic/stop');
    addOutput('Paused background traffic so the results are easy to read.');
  }
}

async function useStrategy(name) {
  await api('/api/strategy', { strategy: name });
  addOutput('Strategy set to ' + name + '.');
}

// Sends requests through the proxy and draws the result chips.
async function send(count, clientIp, path) {
  const data = await api('/api/send', { count, clientIp: clientIp || '', path: path || '/' });
  showResults(data.results);
  return data.results;
}

async function healthCheck(message) {
  await api('/api/health-check');
  addOutput(message || 'Ran a health check.');
}

// Prints a green PASS or red FAIL line.
function check(passed, text) {
  addOutput((passed ? 'PASS  ' : 'FAIL  ') + text, passed ? 'pass' : 'fail');
}

function allStatus(results, status) {
  return results.every((r) => r.status === status);
}

// ---------- runner ----------

let running = false;

function setButtonsDisabled(disabled) {
  for (const button of document.querySelectorAll('#scenarios button, #runAll')) {
    button.disabled = disabled;
  }
}

async function runScenario(scenario) {
  addOutput(scenario.title, 'title');
  try {
    await scenario.run();
  } catch (err) {
    check(false, 'error: ' + err.message);
  }
}

// Only one test runs at a time, because tests change shared settings.
async function runExclusive(list) {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
  clearOutput();
  for (const scenario of list) {
    await runScenario(scenario);
  }
  setButtonsDisabled(false);
  running = false;
}
