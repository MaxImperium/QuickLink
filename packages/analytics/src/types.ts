/**
 * @quicklink/analytics - TypeScript Type Definitions
 *
 * Defines all types for the analytics pipeline.
 * These types are used across producer, worker, and jobs.
 *
 * Design Decisions:
 * - Use `bigint` for IDs to match Prisma schema
 * - Include `bot` flag to filter analytics
 * - Use timestamps as numbers for Redis serialization
 * - Keep payloads minimal for queue efficiency
 *
 * @see packages/db/prisma/schema.prisma for DB schema
 */

// =============================================================================
// Queue Event Types
// =============================================================================

/**
 * Click event payload pushed to BullMQ queue.
 * This is the minimal data needed for async processing.
 *
 * Trade-offs:
 * - We hash IP before queuing for privacy (GDPR compliance)
 * - We truncate user_agent to 512 chars to save space
 * - We include `bot` flag to potentially skip DB writes for bots
 */
export interface ClickEventPayload {
  /** Event unique identifier for idempotency */
  eventId: string;

  /** Short code for the link */
  shortCode: string;

  /** Link database ID (bigint as string for JSON serialization) */
  linkId: string;

  /** Unix timestamp (ms) when click occurred */
  timestamp: number;

  /** SHA256 hash of IP address (first 16 chars) */
  ipHash?: string;

  /** User-Agent header (truncated to 512 chars) */
  userAgent?: string;

  /** Referer header (truncated to 2048 chars) */
  referrer?: string;

  /** ISO country code (e.g., "US", "DE") */
  country?: string;

  /** Region/state code */
  region?: string;

  /** Whether this click is from a bot */
  bot: boolean;
}

/**
 * Result of bot detection analysis
 */
export interface BotDetectionResult {
  isBot: boolean;
  reason?: BotDetectionReason;
  confidence: number; // 0-1
}

export type BotDetectionReason =
  | "user_agent_pattern"
  | "missing_user_agent"
  | "request_frequency"
  | "known_bot_ip"
  | "suspicious_headers";

// =============================================================================
// Worker Types
// =============================================================================

/**
 * Configuration for the analytics worker
 */
export interface WorkerConfig {
  /** Redis connection URL */
  redisUrl: string;

  /** Number of events to batch before DB write */
  batchSize: number;

  /** Max time (ms) to wait before flushing batch */
  batchTimeout: number;

  /** Number of concurrent jobs to process */
  concurrency: number;

  /** Whether to skip DB writes for bot traffic */
  skipBots: boolean;

  /** Max retries for failed jobs */
  maxRetries: number;
}

/**
 * Default worker configuration
 *
 * Tuned for:
 * - High throughput (batch size 100)
 * - Low latency (5s batch timeout)
 * - Memory efficiency (10 concurrent jobs)
 */
export const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  redisUrl: "redis://localhost:6379",
  batchSize: 100,
  batchTimeout: 5000,
  concurrency: 10,
  skipBots: false, // Store bot clicks but mark them
  maxRetries: 3,
};

// =============================================================================
// Aggregation Types
// =============================================================================

/**
 * Aggregation time periods
 */
export type AggregationPeriod = "hourly" | "daily" | "weekly" | "monthly";

/**
 * Configuration for aggregation jobs
 */
export interface AggregationConfig {
  /** Redis connection URL */
  redisUrl: string;

  /** Periods to aggregate */
  periods: AggregationPeriod[];

  /** Batch size for processing links */
  linkBatchSize: number;
}

/**
 * Default aggregation configuration
 */
export const DEFAULT_AGGREGATION_CONFIG: AggregationConfig = {
  redisUrl: "redis://localhost:6379",
  periods: ["daily"],
  linkBatchSize: 1000,
};

/**
 * Result of an aggregation run
 */
export interface AggregationResult {
  period: AggregationPeriod;
  startTime: Date;
  endTime: Date;
  linksProcessed: number;
  clicksAggregated: number;
  duration: number; // ms
  success: boolean;
  error?: string;
}

// =============================================================================
// Database Record Types (for batch inserts)
// =============================================================================

/**
 * Click event record for batch insert
 * Matches the click_events table schema
 */
export interface ClickEventRecord {
  linkId: bigint;
  createdAt: Date;
  ipHash: string | null;
  userAgent: string | null;
  referrer: string | null;
  country: string | null;
  region: string | null;
  bot: boolean;
}

/**
 * Aggregated stat record for upsert
 * Matches the aggregated_stats table schema
 */
export interface AggregatedStatRecord {
  linkId: bigint;
  date: Date;
  clicks: bigint;
  uniqueVisitors: bigint;
}

// =============================================================================
// Queue Names and Job Types
// =============================================================================

/**
 * BullMQ queue names
 */
export const QUEUE_NAMES = {
  /** Main click event processing queue */
  CLICK_EVENTS: "ql:analytics:clicks",

  /** Aggregation job queue */
  AGGREGATION: "ql:analytics:aggregation",
} as const;

/**
 * Job types for the aggregation queue
 */
export type AggregationJobType = "hourly" | "daily" | "weekly" | "monthly" | "backfill";

export interface AggregationJobData {
  type: AggregationJobType;
  /** Start date for aggregation window */
  startDate: string; // ISO string
  /** End date for aggregation window */
  endDate: string; // ISO string
  /** Optional: specific link IDs to aggregate */
  linkIds?: string[];
}

// =============================================================================
// Producer Types
// =============================================================================

/**
 * Input for emitting a click event
 * This is what the redirect service provides
 */
export interface EmitClickEventInput {
  shortCode: string;
  linkId: bigint;
  ipAddress?: string;
  userAgent?: string;
  referrer?: string;
  country?: string;
  region?: string;
}

/**
 * Result of emitting a click event
 */
export interface EmitClickEventResult {
  success: boolean;
  eventId?: string;
  error?: string;
}

// =============================================================================
// Metrics Types
// =============================================================================

/**
 * Analytics pipeline metrics for monitoring
 */
export interface PipelineMetrics {
  /** Events in queue waiting to be processed */
  queueDepth: number;

  /** Events processed in last minute */
  eventsPerMinute: number;

  /** Average processing latency (ms) */
  avgLatency: number;

  /** Error rate (0-1) */
  errorRate: number;

  /** Bot traffic percentage (0-1) */
  botRate: number;
}
