# @quicklink/db

Database schema, migrations, and Prisma client for QuickLink.

## Overview

This package contains the PostgreSQL database schema using Prisma ORM.

## Schema Design Decisions

1. **Soft deletes**: Links are marked as deleted, not removed (audit trail)
2. **Short codes**: Indexed for fast lookups
3. **Click events**: Stored in a separate table for analytics (future partitioning)
4. **User relationships**: Prepared for multi-tenant support

## Usage

```typescript
import { prisma } from "@quicklink/db";

const link = await prisma.link.findUnique({
  where: { shortCode: "abc123" },
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
```

## Structure

```
├── prisma/
│   ├── schema.prisma     # Database schema
│   └── migrations/       # Migration files
└── src/
    ├── index.ts          # Package exports
    ├── client.ts         # Prisma client instance
    └── seed.ts           # Database seeding
```
