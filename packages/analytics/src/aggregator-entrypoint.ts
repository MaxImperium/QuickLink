/**
 * Analytics Aggregator Entrypoint
 *
 * Standalone process for running aggregation jobs.
 * Run with: pnpm --filter @quicklink/analytics aggregator
 *
 * Environment Variables:
 *   REDIS_URL - Redis connection URL (default: redis://localhost:6379)
 *   ENABLE_SCHEDULER - Enable automatic scheduling (default: true)
 */

import {
  startAggregationWorker,
  stopAggregationWorker,
  startScheduler,
  stopScheduler,
} from "./index.js";
import { logger } from "@quicklink/logger";
import { disconnectDb } from "@quicklink/db";

// Parse configuration from environment
const config = {
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  enableScheduler: process.env.ENABLE_SCHEDULER !== "false",
};

logger.info({ config }, "Starting analytics aggregator");

// Start aggregation worker
await startAggregationWorker({ redisUrl: config.redisUrl });

// Start scheduler if enabled
if (config.enableScheduler) {
  startScheduler({ redisUrl: config.redisUrl });
  logger.info("Scheduler enabled - will run hourly/daily aggregations");
}

// Graceful shutdown handlers
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutdown signal received");

  try {
    stopScheduler();
    await stopAggregationWorker();
    await disconnectDb();
    logger.info("Clean shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "Error during shutdown");
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Keep process alive
logger.info("Analytics aggregator is running. Press Ctrl+C to stop.");
