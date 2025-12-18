/**
 * Redirect Service Type Definitions
 *
 * Minimal types for the hot path. No external validation libraries.
 * Types are compile-time only - zero runtime overhead.
 *
 * Performance Notes:
 * - All types are plain interfaces (no classes)
 * - No runtime type checking in hot path
 * - Types designed for minimal serialization overhead
 */

// =============================================================================
// Core Domain Types
// =============================================================================

/**
 * Cached link entry in Redis
 *
 * Key format: ql:v1:link:{shortCode}
 * Stored as JSON string for simplicity.
 *
 * Design Decisions:
 * - Minimal fields to reduce serialization overhead (~100 bytes)
 * - `permanent` flag determines 301 vs 302 response
 * - `cachedAt` enables cache age analysis in metrics
 * - No expiration stored - TTL handled by Redis SETEX
 */
export interface CachedLink {
  /** Original destination URL */
  url: string;

  /**
   * Redirect type: permanent (301) or temporary (302)
   *
   * 301: Browser caches redirect, reduces server load
   * 302: Browser re-requests each time, allows analytics
   *
   * Rule: Use 301 for links without expiration/max_clicks
   */
  permanent: boolean;

  /**
   * Unix timestamp (ms) when cached
   * Used for cache age metrics, not expiration (Redis TTL handles that)
   */
  cachedAt: number;
}

/**
 * Result of a URL lookup operation
 */
export interface LookupResult {
  /** The original URL to redirect to */
  url: string;

  /** Whether this came from cache (true) or database (false) */
  fromCache: boolean;

  /** HTTP status code for redirect (301 permanent, 302 temporary) */
  statusCode: 301 | 302;
}

/**
 * Negative cache marker
 *
 * Key format: ql:v1:404:{shortCode}
 * Value: "1" (minimal, just needs to exist)
 * TTL: 5 minutes ±8% jitter
 *
 * Purpose: Prevent repeated DB lookups for non-existent codes
 */
export type NegativeCacheValue = "1";

// =============================================================================
// Analytics Event Types
// =============================================================================

/**
 * Click event pushed to the queue
 * Minimal payload to reduce serialization overhead
 *
 * Integration: Uses @quicklink/analytics emitClickEvent()
 */
export interface ClickEvent {
  /** Short code that was accessed */
  code: string;

  /** Unix timestamp (ms) */
  ts: number;

  /** Request metadata (optional, collected async) */
  meta?: ClickMetadata;
}

/**
 * Optional metadata extracted from request
 * Collected only if available, never blocks redirect
 */
export interface ClickMetadata {
  /** Client IP (raw, not hashed - hashing done by analytics worker) */
  ip?: string;

  /** User-Agent header (truncated to 512 chars) */
  ua?: string;

  /** Referer header (truncated to 2048 chars) */
  ref?: string;

  /** Destination URL (the URL being redirected to) */
  dst?: string;

  /** ISO country code from geo lookup (populated by analytics worker) */
  cc?: string;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Service configuration loaded from environment
 */
export interface Config {
  /** Environment name (development, staging, production) */
  env: "development" | "staging" | "production";

  /** HTTP server port */
  port: number;

  /** HTTP server host */
  host: string;

  /** Redis connection URL */
  redisUrl: string;

  /** Redis operation timeout (ms) - target <10ms for cache hits */
  redisTimeoutMs: number;

  /** PostgreSQL connection URL */
  databaseUrl: string;

  /** Database query timeout (ms) - target <50ms */
  dbTimeoutMs: number;

  /**
   * Positive cache TTL (seconds)
   * Default: 3600 (1 hour)
   *
   * Trade-off:
   * - Longer: Better cache hit rate, staler data
   * - Shorter: Fresher data, more DB load
   */
  cacheTtlSeconds: number;

  /**
   * Negative cache TTL (seconds)
   * Default: 300 (5 minutes)
   *
   * Short TTL because:
   * - Link might be created right after 404
   * - Don't want to block legitimate new links
   */
  notFoundTtlSeconds: number;

  /** Log level */
  logLevel: "debug" | "info" | "warn" | "error";
}

// =============================================================================
// Cache Types
// =============================================================================

/**
 * Cache lookup result with timing info
 */
export interface CacheLookupResult {
  /** Cached link data, null if not found */
  link: CachedLink | null;

  /** Whether this was a cache hit */
  hit: boolean;

  /** Lookup latency in ms */
  latencyMs: number;
}

/**
 * Negative cache check result
 */
export interface NegativeCacheResult {
  /** True if code is known to not exist */
  isNotFound: boolean;

  /** Lookup latency in ms */
  latencyMs: number;
}

// =============================================================================
// Health Check Types
// =============================================================================

/**
 * Liveness probe response
 */
export interface LivenessResponse {
  status: "ok";
}

/**
 * Readiness probe response
 */
export interface ReadinessResponse {
  status: "ok" | "degraded" | "unhealthy";
  checks: {
    redis: "ok" | "error" | "timeout";
    db: "ok" | "error" | "timeout";
  };
  latency?: {
    redis?: number;
    db?: number;
  };
}

// =============================================================================
// Metrics Types
// =============================================================================

/**
 * Metric labels for counters
 */
export interface RedirectMetricLabels {
  status: "301" | "302" | "404" | "503";
  cache: "hit" | "miss";
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Service-specific error codes
 */
export const ErrorCode = {
  REDIS_UNAVAILABLE: "REDIS_UNAVAILABLE",
  REDIS_TIMEOUT: "REDIS_TIMEOUT",
  DB_UNAVAILABLE: "DB_UNAVAILABLE",
  DB_TIMEOUT: "DB_TIMEOUT",
  NOT_FOUND: "NOT_FOUND",
  INVALID_CODE: "INVALID_CODE",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Lightweight error wrapper
 */
export interface ServiceError {
  code: ErrorCode;
  message: string;
  cause?: unknown;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Redis key prefixes with version for cache busting
 *
 * Version strategy: Increment v1 → v2 when cache format changes
 * This allows rolling deployments without cache corruption
 */
export const CACHE_KEYS = {
  /** Positive cache: ql:v1:link:{shortCode} */
  LINK_PREFIX: "ql:v1:link:",

  /** Negative cache: ql:v1:404:{shortCode} */
  NOT_FOUND_PREFIX: "ql:v1:404:",
} as const;

/**
 * TTL jitter percentage (±8%)
 *
 * Purpose: Prevent thundering herd when many keys expire simultaneously
 * Math: TTL * (1 + random(-0.08, 0.08))
 */
export const TTL_JITTER_PERCENT = 0.08;
