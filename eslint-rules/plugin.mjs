import path from 'node:path';

/**
 * Constitutional rule 5 (spec §1): plugins communicate only through contracts
 * over the event bus — no plugin imports another plugin, and no package
 * reaches into another package's internals.
 *
 * Enforced here:
 *  - a faculty package may not import any other faculty package
 *  - no file may deep-import another @kernloop package's internals
 *    (only the package root export is allowed)
 *  - no relative import may escape its own package into a sibling package
 */
function owningPackage(filename) {
  const normalized = filename.split(path.sep).join('/');
  const match = normalized.match(/packages\/([^/]+)\//);
  return match ? match[1] : null;
}

function checkSource(context, node, source) {
  const filename = context.filename ?? context.getFilename();
  const ownPkg = owningPackage(filename);

  if (source.startsWith('@kernloop/')) {
    const rest = source.slice('@kernloop/'.length);
    const [pkg, ...deep] = rest.split('/');
    if (deep.length > 0) {
      context.report({
        node,
        messageId: 'deepImport',
        data: { source },
      });
    }
    if (
      ownPkg !== null &&
      ownPkg.startsWith('faculty-') &&
      pkg.startsWith('faculty-') &&
      pkg !== ownPkg
    ) {
      context.report({
        node,
        messageId: 'crossPlugin',
        data: { from: ownPkg, to: pkg },
      });
    }
    return;
  }

  if (source.startsWith('.') && ownPkg !== null) {
    const dir = path.posix.dirname(filename.split(path.sep).join('/'));
    const resolved = path.posix.normalize(path.posix.join(dir, source));
    const targetPkg = owningPackage(resolved);
    if (targetPkg !== null && targetPkg !== ownPkg) {
      context.report({
        node,
        messageId: 'relativeEscape',
        data: { from: ownPkg, to: targetPkg },
      });
    }
  }
}

// A dynamic import can build a specifier at runtime and evade the literal
// check. We recover what we statically can: a template literal's leading
// quasi, or the left-most literal of a string concat. Only a recoverable
// `@kernloop/faculty-` prefix is flagged — arbitrary runtime strings are out
// of reach, and pretending otherwise would be dishonest (spec §1.5).
function staticPrefix(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral' && node.quasis.length > 0) {
    return node.quasis[0].value.cooked ?? node.quasis[0].value.raw ?? '';
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    // Walk to the left-most operand to find the static prefix.
    return staticPrefix(node.left);
  }
  return null;
}

function checkDynamicFacultyImport(context, node) {
  const filename = context.filename ?? context.getFilename();
  const ownPkg = owningPackage(filename);
  if (ownPkg === null || !ownPkg.startsWith('faculty-')) return;
  const prefix = staticPrefix(node.source);
  if (prefix === null) return;
  const facultyPrefix = '@kernloop/faculty-';
  if (prefix.startsWith(facultyPrefix)) {
    const target = prefix.slice('@kernloop/'.length).split('/')[0] || 'faculty-*';
    context.report({
      node,
      messageId: 'crossPlugin',
      data: { from: ownPkg, to: target },
    });
  }
}

const noCrossPluginImports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'plugins communicate only through contracts over the bus; no plugin imports another plugin (spec §1.5)',
    },
    messages: {
      crossPlugin:
        "faculty '{{from}}' imports faculty '{{to}}' — plugins communicate only through contracts over the bus (spec §1.5)",
      deepImport:
        "deep import '{{source}}' reaches into package internals — import the package root only",
      relativeEscape:
        "relative import escapes package '{{from}}' into '{{to}}' — use the published package interface",
    },
    schema: [],
  },
  create(context) {
    const onSource = (node) => {
      if (node.source && typeof node.source.value === 'string') {
        checkSource(context, node, node.source.value);
      }
    };
    return {
      ImportDeclaration: onSource,
      ExportNamedDeclaration: onSource,
      ExportAllDeclaration: onSource,
      ImportExpression: (node) => {
        if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
          checkSource(context, node, node.source.value);
          return;
        }
        // Non-literal: a TemplateLiteral or string-concat building a faculty
        // specifier at runtime would otherwise evade the rule.
        checkDynamicFacultyImport(context, node);
      },
    };
  },
};

/**
 * Constitutional rule 4 (spec §1): the kernel contains no intelligence. The
 * single metering primitive that originates a model call is `invokeAdapter`,
 * which lives in the adapters module. Referencing it anywhere else in kernel
 * source means the kernel itself would originate a model call — forbidden.
 * The adapters directory IS the metering primitive and is exempt.
 */
function inKernelSrc(filename) {
  const normalized = filename.split(path.sep).join('/');
  return /(^|\/)packages\/kernel\/src\//.test(normalized);
}

function inKernelAdapters(filename) {
  const normalized = filename.split(path.sep).join('/');
  return /(^|\/)packages\/kernel\/src\/adapters\//.test(normalized);
}

const ADAPTER_PRIMITIVE = 'invokeAdapter';

const noModelCallsInKernel = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'the kernel contains no intelligence; it must not originate a model call by referencing the adapter invocation primitive outside the adapters module (spec §1.4)',
    },
    messages: {
      kernelModelCall:
        "kernel source references the adapter invocation primitive '{{name}}' — the kernel must not originate a model call (spec §1.4); only packages/kernel/src/adapters/** may invoke an adapter",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    // The rule only governs kernel source, and the adapters module is the
    // metering primitive itself — exempt. The filename guard makes the rule
    // a no-op for everything else, which also satisfies RuleTester `valid`
    // cases for non-kernel and adapters paths.
    if (!inKernelSrc(filename) || inKernelAdapters(filename)) {
      return {};
    }
    const report = (node) =>
      context.report({ node, messageId: 'kernelModelCall', data: { name: ADAPTER_PRIMITIVE } });
    return {
      // A call: invokeAdapter(...)
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === ADAPTER_PRIMITIVE) {
          report(node.callee);
        }
      },
      // An import binding: import { invokeAdapter } from ...
      ImportSpecifier(node) {
        if (node.imported.type === 'Identifier' && node.imported.name === ADAPTER_PRIMITIVE) {
          report(node);
        }
      },
    };
  },
};

export default {
  meta: { name: 'eslint-plugin-kernloop' },
  rules: {
    'no-cross-plugin-imports': noCrossPluginImports,
    'no-model-calls-in-kernel': noModelCallsInKernel,
  },
};
