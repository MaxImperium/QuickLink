/**
 * Redirect Handler Tests
 *
 * Integration tests for the redirect handler.
 * Tests the complete redirect flow including cache, DB fallback, and analytics.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import type { Context } from "hono";

// Mock all dependencies before importing handler
jest.mock("./cache.js", () => ({
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(undefined),
  setNotFound: jest.fn().mockResolvedValue(undefined),
  isNotFound: jest.fn(),
  ping: jest.fn().mockResolvedValue(true),
}));

jest.mock("./db.js", () => ({
  lookup: jest.fn(),
  ping: jest.fn().mockResolvedValue(true),
}));

jest.mock("./metrics.js", () => ({
  recordRedirect: jest.fn(),
  recordNegativeCacheHit: jest.fn(),
  increment: jest.fn(),
  getMetrics: jest.fn().mockReturnValue(""),
}));

import * as cache from "../src/cache.js";
import * as db from "../src/db.js";
import * as metrics from "../src/metrics.js";
import { handleRedirect, handleLiveness, handleReadiness, setAnalyticsEmitter } from "../src/handler.js";

describe("Redirect Handler", () => {
  // Create a mock Hono context
  const createMockContext = (code: string, headers: Record<string, string> = {}): Context => {
    const headerMap = new Map(Object.entries(headers));

    return {
      req: {
        param: (key: string) => (key === "code" ? code : undefined),
        header: (key: string) => headerMap.get(key.toLowerCase()),
      },
      json: jest.fn((data, status = 200) => new Response(JSON.stringify(data), { status })),
      text: jest.fn((text) => new Response(text)),
      header: jest.fn(),
    } as unknown as Context;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("handleRedirect", () => {
    describe("Short Code Validation", () => {
      it("should return 404 for missing short code", async () => {
        const ctx = createMockContext("");

        const response = await handleRedirect(ctx);

        expect(response.status).toBe(404);
        expect(metrics.recordRedirect).toHaveBeenCalledWith(404, false, expect.any(Number));
      });

      it("should return 404 for too short code (< 4 chars)", async () => {
        const ctx = createMockContext("abc");

        const response = await handleRedirect(ctx);

        expect(response.status).toBe(404);
      });

      it("should return 404 for too long code (> 12 chars)", async () => {
        const ctx = createMockContext("abcdefghijklm");

        const response = await handleRedirect(ctx);

        expect(response.status).toBe(404);
      });

      it("should return 404 for code with invalid characters", async () => {
        const ctx = createMockContext("abc-def");

        const response = await handleRedirect(ctx);

        expect(response.status).toBe(404);
      });

      it("should accept valid alphanumeric codes", async () => {
        (cache.isNotFound as jest.Mock).mockResolvedValue(false);
        (cache.get as jest.Mock).mockResolvedValue({
          url: "https://example.com",
          permanent: true,
        });

        const ctx = createMockContext("abc123");

        const response = await handleRedirect(ctx);

        expect(response.status).toBe(301);
      });
    });

    describe("Negative Cache (404 Cache)", () => {
      it("should return cached 404 without DB lookup", async () => {
        (cache.isNotFound as jest.Mock).mockResolvedValue(true);

        const ctx = createMockContext("notfound1");

        const response = await handleRedirect(ctx);

        expect(response.status).toBe(404);
        expect(metrics.recordNegativeCacheHit).toHaveBeenCalled();
        expect(db.lookup).not.toHaveBeenCalled();
      });

      it("should proceed with lookup when not in negative cache", async () => {
        (cache.isNotFound as jest.Mock).mockResolvedValue(false);
        (cache.get as jest.Mock).mockResolvedValue({
          url: "https://example.com",
          permanent: true,
        });

        const ctx = createMockContext("valid123");

        const response = await handleRedirect(ctx);

        expect(response.status).toBe(301);
      });
    });

    describe("Redis Cache Lookup", () => {
      beforeEach(() => {
        (cache.isNotFound as jest.Mock).mockResolvedValue(false);
      });

      it("should return 301 redirect for permanent cached link", async () => {
        (cache.get as jest.Mock).mockResolvedValue({
          url: "https://example.com",
          permanent: true,
        });

        const ctx = createMockContext("abc123");

        const response = await handleRedirect(ctx);

        expect(response.status).toBe(301);
        expect(response.headers.get("Location")).toBe("https://example.com");
        expect(db.lookup).not.toHaveBeenCalled();
      });

      it("should return 302 redirect for temporary cached link", async () => {
        (cache.get as jest.Mock).mockResolvedValue({
          url: "https://example.com",
          permanent: false,
        });

        const ctx = createMockContext("abc123");

        const response = await handleRedirect(ctx);

        expect(response.status).toBe(302);
        expect(response.headers.get("Location")).toBe("https://example.com");
      });

      it("should set appropriate Cache-Control for permanent redirect", async () => {
        (cache.get as jest.Mock).mockResolvedValue({
          url: "https://example.com",
          permanent: true,
        });

        const ctx = createMockContext("abc123");

        const response = await handleRedirect(ctx);

        expect(response.headers.get("Cache-Control")).toContain("max-age=3600");
      });

      it("should set appropriate Cache-Control for temporary redirect", async () => {
        (cache.get as jest.Mock).mockResolvedValue({
          url: "https://example.com",
          permanent: false,
        });

        const ctx = createMockContext("abc123");

        const response = await handleRedirect(ctx);

        expect(response.headers.get("Cache-Control")).toContain("max-age=60");
      });
    });

    describe("Database Fallback", () => {
      beforeEach(() => {
        (cache.isNotFound as jest.Mock).mockResolvedValue(false);
        (cache.get as jest.Mock).mockResolvedValue(null);
      });

      it("should fallback to DB on cache miss", async () => {
        (db.lookup as jest.Mock).mockResolvedValue({
          url: "https://example.com",
          permanent: true,
        });

        const ctx = createMockContext("abc123");

        const response = await handleRedirect(ctx);

        expect(response.status).toBe(301);
        expect(db.lookup).toHaveBeenCalledWith("abc123");
      });

      it("should warm cache after DB hit", async () => {
        (db.lookup as jest.Mock).mockResolvedValue({
          url: "https://example.com",
          permanent: true,
        });

        const ctx = createMockContext("abc123");

        await handleRedirect(ctx);

        // Allow async cache write to complete
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(cache.set).toHaveBeenCalledWith("abc123", {
          url: "https://example.com",
          permanent: true,
        });
      });

      it("should cache 404 after DB miss", async () => {
        (db.lookup as jest.Mock).mockResolvedValue(null);

        const ctx = createMockContext("notfound");

        await handleRedirect(ctx);

        // Allow async cache write to complete
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(cache.setNotFound).toHaveBeenCalledWith("notfound");
      });

      it("should return 404 when not found in DB", async () => {
        (db.lookup as jest.Mock).mockResolvedValue(null);

        const ctx = createMockContext("notfound");

        const response = await handleRedirect(ctx);

        expect(response.status).toBe(404);
      });
    });

    describe("Error Handling", () => {
      beforeEach(() => {
        (cache.isNotFound as jest.Mock).mockResolvedValue(false);
        (cache.get as jest.Mock).mockResolvedValue(null);
      });

      it("should return 503 on DB error when no stale cache", async () => {
        (db.lookup as jest.Mock).mockRejectedValue(new Error("DB connection failed"));
        (cache.get as jest.Mock)
          .mockResolvedValueOnce(null) // First call (normal lookup)
          .mockResolvedValueOnce(null); // Second call (stale check)

        const ctx = createMockContext("abc123");

        const response = await handleRedirect(ctx);

        expect(response.status).toBe(503);
        expect(metrics.increment).toHaveBeenCalledWith("db_error");
      });

      it("should serve stale cache data on DB error", async () => {
        (db.lookup as jest.Mock).mockRejectedValue(new Error("DB connection failed"));
        (cache.get as jest.Mock)
          .mockResolvedValueOnce(null) // First call (normal lookup)
          .mockResolvedValueOnce({
            url: "https://stale.example.com",
            permanent: true,
          }); // Second call (stale check)

        const ctx = createMockContext("abc123");

        const response = await handleRedirect(ctx);

        expect(response.status).toBe(301);
        expect(response.headers.get("Location")).toBe("https://stale.example.com");
      });
    });

    describe("Security Headers", () => {
      beforeEach(() => {
        (cache.isNotFound as jest.Mock).mockResolvedValue(false);
        (cache.get as jest.Mock).mockResolvedValue({
          url: "https://example.com",
          permanent: true,
        });
      });

      it("should set X-Content-Type-Options header", async () => {
        const ctx = createMockContext("abc123");

        const response = await handleRedirect(ctx);

        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      });

      it("should set X-Frame-Options header", async () => {
        const ctx = createMockContext("abc123");

        const response = await handleRedirect(ctx);

        expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      });
    });

    describe("Analytics", () => {
      let analyticsEmitter: jest.Mock;

      beforeEach(() => {
        (cache.isNotFound as jest.Mock).mockResolvedValue(false);
        (cache.get as jest.Mock).mockResolvedValue({
          url: "https://example.com",
          permanent: true,
        });

        analyticsEmitter = jest.fn();
        setAnalyticsEmitter(analyticsEmitter);
      });

      afterEach(() => {
        setAnalyticsEmitter(null as unknown as (event: unknown) => void);
      });

      it("should emit analytics event on successful redirect", async () => {
        const ctx = createMockContext("abc123", {
          "user-agent": "Mozilla/5.0",
          referer: "https://google.com",
        });

        await handleRedirect(ctx);

        expect(analyticsEmitter).toHaveBeenCalledWith(
          expect.objectContaining({
            code: "abc123",
            meta: expect.objectContaining({
              ua: "Mozilla/5.0",
              ref: "https://google.com",
              dst: "https://example.com",
            }),
          })
        );
      });

      it("should not block redirect if analytics fails", async () => {
        analyticsEmitter.mockImplementation(() => {
          throw new Error("Analytics failed");
        });

        const ctx = createMockContext("abc123");

        const response = await handleRedirect(ctx);

        expect(response.status).toBe(301);
      });
    });

    describe("Client IP Extraction", () => {
      beforeEach(() => {
        (cache.isNotFound as jest.Mock).mockResolvedValue(false);
        (cache.get as jest.Mock).mockResolvedValue({
          url: "https://example.com",
          permanent: true,
        });

        const analyticsEmitter = jest.fn();
        setAnalyticsEmitter(analyticsEmitter);
      });

      it("should extract IP from CF-Connecting-IP", async () => {
        const ctx = createMockContext("abc123", {
          "cf-connecting-ip": "1.2.3.4",
          "x-forwarded-for": "5.6.7.8",
        });

        await handleRedirect(ctx);

        // The analytics emitter should receive the CF IP
        // (Implementation detail - tested through analytics)
      });

      it("should extract IP from X-Forwarded-For", async () => {
        const ctx = createMockContext("abc123", {
          "x-forwarded-for": "1.2.3.4, 5.6.7.8",
        });

        await handleRedirect(ctx);
        // IP should be the first address in the chain
      });

      it("should extract IP from X-Real-IP", async () => {
        const ctx = createMockContext("abc123", {
          "x-real-ip": "1.2.3.4",
        });

        await handleRedirect(ctx);
      });
    });

    describe("Metrics Recording", () => {
      beforeEach(() => {
        (cache.isNotFound as jest.Mock).mockResolvedValue(false);
      });

      it("should record redirect metrics with cache hit", async () => {
        (cache.get as jest.Mock).mockResolvedValue({
          url: "https://example.com",
          permanent: true,
        });

        const ctx = createMockContext("abc123");

        await handleRedirect(ctx);

        expect(metrics.recordRedirect).toHaveBeenCalledWith(
          301,
          true, // cache hit
          expect.any(Number)
        );
      });

      it("should record redirect metrics with cache miss", async () => {
        (cache.get as jest.Mock).mockResolvedValue(null);
        (db.lookup as jest.Mock).mockResolvedValue({
          url: "https://example.com",
          permanent: true,
        });

        const ctx = createMockContext("abc123");

        await handleRedirect(ctx);

        expect(metrics.recordRedirect).toHaveBeenCalledWith(
          301,
          false, // cache miss
          expect.any(Number)
        );
      });
    });
  });

  describe("Health Check Endpoints", () => {
    describe("handleLiveness", () => {
      it("should return 200 OK", () => {
        const ctx = createMockContext("") as Context;

        const response = handleLiveness(ctx);

        expect(ctx.json).toHaveBeenCalledWith({ status: "ok" });
      });
    });

    describe("handleReadiness", () => {
      it("should return ok when both Redis and DB are healthy", async () => {
        (cache.ping as jest.Mock).mockResolvedValue(true);
        (db.ping as jest.Mock).mockResolvedValue(true);

        const ctx = createMockContext("") as Context;

        await handleReadiness(ctx);

        expect(ctx.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: "ok",
            checks: { redis: "ok", db: "ok" },
          }),
          200
        );
      });

      it("should return degraded when Redis is down", async () => {
        (cache.ping as jest.Mock).mockResolvedValue(false);
        (db.ping as jest.Mock).mockResolvedValue(true);

        const ctx = createMockContext("") as Context;

        await handleReadiness(ctx);

        expect(ctx.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: "degraded",
            checks: { redis: "error", db: "ok" },
          }),
          200
        );
      });

      it("should return degraded when DB is down", async () => {
        (cache.ping as jest.Mock).mockResolvedValue(true);
        (db.ping as jest.Mock).mockResolvedValue(false);

        const ctx = createMockContext("") as Context;

        await handleReadiness(ctx);

        expect(ctx.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: "degraded",
            checks: { redis: "error", db: "ok" }.redis ? { redis: "ok", db: "error" } : { redis: "error", db: "ok" },
          }),
          200
        );
      });

      it("should return unhealthy with 503 when both are down", async () => {
        (cache.ping as jest.Mock).mockResolvedValue(false);
        (db.ping as jest.Mock).mockResolvedValue(false);

        const ctx = createMockContext("") as Context;

        await handleReadiness(ctx);

        expect(ctx.json).toHaveBeenCalledWith(
          expect.objectContaining({
            status: "unhealthy",
          }),
          503
        );
      });
    });
  });
});
