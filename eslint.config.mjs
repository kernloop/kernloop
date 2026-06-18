import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import kernloop from './eslint-rules/plugin.mjs';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/.turbo/**'],
  },
  { ...js.configs.recommended, files: ['**/*.js', '**/*.mjs', '**/*.cjs'] },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: globals.node },
  },
  ...tseslint.configs.recommended.map((cfg) => ({
    ...cfg,
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
  })),
  {
    plugins: { kernloop },
    rules: {
      'kernloop/no-cross-plugin-imports': 'error',
    },
  },
  {
    // Constitutional rule 4: the kernel originates no model call. The rule's
    // own filename guard exempts packages/kernel/src/adapters/** (the metering
    // primitive), so turning it on for all kernel source is safe.
    files: ['packages/kernel/src/**/*.{ts,mts,cts}'],
    plugins: { kernloop },
    rules: {
      'kernloop/no-model-calls-in-kernel': 'error',
    },
  },
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts', '**/*.mjs'],
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: false, skipComments: false }],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    // Test suites: describe/it callbacks are functions; the 50-line function
    // budget targets production code. `*.evals.ts` are vitest suites too (the
    // golden eval-set, #226/#285). The 400-line file cap still applies.
    files: ['**/*.test.ts', '**/*.test.mjs', '**/*.evals.ts', '**/__tests__/**'],
    rules: {
      'max-lines-per-function': 'off',
    },
  },
);
