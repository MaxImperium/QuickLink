/**
 * Short Code Generation Module
 *
 * Generates unique, URL-safe short codes for the QuickLink URL shortener.
 *
 * Strategy: Random Base62
 * - Length: 7 characters (3.5 trillion combinations)
 * - Alphabet: a-zA-Z0-9 (62 characters)
 * - Collision handling: Check + retry (max 5 attempts)
 *
 * Why Random Base62?
 * 1. Unpredictable - can't enumerate links (security)
 * 2. No coordination - scales horizontally
 * 3. Multi-region safe - no central ID service needed
 * 4. Simple operations - just generate + check existence
 *
 * Trade-offs:
 * - Requires collision check (but probability is ~0.003% at 100M links)
 * - Slightly longer codes than sequential (but more secure)
 */

import { webcrypto } from "node:crypto";
import { SHORTCODE_BLOCKLIST } from "../constants/blocklist.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * URL-safe Base62 alphabet
 * Using all alphanumeric characters for maximum density
 */
const BASE62_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Default short code length
 * 7 chars = 62^7 = 3.5 trillion combinations
 * Safe until ~35 billion links (1% fill rate)
 */
export const DEFAULT_CODE_LENGTH = 7;

/**
 * Minimum custom alias length
 */
export const MIN_CUSTOM_LENGTH = 4;

/**
 * Maximum custom alias length
 */
export const MAX_CUSTOM_LENGTH = 30;

/**
 * Maximum generation attempts before failing
 */
const MAX_GENERATION_ATTEMPTS = 5;

// =============================================================================
// Types
// =============================================================================

export interface GenerateOptions {
  /** Code length (default: 7) */
  length?: number;
  /** Function to check if code exists */
  existsCheck?: (code: string) => Promise<boolean>;
}

export interface GenerationResult {
  /** Generated short code */
  code: string;
  /** Number of attempts taken */
  attempts: number;
}

export interface ValidationResult {
  /** Whether the code/alias is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
}

// =============================================================================
// Generation Functions
// =============================================================================

/**
 * Generate a random short code.
 *
 * Uses cryptographically secure random bytes for unpredictability.
 *
 * @param length - Code length (default: 7)
 * @returns Random Base62 string
 */
export function generateRandomCode(length: number = DEFAULT_CODE_LENGTH): string {
  // Use crypto for secure randomness
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);

  let code = "";
  for (let i = 0; i < length; i++) {
    // Map byte to alphabet index (0-61)
    const index = bytes[i] % BASE62_ALPHABET.length;
    code += BASE62_ALPHABET[index];
  }

  return code;
}

/**
 * Generate a unique short code with collision detection.
 *
 * Flow:
 * 1. Generate random code
 * 2. Check blocklist
 * 3. Check existence (if checker provided)
 * 4. Retry on collision (max 5 attempts)
 *
 * @param options - Generation options
 * @returns Generated code and attempt count
 * @throws Error if max attempts exceeded
 */
export async function generateUniqueCode(
  options: GenerateOptions = {}
): Promise<GenerationResult> {
  const { length = DEFAULT_CODE_LENGTH, existsCheck } = options;

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    const code = generateRandomCode(length);

    // Check blocklist first (fast, in-memory)
    if (isBlockedCode(code)) {
      continue; // Generate new code
    }

    // Check existence if checker provided
    if (existsCheck) {
      const exists = await existsCheck(code);
      if (exists) {
        continue; // Collision, generate new code
      }
    }

    // Success!
    return { code, attempts: attempt };
  }

  // This should be astronomically rare
  throw new Error(
    `Failed to generate unique code after ${MAX_GENERATION_ATTEMPTS} attempts`
  );
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate an auto-generated short code format.
 *
 * Rules:
 * - Exactly 7 alphanumeric characters
 * - Not in blocklist
 *
 * @param code - Code to validate
 * @returns Validation result
 */
export function validateShortCode(code: string): ValidationResult {
  // Length check
  if (code.length !== DEFAULT_CODE_LENGTH) {
    return {
      valid: false,
      error: `Code must be exactly ${DEFAULT_CODE_LENGTH} characters`,
    };
  }

  // Character check (alphanumeric only)
  if (!/^[a-zA-Z0-9]+$/.test(code)) {
    return {
      valid: false,
      error: "Code must contain only alphanumeric characters",
    };
  }

  // Blocklist check
  if (isBlockedCode(code)) {
    return {
      valid: false,
      error: "Code is reserved or blocked",
    };
  }

  return { valid: true };
}

/**
 * Validate a custom alias (user-provided).
 *
 * Rules:
 * - 4-30 characters
 * - Alphanumeric, hyphens, underscores only
 * - Not in blocklist
 * - No leading/trailing hyphens or underscores
 *
 * @param alias - Alias to validate
 * @returns Validation result
 */
export function validateCustomAlias(alias: string): ValidationResult {
  // Length check
  if (alias.length < MIN_CUSTOM_LENGTH) {
    return {
      valid: false,
      error: `Alias must be at least ${MIN_CUSTOM_LENGTH} characters`,
    };
  }

  if (alias.length > MAX_CUSTOM_LENGTH) {
    return {
      valid: false,
      error: `Alias must be at most ${MAX_CUSTOM_LENGTH} characters`,
    };
  }

  // Character check (alphanumeric, hyphen, underscore)
  if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
    return {
      valid: false,
      error: "Alias can only contain letters, numbers, hyphens, and underscores",
    };
  }

  // No leading/trailing special characters
  if (/^[-_]|[-_]$/.test(alias)) {
    return {
      valid: false,
      error: "Alias cannot start or end with hyphen or underscore",
    };
  }

  // Blocklist check
  if (isBlockedCode(alias)) {
    return {
      valid: false,
      error: "This alias is reserved or not allowed",
    };
  }

  return { valid: true };
}

/**
 * Check if a code is in the blocklist.
 *
 * Checks:
 * - Exact match (case-insensitive)
 * - Reserved system routes
 *
 * @param code - Code to check
 * @returns true if blocked
 */
export function isBlockedCode(code: string): boolean {
  const normalized = code.toLowerCase();
  return SHORTCODE_BLOCKLIST.has(normalized);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Encode a numeric ID to Base62.
 *
 * Useful for:
 * - Converting database IDs to short strings
 * - Creating deterministic codes from sequences
 *
 * Note: Not used in primary generation (we use random),
 * but available for special cases.
 *
 * @param num - Number to encode
 * @returns Base62 encoded string
 */
export function encodeBase62(num: number): string {
  if (num === 0) return BASE62_ALPHABET[0];

  let result = "";
  let n = num;

  while (n > 0) {
    result = BASE62_ALPHABET[n % 62] + result;
    n = Math.floor(n / 62);
  }

  return result;
}

/**
 * Decode a Base62 string to numeric ID.
 *
 * @param str - Base62 string to decode
 * @returns Decoded number
 */
export function decodeBase62(str: string): number {
  let result = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const index = BASE62_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid Base62 character: ${char}`);
    }
    result = result * 62 + index;
  }

  return result;
}

/**
 * Calculate collision probability for given parameters.
 *
 * Uses birthday problem approximation:
 * P(collision) ≈ 1 - e^(-n²/2m)
 *
 * @param existingCount - Number of existing codes
 * @param codeLength - Length of codes
 * @returns Approximate collision probability per new insert
 */
export function estimateCollisionProbability(
  existingCount: number,
  codeLength: number = DEFAULT_CODE_LENGTH
): number {
  const totalCombinations = Math.pow(62, codeLength);
  // Simplified: probability ≈ existingCount / totalCombinations
  return existingCount / totalCombinations;
}
