/**
 * HTTP Server Bootstrap
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
// Analytics Emitter (Placeholder)
// =============================================================================

/**
 * Create analytics emitter.
 *
 * In production, this would push to Redis queue (BullMQ).
 * For now, it's a placeholder that logs events.
 *
 * Design: Fire-and-forget - never blocks the redirect.
 */
function createAnalyticsEmitter(config: Config): (event: ClickEvent) => void {
  // TODO: Replace with actual queue implementation
  // Example with BullMQ:
  // const queue = new Queue('analytics', { connection: redisConnection });
  // return (event) => queue.add('click', event, { removeOnComplete: true });

  // Placeholder: Just log in debug mode
  if (config.logLevel === "debug") {
    return (event: ClickEvent) => {
      console.debug("[analytics] Click event:", event.code);
    };
  }

  // No-op in production (until queue is implemented)
  return () => {};
}

// =============================================================================
// Server Lifecycle
// =============================================================================

/**
 * Initialize all dependencies.
 */
async function initialize(config: Config): Promise<void> {
  console.log("[server] Initializing...");

  // Initialize cache (Redis)
  initCache({
    redisUrl: config.redisUrl,
    redisTimeoutMs: config.redisTimeoutMs,
    cacheTtlSeconds: config.cacheTtlSeconds,
    notFoundTtlSeconds: config.notFoundTtlSeconds,
  });

  // Initialize database
  await initDb({
    databaseUrl: config.databaseUrl,
    dbTimeoutMs: config.dbTimeoutMs,
  });

  // Initialize analytics emitter
  const emitter = createAnalyticsEmitter(config);
  setAnalyticsEmitter(emitter);

  console.log("[server] Initialization complete");
}

/**
 * Graceful shutdown handler.
 */
async function shutdown(): Promise<void> {
  console.log("[server] Shutting down...");

  await Promise.all([shutdownCache(), shutdownDb()]);

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
