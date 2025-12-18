/**
 * Redis Client Factory
 *
 * Creates and configures Redis client instances using ioredis.
 */

import Redis from "ioredis";

export interface RedisClientOptions {
  /** Redis connection URL */
  url: string;
  /** Connection timeout in ms (default: 5000) */
  connectTimeout?: number;
  /** Command timeout in ms (default: 1000) */
  commandTimeout?: number;
  /** Max retries per request (default: 3) */
  maxRetries?: number;
}

/**
 * Create a configured Redis client
 */
export function createRedisClient(options: RedisClientOptions): Redis {
  const {
    url,
    connectTimeout = 5000,
    commandTimeout = 1000,
    maxRetries = 3,
  } = options;

  const client = new Redis(url, {
    // Connection settings
    connectTimeout,
    commandTimeout,
    maxRetriesPerRequest: maxRetries,

    // Performance tunings
    enableReadyCheck: true,
    enableOfflineQueue: false, // Fail fast when disconnected

    // Reconnection strategy
    retryStrategy: (times) => {
      if (times > 5) return null; // Stop retrying after 5 attempts
      return Math.min(times * 100, 2000); // Exponential backoff, max 2s
    },
  });

  // Log connection events in development
  if (process.env.NODE_ENV === "development") {
    client.on("connect", () => console.log("[redis] Connected"));
    client.on("error", (err) => console.error("[redis] Error:", err.message));
    client.on("close", () => console.log("[redis] Connection closed"));
  }

  return client;
}
