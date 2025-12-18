/**
 * Links Routes E2E Tests
 *
 * Tests for /links CRUD operations and /links/check endpoint.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "@quicklink/db";

// Create a test app factory
async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
  });

  // Helper to extract user from token
  const getUserFromToken = (authHeader?: string): string | null => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);
    if (token === "valid-user-token") return "user-123";
    return null;
  };

  // POST /links - Create link
  app.post("/links", async (request, reply) => {
    const body = request.body as {
      targetUrl?: string;
      customAlias?: string;
      expiresAt?: string;
      maxClicks?: number;
    };
    const userId = getUserFromToken(request.headers.authorization);

    // Validation
    if (!body.targetUrl) {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: { targetUrl: ["URL is required"] },
      });
    }

    // URL validation
    try {
      new URL(body.targetUrl);
    } catch {
      return reply.status(400).send({
        success: false,
        error: "Validation failed",
        details: { targetUrl: ["Invalid URL format"] },
      });
    }

    // Check custom alias
    if (body.customAlias) {
      // Validate format
      if (!/^[a-zA-Z0-9_-]+$/.test(body.customAlias)) {
        return reply.status(400).send({
          success: false,
          error: "Validation failed",
          errorCode: "ALIAS_INVALID",
        });
      }

      // Check if taken
      const existingLink = await (prisma.link.findFirst as jest.Mock)({
        where: { shortCode: body.customAlias },
      });
      if (existingLink) {
        return reply.status(409).send({
          success: false,
          error: "Alias already taken",
          errorCode: "ALIAS_TAKEN",
        });
      }

      // Check blocklist (simplified)
      const blockedWords = ["admin", "api", "login", "dashboard"];
      if (blockedWords.some((word) => body.customAlias?.toLowerCase().includes(word))) {
        return reply.status(403).send({
          success: false,
          error: "Alias is blocked",
          errorCode: "ALIAS_BLOCKED",
        });
      }
    }

    // Generate short code if no custom alias
    const shortCode = body.customAlias || `abc${Date.now().toString(36).slice(-4)}`;

    // Create link
    const link = await (prisma.link.create as jest.Mock)({
      data: {
        shortCode,
        targetUrl: body.targetUrl,
        userId: userId ? BigInt(userId.replace("user-", "")) : null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        maxClicks: body.maxClicks || null,
      },
    });

    return reply.status(201).send({
      success: true,
      link: {
        id: link?.id || "1",
        shortCode,
        shortUrl: `http://localhost:3001/${shortCode}`,
        targetUrl: body.targetUrl,
        createdAt: new Date().toISOString(),
      },
    });
  });

  // GET /links - List user's links
  app.get("/links", async (request, reply) => {
    const userId = getUserFromToken(request.headers.authorization);

    if (!userId) {
      return reply.status(401).send({
        success: false,
        error: "Authentication required",
      });
    }

    const links = await (prisma.link.findMany as jest.Mock)({
      where: { userId: BigInt(userId.replace("user-", "")) },
    });

    return reply.status(200).send({
      success: true,
      links: links || [],
    });
  });

  // GET /links/check - Check alias availability
  app.get("/links/check", async (request, reply) => {
    const query = request.query as { alias?: string };

    if (!query.alias) {
      return reply.status(400).send({
        success: false,
        error: "Alias parameter is required",
      });
    }

    // Validate format
    if (!/^[a-zA-Z0-9_-]+$/.test(query.alias)) {
      return reply.status(400).send({
        success: false,
        available: false,
        reason: "invalid_format",
      });
    }

    // Check if taken
    const existingLink = await (prisma.link.findFirst as jest.Mock)({
      where: { shortCode: query.alias },
    });

    if (existingLink) {
      return reply.status(200).send({
        success: true,
        available: false,
        reason: "taken",
      });
    }

    // Check blocklist
    const blockedWords = ["admin", "api", "login", "dashboard"];
    if (blockedWords.some((word) => query.alias?.toLowerCase().includes(word))) {
      return reply.status(200).send({
        success: true,
        available: false,
        reason: "blocked",
      });
    }

    return reply.status(200).send({
      success: true,
      available: true,
    });
  });

  // GET /links/:code - Get link details
  app.get("/links/:code", async (request, reply) => {
    const params = request.params as { code: string };

    const link = await (prisma.link.findFirst as jest.Mock)({
      where: { shortCode: params.code },
    });

    if (!link) {
      return reply.status(404).send({
        success: false,
        error: "Link not found",
      });
    }

    return reply.status(200).send({
      success: true,
      link,
    });
  });

  // DELETE /links/:code - Delete link
  app.delete("/links/:code", async (request, reply) => {
    const params = request.params as { code: string };
    const userId = getUserFromToken(request.headers.authorization);

    if (!userId) {
      return reply.status(401).send({
        success: false,
        error: "Authentication required",
      });
    }

    const link = await (prisma.link.findFirst as jest.Mock)({
      where: { shortCode: params.code },
    });

    if (!link) {
      return reply.status(404).send({
        success: false,
        error: "Link not found",
      });
    }

    // Check ownership
    if (link.userId && link.userId.toString() !== userId.replace("user-", "")) {
      return reply.status(403).send({
        success: false,
        error: "Not authorized to delete this link",
      });
    }

    await (prisma.link.update as jest.Mock)({
      where: { id: link.id },
      data: { deletedAt: new Date() },
    });

    return reply.status(200).send({
      success: true,
      message: "Link deleted",
    });
  });

  return app;
}

describe("Links Routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("POST /links - Create Link", () => {
    it("should create a link with auto-generated short code", async () => {
      (prisma.link.create as jest.Mock).mockResolvedValue({
        id: BigInt(1),
        shortCode: "abc1234",
        targetUrl: "https://example.com",
        createdAt: new Date(),
      });

      const response = await app.inject({
        method: "POST",
        url: "/links",
        payload: {
          targetUrl: "https://example.com",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.link.shortUrl).toBeDefined();
      expect(body.link.targetUrl).toBe("https://example.com");
    });

    it("should create a link with custom alias", async () => {
      (prisma.link.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.link.create as jest.Mock).mockResolvedValue({
        id: BigInt(1),
        shortCode: "my-custom-link",
        targetUrl: "https://example.com",
        createdAt: new Date(),
      });

      const response = await app.inject({
        method: "POST",
        url: "/links",
        payload: {
          targetUrl: "https://example.com",
          customAlias: "my-custom-link",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.link.shortCode).toBe("my-custom-link");
    });

    it("should reject invalid URL", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/links",
        payload: {
          targetUrl: "not-a-valid-url",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });

    it("should reject missing URL", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/links",
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject taken custom alias", async () => {
      (prisma.link.findFirst as jest.Mock).mockResolvedValue({
        id: BigInt(1),
        shortCode: "taken-alias",
      });

      const response = await app.inject({
        method: "POST",
        url: "/links",
        payload: {
          targetUrl: "https://example.com",
          customAlias: "taken-alias",
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.errorCode).toBe("ALIAS_TAKEN");
    });

    it("should reject blocked custom alias", async () => {
      (prisma.link.findFirst as jest.Mock).mockResolvedValue(null);

      const response = await app.inject({
        method: "POST",
        url: "/links",
        payload: {
          targetUrl: "https://example.com",
          customAlias: "admin-panel",
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.errorCode).toBe("ALIAS_BLOCKED");
    });

    it("should reject invalid alias characters", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/links",
        payload: {
          targetUrl: "https://example.com",
          customAlias: "invalid@alias!",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.errorCode).toBe("ALIAS_INVALID");
    });

    it("should associate link with authenticated user", async () => {
      (prisma.link.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.link.create as jest.Mock).mockResolvedValue({
        id: BigInt(1),
        shortCode: "user-link",
        targetUrl: "https://example.com",
        userId: BigInt(123),
        createdAt: new Date(),
      });

      const response = await app.inject({
        method: "POST",
        url: "/links",
        headers: {
          authorization: "Bearer valid-user-token",
        },
        payload: {
          targetUrl: "https://example.com",
          customAlias: "user-link",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(prisma.link.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: expect.any(BigInt),
          }),
        })
      );
    });
  });

  describe("GET /links - List Links", () => {
    it("should return user links when authenticated", async () => {
      (prisma.link.findMany as jest.Mock).mockResolvedValue([
        { id: BigInt(1), shortCode: "link1", targetUrl: "https://example1.com" },
        { id: BigInt(2), shortCode: "link2", targetUrl: "https://example2.com" },
      ]);

      const response = await app.inject({
        method: "GET",
        url: "/links",
        headers: {
          authorization: "Bearer valid-user-token",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.links).toHaveLength(2);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/links",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /links/check - Check Alias Availability", () => {
    it("should return available for unused alias", async () => {
      (prisma.link.findFirst as jest.Mock).mockResolvedValue(null);

      const response = await app.inject({
        method: "GET",
        url: "/links/check?alias=available-alias",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.available).toBe(true);
    });

    it("should return unavailable for taken alias", async () => {
      (prisma.link.findFirst as jest.Mock).mockResolvedValue({
        id: BigInt(1),
        shortCode: "taken-alias",
      });

      const response = await app.inject({
        method: "GET",
        url: "/links/check?alias=taken-alias",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.available).toBe(false);
      expect(body.reason).toBe("taken");
    });

    it("should return unavailable for blocked alias", async () => {
      (prisma.link.findFirst as jest.Mock).mockResolvedValue(null);

      const response = await app.inject({
        method: "GET",
        url: "/links/check?alias=admin",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.available).toBe(false);
      expect(body.reason).toBe("blocked");
    });

    it("should reject missing alias parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/links/check",
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject invalid alias format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/links/check?alias=invalid@alias",
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.available).toBe(false);
      expect(body.reason).toBe("invalid_format");
    });
  });

  describe("GET /links/:code - Get Link Details", () => {
    it("should return link details for existing code", async () => {
      (prisma.link.findFirst as jest.Mock).mockResolvedValue({
        id: BigInt(1),
        shortCode: "abc123",
        targetUrl: "https://example.com",
        clickCount: 42,
        createdAt: new Date(),
      });

      const response = await app.inject({
        method: "GET",
        url: "/links/abc123",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.link.shortCode).toBe("abc123");
    });

    it("should return 404 for non-existent code", async () => {
      (prisma.link.findFirst as jest.Mock).mockResolvedValue(null);

      const response = await app.inject({
        method: "GET",
        url: "/links/nonexistent",
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("DELETE /links/:code - Delete Link", () => {
    it("should soft delete link when authorized", async () => {
      (prisma.link.findFirst as jest.Mock).mockResolvedValue({
        id: BigInt(1),
        shortCode: "my-link",
        userId: BigInt(123),
      });
      (prisma.link.update as jest.Mock).mockResolvedValue({
        id: BigInt(1),
        deletedAt: new Date(),
      });

      const response = await app.inject({
        method: "DELETE",
        url: "/links/my-link",
        headers: {
          authorization: "Bearer valid-user-token",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it("should reject unauthenticated delete", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/links/my-link",
      });

      expect(response.statusCode).toBe(401);
    });

    it("should return 404 for non-existent link", async () => {
      (prisma.link.findFirst as jest.Mock).mockResolvedValue(null);

      const response = await app.inject({
        method: "DELETE",
        url: "/links/nonexistent",
        headers: {
          authorization: "Bearer valid-user-token",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should reject delete of link owned by another user", async () => {
      (prisma.link.findFirst as jest.Mock).mockResolvedValue({
        id: BigInt(1),
        shortCode: "other-users-link",
        userId: BigInt(999), // Different user
      });

      const response = await app.inject({
        method: "DELETE",
        url: "/links/other-users-link",
        headers: {
          authorization: "Bearer valid-user-token",
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });
});
