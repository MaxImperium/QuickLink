/**
 * Health Check Routes
 * 
 * Minimal health endpoints for the redirect service.
 */

import type { FastifyInstance } from "fastify";

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", async () => {
    return { status: "ok" };
  });

  fastify.get("/health/ready", async () => {
    // TODO: Verify Redis connectivity
    return { status: "ok", cache: "ok" };
  });
}
