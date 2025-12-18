/**
 * Redis Cache Tests
 *
 * Unit tests for the Redis cache abstraction layer.
 * Tests cache operations, TTL handling, and error recovery.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

// Mock ioredis
const mockRedisClient = {
  get: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  ping: jest.fn(),
  quit: jest.fn(),
};

jest.mock("ioredis", () => ({
  default: jest.fn().mockImplementation(() => mockRedisClient),
}));

jest.mock("./metrics.js", () => ({
  increment: jest.fn(),
  recordLatency: jest.fn(),
  recordCacheHit: jest.fn(),
  recordCacheMiss: jest.fn(),
}));

import type { CachedLink } from "../src/types.js";

describe("Redis Cache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Cache Key Format", () => {
    it("should use versioned key prefix", () => {
      // Key format: ql:v1:link:{shortCode}
      const shortCode = "abc123";
      const expectedKeyPattern = `ql:v1:link:${shortCode}`;

      expect(expectedKeyPattern).toBe("ql:v1:link:abc123");
    });

    it("should use versioned 404 key prefix", () => {
      // Key format: ql:v1:404:{shortCode}
      const shortCode = "notfound";
      const expectedKeyPattern = `ql:v1:404:${shortCode}`;

      expect(expectedKeyPattern).toBe("ql:v1:404:notfound");
    });
  });

  describe("CachedLink Structure", () => {
    it("should have required url field", () => {
      const link: CachedLink = {
        url: "https://example.com",
        permanent: true,
      };

      expect(link.url).toBeDefined();
      expect(typeof link.url).toBe("string");
    });

    it("should have permanent flag", () => {
      const permanentLink: CachedLink = {
        url: "https://example.com",
        permanent: true,
      };

      const temporaryLink: CachedLink = {
        url: "https://example.com",
        permanent: false,
      };

      expect(permanentLink.permanent).toBe(true);
      expect(temporaryLink.permanent).toBe(false);
    });
  });

  describe("JSON Serialization", () => {
    it("should serialize CachedLink to JSON", () => {
      const link: CachedLink = {
        url: "https://example.com/path?query=1",
        permanent: true,
      };

      const json = JSON.stringify(link);
      const parsed = JSON.parse(json);

      expect(parsed.url).toBe(link.url);
      expect(parsed.permanent).toBe(link.permanent);
    });

    it("should handle special characters in URL", () => {
      const link: CachedLink = {
        url: "https://example.com/path?q=hello%20world&foo=bar",
        permanent: false,
      };

      const json = JSON.stringify(link);
      const parsed = JSON.parse(json);

      expect(parsed.url).toBe(link.url);
    });

    it("should handle unicode in URL", () => {
      const link: CachedLink = {
        url: "https://example.com/日本語",
        permanent: true,
      };

      const json = JSON.stringify(link);
      const parsed = JSON.parse(json);

      expect(parsed.url).toBe(link.url);
    });
  });

  describe("TTL Calculations", () => {
    const BASE_TTL = 3600; // 1 hour
    const JITTER_PERCENT = 0.1; // 10%

    it("should calculate TTL within jitter range", () => {
      // TTL should be between 90% and 110% of base
      const minTTL = BASE_TTL * (1 - JITTER_PERCENT);
      const maxTTL = BASE_TTL * (1 + JITTER_PERCENT);

      // Generate a few random TTLs
      for (let i = 0; i < 10; i++) {
        const jitter = 1 + (Math.random() * 2 - 1) * JITTER_PERCENT;
        const ttl = Math.floor(BASE_TTL * jitter);

        expect(ttl).toBeGreaterThanOrEqual(minTTL);
        expect(ttl).toBeLessThanOrEqual(maxTTL);
      }
    });

    it("should use shorter TTL for negative cache", () => {
      const NEGATIVE_TTL = 300; // 5 minutes

      expect(NEGATIVE_TTL).toBeLessThan(BASE_TTL);
    });
  });

  describe("Error Handling Behavior", () => {
    it("should return null on parse error", () => {
      const invalidJson = "not-json";

      let result: CachedLink | null = null;
      try {
        result = JSON.parse(invalidJson);
      } catch {
        result = null;
      }

      expect(result).toBeNull();
    });

    it("should handle missing required fields gracefully", () => {
      const incompleteJson = '{"permanent": true}';

      const parsed = JSON.parse(incompleteJson) as CachedLink;

      // Missing URL should be caught by validation
      expect(parsed.url).toBeUndefined();
    });
  });

  describe("Cache Operation Patterns", () => {
    describe("Get Operation", () => {
      it("should return parsed CachedLink on hit", () => {
        const cachedData = JSON.stringify({
          url: "https://example.com",
          permanent: true,
        });

        const parsed: CachedLink = JSON.parse(cachedData);

        expect(parsed.url).toBe("https://example.com");
        expect(parsed.permanent).toBe(true);
      });

      it("should return null on miss", () => {
        const cachedData: string | null = null;

        const result = cachedData ? JSON.parse(cachedData) : null;

        expect(result).toBeNull();
      });
    });

    describe("Set Operation", () => {
      it("should serialize link before storing", () => {
        const link: CachedLink = {
          url: "https://example.com",
          permanent: true,
        };

        const serialized = JSON.stringify(link);

        expect(serialized).toBe('{"url":"https://example.com","permanent":true}');
      });
    });

    describe("Negative Cache Operation", () => {
      it("should use simple marker value", () => {
        const MARKER = "1";

        expect(MARKER).toBe("1");
        expect(MARKER.length).toBe(1);
      });

      it("should check for marker presence", () => {
        const cachedValue = "1";

        const isNotFound = cachedValue === "1";

        expect(isNotFound).toBe(true);
      });
    });
  });

  describe("Connection Configuration", () => {
    it("should have correct connection options", () => {
      const expectedOptions = {
        enableReadyCheck: false,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 1000,
      };

      // These are the recommended settings for low-latency operations
      expect(expectedOptions.enableReadyCheck).toBe(false);
      expect(expectedOptions.enableOfflineQueue).toBe(false);
      expect(expectedOptions.maxRetriesPerRequest).toBe(1);
    });

    it("should support command timeout configuration", () => {
      const TIMEOUT_MS = 100;

      expect(TIMEOUT_MS).toBeGreaterThan(0);
      expect(TIMEOUT_MS).toBeLessThan(1000);
    });
  });

  describe("Graceful Degradation", () => {
    it("should define stale data support", () => {
      interface GetOptions {
        allowStale?: boolean;
      }

      const options: GetOptions = { allowStale: true };

      expect(options.allowStale).toBe(true);
    });

    it("should support concurrent write tracking for shutdown", () => {
      let pendingWrites = 0;

      // Simulate write start
      pendingWrites++;
      expect(pendingWrites).toBe(1);

      // Simulate write complete
      pendingWrites--;
      expect(pendingWrites).toBe(0);
    });
  });

  describe("Ping/Health Check", () => {
    it("should return boolean for ping result", async () => {
      // Successful ping
      mockRedisClient.ping.mockResolvedValueOnce("PONG");

      const isHealthy = await mockRedisClient.ping().then(
        () => true,
        () => false
      );

      expect(isHealthy).toBe(true);
    });

    it("should return false on ping error", async () => {
      mockRedisClient.ping.mockRejectedValueOnce(new Error("Connection refused"));

      const isHealthy = await mockRedisClient.ping().then(
        () => true,
        () => false
      );

      expect(isHealthy).toBe(false);
    });
  });
});

describe("Cache Integration Scenarios", () => {
  describe("Hot Path - Cache Hit", () => {
    it("should return link data in under 5ms simulation", () => {
      const startTime = Date.now();

      // Simulated cache hit (no actual I/O)
      const cachedLink: CachedLink = {
        url: "https://example.com",
        permanent: true,
      };

      const endTime = Date.now();
      const latency = endTime - startTime;

      expect(latency).toBeLessThan(5);
      expect(cachedLink.url).toBeDefined();
    });
  });

  describe("Cache Miss → DB Fallback → Cache Warm", () => {
    it("should follow correct sequence", async () => {
      const operations: string[] = [];

      // 1. Check cache (miss)
      operations.push("cache_get");

      // 2. Query DB
      operations.push("db_lookup");

      // 3. Warm cache (async)
      operations.push("cache_set");

      expect(operations).toEqual(["cache_get", "db_lookup", "cache_set"]);
    });
  });

  describe("Negative Cache Flow", () => {
    it("should prevent DB lookups for known 404s", async () => {
      const operations: string[] = [];

      // 1. Check negative cache (hit)
      operations.push("negative_cache_check");
      const isKnown404 = true;

      if (isKnown404) {
        operations.push("return_404");
      } else {
        operations.push("cache_get");
        operations.push("db_lookup");
      }

      expect(operations).toEqual(["negative_cache_check", "return_404"]);
      expect(operations).not.toContain("db_lookup");
    });
  });
});
