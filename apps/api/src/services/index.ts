/**
 * QuickLink API Services
 *
 * Business logic layer for link management operations.
 */

import { prisma, type Link, LinkLifecycleState } from "@quicklink/db";
import { createRedisCache, type CachedLinkData } from "@quicklink/cache";
import {
  generateUniqueCode,
  validateCustomAlias,
  isBlockedCode,
  SHORTCODE_CONFIG,
} from "@quicklink/shared";
import { logger } from "@quicklink/logger";

// Re-export auth service
export * from "./auth.js";

// ============================================================================
// Types
// ============================================================================

export interface CreateLinkInput {
  /** Target URL to redirect to */
  targetUrl: string;
  /** Optional custom alias (validated against blocklist) */
  customAlias?: string;
  /** User ID (null for anonymous) */
  userId?: string | null;
  /** Link expiration date */
  expiresAt?: Date | null;
  /** Maximum allowed clicks (null = unlimited) */
  maxClicks?: number | null;
  /** Optional metadata JSON */
  metadata?: Record<string, unknown> | null;
}

export interface CreateLinkResult {
  success: boolean;
  link?: Link;
  shortCode?: string;
  error?: string;
  errorCode?: "ALIAS_TAKEN" | "ALIAS_BLOCKED" | "ALIAS_INVALID" | "GENERATION_FAILED" | "DB_ERROR";
}

export interface AliasCheckResult {
  available: boolean;
  reason?: "taken" | "blocked" | "invalid" | "reserved";
}

// ============================================================================
// Cache Setup
// ============================================================================

// Lazy cache initialization
let cache: ReturnType<typeof createRedisCache> | null = null;

function getCache() {
  if (!cache) {
    cache = createRedisCache({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || "0", 10),
    });
  }
  return cache;
}

// ============================================================================
// Link Service
// ============================================================================

/**
 * Check if a short code already exists in the database
 */
