/**
 * QuickLink API Service
 *
 * Main entry point for the core backend API.
 * Handles URL shortening, authentication, and admin functionality.
 *
 * Endpoints:
 *   POST /links           - Create new short link
 *   GET  /:code           - Redirect to target URL
 *   GET  /links/check     - Check alias availability
 *   GET  /health          - Health check
 *
 * Performance Features:
 *   - Redis-based rate limiting (distributed across instances)
 *   - Response caching for read-heavy endpoints
 *   - Request coalescing for duplicate requests
 *   - Prometheus metrics integration
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { logger } from "@quicklink/logger";
import { checkDbConnection, disconnectDb, getDbMetrics } from "@quicklink/db";

import { linksRoutes } from "./routes/links/index.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth/index.js";
import { authPlugin } from "./middleware/auth.js";

// ============================================================================
// Configuration
// ============================================================================

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const NODE_ENV = process.env.NODE_ENV || "development";

// Redis URL for distributed rate limiting
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Rate limit configuration (per endpoint type)
const RATE_LIMITS = {
  // General API: 100 req/min
  default: { max: 100, timeWindow: "1 minute" },
  // Link creation: 20 req/min (prevent spam)
  create: { max: 20, timeWindow: "1 minute" },
  // Auth: 10 req/min (prevent brute force)
  auth: { max: 10, timeWindow: "1 minute" },
  // Health check: 60 req/min
  health: { max: 60, timeWindow: "1 minute" },
} as const;

// ============================================================================
// Fastify Instance
// ============================================================================

const fastify = Fastify({
  logger: {
    level: NODE_ENV === "production" ? "info" : "debug",
    transport:
      NODE_ENV === "development"
        ? {
            target: "pino-pretty",
            options: { colorize: true },
          }
        : undefined,
  },
  trustProxy: true,
  requestIdHeader: "x-request-id",
});

// ============================================================================
// Redis Client for Rate Limiting
// ============================================================================

let redisClient: import("ioredis").Redis | null = null;

async function getRedisClient(): Promise<import("ioredis").Redis | null> {
  if (redisClient) return redisClient;

  try {
    const Redis = (await import("ioredis")).default;
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });

    await redisClient.ping();
    logger.info("Redis connected for rate limiting");
    return redisClient;
  } catch (error) {
    logger.warn({ error }, "Redis not available, using in-memory rate limiting");
    return null;
  }
}

// ============================================================================
// Plugins
// ============================================================================

async function registerPlugins(): Promise<void> {
  // Security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: NODE_ENV === "production",
  });

  // CORS
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  });

  // Rate limiting with Redis backend (distributed)
  const redis = await getRedisClient();

  await fastify.register(rateLimit, {
    max: RATE_LIMITS.default.max,
    timeWindow: RATE_LIMITS.default.timeWindow,
    // Use Redis for distributed rate limiting if available
    redis: redis ?? undefined,
    // Generate unique key per IP
    keyGenerator: (request) => {
      return request.ip || "unknown";
    },
    // Skip rate limiting for health checks
    skipOnError: true,
    // Add rate limit headers to all responses
    addHeadersOnExceeding: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
    },
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
    // Custom error message
    errorResponseBuilder: (request, context) => {
      return {
        success: false,
        error: "Too many requests",
        message: `You have exceeded the ${context.max} requests in ${context.after} limit`,
        retryAfter: context.after,
      };
    },
  });

  // Swagger documentation
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: "QuickLink API",
        description: "URL Shortening Service API",
        version: "1.0.0",
      },
      servers: [
        {
          url: `http://localhost:${PORT}`,
          description: "Development server",
        },
      ],
      tags: [
        { name: "auth", description: "Authentication endpoints" },
        { name: "links", description: "Link management endpoints" },
        { name: "redirect", description: "URL redirection" },
        { name: "health", description: "Health check endpoints" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
  });

  logger.info("Plugins registered");
}

// ============================================================================
// Routes
// ============================================================================

async function registerRoutes(): Promise<void> {
  // Auth plugin (decorates request with auth properties)
  await fastify.register(authPlugin);

  // Health check routes
  await fastify.register(healthRoutes);

  // Auth routes (register, login, me)
  await fastify.register(authRoutes);

  // Link management routes (includes redirect)
  await fastify.register(linksRoutes);

  // Prometheus metrics endpoint
  fastify.get("/metrics", async (request, reply) => {
    const dbMetrics = getDbMetrics();
    const metrics = buildPrometheusMetrics(dbMetrics);
    reply.header("Content-Type", "text/plain; version=0.0.4");
    return metrics;
  });

  logger.info("Routes registered");
}

/**
 * Build Prometheus-compatible metrics string
 */
