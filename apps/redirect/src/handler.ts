/**
 * Redirect Request Handler - Performance Optimized
 *
 * Core redirect logic - the hot path.
 * Every line here is optimized for <50ms latency.
 *
 * Flow:
 * 1. Extract short code from URL
 * 2. Validate format (fast rejection)
 * 3. Check negative cache (known 404s)
 * 4. Redis lookup (primary path)
 * 5. DB fallback on cache miss
 * 6. Warm cache (async, fire-and-forget)
 * 7. Emit analytics event (fire-and-forget)
 * 8. Return 301/302 redirect with CDN-compatible headers
 *
 * Graceful Degradation:
 * - Redis down → DB fallback
 * - DB down → stale cache if available, else 503
 * - Analytics down → redirect still works
 *
 * Performance Characteristics:
 * - Cache hit: ~2-5ms
 * - DB fallback: ~10-30ms
 * - Target P99: <50ms
 */

import type { Context } from "hono";
import type { CachedLink, ClickEvent } from "./types.js";
import * as cache from "./cache.js";
import * as db from "./db.js";
import * as metrics from "./metrics.js";

// =============================================================================
// Short Code Validation
// =============================================================================

/**
 * Valid short code pattern.
 * - Alphanumeric only
 * - Length 4-12 characters
 *
 * Using inline regex for performance (no function call overhead).
 * Pre-compiled regex - pattern stored in JS engine's internal cache.
 */
const SHORT_CODE_REGEX = /^[a-zA-Z0-9]{4,12}$/;

/**
 * Validate short code format.
 * Inline for performance - this runs on every request.
 *
 * @param code - Short code to validate
 * @returns true if valid format
 */
function isValidShortCode(code: string): boolean {
  return SHORT_CODE_REGEX.test(code);
}

// =============================================================================
// Analytics (Fire-and-Forget)
// =============================================================================

/**
 * Analytics event queue reference.
 * Set by server initialization.
 */
let emitAnalytics: ((event: ClickEvent) => void) | null = null;

/**
 * Set the analytics emitter function.
 * Called during server initialization.
 *
 * @param emitter - Function to emit analytics events
 */
export function setAnalyticsEmitter(
  emitter: (event: ClickEvent) => void
): void {
  emitAnalytics = emitter;
}

/**
 * Fire analytics event - never awaited, never blocks redirect.
 * Best-effort: failures are silently ignored.
 *
 * @param code - Short code that was accessed
 * @param ctx - Hono request context
 * @param link - Resolved link data (for destination URL)
 */
function fireAnalytics(code: string, ctx: Context, link: CachedLink): void {
  if (!emitAnalytics) return;

  // Extract minimal metadata from request
  // This is best-effort - don't let it fail the redirect
  try {
    const event: ClickEvent = {
      code,
      ts: Date.now(),
      meta: {
        ua: ctx.req.header("user-agent"),
        ref: ctx.req.header("referer"),
        ip: getClientIP(ctx),
        dst: link.url,
      },
    };

    // Fire-and-forget - emitter handles queuing
    emitAnalytics(event);
  } catch {
    // Silently ignore analytics errors - never fail the redirect
  }
}

/**
 * Extract client IP from request.
 * Handles common proxy headers (X-Forwarded-For, CF-Connecting-IP, etc.)
 *
 * @param ctx - Hono request context
 * @returns Client IP or undefined
 */
function getClientIP(ctx: Context): string | undefined {
  // Check common proxy headers (in priority order)
  const cfConnecting = ctx.req.header("cf-connecting-ip");
  if (cfConnecting) return cfConnecting;

  const xForwardedFor = ctx.req.header("x-forwarded-for");
  if (xForwardedFor) {
    // X-Forwarded-For can be comma-separated, first is the client
    const firstIP = xForwardedFor.split(",")[0]?.trim();
    if (firstIP) return firstIP;
  }

  const xRealIP = ctx.req.header("x-real-ip");
  if (xRealIP) return xRealIP;

  // Fallback: no IP available (rare in production)
  return undefined;
}

// =============================================================================
// Response Helpers
// =============================================================================

/**
 * Cache control header values for CDN compatibility.
 * - Positive redirects: Cache for 1 hour (matches Redis TTL)
 * - 404 responses: Cache for 5 minutes (matches negative cache TTL)
 * - 503 errors: No cache (transient failure)
 */
const CACHE_CONTROL = {
  REDIRECT_PERMANENT: "public, max-age=3600, s-maxage=3600, stale-while-revalidate=60",
  REDIRECT_TEMPORARY: "public, max-age=60, s-maxage=60, stale-while-revalidate=10",
  NOT_FOUND: "public, max-age=300, s-maxage=300",
  ERROR: "no-store, no-cache, must-revalidate",
} as const;

/**
 * Create a redirect response with CDN-compatible headers.
 *
 * @param ctx - Hono context
 * @param url - Destination URL
 * @param permanent - Whether this is a permanent (301) or temporary (302) redirect
 * @returns Response object
 */
function createRedirectResponse(
  ctx: Context,
  url: string,
  permanent: boolean
): Response {
  const statusCode = permanent ? 301 : 302;
  const cacheControl = permanent
    ? CACHE_CONTROL.REDIRECT_PERMANENT
    : CACHE_CONTROL.REDIRECT_TEMPORARY;

  return new Response(null, {
    status: statusCode,
    headers: {
      Location: url,
      "Cache-Control": cacheControl,
      // Security headers
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      // Timing header for debugging
      "Server-Timing": `redirect;desc="QuickLink"`,
    },
  });
}

