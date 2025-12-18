/**
 * Database Test Setup
 *
 * Handles database connection and cleanup for integration tests.
 * Uses a separate test database to avoid affecting development data.
 */

import { prisma, disconnectDb } from "../src/client.js";
import { afterAll, beforeAll, beforeEach } from "@jest/globals";

// Ensure we're using a test database
const TEST_DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/quicklink_test";

if (!TEST_DATABASE_URL.includes("test")) {
  console.warn("⚠️  Warning: DATABASE_URL does not contain 'test'. Make sure you're using a test database!");
}

/**
 * Connect to database before all tests
 */
beforeAll(async () => {
  try {
    await prisma.$connect();
    console.log("✅ Connected to test database");
  } catch (error) {
    console.error("❌ Failed to connect to test database:", error);
    throw error;
  }
});

/**
 * Clean up specific tables before each test
 * Order matters due to foreign key constraints
 */
beforeEach(async () => {
  // Clean up in reverse order of dependencies
  await prisma.aggregatedStat.deleteMany({});
  await prisma.clickEvent.deleteMany({});
  await prisma.link.deleteMany({});
  await prisma.reservedAlias.deleteMany({});
  await prisma.user.deleteMany({});
});

/**
 * Disconnect from database after all tests
 */
afterAll(async () => {
  await disconnectDb();
  console.log("✅ Disconnected from test database");
});

/**
 * Helper to create test data
 */
export const testHelpers = {
  /**
   * Create a test user
   */
  async createUser(data?: Partial<{
    email: string;
    hashedPassword: string;
    name: string;
  }>) {
    return prisma.user.create({
      data: {
        email: data?.email || `test-${Date.now()}@example.com`,
        hashedPassword: data?.hashedPassword || "hashed_password_123",
        name: data?.name || "Test User",
      },
    });
  },

  /**
   * Create a test link
   */
  async createLink(data?: Partial<{
    shortCode: string;
    targetUrl: string;
    userId: bigint;
    active: boolean;
    expiresAt: Date;
  }>) {
    return prisma.link.create({
      data: {
        shortCode: data?.shortCode || `test${Date.now()}`,
        targetUrl: data?.targetUrl || "https://example.com",
        userId: data?.userId,
        active: data?.active ?? true,
        expiresAt: data?.expiresAt,
      },
    });
  },

  /**
   * Create a test click event
   */
  async createClickEvent(linkId: bigint, data?: Partial<{
    ipHash: string;
    userAgent: string;
    referrer: string;
    isBot: boolean;
  }>) {
    return prisma.clickEvent.create({
      data: {
        linkId,
        ipHash: data?.ipHash || "abc123",
        userAgent: data?.userAgent,
        referrer: data?.referrer,
        isBot: data?.isBot ?? false,
      },
    });
  },
};
