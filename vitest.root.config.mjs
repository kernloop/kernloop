import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/__tests__/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      include: ['scripts/*.mjs', 'eslint-rules/*.mjs'],
      // The MCP-sampling live harness is an INTEGRATION entrypoint: it runs
      // main() on import and spawns a real model CLI, so it cannot be unit-run
      // in CI (it makes real model calls). Its CI-safe proof is the in-process
      // round-trip in packages/cli/src/loop/mcp-sampling.test.ts. Excluded from
      // UNIT coverage scope — the 80% threshold itself is unchanged.
      exclude: ['scripts/sampling-host-harness.mjs'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
