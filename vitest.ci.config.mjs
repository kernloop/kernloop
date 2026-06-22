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
    // Bounded forks pool (#420), applied UNIFORMLY across every project. The
    // editable per-package configs each pin maxWorkers=4 (via vitest.shared.ts),
    // but the protected-path configs (contracts/kernel/claims, a test-infra
    // change may not touch them) do not — and vitest 4 REFUSES to run projects
    // that have different `maxWorkers` under the same `sequence.groupOrder`.
    // Pinning the same bound here makes every project uniform (resolving that
    // error) AND bounds the protected-path projects in this single-process
    // verify-ran run without editing them. Keep this == vitest.shared.ts.
    pool: 'forks',
    maxWorkers: 4,
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
