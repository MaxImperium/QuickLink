/**
 * Link Management Routes
 *
 * Endpoints:
 *   POST /links         - Create a new short link
 *   GET  /links/:code   - Redirect to target URL
 *   GET  /links/check   - Check alias availability
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { createLink, getLinkByCode, checkAliasAvailability, recordClick } from "../../services/index.js";
import { requireAuth, optionalAuth } from "../../middleware/auth.js";
import { logger } from "@quicklink/logger";
import { createHash } from "node:crypto";

// ============================================================================
// Request/Response Schemas (Zod)
// ============================================================================

const createLinkSchema = z.object({
  targetUrl: z
    .string()
    .url("Invalid URL format")
    .max(2048, "URL too long (max 2048 characters)"),
  customAlias: z
    .string()
    .min(3, "Alias too short (min 3 characters)")
    .max(32, "Alias too long (max 32 characters)")
    .regex(/^[a-zA-Z0-9_-]+$/, "Alias can only contain letters, numbers, underscores, and hyphens")
    .optional(),
  expiresAt: z.coerce.date().optional(),
  maxClicks: z.number().int().positive().optional(),
});

const checkAliasSchema = z.object({
  alias: z
    .string()
    .min(1, "Alias is required")
    .max(32, "Alias too long"),
});

type CreateLinkBody = z.infer<typeof createLinkSchema>;
type CheckAliasQuery = z.infer<typeof checkAliasSchema>;

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * POST /links - Create a new shortened link
 */
async function createLinkHandler(
  request: FastifyRequest<{ Body: CreateLinkBody }>,
  reply: FastifyReply
): Promise<void> {
  // Validate request body
  const parseResult = createLinkSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      success: false,
      error: "Validation failed",
      details: parseResult.error.flatten().fieldErrors,
    });
  }

  const { targetUrl, customAlias, expiresAt, maxClicks } = parseResult.data;

  // Get user ID from authenticated request (set by auth middleware)
  const userId = request.userId || null;

  const result = await createLink({
    targetUrl,
    customAlias,
    userId,
    expiresAt: expiresAt || null,
    maxClicks: maxClicks || null,
  });

  if (!result.success) {
    const statusMap: Record<string, number> = {
      ALIAS_TAKEN: 409,
      ALIAS_BLOCKED: 403,
      ALIAS_INVALID: 400,
      GENERATION_FAILED: 503,
      DB_ERROR: 500,
    };
    const status = statusMap[result.errorCode || "DB_ERROR"] || 500;

    return reply.status(status).send({
      success: false,
      error: result.error,
      errorCode: result.errorCode,
    });
  }

  // Build short URL
  const baseUrl = process.env.SHORT_URL_BASE || "http://localhost:3001";
  const shortUrl = `${baseUrl}/${result.shortCode}`;

  return reply.status(201).send({
    success: true,
    data: {
      shortCode: result.shortCode,
      shortUrl,
      targetUrl,
      isCustomAlias: !!customAlias,
      expiresAt: result.link?.expiresAt || null,
      createdAt: result.link?.createdAt,
    },
  });
}

/**
 * GET /:code - Redirect to target URL
 */
async function redirectHandler(
  request: FastifyRequest<{ Params: { code: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { code } = request.params;

  // Validate code format (basic check)
  if (!code || code.length < 3 || code.length > 32) {
    return reply.status(400).send({
      success: false,
      error: "Invalid short code format",
    });
  }

  const link = await getLinkByCode(code);

  if (!link) {
    return reply.status(404).send({
      success: false,
      error: "Link not found or expired",
    });
  }

  // Record click (fire-and-forget for low latency)
  const ipHash = request.ip
    ? createHash("sha256").update(request.ip).digest("hex").slice(0, 16)
    : undefined;

  recordClick(link.id, {
    ipHash,
    userAgent: request.headers["user-agent"],
    referer: request.headers.referer,
  });

  // Determine redirect type: 301 for permanent, 302 for temporary/conditional
  const isPermanent = !link.expiresAt && !link.maxClicks;
  const statusCode = isPermanent ? 301 : 302;

  return reply.redirect(statusCode, link.targetUrl);
}

/**
 * GET /links/check?alias=xxx - Check alias availability
 */
async function checkAliasHandler(
  request: FastifyRequest<{ Querystring: CheckAliasQuery }>,
  reply: FastifyReply
): Promise<void> {
  const parseResult = checkAliasSchema.safeParse(request.query);
  if (!parseResult.success) {
    return reply.status(400).send({
      success: false,
      error: "Invalid alias parameter",
      details: parseResult.error.flatten().fieldErrors,
    });
  }

  const { alias } = parseResult.data;
  const result = await checkAliasAvailability(alias);

  return reply.status(200).send({
    success: true,
    data: {
      alias,
      available: result.available,
      reason: result.reason || null,
    },
  });
}

// ============================================================================
// Route Registration
// ============================================================================

export async function linksRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /links - Create new short link (optional auth - anonymous or authenticated)
  fastify.post("/links", {
    preHandler: optionalAuth,
    schema: {
      description: "Create a new shortened URL",
      tags: ["links"],
      security: [{ bearerAuth: [] }, {}],
      body: {
        type: "object",
        required: ["targetUrl"],
        properties: {
          targetUrl: { type: "string", description: "URL to shorten" },
          customAlias: { type: "string", description: "Optional custom alias" },
          expiresAt: { type: "string", format: "date-time", description: "Expiration date" },
          maxClicks: { type: "integer", description: "Maximum number of clicks" },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                shortCode: { type: "string" },
                shortUrl: { type: "string" },
                targetUrl: { type: "string" },
                isCustomAlias: { type: "boolean" },
                expiresAt: { type: "string", nullable: true },
                createdAt: { type: "string" },
              },
            },
          },
        },
      },
    },
    handler: createLinkHandler,
  });

  // GET /links/check - Check alias availability (must be before /:code)
  fastify.get("/links/check", {
    schema: {
      description: "Check if a custom alias is available",
      tags: ["links"],
      querystring: {
        type: "object",
        required: ["alias"],
        properties: {
          alias: { type: "string", description: "Alias to check" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                alias: { type: "string" },
                available: { type: "boolean" },
                reason: { type: "string", nullable: true },
              },
            },
          },
        },
      },
    },
    handler: checkAliasHandler,
  });

  // GET /:code - Redirect to target URL
  fastify.get("/:code", {
    schema: {
      description: "Redirect to the target URL for a short code",
      tags: ["redirect"],
      params: {
        type: "object",
        required: ["code"],
        properties: {
          code: { type: "string", description: "Short code or custom alias" },
        },
      },
      response: {
        301: { type: "null", description: "Permanent redirect" },
        302: { type: "null", description: "Temporary redirect" },
        404: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            error: { type: "string" },
          },
        },
      },
    },
    handler: redirectHandler,
  });

  logger.info("Links routes registered");
}
