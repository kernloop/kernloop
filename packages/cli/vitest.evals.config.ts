/**
 * Standalone vitest config for the GOLDEN QUALITY EVAL-SET (#226 item 4). This is
 * a BENCHMARK gate, not a unit-coverage gate: each `*.evals.ts` fixture drives the
 * REAL canonical loop in-process with a scripted (model-free) invoke and a real
 * tsc gate, so it forks subprocesses (hence the generous timeout) and carries no
 * coverage thresholds. Run via `pnpm evals`; kept OUT of the unit `pnpm test`
 * include glob (`*.test.ts`) by the distinct `*.evals.ts` extension.
 *
 * testTimeout is 60s (not the 30s I/O-heavy default): a single `it` runs the WHOLE
 * canonical loop over MULTIPLE labeled fixtures, each forking a real tsc, so the
 * wall-clock legitimately sits near 30s and tipped over the old 30s ceiling under
 * load — a flaky timeout, not a logic break (#476). 60s gives real headroom.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/cli/src/**/*.evals.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: { enabled: false },
  },
});
