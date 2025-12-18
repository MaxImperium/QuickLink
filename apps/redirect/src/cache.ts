/**
 * Redis Cache Abstraction
 *
 * Minimal Redis client for URL lookups.
 * Designed for single-purpose: fast short code → URL resolution.
 *
 * Design Decisions:
 * - Uses ioredis for connection pooling and cluster support
 * - Single connection (not pool) - redirects are read-heavy, one conn is enough
 * - Lazy connection - don't block startup
 * - Graceful degradation - returns null on any Redis error
 */

import type { CachedLink, Config } from "./types.js";

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
  ping(): Promise<string>;
  quit(): Promise<string>;
}

// =============================================================================
// State
// =============================================================================

let client: RedisClient | null = null;
let config: Pick<Config, "redisUrl" | "redisTimeoutMs" | "cacheTtlSeconds" | "notFoundTtlSeconds">;

// Key prefix to namespace our data
const KEY_PREFIX = "ql:link:";
const NOT_FOUND_PREFIX = "ql:404:";

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
 */
async function getClient(): Promise<RedisClient | null> {
  if (client) return client;

  try {
    // Dynamic import to avoid loading ioredis if not needed (e.g., in tests)
    const Redis = (await import("ioredis")).default;

    client = new Redis(config.redisUrl, {
      // Performance tunings
      enableReadyCheck: false, // Skip PING on connect
      enableOfflineQueue: false, // Fail fast if disconnected
      maxRetriesPerRequest: 1, // Don't retry, just fallback to DB
      connectTimeout: 1000, // Fast connect timeout
      commandTimeout: config.redisTimeoutMs, // Per-command timeout

      // Reconnection strategy
      retryStrategy: (times) => {
        if (times > 3) return null; // Give up after 3 attempts
        return Math.min(times * 100, 1000); // Exponential backoff, max 1s
      },
    });

    return client;
  } catch (err) {
    // Log but don't throw - graceful degradation
    console.error("[cache] Failed to connect to Redis:", err);
    return null;
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Look up a short code in the cache.
 *
 * Performance: Expected ~0.5-2ms
 *
 * @param shortCode - The short code to look up
 * @returns CachedLink if found, null if not found or error
 */
export async function get(shortCode: string): Promise<CachedLink | null> {
  const redis = await getClient();
  if (!redis) return null;

  try {
    const key = KEY_PREFIX + shortCode;
    const data = await withTimeout(redis.get(key), config.redisTimeoutMs);

    if (!data) return null;

    // Parse cached JSON
    // No validation - we control what goes in
    return JSON.parse(data) as CachedLink;
  } catch (err) {
    // Any error = cache miss, fallback to DB
    console.warn("[cache] GET error:", err);
    return null;
  }
}

/**
 * Check if a short code is in the negative cache (known 404).
 *
 * @param shortCode - The short code to check
 * @returns true if known to not exist
 */
export async function isNotFound(shortCode: string): Promise<boolean> {
  const redis = await getClient();
  if (!redis) return false;

  try {
    const key = NOT_FOUND_PREFIX + shortCode;
    const exists = await withTimeout(redis.get(key), config.redisTimeoutMs);
    return exists === "1";
  } catch {
    return false;
  }
}

/**
 * Cache a link after DB lookup.
 * Fire-and-forget - caller should not await.
 *
 * @param shortCode - The short code
 * @param link - The link data to cache
 */
export async function set(shortCode: string, link: CachedLink): Promise<void> {
  const redis = await getClient();
  if (!redis) return;

  try {
    const key = KEY_PREFIX + shortCode;
    const data = JSON.stringify(link);
    await redis.setex(key, config.cacheTtlSeconds, data);
  } catch (err) {
    // Log but don't throw - cache warm is best-effort
    console.warn("[cache] SET error:", err);
  }
}

/**
 * Cache a 404 to prevent repeated DB lookups.
 * Fire-and-forget - caller should not await.
 *
 * @param shortCode - The short code that was not found
 */
export async function setNotFound(shortCode: string): Promise<void> {
  const redis = await getClient();
  if (!redis) return;

  try {
    const key = NOT_FOUND_PREFIX + shortCode;
    await redis.setex(key, config.notFoundTtlSeconds, "1");
  } catch (err) {
    console.warn("[cache] SET 404 error:", err);
  }
}

/**
 * Health check - ping Redis.
 *
 * @returns true if Redis is responsive
 */
export async function ping(): Promise<boolean> {
  const redis = await getClient();
  if (!redis) return false;

  try {
    const result = await withTimeout(redis.ping(), config.redisTimeoutMs);
    return result === "PONG";
  } catch {
    return false;
  }
}

/**
 * Graceful shutdown - close Redis connection.
 */
export async function shutdown(): Promise<void> {
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
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | null> {
  let timeoutId: NodeJS.Timeout;

  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), ms);
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
