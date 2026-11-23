// events.js
// A single shared EventEmitter (an "event bus").
// The proxy and health checker publish events here; the logger and the
// dashboard subscribe. This keeps those files from depending on each other.
//
// Event names used in this project:
//   'request' → one proxied request finished (or was blocked)
//   'health'  → a backend changed between UP and DOWN

const { EventEmitter } = require('node:events');

const bus = new EventEmitter();

// Many dashboard tabs can be open at once; each adds a listener.
bus.setMaxListeners(100);

module.exports = bus;
