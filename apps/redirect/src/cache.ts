/**
 * Redis Cache Abstraction - Performance Optimized
 *
 * Minimal Redis client for URL lookups.
 * Designed for single-purpose: fast short code → URL resolution.
 *
 * Target Latency: <5ms for cache hit
 *
 * Design Decisions:
 * - Uses ioredis for connection pooling and cluster support
 * - Single connection - redirects are read-heavy, one conn is enough
 * - Lazy connection - don't block startup
 * - Graceful degradation - returns null on any Redis error
 * - TTL jitter - prevents thundering herd on mass expiration
 * - Versioned keys - enables rolling deploys without cache corruption
 *
 * Key Schema (from CACHE_DESIGN.md):
 *   ql:v1:link:{shortCode} - Active link data (JSON)
 *   ql:v1:404:{shortCode}  - Negative cache marker ("1")
 *
 * @see CACHE_DESIGN.md for complete design documentation
 */

import type { CachedLink, Config } from "./types.js";
import { CACHE_KEYS, TTL_JITTER_PERCENT } from "./types.js";
import * as metrics from "./metrics.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Redis client interface (minimal subset we need)
 * Allows easy mocking in tests
 */
interface RedisClient {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<string>;
  del(key: string): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<string>;
}

// =============================================================================
// State
// =============================================================================

let client: RedisClient | null = null;
let config: Pick<Config, "redisUrl" | "redisTimeoutMs" | "cacheTtlSeconds" | "notFoundTtlSeconds">;

// Track pending cache writes for graceful shutdown
let pendingWrites = 0;

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the cache module with configuration.
 * Does NOT connect immediately - connection is lazy.
 *
 * @param cfg - Configuration subset for cache
 */
export function initCache(
  cfg: Pick<Config, "redisUrl" | "redisTimeoutMs" | "cacheTtlSeconds" | "notFoundTtlSeconds">
): void {
  config = cfg;
  // Connection happens on first use
}

/**
 * Lazily create Redis connection.
 * Called internally on first cache operation.
 *
 * Performance tuning:
 * - enableReadyCheck: false - Skip PING on connect (saves ~1ms)
 * - enableOfflineQueue: false - Fail fast if disconnected
 * - maxRetriesPerRequest: 1 - Don't retry, fallback to DB faster
 * - connectTimeout: 1000ms - Fast connect timeout
 */
async function getClient(): Promise<RedisClient | null> {
  if (client) return client;

  try {
    // Dynamic import to avoid loading ioredis if not needed (e.g., in tests)
    const Redis = (await import("ioredis")).default;

    client = new Redis(config.redisUrl, {
      // Performance tunings for low latency
      enableReadyCheck: false, // Skip PING on connect
      enableOfflineQueue: false, // Fail fast if disconnected
      maxRetriesPerRequest: 1, // Don't retry, just fallback to DB
      connectTimeout: 1000, // Fast connect timeout
      commandTimeout: config.redisTimeoutMs, // Per-command timeout

      // TCP keep-alive to detect dead connections
      keepAlive: 10000, // 10 seconds

      // Reconnection strategy - exponential backoff
      retryStrategy: (times: number) => {
        if (times > 3) return null; // Give up after 3 attempts
        return Math.min(times * 100, 1000); // Max 1s between attempts
      },

      // Disable cluster mode for single-node Redis
      lazyConnect: true,
    });

    // Connect explicitly to catch errors early
    await (client as unknown as { connect(): Promise<void> }).connect?.();

    return client;
  } catch (err) {
    // Log but don't throw - graceful degradation
    console.error("[cache] Failed to connect to Redis:", err);
    metrics.increment("redis_error");
    return null;
  }
}

// =============================================================================
// TTL Jitter
// =============================================================================

/**
 * Apply jitter to TTL to prevent thundering herd.
 *
 * When many keys are created at the same time (e.g., popular links),
 * they would all expire simultaneously, causing a spike in DB queries.
 *
 * Jitter spreads expiration times: TTL * (1 + random(-8%, +8%))
 *
 * Example: 3600s TTL → 3312s to 3888s (±288s window)
 *
 * @param baseTtl - Base TTL in seconds
 * @returns Jittered TTL in seconds
 */
