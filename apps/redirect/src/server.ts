/**
 * HTTP Server Bootstrap - Production Optimized
 *
 * Minimal Hono server setup for the redirect service.
 *
 * Why Hono?
 * - ~0.3ms routing overhead (vs ~1.5ms Express, ~0.8ms Fastify)
 * - 14KB bundle size
 * - Built-in TypeScript
 * - Simple, predictable behavior
 * - Easy to understand and debug
 *
 * Performance Targets:
 * - P99 latency: <50ms
 * - Cache hit rate: >95%
 * - Throughput: 10,000+ req/s per instance
 *
 * Trade-offs:
 * - Less ecosystem than Express/Fastify
 * - Fewer built-in plugins
 * - Acceptable for our single-purpose service
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";

import type { Config, ClickEvent } from "./types.js";
import { loadConfig, validateConfig } from "./config.js";
import { initCache, shutdown as shutdownCache } from "./cache.js";
import { initDb, shutdown as shutdownDb } from "./db.js";
import {
  handleRedirect,
  handleLiveness,
  handleReadiness,
  handleMetrics,
  setAnalyticsEmitter,
} from "./handler.js";

// =============================================================================
// Application Setup
// =============================================================================

/**
 * Create and configure the Hono application.
 */
function createApp(): Hono {
  const app = new Hono();

  // ---------------------------------------------------------------------------
  // Health & Monitoring Routes (high priority, before redirect)
  // ---------------------------------------------------------------------------

  // Liveness probe - no dependencies
  app.get("/health", handleLiveness);

  // Readiness probe - checks dependencies
  app.get("/health/ready", handleReadiness);

  // Prometheus metrics
  app.get("/metrics", handleMetrics);

  // ---------------------------------------------------------------------------
  // Redirect Route (the hot path)
  // ---------------------------------------------------------------------------

  // Catch-all for short codes
  // Pattern: /:code where code is 4-12 alphanumeric characters
  app.get("/:code", handleRedirect);

  // ---------------------------------------------------------------------------
  // Fallback Routes
  // ---------------------------------------------------------------------------

  // Root path - minimal response (could be used for monitoring)
  app.get("/", (c) => c.text("QuickLink Redirect Service", 200));

  // 404 for everything else
  app.notFound((c) => c.text("Not Found", 404));

  // Global error handler
  app.onError((err, c) => {
    console.error("[server] Unhandled error:", err);
    return c.text("Internal Server Error", 500);
  });

  return app;
}

// =============================================================================
// Analytics Emitter
// =============================================================================

/**
 * Analytics producer instance.
 * Initialized in setupAnalytics() - may be null if analytics is disabled.
 */
let analyticsProducer: { emitClickEvent: (event: ClickEvent) => void; shutdown: () => Promise<void> } | null = null;

/**
 * Set up analytics integration.
 *
 * Attempts to use @quicklink/analytics package for production.
 * Falls back to logging in development or if package unavailable.
 *
 * Design: Fire-and-forget - never blocks the redirect.
 *
 * @param config - Application configuration
 */
async function setupAnalytics(config: Config): Promise<void> {
  try {
    // Try to import the analytics package
    const analytics = await import("@quicklink/analytics");

    // Initialize the producer with Redis connection
    analyticsProducer = await analytics.createProducer({
      redis: {
        url: config.redisUrl,
        maxRetriesPerRequest: 1,
      },
      queueName: "analytics",
    });

    // Wire up the emitter to the handler
    setAnalyticsEmitter((event: ClickEvent) => {
      // Fire-and-forget: no await, no error handling
      // Producer handles queuing internally
      analyticsProducer?.emitClickEvent(event);
    });

    console.log("[server] Analytics producer initialized");
  } catch (err) {
    // Analytics package not available or failed to init
    // This is OK - we can still serve redirects
    console.warn("[server] Analytics not available, using placeholder:", (err as Error).message);

    // Fallback: Log in debug mode, no-op in production
    if (config.logLevel === "debug") {
      setAnalyticsEmitter((event: ClickEvent) => {
        console.debug("[analytics] Click event:", event.code);
      });
    } else {
      // No-op emitter - silently discard events
      setAnalyticsEmitter(() => {});
    }
  }
}

/**
 * Shutdown analytics producer.
 */
async function shutdownAnalytics(): Promise<void> {
  if (analyticsProducer) {
    await analyticsProducer.shutdown();
    analyticsProducer = null;
  }
}

// =============================================================================
// Server Lifecycle
// =============================================================================

/**
 * Initialize all dependencies.
 */
async function initialize(config: Config): Promise<void> {
  console.log("[server] Initializing...");
  console.log(`[server] Environment: ${config.env}`);

  // Initialize cache (Redis) - non-blocking
  initCache({
    redisUrl: config.redisUrl,
    redisTimeoutMs: config.redisTimeoutMs,
    cacheTtlSeconds: config.cacheTtlSeconds,
    notFoundTtlSeconds: config.notFoundTtlSeconds,
  });
  console.log("[server] Cache module initialized");

  // Initialize database - verify connection
  await initDb({
    databaseUrl: config.databaseUrl,
    dbTimeoutMs: config.dbTimeoutMs,
  });
  console.log("[server] Database connection established");

  // Initialize analytics emitter (may fail gracefully)
  await setupAnalytics(config);

  console.log("[server] Initialization complete");
}

/**
 * Graceful shutdown handler.
 * Ensures all pending operations complete before exit.
 */
async function shutdown(): Promise<void> {
  console.log("[server] Shutting down...");

  // Shutdown in reverse order of initialization
  const shutdownPromises = [
    shutdownAnalytics().catch((err) => console.error("[server] Analytics shutdown error:", err)),
    shutdownCache().catch((err) => console.error("[server] Cache shutdown error:", err)),
    shutdownDb().catch((err) => console.error("[server] DB shutdown error:", err)),
  ];

  await Promise.all(shutdownPromises);

  console.log("[server] Shutdown complete");
  process.exit(0);
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Start the redirect server.
 */
async function main(): Promise<void> {
  // Load configuration
  const config = loadConfig();
  validateConfig(config);

  // Initialize dependencies
  await initialize(config);

  // Create application
  const app = createApp();

  // Start HTTP server
  const server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  });

  console.log(
    `[server] QuickLink Redirect Service running on http://${config.host}:${config.port}`
  );

  // Graceful shutdown handlers
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Handle uncaught errors
  process.on("uncaughtException", (err) => {
    console.error("[server] Uncaught exception:", err);
    shutdown();
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[server] Unhandled rejection:", reason);
    // Don't exit on unhandled rejection - log and continue
  });
}

// Run if this is the main module
main().catch((err) => {
  console.error("[server] Failed to start:", err);
  process.exit(1);
});

export { createApp };
