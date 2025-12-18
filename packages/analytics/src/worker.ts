/**
 * Analytics Event Worker
 *
 * Consumes click events from BullMQ queue and persists to database.
 * Designed for high-throughput, reliable processing.
 *
 * Architecture:
 * ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
 * │   BullMQ    │────▶│   Worker    │────▶│  PostgreSQL │
 * │   Queue     │     │  (Batch)    │     │  click_evts │
 * └─────────────┘     └─────────────┘     └─────────────┘
 *
 * Key Features:
 * - Batch processing for DB efficiency (reduces connections)
 * - Graceful shutdown with in-flight job completion
 * - Retry with exponential backoff for transient failures
 * - Bot filtering (optional - can skip DB writes for bots)
 * - Metrics collection for monitoring
 *
 * Performance Tuning:
 * - batchSize: Higher = fewer DB calls, more memory
 * - batchTimeout: Lower = fresher data, more DB calls
 * - concurrency: Higher = more parallelism, more DB connections
 *
 * @see ./producer.ts for event emission
 * @see ./types.ts for configuration options
 */

import { Worker, Job } from "bullmq";
import { prisma } from "@quicklink/db";
import { logger } from "@quicklink/logger";
import {
  QUEUE_NAMES,
  DEFAULT_WORKER_CONFIG,
  type ClickEventPayload,
  type ClickEventRecord,
  type WorkerConfig,
} from "./types.js";

// =============================================================================
// Batch Accumulator
// =============================================================================

/**
 * Accumulates events for batch processing
 *
 * Design:
 * - Events accumulate until batch size or timeout is reached
 * - Flush is triggered by whichever comes first
 * - Thread-safe via single-threaded Node.js event loop
 */