async function codeExistsInDb(code: string): Promise<boolean> {
  const existing = await prisma.link.findUnique({
    where: { shortCode: code },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Check if an alias is available for use
 */
export async function checkAliasAvailability(alias: string): Promise<AliasCheckResult> {
  // Validate format
  const validation = validateCustomAlias(alias);
  if (!validation.valid) {
    return { available: false, reason: "invalid" };
  }

  // Check blocklist
  if (isBlockedCode(alias)) {
    return { available: false, reason: "blocked" };
  }

  // Check reserved aliases table
  const reserved = await prisma.reservedAlias.findUnique({
    where: { alias },
    select: { id: true },
  });
  if (reserved) {
    return { available: false, reason: "reserved" };
  }

  // Check existing links
  const exists = await codeExistsInDb(alias);
  if (exists) {
    return { available: false, reason: "taken" };
  }

  return { available: true };
}

/**
 * Create a new shortened link
 */
export async function createLink(input: CreateLinkInput): Promise<CreateLinkResult> {
  const { targetUrl, customAlias, userId = null, expiresAt = null, maxClicks = null, metadata = null } = input;

  let shortCode: string;
  let isCustom = false;

  // Handle custom alias
  if (customAlias) {
    // Validate and check availability
    const availability = await checkAliasAvailability(customAlias);

    if (!availability.available) {
      const errorMap: Record<string, CreateLinkResult["errorCode"]> = {
        taken: "ALIAS_TAKEN",
        blocked: "ALIAS_BLOCKED",
        invalid: "ALIAS_INVALID",
        reserved: "ALIAS_TAKEN",
      };
      return {
        success: false,
        error: `Custom alias "${customAlias}" is not available: ${availability.reason}`,
        errorCode: errorMap[availability.reason!] || "ALIAS_INVALID",
      };
    }

    shortCode = customAlias;
    isCustom = true;
  } else {
    // Generate unique random code
    const result = await generateUniqueCode(codeExistsInDb, {
      maxRetries: SHORTCODE_CONFIG.MAX_RETRIES,
    });

    if (!result.success || !result.code) {
      logger.error("Failed to generate unique short code after max retries");
      return {
        success: false,
        error: "Failed to generate unique short code. Please try again.",
        errorCode: "GENERATION_FAILED",
      };
    }

    shortCode = result.code;
  }

  try {
    // Create link in database
    const link = await prisma.link.create({
      data: {
        shortCode,
        targetUrl,
        isCustomAlias: isCustom,
        userId: userId ? BigInt(userId) : null,
        expiresAt,
        maxClicks,
        metadata: metadata ? JSON.stringify(metadata) : null,
        lifecycleState: LinkLifecycleState.ACTIVE,
      },
    });

    // Clear negative cache if it existed
    try {
      await getCache().clearNotFound(shortCode);
    } catch (cacheErr) {
      // Non-critical, log and continue
      logger.warn({ err: cacheErr }, "Failed to clear negative cache");
    }

    logger.info({ shortCode, isCustom, userId }, "Link created successfully");

    return {
      success: true,
      link,
      shortCode,
    };
  } catch (err) {
    logger.error({ err, shortCode }, "Failed to create link in database");

    // Check for unique constraint violation
    if ((err as Error).message?.includes("Unique constraint")) {
      return {
        success: false,
        error: "Short code collision. Please try again.",
        errorCode: "ALIAS_TAKEN",
      };
    }

    return {
      success: false,
      error: "Database error while creating link",
      errorCode: "DB_ERROR",
    };
  }
}

/**
 * Get link by short code (with caching)
 */
export async function getLinkByCode(code: string): Promise<Link | null> {
  // Check negative cache first
  const redisCache = getCache();
  try {
    if (await redisCache.isNotFound(code)) {
      return null;
    }
  } catch {
    // Cache miss, continue to DB
  }

  // Check positive cache
  try {
    const cached = await redisCache.getLink(code);
    if (cached) {
      // Return minimal link object from cache for redirect
      // In a full implementation, you might fetch full link data
      // For now, we need to get from DB for complete data
    }
  } catch {
    // Cache miss, continue to DB
  }

  // Fetch from database
  const link = await prisma.link.findUnique({
    where: {
      shortCode: code,
      lifecycleState: LinkLifecycleState.ACTIVE,
      deletedAt: null,
    },
  });

  if (!link) {
    // Set negative cache
    try {
      await redisCache.setNotFound(code);
    } catch {
      // Non-critical
    }
    return null;
  }

  // Check expiration
  if (link.expiresAt && link.expiresAt < new Date()) {
    return null;
  }

  // Check max clicks
  if (link.maxClicks && link.clickCount >= link.maxClicks) {
    return null;
  }

  // Cache the result
  try {
    const cacheData: CachedLinkData = {
      url: link.targetUrl,
      permanent: !link.expiresAt && !link.maxClicks,
      cachedAt: Date.now(),
    };
    await redisCache.setLink(code, cacheData);
  } catch {
    // Non-critical
  }

  return link;
}

/**
 * Record a click event (fire-and-forget for low latency)
 */
export async function recordClick(
  linkId: bigint,
  data: {
    ipHash?: string;
    userAgent?: string;
    referer?: string;
    country?: string;
  }
): Promise<void> {
  // Fire-and-forget: Don't await for low latency redirects
  prisma.clickEvent
    .create({
      data: {
        linkId,
        ipHash: data.ipHash || null,
        userAgent: data.userAgent?.slice(0, 512) || null,
        referer: data.referer?.slice(0, 2048) || null,
        country: data.country || null,
      },
    })
    .then(() => {
      // Increment click count (also fire-and-forget)
      return prisma.link.update({
        where: { id: linkId },
        data: { clickCount: { increment: 1 } },
      });
    })
    .catch((err) => {
      logger.error({ err, linkId }, "Failed to record click event");
    });
}
