import { defineConfig } from 'vitest/config';

/**
 * One unified run across every workspace package plus the root gate-script
 * tests, used by `scripts/verify-claim-tests.mjs` to produce a single
 * results manifest. Coverage is enforced separately by `pnpm test` (per
 * package, via turbo); this config exists to prove ran-and-passed, not to
 * measure coverage.
 */
export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'claims/vitest.config.ts',
      {
        test: {
          name: 'root-scripts',
          include: ['scripts/__tests__/**/*.test.mjs'],
        },
      },
    ],
  },
});
