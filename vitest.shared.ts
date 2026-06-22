import { defineConfig } from 'vitest/config';

/**
 * Shared vitest base config — the ONE source of the bounded forks pool (#420).
 *
 * WHY this exists: `pnpm test` runs `turbo run test` across all ~14 packages
 * CONCURRENTLY, and each package's vitest defaults to an UNBOUNDED forks pool
 * (~nproc forks; 16 on a high-core dev box). The cost is MULTIPLICATIVE:
 *   peak fork processes ≈ turbo_concurrency × per_package_forks
 * which on a 16-core box was ≈ 10 × 16 ≈ 150 forks, each loading the test env
 * plus V8 coverage instrumentation → a multi-GB spike → OOM / killed workers
 * (observed 2026-06-21; contributed to a crash). Bounding only one factor is
 * not enough; both factors are bounded — turbo concurrency in the root `test`
 * script, and this per-package pool cap.
 *
 * maxWorkers=4 is a conservative FIXED cap: a no-op on low-core CI runners
 * (≤4 cores, which already fork ≤4) but it caps the inner pool on a high-core
 * dev box. Combined with turbo `--concurrency=4`, peak ≈ 4 × 4 = 16 forks.
 *
 * NB: vitest 4 removed `poolOptions.forks.maxForks` — the inner-pool size is
 * now the top-level `maxWorkers` (`pool` already defaults to 'forks'). Setting
 * the old `poolOptions` key is silently ignored, so we set `maxWorkers` and
 * pin `pool: 'forks'` explicitly for clarity.
 *
 * Per-package configs MERGE with this via vitest's `mergeConfig`, so each
 * package keeps its own include/coverage/env/testTimeout and inherits ONLY the
 * pool bound from here. Do not remove the bound without re-reading #420 — the
 * regression guard in scripts/__tests__/vitest-pool-bound.test.mjs enforces it.
 */
export const sharedTestConfig = defineConfig({
  test: {
    pool: 'forks',
    maxWorkers: 4,
  },
});

export default sharedTestConfig;
