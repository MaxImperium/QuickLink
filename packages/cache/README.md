# @quicklink/cache

Redis cache abstraction layer for QuickLink.

## Overview

Provides a type-safe, abstracted interface for Redis caching operations. This package is used by both the API and redirect services.

## Design Decisions

1. **Abstraction**: Allows swapping Redis for another cache (e.g., Memcached, in-memory for tests)
2. **Type safety**: Generic methods for type-safe cache operations
3. **Key prefixing**: Automatic namespace prefixing to avoid collisions
4. **Connection pooling**: Singleton pattern for efficient connection reuse

## Usage

```typescript
import { cache } from "@quicklink/cache";

// Set a value with TTL
await cache.set("link:abc123", { url: "https://example.com" }, 3600);

// Get a value
const link = await cache.get<Link>("link:abc123");

// Delete a value
await cache.del("link:abc123");
```

## Structure

```
src/
├── index.ts          # Package exports
├── client.ts         # Redis client singleton
├── cache.ts          # Cache abstraction class
└── types.ts          # TypeScript interfaces
```

## Performance Considerations

- Uses `ioredis` for cluster support and pipelining
- Implements connection health checks
- Supports lazy loading and reconnection
