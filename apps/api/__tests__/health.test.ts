/**
 * Health Check Route Tests
 *
 * Tests for /health endpoints.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import Fastify, { type FastifyInstance } from "fastify";

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Mocked health check state
  let dbHealthy = true;
  let cacheHealthy = true;

  // Test helper to set health state
  (app as unknown as { setHealthState: (db: boolean, cache: boolean) => void }).setHealthState = (
    db: boolean,
    cache: boolean
  ) => {
    dbHealthy = db;
    cacheHealthy = cache;
  };

  // GET /health - Basic health check
  app.get("/health", async (request, reply) => {
    return reply.status(200).send({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  // GET /health/ready - Readiness probe
  app.get("/health/ready", async (request, reply) => {
    const checks = {
      database: dbHealthy ? "ok" : "error",
      cache: cacheHealthy ? "ok" : "error",
    };

    const allHealthy = dbHealthy && cacheHealthy;
    const someHealthy = dbHealthy || cacheHealthy;

    let status: string;
    let statusCode: number;

    if (allHealthy) {
      status = "ok";
      statusCode = 200;
    } else if (someHealthy) {
      status = "degraded";
      statusCode = 200;
    } else {
      status = "unhealthy";
      statusCode = 503;
    }

    return reply.status(statusCode).send({
      status,
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  // GET /health/live - Liveness probe
  app.get("/health/live", async (request, reply) => {
    return reply.status(200).send({
      status: "ok",
    });
  });

  return app;
}

describe("Health Routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /health", () => {
    it("should return 200 with status ok", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("ok");
      expect(body.timestamp).toBeDefined();
    });

    it("should include timestamp in ISO format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      const body = JSON.parse(response.body);
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });
  });

  describe("GET /health/ready - Readiness Probe", () => {
    it("should return ok when all services are healthy", async () => {
      (app as unknown as { setHealthState: (db: boolean, cache: boolean) => void }).setHealthState(
        true,
        true
      );

      const response = await app.inject({
        method: "GET",
        url: "/health/ready",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("ok");
      expect(body.checks.database).toBe("ok");
      expect(body.checks.cache).toBe("ok");
    });

    it("should return degraded when database is down", async () => {
      (app as unknown as { setHealthState: (db: boolean, cache: boolean) => void }).setHealthState(
        false,
        true
      );

      const response = await app.inject({
        method: "GET",
        url: "/health/ready",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("degraded");
      expect(body.checks.database).toBe("error");
      expect(body.checks.cache).toBe("ok");
    });

    it("should return degraded when cache is down", async () => {
      (app as unknown as { setHealthState: (db: boolean, cache: boolean) => void }).setHealthState(
        true,
        false
      );

      const response = await app.inject({
        method: "GET",
        url: "/health/ready",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("degraded");
    });

    it("should return unhealthy with 503 when all services are down", async () => {
      (app as unknown as { setHealthState: (db: boolean, cache: boolean) => void }).setHealthState(
        false,
        false
      );

      const response = await app.inject({
        method: "GET",
        url: "/health/ready",
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("unhealthy");
      expect(body.checks.database).toBe("error");
      expect(body.checks.cache).toBe("error");
    });
  });

  describe("GET /health/live - Liveness Probe", () => {
    it("should return 200 with status ok", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/live",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("ok");
    });

    it("should always succeed regardless of service health", async () => {
      // Liveness checks process health, not service health
      (app as unknown as { setHealthState: (db: boolean, cache: boolean) => void }).setHealthState(
        false,
        false
      );

      const response = await app.inject({
        method: "GET",
        url: "/health/live",
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