class BatchAccumulator {
  private events: ClickEventRecord[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly batchSize: number;
  private readonly batchTimeout: number;
  private readonly onFlush: (events: ClickEventRecord[]) => Promise<void>;

  // Metrics
  private totalReceived = 0;
  private totalFlushed = 0;
  private lastFlushTime = Date.now();

  constructor(
    batchSize: number,
    batchTimeout: number,
    onFlush: (events: ClickEventRecord[]) => Promise<void>
  ) {
    this.batchSize = batchSize;
    this.batchTimeout = batchTimeout;
    this.onFlush = onFlush;
  }

  /**
   * Add an event to the batch
   * Triggers flush if batch size reached
   */
  async add(event: ClickEventRecord): Promise<void> {
    this.events.push(event);
    this.totalReceived++;

    // Start timeout timer if this is the first event
    if (this.events.length === 1) {
      this.startTimer();
    }

    // Flush if batch size reached
    if (this.events.length >= this.batchSize) {
      await this.flush();
    }
  }

  /**
   * Force flush all accumulated events
   */
  async flush(): Promise<void> {
    this.clearTimer();

    if (this.events.length === 0) return;

    const eventsToFlush = this.events;
    this.events = [];

    try {
      await this.onFlush(eventsToFlush);
      this.totalFlushed += eventsToFlush.length;
      this.lastFlushTime = Date.now();

      logger.debug(
        { count: eventsToFlush.length, total: this.totalFlushed },
        "Batch flushed to database"
      );
    } catch (error) {
      // Put events back for retry
      this.events = [...eventsToFlush, ...this.events];
      throw error;
    }
  }

  /**
   * Get accumulator metrics
   */
  getMetrics(): {
    pending: number;
    totalReceived: number;
    totalFlushed: number;
    msSinceLastFlush: number;
  } {
    return {
      pending: this.events.length,
      totalReceived: this.totalReceived,
      totalFlushed: this.totalFlushed,
      msSinceLastFlush: Date.now() - this.lastFlushTime,
    };
  }

  private startTimer(): void {
    this.clearTimer();
    this.flushTimer = setTimeout(() => {
      this.flush().catch((error) => {
        logger.error({ err: error }, "Batch flush failed on timeout");
      });
    }, this.batchTimeout);
  }

  private clearTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// =============================================================================
// Database Operations
// =============================================================================

/**
 * Batch insert click events into database
 *
 * Uses Prisma's createMany for efficiency.
 * Falls back to individual inserts if batch fails.
 *
 * Trade-offs:
 * - createMany: Fast but no return values, skips duplicates
 * - Individual: Slower but can handle partial failures
 */
async function insertClickEventsBatch(events: ClickEventRecord[]): Promise<void> {
  if (events.length === 0) return;

  try {
    // Batch insert (most efficient)
    await prisma.clickEvent.createMany({
      data: events.map((e) => ({
        linkId: e.linkId,
        createdAt: e.createdAt,
        ipHash: e.ipHash,
        userAgent: e.userAgent,
        referrer: e.referrer,
        country: e.country,
        region: e.region,
        bot: e.bot,
      })),
      skipDuplicates: true, // Idempotent - skip if already exists
    });

    // Update click counts (fire-and-forget, batched by link)
    const clicksByLink = new Map<string, number>();
    for (const event of events) {
      const key = event.linkId.toString();
      clicksByLink.set(key, (clicksByLink.get(key) || 0) + 1);
    }

    // Update counts in parallel
    await Promise.all(
      Array.from(clicksByLink.entries()).map(([linkIdStr, count]) =>
        prisma.link.update({
          where: { id: BigInt(linkIdStr) },
          data: { clickCount: { increment: count } },
        }).catch((err: unknown) => {
          // Link might be deleted - log and continue
          logger.warn({ err, linkId: linkIdStr }, "Failed to update click count");
        })
      )
    );
  } catch (error) {
    logger.error({ err: error, count: events.length }, "Batch insert failed");

    // Fallback: try individual inserts
    let successCount = 0;
    for (const event of events) {
      try {
        await prisma.clickEvent.create({
          data: {
            linkId: event.linkId,
            createdAt: event.createdAt,
            ipHash: event.ipHash,
            userAgent: event.userAgent,
            referrer: event.referrer,
            country: event.country,
            region: event.region,
            bot: event.bot,
          },
        });
        successCount++;
      } catch (individualError) {
        // Log individual failure but continue
        logger.warn(
          { err: individualError, linkId: event.linkId.toString() },
          "Individual insert failed"
        );
      }
    }

    logger.info(
      { successCount, total: events.length },
      "Fallback individual inserts completed"
    );
  }
}

// =============================================================================
// Worker Implementation
// =============================================================================

/**
 * Analytics worker state
 */
interface WorkerState {
  worker: Worker<ClickEventPayload> | null;
  accumulator: BatchAccumulator | null;
  config: WorkerConfig;
  isShuttingDown: boolean;
}

const state: WorkerState = {
  worker: null,
  accumulator: null,
  config: DEFAULT_WORKER_CONFIG,
  isShuttingDown: false,
};

/**
 * Process a single click event job
 */
async function processClickEvent(
  job: Job<ClickEventPayload>,
  accumulator: BatchAccumulator,
  config: WorkerConfig
): Promise<void> {
  const payload = job.data;

  // Optionally skip bot traffic
  if (config.skipBots && payload.bot) {
    logger.debug({ eventId: payload.eventId }, "Skipping bot event");
    return;
  }

  // Convert payload to database record
  const record: ClickEventRecord = {
    linkId: BigInt(payload.linkId),
    createdAt: new Date(payload.timestamp),
    ipHash: payload.ipHash || null,
    userAgent: payload.userAgent || null,
    referrer: payload.referrer || null,
    country: payload.country || null,
    region: payload.region || null,
    bot: payload.bot,
  };

  // Add to batch accumulator
  await accumulator.add(record);
}

/**
 * Start the analytics worker
 *
 * @param config - Worker configuration (optional, uses defaults)
 * @returns Started worker instance
 *
 * @example
 * ```ts
 * // Start with defaults
 * const worker = await startWorker();
 *
 * // Start with custom config
 * const worker = await startWorker({
 *   batchSize: 200,
 *   concurrency: 20,
 * });
 *
 * // Graceful shutdown
 * await stopWorker();
 * ```
 */
export async function startWorker(
  config: Partial<WorkerConfig> = {}
): Promise<Worker<ClickEventPayload>> {
  // Merge with defaults
  state.config = { ...DEFAULT_WORKER_CONFIG, ...config };
  state.isShuttingDown = false;

  // Create batch accumulator
  state.accumulator = new BatchAccumulator(
    state.config.batchSize,
    state.config.batchTimeout,
    insertClickEventsBatch
  );

  // Create BullMQ worker
  state.worker = new Worker<ClickEventPayload>(
    QUEUE_NAMES.CLICK_EVENTS,
    async (job: Job<ClickEventPayload>) => {
      if (!state.accumulator) {
        throw new Error("Accumulator not initialized");
      }
      await processClickEvent(job, state.accumulator, state.config);
    },
    {
      connection: {
        url: state.config.redisUrl,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
      concurrency: state.config.concurrency,
      limiter: {
        // Rate limit to prevent overwhelming DB
        max: 10000, // Max 10k jobs per second
        duration: 1000,
      },
    }
  );

  // Event handlers
  state.worker.on("completed", (job: Job<ClickEventPayload>) => {
    logger.debug({ jobId: job.id }, "Job completed");
  });

  state.worker.on("failed", (job: Job<ClickEventPayload> | undefined, error: Error) => {
    logger.error(
      { jobId: job?.id, err: error },
      "Job failed"
    );
  });

  state.worker.on("error", (error: Error) => {
    logger.error({ err: error }, "Worker error");
  });

  state.worker.on("stalled", (jobId: string) => {
    logger.warn({ jobId }, "Job stalled");
  });

  logger.info(
    {
      queueName: QUEUE_NAMES.CLICK_EVENTS,
      batchSize: state.config.batchSize,
      concurrency: state.config.concurrency,
    },
    "Analytics worker started"
  );

  return state.worker;
}

/**
 * Stop the analytics worker gracefully
 *
 * Waits for:
 * 1. Current jobs to complete
 * 2. Pending batch to flush
 * 3. Worker connection to close
 */
export async function stopWorker(): Promise<void> {
  state.isShuttingDown = true;

  if (state.worker) {
    logger.info("Stopping analytics worker...");

    // Close worker (waits for current jobs)
    await state.worker.close();
    state.worker = null;
  }

  // Flush any remaining events
  if (state.accumulator) {
    await state.accumulator.flush();
    state.accumulator = null;
  }

  logger.info("Analytics worker stopped");
}

/**
 * Get worker metrics for monitoring
 */
export function getWorkerMetrics(): {
  isRunning: boolean;
  batch: {
    pending: number;
    totalReceived: number;
    totalFlushed: number;
    msSinceLastFlush: number;
  } | null;
} {
  return {
    isRunning: state.worker !== null && !state.isShuttingDown,
    batch: state.accumulator?.getMetrics() || null,
  };
}

/**
 * Check if worker is healthy
 */
export function isWorkerHealthy(): boolean {
  return state.worker !== null && !state.isShuttingDown;
}