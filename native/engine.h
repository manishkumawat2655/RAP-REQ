// engine.h
// Shared data structures and function declarations for the C++ engine.
// Every .cpp file in native/ includes this header so they all agree on
// what a "Backend", a "Balancer" and a "RateLimiter" look like.

#ifndef RAP_PROXY_ENGINE_H
#define RAP_PROXY_ENGINE_H

#include <string>
#include <unordered_map>
#include <vector>

// ---------- backend_state.cpp ----------

// Everything we know about one backend server.
struct Backend {
  int id = 0;
  std::string url;
  int weight = 1;
  bool healthy = true;
  bool removed = false;  // removed from the pool via the dashboard
  int activeConnections = 0;
  long long totalRequests = 0;
  long long failedRequests = 0;
  long long completedRequests = 0;  // finished (success or failure)
  double lastLatencyMs = 0;
  double avgLatencyMs = 0;
  int currentWeight = 0;  // used only by weighted round-robin
};

// The list of all backends plus proxy-wide counters.
struct BackendState {
  std::vector<Backend> backends;
  long long totalRequests = 0;
  long long noBackendErrors = 0;  // requests that found no healthy backend
};

int addBackend(BackendState& state, const std::string& url, int weight);
bool setHealthy(BackendState& state, int id, bool healthy);
void requestStarted(BackendState& state, int id);
void requestFinished(BackendState& state, int id, double latencyMs, bool success);
void recordNoBackend(BackendState& state);
bool isValidId(const BackendState& state, int id);
bool removeBackend(BackendState& state, int id);
bool setWeight(BackendState& state, int id, int weight);
void resetCounters(BackendState& state);

// ---------- balancer.cpp ----------

struct Balancer {
  std::string strategy = "round-robin";
  size_t nextIndex = 0;  // used only by plain round-robin
};

bool isKnownStrategy(const std::string& name);
int pickBackend(Balancer& balancer, BackendState& state, const std::string& clientIp);

// ---------- rate_limiter.cpp ----------

// One "bucket" of tokens per client IP.
struct Bucket {
  double tokens = 0;
  double lastRefillMs = 0;
};

struct RateLimiter {
  bool enabled = true;
  double capacity = 20;         // max burst size
  double refillPerSecond = 10;  // steady-state allowed rate
  std::unordered_map<std::string, Bucket> buckets;
  long long allowedCount = 0;
  long long blockedCount = 0;
};

bool allowRequest(RateLimiter& limiter, const std::string& clientIp, double nowMs);
void resetLimiterCounters(RateLimiter& limiter);

#endif
