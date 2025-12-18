/**
 * Configuration Module
 *
 * Loads configuration from environment variables.
 * No validation libraries - just simple parsing with defaults.
 *
 * Design Decision: Fail fast on startup if required vars are missing.
 */

import type { Config } from "./types.js";

// =============================================================================
// Environment Parsing Helpers
// =============================================================================

/**
 * Get required environment variable or throw.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Get optional environment variable with default.
 */
function optional(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

/**
 * Parse integer with default.
 */
function optionalInt(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

// =============================================================================
// Configuration Loading
// =============================================================================

/**
 * Load configuration from environment.
 * Call once at startup.
 *
 * @returns Validated configuration object
 * @throws Error if required variables are missing
 */
export function loadConfig(): Config {
  return {
    // Server
    port: optionalInt("PORT", 3002),
    host: optional("HOST", "0.0.0.0"),

    // Redis
    redisUrl: required("REDIS_URL"),
    redisTimeoutMs: optionalInt("REDIS_TIMEOUT_MS", 50),

    // Database
    databaseUrl: required("DATABASE_URL"),
    dbTimeoutMs: optionalInt("DB_TIMEOUT_MS", 100),

    // Cache TTL
    cacheTtlSeconds: optionalInt("CACHE_TTL_SECONDS", 3600),
    notFoundTtlSeconds: optionalInt("NOT_FOUND_TTL_SECONDS", 300),

    // Logging
    logLevel: parseLogLevel(optional("LOG_LEVEL", "warn")),
  };
}

/**
 * Parse log level string to enum.
 */
function parseLogLevel(level: string): Config["logLevel"] {
  const normalized = level.toLowerCase();
  if (["debug", "info", "warn", "error"].includes(normalized)) {
    return normalized as Config["logLevel"];
  }
  return "warn";
}

/**
 * Validate configuration at runtime.
 * Logs warnings for suboptimal settings.
 */
export function validateConfig(config: Config): void {
  // Warn if timeouts are too high
  if (config.redisTimeoutMs > 100) {
    console.warn(
      `[config] REDIS_TIMEOUT_MS=${config.redisTimeoutMs}ms is high. Consider <=50ms for low latency.`
    );
  }

  if (config.dbTimeoutMs > 200) {
    console.warn(
      `[config] DB_TIMEOUT_MS=${config.dbTimeoutMs}ms is high. Consider <=100ms for low latency.`
    );
  }

  // Warn if cache TTL is too short
  if (config.cacheTtlSeconds < 60) {
    console.warn(
      `[config] CACHE_TTL_SECONDS=${config.cacheTtlSeconds}s is short. This may cause high DB load.`
    );
  }
}
