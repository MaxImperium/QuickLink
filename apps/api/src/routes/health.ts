/**
 * Health Check Routes
 * 
 * Provides endpoints for liveness and readiness probes.
 * Essential for Kubernetes deployments and load balancer health checks.
 */

import type { FastifyInstance } from "fastify";

export async function healthRoutes(fastify: FastifyInstance) {
  // Liveness probe - basic server health
  fastify.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  // Readiness probe - checks dependencies
  fastify.get("/health/ready", async () => {
    // TODO: Check database and Redis connectivity
    return {
      status: "ok",
      checks: {
        database: "ok",
        cache: "ok",
      },
      timestamp: new Date().toISOString(),
    };
  });
}
