// balancer.cpp
// Decides WHICH backend gets the next request. Four strategies:
//   round-robin, weighted-round-robin, least-connections, ip-hash.
// Unhealthy backends are always skipped. Returns -1 if none are healthy.

#include <functional>

#include "engine.h"

bool isKnownStrategy(const std::string& name) {
  if (name == "round-robin") return true;
  if (name == "weighted-round-robin") return true;
  if (name == "least-connections") return true;
  if (name == "ip-hash") return true;
  return false;
}

// Collects ids of healthy, not-removed backends. Every strategy starts from this list.
static std::vector<int> healthyIds(const BackendState& state) {
  std::vector<int> ids;
  for (const Backend& backend : state.backends) {
    if (backend.healthy && !backend.removed) {
      ids.push_back(backend.id);
    }
  }
  return ids;
}

// Plain rotation: A, B, C, A, B, C ...
static int pickRoundRobin(Balancer& balancer, const std::vector<int>& ids) {
  int chosen = ids[balancer.nextIndex % ids.size()];
  balancer.nextIndex += 1;
  return chosen;
}

// "Smooth" weighted round-robin (the same idea nginx uses).
// With weights A=3, B=1 we get A A B A instead of A A A B,
// which spreads the load more evenly over time.
static int pickWeighted(BackendState& state, const std::vector<int>& ids) {
  int totalWeight = 0;
  int bestId = -1;
  for (int id : ids) {
    Backend& backend = state.backends[id];
    backend.currentWeight += backend.weight;
    totalWeight += backend.weight;
    if (bestId == -1 || backend.currentWeight > state.backends[bestId].currentWeight) {
      bestId = id;
    }
  }
  state.backends[bestId].currentWeight -= totalWeight;
  return bestId;
}

// Send to whoever is busy with the fewest requests right now.
static int pickLeastConnections(const BackendState& state, const std::vector<int>& ids) {
  int bestId = ids[0];
  for (int id : ids) {
    if (state.backends[id].activeConnections < state.backends[bestId].activeConnections) {
      bestId = id;
    }
  }
  return bestId;
}

// The same client IP always lands on the same backend ("sticky sessions"),
// as long as the set of healthy backends does not change.
static int pickIpHash(const std::string& clientIp, const std::vector<int>& ids) {
  size_t hash = std::hash<std::string>{}(clientIp);
  return ids[hash % ids.size()];
}

int pickBackend(Balancer& balancer, BackendState& state, const std::string& clientIp) {
  std::vector<int> ids = healthyIds(state);
  if (ids.empty()) {
    recordNoBackend(state);
    return -1;
  }

  if (balancer.strategy == "weighted-round-robin") {
    return pickWeighted(state, ids);
  } else if (balancer.strategy == "least-connections") {
    return pickLeastConnections(state, ids);
  } else if (balancer.strategy == "ip-hash") {
    return pickIpHash(clientIp, ids);
  } else {
    return pickRoundRobin(balancer, ids);
  }
}
