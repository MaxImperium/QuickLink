/**
 * Redis-based Distributed Frequency Tracker
 *
 * High-performance, distributed rate limiting for bot detection and abuse prevention.
 * Uses Redis sorted sets for accurate sliding window counting across multiple instances.
 *
 * Why Redis Sorted Sets?
 * - ZADD O(log(N)) - Add timestamp with score
 * - ZCOUNT O(log(N)) - Count entries in time range
 * - ZREMRANGEBYSCORE O(log(N)+M) - Efficient cleanup
 * - Automatic expiration with TTL
 *
 * Memory Efficiency:
 * - Each IP entry: ~50-100 bytes
 * - 1M unique IPs: ~100MB
 * - With bloom filter prefilter: ~10MB for same coverage
 *
 * Design Trade-offs:
 * - Latency: +1-2ms per request (Redis round trip)
 * - Availability: Falls back to local tracking if Redis is down
 * - Accuracy: Perfect sliding window (vs approximate in-memory)
 *
 * @see https://redis.io/commands/zadd/
 */

import type Redis from "ioredis";

// =============================================================================
// Types
// =============================================================================

export interface FrequencyTrackerConfig {
  /** Time window for rate limiting (ms). Default: 60000 (1 minute) */
  windowMs: number;
  /** Max requests per IP in window. Default: 30 */
  maxRequests: number;
  /** Redis key prefix. Default: "ql:freq:" */
  keyPrefix: string;
  /** Key TTL (seconds). Default: 120 (2x window) */
  keyTtlSeconds: number;
  /** Redis operation timeout (ms). Default: 50 */
  timeoutMs: number;
  /** Enable local fallback when Redis is unavailable. Default: true */
  enableFallback: boolean;
}

export interface FrequencyCheckResult {
  /** Whether the IP exceeded the rate limit */
  isHighFrequency: boolean;
  /** Number of requests in the current window */
  requestCount: number;
  /** Time until window resets (ms) */
  resetInMs: number;
  /** Whether result came from local fallback */
  fromFallback: boolean;
}

