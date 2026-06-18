import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Hermetic keyring sandbox (#280): the shipped handlers build a
// `createProductionKernloop`, whose audit keyring defaults to
// `$XDG_CONFIG_HOME/kernloop/audit.key`. Point XDG at a throwaway temp dir so
// tests NEVER touch the operator's real `~/.config/kernloop/audit.key` and
// stay reproducible across runs.
const xdgSandbox = mkdtempSync(join(tmpdir(), 'kernloop-test-xdg-'));

export default defineConfig({
  test: {
    env: { XDG_CONFIG_HOME: xdgSandbox },
    // I/O-heavy tests (subprocess, tsc, the canonical loop, whole-repo
    // scans) get headroom over the 5s default so they do not flake under
    // CI load (the recurring #90/#91/#97 class); a true hang is still
    // bounded by the CI job timeout.
    testTimeout: 30_000,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // *.evals.ts are the golden eval-set (#226 item 4) — run by `pnpm evals`, not
      // `pnpm test`, so they carry no unit coverage and must not tank the threshold.
      exclude: ['src/**/*.test.ts', 'src/**/*.evals.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
