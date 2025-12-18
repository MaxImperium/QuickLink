/**
 * @quicklink/db - Database Package
 *
 * Exports Prisma client and TypeScript types for database operations.
 *
 * Usage:
 * ```ts
 * import { prisma, Link, LinkLifecycleState } from "@quicklink/db";
 *
 * const link = await prisma.link.findUnique({
 *   where: { shortCode: "abc123" }
 * });
 * ```
 */

// Prisma client
export * from "./client.js";

// TypeScript types (for use without Prisma imports)
export * from "./types.js";
