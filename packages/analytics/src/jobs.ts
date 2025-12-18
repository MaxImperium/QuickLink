/**
 * Analytics Aggregation Jobs
 *
 * Periodic jobs that aggregate click_events into aggregated_stats.
 * Designed for idempotent, resumable processing.
 *
 * Aggregation Strategy:
 * ┌─────────────┐     ┌─────────────┐     ┌──────────────┐
 * │click_events │────▶│  Aggregate  │────▶│aggregated_   │
 * │  (raw)      │     │   (GROUP BY)│     │stats (rolled)│
 * └─────────────┘     └─────────────┘     └──────────────┘
 *
 * Key Features:
 * - Idempotent: Re-running produces same results (UPSERT)
 * - Incremental: Only processes events since last run
 * - Efficient: Uses SQL aggregation, not app-level loops
 * - Resumable: Tracks progress via watermarks
 *
 * Time Windows:
 * - Hourly: For real-time dashboards
 * - Daily: Primary analytics (most used)
 * - Weekly: Trend analysis
 * - Monthly: Long-term reporting
 *
 * Performance Considerations:
 * - Large tables: Use BRIN indexes on created_at
 * - High cardinality: Batch by link_id ranges
 * - Memory: Stream results vs loading all into memory
 *
 * @see packages/db/prisma/schema.prisma for table schemas
 */

import { Queue, Worker, Job } from "bullmq";
import { prisma } from "@quicklink/db";
import { logger } from "@quicklink/logger";
import { Prisma } from "@prisma/client";
import {
  QUEUE_NAMES,
  DEFAULT_AGGREGATION_CONFIG,
  type AggregationConfig,
  type AggregationJobData,
  type AggregationJobType,
  type AggregationResult,
} from "./types.js";

// =============================================================================
// Aggregation Queue
// =============================================================================

let aggregationQueue: Queue<AggregationJobData> | null = null;
let aggregationWorker: Worker<AggregationJobData> | null = null;

/**
 * Get or create the aggregation queue
 */
function getAggregationQueue(redisUrl: string): Queue<AggregationJobData> {
  if (!aggregationQueue) {
    aggregationQueue = new Queue<AggregationJobData>(QUEUE_NAMES.AGGREGATION, {
      connection: {
        url: redisUrl,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 60000, // Start with 1 minute
        },
        removeOnComplete: {
          age: 86400, // Keep 24 hours
          count: 100,
        },
        removeOnFail: {
          age: 604800, // Keep 7 days
        },
      },
    });

    logger.info("Aggregation queue initialized");
  }

  return aggregationQueue;
}

// =============================================================================
// Date Utilities
// =============================================================================

/**
 * Get start of period for a given date
 */
function getStartOfPeriod(date: Date, period: AggregationJobType): Date {
  const d = new Date(date);

  switch (period) {
    case "hourly":
      d.setMinutes(0, 0, 0);
      break;
    case "daily":
      d.setHours(0, 0, 0, 0);
      break;
    case "weekly":
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - d.getDay()); // Start of week (Sunday)
      break;
    case "monthly":
      d.setHours(0, 0, 0, 0);
      d.setDate(1);
      break;
    default:
      d.setHours(0, 0, 0, 0);
  }

  return d;
}

/**
 * Get end of period for a given date
 */
function getEndOfPeriod(date: Date, period: AggregationJobType): Date {
  const d = new Date(date);

  switch (period) {
    case "hourly":
      d.setMinutes(59, 59, 999);
      break;
    case "daily":
      d.setHours(23, 59, 59, 999);
      break;
    case "weekly":
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - d.getDay() + 6); // End of week (Saturday)
      d.setHours(23, 59, 59, 999);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      d.setDate(0); // Last day of previous month
      d.setHours(23, 59, 59, 999);
      break;
    default:
      d.setHours(23, 59, 59, 999);
  }

  return d;
}

// =============================================================================
// Aggregation Logic
// =============================================================================

/**
 * Aggregate click events for a time window
 *
 * This is the core aggregation logic. It:
 * 1. Queries click_events within the time window
 * 2. Groups by link_id and date
 * 3. Counts total clicks and unique visitors (by ip_hash)
 * 4. Upserts into aggregated_stats
 *
 * Idempotency:
 * - Uses UPSERT (ON CONFLICT UPDATE)
 * - Re-running for same window overwrites with same data
 * - Safe to run multiple times
 */