/**
 * Create a 404 response with caching headers.
 *
 * @param ctx - Hono context
 * @returns Response object
 */
function createNotFoundResponse(ctx: Context): Response {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": CACHE_CONTROL.NOT_FOUND,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Create a 503 service unavailable response.
 *
 * @param ctx - Hono context
 * @returns Response object
 */
function createUnavailableResponse(ctx: Context): Response {
  return new Response("Service Temporarily Unavailable", {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": CACHE_CONTROL.ERROR,
      "Retry-After": "5",
    },
  });
}

// =============================================================================
// Main Handler
// =============================================================================

/**
 * Handle redirect request.
 *
 * Performance target: <50ms P99 latency
 *
 * @param ctx - Hono context
 * @returns Response (redirect or error)
 */
export async function handleRedirect(ctx: Context): Promise<Response> {
  const start = performance.now();

  // 1. EXTRACT SHORT CODE
  const shortCode = ctx.req.param("code");

  // 2. VALIDATE FORMAT (fast rejection of invalid codes)
  // This is ~0.01ms - reject invalid patterns before any I/O
  if (!shortCode || !isValidShortCode(shortCode)) {
    metrics.recordRedirect(404, false, performance.now() - start);
    return createNotFoundResponse(ctx);
  }

  // 3. CHECK NEGATIVE CACHE (known 404s)
  // Skip DB lookup if we recently confirmed this code doesn't exist
  // This prevents DB hammering for non-existent links
  const isKnown404 = await cache.isNotFound(shortCode);
  if (isKnown404) {
    metrics.recordNegativeCacheHit();
    metrics.recordRedirect(404, true, performance.now() - start);
    return createNotFoundResponse(ctx);
  }

  // 4. REDIS LOOKUP (primary path - expected ~2-5ms)
  let link: CachedLink | null = await cache.get(shortCode);
  let cacheHit = link !== null;
  let servedStale = false;

  // 5. DB FALLBACK (on cache miss - expected ~10-30ms)
  if (!link) {
    try {
      link = await db.lookup(shortCode);

      if (link) {
        // 6. WARM CACHE (async, don't await)
        // Fire-and-forget: cache write happens in background
        cache.set(shortCode, link).catch(() => {
          // Ignore cache write failures - next request will try again
          metrics.increment("redis_error");
        });
      } else {
        // Cache the 404 to prevent repeated DB lookups
        // This is especially important for bot traffic hitting random URLs
        cache.setNotFound(shortCode).catch(() => {
          // Ignore - worst case is repeated DB lookups
        });
      }
    } catch (err) {
      // DB error - check if we have stale cache data
      const staleResult = await cache.get(shortCode, { allowStale: true });
      if (staleResult) {
        link = staleResult;
        servedStale = true;
      } else {
        // Complete failure - return 503
        metrics.increment("db_error");
        metrics.recordRedirect(503, false, performance.now() - start);
        return createUnavailableResponse(ctx);
      }
    }
  }

  // 7. NOT FOUND
  if (!link) {
    metrics.recordRedirect(404, cacheHit, performance.now() - start);
    return createNotFoundResponse(ctx);
  }

  // 8. FIRE ANALYTICS (fire-and-forget)
  // This never blocks the redirect - queued for async processing
  fireAnalytics(shortCode, ctx, link);

  // 9. RECORD METRICS
  const statusCode = link.permanent ? 301 : 302;
  const latencyMs = performance.now() - start;
  metrics.recordRedirect(statusCode, cacheHit, latencyMs);

  // Log slow requests for investigation (>50ms)
  if (latencyMs > 50) {
    console.warn(`[handler] Slow redirect: ${shortCode} took ${latencyMs.toFixed(2)}ms (cache=${cacheHit}, stale=${servedStale})`);
  }

  // 10. REDIRECT
  return createRedirectResponse(ctx, link.url, link.permanent);
}

// =============================================================================
// Health Check Handlers
// =============================================================================

/**
 * Liveness probe - is the process alive?
 * No dependencies - if this responds, we're alive.
 */
export function handleLiveness(ctx: Context): Response {
  return ctx.json({ status: "ok" });
}

/**
 * Readiness probe - can we serve traffic?
 * Checks Redis and DB connectivity.
 */
export async function handleReadiness(ctx: Context): Promise<Response> {
  const [redisOk, dbOk] = await Promise.all([cache.ping(), db.ping()]);

  const status = redisOk && dbOk ? "ok" : redisOk || dbOk ? "degraded" : "unhealthy";

  const response = {
    status,
    checks: {
      redis: redisOk ? "ok" : "error",
      db: dbOk ? "ok" : "error",
    },
  };

  // Return 503 if completely unhealthy
  const httpStatus = status === "unhealthy" ? 503 : 200;

  return ctx.json(response, httpStatus);
}

/**
 * Metrics endpoint - Prometheus format.
 */
export function handleMetrics(ctx: Context): Response {
  ctx.header("Content-Type", "text/plain; version=0.0.4");
  return ctx.text(metrics.getMetrics());
}
