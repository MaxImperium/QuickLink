/**
 * User Model Integration Tests
 *
 * Tests for user authentication and management.
 */

import { describe, it, expect } from "@jest/globals";
import { prisma } from "../src/client.js";
import { testHelpers } from "./setup.js";

describe("User Model", () => {
  describe("create", () => {
    it("should create a user with email and password", async () => {
      const user = await prisma.user.create({
        data: {
          email: "test@example.com",
          hashedPassword: "hashed_password_123",
        },
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe("test@example.com");
      expect(user.hashedPassword).toBe("hashed_password_123");
      expect(user.name).toBeNull();
      expect(user.createdAt).toBeDefined();
    });

    it("should create a user with name", async () => {
      const user = await prisma.user.create({
        data: {
          email: "named@example.com",
          hashedPassword: "hashed_password_123",
          name: "John Doe",
        },
      });

      expect(user.name).toBe("John Doe");
    });

    it("should reject duplicate emails", async () => {
      await prisma.user.create({
        data: {
          email: "duplicate@example.com",
          hashedPassword: "hash1",
        },
      });

      await expect(
        prisma.user.create({
          data: {
            email: "duplicate@example.com",
            hashedPassword: "hash2",
          },
        })
      ).rejects.toThrow(/Unique constraint/i);
    });

    it("should handle email case sensitivity", async () => {
      await prisma.user.create({
        data: {
          email: "case@example.com",
          hashedPassword: "hash1",
        },
      });

      // Depending on database collation, this may or may not fail
      // Prisma/Postgres default is case-sensitive
      const upperCaseUser = await prisma.user.create({
        data: {
          email: "CASE@example.com",
          hashedPassword: "hash2",
        },
      });

      expect(upperCaseUser.email).toBe("CASE@example.com");
    });
  });

  describe("findUnique", () => {
    it("should find user by email", async () => {
      await testHelpers.createUser({ email: "find@example.com" });

      const found = await prisma.user.findUnique({
        where: { email: "find@example.com" },
      });

      expect(found).not.toBeNull();
      expect(found?.email).toBe("find@example.com");
    });

    it("should find user by id", async () => {
      const created = await testHelpers.createUser({ email: "findbyid@example.com" });

      const found = await prisma.user.findUnique({
        where: { id: created.id },
      });

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    it("should return null for non-existent email", async () => {
      const found = await prisma.user.findUnique({
        where: { email: "nonexistent@example.com" },
      });

      expect(found).toBeNull();
    });
  });

  describe("update", () => {
    it("should update user name", async () => {
      const user = await testHelpers.createUser({ 
        email: "update@example.com",
        name: "Old Name" 
      });

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { name: "New Name" },
      });

      expect(updated.name).toBe("New Name");
    });

    it("should update password", async () => {
      const user = await testHelpers.createUser({ email: "password@example.com" });

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { hashedPassword: "new_hashed_password" },
      });

      expect(updated.hashedPassword).toBe("new_hashed_password");
    });

    it("should update timestamps on change", async () => {
      const user = await testHelpers.createUser({ email: "timestamps@example.com" });
      const originalUpdatedAt = user.updatedAt;

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { name: "Updated" },
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });

  describe("delete", () => {
    it("should delete user", async () => {
      const user = await testHelpers.createUser({ email: "delete@example.com" });

      await prisma.user.delete({
        where: { id: user.id },
      });

      const found = await prisma.user.findUnique({
        where: { id: user.id },
      });

      expect(found).toBeNull();
    });
  });

  describe("relations", () => {
    it("should load user with links", async () => {
      const user = await testHelpers.createUser({ email: "relations@example.com" });
      
      await prisma.link.createMany({
        data: [
          { shortCode: "link1", targetUrl: "https://a.com", userId: user.id },
          { shortCode: "link2", targetUrl: "https://b.com", userId: user.id },
        ],
      });

      const userWithLinks = await prisma.user.findUnique({
        where: { id: user.id },
        include: { links: true },
      });

      expect(userWithLinks?.links.length).toBe(2);
    });

    it("should not cascade delete links when user is deleted", async () => {
      const user = await testHelpers.createUser({ email: "cascade@example.com" });
      
      await prisma.link.create({
        data: { 
          shortCode: "orphan", 
          targetUrl: "https://orphan.com", 
          userId: user.id 
        },
      });

      // This should fail due to foreign key constraint
      // unless onDelete is set to SetNull or Cascade
      await expect(
        prisma.user.delete({ where: { id: user.id } })
      ).rejects.toThrow();

      // Links should still exist
      const link = await prisma.link.findUnique({
        where: { shortCode: "orphan" },
      });
      expect(link).not.toBeNull();
    });
  });

  describe("queries", () => {
    it("should count users", async () => {
      await testHelpers.createUser({ email: "count1@example.com" });
      await testHelpers.createUser({ email: "count2@example.com" });
      await testHelpers.createUser({ email: "count3@example.com" });

      const count = await prisma.user.count();

      expect(count).toBe(3);
    });

    it("should find users with links", async () => {
      const userWithLinks = await testHelpers.createUser({ email: "haslinks@example.com" });
      const userWithoutLinks = await testHelpers.createUser({ email: "nolinks@example.com" });

      await prisma.link.create({
        data: { shortCode: "haslink", targetUrl: "https://a.com", userId: userWithLinks.id },
      });

      const usersWithLinks = await prisma.user.findMany({
        where: {
          links: { some: {} },
        },
      });

      expect(usersWithLinks.length).toBe(1);
      expect(usersWithLinks[0].email).toBe("haslinks@example.com");
    });
  });
});
