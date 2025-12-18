/**
 * @quicklink/shared - Shared Package Exports
 *
 * Central export point for shared types, utilities, and constants.
 * This is the ONLY public API for the shared package.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IMPORTANT: SINGLE SOURCE OF TRUTH
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Short code generation has ONE implementation:
 *   - Location: ./utils/shortcode.ts
 *   - Design:   ../SHORTCODE_DESIGN.md
 *
 * DO NOT create duplicate implementations or import from internal paths.
 * All shortcode functions are re-exported through this file.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CORRECT IMPORT PATH
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ✅ CORRECT:
 * ```ts
 * import { generateUniqueCode, validateCustomAlias } from "@quicklink/shared";
 * ```
 *
 * ❌ WRONG (deep imports):
 * ```ts
 * import { generateUniqueCode } from "@quicklink/shared/utils/shortcode";
 * ```
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Types (LinkData, CachedLink, ApiResponse, etc.)
export * from "./types/index.js";

// Utilities (short code generation, validation, Base62 encoding)
export * from "./utils/index.js";

// Constants (SHORTCODE_CONFIG, URL_CONFIG, blocklist)
export * from "./constants/index.js";
