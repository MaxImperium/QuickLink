/**
 * Short Code Generation Module
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SINGLE SOURCE OF TRUTH
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This file is the ONLY implementation of short code generation in QuickLink.
 * Any other shortcode.ts files are legacy duplicates and should be deleted.
 *
 * Canonical location: packages/shared/src/utils/shortcode.ts
 * Design document:    packages/shared/SHORTCODE_DESIGN.md
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RESPONSIBILITIES                                                        │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ 1. GENERATION  - Random Base62 code creation                           │
 * │ 2. VALIDATION  - Format and blocklist checking                         │
 * │ 3. UTILITIES   - Base62 encoding/decoding helpers                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Strategy: Random Base62
 * - Length: 7 characters (62^7 = ~3.5 trillion combinations)
 * - Alphabet: 0-9A-Za-z (62 URL-safe characters)
 * - Collision handling: Blocklist check → DB check → Retry (max 5)
 *
 * Why Cryptographic Randomness?
 * - Unpredictable: Cannot enumerate or guess valid short codes
 * - Secure: No information leakage about link creation order
 * - Distributed: No coordination needed between servers
 *
 * Why Retry on Collision?
 * - At 100M links, collision probability is ~0.003% per generation
 * - 5 consecutive collisions probability: (0.00003)^5 ≈ 0
 * - Simpler than distributed ID generation (Snowflake, etc.)
 *
 * @see SHORTCODE_DESIGN.md for full specification
 */

import { webcrypto } from "node:crypto";
import { SHORTCODE_CONFIG } from "../constants/index.js";
import { SHORTCODE_BLOCKLIST, containsBlockedContent } from "../constants/blocklist.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of a validation operation
 */
export interface ValidationResult {
  /** Whether the input is valid */
  valid: boolean;
  /** Human-readable error message if invalid */
  error?: string;
}

/**
 * Function signature for checking code existence in database
 */
export type ExistsChecker = (code: string) => Promise<boolean>;

// =============================================================================
// SECTION 1: GENERATION
// =============================================================================

/**
 * Generate a random Base62 short code.
 *
 * Uses `crypto.getRandomValues()` for cryptographically secure randomness.
 * This prevents enumeration attacks where attackers try to guess valid codes.
 *
 * @param length - Code length (default: from SHORTCODE_CONFIG)
 * @returns Random Base62 string
 *
 * @example
 * ```ts
 * const code = generateRandomCode();    // "aB3xY9k"
 * const longer = generateRandomCode(10); // "aB3xY9kM2p"
 * ```
 */
export function generateRandomCode(length: number = SHORTCODE_CONFIG.DEFAULT_LENGTH): string {
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);

  let code = "";
  for (let i = 0; i < length; i++) {
    // Map byte (0-255) to alphabet index (0-61)
    // Note: Slight bias (256 % 62 = 8) is acceptable for URL shortening
    const index = bytes[i] % SHORTCODE_CONFIG.ALPHABET.length;
    code += SHORTCODE_CONFIG.ALPHABET[index];
  }

  return code;
}

/**
 * Generate a unique short code with collision detection.
 *
 * Collision Handling Flow:
 * 1. Generate random code
 * 2. Check blocklist (fast, in-memory) → if blocked, retry
 * 3. Check database existence → if exists, retry
 * 4. Return code (caller should INSERT with unique constraint as final safety)
 *
 * Retry Limits:
 * - Max 5 attempts (from SHORTCODE_CONFIG.MAX_RETRIES)
 * - Throws error if all attempts fail (astronomically rare)
 *
 * @param existsCheck - Async function to check if code exists in database
 * @param length - Code length (default: from SHORTCODE_CONFIG)
 * @returns Promise resolving to unique code string
 * @throws Error if max retries exceeded (indicates system issue)
 *
 * @example
 * ```ts
 * const code = await generateUniqueCode(
 *   async (code) => db.links.exists({ where: { code } })
 * );
 * ```
 */
export async function generateUniqueCode(
  existsCheck: ExistsChecker,
  length: number = SHORTCODE_CONFIG.DEFAULT_LENGTH
): Promise<string> {
  const maxRetries = SHORTCODE_CONFIG.MAX_RETRIES;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const code = generateRandomCode(length);

    // Step 1: Blocklist check (fast, no DB call)
    if (isBlockedCode(code)) {
      continue;
    }

    // Step 2: Database existence check
    const exists = await existsCheck(code);
    if (exists) {
      continue;
    }

    // Success - code is available
    return code;
  }

  // This should never happen under normal operation
  // If it does, it indicates either extreme load or a bug
  throw new Error(
    `Failed to generate unique short code after ${maxRetries} attempts. ` +
    `This may indicate extremely high collision rate or system issue.`
  );
}

// =============================================================================
// SECTION 2: VALIDATION
// =============================================================================

/**
 * Validate an auto-generated short code format.
 *
 * Rules (from SHORTCODE_DESIGN.md):
 * - Exactly DEFAULT_LENGTH (7) alphanumeric characters
 * - Not in blocklist (exact match, case-insensitive)
 *
 * @param code - Short code to validate
 * @returns Validation result with error message if invalid
 *
 * @example
 * ```ts
 * validateShortCode("aB3xY9k")  // { valid: true }
 * validateShortCode("admin")   // { valid: false, error: "..." }
 * ```
 */
