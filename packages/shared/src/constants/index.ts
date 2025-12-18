// Shared constants
export {
  SHORTCODE_BLOCKLIST,
  containsBlockedContent,
  getBlocklistSize,
} from "./blocklist.js";

/**
 * Short Code Configuration Constants
 */
export const SHORTCODE_CONFIG = {
  /** Default length for auto-generated short codes */
  DEFAULT_LENGTH: 7,

  /** Minimum allowed length */
  MIN_LENGTH: 4,

  /** Maximum allowed length */
  MAX_LENGTH: 20,

  /** Characters used in Base62 encoding */
  ALPHABET: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",

  /** Maximum collision retry attempts */
  MAX_RETRIES: 10,

  /** Custom alias constraints */
  CUSTOM_ALIAS: {
    MIN_LENGTH: 3,
    MAX_LENGTH: 50,
    /** Allowed pattern: alphanumeric, hyphens, underscores */
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
