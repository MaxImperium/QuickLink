# @quicklink/db

Database schema, migrations, and Prisma client for QuickLink.

## Overview

This package contains the PostgreSQL database schema using Prisma ORM.
Designed for high-volume URL shortening with analytics.

## Tables

| Table | Purpose | Volume |
|-------|---------|--------|
| `users` | User accounts and authentication | Low |
| `links` | Core URL shortening data | Medium |
| `click_events` | Individual click tracking | **High** |
| `aggregated_stats` | Pre-computed daily statistics | Medium |
| `reserved_aliases` | Blocklist management | Low |

## Schema Design Decisions

1. **BIGINT IDs**: Supports billions of rows without overflow
2. **Soft deletes**: Links marked as deleted via `deleted_at` (audit trail)
3. **Short codes**: Unique index for fast redirect lookups (~1ms)
4. **Lifecycle states**: Enum for `active`, `expired`, `disabled`
5. **Click events**: Separate table for analytics with time-based indexing
6. **Aggregated stats**: Pre-computed daily rollups for fast dashboards
7. **Reserved aliases**: Database-backed blocklist for dynamic updates

## Performance Considerations

### Hot Paths

1. **Redirect lookup** (`links.short_code`):
   - Every redirect hits this index
   - Composite index: `(short_code, active, lifecycle_state, deleted_at)`

2. **Click recording** (`click_events`):
   - High volume inserts
   - Consider partitioning at >100M rows

3. **Dashboard stats** (`aggregated_stats`):
   - Pre-computed to avoid scanning click_events
   - Unique constraint: `(link_id, date)`

### Scaling Notes

- **Partitioning**: Partition `click_events` by `created_at` at scale
- **Read replicas**: Use for analytics queries
- **Connection pooling**: Use PgBouncer for redirect service
- **Archival**: Move old click_events to cold storage

## Usage

```typescript
import { prisma, Link, LinkLifecycleState } from "@quicklink/db";

// Create link
const link = await prisma.link.create({
  data: {
    shortCode: "abc123",
    targetUrl: "https://example.com",
    customAlias: false,
  },
});

// Lookup for redirect
const link = await prisma.link.findFirst({
  where: {
    shortCode: "abc123",
    active: true,
    lifecycleState: "active",
    deletedAt: null,
  },
});

// Record click
await prisma.clickEvent.create({
  data: {
    linkId: link.id,
    ipAddress: "192.168.1.1",
    userAgent: "Mozilla/5.0...",
  },
});
```

## Commands

```bash
# Generate Prisma client
pnpm db:generate

# Run migrations (production)
pnpm db:migrate

# Create new migration (development)
pnpm db:migrate:dev

# Open Prisma Studio
pnpm db:studio

# Seed database
pnpm db:seed

# Reset database (development only!)
pnpm db:reset
```

## Structure

```
├── prisma/
│   ├── schema.prisma              # Database schema
│   └── migrations/
│       └── 001_initial_schema/    # Initial migration
│           └── migration.sql
├── src/
│   ├── index.ts                   # Package exports
│   ├── client.ts                  # Prisma client instance
│   ├── types.ts                   # TypeScript interfaces
│   └── seed.ts                    # Database seeding
```

## Environment Variables

```bash
# PostgreSQL connection string
DATABASE_URL="postgresql://user:pass@localhost:5432/quicklink"

# For connection pooling (production)
DATABASE_URL="postgresql://user:pass@localhost:5432/quicklink?connection_limit=10"
```
└── src/
    ├── index.ts          # Package exports
    ├── client.ts         # Prisma client instance
    └── seed.ts           # Database seeding
```
