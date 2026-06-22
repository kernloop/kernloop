import { defineConfig, mergeConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared';

// Inherits the bounded forks pool from vitest.shared.ts (#420).
export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
      // Real I/O (sqlite/subprocess/fs); a generous floor over vitest's 5s default,
      // which flakes under turbo-parallel oversubscription (#223, charter coding-standards).
      testTimeout: 30_000,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts'],
        thresholds: {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
      },
    },
  }),
);
