import { defineConfig, mergeConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared';

// Inherits the bounded forks pool from vitest.shared.ts (#420).
export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    test: {
      // The tree-sitter WASM scanners parse whole-repo / byte-budget corpora and
      // are CPU-bound; under CI oversubscription the budget-truncation scan was
      // observed at ~32s, just over a 30s floor (the #90/#91/#97 flake class). 60s
      // gives real headroom; a true hang is still bounded by the CI job timeout.
      testTimeout: 60_000,
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
