# @quicklink/logger

Structured logging for QuickLink services.

## Overview

Provides a consistent, structured logging interface across all services using Pino.

## Features

- **Structured JSON logs**: Machine-readable in production
- **Pretty printing**: Human-readable in development
- **Context propagation**: Request IDs, user IDs, etc.
- **Log levels**: trace, debug, info, warn, error, fatal
- **Child loggers**: Scoped loggers with inherited context

## Usage

```typescript
import { logger, createLogger } from "@quicklink/logger";

// Basic usage
logger.info("Server started", { port: 3000 });

// With context
logger.info({ linkId: "abc123", action: "redirect" }, "Link redirected");

// Error logging
logger.error({ err, linkId: "abc123" }, "Failed to redirect");

// Child logger for specific context
const requestLogger = logger.child({ requestId: "req_123" });
requestLogger.info("Processing request");
```

## Configuration

```typescript
import { createLogger } from "@quicklink/logger";

const logger = createLogger({
  name: "api",
  level: process.env.LOG_LEVEL || "info",
  pretty: process.env.NODE_ENV !== "production",
});
```

## Structure

```
src/
├── index.ts          # Package exports
├── logger.ts         # Logger factory
└── types.ts          # TypeScript interfaces
```

## Production Considerations

- In production, use JSON format for log aggregation (ELK, Datadog, etc.)
- Use log levels appropriately (no debug in production)
- Include correlation IDs for distributed tracing
