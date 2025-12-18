/**
 * Cache Type Definitions
 */

export interface CacheConfig {
  url: string;
  keyPrefix?: string;
  defaultTTL?: number;
}

export interface CacheClient {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  ping(): Promise<boolean>;
  disconnect(): Promise<void>;
}

/**
 * Cached link data for redirect lookups
 * Minimal structure for fast cache operations
 *
 * @see apps/redirect/CACHE_DESIGN.md
 */
export interface CachedLinkData {
  /** Target URL to redirect to */
  url: string;
  /** Whether to use 301 (permanent) or 302 (temporary) redirect */
  permanent: boolean;
  /** Unix timestamp when cached */
  cachedAt: number;
}
