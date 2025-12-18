/**
 * API Test Setup
 *
 * Configuration and helpers for API E2E tests.
 */

import { jest, beforeAll, afterAll, beforeEach } from "@jest/globals";

// Mock external dependencies
jest.mock("@quicklink/logger", () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

// Mock database client
jest.mock("@quicklink/db", () => ({
  prisma: {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    link: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    clickEvent: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback({
      user: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
      link: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    })),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  },
  checkDbConnection: jest.fn().mockResolvedValue(true),
  disconnectDb: jest.fn().mockResolvedValue(undefined),
}));

// Mock analytics emitter
jest.mock("@quicklink/analytics", () => ({
  emitClickEvent: jest.fn(),
}));

// Mock cache
jest.mock("@quicklink/cache", () => ({
  cacheClient: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    ping: jest.fn().mockResolvedValue("PONG"),
  },
}));

// Set test environment variables
beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "test-secret-key-for-jwt-signing-123";
  process.env.PORT = "0"; // Random port for tests
  process.env.SHORT_URL_BASE = "http://localhost:3001";
});

// Clean up after all tests
afterAll(async () => {
  // Allow any pending timers to complete
  await new Promise((resolve) => setTimeout(resolve, 100));
});
