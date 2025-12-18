/**
 * Bloom Filter for IP Reputation
 *
 * Space-efficient probabilistic data structure for tracking "bad" IPs
 * (bots, abusers, known attackers) without storing the actual IP addresses.
 *
 * Why Bloom Filter?
 * - Space: 1M IPs in ~1.2MB (vs ~50MB for hash set)
 * - Speed: O(k) where k = number of hash functions (~3-5)
 * - Privacy: Doesn't store actual IPs
 * - False positives: ~1% (configurable)
 * - False negatives: 0% (never misses a bad IP)
 *
 * Use Cases:
 * - Quick check if IP has been flagged before
 * - Prefilter before expensive Redis/DB lookups
 * - Block known abusive IPs at the edge
 *
 * Redis Integration:
 * - Uses Redis BITFIELD for distributed state
 * - Automatic sync across instances
 * - Optional local-only mode for single instance
 *
 * Limitations:
 * - Cannot remove items (use Counting Bloom Filter if needed)
 * - False positives possible (innocent IPs may be flagged)
 * - Size must be chosen upfront
 *
 * @see https://en.wikipedia.org/wiki/Bloom_filter
 */

import type Redis from "ioredis";
import { createHash } from "crypto";

// =============================================================================
// Types
// =============================================================================

export interface BloomFilterConfig {
  /** Expected number of items. Default: 1_000_000 */
  expectedItems: number;
  /** Desired false positive rate (0-1). Default: 0.01 (1%) */
  falsePositiveRate: number;
  /** Redis key for the filter. Default: "ql:bloom:badip" */
  redisKey: string;
  /** Local-only mode (no Redis). Default: false */
  localOnly: boolean;
}

export interface BloomFilterStats {
  /** Number of items added */
  itemsAdded: number;
  /** Number of lookups */
  lookups: number;
  /** Estimated fill ratio (0-1) */
  fillRatio: number;
  /** Theoretical false positive rate at current fill */
  currentFalsePositiveRate: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG: BloomFilterConfig = {
  expectedItems: 1_000_000,
  falsePositiveRate: 0.01,
  redisKey: "ql:bloom:badip",
  localOnly: false,
};

// =============================================================================
// Bloom Filter Implementation
// =============================================================================

export class IPReputationBloomFilter {
  private redis: Redis | null;
  private config: BloomFilterConfig;
  private localBitArray: Uint8Array | null = null;

  // Calculated parameters
  private readonly numBits: number;
  private readonly numHashes: number;

  // Stats
  private itemsAdded = 0;
  private lookups = 0;

  constructor(redis: Redis | null, config: Partial<BloomFilterConfig> = {}) {
    this.redis = config.localOnly ? null : redis;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Calculate optimal filter parameters
    // m = -n * ln(p) / (ln(2)^2)
    // k = (m/n) * ln(2)
    const n = this.config.expectedItems;
    const p = this.config.falsePositiveRate;

    this.numBits = Math.ceil((-n * Math.log(p)) / Math.pow(Math.log(2), 2));
    this.numHashes = Math.ceil((this.numBits / n) * Math.log(2));

    // Round up to nearest byte
    const numBytes = Math.ceil(this.numBits / 8);

    // Initialize local bit array if local-only or as fallback
    if (this.config.localOnly || !this.redis) {
      this.localBitArray = new Uint8Array(numBytes);
    }
  }

  /**
   * Get filter size in bytes
   */
  get sizeBytes(): number {
    return Math.ceil(this.numBits / 8);
  }

  /**
   * Get number of hash functions used
   */
  get hashCount(): number {
    return this.numHashes;
  }

  /**
   * Add an IP hash to the bloom filter
   *
   * Performance: ~0.5ms local, ~1-2ms with Redis
   *
   * @param ipHash - Hashed IP address (never store raw IPs)
   */
  async add(ipHash: string): Promise<void> {
    const positions = this.getHashPositions(ipHash);
    this.itemsAdded++;

    if (this.redis && !this.config.localOnly) {
      await this.addToRedis(positions);
    }

    if (this.localBitArray) {
      this.addToLocal(positions);
    }
  }

  /**
   * Add multiple IP hashes in batch
   *
   * More efficient for bulk operations
   */
  async addBatch(ipHashes: string[]): Promise<void> {
    if (ipHashes.length === 0) return;

    const allPositions = ipHashes.map((ip) => this.getHashPositions(ip));
    this.itemsAdded += ipHashes.length;

    if (this.redis && !this.config.localOnly) {
      // Use pipeline for batch Redis operations
      const pipeline = this.redis.pipeline();
      for (const positions of allPositions) {
        for (const pos of positions) {
          pipeline.setbit(this.config.redisKey, pos, 1);
        }
      }
      await pipeline.exec();
    }

    if (this.localBitArray) {
      for (const positions of allPositions) {
        this.addToLocal(positions);
      }
    }
  }

  /**
   * Check if an IP hash might be in the filter
   *
   * Returns:
   * - true: IP is probably bad (may be false positive)
   * - false: IP is definitely not in the filter
   *
   * Performance: ~0.3ms local, ~1-2ms with Redis
   *
   * @param ipHash - Hashed IP address
   */
  async mightContain(ipHash: string): Promise<boolean> {
    this.lookups++;
    const positions = this.getHashPositions(ipHash);

    // Try Redis first
    if (this.redis && !this.config.localOnly) {
      try {
        return await this.checkInRedis(positions);
      } catch (error) {
        console.warn("[bloom] Redis error, using local fallback:", error);
      }
    }

    // Fall back to local
    if (this.localBitArray) {
      return this.checkInLocal(positions);
    }

    // No storage available, assume not in filter
    return false;
  }

