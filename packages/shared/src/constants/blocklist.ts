/**
 * Short Code Blocklist
 *
 * Reserved codes that cannot be used as short codes or custom aliases.
 *
 * Categories:
 * 1. System routes - Used by our services
 * 2. Common words - Could cause confusion
 * 3. Brand names - Legal protection
 * 4. Profanity - Content policy (basic list, extend as needed)
 */

/**
 * System routes used by QuickLink services
 */
const SYSTEM_ROUTES = [
  // Health & monitoring
  "health",
  "ready",
  "live",
  "metrics",
  "status",
  "ping",

  // API routes
  "api",
  "v1",
  "v2",
  "graphql",
  "webhook",
  "webhooks",

  // Auth routes
  "login",
  "logout",
  "signup",
  "signin",
  "signout",
  "register",
  "auth",
  "oauth",
  "sso",
  "callback",

  // User routes
  "admin",
  "dashboard",
  "account",
  "profile",
  "settings",
  "user",
  "users",
  "me",

  // Link management
  "links",
  "link",
  "create",
  "new",
  "edit",
  "delete",
  "shorten",

  // Static assets
  "static",
  "assets",
  "public",
  "images",
  "img",
  "css",
  "js",
  "fonts",

  // Documentation
  "docs",
  "help",
  "support",
  "faq",
  "about",
  "terms",
  "privacy",
  "legal",

  // Common pages
  "home",
  "index",
  "app",
  "www",
  "blog",
  "news",
];

/**
 * Reserved brand names (extend based on legal requirements)
 */
const BRAND_NAMES = [
  // Major tech companies
  "google",
  "facebook",
  "meta",
  "twitter",
  "x",
  "instagram",
  "tiktok",
  "youtube",
  "amazon",
  "apple",
  "microsoft",
  "github",
  "linkedin",
  "reddit",
  "discord",
  "slack",
  "zoom",

  // URL shorteners (competitors)
  "bitly",
  "bit",
  "tinyurl",
  "tiny",
  "shorturl",
  "rebrand",
  "ow",
  "goo",
  "is",
  "tco",

  // Our brand
  "quicklink",
  "quick",
  "ql",
];

/**
 * Confusing or problematic codes
 */
const PROBLEMATIC_CODES = [
  // Could be confused with null/empty
  "null",
  "undefined",
  "none",
  "empty",
  "void",
  "nil",

  // Boolean-like
  "true",
  "false",
  "yes",
  "no",

  // Error-like
  "error",
  "err",
  "fail",
  "failed",
  "invalid",
  "404",
  "500",

  // Test/dev
  "test",
  "testing",
  "dev",
  "debug",
  "demo",
  "example",
  "sample",
  "temp",
  "tmp",
];

/**
 * Basic profanity filter (extend with comprehensive list in production)
 * This is a minimal starter list - use a proper profanity library in production
 */
const PROFANITY_BASIC = [
  // Keeping this minimal and family-friendly in the codebase
  // In production, integrate with a profanity filtering service/library
  "fuck",
  "shit",
  "ass",
  "damn",
  "hell",
  "crap",
  "dick",
  "cock",
  "pussy",
  "bitch",
  "bastard",
  "slut",
  "whore",
  // Add more as needed via configuration
];

/**
 * Combined blocklist as a Set for O(1) lookup
 */
export const SHORTCODE_BLOCKLIST: Set<string> = new Set([
  ...SYSTEM_ROUTES,
  ...BRAND_NAMES,
  ...PROBLEMATIC_CODES,
  ...PROFANITY_BASIC,
].map((s) => s.toLowerCase()));

/**
 * Check if a string contains any blocked word as a substring
 * More aggressive filtering for custom aliases
 *
 * @param str - String to check
 * @returns true if contains blocked content
 */
export function containsBlockedContent(str: string): boolean {
  const normalized = str.toLowerCase();

  // Check exact match first
  if (SHORTCODE_BLOCKLIST.has(normalized)) {
    return true;
  }

  // Check if contains profanity as substring
  for (const word of PROFANITY_BASIC) {
    if (normalized.includes(word)) {
      return true;
    }
  }

  return false;
}

/**
 * Get the count of blocked codes (for monitoring/stats)
 */
export function getBlocklistSize(): number {
  return SHORTCODE_BLOCKLIST.size;
}
