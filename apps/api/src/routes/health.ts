/**
 * Health Check Routes
 *
 * Provides endpoints for liveness and readiness probes.
 * Essential for Kubernetes deployments and load balancer health checks.
 */

import type { FastifyInstance } from "fastify";
import { checkDbConnection } from "@quicklink/db";
import { createRedisCache } from "@quicklink/cache";

// Lazy cache initialization for health checks
let healthCache: ReturnType<typeof createRedisCache> | null = null;

function getHealthCache() {
  if (!healthCache) {
    healthCache = createRedisCache({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || "0", 10),
    });
  }
  return healthCache;
}

export async function healthRoutes(fastify: FastifyInstance) {
  // Liveness probe - basic server health
  fastify.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  // Readiness probe - checks dependencies
  fastify.get("/health/ready", async (request, reply) => {
    const checks: Record<string, "ok" | "error"> = {
      database: "error",
      cache: "error",
    };

    // Check database
    try {
      const dbOk = await checkDbConnection();
      checks.database = dbOk ? "ok" : "error";
    } catch {
      checks.database = "error";
    }

    // Check Redis cache
    try {
      const cacheOk = await getHealthCache().ping();
      checks.cache = cacheOk ? "ok" : "error";
    } catch {
      checks.cache = "error";
    }

    const allHealthy = Object.values(checks).every((v) => v === "ok");
    const status = allHealthy ? "ok" : "degraded";

    return reply.status(allHealthy ? 200 : 503).send({
      status,
      checks,
      timestamp: new Date().toISOString(),
    });
  });
}
