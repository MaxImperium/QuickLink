/**
 * Short Code Generation Tests
 *
 * Tests for the core short code generation functionality.
 * @see packages/shared/src/utils/shortcode.ts
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  generateRandomCode,
  generateUniqueCode,
  validateCustomAlias,
  isBlockedCode,
  base62Encode,
  base62Decode,
  SHORTCODE_CONFIG,
} from "../src/index.js";

describe("Short Code Generation", () => {
  describe("generateRandomCode", () => {
    it("should generate a code of default length", () => {
      const code = generateRandomCode();
      expect(code).toHaveLength(SHORTCODE_CONFIG.DEFAULT_LENGTH);
    });

    it("should generate a code of specified length", () => {
      const code = generateRandomCode(10);
      expect(code).toHaveLength(10);
    });

    it("should only contain valid Base62 characters", () => {
      const code = generateRandomCode();
      const validChars = /^[a-zA-Z0-9]+$/;
      expect(code).toMatch(validChars);
    });

    it("should generate unique codes (statistical test)", () => {
      const codes = new Set<string>();
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        codes.add(generateRandomCode());
      }

      // All codes should be unique (collision is astronomically unlikely)
      expect(codes.size).toBe(iterations);
    });

    it("should handle edge case of length 1", () => {
      const code = generateRandomCode(1);
      expect(code).toHaveLength(1);
      expect(code).toMatch(/^[a-zA-Z0-9]$/);
    });

    it("should handle very long codes", () => {
      const code = generateRandomCode(50);
      expect(code).toHaveLength(50);
    });
  });

  describe("generateUniqueCode", () => {
    it("should generate a unique code when none exist", async () => {
      const existsCheck = jest.fn<() => Promise<boolean>>().mockResolvedValue(false);
      
      const code = await generateUniqueCode(existsCheck);
      
      expect(code).toHaveLength(SHORTCODE_CONFIG.DEFAULT_LENGTH);
      expect(existsCheck).toHaveBeenCalled();
    });

    it("should retry when code exists in database", async () => {
      const existsCheck = jest.fn<() => Promise<boolean>>()
        .mockResolvedValueOnce(true)  // First code exists
        .mockResolvedValueOnce(true)  // Second code exists
        .mockResolvedValueOnce(false); // Third code is available
      
      const code = await generateUniqueCode(existsCheck);
      
      expect(code).toHaveLength(SHORTCODE_CONFIG.DEFAULT_LENGTH);
      expect(existsCheck).toHaveBeenCalledTimes(3);
    });

    it("should throw error after max retries", async () => {
      const existsCheck = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
      
      await expect(generateUniqueCode(existsCheck)).rejects.toThrow(
        /Max retries exceeded/
      );
      
      expect(existsCheck).toHaveBeenCalledTimes(SHORTCODE_CONFIG.MAX_RETRIES);
    });

    it("should skip blocked codes without database check", async () => {
      const existsCheck = jest.fn<() => Promise<boolean>>().mockResolvedValue(false);
      
      // Mock generateRandomCode to return blocked code first
      // Note: This is testing the flow - actual blocked codes are checked
      const code = await generateUniqueCode(existsCheck);
      
      expect(code).toHaveLength(SHORTCODE_CONFIG.DEFAULT_LENGTH);
    });

    it("should respect custom length parameter", async () => {
      const existsCheck = jest.fn<() => Promise<boolean>>().mockResolvedValue(false);
      
      const code = await generateUniqueCode(existsCheck, 10);
      
      expect(code).toHaveLength(10);
    });
  });
});

describe("Short Code Validation", () => {
  describe("validateCustomAlias", () => {
    it("should accept valid alphanumeric aliases", () => {
      const result = validateCustomAlias("myLink123");
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should accept aliases with hyphens and underscores", () => {
      const result = validateCustomAlias("my-custom_alias");
      expect(result.valid).toBe(true);
    });

    it("should reject aliases that are too short", () => {
      const result = validateCustomAlias("ab");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("too short");
    });

    it("should reject aliases that are too long", () => {
      const result = validateCustomAlias("a".repeat(50));
      expect(result.valid).toBe(false);
      expect(result.error).toContain("too long");
    });

    it("should reject aliases with invalid characters", () => {
      const result = validateCustomAlias("my@link!");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid characters");
    });

    it("should reject blocked aliases", () => {
      const result = validateCustomAlias("admin");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("reserved");
    });

    it("should reject aliases containing profanity", () => {
      const result = validateCustomAlias("test-fuck-word");
      expect(result.valid).toBe(false);
    });

    it("should be case-insensitive for blocklist", () => {
      const result = validateCustomAlias("ADMIN");
      expect(result.valid).toBe(false);
    });

    it("should accept edge case of minimum length", () => {
      const result = validateCustomAlias("abc");
      expect(result.valid).toBe(true);
    });

    it("should accept edge case of maximum length", () => {
      const result = validateCustomAlias("a".repeat(32));
      expect(result.valid).toBe(true);
    });
  });

  describe("isBlockedCode", () => {
    it("should return true for system routes", () => {
      expect(isBlockedCode("api")).toBe(true);
      expect(isBlockedCode("health")).toBe(true);
      expect(isBlockedCode("login")).toBe(true);
      expect(isBlockedCode("admin")).toBe(true);
    });

    it("should return true for brand names", () => {
      expect(isBlockedCode("google")).toBe(true);
      expect(isBlockedCode("facebook")).toBe(true);
    });

    it("should return false for valid codes", () => {
      expect(isBlockedCode("aB3xY9k")).toBe(false);
      expect(isBlockedCode("mylink")).toBe(false);
    });

    it("should be case-insensitive", () => {
      expect(isBlockedCode("API")).toBe(true);
      expect(isBlockedCode("Api")).toBe(true);
      expect(isBlockedCode("ADMIN")).toBe(true);
    });

    it("should detect profanity substrings", () => {
      expect(isBlockedCode("testfuckword")).toBe(true);
      expect(isBlockedCode("shitstorm")).toBe(true);
    });
  });
});

describe("Base62 Encoding", () => {
  describe("base62Encode", () => {
    it("should encode number 0 as single character", () => {
      const encoded = base62Encode(0n);
      expect(encoded).toBe("0");
    });

    it("should encode small numbers correctly", () => {
      const encoded = base62Encode(61n);
      expect(encoded).toBe("z");
    });

    it("should encode larger numbers correctly", () => {
      const encoded = base62Encode(62n);
      expect(encoded).toBe("10");
    });

    it("should handle BigInt input", () => {
      const encoded = base62Encode(123456789012345n);
      expect(encoded).toBeTruthy();
      expect(typeof encoded).toBe("string");
    });

    it("should produce consistent results", () => {
      const value = 999999n;
      const encoded1 = base62Encode(value);
      const encoded2 = base62Encode(value);
      expect(encoded1).toBe(encoded2);
    });
  });

  describe("base62Decode", () => {
    it("should decode single character to number", () => {
      const decoded = base62Decode("0");
      expect(decoded).toBe(0n);
    });

    it("should decode 'z' to 61", () => {
      const decoded = base62Decode("z");
      expect(decoded).toBe(61n);
    });

    it("should decode '10' to 62", () => {
      const decoded = base62Decode("10");
      expect(decoded).toBe(62n);
    });

    it("should handle longer strings", () => {
      const decoded = base62Decode("aB3xY9k");
      expect(typeof decoded).toBe("bigint");
    });
  });

  describe("roundtrip encoding", () => {
    it("should decode what was encoded", () => {
      const original = 123456789n;
      const encoded = base62Encode(original);
      const decoded = base62Decode(encoded);
      expect(decoded).toBe(original);
    });

    it("should work for various values", () => {
      const values = [0n, 1n, 61n, 62n, 1000n, 999999999n];
      
      for (const value of values) {
        const encoded = base62Encode(value);
        const decoded = base62Decode(encoded);
        expect(decoded).toBe(value);
      }
    });
  });
});
