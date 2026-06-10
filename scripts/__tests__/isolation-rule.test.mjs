import { test } from 'vitest';
import { RuleTester } from 'eslint';
import plugin from '../../eslint-rules/plugin.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

test('no-cross-plugin-imports enforces spec §1.5 isolation', () => {
  ruleTester.run('no-cross-plugin-imports', plugin.rules['no-cross-plugin-imports'], {
    valid: [
      {
        code: "import { TaskContract } from '@kernloop/contracts';",
        filename: 'packages/faculty-memory/src/store.ts',
      },
      {
        code: "import { helper } from './helper.js';",
        filename: 'packages/faculty-memory/src/store.ts',
      },
      {
        code: "import { contractsVersion } from '@kernloop/contracts';",
        filename: 'packages/kernel/src/audit/chain.ts',
      },
      {
        code: "import fs from 'node:fs';",
        filename: 'packages/faculty-gates/src/quality.ts',
      },
      {
        // files outside packages/ (scripts, claims) have no owning package
        code: "import { ClaimSchema } from '@kernloop/contracts';",
        filename: 'claims/src/check.ts',
      },
      {
        // relative imports that stay inside the package are fine
        code: "import { x } from '../util/x.js';",
        filename: 'packages/kernel/src/audit/chain.ts',
      },
      {
        // dynamic import with a non-literal source is out of scope for the rule
        code: 'const m = await import(pluginName);',
        filename: 'packages/kernel/src/registry.ts',
      },
      {
        // same-faculty self-reference is not a cross-plugin import
        code: "import { vote } from '@kernloop/faculty-gates';",
        filename: 'packages/faculty-gates/src/quality.ts',
      },
    ],
    invalid: [
      {
        code: "import { vote } from '@kernloop/faculty-gates';",
        filename: 'packages/faculty-memory/src/store.ts',
        errors: [{ messageId: 'crossPlugin' }],
      },
      {
        code: "import { schema } from '@kernloop/contracts/src/task-contract.js';",
        filename: 'packages/kernel/src/router.ts',
        errors: [{ messageId: 'deepImport' }],
      },
      {
        code: "import { vote } from '../../faculty-gates/src/vote.js';",
        filename: 'packages/faculty-memory/src/store.ts',
        errors: [{ messageId: 'relativeEscape' }],
      },
      {
        code: "export { vote } from '@kernloop/faculty-gates';",
        filename: 'packages/faculty-memory/src/index.ts',
        errors: [{ messageId: 'crossPlugin' }],
      },
      {
        code: "const m = await import('@kernloop/faculty-observer');",
        filename: 'packages/faculty-toolsmith/src/forge.ts',
        errors: [{ messageId: 'crossPlugin' }],
      },
      {
        code: "export * from '@kernloop/faculty-memory';",
        filename: 'packages/faculty-compiler/src/index.ts',
        errors: [{ messageId: 'crossPlugin' }],
      },
      {
        // deep imports are banned even from non-package files
        code: "import { chain } from '@kernloop/kernel/src/audit/chain.js';",
        filename: 'scripts/audit-selftest.mjs',
        errors: [{ messageId: 'deepImport' }],
      },
    ],
  });
});
