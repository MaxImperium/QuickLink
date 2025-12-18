# QuickLink Scaling Guide

This document describes the performance optimizations and scaling strategies implemented for high-traffic operation.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Database Scaling](#database-scaling)
3. [Redis & Caching](#redis--caching)
4. [Rate Limiting & Bot Detection](#rate-limiting--bot-detection)
5. [CDN Integration](#cdn-integration)
6. [Monitoring & Metrics](#monitoring--metrics)
7. [Deployment Recommendations](#deployment-recommendations)
8. [Load Testing](#load-testing)

---

## Architecture Overview

QuickLink is designed for horizontal scaling with the following components:

```
                                    ┌─────────────┐
                                    │     CDN     │
                                    │ (Cloudflare)│
                                    └──────┬──────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
              ┌─────▼─────┐          ┌─────▼─────┐          ┌─────▼─────┐
              │  Redirect │          │  Redirect │          │  Redirect │
              │  Service  │          │  Service  │          │  Service  │
              └─────┬─────┘          └─────┬─────┘          └─────┬─────┘
                    │                      │                      │
                    └──────────────────────┼──────────────────────┘
                                           │
              ┌────────────────────────────┼────────────────────────┐
              │                            │                        │
        ┌─────▼─────┐               ┌──────▼──────┐          ┌──────▼──────┐
        │   Redis   │               │  PgBouncer  │          │  Analytics  │
        │  Cluster  │               │   Pooler    │          │   Queue     │
        └───────────┘               └──────┬──────┘          └─────────────┘
                                           │
                              ┌────────────┼────────────┐
                              │            │            │
                        ┌─────▼─────┐ ┌────▼────┐ ┌─────▼─────┐
                        │  Primary  │ │ Replica │ │  Replica  │
                        │    DB     │ │   DB    │ │    DB     │
                        └───────────┘ └─────────┘ └───────────┘
```

### Traffic Flow

1. **Redirect Path (Hot)**: CDN → Redirect Service → Redis → (fallback) DB
2. **API Path (Warm)**: Load Balancer → API Service → PgBouncer → DB
3. **Analytics Path (Cold)**: Redirect Service → BullMQ → Worker → DB

---

## Database Scaling

### Table Partitioning

The `click_events` table uses PostgreSQL native range partitioning by `created_at`:

```sql
-- Monthly partitions for efficient time-range queries
CREATE TABLE click_events_y2024m01 PARTITION OF click_events
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

**Benefits:**
- Partition pruning: Queries with `created_at` filter only scan relevant partitions
- Maintenance: VACUUM/ANALYZE runs per-partition (faster)
- Archival: Old partitions can be detached without impacting active data

**Creating New Partitions:**
```sql
-- Run monthly via cron job
SELECT create_click_events_partition(CURRENT_DATE + INTERVAL '1 month');
```

### Connection Pooling (PgBouncer)

PgBouncer provides connection pooling to handle high connection counts:

```ini
# docker/pgbouncer/pgbouncer.ini
pool_mode = transaction        # Return conn to pool after each transaction
default_pool_size = 25         # Connections per db/user pair
max_client_conn = 1000         # Max client connections
reserve_pool_size = 5          # Extra pool for burst traffic
```

**Connection URLs:**
```bash
# Development (direct)
DATABASE_URL=postgresql://quicklink:quicklink@localhost:5432/quicklink

# Production (pooled via PgBouncer)
DATABASE_POOL_URL=postgresql://quicklink:quicklink@pgbouncer:6432/quicklink
```

### Read Replicas

For read-heavy workloads (analytics dashboards, reports):

```typescript
import { prisma, prismaReplica, withReadReplica } from "@quicklink/db";

// Writes go to primary
await prisma.link.create({ data: {...} });

// Reads can use replica
const stats = await withReadReplica(client =>
  client.clickEvent.count({ where: { linkId } })
);
```

**Environment:**
```bash
DATABASE_URL=postgresql://...@primary:5432/quicklink
DATABASE_REPLICA_URL=postgresql://...@replica:5432/quicklink
```

### Query Optimization

PostgreSQL configuration for high-throughput workloads:

```ini
# docker/postgres/postgresql.conf
shared_buffers = 1GB              # 25% of RAM
effective_cache_size = 3GB        # 75% of RAM
work_mem = 16MB                   # Per-connection sorting
random_page_cost = 1.1            # SSD optimized
enable_partition_pruning = on     # Essential for partitioned tables
```

---

## Redis & Caching

### Cache Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Cache Layers                           │
├─────────────────────────────────────────────────────────────┤
│  L1: CDN Edge Cache      │ TTL: 1h (301), 1m (302)         │
│  L2: Redis Cache         │ TTL: 1h ±8% jitter              │
│  L3: Database            │ Source of truth                  │
└─────────────────────────────────────────────────────────────┘
```

### Key Schema

```
ql:v1:link:{shortCode}     # Link data (JSON, TTL: 1 hour)
ql:v1:404:{shortCode}      # Negative cache marker (TTL: 5 min)
ql:freq:{ipHash}           # Rate limit sorted set (TTL: 2 min)
ql:bloom:badip             # IP reputation bloom filter (bit array)
```

### TTL Jitter

Prevents thundering herd when many keys expire simultaneously:

```typescript
// TTL varies by ±8%
// 3600s → 3312s to 3888s
function applyJitter(baseTtl: number): number {
  const jitter = 1 + (Math.random() * 2 - 1) * 0.08;
  return Math.floor(baseTtl * jitter);
}
```

### Negative Cache

Caches 404 responses to prevent repeated DB lookups for non-existent codes:

```typescript
// On 404, cache for 5 minutes
await redis.setex(`ql:v1:404:${shortCode}`, 300, "1");

// On lookup, check negative cache first
if (await redis.get(`ql:v1:404:${shortCode}`)) {
  return 404; // Skip DB lookup
}
```

### Redis Configuration

Optimized for low-latency caching:

```conf
# docker/redis/redis.conf
maxmemory 1gb
maxmemory-policy volatile-lru   # Evict only keys with TTL
io-threads 4                     # Parallel reads
io-threads-do-reads yes
appendonly yes                   # AOF for BullMQ durability
```

---

## Rate Limiting & Bot Detection

### Distributed Rate Limiting

Redis-based sliding window rate limiting across all instances:

```typescript
import { initializeFrequencyTracker } from "@quicklink/analytics";

const tracker = await initializeFrequencyTracker(redis, {
  windowMs: 60_000,    // 1 minute window
  maxRequests: 30,     // 30 requests max
  keyPrefix: "ql:freq:",
  enableFallback: true // Fall back to local if Redis is down
});

const result = await tracker.check(ipHash);
if (result.isHighFrequency) {
  // Block or flag as bot
}
```

### IP Reputation Bloom Filter

Space-efficient probabilistic filter for known bad IPs:

```typescript
import { initializeBloomFilter, hashIP } from "@quicklink/analytics";

const bloomFilter = initializeBloomFilter(redis, {
  expectedItems: 1_000_000,     // 1M IPs
  falsePositiveRate: 0.01,      // 1% false positive
  redisKey: "ql:bloom:badip"
});

// Check IP reputation
const ipHash = hashIP(clientIP);
if (await bloomFilter.mightContain(ipHash)) {
  // IP is probably bad (may be false positive)
}

// Flag bad IP
await bloomFilter.add(ipHash);
```

**Memory Usage:**
- 1M items at 1% FPR: ~1.2MB
- Compared to hash set: ~50MB

### Bot Detection

Multi-signal bot detection:

1. **User-Agent Pattern Matching**: Known bot patterns (Googlebot, curl, etc.)
2. **Frequency Analysis**: High request rates from single IP
3. **Bloom Filter**: Known abusive IPs
4. **Suspicious Headers**: Missing or malformed headers

```typescript
import { detectBot } from "@quicklink/analytics";

const result = detectBot(userAgent, ipHash);
// { isBot: true, reason: "user_agent_pattern", confidence: 0.95 }
```

---

## CDN Integration

### Response Headers

Optimized headers for CDN caching:

```typescript
// 301 Permanent Redirect
{
  "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=60, stale-if-error=300",
  "Surrogate-Control": "max-age=86400, stale-while-revalidate=3600",
  "Surrogate-Key": "quicklink:link:abc123",
  "Cache-Tag": "quicklink:link:abc123"
}

// 302 Temporary Redirect  
{
  "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=10",
  "Surrogate-Control": "max-age=300, stale-while-revalidate=60"
}

// 404 Not Found
{
  "Cache-Control": "public, max-age=300, s-maxage=300",
  "Surrogate-Control": "max-age=600"
}
```

### Cache Invalidation

Use cache tags for targeted invalidation:

```bash
# Cloudflare
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone}/purge_cache" \
  -H "Authorization: Bearer {token}" \
  -d '{"tags":["quicklink:link:abc123"]}'

# Fastly
curl -X POST "https://api.fastly.com/service/{id}/purge/quicklink:link:abc123" \
  -H "Fastly-Key: {key}"
```

### CDN Configuration Recommendations

**Cloudflare:**
```
Page Rule: *short.link/*
  - Cache Level: Cache Everything
  - Edge Cache TTL: Respect Existing Headers
  - Browser Cache TTL: Respect Existing Headers
```

**Fastly:**
```vcl
sub vcl_fetch {
  if (beresp.http.Surrogate-Control) {
    set beresp.ttl = std.duration(
      regsub(beresp.http.Surrogate-Control, ".*max-age=(\d+).*", "\1") + "s", 
      3600s
    );
  }
}
```

---

## Monitoring & Metrics

### Prometheus Metrics

#### Redirect Service (`/metrics`)

```prometheus
# Redirect counts by status
quicklink_redirect_total{status="301"} 1234567
quicklink_redirect_total{status="302"} 456
quicklink_redirect_total{status="404"} 789
quicklink_redirect_total{status="503"} 0

# Cache performance
quicklink_cache_hit_total 1000000
quicklink_cache_miss_total 234567
quicklink_negative_cache_hit_total 5000
quicklink_cache_hit_rate 0.8107

# Latency histogram (ms)
quicklink_redirect_latency_ms_bucket{le="5"} 900000
quicklink_redirect_latency_ms_bucket{le="10"} 980000
quicklink_redirect_latency_ms_bucket{le="50"} 1234000
quicklink_redirect_latency_ms_sum 4567890.123
quicklink_redirect_latency_ms_count 1234567
```

#### API Service (`/metrics`)

```prometheus
# Database metrics
quicklink_api_db_queries_total 567890
quicklink_api_db_slow_queries_total 123
quicklink_api_db_errors_total 5
quicklink_api_db_avg_query_time_ms 2.45
```

### Key Metrics to Monitor

| Metric | Alert Threshold | Description |
|--------|----------------|-------------|
| Cache hit rate | < 80% | Redis may be down or TTLs too short |
| P99 latency | > 50ms | Performance degradation |
| DB errors | > 0 | Database connectivity issues |
| Redis errors | > 10/min | Redis connectivity issues |
| 503 responses | > 0 | Service unavailability |

### Grafana Dashboard

Import the provided dashboard: `docs/grafana-dashboard.json`

Key panels:
- Request rate by status code
- Cache hit rate over time
- Latency percentiles (p50, p95, p99)
- Database query performance
- Error rate

---

## Deployment Recommendations

### Horizontal Scaling

```yaml
# docker-compose.yml scaling
services:
  redirect:
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '1'
          memory: 512M
```

### Resource Sizing

| Component | Min | Recommended | High Traffic |
|-----------|-----|-------------|--------------|
| Redirect Service | 1 CPU, 256MB | 2 CPU, 512MB | 4 CPU, 1GB |
| API Service | 1 CPU, 512MB | 2 CPU, 1GB | 4 CPU, 2GB |
| Redis | 1 CPU, 512MB | 2 CPU, 1GB | 4 CPU, 2GB |
| PostgreSQL | 2 CPU, 2GB | 4 CPU, 8GB | 8 CPU, 32GB |
| PgBouncer | 0.5 CPU, 128MB | 1 CPU, 256MB | 2 CPU, 512MB |

### Environment Variables

```bash
# Production configuration
NODE_ENV=production

# Database
DATABASE_URL=postgresql://...@primary:5432/quicklink
DATABASE_POOL_URL=postgresql://...@pgbouncer:6432/quicklink
DATABASE_REPLICA_URL=postgresql://...@replica:5432/quicklink
DATABASE_CONNECTION_LIMIT=25

# Redis
REDIS_URL=redis://:password@redis:6379

# Security
IP_HASH_SALT=<random-32-char-string>
JWT_SECRET=<random-64-char-string>

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=60000
```

---

## Load Testing

### Test Scenarios

```bash
# Install k6
brew install k6

# Run load test
k6 run scripts/load-test.js
```

**Sample Test Script:**
```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 100 },   // Ramp up
    { duration: '5m', target: 1000 },  // Sustain
    { duration: '1m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<50'],   // 95% < 50ms
    http_req_failed: ['rate<0.01'],    // <1% errors
  },
};

export default function() {
  const res = http.get('http://localhost:3002/abc123');
  check(res, {
    'is redirect': (r) => r.status === 301 || r.status === 302,
  });
}
```

### Expected Performance

| Metric | Target | With CDN |
|--------|--------|----------|
| Requests/sec | 10,000 | 100,000+ |
| P50 latency | 3ms | <1ms |
| P95 latency | 10ms | <5ms |
| P99 latency | 50ms | <10ms |
| Cache hit rate | 85%+ | 99%+ |

---

## Troubleshooting

### High Latency

1. Check cache hit rate (should be >80%)
2. Check DB query times (`/metrics`)
3. Check Redis connectivity
4. Check for slow queries in PostgreSQL logs

### Memory Issues

1. Check Redis memory usage (`INFO memory`)
2. Check for memory leaks in Node.js (heap dumps)
3. Verify bloom filter size is appropriate

### Connection Exhaustion

1. Check PgBouncer stats (`SHOW STATS`)
2. Check for connection leaks
3. Increase `default_pool_size` if needed

---

## Further Reading

- [PostgreSQL Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [Redis Cluster Tutorial](https://redis.io/docs/management/scaling/)
- [PgBouncer Configuration](https://www.pgbouncer.org/config.html)
- [Cloudflare Cache Rules](https://developers.cloudflare.com/cache/)
