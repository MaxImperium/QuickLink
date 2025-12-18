/**
 * @quicklink/analytics - Analytics Pipeline Package
 *
 * High-throughput click event processing and aggregation.
 *
 * Architecture:
 * ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
 * │  Redirect   │────▶│   BullMQ    │────▶│   Worker    │
 * │  Service    │     │   Queue     │     │  (Batch)    │
 * └─────────────┘     └─────────────┘     └─────────────┘
 *                                                │
 *                           ┌────────────────────┴────────────────────┐
 *                           ▼                                         ▼
 *                    ┌─────────────┐                           ┌─────────────┐
 *                    │click_events │                           │ aggregated_ │
 *                    │  (raw)      │─────Cron Jobs────────────▶│   stats     │
 *                    └─────────────┘                           └─────────────┘
 *
 * Features:
 * - Fire-and-forget event emission (doesn't block redirects)
 * - Bot detection (User-Agent + frequency analysis)
 * - Batch processing (100 events per DB write)
 * - Idempotent aggregation (safe to re-run)
 * - Scheduled jobs (hourly, daily)
 *
 * Usage:
 * ```ts
 * import {
 *   emitClickEvent,        // Producer - emit events
 *   startWorker,           // Worker - process events
 *   startAggregationWorker,// Jobs - aggregate stats
 *   startScheduler,        // Scheduler - periodic jobs
 * } from "@quicklink/analytics";
 * ```
 *
 * @see README.md for detailed documentation
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Event types
  ClickEventPayload,
  EmitClickEventInput,
  EmitClickEventResult,

  // Bot detection
  BotDetectionResult,
  BotDetectionReason,

  // Worker config
  WorkerConfig,

  // Aggregation
  AggregationConfig,
  AggregationPeriod,
  AggregationJobType,
  AggregationJobData,
  AggregationResult,

  // Records
  ClickEventRecord,
  AggregatedStatRecord,

  // Metrics
  PipelineMetrics,
} from "./types.js";

export {
  DEFAULT_WORKER_CONFIG,
  DEFAULT_AGGREGATION_CONFIG,
  QUEUE_NAMES,
} from "./types.js";

// =============================================================================
// Producer (Event Emission)
// =============================================================================

export {
  emitClickEvent,
  emitClickEventsBatch,
  getQueueStats,
  shutdownProducer,
  pauseQueue,
  resumeQueue,
} from "./producer.js";

// =============================================================================
// Worker (Event Processing)
// =============================================================================

export {
  startWorker,
  stopWorker,
  getWorkerMetrics,
  isWorkerHealthy,
} from "./worker.js";

// =============================================================================
// Bot Detection
// =============================================================================

export {
  detectBot,
  isKnownBot,
  getFrequencyStats,
  shutdownBotDetection,
} from "./bot-detection.js";

// =============================================================================
// Aggregation Jobs
// =============================================================================

export {
  // Scheduling
  scheduleAggregation,
  scheduleDailyAggregation,
  scheduleHourlyAggregation,
  scheduleBackfill,

  // Worker
  startAggregationWorker,
  stopAggregationWorker,

  // Scheduler
  startScheduler,
  stopScheduler,

  // Direct execution
  runAggregationDirect,
} from "./jobs.js";
