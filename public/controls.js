// controls.js
// Wires up every button and form on the dashboard.
// Each action is a POST to the Node.js control API (src/control.js),
// which passes the change on to the C++ engine.

let rateLimitFormFilled = false;

function byId(id) {
  return document.getElementById(id);
}

// POST a JSON body and return the JSON answer. Throws on errors so
// callers can show the server's message.
async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

let toastTimer = null;
function toast(message, isError) {
  const el = byId('toast');
  el.textContent = message;
  el.className = isError ? 'error' : '';
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// Runs an async task and shows any error as a red toast.
async function safely(task) {
  try {
    return await task();
  } catch (err) {
    toast(err.message, true);
    return null;
  }
}

// ---------- backend card buttons (called from dashboard.js) ----------

const ACTION_MESSAGES = {
  sick: 'Backend will now fail its health checks',
  heal: 'Backend will now pass its health checks',
  crash: 'Server crashed: requests fail (502) until a health check marks it DOWN',
  restart: 'Server restarted',
  remove: 'Backend removed from the pool',
};

function backendAction(action, id) {
  safely(async () => {
    if (action === 'remove' && !confirm('Remove this backend from the pool?')) {
      return;
    }
    await api('/api/backends/' + action, { id });
    toast(ACTION_MESSAGES[action]);
  });
}

function setWeight(id, weight) {
  safely(async () => {
    await api('/api/backends/weight', { id, weight });
    toast('Weight set to ' + weight);
  });
}

// Heals every backend, then re-checks health right away.
async function healAll() {
  for (const backend of latestStats.backends) {
    await api('/api/backends/heal', { id: backend.id }).catch(() => {});
  }
  await api('/api/health-check');
}

// Called by dashboard.js on every stats update.
function syncForms(stats) {
  if (document.activeElement !== byId('strategySelect')) {
    byId('strategySelect').value = stats.strategy;
  }
  // Filled once only, so the server never overwrites what you are typing.
  if (!rateLimitFormFilled) {
    byId('rlEnabled').checked = stats.rateLimitEnabled;
    byId('rlCapacity').value = stats.rateLimitCapacity;
    byId('rlRefill').value = stats.rateLimitRefillPerSecond;
    rateLimitFormFilled = true;
  }
}

// ---------- control panel forms ----------

function on(id, eventName, handler) {
  byId(id).addEventListener(eventName, () => safely(handler));
}

on('strategySelect', 'change', async () => {
  await api('/api/strategy', { strategy: byId('strategySelect').value });
  toast('Strategy: ' + byId('strategySelect').value);
});
on('addBackend', 'click', async () => {
  const result = await api('/api/backends/add', {
    port: Number(byId('addPort').value),
    weight: Number(byId('addWeight').value),
    startDemo: byId('addDemo').checked,
  });
  toast('Added ' + result.url);
  byId('addPort').value = Number(byId('addPort').value) + 1;
});
on('rlApply', 'click', async () => {
  await api('/api/rate-limit', {
    enabled: byId('rlEnabled').checked,
    capacity: Number(byId('rlCapacity').value),
    refillPerSecond: Number(byId('rlRefill').value),
  });
  toast('Rate limit updated');
});
on('trStart', 'click', async () => {
  await api('/api/traffic/start', {
    rps: Number(byId('trRps').value),
    durationSec: Number(byId('trSeconds').value),
    clients: Number(byId('trClients').value),
    path: byId('trPath').value,
  });
  toast('Traffic started');
});
on('trStop', 'click', async () => {
  await api('/api/traffic/stop');
  toast('Traffic stopped');
});
on('sendButton', 'click', async () => {
  const count = Number(byId('sendCount').value);
  const data = await api('/api/send', { count, clientIp: byId('sendIp').value.trim(), path: byId('sendPath').value });
  addOutput('Sent ' + count + ' request(s):', 'title');
  showResults(data.results);
});
on('healthNow', 'click', async () => {
  await api('/api/health-check');
  toast('Health check done');
});
on('healAll', 'click', async () => {
  await healAll();
  toast('All backends healed');
});
on('resetCounters', 'click', async () => {
  await api('/api/reset-counters');
  toast('Counters reset');
});
