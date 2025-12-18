/**
 * Analytics Worker Entrypoint
 *
 * Standalone process for consuming click events from queue.
 * Run with: pnpm --filter @quicklink/analytics worker
 *
 * Environment Variables:
 *   REDIS_URL - Redis connection URL (default: redis://localhost:6379)
 *   BATCH_SIZE - Events per DB batch (default: 100)
 *   BATCH_TIMEOUT - Max ms before flush (default: 5000)
 *   CONCURRENCY - Parallel job processors (default: 10)
 *   SKIP_BOTS - Skip DB writes for bots (default: false)
 */

import { startWorker, stopWorker, shutdownBotDetection } from "./index.js";
import { logger } from "@quicklink/logger";
import { disconnectDb } from "@quicklink/db";

// Parse configuration from environment
const config = {
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  batchSize: parseInt(process.env.BATCH_SIZE || "100", 10),
  batchTimeout: parseInt(process.env.BATCH_TIMEOUT || "5000", 10),
  concurrency: parseInt(process.env.CONCURRENCY || "10", 10),
  skipBots: process.env.SKIP_BOTS === "true",
  maxRetries: parseInt(process.env.MAX_RETRIES || "3", 10),
};

logger.info({ config }, "Starting analytics worker");

// Start worker
await startWorker(config);

// Graceful shutdown handlers
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutdown signal received");

  try {
    await stopWorker();
    shutdownBotDetection();
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
logger.info("Analytics worker is running. Press Ctrl+C to stop.");
