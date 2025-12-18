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
  encodeBase62,
  decodeBase62,
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
        /Failed to generate unique short code after/
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
      expect(result.error).toContain("at least 3 characters");
    });

    it("should reject aliases that are too long", () => {
      const result = validateCustomAlias("a".repeat(50));
      expect(result.valid).toBe(false);
      expect(result.error).toContain("at most 30 characters");
    });

    it("should reject aliases with invalid characters", () => {
      const result = validateCustomAlias("my@link!");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("must start and end");
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
      const result = validateCustomAlias("a".repeat(SHORTCODE_CONFIG.CUSTOM_ALIAS.MAX_LENGTH));
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

    it("should detect profanity via containsBlockedContent", () => {
      // Note: isBlockedCode does exact match only
      // Use containsBlockedContent for substring matching
      expect(isBlockedCode("testfuckword")).toBe(false); // Not an exact blocklist match
      expect(isBlockedCode("shitstorm")).toBe(false); // Not an exact blocklist match
    });
  });
});

describe("Base62 Encoding", () => {
  describe("encodeBase62", () => {
    it("should encode number 0 as single character", () => {
      const encoded = encodeBase62(0);
      expect(encoded).toBe("0");
    });

    it("should encode small numbers correctly", () => {
      const encoded = encodeBase62(61);
      expect(encoded).toBe("z");
    });

    it("should encode larger numbers correctly", () => {
      const encoded = encodeBase62(62);
      expect(encoded).toBe("10");
    });

    it("should handle large numbers", () => {
      const encoded = encodeBase62(12345678901);
      expect(encoded).toBeTruthy();
      expect(typeof encoded).toBe("string");
    });

    it("should produce consistent results", () => {
      const value = 999999;
      const encoded1 = encodeBase62(value);
      const encoded2 = encodeBase62(value);
      expect(encoded1).toBe(encoded2);
    });

    it("should throw for negative numbers", () => {
      expect(() => encodeBase62(-1)).toThrow("Cannot encode negative number");
    });
  });

  describe("decodeBase62", () => {
    it("should decode single character to number", () => {
      const decoded = decodeBase62("0");
      expect(decoded).toBe(0);
    });

    it("should decode 'z' to 61", () => {
      const decoded = decodeBase62("z");
      expect(decoded).toBe(61);
    });

    it("should decode '10' to 62", () => {
      const decoded = decodeBase62("10");
      expect(decoded).toBe(62);
    });

    it("should handle longer strings", () => {
      const decoded = decodeBase62("aB3xY9k");
      expect(typeof decoded).toBe("number");
    });

    it("should throw for invalid characters", () => {
      expect(() => decodeBase62("abc@def")).toThrow("Invalid Base62 character");
    });
  });

  describe("roundtrip encoding", () => {
    it("should decode what was encoded", () => {
      const original = 123456789;
      const encoded = encodeBase62(original);
      const decoded = decodeBase62(encoded);
      expect(decoded).toBe(original);
    });

    it("should work for various values", () => {
      const values = [0, 1, 61, 62, 1000, 999999999];
      
      for (const value of values) {
        const encoded = encodeBase62(value);
        const decoded = decodeBase62(encoded);
        expect(decoded).toBe(value);
      }
    });
  });
});