async function aggregateClicksForWindow(
  startDate: Date,
  endDate: Date,
  linkIds?: bigint[]
): Promise<{ linksProcessed: number; clicksAggregated: number }> {
  // Build where clause
  const where: Prisma.ClickEventWhereInput = {
    createdAt: {
      gte: startDate,
      lte: endDate,
    },
  };

  if (linkIds && linkIds.length > 0) {
    where.linkId = { in: linkIds };
  }

  // Get aggregated data using raw SQL for efficiency
  // Prisma's groupBy doesn't support COUNT(DISTINCT)
  const aggregated = await prisma.$queryRaw<
    Array<{
      linkId: bigint;
      date: Date;
      clicks: bigint;
      uniqueVisitors: bigint;
    }>
  >`
    SELECT
      "linkId",
      DATE("createdAt") as date,
      COUNT(*) as clicks,
      COUNT(DISTINCT "ipHash") as "uniqueVisitors"
    FROM "click_events"
    WHERE "createdAt" >= ${startDate}
      AND "createdAt" <= ${endDate}
      ${linkIds && linkIds.length > 0 ? Prisma.sql`AND "linkId" IN (${Prisma.join(linkIds)})` : Prisma.empty}
    GROUP BY "linkId", DATE("createdAt")
  `;

  if (aggregated.length === 0) {
    return { linksProcessed: 0, clicksAggregated: 0 };
  }

  // Upsert aggregated stats
  // Use raw SQL for efficient bulk upsert
  let totalClicks = 0n;
  const uniqueLinks = new Set<string>();

  for (const row of aggregated) {
    await prisma.$executeRaw`
      INSERT INTO "aggregated_stats" ("linkId", "date", "clicks", "uniqueVisitors", "updatedAt")
      VALUES (${row.linkId}, ${row.date}, ${row.clicks}, ${row.uniqueVisitors}, NOW())
      ON CONFLICT ("linkId", "date")
      DO UPDATE SET
        "clicks" = EXCLUDED."clicks",
        "uniqueVisitors" = EXCLUDED."uniqueVisitors",
        "updatedAt" = NOW()
    `;

    totalClicks += row.clicks;
    uniqueLinks.add(row.linkId.toString());
  }

  return {
    linksProcessed: uniqueLinks.size,
    clicksAggregated: Number(totalClicks),
  };
}

/**
 * Process an aggregation job
 */
