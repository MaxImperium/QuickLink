/**
 * @quicklink/logger - Structured Logging Package
 *
 * Provides consistent structured logging across all QuickLink services.
 * Uses pino for high-performance JSON logging.
 *
 * Usage:
 * ```ts
 * import { logger, createLogger } from "@quicklink/logger";
 *
 * // Use default logger
 * logger.info({ userId: "123" }, "User logged in");
 *
 * // Create service-specific logger
 * const apiLogger = createLogger("api");
 * apiLogger.error({ err }, "Request failed");
 * ```
 */

import pino from "pino";

// ============================================================================
// Configuration
// ============================================================================

const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const NODE_ENV = process.env.NODE_ENV || "development";
const SERVICE_NAME = process.env.SERVICE_NAME || "quicklink";

// ============================================================================
// Logger Factory
// ============================================================================

/**
 * Create a logger instance for a specific service/component
 */
export function createLogger(name: string): pino.Logger {
  return pino({
    name: `${SERVICE_NAME}:${name}`,
    level: LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    transport:
      NODE_ENV === "development"
        ? {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:standard",
              ignore: "pid,hostname",
            },
          }
        : undefined,
    base: {
      service: name,
      env: NODE_ENV,
    },
  });
}

// ============================================================================
// Default Logger Instance
// ============================================================================

/**
 * Default logger for general use
 */
export const logger = createLogger("main");

// ============================================================================
// Log Level Helpers
// ============================================================================

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Check if a log level is enabled
 */
export function isLevelEnabled(level: LogLevel): boolean {
  return logger.isLevelEnabled(level);
}

// Re-export pino types for consumers
export type { Logger } from "pino";
