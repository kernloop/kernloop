import { defineConfig, mergeConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared';

// Inherits the bounded forks pool from vitest.shared.ts (#420/#443): a standalone
// `vitest run` in this package (e.g. via `turbo run test`) is now bounded at source,
// not only in the single-process verify-ran run pinned by vitest.ci.config.mjs.
export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
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