export interface FrequencyTrackerStats {
  /** Total checks performed */
  totalChecks: number;
  /** Checks that exceeded threshold */
  highFrequencyChecks: number;
  /** Redis errors encountered */
  redisErrors: number;
  /** Fallback activations */
  fallbackActivations: number;
  /** Average check latency (ms) */
  avgLatencyMs: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG: FrequencyTrackerConfig = {
  windowMs: 60_000,
  maxRequests: 30,
  keyPrefix: "ql:freq:",
  keyTtlSeconds: 120,
  timeoutMs: 50,
  enableFallback: true,
};

// Lua script for atomic rate limit check
// Returns: [count, oldest_timestamp]
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_start = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

-- Remove old entries
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

-- Add current request
redis.call('ZADD', key, now, now .. ':' .. math.random())

-- Count requests in window
local count = redis.call('ZCARD', key)

-- Set/refresh TTL
redis.call('EXPIRE', key, ttl)

-- Get oldest entry for reset calculation
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldest_ts = oldest[2] or now

return {count, oldest_ts}
`;

// =============================================================================
// Distributed Frequency Tracker Class
// =============================================================================

export class DistributedFrequencyTracker {
  private redis: Redis | null;
  private config: FrequencyTrackerConfig;
  private stats: FrequencyTrackerStats;
  private scriptSha: string | null = null;

  // Local fallback tracker
  private localRequests: Map<string, number[]> = new Map();
  private localCleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(redis: Redis | null, config: Partial<FrequencyTrackerConfig> = {}) {
    this.redis = redis;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      totalChecks: 0,
      highFrequencyChecks: 0,
      redisErrors: 0,
      fallbackActivations: 0,
      avgLatencyMs: 0,
    };

    // Set up local fallback cleanup
    if (this.config.enableFallback) {
      this.localCleanupInterval = setInterval(
        () => this.cleanupLocalFallback(),
        this.config.windowMs
      );
    }
  }

  /**
   * Initialize Lua script in Redis
   * Call this once at startup for better performance
   */
  async initialize(): Promise<void> {
    if (!this.redis) return;

    try {
      this.scriptSha = await this.redis.script("LOAD", RATE_LIMIT_SCRIPT);
    } catch (error) {
      console.warn("[freq-tracker] Failed to load Lua script:", error);
      // Will fall back to multi-command approach
    }
  }

  /**
   * Check if an IP exceeds the rate limit
   *
   * Performance: ~1-2ms with Redis, ~0.1ms with local fallback
   *
   * @param ipHash - Hashed IP address (don't store raw IPs)
   * @returns Frequency check result
   */
  async check(ipHash: string): Promise<FrequencyCheckResult> {
    const start = performance.now();
    this.stats.totalChecks++;

    try {
      // Try Redis first
      if (this.redis) {
        const result = await this.checkRedis(ipHash);
        this.updateLatencyStats(start);
        return result;
      }
    } catch (error) {
      this.stats.redisErrors++;
      console.warn("[freq-tracker] Redis error, using fallback:", error);
    }

    // Fall back to local tracking
    if (this.config.enableFallback) {
      this.stats.fallbackActivations++;
      const result = this.checkLocal(ipHash);
      this.updateLatencyStats(start);
      return result;
    }

    // No fallback, allow the request
    return {
      isHighFrequency: false,
      requestCount: 0,
      resetInMs: 0,
      fromFallback: true,
    };
  }

  /**
   * Check rate limit using Redis
   */
  private async checkRedis(ipHash: string): Promise<FrequencyCheckResult> {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const key = this.config.keyPrefix + ipHash;

    let count: number;
    let oldestTs: number;

    // Use Lua script if available (atomic, single round trip)
    if (this.scriptSha) {
      const result = (await this.redis!.evalsha(
        this.scriptSha,
        1,
        key,
        now.toString(),
        windowStart.toString(),
        this.config.keyTtlSeconds.toString()
      )) as [number, string];

      count = result[0];
      oldestTs = parseInt(result[1], 10);
    } else {
      // Fall back to pipeline (not atomic but still fast)
      const pipeline = this.redis!.pipeline();
      pipeline.zremrangebyscore(key, "-inf", windowStart);
      pipeline.zadd(key, now.toString(), `${now}:${Math.random()}`);
      pipeline.zcard(key);
      pipeline.expire(key, this.config.keyTtlSeconds);
      pipeline.zrange(key, 0, 0, "WITHSCORES");

      const results = await pipeline.exec();
      count = results?.[2]?.[1] as number ?? 0;
      const oldest = results?.[4]?.[1] as string[] | undefined;
      oldestTs = oldest?.[1] ? parseInt(oldest[1], 10) : now;
    }

    const isHighFrequency = count > this.config.maxRequests;
    if (isHighFrequency) {
      this.stats.highFrequencyChecks++;
    }

    return {
      isHighFrequency,
      requestCount: count,
      resetInMs: Math.max(0, oldestTs + this.config.windowMs - now),
      fromFallback: false,
    };
  }

  /**
   * Check rate limit using local in-memory tracker (fallback)
   */
  private checkLocal(ipHash: string): FrequencyCheckResult {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    let timestamps = this.localRequests.get(ipHash) || [];
    timestamps = timestamps.filter((ts) => ts > windowStart);
    timestamps.push(now);
    this.localRequests.set(ipHash, timestamps);

    const isHighFrequency = timestamps.length > this.config.maxRequests;
    if (isHighFrequency) {
      this.stats.highFrequencyChecks++;
    }

    const oldestTs = timestamps[0] || now;

    return {
      isHighFrequency,
      requestCount: timestamps.length,
      resetInMs: Math.max(0, oldestTs + this.config.windowMs - now),
      fromFallback: true,
    };
  }

  /**
   * Clean up old entries from local fallback
   */
  private cleanupLocalFallback(): void {
    const windowStart = Date.now() - this.config.windowMs;

    for (const [ip, timestamps] of this.localRequests.entries()) {
      const recent = timestamps.filter((ts) => ts > windowStart);
      if (recent.length === 0) {
        this.localRequests.delete(ip);
      } else {
        this.localRequests.set(ip, recent);
      }
    }
  }

  /**
   * Update latency statistics
   */
  private updateLatencyStats(startTime: number): void {
    const latency = performance.now() - startTime;
    const count = this.stats.totalChecks;
    this.stats.avgLatencyMs =
      (this.stats.avgLatencyMs * (count - 1) + latency) / count;
  }

  /**
   * Get tracker statistics
   */
  getStats(): FrequencyTrackerStats {
    return { ...this.stats };
  }

  /**
   * Get local tracker size (for monitoring memory usage)
   */
  getLocalTrackerSize(): number {
    return this.localRequests.size;
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown(): Promise<void> {
    if (this.localCleanupInterval) {
      clearInterval(this.localCleanupInterval);
      this.localCleanupInterval = null;
    }
    this.localRequests.clear();
  }

  /**
   * Reset statistics (for testing)
   */
  resetStats(): void {
    this.stats = {
      totalChecks: 0,
      highFrequencyChecks: 0,
      redisErrors: 0,
      fallbackActivations: 0,
      avgLatencyMs: 0,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

let globalTracker: DistributedFrequencyTracker | null = null;

/**
 * Create or get the global distributed frequency tracker
 *
 * @param redis - Redis client (optional, uses local-only mode if not provided)
 * @param config - Configuration overrides
 */
export function getDistributedFrequencyTracker(
  redis?: Redis | null,
  config?: Partial<FrequencyTrackerConfig>
): DistributedFrequencyTracker {
  if (!globalTracker) {
    globalTracker = new DistributedFrequencyTracker(redis ?? null, config);
  }
  return globalTracker;
}

/**
 * Initialize the global tracker with Redis
 * Call this at application startup
 */
export async function initializeFrequencyTracker(
  redis: Redis,
  config?: Partial<FrequencyTrackerConfig>
): Promise<DistributedFrequencyTracker> {
  globalTracker = new DistributedFrequencyTracker(redis, config);
  await globalTracker.initialize();
  return globalTracker;
}

/**
 * Shutdown the global tracker
 */
export async function shutdownFrequencyTracker(): Promise<void> {
  if (globalTracker) {
    await globalTracker.shutdown();
    globalTracker = null;
  }
}
