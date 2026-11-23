// logger.js
// Prints colored, one-line logs to the terminal.
// Colors use plain ANSI escape codes, so no extra library is needed.

const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

let quiet = false;

function setQuiet(value) {
  quiet = value;
}

function time() {
  return new Date().toISOString().slice(11, 23);
}

function print(color, label, message) {
  console.log(`${COLORS.gray}${time()}${COLORS.reset} ${color}${label}${COLORS.reset} ${message}`);
}

function info(message) {
  print(COLORS.cyan, 'INFO ', message);
}

function warn(message) {
  print(COLORS.yellow, 'WARN ', message);
}

function error(message) {
  print(COLORS.red, 'ERROR', message);
}

// Picks a color based on the HTTP status so problems stand out.
function statusColor(status) {
  if (status >= 500) {
    return COLORS.red;
  } else if (status >= 400) {
    return COLORS.yellow;
  }
  return COLORS.green;
}

// Request lines can be very noisy under load, so they respect quiet mode.
function request(event) {
  if (quiet) {
    return;
  }
  const target = event.backendUrl || '-';
  const line = `${event.method} ${event.path} → ${target} ${event.latencyMs.toFixed(1)}ms (${event.clientIp})`;
  print(statusColor(event.status), String(event.status).padEnd(5), line);
}

module.exports = { info, warn, error, request, setQuiet };