export function validateShortCode(code: string): ValidationResult {
  const { DEFAULT_LENGTH, ALPHABET } = SHORTCODE_CONFIG;

  // Length check
  if (code.length !== DEFAULT_LENGTH) {
    return {
      valid: false,
      error: `Short code must be exactly ${DEFAULT_LENGTH} characters`,
    };
  }

  // Character check (Base62 only)
  for (const char of code) {
    if (!ALPHABET.includes(char)) {
      return {
        valid: false,
        error: "Short code must contain only alphanumeric characters (a-z, A-Z, 0-9)",
      };
    }
  }

  // Blocklist check (exact match)
  if (isBlockedCode(code)) {
    return {
      valid: false,
      error: "This short code is reserved",
    };
  }

  return { valid: true };
}

/**
 * Validate a user-provided custom alias.
 *
 * Stricter rules than auto-generated codes (from SHORTCODE_DESIGN.md):
 * - Length: 3-30 characters
 * - Characters: a-zA-Z0-9, hyphen (-), underscore (_)
 * - Must start and end with alphanumeric character
 * - Not in blocklist (exact match)
 * - No profanity (substring match)
 *
 * @param alias - Custom alias to validate
 * @returns Validation result with error message if invalid
 *
 * @example
 * ```ts
 * validateCustomAlias("my-link")    // { valid: true }
 * validateCustomAlias("-invalid")   // { valid: false, error: "..." }
 * validateCustomAlias("admin")      // { valid: false, error: "..." }
 * ```
 */
export function validateCustomAlias(alias: string): ValidationResult {
  const { MIN_LENGTH, MAX_LENGTH, PATTERN } = SHORTCODE_CONFIG.CUSTOM_ALIAS;

  // Length check
  if (alias.length < MIN_LENGTH) {
    return {
      valid: false,
      error: `Custom alias must be at least ${MIN_LENGTH} characters`,
    };
  }

  if (alias.length > MAX_LENGTH) {
    return {
      valid: false,
      error: `Custom alias must be at most ${MAX_LENGTH} characters`,
    };
  }

  // Pattern check (alphanumeric, hyphens, underscores; must start/end with alphanumeric)
  if (!PATTERN.test(alias)) {
    return {
      valid: false,
      error: "Custom alias must start and end with a letter or number, and contain only letters, numbers, hyphens, and underscores",
    };
  }

  // Blocklist check (exact match)
  if (isBlockedCode(alias)) {
    return {
      valid: false,
      error: "This alias is reserved and cannot be used",
    };
  }

  // Profanity check (substring match - stricter for user input)
  if (containsBlockedContent(alias)) {
    return {
      valid: false,
      error: "This alias contains restricted content",
    };
  }

  return { valid: true };
}

/**
 * Check if a code is in the blocklist.
 *
 * Case-insensitive exact match against SHORTCODE_BLOCKLIST.
 *
 * @param code - Code to check
 * @returns true if code is blocked
 */
export function isBlockedCode(code: string): boolean {
  return SHORTCODE_BLOCKLIST.has(code.toLowerCase());
}

// =============================================================================
// SECTION 3: UTILITIES
// =============================================================================

/**
 * Encode a number to Base62 string.
 *
 * Useful for:
 * - Converting database IDs to short strings
 * - Creating deterministic codes from sequences
 *
 * Note: Primary generation uses random, not sequential encoding.
 *
 * @param num - Non-negative integer to encode
 * @returns Base62 encoded string
 * @throws Error if num is negative
 *
 * @example
 * ```ts
 * encodeBase62(0)     // "0"
 * encodeBase62(61)    // "z"
 * encodeBase62(62)    // "10"
 * encodeBase62(12345) // "3d7"
 * ```
 */
export function encodeBase62(num: number): string {
  if (num < 0) {
    throw new Error("Cannot encode negative number to Base62");
  }

  const { ALPHABET } = SHORTCODE_CONFIG;

  if (num === 0) {
    return ALPHABET[0];
  }

  let result = "";
  let n = num;

  while (n > 0) {
    result = ALPHABET[n % 62] + result;
    n = Math.floor(n / 62);
  }

  return result;
}

/**
 * Decode a Base62 string to number.
 *
 * @param str - Base62 string to decode
 * @returns Decoded number
 * @throws Error if string contains invalid characters
 *
 * @example
 * ```ts
 * decodeBase62("0")   // 0
 * decodeBase62("z")   // 61
 * decodeBase62("10")  // 62
 * decodeBase62("3d7") // 12345
 * ```
 */
export function decodeBase62(str: string): number {
  const { ALPHABET } = SHORTCODE_CONFIG;
  let result = 0;

  for (const char of str) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid Base62 character: '${char}'`);
    }
    result = result * 62 + index;
  }

  return result;
}

/**
 * Estimate collision probability for capacity planning.
 *
 * Formula: P(collision) ≈ existingCount / totalCombinations
 *
 * This is a simplified approximation. For exact birthday problem
 * calculation, use: P ≈ 1 - e^(-n²/2N)
 *
 * @param existingCount - Number of existing codes in database
 * @param codeLength - Length of codes (default: from config)
 * @returns Probability as decimal (0.001 = 0.1%)
 *
 * @example
 * ```ts
 * estimateCollisionProbability(100_000_000) // ~0.00003 (0.003%)
 * ```
 */
export function estimateCollisionProbability(
  existingCount: number,
  codeLength: number = SHORTCODE_CONFIG.DEFAULT_LENGTH
): number {
  const totalCombinations = Math.pow(62, codeLength);
  return existingCount / totalCombinations;
}
