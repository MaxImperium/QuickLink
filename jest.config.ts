/**
 * Root Jest Configuration
 *
 * This configuration is used for running tests across all packages.
 * Each package also has its own jest.config.ts for standalone testing.
 */

import type { Config } from "jest";

const config: Config = {
  // Use TypeScript preset
  preset: "ts-jest/presets/default-esm",

  // Project references for monorepo
  projects: [
    "<rootDir>/packages/shared",
    "<rootDir>/packages/db",
    "<rootDir>/packages/analytics",
    "<rootDir>/apps/redirect",
    "<rootDir>/apps/api",
  ],

  // Coverage settings
  collectCoverageFrom: [
    "**/*.{ts,tsx}",
    "!**/*.d.ts",
    "!**/node_modules/**",
    "!**/dist/**",
    "!**/__tests__/**",
    "!**/coverage/**",
  ],

  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },

  // Coverage reporters
  coverageReporters: ["text", "text-summary", "lcov", "html"],

  // Test environment
  testEnvironment: "node",

  // Module resolution
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },

  // Transform settings for ESM
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "tsconfig.base.json",
      },
    ],
  },

  // ESM support
  extensionsToTreatAsEsm: [".ts", ".tsx"],

  // Verbose output
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,

  // Timeout for tests
  testTimeout: 30000,
};

export default config;
