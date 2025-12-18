/**
 * Short Code Generation Module
 *
 * Implements the strategy defined in SHORTCODE_DESIGN.md
 *
 * Strategy: Random Base62
 * - Length: 7 characters (3.5 trillion combinations)
 * - Alphabet: 0-9A-Za-z (62 characters)
 * - Collision handling: Blocklist → DB check → INSERT with retry (max 5)
 */

import { randomBytes } from "node:crypto";
import { SHORTCODE_BLOCKLIST, containsBlockedContent } from "./constants/blocklist.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Base62 alphabet: 0-9A-Za-z
 * URL-safe, case-sensitive, 62 characters
 */
const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Default code length: 7 chars = 62^7 = ~3.5 trillion combinations */
export const DEFAULT_CODE_LENGTH = 7;

/** Minimum custom alias length */
export const MIN_CUSTOM_LENGTH = 3;

/** Maximum custom alias length */
export const MAX_CUSTOM_LENGTH = 30;

/** Maximum retry attempts for collision */
const MAX_RETRIES = 5;

/** Custom alias pattern: alphanumeric, hyphens, underscores */
const CUSTOM_ALIAS_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

// =============================================================================
// Types
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Generate a random Base62 code.
 *
 * Uses cryptographically secure random bytes.
 *
 * @param length - Code length (default: 7)
 * @returns Random Base62 string
 */
export function generateRandomCode(length: number = DEFAULT_CODE_LENGTH): string {
  const bytes = randomBytes(length);
  let code = "";

  for (let i = 0; i < length; i++) {
    // Map byte (0-255) to alphabet index (0-61)
    const index = bytes[i] % BASE62_ALPHABET.length;
    code += BASE62_ALPHABET[index];
  }

  return code;
}

/**
 * Generate a unique short code with collision checking.
 *
 * Flow: Generate → Blocklist check → DB check → Retry if needed
 *
 * @param existsCheck - Async function to check if code exists in DB
 * @param length - Code length (default: 7)
 * @returns Promise resolving to unique code
 * @throws Error if max retries exceeded
 */
export async function generateUniqueCode(
  existsCheck: (code: string) => Promise<boolean>,
  length: number = DEFAULT_CODE_LENGTH
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const code = generateRandomCode(length);

    // Step 1: Check blocklist (no DB call needed)
    if (isBlockedCode(code)) {
      continue; // Regenerate
    }

    // Step 2: Check database
    const exists = await existsCheck(code);
    if (!exists) {
      return code;
    }

    // Collision detected, retry
  }

  throw new Error(
    `Failed to generate unique code after ${MAX_RETRIES} attempts. ` +
    `This may indicate high collision rate - consider increasing code length.`
  );
}

/**
 * Validate an auto-generated short code.
 *
 * @param code - Code to validate
 * @returns Validation result
 */
export function validateShortCode(code: string): ValidationResult {
  // Check length
  if (code.length !== DEFAULT_CODE_LENGTH) {
    return {
      valid: false,
      error: `Code must be exactly ${DEFAULT_CODE_LENGTH} characters`,
    };
  }

  // Check characters (Base62 only)
  for (const char of code) {
    if (!BASE62_ALPHABET.includes(char)) {
      return {
        valid: false,
        error: `Invalid character '${char}'. Only alphanumeric characters allowed.`,
      };
    }
  }

  // Check blocklist (exact match only for auto-generated)
  if (isBlockedCode(code)) {
    return {
      valid: false,
      error: "Code is reserved or blocked",
    };
  }

  return { valid: true };
}

/**
 * Validate a user-provided custom alias.
 *
 * Stricter validation than auto-generated codes:
 * - Length: 3-30 characters
 * - Characters: a-zA-Z0-9, -, _
 * - Must start/end with alphanumeric
 * - Blocklist: exact match AND substring check
 *
 * @param alias - Custom alias to validate
 * @returns Validation result
 */
export function validateCustomAlias(alias: string): ValidationResult {
  // Check length
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

  // Check pattern
  if (!CUSTOM_ALIAS_PATTERN.test(alias)) {
    return {
      valid: false,
      error: "Alias must contain only letters, numbers, hyphens, and underscores, and must start/end with a letter or number",
    };
  }

  // Check blocklist (exact match)
  if (isBlockedCode(alias)) {
    return {
      valid: false,
      error: "This alias is reserved or not allowed",
    };
  }

  // Check blocklist (substring match for profanity)
  if (containsBlockedContent(alias)) {
    return {
      valid: false,
      error: "Alias contains restricted content",
    };
  }

  return { valid: true };
}

/**
 * Check if a code is in the blocklist.
 *
 * Case-insensitive exact match.
 *
 * @param code - Code to check
 * @returns true if blocked
 */
export function isBlockedCode(code: string): boolean {
  return SHORTCODE_BLOCKLIST.has(code.toLowerCase());
}
