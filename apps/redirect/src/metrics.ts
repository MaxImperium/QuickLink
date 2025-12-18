/**
 * Metrics Module - Performance Optimized
 *
 * Lightweight instrumentation for monitoring redirect performance.
 * Prometheus-compatible output format.
 *
 * Design Decisions:
 * - In-memory counters (no external dependencies)
 * - Lock-free increments (single-threaded Node.js)
 * - Histogram approximation using fixed buckets
 * - Minimal overhead (~0.01ms per operation)
 * - Separate latency tracking for cache vs DB
 *
 * Performance:
 * - All operations are O(1)
 * - No allocations in hot path
 * - No async operations
 */

// =============================================================================
// Configuration
// =============================================================================

/**
 * Histogram buckets for latency measurements (in milliseconds)
 * Optimized for redirect latency distribution:
 * - <5ms: Cache hits
 * - 5-20ms: Fast DB queries
 * - 20-50ms: Target latency boundary
 * - >50ms: Slow queries (investigate)
 */
const LATENCY_BUCKETS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/**
 * Cache latency buckets (tighter, for Redis)
 */
const CACHE_LATENCY_BUCKETS = [0.5, 1, 2, 5, 10, 20, 50];

// =============================================================================
// State
// =============================================================================

/**
 * Counter metrics
 */
const counters = {
  // Total redirects by status code
  redirect_301: 0,
  redirect_302: 0,
  redirect_404: 0,
  redirect_503: 0,

  // Cache metrics
  cache_hit: 0,
  cache_miss: 0,
  negative_cache_hit: 0,

  // Database metrics
  db_fallback: 0,
  db_error: 0,
  db_timeout: 0,

  // Redis metrics
  redis_error: 0,
  redis_timeout: 0,
};

/**
 * Histogram state for redirect latency
 */
const latencyHistogram = {
  buckets: new Array(LATENCY_BUCKETS.length + 1).fill(0),
  sum: 0,
  count: 0,
};

/**
 * Histogram state for cache latency (separate for granularity)
 */
const cacheLatencyHistogram = {
  buckets: new Array(CACHE_LATENCY_BUCKETS.length + 1).fill(0),
  sum: 0,
  count: 0,
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Increment a counter metric.
 *
 * @param name - Counter name (must exist in counters object)
 */
export function increment(name: keyof typeof counters): void {
  counters[name]++;
}

/**
 * Record a latency observation for redirects.
 *
 * @param latencyMs - Latency in milliseconds
 */
export function recordLatency(latencyMs: number): void {
  latencyHistogram.sum += latencyMs;
  latencyHistogram.count++;

  // Find the right bucket
  for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
    if (latencyMs <= LATENCY_BUCKETS[i]) {
      latencyHistogram.buckets[i]++;
      return;
    }
  }
  // +Inf bucket
  latencyHistogram.buckets[LATENCY_BUCKETS.length]++;
}

/**
 * Record cache operation latency.
 *
 * @param latencyMs - Latency in milliseconds
 * @param hit - Whether this was a cache hit
 */
export function recordCacheLatency(latencyMs: number, hit: boolean): void {
  cacheLatencyHistogram.sum += latencyMs;
  cacheLatencyHistogram.count++;

  // Find the right bucket
  for (let i = 0; i < CACHE_LATENCY_BUCKETS.length; i++) {
    if (latencyMs <= CACHE_LATENCY_BUCKETS[i]) {
      cacheLatencyHistogram.buckets[i]++;
      return;
    }
  }
  cacheLatencyHistogram.buckets[CACHE_LATENCY_BUCKETS.length]++;

  // Also increment hit/miss counter
  if (hit) {
    counters.cache_hit++;
  }
}

/**
 * Record redirect result (convenience method).
 *
 * @param statusCode - HTTP status code
 * @param cacheHit - Whether cache was hit
 * @param latencyMs - Total latency in ms
 */
export function recordRedirect(
  statusCode: 301 | 302 | 404 | 503,
  cacheHit: boolean,
  latencyMs: number
): void {
  // Status counter
  switch (statusCode) {
    case 301:
      counters.redirect_301++;
      break;
    case 302:
      counters.redirect_302++;
      break;
    case 404:
      counters.redirect_404++;
      break;
    case 503:
      counters.redirect_503++;
      break;
  }

  // Cache counter (only for successful redirects)
  if (statusCode === 301 || statusCode === 302) {
    if (cacheHit) {
      counters.cache_hit++;
    } else {
      counters.cache_miss++;
      counters.db_fallback++;
    }
  }

  // Latency
  recordLatency(latencyMs);
}

/**
 * Record negative cache hit (known 404).
 */
export function recordNegativeCacheHit(): void {
  counters.negative_cache_hit++;
}

/**
 * Get current metrics in Prometheus text format.
 *
 * @returns Prometheus-compatible metrics string
 */
