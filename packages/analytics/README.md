# @quicklink/analytics

High-throughput analytics pipeline for QuickLink URL shortener.

## Overview

Handles click event ingestion, processing, and aggregation using a queue-based architecture for reliable, async processing at scale.

**Design Goals:**
- Fire-and-forget event emission (never block redirects)
- Handle millions of clicks per day
- Bot detection and filtering
- Idempotent aggregation (safe to re-run)

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Redirect   │────▶│   BullMQ    │────▶│   Worker    │
│  Service    │     │   Queue     │     │  (Batch)    │
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                          ┌────────────────────┴────────────────────┐
                          ▼                                         ▼
                   ┌─────────────┐                           ┌─────────────┐
                   │click_events │                           │ aggregated_ │
                   │  (raw)      │─────Cron Jobs────────────▶│   stats     │
                   └─────────────┘                           └─────────────┘
```

## Components

| Component | File | Description |
|-----------|------|-------------|
| Producer | `producer.ts` | Emits click events to queue |
| Worker | `worker.ts` | Consumes events, batch inserts to DB |
| Jobs | `jobs.ts` | Aggregation jobs (hourly, daily) |
| Bot Detection | `bot-detection.ts` | Identifies bot traffic |
| Types | `types.ts` | TypeScript interfaces |

## Quick Start

### 1. Emit Events (Redirect Service)

```typescript
import { emitClickEvent } from "@quicklink/analytics";

// In redirect handler (fire-and-forget)
app.get("/:code", async (req, res) => {
  const link = await getLink(req.params.code);
  
  // Fire-and-forget - don't await
  emitClickEvent({
    shortCode: req.params.code,
    linkId: link.id,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    referrer: req.headers.referer,
  });
  
  res.redirect(301, link.targetUrl);
});
```

### 2. Start Worker (Background Service)

```typescript
import { startWorker, stopWorker } from "@quicklink/analytics";

// Start processing events
const worker = await startWorker({
  redisUrl: process.env.REDIS_URL,
  batchSize: 100,        // Events per DB write
  batchTimeout: 5000,    // Max ms before flush
  concurrency: 10,       // Parallel job processors
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await stopWorker();
});
```

### 3. Start Aggregation (Cron Service)

```typescript
import {
  startAggregationWorker,
  startScheduler,
  stopAggregationWorker,
  stopScheduler,
} from "@quicklink/analytics";

// Start aggregation worker
await startAggregationWorker({
  redisUrl: process.env.REDIS_URL,
});

// Start scheduler (runs hourly/daily aggregation)
startScheduler({ redisUrl: process.env.REDIS_URL });

// Graceful shutdown
process.on("SIGTERM", async () => {
  stopScheduler();
  await stopAggregationWorker();
});
```

## Configuration

### Worker Config

| Option | Default | Description |
|--------|---------|-------------|
| `redisUrl` | `redis://localhost:6379` | Redis connection URL |
| `batchSize` | `100` | Events per DB batch insert |
| `batchTimeout` | `5000` | Max ms before flushing batch |
| `concurrency` | `10` | Parallel job processors |
| `skipBots` | `false` | Skip DB writes for bot traffic |
| `maxRetries` | `3` | Retry attempts for failed jobs |

### Environment Variables

```bash
# Redis connection
REDIS_URL=redis://localhost:6379

# Optional: Separate Redis for analytics
ANALYTICS_REDIS_URL=redis://localhost:6380
```

## Bot Detection

Identifies bot traffic using:

1. **User-Agent patterns** - Known crawlers, SEO tools, HTTP libraries
2. **Request frequency** - >30 requests/minute from same IP
3. **Missing headers** - No User-Agent header

```typescript
import { detectBot, isKnownBot } from "@quicklink/analytics";

// Full detection (with frequency tracking)
const result = detectBot(userAgent, ipHash);
// { isBot: true, reason: "user_agent_pattern", confidence: 0.95 }

// Quick check (pattern only)
const isBot = isKnownBot(userAgent);
// true/false
```

## Aggregation Jobs

### Scheduled Aggregation

The scheduler runs automatically:
- **Hourly**: 5 minutes past each hour
- **Daily**: 00:30 UTC

### Manual Aggregation

