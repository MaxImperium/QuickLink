/**
 * Blocklist Tests
 *
 * Tests for the blocklist functionality.
 * @see packages/shared/src/constants/blocklist.ts
 */

import { describe, it, expect } from "@jest/globals";
import {
  SHORTCODE_BLOCKLIST,
  containsBlockedContent,
  isBlockedCode,
} from "../src/index.js";

describe("Blocklist", () => {
  describe("SHORTCODE_BLOCKLIST", () => {
    it("should be a non-empty Set", () => {
      expect(SHORTCODE_BLOCKLIST).toBeInstanceOf(Set);
      expect(SHORTCODE_BLOCKLIST.size).toBeGreaterThan(0);
    });

    it("should contain system routes", () => {
      expect(SHORTCODE_BLOCKLIST.has("api")).toBe(true);
      expect(SHORTCODE_BLOCKLIST.has("health")).toBe(true);
      expect(SHORTCODE_BLOCKLIST.has("login")).toBe(true);
      expect(SHORTCODE_BLOCKLIST.has("admin")).toBe(true);
      expect(SHORTCODE_BLOCKLIST.has("dashboard")).toBe(true);
    });

    it("should contain brand names", () => {
      expect(SHORTCODE_BLOCKLIST.has("google")).toBe(true);
      expect(SHORTCODE_BLOCKLIST.has("facebook")).toBe(true);
      expect(SHORTCODE_BLOCKLIST.has("twitter")).toBe(true);
    });

    it("should be lowercase only", () => {
      for (const item of SHORTCODE_BLOCKLIST) {
        expect(item).toBe(item.toLowerCase());
      }
    });
  });

  describe("containsBlockedContent", () => {
    it("should detect exact matches", () => {
      expect(containsBlockedContent("fuck")).toBe(true);
      expect(containsBlockedContent("shit")).toBe(true);
    });

    it("should detect substrings", () => {
      expect(containsBlockedContent("testfuckword")).toBe(true);
      expect(containsBlockedContent("bullshitlink")).toBe(true);
    });

    it("should be case-insensitive", () => {
      expect(containsBlockedContent("FUCK")).toBe(true);
      expect(containsBlockedContent("FuCk")).toBe(true);
    });

    it("should return false for clean content", () => {
      expect(containsBlockedContent("mylink")).toBe(false);
      expect(containsBlockedContent("awesome123")).toBe(false);
      expect(containsBlockedContent("aB3xY9k")).toBe(false);
    });

    it("should handle empty string", () => {
      expect(containsBlockedContent("")).toBe(false);
    });
  });

  describe("isBlockedCode", () => {
    describe("system routes", () => {
      const systemRoutes = [
        "api", "v1", "v2", "health", "ready", "live",
        "login", "logout", "signup", "register", "auth",
        "admin", "dashboard", "account", "profile", "settings",
        "links", "link", "create", "new", "edit", "delete",
        "docs", "help", "support", "about", "terms", "privacy",
      ];

      it.each(systemRoutes)("should block system route: %s", (route) => {
        expect(isBlockedCode(route)).toBe(true);
      });
    });

    describe("brand protection", () => {
      const brands = ["google", "facebook", "twitter", "amazon", "microsoft"];

      it.each(brands)("should block brand name: %s", (brand) => {
        expect(isBlockedCode(brand)).toBe(true);
      });
    });

    describe("case insensitivity", () => {
      it("should block regardless of case", () => {
        expect(isBlockedCode("API")).toBe(true);
        expect(isBlockedCode("Api")).toBe(true);
        expect(isBlockedCode("ApI")).toBe(true);
        expect(isBlockedCode("GOOGLE")).toBe(true);
        expect(isBlockedCode("Google")).toBe(true);
      });
    });

    describe("valid codes", () => {
      const validCodes = [
        "aB3xY9k",
        "mylink",
        "test123",
        "hello",
        "xyz789",
      ];

      it.each(validCodes)("should allow valid code: %s", (code) => {
        expect(isBlockedCode(code)).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should handle numbers only", () => {
        expect(isBlockedCode("12345")).toBe(false);
      });

      it("should handle single characters", () => {
        expect(isBlockedCode("a")).toBe(false);
        expect(isBlockedCode("1")).toBe(false);
      });
    });
  });
});
