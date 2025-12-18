# Redis Cache Design for QuickLink Redirect Service

> **Document Status:** Production-ready  
> **Last Updated:** 2024-12-18  
> **Owner:** Backend Team

---

## Quick Reference

```typescript
// Key Patterns
const LINK_KEY    = "ql:v1:link:{code}";   // Active links
const NOTFOUND_KEY = "ql:v1:404:{code}";   // Negative cache

// TTL Values (seconds)
const LINK_TTL     = 3600;   // 1 hour
const NOTFOUND_TTL = 300;    // 5 minutes
const JITTER_PCT   = 0.08;   // ±8% jitter

// Timeouts (milliseconds)
const REDIS_TIMEOUT = 50;    // Fast fail to DB
const DB_TIMEOUT    = 100;   // Query deadline

// Value Format
interface CachedLink {
  u: string;    // Original URL
  p: boolean;   // Permanent (301) or temporary (302)
  t: number;    // Cached timestamp (unix)
}
```

---

## Overview

This document defines the Redis key schema, TTL strategy, and operational behaviors for the redirect service cache layer.

**Design Goals:**
- Sub-millisecond lookups (p99 < 1ms)
- Prevent cache stampede on popular links
- Scale to 100M+ keys
- Safe schema migrations
- Multi-region friendly

---

## 1️⃣ Key Naming Convention

### Schema Format

```
{prefix}:{version}:{type}:{identifier}
```

| Component | Description | Example |
|-----------|-------------|---------|
| `prefix` | Service namespace | `ql` (QuickLink) |
| `version` | Schema version | `v1` |
| `type` | Data type | `link`, `404`, `meta` |
| `identifier` | Unique key | short code |

### Key Types

#### 1.1 Active Links (Primary)

```
ql:v1:link:{shortCode}
```

**Examples:**
```
ql:v1:link:abc123
ql:v1:link:XyZ789
```

