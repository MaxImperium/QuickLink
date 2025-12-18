/**
 * Analytics Event Producer
 *
 * Emits click events to BullMQ queue for async processing.
 * Used by the redirect service to fire-and-forget click tracking.
 *
 * Design Principles:
 * - Fire-and-forget: Never block redirect response
 * - Resilient: Failures don't affect redirect flow
 * - Efficient: Minimal payload, no duplicate work
 *
 * Performance Characteristics:
 * - Latency: ~1-5ms to push to Redis queue
 * - Throughput: Limited by Redis write speed (~100k ops/sec)
 * - Memory: ~200 bytes per event in queue
 *
 * Error Handling:
 * - Queue push failures are logged but not thrown
 * - Events are dropped if queue is unavailable (redirect still works)
 * - Consider adding a fallback buffer for brief Redis outages
 *
 * @see ./worker.ts for consumer implementation
 * @see ./types.ts for payload definitions
 */

import { Queue } from "bullmq";
import { createHash, randomUUID } from "node:crypto";
import { logger } from "@quicklink/logger";
import { detectBot } from "./bot-detection.js";
import {
  QUEUE_NAMES,
  type ClickEventPayload,
  type EmitClickEventInput,
  type EmitClickEventResult,
} from "./types.js";

// =============================================================================
// Queue Instance (Lazy Initialization)
// =============================================================================

let clickQueue: Queue<ClickEventPayload> | null = null;

/**
 * Get or create the click events queue
 * Lazy initialization for better startup performance
 */
function getClickQueue(): Queue<ClickEventPayload> {
  if (!clickQueue) {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

    clickQueue = new Queue<ClickEventPayload>(QUEUE_NAMES.CLICK_EVENTS, {
      connection: {
        url: redisUrl,
        maxRetriesPerRequest: null, // Required for BullMQ
        enableReadyCheck: false,
      },
      defaultJobOptions: {
        // Don't retry failed events (fire-and-forget)
        attempts: 1,

        // Remove completed jobs after 1 hour (saves Redis memory)
        removeOnComplete: {
          age: 3600, // 1 hour
          count: 10000, // Keep last 10k for debugging
        },

        // Keep failed jobs for debugging (24 hours)
        removeOnFail: {
          age: 86400, // 24 hours
        },
      },
    });

    // Log queue errors (don't throw)
    clickQueue.on("error", (error) => {
      logger.error({ err: error }, "Click queue error");
    });

    logger.info("Click events queue initialized");
  }

  return clickQueue;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Hash IP address for privacy (GDPR compliance)
 * Uses SHA256, truncated to 16 chars for storage efficiency
 *
 * Trade-offs:
 * - Truncation reduces uniqueness but still good for analytics
 * - No salt = same IP always produces same hash (needed for dedup)
 * - Consider adding daily salt rotation for stronger privacy
 */
function hashIpAddress(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

/**
 * Generate unique event ID for idempotency
 * Format: timestamp-uuid to allow time-based sorting
 */
function generateEventId(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}

/**
 * Truncate string to max length (for storage efficiency)
 */
function truncate(str: string | undefined, maxLength: number): string | undefined {
  if (!str) return undefined;
  return str.length > maxLength ? str.slice(0, maxLength) : str;
}

// =============================================================================
// Main Producer Function
// =============================================================================

/**
 * Emit a click event to the processing queue
 *
 * This is the main entry point called by the redirect service.
 * It's designed to be fire-and-forget - never throws, always returns.
 *
 * @param input - Click event data from redirect handler
 * @returns Result with success status and event ID
 *
 * @example
 * ```ts
 * // In redirect handler (fire-and-forget)
 * emitClickEvent({
 *   shortCode: "abc123",
 *   linkId: BigInt(456),
 *   ipAddress: req.ip,
 *   userAgent: req.headers["user-agent"],
 *   referrer: req.headers.referer,
 * });
 * // Don't await - let redirect continue
 * ```
 */
export async function emitClickEvent(
  input: EmitClickEventInput
): Promise<EmitClickEventResult> {
  const eventId = generateEventId();

  try {
    // Hash IP for privacy
    const ipHash = input.ipAddress ? hashIpAddress(input.ipAddress) : undefined;

    // Detect bot traffic
    const botResult = detectBot(input.userAgent, ipHash);

    // Build event payload
    const payload: ClickEventPayload = {
      eventId,
      shortCode: input.shortCode,
      linkId: input.linkId.toString(), // bigint → string for JSON
      timestamp: Date.now(),
      ipHash,
      userAgent: truncate(input.userAgent, 512),
      referrer: truncate(input.referrer, 2048),
      country: input.country,
      region: input.region,
      bot: botResult.isBot,
    };

    // Push to queue (fire-and-forget)
    const queue = getClickQueue();
    await queue.add("click", payload, {
      // Use event ID as job ID for idempotency
      jobId: eventId,
    });

    logger.debug(
      { eventId, shortCode: input.shortCode, bot: botResult.isBot },
      "Click event emitted"
    );

    return { success: true, eventId };
  } catch (error) {
    // Log error but don't throw - redirect must continue
    logger.error(
      { err: error, eventId, shortCode: input.shortCode },
      "Failed to emit click event"
    );

    return {
      success: false,
      eventId,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Emit multiple click events in batch
 * More efficient for bulk operations (imports, replays)
 */
export async function emitClickEventsBatch(
  inputs: EmitClickEventInput[]
): Promise<EmitClickEventResult[]> {
  const results: EmitClickEventResult[] = [];

  // Process in parallel with concurrency limit
  const BATCH_SIZE = 100;
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(emitClickEvent));
    results.push(...batchResults);
  }

  return results;
}

// =============================================================================
// Queue Management
// =============================================================================

/**
 * Get queue stats for monitoring
 */
export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}> {
  const queue = getClickQueue();
  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);

  return { waiting, active, completed, failed };
}

/**
 * Graceful shutdown - close queue connection
 */
export async function shutdownProducer(): Promise<void> {
  if (clickQueue) {
    await clickQueue.close();
    clickQueue = null;
    logger.info("Click events queue closed");
  }
}

/**
 * Pause queue processing (for maintenance)
 */
export async function pauseQueue(): Promise<void> {
  const queue = getClickQueue();
  await queue.pause();
  logger.info("Click events queue paused");
}

/**
 * Resume queue processing
 */
export async function resumeQueue(): Promise<void> {
  const queue = getClickQueue();
  await queue.resume();
  logger.info("Click events queue resumed");
}