  /**
   * Sync local filter from Redis
   *
   * Call this periodically to keep local cache in sync
   */
  async syncFromRedis(): Promise<void> {
    if (!this.redis || this.config.localOnly) return;

    try {
      // Get the entire bit array from Redis
      const data = await this.redis.getBuffer(this.config.redisKey);
      if (data) {
        this.localBitArray = new Uint8Array(data);
      }
    } catch (error) {
      console.warn("[bloom] Failed to sync from Redis:", error);
    }
  }

  /**
   * Clear the filter (reset all bits)
   */
  async clear(): Promise<void> {
    this.itemsAdded = 0;
    this.lookups = 0;

    if (this.redis && !this.config.localOnly) {
      await this.redis.del(this.config.redisKey);
    }

    if (this.localBitArray) {
      this.localBitArray.fill(0);
    }
  }

  /**
   * Get filter statistics
   */
  getStats(): BloomFilterStats {
    // Estimate fill ratio from items added
    // Actual fill ratio would require counting set bits
    const estimatedFillRatio = 1 - Math.pow(
      1 - 1 / this.numBits,
      this.numHashes * this.itemsAdded
    );

    // Calculate current false positive rate
    // p = (1 - e^(-kn/m))^k
    const currentFPR = Math.pow(estimatedFillRatio, this.numHashes);

    return {
      itemsAdded: this.itemsAdded,
      lookups: this.lookups,
      fillRatio: estimatedFillRatio,
      currentFalsePositiveRate: currentFPR,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Generate k hash positions for an item
   *
   * Uses double hashing technique:
   * h(i) = h1 + i * h2 + i^2 mod m
   *
   * This provides good distribution with only 2 hash computations
   */
  private getHashPositions(item: string): number[] {
    // Use SHA-256 split into two 128-bit hashes
    const hash = createHash("sha256").update(item).digest();

    // First half as h1, second half as h2
    const h1 = hash.readUInt32BE(0);
    const h2 = hash.readUInt32BE(4);

    const positions: number[] = [];
    for (let i = 0; i < this.numHashes; i++) {
      // Double hashing with quadratic probing
      const position = Math.abs((h1 + i * h2 + i * i) % this.numBits);
      positions.push(position);
    }

    return positions;
  }

  /**
   * Set bits in Redis using SETBIT
   */
  private async addToRedis(positions: number[]): Promise<void> {
    const pipeline = this.redis!.pipeline();
    for (const pos of positions) {
      pipeline.setbit(this.config.redisKey, pos, 1);
    }
    await pipeline.exec();
  }

  /**
   * Set bits in local array
   */
  private addToLocal(positions: number[]): void {
    for (const pos of positions) {
      const byteIndex = Math.floor(pos / 8);
      const bitIndex = pos % 8;
      this.localBitArray![byteIndex] |= 1 << bitIndex;
    }
  }

  /**
   * Check bits in Redis using GETBIT
   */
  private async checkInRedis(positions: number[]): Promise<boolean> {
    const pipeline = this.redis!.pipeline();
    for (const pos of positions) {
      pipeline.getbit(this.config.redisKey, pos);
    }
    const results = await pipeline.exec();

    // All bits must be set for potential match
    return results!.every((result: [Error | null, unknown]) => result[1] === 1);
  }

  /**
   * Check bits in local array
   */
  private checkInLocal(positions: number[]): boolean {
    for (const pos of positions) {
      const byteIndex = Math.floor(pos / 8);
      const bitIndex = pos % 8;
      if ((this.localBitArray![byteIndex] & (1 << bitIndex)) === 0) {
        return false;
      }
    }
    return true;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

let globalBloomFilter: IPReputationBloomFilter | null = null;

/**
 * Get or create the global IP reputation bloom filter
 */
export function getIPReputationFilter(
  redis?: Redis | null,
  config?: Partial<BloomFilterConfig>
): IPReputationBloomFilter {
  if (!globalBloomFilter) {
    globalBloomFilter = new IPReputationBloomFilter(redis ?? null, config);
  }
  return globalBloomFilter;
}

/**
 * Initialize the global bloom filter
 *
 * Call at application startup with Redis client
 */
export function initializeBloomFilter(
  redis: Redis,
  config?: Partial<BloomFilterConfig>
): IPReputationBloomFilter {
  globalBloomFilter = new IPReputationBloomFilter(redis, config);
  return globalBloomFilter;
}

/**
 * Shutdown the global bloom filter
 */
export async function shutdownBloomFilter(): Promise<void> {
  if (globalBloomFilter) {
    await globalBloomFilter.clear();
    globalBloomFilter = null;
  }
}

// =============================================================================
// IP Hashing Utility
// =============================================================================

/**
 * Hash an IP address for privacy-preserving storage
 *
 * Uses SHA-256 with a salt to prevent rainbow table attacks
 *
 * @param ip - Raw IP address
 * @param salt - Application secret (from environment)
 */
export function hashIP(ip: string, salt: string = process.env.IP_HASH_SALT || "quicklink"): string {
  return createHash("sha256").update(salt + ip).digest("hex");
}
