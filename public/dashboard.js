// dashboard.js
// Live view: listens to the SSE stream and draws the header numbers,
// one card per backend, and the live request feed. Display only.

const MAX_FEED_LINES = 80;
const BACKEND_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f778ba', '#39c5cf', '#ff9e64'];
const cardsEl = document.getElementById('cards');
const feedEl = document.getElementById('feed');

// The newest stats from the server. controls.js and scenarios.js read it.
let latestStats = null;

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

// Each backend gets a fixed color, used on its card and in test results.
function colorFor(backendId) {
  return BACKEND_COLORS[backendId % BACKEND_COLORS.length];
}

// Finds the demo server (started by this Node process) behind a backend URL.
function demoServerFor(stats, url) {
  const port = new URL(url).port;
  return stats.demoServers.find((server) => String(server.port) === port);
}

// Builds a card once. Later updates only change text, so typing in the
// weight box is not interrupted every 500 ms.
function createCard(backend) {
  const card = document.createElement('div');
  card.id = 'backend-' + backend.id;
  card.className = 'card';
  card.dataset.id = backend.id;
  card.innerHTML = `
    <div class="card-top"><span class="url" data-field="url"></span><span class="badge" data-field="status"></span></div>
    <div class="row">Weight <input class="weight" type="number" min="1" data-field="weight"></div>
    <div class="row">Active connections <b data-field="active"></b></div>
    <div class="row">Requests <b data-field="requests"></b></div>
    <div class="row">Failed <b data-field="failed"></b></div>
    <div class="row">Avg latency <b data-field="latency"></b></div>
    <div class="bar"><div data-field="bar"></div></div>
    <div class="stopped" data-field="stopped"></div>
    <div class="actions">
      <button class="small" data-action="sick"></button>
      <button class="small" data-action="crash"></button>
      <button class="small danger" data-action="remove">Remove</button>
    </div>`;
  field(card, 'url').textContent = backend.url.replace('http://', '');
  field(card, 'url').style.color = colorFor(backend.id);
  cardsEl.appendChild(card);
  return card;
}

function field(card, name) {
  return card.querySelector('[data-field="' + name + '"]');
}

function updateCard(card, backend, share, demoServer) {
  card.classList.toggle('down', !backend.healthy);
  field(card, 'status').textContent = backend.healthy ? 'UP' : 'DOWN';
  field(card, 'active').textContent = backend.activeConnections;
  field(card, 'requests').textContent = backend.totalRequests + ' (' + share.toFixed(1) + '%)';
  field(card, 'failed').textContent = backend.failedRequests;
  field(card, 'latency').textContent = backend.avgLatencyMs.toFixed(1) + ' ms';
  field(card, 'bar').style.width = share + '%';

  const weightInput = field(card, 'weight');
  if (document.activeElement !== weightInput) {
    weightInput.value = backend.weight;
  }

  // The same button is "Make sick" or "Heal" depending on current health.
  const sickButton = card.querySelector('[data-action="sick"], [data-action="heal"]');
  sickButton.dataset.action = backend.healthy ? 'sick' : 'heal';
  sickButton.textContent = backend.healthy ? 'Make sick' : 'Heal';

  // Crash/Restart only exists for demo servers this process started.
  const crashButton = card.querySelector('[data-action="crash"], [data-action="restart"]');
  crashButton.hidden = !demoServer;
  if (demoServer) {
    crashButton.dataset.action = demoServer.running ? 'crash' : 'restart';
    crashButton.textContent = demoServer.running ? 'Crash server' : 'Restart server';
  }
  field(card, 'stopped').textContent = demoServer && !demoServer.running ? 'Server process is stopped' : '';
}

function renderStats(stats) {
  latestStats = stats;
  setText('strategy', stats.strategy);
  setText('total', stats.totalRequests);
  setText('blocked', stats.rateLimitBlocked);
  setText('nobackend', stats.noBackendErrors);
  setText('trafficState', stats.trafficRunning ? 'running' : 'off');

  let sum = 0;
  for (const backend of stats.backends) {
    sum += backend.totalRequests;
  }
  const liveIds = [];
  for (const backend of stats.backends) {
    const card = document.getElementById('backend-' + backend.id) || createCard(backend);
    const share = sum > 0 ? (backend.totalRequests / sum) * 100 : 0;
    updateCard(card, backend, share, demoServerFor(stats, backend.url));
    liveIds.push('backend-' + backend.id);
  }
  // Remove cards of backends that were removed from the pool.
  for (const card of [...cardsEl.children]) {
    if (!liveIds.includes(card.id)) {
      card.remove();
    }
  }
  syncForms(stats);
}

function statusClass(status) {
  if (status >= 500 || status === 0) return 'err';
  if (status >= 400) return 'warn';
  return 'ok';
}

// Adds a line to the feed and briefly highlights the backend that served it.
function addRequest(event) {
  const line = document.createElement('div');
  line.className = 'line ' + statusClass(event.status);
  const target = event.backendUrl || '(not forwarded)';
  line.textContent = new Date(event.time).toLocaleTimeString() + '  ' + event.status + '  ' +
    event.clientIp + '  ' + event.method + ' ' + event.path + '  →  ' + target + '  ' + event.latencyMs.toFixed(1) + 'ms';
  feedEl.prepend(line);
  while (feedEl.children.length > MAX_FEED_LINES) {
    feedEl.lastChild.remove();
  }
  const card = document.getElementById('backend-' + event.backendId);
  if (card) {
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 150);
  }
}

// Card buttons: one click handler for all cards ("event delegation").
cardsEl.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-action]');
  if (button) {
    backendAction(button.dataset.action, Number(button.closest('.card').dataset.id));
  }
});
cardsEl.addEventListener('change', (e) => {
  if (e.target.classList.contains('weight')) {
    setWeight(Number(e.target.closest('.card').dataset.id), Number(e.target.value));
  }
});

// EventSource reconnects automatically if the server restarts.
const source = new EventSource('/events');
source.onopen = () => {
  document.getElementById('conn').classList.add('on');
  setText('connText', 'live');
};
source.onerror = () => {
  document.getElementById('conn').classList.remove('on');
  setText('connText', 'disconnected, retrying…');
};
source.addEventListener('stats', (e) => renderStats(JSON.parse(e.data)));
source.addEventListener('request', (e) => addRequest(JSON.parse(e.data)));
