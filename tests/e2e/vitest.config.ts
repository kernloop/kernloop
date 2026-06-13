/**
 * Standalone vitest config for the e2e functional suite. This is an INTEGRATION
 * GATE, not a unit-coverage gate: it spawns the real `kernloop` binary through
 * realistic multi-step workflows, so each test forks subprocesses (hence the
 * generous timeout) and there are no coverage thresholds. The CLI must be built
 * first (`pnpm build`) — `tests/e2e/harness/run-cli.ts` fails loudly if it isn't.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Real subprocesses + temp file I/O: no coverage instrumentation here.
    coverage: { enabled: false },
  },
});
