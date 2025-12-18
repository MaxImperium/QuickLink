/**
 * Redis Cache Abstraction
 *
 * Type-safe wrapper around Redis operations for link caching.
 *
 * Key Schema (from CACHE_DESIGN.md):
 *   ql:v1:link:{shortCode} - Active link data
 *   ql:v1:404:{shortCode}  - Negative cache for 404s
 *
 * @see apps/redirect/CACHE_DESIGN.md for complete design
 */

import type Redis from "ioredis";
import { createRedisClient, type RedisClientOptions } from "./client.js";
import type { CacheClient, CachedLinkData } from "./types.js";

// Key prefixes following CACHE_DESIGN.md schema
const LINK_KEY_PREFIX = "ql:v1:link:";
const NOT_FOUND_KEY_PREFIX = "ql:v1:404:";

// Default TTLs (seconds)
const DEFAULT_LINK_TTL = 3600; // 1 hour
const DEFAULT_NOT_FOUND_TTL = 300; // 5 minutes

/**
 * Redis-based cache implementation for QuickLink
 */
export class RedisCache implements CacheClient {
  private client: Redis;
  private defaultTTL: number;

  constructor(client: Redis, defaultTTL = DEFAULT_LINK_TTL) {
    this.client = client;
    this.defaultTTL = defaultTTL;
  }

  // =========================================================================
  // Generic Cache Operations
  // =========================================================================

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.client.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const seconds = ttl ?? this.defaultTTL;
    await this.client.setex(key, seconds, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === "PONG";
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }

  // =========================================================================
  // Link-Specific Operations
  // =========================================================================

  /**
   * Get cached link data by short code
   */
  async getLink(shortCode: string): Promise<CachedLinkData | null> {
    return this.get<CachedLinkData>(`${LINK_KEY_PREFIX}${shortCode}`);
  }

  /**
   * Cache link data with TTL jitter to prevent stampede
   *
   * Jitter: ±8% randomization to spread out cache expiration
   * @see CACHE_DESIGN.md Section 2: TTL Strategy
   */
  async setLink(shortCode: string, data: CachedLinkData, ttl?: number): Promise<void> {
    const baseTTL = ttl ?? this.defaultTTL;
    // Add ±8% jitter to prevent cache stampede
    const jitter = baseTTL * 0.08 * (Math.random() * 2 - 1);
    const finalTTL = Math.floor(baseTTL + jitter);
    await this.set(`${LINK_KEY_PREFIX}${shortCode}`, data, finalTTL);
  }

  /**
   * Delete cached link (for invalidation)
   */
  async deleteLink(shortCode: string): Promise<void> {
    await this.del(`${LINK_KEY_PREFIX}${shortCode}`);
  }

  /**
   * Check if a code is in negative cache (known 404)
   */
  async isNotFound(shortCode: string): Promise<boolean> {
    return this.exists(`${NOT_FOUND_KEY_PREFIX}${shortCode}`);
  }

  /**
   * Cache a 404 result to prevent repeated DB lookups
   */
  async setNotFound(shortCode: string): Promise<void> {
    await this.client.setex(
      `${NOT_FOUND_KEY_PREFIX}${shortCode}`,
      DEFAULT_NOT_FOUND_TTL,
      "1"
    );
  }

  /**
   * Clear negative cache entry (when link is created)
   */
  async clearNotFound(shortCode: string): Promise<void> {
    await this.del(`${NOT_FOUND_KEY_PREFIX}${shortCode}`);
  }
}

/**
 * Create a RedisCache instance from configuration
 */
export function createRedisCache(options: RedisClientOptions): RedisCache {
  const client = createRedisClient(options);
  return new RedisCache(client);
}
