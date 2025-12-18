/**
 * Cache Package Exports
 *
 * Provides a unified interface for caching operations.
 * Uses Redis for distributed caching across services.
 *
 * @see apps/redirect/CACHE_DESIGN.md for cache design documentation
 */

export { RedisCache, createRedisCache } from "./cache.js";
export { createRedisClient, type RedisClientOptions } from "./client.js";
export type { CacheClient, CachedLinkData } from "./types.js";
