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
        }
      },
    };
  },
};

export default {
  meta: { name: 'eslint-plugin-kernloop' },
  rules: {
    'no-cross-plugin-imports': noCrossPluginImports,
  },
};
