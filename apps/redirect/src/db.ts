/**
 * Database Fallback Interface
 *
 * Raw SQL queries for URL lookup when cache misses.
 * Uses `pg` directly - NO ORM, NO query builder.
 *
 * Design Decisions:
 * - Raw SQL for minimal overhead (~0.1ms vs 5-15ms with Prisma)
 * - Connection pool (pg.Pool) for connection reuse
 * - Prepared statements for query plan caching
 * - Read-only operations - this service never writes to DB
 */

import type { CachedLink, Config } from "./types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Minimal pg.Pool interface (what we actually use)
 * Allows mocking without importing pg in tests
 */
interface PoolClient {
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
}

interface Pool {
  connect(): Promise<PoolClient>;
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

/**
 * Database row shape for links table
 */
interface LinkRow {
  original_url: string;
  is_permanent: boolean;
  is_active: boolean;
  expires_at: Date | null;
}

// =============================================================================
// State
// =============================================================================

let pool: Pool | null = null;
let config: Pick<Config, "databaseUrl" | "dbTimeoutMs">;

// =============================================================================
// SQL Queries
// =============================================================================

/**
 * Lookup query - optimized for speed
 * - Uses index on short_code column
 * - Selects only needed columns
 * - Filters inactive/expired links at query level
 */
const LOOKUP_QUERY = `
  SELECT original_url, is_permanent
  FROM links
  WHERE short_code = $1
    AND is_active = true
    AND deleted_at IS NULL
    AND (expires_at IS NULL OR expires_at > NOW())
  LIMIT 1
`;

/**
 * Health check query - minimal
 */
const HEALTH_QUERY = "SELECT 1";

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the database module with configuration.
 * Creates connection pool but doesn't connect yet.
 *
 * @param cfg - Configuration subset for database
 */
export async function initDb(
  cfg: Pick<Config, "databaseUrl" | "dbTimeoutMs">
): Promise<void> {
  config = cfg;

  try {
    // Dynamic import to avoid loading pg if not needed
    const { Pool } = await import("pg");

    pool = new Pool({
      connectionString: config.databaseUrl,

      // Pool sizing - keep it small, redirects are fast
      min: 2, // Minimum idle connections
      max: 10, // Maximum connections
      idleTimeoutMillis: 30000, // Close idle connections after 30s

      // Timeouts
      connectionTimeoutMillis: 2000, // Connection acquisition timeout
      statement_timeout: config.dbTimeoutMs, // Query timeout (PostgreSQL setting)
      query_timeout: config.dbTimeoutMs, // Node.js side timeout
    });

    // Verify connection works
    await pool.query(HEALTH_QUERY);
  } catch (err) {
    console.error("[db] Failed to initialize pool:", err);
    pool = null;
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Look up a short code in the database.
 *
 * Performance: Expected ~5-15ms (depends on DB latency)
 *
 * @param shortCode - The short code to look up
 * @returns CachedLink format if found, null if not found or error
 */
export async function lookup(shortCode: string): Promise<CachedLink | null> {
  if (!pool) return null;

  try {
    const result = await withTimeout(
      pool.query<LinkRow>(LOOKUP_QUERY, [shortCode]),
      config.dbTimeoutMs
    );

    if (!result || result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    // Convert to CachedLink format for cache storage
    return {
      url: row.original_url,
      permanent: row.is_permanent ?? true, // Default to permanent redirect
      cachedAt: Date.now(),
    };
  } catch (err) {
    console.error("[db] Lookup error:", err);
    return null;
  }
}

/**
 * Health check - simple query to verify connectivity.
 *
 * @returns true if database is responsive
 */
export async function ping(): Promise<boolean> {
  if (!pool) return false;

  try {
    const result = await withTimeout(
      pool.query(HEALTH_QUERY),
      config.dbTimeoutMs
    );
    return result !== null;
  } catch {
    return false;
  }
}

/**
 * Graceful shutdown - drain connection pool.
 */
export async function shutdown(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Wrap a promise with a timeout.
 * Returns null on timeout instead of throwing.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | null> {
  let timeoutId: NodeJS.Timeout;

  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), ms);
  });

  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timeoutId!);
    return result;
  } catch (err) {
    clearTimeout(timeoutId!);
    throw err;
  }
}
