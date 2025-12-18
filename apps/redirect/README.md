# @quicklink/redirect

High-performance redirect service for the QuickLink platform.

## Overview

This is an ultra-lightweight, latency-optimized service dedicated solely to handling URL redirects. It is intentionally minimal to achieve sub-millisecond response times.

## Architecture Rationale

**Why a separate redirect service?**

1. **Performance**: Redirect is the hot path. Every millisecond counts for UX and SEO.
2. **Scalability**: Can scale independently from the main API.
3. **Reliability**: Minimal dependencies reduce failure points.
4. **Cost**: Can use smaller, cheaper instances due to low memory footprint.

## Responsibilities

- Lookup short code → original URL (Redis first, DB fallback)
- Perform 301/302 redirects
- Emit click events to the queue (fire-and-forget)
- Return 404 for unknown codes

## Non-Responsibilities (Handled by API service)

- ❌ URL validation or creation
- ❌ Analytics aggregation
- ❌ User authentication
- ❌ Rate limiting (handled at CDN/load balancer level)

## Development

```bash
# Start development server
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start
```

## Performance Targets

- p50 latency: < 5ms
- p99 latency: < 20ms
- Throughput: > 10,000 req/s per instance

## Structure

```
src/
├── index.ts          # Minimal server setup
├── routes/
│   ├── health.ts     # Health checks
│   └── redirect.ts   # Main redirect handler
└── services/
    └── lookup.ts     # URL lookup service
```
