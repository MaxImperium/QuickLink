# @quicklink/api

Core backend API service for the QuickLink platform.

## Overview

This is the main API service built with Fastify. It handles all CRUD operations, authentication, and admin functionality.

**Note:** This service is intentionally separated from the redirect service to allow independent scaling and optimization.

## Responsibilities

- URL shortening (create, read, update, delete)
- User authentication & authorization (JWT-based)
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

## Environment Variables

```env
# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/quicklink

# Auth (REQUIRED in production)
JWT_SECRET=your-super-secret-key-change-in-production
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=12

# URLs
SHORT_URL_BASE=http://localhost:3001
CORS_ORIGIN=http://localhost:3000
```

## API Documentation

Swagger UI available at `/docs` when running in development mode.

## Authentication

### Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/auth/register` | Register new user | Public |
| POST | `/auth/login` | Login, get JWT | Public |
| GET | `/auth/me` | Get current user | Required |

### Usage Examples

**Register:**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "securepassword", "name": "John"}'
```

**Login:**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "securepassword"}'
```

**Protected endpoint:**
```bash
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer <your-jwt-token>"
```

### Response Format

**Success (201 register, 200 login):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "1",
    "email": "user@example.com",
    "name": "John",
    "createdAt": "2024-12-18T00:00:00.000Z",
    "updatedAt": "2024-12-18T00:00:00.000Z"
  }
}
```

**Error (401 unauthorized):**
```json
{
  "success": false,
  "error": "Invalid email or password"
}
```

## Links API

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/links` | Create short link | Optional |
| GET | `/links/check?alias=xxx` | Check alias | Public |
| GET | `/:code` | Redirect to URL | Public |

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
│   ├── auth.ts       # Auth service (register, login, JWT)
│   └── index.ts      # Link services
├── middleware/       # Custom middleware
│   └── auth.ts       # JWT auth middleware
└── utils/            # Helper utilities
```

## Key Design Decisions

1. **Fastify over Express**: Better performance and TypeScript support
2. **Zod for validation**: Type-safe runtime validation
3. **Plugin architecture**: Easy to extend and test
4. **JWT authentication**: Stateless, scalable auth
5. **bcrypt for passwords**: Industry-standard password hashing
