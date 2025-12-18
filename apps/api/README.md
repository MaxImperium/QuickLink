# @quicklink/api

Core backend API service for the QuickLink platform.

## Overview

This is the main API service built with Fastify. It handles all CRUD operations, authentication, and admin functionality.

**Note:** This service is intentionally separated from the redirect service to allow independent scaling and optimization.

## Responsibilities

- URL shortening (create, read, update, delete)
- User authentication & authorization
- Link analytics aggregation
- Admin dashboard API
- Rate limiting & abuse prevention

## Development

```bash
# Start development server with hot reload
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Run tests
pnpm test
```

## API Documentation

Swagger UI available at `/docs` when running in development mode.

## Structure

```
src/
├── index.ts          # Application entry point
├── routes/           # API route handlers
│   ├── health.ts     # Health check endpoints
│   ├── links/        # Link management routes
│   └── auth/         # Authentication routes
├── plugins/          # Fastify plugins
├── services/         # Business logic layer
├── middleware/       # Custom middleware
└── utils/            # Helper utilities
```

## Key Design Decisions

1. **Fastify over Express**: Better performance and TypeScript support
2. **Zod for validation**: Type-safe runtime validation
3. **Plugin architecture**: Easy to extend and test