```typescript
import {
  scheduleDailyAggregation,
  scheduleHourlyAggregation,
  scheduleBackfill,
  runAggregationDirect,
} from "@quicklink/analytics";

// Schedule yesterday's aggregation
await scheduleDailyAggregation();

// Schedule last hour's aggregation
await scheduleHourlyAggregation();

// Backfill a date range (one job per day)
await scheduleBackfill(
  new Date("2024-01-01"),
  new Date("2024-01-31")
);

// Run directly (synchronous, for testing)
const result = await runAggregationDirect(
  "daily",
  new Date("2024-01-15"),
  new Date("2024-01-15")
);
```

## Monitoring

### Queue Stats

```typescript
import { getQueueStats, getWorkerMetrics } from "@quicklink/analytics";

const queueStats = await getQueueStats();
// { waiting: 150, active: 10, completed: 50000, failed: 5 }

const workerMetrics = getWorkerMetrics();
// { isRunning: true, batch: { pending: 45, totalFlushed: 12000 } }
```

### Health Check

```typescript
import { isWorkerHealthy } from "@quicklink/analytics";

if (!isWorkerHealthy()) {
  // Alert: Worker is down
}
```

## Integration with Redirect Service

Add this to your redirect handler (`apps/redirect/src/handler.ts`):

```typescript
import { emitClickEvent } from "@quicklink/analytics";
import { createHash } from "node:crypto";

export async function handleRedirect(c: Context) {
  const code = c.req.param("code");
  const link = await getLink(code);
  
  if (!link) {
    return c.notFound();
  }
  
  // Emit click event (fire-and-forget)
  emitClickEvent({
    shortCode: code,
    linkId: link.id,
    ipAddress: c.req.header("x-forwarded-for") || c.req.raw.socket.remoteAddress,
    userAgent: c.req.header("user-agent"),
    referrer: c.req.header("referer"),
  }).catch(() => {
    // Silently ignore - redirect takes priority
  });
  
  return c.redirect(link.targetUrl, 301);
}
```

## Performance Tuning

### High Volume (>1M clicks/day)

```typescript
await startWorker({
  batchSize: 500,      // Larger batches
  batchTimeout: 2000,  // Faster flush
  concurrency: 50,     // More parallelism
  skipBots: true,      // Skip bot DB writes
});
```

### Low Latency Requirements

```typescript
await startWorker({
  batchSize: 50,       // Smaller batches
  batchTimeout: 1000,  // Very fast flush
  concurrency: 20,
});
```

### Memory Constraints

```typescript
await startWorker({
  batchSize: 100,
  batchTimeout: 10000, // Longer timeout OK
  concurrency: 5,      // Less parallelism
});
```

## Database Schema

The analytics pipeline uses these tables:

```sql
-- Raw click events
CREATE TABLE click_events (
  id BIGSERIAL PRIMARY KEY,
  link_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ip_hash VARCHAR(16),
  user_agent VARCHAR(512),
  referrer VARCHAR(2048),
  country VARCHAR(2),
  region VARCHAR(64),
  bot BOOLEAN DEFAULT false
);

-- Aggregated statistics
CREATE TABLE aggregated_stats (
  id BIGSERIAL PRIMARY KEY,
  link_id BIGINT NOT NULL,
  date DATE NOT NULL,
  clicks BIGINT DEFAULT 0,
  unique_visitors BIGINT DEFAULT 0,
  UNIQUE(link_id, date)
);
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Redis unavailable | Events dropped (redirect continues) |
| DB batch fails | Fallback to individual inserts |
| Worker crash | Events remain in queue for retry |
| Aggregation fails | Job retried 3x with exponential backoff |

## Files

```
packages/analytics/
├── src/
│   ├── index.ts          # Package exports
│   ├── types.ts          # TypeScript interfaces
│   ├── producer.ts       # Event emission
│   ├── worker.ts         # Event processing
│   ├── jobs.ts           # Aggregation jobs
│   └── bot-detection.ts  # Bot identification
├── package.json
└── README.md
```

```
src/
├── index.ts          # Package exports
├── producer.ts       # Event emission
├── consumer.ts       # Event processing worker
├── aggregator.ts     # Stats aggregation
├── events/           # Event type definitions
└── workers/          # Queue worker implementations
```
