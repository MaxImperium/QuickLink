/**
 * Redirect Service Type Definitions
 *
 * Minimal types for the hot path. No external validation libraries.
 * Types are compile-time only - zero runtime overhead.
 */

// =============================================================================
// Core Domain Types
// =============================================================================

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
 * Cached link entry in Redis
 * Stored as JSON string for simplicity
 */
export interface CachedLink {
  /** Original destination URL */
  url: string;
  /** Redirect type: permanent (301) or temporary (302) */
  permanent: boolean;
  /** Unix timestamp when cached */
  cachedAt: number;
}

// =============================================================================
// Analytics Event Types
// =============================================================================

/**
 * Click event pushed to the queue
 * Minimal payload to reduce serialization overhead
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
  /** Hashed IP for privacy (never store raw IP) */
  ipHash?: string;
  /** User-Agent header */
  ua?: string;
  /** Referer header */
  ref?: string;
  /** ISO country code from geo lookup */
  cc?: string;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Service configuration loaded from environment
 */
export interface Config {
  /** HTTP server port */
  port: number;
  /** HTTP server host */
  host: string;

  /** Redis connection URL */
  redisUrl: string;
  /** Redis operation timeout (ms) */
  redisTimeoutMs: number;

  /** PostgreSQL connection URL */
  databaseUrl: string;
  /** Database query timeout (ms) */
  dbTimeoutMs: number;

  /** Default cache TTL (seconds) */
  cacheTtlSeconds: number;
  /** TTL for 404 negative cache (seconds) */
  notFoundTtlSeconds: number;

  /** Log level */
  logLevel: "debug" | "info" | "warn" | "error";
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

/**
 * Internal metrics state
 */
export interface MetricsState {
  redirectTotal: Map<string, number>;
  cacheHits: number;
  cacheMisses: number;
  dbFallbacks: number;
  dbErrors: number;
  latencySum: number;
  latencyCount: number;
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
