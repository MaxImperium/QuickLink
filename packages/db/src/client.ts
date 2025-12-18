/**
 * Prisma Client Singleton
 *
 * Ensures a single database connection pool is reused across
 * the application, especially important in serverless environments.
 *
 * Usage:
 * ```ts
 * import { prisma } from "@quicklink/db";
 * const link = await prisma.link.findUnique({ where: { shortCode } });
 * ```
 */

import { PrismaClient } from "@prisma/client";

// Declare global type for development hot-reload
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

/**
 * Create Prisma client instance with logging configuration
 */
function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

/**
 * Singleton Prisma client instance
 *
 * In development, we store the client on globalThis to prevent
 * multiple instances during hot-reload.
 */
export const prisma: PrismaClient =
  globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}

/**
 * Gracefully disconnect from database
 */
export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Check database connectivity
 */
export async function checkDbConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
