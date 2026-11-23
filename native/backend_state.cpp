// backend_state.cpp
// Keeps the live state of every backend: health, open connections,
// request counts and latency. Node.js reports events ("a request started",
// "a request finished") and this file does all of the counting.

#include "engine.h"

bool isValidId(const BackendState& state, int id) {
  if (id < 0) {
    return false;
  }
  return id < static_cast<int>(state.backends.size());
}

// "Active" = exists and was not removed. Only active backends can be changed.
static bool isActiveId(const BackendState& state, int id) {
  if (!isValidId(state, id)) {
    return false;
  }
  return !state.backends[id].removed;
}

// A weight below 1 would make a backend unreachable, so clamp it.
static int clampWeight(int weight) {
  if (weight < 1) {
    return 1;
  }
  return weight;
}

// Registers a new backend and returns its id (its index in the list).
int addBackend(BackendState& state, const std::string& url, int weight) {
  Backend backend;
  backend.id = static_cast<int>(state.backends.size());
  backend.url = url;
  backend.weight = clampWeight(weight);
  state.backends.push_back(backend);
  return backend.id;
}

// "Soft delete": the slot stays in the vector so the ids of the other
// backends do not shift. Requests already in flight can still finish.
bool removeBackend(BackendState& state, int id) {
  if (!isActiveId(state, id)) {
    return false;
  }
  state.backends[id].removed = true;
  return true;
}

bool setWeight(BackendState& state, int id, int weight) {
  if (!isActiveId(state, id)) {
    return false;
  }
  state.backends[id].weight = clampWeight(weight);
  // Restart weighted round-robin from a clean state with the new weights.
  for (Backend& backend : state.backends) {
    backend.currentWeight = 0;
  }
  return true;
}

// Zeroes the counters but keeps backends, health and weights.
// activeConnections is NOT reset: those requests are really still running.
void resetCounters(BackendState& state) {
  for (Backend& backend : state.backends) {
    backend.totalRequests = 0;
    backend.failedRequests = 0;
    backend.completedRequests = 0;
    backend.lastLatencyMs = 0;
    backend.avgLatencyMs = 0;
  }
  state.totalRequests = 0;
  state.noBackendErrors = 0;
}

// Returns true only when the health status actually changed, so Node.js
// can log "backend went DOWN/UP" once instead of on every health check.
bool setHealthy(BackendState& state, int id, bool healthy) {
  if (!isActiveId(state, id)) {
    return false;
  }
  Backend& backend = state.backends[id];
  if (backend.healthy == healthy) {
    return false;
  }
  backend.healthy = healthy;
  return true;
}

void requestStarted(BackendState& state, int id) {
  if (!isValidId(state, id)) {
    return;
  }
  Backend& backend = state.backends[id];
  backend.activeConnections += 1;
  backend.totalRequests += 1;
  state.totalRequests += 1;
}

void requestFinished(BackendState& state, int id, double latencyMs, bool success) {
  if (!isValidId(state, id)) {
    return;
  }
  Backend& backend = state.backends[id];

  // Never go below zero, even if Node reports a finish twice by mistake.
  if (backend.activeConnections > 0) {
    backend.activeConnections -= 1;
  }
  backend.completedRequests += 1;
  if (!success) {
    backend.failedRequests += 1;
  }

  backend.lastLatencyMs = latencyMs;
  // Running average: avoids storing every latency we have ever seen.
  double count = static_cast<double>(backend.completedRequests);
  if (count <= 1) {
    backend.avgLatencyMs = latencyMs;
  } else {
    backend.avgLatencyMs = backend.avgLatencyMs + (latencyMs - backend.avgLatencyMs) / count;
  }
}

// Counted separately because no backend was involved in this request.
void recordNoBackend(BackendState& state) {
  state.totalRequests += 1;
  state.noBackendErrors += 1;
}
