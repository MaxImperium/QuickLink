# @quicklink/analytics

Analytics event processing and aggregation for QuickLink.

## Overview

Handles click event ingestion, processing, and aggregation. Uses a queue-based architecture for reliable, async processing.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Redirect   │────▶│    Queue    │────▶│   Worker    │
│   Service   │     │  (BullMQ)   │     │  (Process)  │
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │  Database   │
                                        │ (Postgres)  │
                                        └─────────────┘
```

## Design Decisions

1. **Async processing**: Redirect service fires events to queue, doesn't wait
2. **Batching**: Events are batched for efficient database writes
3. **Idempotency**: Events include unique IDs to prevent duplicates
4. **Queue abstraction**: Can swap BullMQ for SQS/RabbitMQ in production

## Components

- **Producer**: Emits click events (used by redirect service)
- **Consumer**: Processes events from queue
- **Aggregator**: Pre-computes stats (hourly, daily, weekly)

## Usage

```typescript
import { emitClickEvent, ClickEvent } from "@quicklink/analytics";

// Fire-and-forget click tracking
await emitClickEvent({
  linkId: "link_123",
  timestamp: new Date(),
  metadata: { userAgent: "...", ip: "..." },
});
```

## Structure

```
src/
├── index.ts          # Package exports
├── producer.ts       # Event emission
├── consumer.ts       # Event processing worker
├── aggregator.ts     # Stats aggregation
├── events/           # Event type definitions
└── workers/          # Queue worker implementations
```