function applyJitter(baseTtl: number): number {
  // Random value between -JITTER and +JITTER
  const jitterMultiplier = 1 + (Math.random() * 2 - 1) * TTL_JITTER_PERCENT;
  return Math.floor(baseTtl * jitterMultiplier);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Options for cache get operation.
 */
export interface GetOptions {
  /**
   * Allow returning stale data (expired keys).
   * Used for graceful degradation when DB is down.
   * Default: false
   */
  allowStale?: boolean;
}

/**
 * Look up a short code in the cache.
 *
 * Performance: Expected ~0.5-2ms
 *
 * Flow:
 * 1. Get Redis client (lazy init)
 * 2. Execute GET with timeout
 * 3. Parse JSON response
 * 4. Return CachedLink or null
 *
 * @param shortCode - The short code to look up
 * @param options - Optional configuration (e.g., allowStale)
 * @returns CachedLink if found, null if not found or error
 */
export async function get(
  shortCode: string,
  options?: GetOptions
): Promise<CachedLink | null> {
  const start = performance.now();

  const redis = await getClient();
  if (!redis) {
    metrics.increment("redis_error");
    return null;
  }

  try {
    const key = CACHE_KEYS.LINK_PREFIX + shortCode;
    const data = await withTimeout(redis.get(key), config.redisTimeoutMs);

    const latency = performance.now() - start;

    if (!data) {
      // Cache miss - key doesn't exist
      // Note: allowStale doesn't help here - key is already deleted by Redis TTL
      return null;
    }

    // Parse cached JSON
    // No validation - we control what goes in
    const link = JSON.parse(data) as CachedLink;

    // Record cache hit latency for monitoring
    metrics.recordCacheLatency(latency, true);

    return link;
  } catch (err) {
    // Any error = cache miss, fallback to DB
    console.warn("[cache] GET error:", err);
    metrics.increment("redis_error");
    return null;
  }
}

/**
 * Check if a short code is in the negative cache (known 404).
 *
 * This prevents repeated DB lookups for codes that don't exist.
 * Critical for blocking brute-force scanning attacks.
 *
 * @param shortCode - The short code to check
 * @returns true if known to not exist
 */
export async function isNotFound(shortCode: string): Promise<boolean> {
  const redis = await getClient();
  if (!redis) return false; // On Redis failure, allow DB lookup

  try {
    const key = CACHE_KEYS.NOT_FOUND_PREFIX + shortCode;
    const exists = await withTimeout(redis.get(key), config.redisTimeoutMs);
    return exists === "1";
  } catch {
    // On error, allow DB lookup (conservative)
    return false;
  }
}

/**
 * Cache a link after DB lookup.
 * Fire-and-forget - caller should not await.
 *
 * TTL: 1 hour ±8% jitter
 *
 * @param shortCode - The short code
 * @param link - The link data to cache
 */
export async function set(shortCode: string, link: CachedLink): Promise<void> {
  const redis = await getClient();
  if (!redis) return;

  pendingWrites++;

  try {
    const key = CACHE_KEYS.LINK_PREFIX + shortCode;
    const data = JSON.stringify(link);
    const ttl = applyJitter(config.cacheTtlSeconds);

    await redis.setex(key, ttl, data);
  } catch (err) {
    // Log but don't throw - cache warm is best-effort
    console.warn("[cache] SET error:", err);
    metrics.increment("redis_error");
  } finally {
    pendingWrites--;
  }
}

/**
 * Cache a 404 to prevent repeated DB lookups.
 * Fire-and-forget - caller should not await.
 *
 * TTL: 5 minutes ±8% jitter
 *
 * Short TTL because:
 * - Link might be created right after 404
 * - Don't want to block legitimate new links
 *
 * @param shortCode - The short code that was not found
 */
export async function setNotFound(shortCode: string): Promise<void> {
  const redis = await getClient();
  if (!redis) return;

  pendingWrites++;

  try {
    const key = CACHE_KEYS.NOT_FOUND_PREFIX + shortCode;
    const ttl = applyJitter(config.notFoundTtlSeconds);

    await redis.setex(key, ttl, "1");
  } catch (err) {
    console.warn("[cache] SET 404 error:", err);
    metrics.increment("redis_error");
  } finally {
    pendingWrites--;
  }
}

/**
 * Invalidate a cached link (e.g., when link is updated or deleted).
 *
 * Also clears negative cache in case it was previously 404.
 *
 * @param shortCode - The short code to invalidate
 */
export async function invalidate(shortCode: string): Promise<void> {
  const redis = await getClient();
  if (!redis) return;

  try {
    // Delete both positive and negative cache entries
    const linkKey = CACHE_KEYS.LINK_PREFIX + shortCode;
    const notFoundKey = CACHE_KEYS.NOT_FOUND_PREFIX + shortCode;

    await Promise.all([redis.del(linkKey), redis.del(notFoundKey)]);
  } catch (err) {
    console.warn("[cache] INVALIDATE error:", err);
  }
}

/**
 * Health check - ping Redis.
 *
 * @returns true if Redis is responsive
 */
export async function ping(): Promise<boolean> {
  const start = performance.now();

  const redis = await getClient();
  if (!redis) return false;

  try {
    const result = await withTimeout(redis.ping(), config.redisTimeoutMs);
    const latency = performance.now() - start;

    // Record ping latency for monitoring
    if (result === "PONG") {
      metrics.recordCacheLatency(latency, true);
    }

    return result === "PONG";
  } catch {
    metrics.increment("redis_timeout");
    return false;
  }
}

/**
 * Graceful shutdown - wait for pending writes and close connection.
 *
 * Ensures all in-flight cache writes complete before exit.
 * Timeout after 5 seconds to prevent hanging.
 */
export async function shutdown(): Promise<void> {
  // Wait for pending writes (max 5 seconds)
  const maxWait = 5000;
  const start = Date.now();

  while (pendingWrites > 0 && Date.now() - start < maxWait) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  if (pendingWrites > 0) {
    console.warn(`[cache] Shutdown with ${pendingWrites} pending writes`);
  }

  if (client) {
    await client.quit();
    client = null;
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Wrap a promise with a timeout.
 * Returns null on timeout instead of throwing.
 *
 * Why null instead of throw?
 * - Graceful degradation - timeout = cache miss, not error
 * - Simpler error handling in hot path
 * - Matches Redis semantics (GET non-existent key = null)
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      metrics.increment("redis_timeout");
      resolve(null);
    }, ms);
  });

  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timeoutId!);
    return result;
  } catch (err) {
    clearTimeout(timeoutId!);
    throw err;
  }
}
