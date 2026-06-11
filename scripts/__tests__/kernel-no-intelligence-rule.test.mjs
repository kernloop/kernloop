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
      {
        // a pure re-export does not call — it exposes the surface (src/index.ts)
        code: "export * from './adapters/index.js';",
        filename: 'packages/kernel/src/index.ts',
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
      {
        // runSubprocess is the raw spawn the metered call is built on — also forbidden
        code: "await runSubprocess({ command: 'claude', args: [] });",
        filename: 'packages/kernel/src/router/router.ts',
        errors: [{ messageId: 'kernelModelCall' }],
      },
      {
        // a member call on a namespace import evades a bare-identifier check
        code: "import * as a from './adapters/index.js';\nawait a.invokeAdapter('claude', i);",
        filename: 'packages/kernel/src/ladder/ladder.ts',
        errors: [{ messageId: 'kernelModelCall' }],
      },
    ],
  });
});