**Value Format (JSON string):**
```json
{
  "u": "https://example.com/very/long/destination/url",
  "p": true,
  "t": 1702900000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `u` | string | Original URL (destination) |
| `p` | boolean | Permanent redirect (301) if true, else 302 |
| `t` | number | Unix timestamp when cached |

**Why short field names?**
- Redis stores strings - shorter = less memory
- At 100M keys, `url` vs `u` saves ~300MB RAM
- JSON parse time is negligible

---

#### 1.2 Negative Cache (404s)

```
ql:v1:404:{shortCode}
```

**Examples:**
```
ql:v1:404:notexist
ql:v1:404:expired123
```

**Value:** `"1"` (minimal, just existence matters)

**Purpose:**
- Prevent repeated DB lookups for non-existent codes
- Protect against enumeration attacks
- Short TTL to allow recovery

---

#### 1.3 Link Metadata (Optional)

```
ql:v1:meta:{shortCode}
```

**Value Format:**
```json
{
  "c": 15234,
  "e": 1703000000,
  "s": "active"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `c` | number | Click count (approximate) |
| `e` | number | Expiration timestamp (if set) |
| `s` | string | Status: `active`, `disabled`, `expired` |

**Note:** Metadata is NOT on the hot path. Only fetched for admin/analytics.

---

#### 1.4 Hot Keys Tracking (Future)

```
ql:v1:hot:{shortCode}
```

**Purpose:** Track access frequency for:
- Extending TTL on popular links
- Pre-warming caches
- Identifying abuse patterns

---

### Version Migration Strategy

| Version | Change | Migration Path |
|---------|--------|----------------|
| `v1` | Initial schema | N/A |
| `v2` | Add field X | Dual-write, read both, backfill |
| `v3` | Change value format | Shadow write, gradual cutover |

**Migration Rules:**
1. Always read from old + new version during transition
2. Write to new version only
3. Set TTL on old keys to expire naturally
4. Never delete old keys manually (let TTL handle it)

```
# During v1 → v2 migration, read order:
1. Try ql:v2:link:{code}
2. Fallback to ql:v1:link:{code}
3. Fallback to DB
```

---

## 2️⃣ TTL Strategy

### TTL Values

| Key Type | Default TTL | Rationale |
|----------|-------------|-----------|
| `link:*` | **1 hour** (3600s) | Balance freshness vs hit rate |
| `404:*` | **5 minutes** (300s) | Short enough to recover from errors |
| `meta:*` | **15 minutes** (900s) | Non-critical, can be stale |
| `hot:*` | **1 hour** (3600s) | Track recent popularity |

### TTL Decision Matrix

```
                    ┌─────────────────────────────────────┐
                    │           Update Frequency          │
                    ├──────────┬──────────┬──────────────┤
                    │   Rare   │ Moderate │   Frequent   │
┌───────────────────┼──────────┼──────────┼──────────────┤
│ High Traffic      │ 24h TTL  │  1h TTL  │  15m TTL     │
│ (>1000 req/min)   │          │          │              │
├───────────────────┼──────────┼──────────┼──────────────┤
│ Medium Traffic    │  6h TTL  │  1h TTL  │  30m TTL     │
│ (100-1000/min)    │          │          │              │
├───────────────────┼──────────┼──────────┼──────────────┤
│ Low Traffic       │  1h TTL  │ 30m TTL  │  15m TTL     │
│ (<100 req/min)    │          │          │              │
└───────────────────┴──────────┴──────────┴──────────────┘
```

**Default: 1 hour** covers most use cases. Dynamic TTL is a future optimization.

---

### Jitter Strategy (Prevent Stampede)

**Problem:** If 1000 keys all expire at the same second, 1000 DB queries hit simultaneously.

**Solution:** Add random jitter to TTL

```
effectiveTTL = baseTTL + random(0, jitterRange)
```

| Base TTL | Jitter Range | Effective TTL |
|----------|--------------|---------------|
| 3600s | ±300s (5min) | 3300s - 3900s |
| 300s | ±30s | 270s - 330s |
| 900s | ±60s | 840s - 960s |

**Implementation:**
```typescript
function getTTL(baseTTL: number): number {
  const jitter = Math.floor(baseTTL * 0.08); // 8% jitter
  return baseTTL + Math.floor(Math.random() * jitter * 2) - jitter;
}
```

---

### Early Refresh Strategy

**Problem:** Cache expires → first request hits DB → slow response

**Solution:** Probabilistic early refresh

```
┌─────────────────────────────────────────────────────────┐
│                         TTL Timeline                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  0%              80%                   100%             │
│  ├────────────────┼─────────────────────┤               │
│  │    Normal      │   Early Refresh     │  Expired     │
│  │    Serve       │   Zone (20%)        │              │
│  │                │                     │              │
│  └────────────────┴─────────────────────┘               │
│                                                          │
│  In Early Refresh Zone:                                  │
│  - 5% chance to trigger background refresh              │
│  - Serve stale data immediately                         │
│  - Refresh happens async                                │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Pseudocode:**
```typescript
async function getWithEarlyRefresh(key: string): Promise<CachedLink | null> {
  const data = await redis.get(key);
  if (!data) return null;
  
  const ttl = await redis.ttl(key);
  const baseTTL = 3600;
  
  // If in last 20% of TTL
  if (ttl < baseTTL * 0.2) {
    // 5% chance to refresh
    if (Math.random() < 0.05) {
      refreshInBackground(key); // Don't await
    }
  }
  
  return JSON.parse(data);
}
```

---

### Cache Eviction Policy

**Recommended:** `volatile-lru`

| Policy | Behavior | Use Case |
|--------|----------|----------|
| `volatile-lru` | Evict LRU keys **with TTL** | ✅ Our use case |
| `allkeys-lru` | Evict any LRU key | Risk: evict system keys |
| `volatile-ttl` | Evict keys closest to expiry | Good for time-sensitive |
| `noeviction` | Return error when full | Not acceptable |

**Memory Configuration:**
```redis
maxmemory 4gb
maxmemory-policy volatile-lru
maxmemory-samples 10
```

---

## 3️⃣ Cache Warm-Up Flows

### 3.1 On Link Creation (Write-Through)

```
┌─────────┐    POST /links    ┌─────────┐
│   Web   │─────────────────▶│   API   │
└─────────┘                   └────┬────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
              ┌─────────┐   ┌─────────┐   ┌─────────┐
              │   DB    │   │  Redis  │   │  Queue  │
              │ (write) │   │ (warm)  │   │ (event) │
              └─────────┘   └─────────┘   └─────────┘
```

**Sequence:**
1. API validates and writes to PostgreSQL
2. API writes to Redis (fire-and-forget, don't block response)
3. API returns success to client

**Key Point:** Write to Redis is best-effort. If it fails, redirect will warm cache on first access.

---

### 3.2 On Redirect (Cache-Aside with Write-Behind)

```
┌─────────┐    GET /:code     ┌──────────┐
│ Client  │──────────────────▶│ Redirect │
└─────────┘                   └────┬─────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
                    ▼                             │
              ┌─────────┐                         │
              │  Redis  │──── HIT ───────────────▶│ Return 301
              └────┬────┘                         │
                   │                              │
                  MISS                            │
                   │                              │
                   ▼                              │
              ┌─────────┐                         │
              │   DB    │──── Found ─────────────▶│ Return 301
              └────┬────┘              │          │
                   │                   │          │
              Not Found           ┌────▼────┐     │
                   │              │  Warm   │     │
                   ▼              │  Cache  │     │
              ┌─────────┐         │ (async) │     │
              │  404    │         └─────────┘     │
              │ Cache   │                         │
              └─────────┘                         │
```

**Cache Miss Flow:**
1. Query DB
2. If found: return redirect + warm cache (async, don't await)
3. If not found: return 404 + cache negative result

---

### 3.3 On Link Disable/Update (Cache Invalidation)

```
┌─────────┐  PUT /links/:id   ┌─────────┐
│   Web   │──────────────────▶│   API   │
└─────────┘  (disable link)   └────┬────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
              ┌─────────┐   ┌─────────┐   ┌─────────┐
              │   DB    │   │  Redis  │   │  Queue  │
              │(update) │   │ (DEL)   │   │(publish)│
              └─────────┘   └─────────┘   └─────────┘
                                               │
                                               ▼
                                    ┌─────────────────┐
                                    │ Other Regions   │
                                    │ (invalidate)    │
                                    └─────────────────┘
```

**Invalidation Strategy:**

| Action | Cache Operation |
|--------|-----------------|
| Disable link | `DEL ql:v1:link:{code}` + `SET ql:v1:404:{code}` |
| Update URL | `DEL ql:v1:link:{code}` (will re-warm on next access) |
| Delete link | `DEL ql:v1:link:{code}` + `SET ql:v1:404:{code}` |
| Re-enable link | `DEL ql:v1:404:{code}` (link will warm on access) |

**Why DEL instead of UPDATE?**
- Simpler logic
- Avoids race conditions
- Let natural re-warm handle it

---

## 4️⃣ Failure Scenarios

### 4.1 Redis Completely Down

```
┌────────────────────────────────────────────────────────┐
│                    REDIS DOWN                          │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Request ──▶ Redis (timeout 50ms) ──▶ FAIL            │
│                     │                                  │
│                     ▼                                  │
│              DB Fallback (every request)              │
│                     │                                  │
│                     ▼                                  │
│              Return redirect (slower)                  │
│                                                        │
│  Impact:                                               │
│  • Latency: 5-20ms → 15-50ms                          │
│  • DB load: 100x increase                             │
│  • Throughput: Reduced to DB capacity                 │
│                                                        │
│  Mitigation:                                           │
│  • Connection pooling on DB                           │
│  • Circuit breaker on Redis (skip timeout)            │
│  • Alert on Redis health check failure                │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Circuit Breaker Pattern:**
```
Redis failures > 5 in 10 seconds
  → Open circuit for 30 seconds
  → Skip Redis entirely, go direct to DB
  → Retry Redis after 30 seconds
```

---

### 4.2 Redis Memory Eviction

```
┌────────────────────────────────────────────────────────┐
│                 MEMORY PRESSURE                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Memory > maxmemory                                    │
│           │                                            │
│           ▼                                            │
│  LRU eviction kicks in                                │
│           │                                            │
│           ▼                                            │
│  Least-recently-used keys removed                     │
│           │                                            │
│           ▼                                            │
│  Next access → cache miss → DB fallback → re-warm    │
│                                                        │
│  This is EXPECTED behavior, not a failure.            │
│                                                        │
│  Monitoring:                                           │
│  • Alert when evicted_keys > 1000/min                 │
│  • Track cache hit rate (should be >95%)              │
│  • Consider increasing maxmemory                      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

### 4.3 Partial Cache Warm Failure

```
┌────────────────────────────────────────────────────────┐
│              PARTIAL WARM FAILURE                      │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Scenario: DB returns data, but Redis SET fails       │
│                                                        │
│  Request ──▶ Redis MISS ──▶ DB HIT ──▶ Redis SET ✗   │
│                                              │         │
│                                              ▼         │
│                                    Return redirect     │
│                                    (user unaffected)   │
│                                                        │
│  Next request:                                         │
│  • Same flow repeats                                  │
│  • Eventually Redis recovers                          │
│  • Cache warms naturally                              │
│                                                        │
│  Why this is OK:                                       │
│  • Fire-and-forget design                             │
│  • User always gets response                          │
│  • Just slightly higher latency until warm           │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

### 4.4 Hot Key Problem

```
┌────────────────────────────────────────────────────────┐
│                    HOT KEY                             │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Scenario: Viral link gets 100k req/sec               │
│                                                        │
│  Problem:                                              │
│  • Single Redis key = single shard                    │
│  • One shard handles all traffic                      │
│  • Network/CPU bottleneck                             │
│                                                        │
│  Solutions (in order of complexity):                   │
│                                                        │
│  1. Local Cache (in-process)                          │
│     ┌─────────┐     ┌─────────┐     ┌─────────┐      │
│     │  LRU    │ ──▶ │  Redis  │ ──▶ │   DB    │      │
│     │ Cache   │     │         │     │         │      │
│     │ (100ms) │     │         │     │         │      │
│     └─────────┘     └─────────┘     └─────────┘      │
│                                                        │
│  2. Read Replicas                                     │
│     Spread reads across multiple replicas             │
│                                                        │
│  3. Key Replication                                   │
│     ql:v1:link:viral123:0                            │
│     ql:v1:link:viral123:1                            │
│     ql:v1:link:viral123:2                            │
│     (client picks random suffix)                      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Recommended: Local Cache**

```typescript
// In-process LRU cache for hot keys
const localCache = new LRUCache({
  max: 1000,           // Max 1000 entries
  ttl: 100,            // 100ms TTL (very short)
});

async function lookup(code: string): Promise<string | null> {
  // 1. Check local cache
  const local = localCache.get(code);
  if (local) return local;
  
  // 2. Check Redis
  const cached = await redis.get(key);
  if (cached) {
    localCache.set(code, cached); // Warm local
    return cached;
  }
  
  // 3. DB fallback...
}
```

---

## 5️⃣ Failure Matrix

| Component | Failure Mode | Detection | Behavior | User Impact | Recovery |
|-----------|--------------|-----------|----------|-------------|----------|
| **Redis** | Connection refused | Timeout (50ms) | Fallback to DB | +10-15ms latency | Auto-reconnect |
| **Redis** | Timeout (slow) | Deadline exceeded | Fallback to DB | +10-15ms latency | Next request retries |
| **Redis** | Memory full | Eviction metrics | LRU eviction | Slight cache miss increase | Add memory or scale |
| **Redis** | Cluster failover | Sentinel/Cluster | Brief errors, then redirect | <1s interruption | Automatic |
| **DB** | Connection refused | Pool exhausted | Return 503 | Service unavailable | Alert, investigate |
| **DB** | Timeout (slow) | Query timeout | Return 503 | Service unavailable | Query optimization |
| **DB** | Wrong data | N/A (data issue) | Wrong redirect | User confusion | Manual fix + invalidate |
| **Network** | Redis partition | Timeout | Fallback to DB | +10-15ms latency | Network recovery |
| **Network** | DB partition | Timeout | Serve stale cache | Stale data risk | Network recovery |
| **Hot Key** | Single key overload | Latency spike | Local cache absorbs | None if mitigated | Automatic |
| **Stampede** | Mass expiration | DB load spike | Jitter prevents | None if mitigated | Automatic |

---

## 6️⃣ Multi-Region Considerations

### Cache Topology

```
                    ┌─────────────────────┐
                    │   Primary Region    │
                    │   (US-East)         │
                    ├─────────────────────┤
                    │  PostgreSQL (RW)    │
                    │  Redis Cluster      │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │  EU Region      │ │  APAC Region    │ │  US-West        │
    ├─────────────────┤ ├─────────────────┤ ├─────────────────┤
    │ Postgres (RO)   │ │ Postgres (RO)   │ │ Postgres (RO)   │
    │ Redis (local)   │ │ Redis (local)   │ │ Redis (local)   │
    └─────────────────┘ └─────────────────┘ └─────────────────┘
```

### Cross-Region Invalidation

**Option A: Pub/Sub Invalidation**
```
API (write) ──▶ Publish to channel ──▶ All regions subscribe
                     │
                     ▼
           ┌─────────────────────────────┐
           │ Channel: ql:invalidate      │
           │ Message: {"code": "abc123"} │
           └─────────────────────────────┘
```

**Option B: Short TTL (Simpler)**
- Use 5-minute TTL in all regions
- Accept brief inconsistency window
- No cross-region messaging needed

**Recommendation:** Start with Option B (short TTL). Add pub/sub only if consistency requirements demand it.

---

## 7️⃣ Monitoring & Alerts

### Key Metrics

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Cache hit rate | < 90% | < 80% | Check TTL, memory |
| Redis latency p99 | > 5ms | > 20ms | Check network, cluster |
| Redis memory usage | > 70% | > 85% | Scale or increase maxmemory |
| Evicted keys/min | > 100 | > 1000 | Add memory |
| DB fallback rate | > 10% | > 25% | Check Redis health |
| 404 cache size | > 1M keys | > 5M keys | Possible attack, investigate |

### Prometheus Queries

```promql
# Cache hit rate
sum(rate(quicklink_cache_hit_total[5m])) / 
sum(rate(quicklink_cache_hit_total[5m]) + rate(quicklink_cache_miss_total[5m]))

# Redis latency p99
histogram_quantile(0.99, rate(redis_command_duration_seconds_bucket[5m]))

# Eviction rate
rate(redis_evicted_keys_total[5m])
```

---

## 8️⃣ Summary

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Key format | `ql:v1:{type}:{code}` | Namespaced, versioned, scannable |
| TTL (links) | 1 hour + 8% jitter | Balance freshness vs hit rate |
| TTL (404s) | 5 minutes | Short enough to recover |
| Warm strategy | Write-through + lazy | Simple, resilient |
| Invalidation | DELETE (not UPDATE) | Avoid race conditions |
| Hot keys | Local LRU cache | Absorb traffic spikes |
| Multi-region | Short TTL (start simple) | Add pub/sub later if needed |
| Eviction | volatile-lru | Evict cached data, keep system keys |

---

## 9️⃣ Implementation Checklist

Before going to production, verify:

- [ ] Redis `maxmemory` configured (recommend 4GB minimum)
- [ ] Redis `maxmemory-policy` set to `volatile-lru`
- [ ] Connection timeouts configured (50ms Redis, 100ms DB)
- [ ] Health check endpoints hit Redis and DB
- [ ] Prometheus metrics exported for cache hit/miss
- [ ] Alerts configured for cache hit rate < 90%
- [ ] Circuit breaker implemented for Redis failures
- [ ] Jitter applied to all TTL values
- [ ] Negative cache (404) enabled
- [ ] Local LRU cache considered for hot keys

---

## Appendix A: Redis Commands Reference

```redis
# Set link with TTL and jitter
SETEX ql:v1:link:abc123 3540 '{"u":"https://example.com","p":true,"t":1702900000}'

# Get link
GET ql:v1:link:abc123

# Check if exists (for collision detection)
EXISTS ql:v1:link:abc123

# Delete on invalidation
DEL ql:v1:link:abc123

# Set negative cache
SETEX ql:v1:404:notexist 300 "1"

# Get TTL (for early refresh check)
TTL ql:v1:link:abc123

# Scan keys by pattern (admin/debug only)
SCAN 0 MATCH ql:v1:link:* COUNT 100
```

---

## Appendix B: Failure Recovery Runbook

### Redis Down
1. Verify Redis connectivity: `redis-cli ping`
2. Check circuit breaker status in logs
3. Monitor DB load (should increase)
4. If Redis cluster: check sentinel/cluster status
5. Service continues via DB fallback - no immediate action required

### High Cache Miss Rate
1. Check `evicted_keys` metric
2. If high eviction: increase `maxmemory` or scale Redis
3. Check TTL distribution: `DEBUG OBJECT ql:v1:link:*`
4. Verify jitter is applied (keys shouldn't expire together)

### Suspected Hot Key
1. Identify key: check latency by key pattern
2. Enable local LRU cache if not already
3. Consider key replication for extreme cases
4. Monitor single-shard CPU usage
