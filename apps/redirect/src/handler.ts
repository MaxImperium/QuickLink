/**
 * Redirect Request Handler
 *
 * Core redirect logic - the hot path.
 * Every line here is optimized for minimal latency.
 *
 * Flow:
 * 1. Extract short code from URL
 * 2. Check negative cache (known 404s)
 * 3. Redis lookup
 * 4. DB fallback on cache miss
 * 5. Warm cache (async)
 * 6. Emit analytics event (fire-and-forget)
 * 7. Return 301/302 redirect
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
 */
const SHORT_CODE_REGEX = /^[a-zA-Z0-9]{4,12}$/;

/**
 * Validate short code format.
 * Inline for performance - this runs on every request.
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
 */
export function setAnalyticsEmitter(
  emitter: (event: ClickEvent) => void
): void {
  emitAnalytics = emitter;
}

/**
 * Fire analytics event - never awaited, never blocks redirect.
 */
function fireAnalytics(code: string, ctx: Context): void {
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
        // IP hashing would happen here (not implemented in skeleton)
      },
    };

    // Fire-and-forget - emitter handles queuing
    emitAnalytics(event);
  } catch {
    // Silently ignore analytics errors
  }
}

// =============================================================================
// Main Handler
// =============================================================================

/**
 * Handle redirect request.
 *
 * @param ctx - Hono context
 * @returns Response (redirect or error)
 */
export async function handleRedirect(ctx: Context): Promise<Response> {
  const start = performance.now();

  // 1. EXTRACT SHORT CODE
  const shortCode = ctx.req.param("code");

  // 2. VALIDATE FORMAT (fast rejection of invalid codes)
  if (!shortCode || !isValidShortCode(shortCode)) {
    metrics.recordRedirect(404, false, performance.now() - start);
    return ctx.text("Not Found", 404);
  }

  // 3. CHECK NEGATIVE CACHE (known 404s)
  // Skip DB lookup if we recently confirmed this code doesn't exist
  const isKnown404 = await cache.isNotFound(shortCode);
  if (isKnown404) {
    metrics.recordRedirect(404, true, performance.now() - start);
    return ctx.text("Not Found", 404);
  }

  // 4. REDIS LOOKUP (primary path)
  let link: CachedLink | null = await cache.get(shortCode);
  let cacheHit = link !== null;

  // 5. DB FALLBACK (on cache miss)
  if (!link) {
    link = await db.lookup(shortCode);

    if (link) {
      // 6. WARM CACHE (async, don't await)
      cache.set(shortCode, link).catch(() => {
        /* ignore cache errors */
      });
    } else {
      // Cache the 404 to prevent repeated DB lookups
      cache.setNotFound(shortCode).catch(() => {
        /* ignore */
      });
    }
  }

  // 7. NOT FOUND
  if (!link) {
    metrics.recordRedirect(404, cacheHit, performance.now() - start);
    return ctx.text("Not Found", 404);
  }

  // 8. FIRE ANALYTICS (fire-and-forget)
  fireAnalytics(shortCode, ctx);

  // 9. RECORD METRICS
  const statusCode = link.permanent ? 301 : 302;
  metrics.recordRedirect(statusCode, cacheHit, performance.now() - start);

  // 10. REDIRECT
  return ctx.redirect(link.url, statusCode);
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
