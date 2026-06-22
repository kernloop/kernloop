import { defineConfig, mergeConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared';

// Inherits the bounded forks pool from vitest.shared.ts (#420).
export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
      // Real-docker integration tests pull/run node:22-alpine; give every
      // docker-touching test room (per-test timeouts tighten where useful).
      testTimeout: 120_000,
      hookTimeout: 180_000,
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
