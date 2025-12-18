/**
 * Prisma Client Singleton with Connection Pooling Support
 *
 * Ensures a single database connection pool is reused across
 * the application, especially important in serverless environments.
 *
 * Connection Pooling Strategy:
 * - Development: Direct PostgreSQL connection
 * - Production: PgBouncer for connection pooling (port 6432)
 *
 * Read Replica Support:
 * - Use `prismaReplica` for read-heavy operations (analytics, reports)
 * - Use `prisma` for writes and real-time reads
 *
 * Environment Variables:
 * - DATABASE_URL: Primary database URL (for writes)
 * - DATABASE_REPLICA_URL: Read replica URL (optional)
 * - DATABASE_POOL_URL: PgBouncer URL (for production pooling)
 *
 * Usage:
 * ```ts
 * import { prisma, prismaReplica, withReadReplica } from "@quicklink/db";
 *
 * // Write operation
 * const link = await prisma.link.create({ data: {...} });
 *
 * // Read operation (uses replica if available)
 * const stats = await withReadReplica(client =>
 *   client.clickEvent.count({ where: { linkId } })
 * );
 * ```
 */

import { PrismaClient } from "@prisma/client";

// =============================================================================
// Types
// =============================================================================

/**
 * Connection pool configuration
 */
interface PoolConfig {
  /** Maximum connections in pool */
  connectionLimit?: number;
  /** Pool timeout in milliseconds */
  poolTimeout?: number;
  /** Connection timeout in milliseconds */
  connectTimeout?: number;
}

/**
 * Database metrics for monitoring
 */
export interface DbMetrics {
  totalQueries: number;
  slowQueries: number;
  errors: number;
  avgQueryTimeMs: number;
}

// =============================================================================
// Global State
// =============================================================================

// Declare global type for development hot-reload
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __prismaReplica: PrismaClient | undefined;
}

// Metrics tracking
const metrics: DbMetrics = {
  totalQueries: 0,
  slowQueries: 0,
  errors: 0,
  avgQueryTimeMs: 0,
};

// Slow query threshold (ms)
const SLOW_QUERY_THRESHOLD_MS = 100;

// =============================================================================
// Client Factory
// =============================================================================

/**
 * Get database URL with pooling support
 *
 * Priority:
 * 1. DATABASE_POOL_URL (PgBouncer)
 * 2. DATABASE_URL (direct connection)
 */
function getDatabaseUrl(): string {
  // In production, prefer pooled connection
  if (process.env.NODE_ENV === "production" && process.env.DATABASE_POOL_URL) {
    return process.env.DATABASE_POOL_URL;
  }
  return process.env.DATABASE_URL || "postgresql://quicklink:quicklink@localhost:5432/quicklink";
}

/**
 * Get read replica URL if available
 */
function getReplicaUrl(): string | null {
  return process.env.DATABASE_REPLICA_URL || null;
}

/**
 * Parse pool configuration from DATABASE_URL query params or environment
 */
function getPoolConfig(): PoolConfig {
  return {
    connectionLimit: parseInt(process.env.DATABASE_CONNECTION_LIMIT || "10", 10),
    poolTimeout: parseInt(process.env.DATABASE_POOL_TIMEOUT || "10000", 10),
    connectTimeout: parseInt(process.env.DATABASE_CONNECT_TIMEOUT || "5000", 10),
  };
}

/**
 * Create Prisma client instance with logging and metrics
 */
function createPrismaClient(datasourceUrl?: string): PrismaClient {
  const client = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? [
            { level: "query", emit: "event" },
            { level: "error", emit: "stdout" },
            { level: "warn", emit: "stdout" },
          ]
        : [{ level: "error", emit: "stdout" }],
    datasourceUrl: datasourceUrl || getDatabaseUrl(),
  });

  // Add query timing middleware
  client.$use(async (params, next) => {
    const start = Date.now();
    try {
      const result = await next(params);
      const duration = Date.now() - start;

      // Update metrics
      metrics.totalQueries++;
      metrics.avgQueryTimeMs =
        (metrics.avgQueryTimeMs * (metrics.totalQueries - 1) + duration) /
        metrics.totalQueries;

      if (duration > SLOW_QUERY_THRESHOLD_MS) {
        metrics.slowQueries++;
        if (process.env.NODE_ENV === "development") {
          console.warn(
            `[db] Slow query (${duration}ms): ${params.model}.${params.action}`
          );
        }
      }

      return result;
    } catch (error) {
      metrics.errors++;
      throw error;
    }
  });

  return client;
}

// =============================================================================
// Singleton Instances
// =============================================================================

/**
 * Primary Prisma client instance (for writes and real-time reads)
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
 * Read replica Prisma client (for analytics and reports)
 *
 * Falls back to primary if no replica is configured.
 */
export const prismaReplica: PrismaClient = (() => {
  const replicaUrl = getReplicaUrl();

  if (!replicaUrl) {
    // No replica configured, use primary
    return prisma;
  }

  if (globalThis.__prismaReplica) {
    return globalThis.__prismaReplica;
  }

  const replica = createPrismaClient(replicaUrl);

  if (process.env.NODE_ENV !== "production") {
    globalThis.__prismaReplica = replica;
  }

  return replica;
})();

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Execute a read operation, using replica if available
 *
 * Automatically routes read queries to the replica for load distribution.
 *
 * @example
 * ```ts
 * const count = await withReadReplica(client =>
 *   client.clickEvent.count({ where: { linkId: 123 } })
 * );
 * ```
 */
export async function withReadReplica<T>(
  operation: (client: PrismaClient) => Promise<T>
): Promise<T> {
  return operation(prismaReplica);
}

/**
 * Execute a write operation (always uses primary)
 *
 * Explicit helper for clarity in code that mixes reads and writes.
 */
export async function withPrimary<T>(
  operation: (client: PrismaClient) => Promise<T>
): Promise<T> {
  return operation(prisma);
}

/**
 * Execute a transaction (always uses primary)
 *
 * Wraps Prisma's $transaction with explicit primary connection.
 */
export async function transaction<T>(
  fn: (tx: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => Promise<T>
): Promise<T> {
  return prisma.$transaction(fn);
}

// =============================================================================
// Lifecycle
// =============================================================================

/**
 * Gracefully disconnect from database
 */
export async function disconnectDb(): Promise<void> {
  await Promise.all([
    prisma.$disconnect(),
    prismaReplica !== prisma ? prismaReplica.$disconnect() : Promise.resolve(),
  ]);
}

/**
 * Check database connectivity
 *
 * @param checkReplica - Also check replica connection
 */
export async function checkDbConnection(checkReplica = false): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;

    if (checkReplica && prismaReplica !== prisma) {
      await prismaReplica.$queryRaw`SELECT 1`;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Get database connection metrics
 */
export function getDbMetrics(): DbMetrics {
  return { ...metrics };
}

/**
 * Reset metrics (for testing)
 */
export function resetDbMetrics(): void {
  metrics.totalQueries = 0;
  metrics.slowQueries = 0;
  metrics.errors = 0;
  metrics.avgQueryTimeMs = 0;
}

