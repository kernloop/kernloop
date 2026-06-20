import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/__tests__/**/*.test.mjs'],
    // These scripts tests spawn real subprocesses (eslint, tsc) and scan the
    // whole repo, so vitest's 5s default flakes when they contend for CPU during
    // the full `pnpm test` run (#293) — give them the same 30s floor the
    // I/O-heavy packages use. A true hang is still bounded by the CI job timeout.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['scripts/*.mjs', 'eslint-rules/*.mjs'],
      // The MCP-sampling live harness is an INTEGRATION entrypoint: it runs
      // main() on import and spawns a real model CLI, so it cannot be unit-run
      // in CI (it makes real model calls). Its CI-safe proof is the in-process
      // round-trip in packages/cli/src/loop/mcp-sampling.test.ts. Excluded from
      // UNIT coverage scope — the 80% threshold itself is unchanged.
      // The adapter smoke harness (#380) likewise runs main() on import and
      // spawns the real authed model CLIs, so it cannot run in CI unit coverage;
      // its CI-safe proof is the static scripts/__tests__/adapter-effort-safety
      // assertion. Excluded from UNIT coverage scope (threshold unchanged).
      exclude: ['scripts/sampling-host-harness.mjs', 'scripts/adapter-smoke.mjs'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
