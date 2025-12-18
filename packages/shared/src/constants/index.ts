// Shared constants
export {
  SHORTCODE_BLOCKLIST,
  containsBlockedContent,
  getBlocklistSize,
} from "./blocklist.js";

/**
 * Short Code Configuration Constants
 *
 * Single source of truth for all short code generation parameters.
 * Values are aligned with SHORTCODE_DESIGN.md specification.
 *
 * @see packages/shared/SHORTCODE_DESIGN.md
 */
export const SHORTCODE_CONFIG = {
  /**
   * Default length for auto-generated short codes.
   * 7 chars = 62^7 = ~3.5 trillion combinations.
   * Safe until ~35 billion links (1% fill rate).
   */
  DEFAULT_LENGTH: 7,

  /**
   * Base62 alphabet: 0-9A-Za-z
   * URL-safe, case-sensitive, 62 characters total.
   */
  ALPHABET: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",

  /**
   * Maximum collision retry attempts.
   * At 0.003% collision rate, probability of 5 consecutive
   * collisions is effectively zero: (0.00003)^5 ≈ 0
   */
  MAX_RETRIES: 5,

  /**
   * Custom alias constraints (user-provided short codes).
   * Stricter validation than auto-generated codes.
   */
  CUSTOM_ALIAS: {
    /** Minimum length (from SHORTCODE_DESIGN.md) */
    MIN_LENGTH: 3,

    /** Maximum length (from SHORTCODE_DESIGN.md) */
    MAX_LENGTH: 30,

    /**
     * Allowed pattern: alphanumeric, hyphens, underscores.
     * Must start and end with alphanumeric character.
     * Single character aliases are allowed.
     */
    PATTERN: /^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/,
  },
} as const;

/**
 * URL Validation Constants
 */
export const URL_CONFIG = {
  /** Maximum URL length to store */
  MAX_LENGTH: 2048,

  /** Allowed protocols */
  ALLOWED_PROTOCOLS: ["http:", "https:"] as const,

  /** Blocked domains (extend as needed) */
  BLOCKED_DOMAINS: [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
  ] as const,
} as const;
