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
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { logger } from "@quicklink/logger";
import { checkDbConnection, disconnectDb } from "@quicklink/db";

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

  // Rate limiting
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    keyGenerator: (request) => {
      return request.ip || "unknown";
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

  logger.info("Routes registered");
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
