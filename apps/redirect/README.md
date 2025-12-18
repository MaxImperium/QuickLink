# @quicklink/redirect

Ultra-low-latency HTTP redirect service for the QuickLink platform.

---

## ⚡ Performance First

This service has ONE job: **redirect fast**. Every architectural decision optimizes for <50ms latency.

**Target Metrics:**
| Metric | Target | Rationale |
|--------|--------|-----------|
| p50 latency | < 5ms | Cache hit path |
| p99 latency | < 50ms | DB fallback path (hard requirement) |
| Startup time | < 500ms | Fast container scaling |
| Memory | < 50MB | Cheap horizontal scaling |
| Throughput | > 10k req/s | Per instance baseline |
| Cache hit rate | > 95% | Minimize DB load |

---

## 🏗️ Architecture

```
                    ┌─────────────────────────────────────────────────┐
                    │              REDIRECT SERVICE                   │
                    │                                                 │
   GET /:code       │  ┌─────────┐    ┌─────────┐    ┌─────────┐    │
  ─────────────────▶│  │ Handler │───▶│  Cache  │───▶│  Redis  │    │
                    │  └────┬────┘    └────┬────┘    └─────────┘    │
                    │       │              │ miss                    │
                    │       │              ▼                         │
                    │       │         ┌─────────┐    ┌─────────┐    │
                    │       │         │   DB    │───▶│ Postgres│    │
                    │       │         └────┬────┘    └─────────┘    │
                    │       │              │ found                   │
                    │       │              ▼                         │
                    │       │         ┌─────────┐                   │
                    │       │         │  Warm   │ (async)           │
                    │       │         │  Cache  │                   │
                    │       │         └─────────┘                   │
                    │       │                                        │
                    │       ▼ (fire-and-forget)                     │
                    │  ┌─────────────┐                              │
                    │  │  Analytics  │──▶ Redis Queue (BullMQ)      │
                    │  │    Event    │                              │
                    │  └─────────────┘                              │
                    └─────────────────────────────────────────────────┘
```

### Key Optimizations

1. **Versioned Cache Keys**: `ql:v1:link:{code}` enables rolling deploys
2. **TTL Jitter**: ±8% prevents thundering herd on mass expiration
3. **Negative Caching**: `ql:v1:404:{code}` blocks brute-force scanning
4. **CDN-Compatible Headers**: Proper Cache-Control for edge caching
5. **Graceful Degradation**: Redis down → DB, DB down → stale cache → 503

---

## 🔴 Strict Constraints

These constraints are **non-negotiable** for latency reasons:

| ❌ NOT Allowed | ✅ Instead Use | Why |
|----------------|----------------|-----|
| Prisma / ORM | Raw SQL (`pg`) | ORMs add ~5-15ms overhead |
| Zod / Joi | Manual checks | Validation libs add ~1-3ms |
| Body parsing | None needed | Redirects have no body |
| Auth middleware | None | Auth handled elsewhere |
| Heavy logging | Sampling only | I/O blocks event loop |
| Express.js | Hono | Express adds ~2-5ms overhead |

---

## 🔄 Redirect Flow (Pseudocode)

```typescript
async function handleRedirect(shortCode: string): Promise<Response> {
  const start = performance.now();
  
  // 1. VALIDATE (fast rejection) - ~0.01ms
  if (!isValidShortCode(shortCode)) return notFound();
  
  // 2. NEGATIVE CACHE CHECK (known 404s) - ~0.5-2ms
  if (await cache.isNotFound(shortCode)) return notFound();
  
  // 3. CACHE LOOKUP (Redis) - ~0.5-2ms
  let link = await cache.get(shortCode);
  
  // 4. DB FALLBACK - Only on cache miss - ~10-30ms
  if (!link) {
    link = await db.lookup(shortCode);
    
    if (link) {
      // WARM CACHE - Async, don't await
      cache.set(shortCode, link).catch(ignoreError);
    } else {
      // CACHE 404 - Prevent repeated DB lookups
      cache.setNotFound(shortCode).catch(ignoreError);
    }
  }
  
  // 5. NOT FOUND
  if (!link) return notFound();
  
  // 6. EMIT ANALYTICS - Fire-and-forget, never await
  analytics.emitClickEvent({ code: shortCode, ts: Date.now() });
  
  // 7. RECORD LATENCY
  metrics.recordRedirect(link.permanent ? 301 : 302, cacheHit, latency);
  
  // 8. REDIRECT (301 permanent, 302 temporary)
  return redirect(link.url, link.permanent ? 301 : 302);
}
}
```

---

## 📦 Why Redis First?

