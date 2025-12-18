/**
 * Link Model Integration Tests
 *
 * Tests for link creation, querying, and lifecycle management.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { prisma } from "../src/client.js";
import { testHelpers } from "./setup.js";
import { LinkLifecycleState } from "../src/types.js";

describe("Link Model", () => {
  describe("create", () => {
    it("should create a link with minimal data", async () => {
      const link = await prisma.link.create({
        data: {
          shortCode: "test123",
          targetUrl: "https://example.com",
        },
      });

      expect(link.id).toBeDefined();
      expect(link.shortCode).toBe("test123");
      expect(link.targetUrl).toBe("https://example.com");
      expect(link.active).toBe(true);
      expect(link.lifecycleState).toBe("active");
      expect(link.customAlias).toBe(false);
      expect(link.deletedAt).toBeNull();
    });

    it("should create a link with custom alias", async () => {
      const link = await prisma.link.create({
        data: {
          shortCode: "my-custom-alias",
          targetUrl: "https://example.com",
          customAlias: true,
        },
      });

      expect(link.customAlias).toBe(true);
    });

    it("should create a link with expiration date", async () => {
      const expiresAt = new Date(Date.now() + 86400000); // 24 hours from now
      
      const link = await prisma.link.create({
        data: {
          shortCode: "expiring",
          targetUrl: "https://example.com",
          expiresAt,
        },
      });

      expect(link.expiresAt).toEqual(expiresAt);
    });

    it("should create a link with max clicks", async () => {
      const link = await prisma.link.create({
        data: {
          shortCode: "limited",
          targetUrl: "https://example.com",
          maxClicks: 100,
        },
      });

      expect(link.maxClicks).toBe(100);
    });

    it("should associate link with user", async () => {
      const user = await testHelpers.createUser();
      
      const link = await prisma.link.create({
        data: {
          shortCode: "userlink",
          targetUrl: "https://example.com",
          userId: user.id,
        },
        include: { user: true },
      });

      expect(link.userId).toBe(user.id);
      expect(link.user?.email).toBe(user.email);
    });

    it("should reject duplicate short codes", async () => {
      await prisma.link.create({
        data: {
          shortCode: "duplicate",
          targetUrl: "https://example1.com",
        },
      });

      await expect(
        prisma.link.create({
          data: {
            shortCode: "duplicate",
            targetUrl: "https://example2.com",
          },
        })
      ).rejects.toThrow(/Unique constraint/i);
    });
  });

  describe("findUnique", () => {
    it("should find link by short code", async () => {
      await testHelpers.createLink({ shortCode: "findme" });

      const found = await prisma.link.findUnique({
        where: { shortCode: "findme" },
      });

      expect(found).not.toBeNull();
      expect(found?.shortCode).toBe("findme");
    });

    it("should return null for non-existent code", async () => {
      const found = await prisma.link.findUnique({
        where: { shortCode: "nonexistent" },
      });

      expect(found).toBeNull();
    });

    it("should include relations when requested", async () => {
      const user = await testHelpers.createUser();
      await prisma.link.create({
        data: {
          shortCode: "withuser",
          targetUrl: "https://example.com",
          userId: user.id,
        },
      });

      const found = await prisma.link.findUnique({
        where: { shortCode: "withuser" },
        include: { user: true },
      });

      expect(found?.user).not.toBeNull();
      expect(found?.user?.id).toBe(user.id);
    });
  });

  describe("update", () => {
    it("should update target URL", async () => {
      const link = await testHelpers.createLink({ shortCode: "update1" });

      const updated = await prisma.link.update({
        where: { id: link.id },
        data: { targetUrl: "https://updated.com" },
      });

      expect(updated.targetUrl).toBe("https://updated.com");
    });

    it("should update lifecycle state", async () => {
      const link = await testHelpers.createLink({ shortCode: "update2" });

      const updated = await prisma.link.update({
        where: { id: link.id },
        data: { lifecycleState: "disabled" },
      });

      expect(updated.lifecycleState).toBe("disabled");
    });

    it("should soft delete by setting deletedAt", async () => {
      const link = await testHelpers.createLink({ shortCode: "softdelete" });
      const now = new Date();

      const deleted = await prisma.link.update({
        where: { id: link.id },
        data: { deletedAt: now },
      });

      expect(deleted.deletedAt).not.toBeNull();
    });

    it("should update click count", async () => {
      const link = await testHelpers.createLink({ shortCode: "clicks" });

      const updated = await prisma.link.update({
        where: { id: link.id },
        data: { clickCount: { increment: 1 } },
      });

      expect(updated.clickCount).toBe(1);

      // Increment again
      const updated2 = await prisma.link.update({
        where: { id: link.id },
        data: { clickCount: { increment: 5 } },
      });

      expect(updated2.clickCount).toBe(6);
    });
  });

  describe("queries", () => {
    beforeEach(async () => {
      // Create test data
      const user = await testHelpers.createUser({ email: "query-test@example.com" });
      
      await prisma.link.createMany({
        data: [
          { shortCode: "active1", targetUrl: "https://a.com", active: true, userId: user.id },
          { shortCode: "active2", targetUrl: "https://b.com", active: true },
          { shortCode: "inactive", targetUrl: "https://c.com", active: false },
          { shortCode: "expired", targetUrl: "https://d.com", lifecycleState: "expired" },
          { shortCode: "disabled", targetUrl: "https://e.com", lifecycleState: "disabled" },
        ],
      });
    });

    it("should find all active links", async () => {
      const activeLinks = await prisma.link.findMany({
        where: { active: true, lifecycleState: "active" },
      });

      expect(activeLinks.length).toBe(2);
    });

    it("should find links by user", async () => {
      const user = await prisma.user.findUnique({
        where: { email: "query-test@example.com" },
      });

      const userLinks = await prisma.link.findMany({
        where: { userId: user!.id },
      });

      expect(userLinks.length).toBe(1);
      expect(userLinks[0].shortCode).toBe("active1");
    });

    it("should count links by state", async () => {
      const activeCount = await prisma.link.count({
        where: { lifecycleState: "active" },
      });
      const expiredCount = await prisma.link.count({
        where: { lifecycleState: "expired" },
      });
      const disabledCount = await prisma.link.count({
        where: { lifecycleState: "disabled" },
      });

      expect(activeCount).toBe(3); // active1, active2, inactive (lifecycle is still "active")
      expect(expiredCount).toBe(1);
      expect(disabledCount).toBe(1);
    });

    it("should exclude soft-deleted links", async () => {
      // Soft delete one link
      await prisma.link.update({
        where: { shortCode: "active1" },
        data: { deletedAt: new Date() },
      });

      const notDeleted = await prisma.link.findMany({
        where: { deletedAt: null },
      });

      expect(notDeleted.length).toBe(4);
    });
  });
});