export function getMetrics(): string {
  const lines: string[] = [];

  // Helper to add metric
  const addCounter = (name: string, value: number, help: string) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${value}`);
  };

  // Redirect counters
  lines.push("# HELP quicklink_redirect_total Total redirects by status");
  lines.push("# TYPE quicklink_redirect_total counter");
  lines.push(`quicklink_redirect_total{status="301"} ${counters.redirect_301}`);
  lines.push(`quicklink_redirect_total{status="302"} ${counters.redirect_302}`);
  lines.push(`quicklink_redirect_total{status="404"} ${counters.redirect_404}`);
  lines.push(`quicklink_redirect_total{status="503"} ${counters.redirect_503}`);

  // Cache counters
  addCounter("quicklink_cache_hit_total", counters.cache_hit, "Cache hits");
  addCounter("quicklink_cache_miss_total", counters.cache_miss, "Cache misses");
  addCounter("quicklink_negative_cache_hit_total", counters.negative_cache_hit, "Negative cache hits (known 404s)");

  // DB counters
  addCounter("quicklink_db_fallback_total", counters.db_fallback, "DB fallback queries");
  addCounter("quicklink_db_error_total", counters.db_error, "DB errors");
  addCounter("quicklink_db_timeout_total", counters.db_timeout, "DB timeouts");

  // Redis counters
  addCounter("quicklink_redis_error_total", counters.redis_error, "Redis errors");
  addCounter("quicklink_redis_timeout_total", counters.redis_timeout, "Redis timeouts");

  // Redirect latency histogram
  lines.push("# HELP quicklink_redirect_latency_ms Redirect latency in milliseconds");
  lines.push("# TYPE quicklink_redirect_latency_ms histogram");

  let cumulative = 0;
  for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
    cumulative += latencyHistogram.buckets[i];
    lines.push(`quicklink_redirect_latency_ms_bucket{le="${LATENCY_BUCKETS[i]}"} ${cumulative}`);
  }
  cumulative += latencyHistogram.buckets[LATENCY_BUCKETS.length];
  lines.push(`quicklink_redirect_latency_ms_bucket{le="+Inf"} ${cumulative}`);
  lines.push(`quicklink_redirect_latency_ms_sum ${latencyHistogram.sum.toFixed(3)}`);
  lines.push(`quicklink_redirect_latency_ms_count ${latencyHistogram.count}`);

  // Cache latency histogram
  lines.push("# HELP quicklink_cache_latency_ms Cache operation latency in milliseconds");
  lines.push("# TYPE quicklink_cache_latency_ms histogram");

  let cacheCumulative = 0;
  for (let i = 0; i < CACHE_LATENCY_BUCKETS.length; i++) {
    cacheCumulative += cacheLatencyHistogram.buckets[i];
    lines.push(`quicklink_cache_latency_ms_bucket{le="${CACHE_LATENCY_BUCKETS[i]}"} ${cacheCumulative}`);
  }
  cacheCumulative += cacheLatencyHistogram.buckets[CACHE_LATENCY_BUCKETS.length];
  lines.push(`quicklink_cache_latency_ms_bucket{le="+Inf"} ${cacheCumulative}`);
  lines.push(`quicklink_cache_latency_ms_sum ${cacheLatencyHistogram.sum.toFixed(3)}`);
  lines.push(`quicklink_cache_latency_ms_count ${cacheLatencyHistogram.count}`);

  // Cache hit rate gauge
  const totalSuccessful = counters.redirect_301 + counters.redirect_302;
  const cacheHitRate = totalSuccessful > 0 ? counters.cache_hit / totalSuccessful : 0;
  lines.push("# HELP quicklink_cache_hit_rate Cache hit rate (0-1)");
  lines.push("# TYPE quicklink_cache_hit_rate gauge");
  lines.push(`quicklink_cache_hit_rate ${cacheHitRate.toFixed(4)}`);

  return lines.join("\n");
}

/**
 * Get summary statistics (for debugging/admin).
 */
export function getSummary(): {
  totalRequests: number;
  cacheHitRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p99LatencyMs: number;
} {
  const totalRequests =
    counters.redirect_301 +
    counters.redirect_302 +
    counters.redirect_404 +
    counters.redirect_503;

  const successfulRedirects = counters.redirect_301 + counters.redirect_302;

  return {
    totalRequests,
    cacheHitRate:
      successfulRedirects > 0 ? counters.cache_hit / successfulRedirects : 0,
    avgLatencyMs:
      latencyHistogram.count > 0
        ? latencyHistogram.sum / latencyHistogram.count
        : 0,
    p50LatencyMs: estimatePercentile(0.5),
    p99LatencyMs: estimatePercentile(0.99),
  };
}

/**
 * Reset all metrics (for testing).
 */
export function reset(): void {
  Object.keys(counters).forEach((key) => {
    counters[key as keyof typeof counters] = 0;
  });
  latencyHistogram.buckets.fill(0);
  latencyHistogram.sum = 0;
  latencyHistogram.count = 0;
  cacheLatencyHistogram.buckets.fill(0);
  cacheLatencyHistogram.sum = 0;
  cacheLatencyHistogram.count = 0;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Estimate percentile from histogram buckets.
 * This is an approximation - assumes uniform distribution within buckets.
 */
function estimatePercentile(percentile: number): number {
  if (latencyHistogram.count === 0) return 0;

  const targetCount = percentile * latencyHistogram.count;
  let cumulative = 0;

  for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
    cumulative += latencyHistogram.buckets[i];
    if (cumulative >= targetCount) {
      return LATENCY_BUCKETS[i];
    }
  }

  return LATENCY_BUCKETS[LATENCY_BUCKETS.length - 1];
}