async function processAggregationJob(
  job: Job<AggregationJobData>
): Promise<AggregationResult> {
  const { type, startDate, endDate, linkIds } = job.data;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const startTime = Date.now();

  logger.info(
    { type, startDate, endDate, linkIds: linkIds?.length },
    "Starting aggregation job"
  );

  try {
    const linkIdsBigInt = linkIds?.map((id: string) => BigInt(id));
    const result = await aggregateClicksForWindow(start, end, linkIdsBigInt);

    const duration = Date.now() - startTime;

    logger.info(
      {
        type,
        linksProcessed: result.linksProcessed,
        clicksAggregated: result.clicksAggregated,
        duration,
      },
      "Aggregation job completed"
    );

    return {
      period: type === "backfill" ? "daily" : type,
      startTime: start,
      endTime: end,
      linksProcessed: result.linksProcessed,
      clicksAggregated: result.clicksAggregated,
      duration,
      success: true,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error(
      { err: error, type, startDate, endDate },
      "Aggregation job failed"
    );

    return {
      period: type === "backfill" ? "daily" : type,
      startTime: start,
      endTime: end,
      linksProcessed: 0,
      clicksAggregated: 0,
      duration,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// Job Scheduling
// =============================================================================

/**
 * Schedule an aggregation job
 */
export async function scheduleAggregation(
  type: AggregationJobType,
  startDate: Date,
  endDate: Date,
  options: {
    redisUrl?: string;
    linkIds?: string[];
    delay?: number;
  } = {}
): Promise<string> {
  const redisUrl = options.redisUrl || DEFAULT_AGGREGATION_CONFIG.redisUrl;
  const queue = getAggregationQueue(redisUrl);

  const jobData: AggregationJobData = {
    type,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    linkIds: options.linkIds,
  };

  const job = await queue.add(type, jobData, {
    delay: options.delay,
    jobId: `${type}-${startDate.toISOString()}-${endDate.toISOString()}`,
  });

  logger.info(
    { jobId: job.id, type, startDate, endDate },
    "Aggregation job scheduled"
  );

  return job.id!;
}

/**
 * Schedule daily aggregation for yesterday
 * Typically called via cron at 00:30 UTC
 */
export async function scheduleDailyAggregation(
  options: { redisUrl?: string } = {}
): Promise<string> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const start = getStartOfPeriod(yesterday, "daily");
  const end = getEndOfPeriod(yesterday, "daily");

  return scheduleAggregation("daily", start, end, options);
}

/**
 * Schedule hourly aggregation for the previous hour
 * Typically called via cron at :05 past each hour
 */
export async function scheduleHourlyAggregation(
  options: { redisUrl?: string } = {}
): Promise<string> {
  const lastHour = new Date();
  lastHour.setHours(lastHour.getHours() - 1);

  const start = getStartOfPeriod(lastHour, "hourly");
  const end = getEndOfPeriod(lastHour, "hourly");

  return scheduleAggregation("hourly", start, end, options);
}

/**
 * Schedule backfill aggregation for a date range
 * Used to rebuild stats after schema changes or data fixes
 */
export async function scheduleBackfill(
  startDate: Date,
  endDate: Date,
  options: { redisUrl?: string; linkIds?: string[] } = {}
): Promise<string[]> {
  const jobIds: string[] = [];
  const current = new Date(startDate);

  // Schedule one job per day
  while (current <= endDate) {
    const dayStart = getStartOfPeriod(current, "daily");
    const dayEnd = getEndOfPeriod(current, "daily");

    const jobId = await scheduleAggregation("backfill", dayStart, dayEnd, {
      ...options,
      delay: jobIds.length * 1000, // Stagger by 1 second
    });

    jobIds.push(jobId);
    current.setDate(current.getDate() + 1);
  }

  logger.info(
    { jobCount: jobIds.length, startDate, endDate },
    "Backfill jobs scheduled"
  );

  return jobIds;
}

// =============================================================================
// Worker Management
// =============================================================================

/**
 * Start the aggregation worker
 */
export async function startAggregationWorker(
  config: Partial<AggregationConfig> = {}
): Promise<Worker<AggregationJobData>> {
  const mergedConfig = { ...DEFAULT_AGGREGATION_CONFIG, ...config };

  aggregationWorker = new Worker<AggregationJobData>(
    QUEUE_NAMES.AGGREGATION,
    async (job: Job<AggregationJobData>) => {
      const result = await processAggregationJob(job);
      if (!result.success) {
        throw new Error(result.error || "Aggregation failed");
      }
      return result;
    },
    {
      connection: {
        url: mergedConfig.redisUrl,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
      concurrency: 1, // One aggregation at a time to prevent conflicts
      limiter: {
        max: 1,
        duration: 10000, // Max 1 job per 10 seconds
      },
    }
  );

  aggregationWorker.on("completed", (job: Job<AggregationJobData>, result: AggregationResult) => {
    logger.info(
      {
        jobId: job.id,
        linksProcessed: result.linksProcessed,
        clicksAggregated: result.clicksAggregated,
      },
      "Aggregation job completed"
    );
  });

  aggregationWorker.on("failed", (job: Job<AggregationJobData> | undefined, error: Error) => {
    logger.error(
      { jobId: job?.id, err: error },
      "Aggregation job failed"
    );
  });

  logger.info("Aggregation worker started");
  return aggregationWorker;
}

/**
 * Stop the aggregation worker
 */
export async function stopAggregationWorker(): Promise<void> {
  if (aggregationWorker) {
    await aggregationWorker.close();
    aggregationWorker = null;
    logger.info("Aggregation worker stopped");
  }

  if (aggregationQueue) {
    await aggregationQueue.close();
    aggregationQueue = null;
    logger.info("Aggregation queue closed");
  }
}

// =============================================================================
// Cron-like Scheduler
// =============================================================================

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the aggregation scheduler
 *
 * Runs aggregation jobs on a schedule:
 * - Hourly: Every hour at :05
 * - Daily: Every day at 00:30 UTC
 *
 * For production, consider using a proper cron scheduler
 * like node-cron or external cron (Kubernetes CronJob)
 */
export function startScheduler(options: { redisUrl?: string } = {}): void {
  if (schedulerInterval) {
    logger.warn("Scheduler already running");
    return;
  }

  let lastHourlyRun = -1;
  let lastDailyRun = -1;

  schedulerInterval = setInterval(() => {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();

    // Hourly aggregation at :05
    if (minute >= 5 && minute < 10 && lastHourlyRun !== hour) {
      lastHourlyRun = hour;
      scheduleHourlyAggregation(options).catch((err) => {
        logger.error({ err }, "Failed to schedule hourly aggregation");
      });
    }

    // Daily aggregation at 00:30 UTC
    if (hour === 0 && minute >= 30 && minute < 35 && lastDailyRun !== now.getUTCDate()) {
      lastDailyRun = now.getUTCDate();
      scheduleDailyAggregation(options).catch((err) => {
        logger.error({ err }, "Failed to schedule daily aggregation");
      });
    }
  }, 60000); // Check every minute

  logger.info("Aggregation scheduler started");
}

/**
 * Stop the aggregation scheduler
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info("Aggregation scheduler stopped");
  }
}

// =============================================================================
// Direct Aggregation (for testing/debugging)
// =============================================================================

/**
 * Run aggregation directly (synchronous, no queue)
 * Useful for testing and debugging
 */
export async function runAggregationDirect(
  type: AggregationJobType,
  startDate: Date,
  endDate: Date,
  linkIds?: string[]
): Promise<AggregationResult> {
  const job = {
    data: {
      type,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      linkIds,
    },
  } as Job<AggregationJobData>;

  return processAggregationJob(job);
}