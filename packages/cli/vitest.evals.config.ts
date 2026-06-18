/**
 * Standalone vitest config for the GOLDEN QUALITY EVAL-SET (#226 item 4). This is
 * a BENCHMARK gate, not a unit-coverage gate: each `*.evals.ts` fixture drives the
 * REAL canonical loop in-process with a scripted (model-free) invoke and a real
 * tsc gate, so it forks subprocesses (hence the generous timeout) and carries no
 * coverage thresholds. Run via `pnpm evals`; kept OUT of the unit `pnpm test`
 * include glob (`*.test.ts`) by the distinct `*.evals.ts` extension.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/cli/src/**/*.evals.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: { enabled: false },
  },
});
