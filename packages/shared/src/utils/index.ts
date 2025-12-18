/**
 * Shared Utility Functions
 *
 * Re-exports from the shortcode module.
 * @see ./shortcode.ts for implementation details.
 */

// Generation functions
export {
  generateRandomCode,
  generateUniqueCode,
} from "./shortcode.js";

// Validation functions
export {
  validateShortCode,
  validateCustomAlias,
  isBlockedCode,
} from "./shortcode.js";

// Utility functions
export {
  encodeBase62,
  decodeBase62,
  estimateCollisionProbability,
} from "./shortcode.js";

// Types
export type {
  ValidationResult,
  ExistsChecker,
} from "./shortcode.js";
