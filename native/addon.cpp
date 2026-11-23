// addon.cpp
// N-API bindings ONLY. Each function here converts JavaScript arguments
// into C++ values, calls the real logic in the other .cpp files, and
// converts the result back to JavaScript. No decisions are made here.

#include <napi.h>

#include <chrono>

#include "engine.h"

// One global engine. The proxy only ever needs one.
static BackendState gState;
static Balancer gBalancer;
static RateLimiter gLimiter;

// Monotonic clock in milliseconds (never jumps back like wall-clock time).
static double nowMs() {
  auto now = std::chrono::steady_clock::now().time_since_epoch();
  return std::chrono::duration<double, std::milli>(now).count();
}

// Small helpers so every binding below stays one or two lines long.
static int argInt(const Napi::CallbackInfo& info, int index) {
  return info[index].As<Napi::Number>().Int32Value();
}
static double argDouble(const Napi::CallbackInfo& info, int index) {
  return info[index].As<Napi::Number>().DoubleValue();
}
static bool argBool(const Napi::CallbackInfo& info, int index) {
  return info[index].As<Napi::Boolean>().Value();
}
static std::string argString(const Napi::CallbackInfo& info, int index) {
  return info[index].As<Napi::String>().Utf8Value();
}

Napi::Value Reset(const Napi::CallbackInfo& info) {
  gState = BackendState();
  gBalancer = Balancer();
  gLimiter = RateLimiter();
  return info.Env().Undefined();
}

Napi::Value SetStrategy(const Napi::CallbackInfo& info) {
  std::string name = argString(info, 0);
  if (!isKnownStrategy(name)) {
    Napi::Error::New(info.Env(), "Unknown strategy: " + name).ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  gBalancer.strategy = name;
  return info.Env().Undefined();
}

Napi::Value ConfigureRateLimit(const Napi::CallbackInfo& info) {
  gLimiter.enabled = argBool(info, 0);
  gLimiter.capacity = argDouble(info, 1);
  gLimiter.refillPerSecond = argDouble(info, 2);
  gLimiter.buckets.clear();
  return info.Env().Undefined();
}

Napi::Value AddBackend(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), addBackend(gState, argString(info, 0), argInt(info, 1)));
}

Napi::Value RemoveBackend(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), removeBackend(gState, argInt(info, 0)));
}

Napi::Value SetWeight(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), setWeight(gState, argInt(info, 0), argInt(info, 1)));
}

Napi::Value GetBackendUrl(const Napi::CallbackInfo& info) {
  int id = argInt(info, 0);
  if (!isValidId(gState, id)) {
    return info.Env().Null();
  }
  return Napi::String::New(info.Env(), gState.backends[id].url);
}

Napi::Value PickBackend(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), pickBackend(gBalancer, gState, argString(info, 0)));
}

Napi::Value AllowRequest(const Napi::CallbackInfo& info) {
  // Tests may pass their own time; normal calls use the real clock.
  double time = nowMs();
  if (info.Length() > 1 && info[1].IsNumber()) {
    time = argDouble(info, 1);
  }
  return Napi::Boolean::New(info.Env(), allowRequest(gLimiter, argString(info, 0), time));
}

Napi::Value RequestStarted(const Napi::CallbackInfo& info) {
  requestStarted(gState, argInt(info, 0));
  return info.Env().Undefined();
}

Napi::Value RequestFinished(const Napi::CallbackInfo& info) {
  requestFinished(gState, argInt(info, 0), argDouble(info, 1), argBool(info, 2));
  return info.Env().Undefined();
}

Napi::Value SetHealthy(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), setHealthy(gState, argInt(info, 0), argBool(info, 1)));
}

Napi::Value ResetCounters(const Napi::CallbackInfo& info) {
  resetCounters(gState);
  resetLimiterCounters(gLimiter);
  return info.Env().Undefined();
}

// Turns one C++ Backend into a plain JavaScript object.
static Napi::Object backendToJs(Napi::Env env, const Backend& b) {
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("id", b.id);
  obj.Set("url", b.url);
  obj.Set("weight", b.weight);
  obj.Set("healthy", b.healthy);
  obj.Set("activeConnections", b.activeConnections);
  obj.Set("totalRequests", static_cast<double>(b.totalRequests));
  obj.Set("failedRequests", static_cast<double>(b.failedRequests));
  obj.Set("lastLatencyMs", b.lastLatencyMs);
  obj.Set("avgLatencyMs", b.avgLatencyMs);
  return obj;
}

Napi::Value GetStats(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array list = Napi::Array::New(env);
  uint32_t index = 0;
  for (const Backend& backend : gState.backends) {
    if (!backend.removed) {
      list.Set(index, backendToJs(env, backend));
      index += 1;
    }
  }

  Napi::Object stats = Napi::Object::New(env);
  stats.Set("strategy", gBalancer.strategy);
  stats.Set("totalRequests", static_cast<double>(gState.totalRequests));
  stats.Set("noBackendErrors", static_cast<double>(gState.noBackendErrors));
  stats.Set("rateLimitEnabled", gLimiter.enabled);
  stats.Set("rateLimitCapacity", gLimiter.capacity);
  stats.Set("rateLimitRefillPerSecond", gLimiter.refillPerSecond);
  stats.Set("rateLimitAllowed", static_cast<double>(gLimiter.allowedCount));
  stats.Set("rateLimitBlocked", static_cast<double>(gLimiter.blockedCount));
  stats.Set("backends", list);
  return stats;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("reset", Napi::Function::New(env, Reset));
  exports.Set("setStrategy", Napi::Function::New(env, SetStrategy));
  exports.Set("configureRateLimit", Napi::Function::New(env, ConfigureRateLimit));
  exports.Set("addBackend", Napi::Function::New(env, AddBackend));
  exports.Set("removeBackend", Napi::Function::New(env, RemoveBackend));
  exports.Set("setWeight", Napi::Function::New(env, SetWeight));
  exports.Set("getBackendUrl", Napi::Function::New(env, GetBackendUrl));
  exports.Set("pickBackend", Napi::Function::New(env, PickBackend));
  exports.Set("allowRequest", Napi::Function::New(env, AllowRequest));
  exports.Set("requestStarted", Napi::Function::New(env, RequestStarted));
  exports.Set("requestFinished", Napi::Function::New(env, RequestFinished));
  exports.Set("setHealthy", Napi::Function::New(env, SetHealthy));
  exports.Set("resetCounters", Napi::Function::New(env, ResetCounters));
  exports.Set("getStats", Napi::Function::New(env, GetStats));
  return exports;
}

NODE_API_MODULE(rap_proxy, Init)