| Aspect | Redis | PostgreSQL |
|--------|-------|------------|
| Latency | 0.5-2ms | 5-20ms |
| Throughput | 100k+ ops/s | 10k ops/s |
| Connection cost | Multiplexed | Pool overhead |
| Memory | In-RAM | Disk I/O |

**Strategy:** Redis is the **primary** data source for redirects. PostgreSQL is the **source of truth** but only accessed on cache miss.

---

## ⏱️ TTL Strategy

```typescript
const TTL_CONFIG = {
  // Active links: 1 hour
  // Balances freshness vs cache hit rate
  DEFAULT_TTL: 3600,
  
  // Popular links: 24 hours
  // Detected by hit count, reduces DB load
  HOT_TTL: 86400,
  
  // Negative cache: 5 minutes
  // Prevents repeated DB lookups for 404s
  NOT_FOUND_TTL: 300,
};
```

**Trade-offs:**
- Higher TTL = Better latency, stale data risk
- Lower TTL = Fresher data, more DB hits
- Negative caching = Prevents DB hammering on attacks

---

## 🛡️ Graceful Degradation

| Failure | Behavior | User Impact |
|---------|----------|-------------|
| Redis down | Fallback to DB only | +10-15ms latency |
| DB down | Serve from cache only | Stale data possible |
| Both down | Return 503 | Service unavailable |
| Slow Redis | Timeout after 50ms, use DB | Predictable latency |
| Slow DB | Timeout after 100ms, return 503 | Fail fast |

```typescript
// Timeout wrapper for predictable latency
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  const timeout = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), ms)
  );
  return Promise.race([promise, timeout]).catch(() => fallback);
}
```

---

## 📁 File Structure

```
src/
├── server.ts       # HTTP server bootstrap (Hono)
├── handler.ts      # Redirect request handler
├── cache.ts        # Redis client & operations
├── db.ts           # Raw SQL queries (pg)
├── types.ts        # TypeScript interfaces
├── metrics.ts      # Latency/counter instrumentation
├── config.ts       # Environment configuration
└── index.ts        # Entry point
```

---

## 🚀 Why Hono?

Framework comparison for redirect workload:

| Framework | Avg Latency | Memory | Startup |
|-----------|-------------|--------|---------|
| **Hono** | ~0.3ms | ~12MB | ~100ms |
| Fastify | ~0.8ms | ~25MB | ~200ms |
| Express | ~1.5ms | ~30MB | ~150ms |
| Native HTTP | ~0.2ms | ~10MB | ~50ms |

**Choice: Hono**
- Near-native performance
- Built-in TypeScript
- Tiny bundle (~14KB)
- Simple routing (we only need 2 routes)
- Easy to swap for native HTTP later if needed

---

## 🔧 Configuration

```bash
# Required
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://user:pass@localhost:5432/quicklink

# Optional (with defaults)
PORT=3002
HOST=0.0.0.0
REDIS_TIMEOUT_MS=50
DB_TIMEOUT_MS=100
CACHE_TTL_SECONDS=3600
LOG_LEVEL=warn  # Minimal logging in prod
```

---

## 🩺 Health Checks

```
GET /health         → 200 { status: "ok" }           # Liveness (no deps)
GET /health/ready   → 200 { redis: "ok", db: "ok" }  # Readiness (with deps)
```

**Liveness** has zero dependencies - if the process responds, it's alive.
**Readiness** checks actual connectivity - for load balancer decisions.

---

## 📊 Metrics (Prometheus-Compatible)

```
# Counters
redirect_total{status="301|302|404|503"}
cache_hit_total
cache_miss_total
db_fallback_total
db_error_total

# Histograms
redirect_latency_seconds{quantile="0.5|0.9|0.99"}
cache_latency_seconds
db_latency_seconds
```

---

## 🚫 What This Service Does NOT Do

| Feature | Why Not | Where Instead |
|---------|---------|---------------|
| Create links | Different scaling profile | API service |
| Validate URLs | Done at creation time | API service |
| Authenticate | No user context needed | API service |
| Rate limit | CDN/LB handles this | Infrastructure |
| Parse JSON | No request body | N/A |
| Aggregate stats | Async background job | Analytics worker |

---

## 🏃 Development

```bash
# Install dependencies
pnpm install

# Start with hot reload
pnpm dev

# Build for production
pnpm build

# Run production build
pnpm start

# Run benchmarks
pnpm bench
```

---

## 🐳 Deployment Notes

- **Stateless**: No local state, scale horizontally
- **Small image**: Use `node:20-alpine` (~50MB)
- **Health probes**: Use `/health` for liveness
- **Resource limits**: 128MB RAM, 0.25 CPU is enough
- **Replicas**: Start with 3, autoscale on latency p99
