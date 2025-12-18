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
}
