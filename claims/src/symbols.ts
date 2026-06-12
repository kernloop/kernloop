/**
 * Shared TypeScript symbol extraction for the claims tooling. Pure, single-file
 * resolution via the `typescript` compiler API: parse ONE file's AST and resolve
 * a dotted `symbolPath` to its declaration, returning the declaration kind and
 * its leading doc-comment text.
 *
 * Single-file by design — a `code:` anchor is `path#symbol`, so no cross-file
 * program (no type checker, no module graph) is needed. This keeps the module
 * fast and reusable: the doc-coverage gate (#64) reuses `findSymbol` plus a
 * future `listExportedSymbols(filePath)` over the same parsed source.
 *
 * SCOPE, stated honestly: this module proves a symbol EXISTS and surfaces its
 * doc-comment text. It does NOT prove the symbol's behavior — that is what a
 * test proves. Callers (see resolve.ts) must not treat presence as behavior.
 */
import fs from 'node:fs';
import ts from 'typescript';

/** Result of resolving a dotted symbol path within one source file. */
export interface SymbolResult {
  /** True when the dotted path resolved to a declaration in the file. */
  found: boolean;
  /** Syntax-kind label of the resolved declaration (e.g. `FunctionDeclaration`). */
  kind?: string;
  /** Leading JSDoc/doc-comment text of the declaration, if any. */
  doc?: string;
  /** Precise reason `found` is false (never set when `found` is true). */
  reason?: string;
}

/** Parse one file's source into a SourceFile AST (no program, no checker). */
function parseSourceFile(filePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, /* setParentNodes */ true);
}

/**
 * The name a declaration node binds, or undefined if it is not a named
 * declaration we resolve (functions, classes, interfaces, type aliases, enums,
 * methods, properties, and `const`/`let` variable declarations with an
 * identifier name).
 */
function declaredName(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isGetAccessorDeclaration(node)
  ) {
    return node.name !== undefined && ts.isIdentifier(node.name) ? node.name.text : undefined;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  return undefined;
}

/** Direct named child declarations of a container (file, class, or interface). */
function childDeclarations(container: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) out.push(decl);
      return;
    }
    if (declaredName(node) !== undefined) out.push(node);
  };
  if (ts.isSourceFile(container)) {
    container.forEachChild(visit);
  } else if (ts.isClassDeclaration(container) || ts.isInterfaceDeclaration(container)) {
    for (const member of container.members) visit(member);
  }
  return out;
}

/** Find a directly-contained declaration named `name`, or undefined. */
function findNamed(container: ts.Node, name: string): ts.Node | undefined {
  return childDeclarations(container).find((d) => declaredName(d) === name);
}

/**
 * Leading doc-comment text of a declaration: its JSDoc block(s) if present,
 * otherwise any leading line/block comment range. Returns undefined when the
 * declaration carries no leading comment. The variable-declaration case lifts
 * to the enclosing `VariableStatement`, where the JSDoc actually attaches.
 */
function leadingDoc(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  const jsDocHost =
    ts.isVariableDeclaration(node) && node.parent?.parent !== undefined ? node.parent.parent : node;
  const jsDocs = ts.getJSDocCommentsAndTags(jsDocHost);
  const jsDocText = jsDocs
    .map((d) => (typeof d.comment === 'string' ? d.comment : ts.getTextOfJSDocComment(d.comment)))
    .filter((c): c is string => c !== undefined && c.length > 0)
    .join('\n');
  if (jsDocText.length > 0) return jsDocText;
  const full = sourceFile.getFullText();
  const ranges = ts.getLeadingCommentRanges(full, jsDocHost.getFullStart()) ?? [];
  if (ranges.length === 0) return undefined;
  const text = ranges
    .map((r) => full.slice(r.pos, r.end))
    .join('\n')
    .trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Resolve a dotted `symbolPath` (e.g. `recordOutcome`, `ManifestSchema`,
 * `Router.route`, an exported const) to its declaration in `filePath` and
 * return its kind + leading doc-comment. Pure: reads the file, parses it once,
 * walks the AST. `found:false` carries a precise `reason`.
 *
 * Proves the symbol EXISTS and surfaces its doc-comment — never its behavior.
 */
export function findSymbol(filePath: string, symbolPath: string): SymbolResult {
  if (!fs.existsSync(filePath)) {
    return { found: false, reason: `file not found: ${filePath}` };
  }
  const segments = symbolPath.split('.').filter((s) => s.length > 0);
  if (segments.length === 0) {
    return { found: false, reason: 'empty symbol path' };
  }
  const sourceFile = parseSourceFile(filePath, fs.readFileSync(filePath, 'utf8'));
  let container: ts.Node = sourceFile;
  let resolved: ts.Node | undefined;
  for (let i = 0; i < segments.length; i++) {
    const name = segments[i] as string;
    const match = findNamed(container, name);
    if (match === undefined) {
      const where = i === 0 ? filePath : `"${segments.slice(0, i).join('.')}"`;
      return { found: false, reason: `no declared symbol "${name}" in ${where}` };
    }
    resolved = match;
    container = match;
  }
  if (resolved === undefined) {
    return { found: false, reason: `no declared symbol "${symbolPath}" in ${filePath}` };
  }
  const doc = leadingDoc(resolved, sourceFile);
  return doc === undefined
    ? { found: true, kind: ts.SyntaxKind[resolved.kind] }
    : { found: true, kind: ts.SyntaxKind[resolved.kind], doc };
}
