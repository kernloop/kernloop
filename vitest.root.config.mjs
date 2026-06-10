import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/__tests__/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      include: ['scripts/*.mjs', 'eslint-rules/*.mjs'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