function buildPrometheusMetrics(dbMetrics: ReturnType<typeof getDbMetrics>): string {
  const lines: string[] = [];

  // Database metrics
  lines.push("# HELP quicklink_api_db_queries_total Total database queries");
  lines.push("# TYPE quicklink_api_db_queries_total counter");
  lines.push(`quicklink_api_db_queries_total ${dbMetrics.totalQueries}`);

  lines.push("# HELP quicklink_api_db_slow_queries_total Slow database queries");
  lines.push("# TYPE quicklink_api_db_slow_queries_total counter");
  lines.push(`quicklink_api_db_slow_queries_total ${dbMetrics.slowQueries}`);

  lines.push("# HELP quicklink_api_db_errors_total Database errors");
  lines.push("# TYPE quicklink_api_db_errors_total counter");
  lines.push(`quicklink_api_db_errors_total ${dbMetrics.errors}`);

  lines.push("# HELP quicklink_api_db_avg_query_time_ms Average query time in ms");
  lines.push("# TYPE quicklink_api_db_avg_query_time_ms gauge");
  lines.push(`quicklink_api_db_avg_query_time_ms ${dbMetrics.avgQueryTimeMs.toFixed(2)}`);

  return lines.join("\n");
}

// ============================================================================
// Lifecycle Hooks
// ============================================================================

fastify.addHook("onRequest", async (request) => {
  request.log.info({ url: request.url, method: request.method }, "Incoming request");
});

fastify.addHook("onResponse", async (request, reply) => {
  request.log.info(
    {
      url: request.url,
      method: request.method,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
    },
    "Request completed"
  );
});

// ============================================================================
// Error Handling
// ============================================================================

fastify.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, "Request error");

  // Rate limit exceeded
  if (error.statusCode === 429) {
    return reply.status(429).send({
      success: false,
      error: "Too many requests. Please try again later.",
    });
  }

  // Validation errors
  if (error.validation) {
    return reply.status(400).send({
      success: false,
      error: "Validation error",
      details: error.validation,
    });
  }

  // Generic error
  const statusCode = error.statusCode || 500;
  return reply.status(statusCode).send({
    success: false,
    error: NODE_ENV === "production" ? "Internal server error" : error.message,
  });
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Received shutdown signal");

  try {
    await fastify.close();
    logger.info("Fastify server closed");

    // Close Redis connection
    if (redisClient) {
      await redisClient.quit();
      logger.info("Redis connection closed");
    }

    await disconnectDb();
    logger.info("Database connection closed");

    process.exit(0);
  } catch (err) {
    logger.error({ err }, "Error during shutdown");
    process.exit(1);
  }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ============================================================================
// Server Start
// ============================================================================

async function start(): Promise<void> {
  try {
    // Check database connection
    const dbHealthy = await checkDbConnection();
    if (!dbHealthy) {
      throw new Error("Database connection failed");
    }
    logger.info("Database connection verified");

    // Register plugins and routes
    await registerPlugins();
    await registerRoutes();

    // Start server
    await fastify.listen({ port: PORT, host: HOST });

    logger.info(`QuickLink API running on http://${HOST}:${PORT}`);
    logger.info(`Swagger docs: http://${HOST}:${PORT}/docs`);
  } catch (err) {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

start();
