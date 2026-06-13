import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // I/O-heavy tests (subprocess, tsc, the canonical loop, whole-repo
    // scans) get headroom over the 5s default so they do not flake under
    // CI load (the recurring #90/#91/#97 class); a true hang is still
    // bounded by the CI job timeout.
    testTimeout: 30_000,
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
});
