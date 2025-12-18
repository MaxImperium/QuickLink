/**
 * Jest Configuration - DB Package
 */

import type { Config } from "jest";

const config: Config = {
  displayName: "@quicklink/db",
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "tsconfig.json",
      },
    ],
  },
  extensionsToTreatAsEsm: [".ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
  ],
  coverageDirectory: "coverage",
  clearMocks: true,
  verbose: true,
  // Longer timeout for database tests
  testTimeout: 30000,
  // Setup/teardown for database
  setupFilesAfterEnv: ["<rootDir>/__tests__/setup.ts"],
};

export default config;
