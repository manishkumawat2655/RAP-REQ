// rate_limiter.cpp
// Token bucket rate limiting, one bucket per client IP.
//
// Picture a bucket that holds up to `capacity` tokens. Every request
// takes one token. Tokens drip back in at `refillPerSecond`.
// Empty bucket = request is blocked (HTTP 429).
// This allows short bursts but caps the long-term rate.

#include "engine.h"

// Adds the tokens that "dripped in" since the last time we looked.
static void refill(RateLimiter& limiter, Bucket& bucket, double nowMs) {
  double elapsedSeconds = (nowMs - bucket.lastRefillMs) / 1000.0;
  if (elapsedSeconds <= 0) {
    return;
  }
  bucket.tokens += elapsedSeconds * limiter.refillPerSecond;
  if (bucket.tokens > limiter.capacity) {
    bucket.tokens = limiter.capacity;
  }
  bucket.lastRefillMs = nowMs;
}

// nowMs is passed in (instead of read from a clock here) so that tests
// can control time exactly and get repeatable results.
bool allowRequest(RateLimiter& limiter, const std::string& clientIp, double nowMs) {
  if (!limiter.enabled) {
    limiter.allowedCount += 1;
    return true;
  }

  // First time we see this IP: give it a full bucket.
  if (limiter.buckets.find(clientIp) == limiter.buckets.end()) {
    Bucket fresh;
    fresh.tokens = limiter.capacity;
    fresh.lastRefillMs = nowMs;
    limiter.buckets[clientIp] = fresh;
  }

  Bucket& bucket = limiter.buckets[clientIp];
  refill(limiter, bucket, nowMs);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    limiter.allowedCount += 1;
    return true;
  }

  limiter.blockedCount += 1;
  return false;
}

// Used by the dashboard's "Reset counters" button.
void resetLimiterCounters(RateLimiter& limiter) {
  limiter.allowedCount = 0;
  limiter.blockedCount = 0;
}
