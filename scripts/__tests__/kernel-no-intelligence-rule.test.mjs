import { test } from 'vitest';
import { RuleTester } from 'eslint';
import plugin from '../../eslint-rules/plugin.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

test('no-model-calls-in-kernel enforces spec §1.4 (kernel originates no model call)', () => {
  ruleTester.run('no-model-calls-in-kernel', plugin.rules['no-model-calls-in-kernel'], {
    valid: [
      {
        // the adapters module IS the metering primitive — exempt
        code: "import { invokeAdapter } from './invoke.js';\nexport const x = () => invokeAdapter('claude', i);",
        filename: 'packages/kernel/src/adapters/index.ts',
      },
      {
        // non-kernel package — rule is inactive
        code: "import { invokeAdapter } from '@kernloop/kernel';\nawait invokeAdapter('codex', i);",
        filename: 'packages/cli/src/x.ts',
      },
      {
        // kernel source that does not reference the primitive is fine
        code: 'export function route(task) {\n  return task.id;\n}',
        filename: 'packages/kernel/src/router/router.ts',
      },
    ],
    invalid: [
      {
        // calling the primitive from kernel router source — forbidden
        code: "await invokeAdapter('claude', invocation);",
        filename: 'packages/kernel/src/router/router.ts',
        errors: [{ messageId: 'kernelModelCall' }],
      },
      {
        // even importing the binding into non-adapters kernel source is a model
        // call the kernel would be originating
        code: "import { invokeAdapter } from './adapters/index.js';",
        filename: 'packages/kernel/src/router/router.ts',
        errors: [{ messageId: 'kernelModelCall' }],
      },
    ],
  });
});
