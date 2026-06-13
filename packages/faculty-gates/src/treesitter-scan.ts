/**
 * The MULTI-LANGUAGE half of the doc-comment quality gate (#108; CLM-0104).
 * Where {@link scanDocComments}'s TypeScript path uses the `typescript` compiler
 * API, this module parses Python, Go, and Rust IN-PROCESS via `web-tree-sitter`
 * (WASM grammars vendored under `../grammars`, see grammars/SOURCE.md) and flags
 * every PUBLIC top-level declaration that carries no leading doc-comment. These
 * languages thereby move OUT of the honest-degradation `info` bucket and into
 * real `error` enforcement, exactly like TS/JS.
 *
 * The same honesty boundary holds (the prime directive): this proves a
 * doc-comment is PRESENT and non-empty, NEVER that it is ACCURATE. "Public" is
 * the language's own visibility rule — Python: a module-level `def`/`class`
 * whose name does not start with `_`; Go: a top-level func/method/type/const/var
 * whose name begins with an uppercase letter; Rust: an item carrying a `pub`
 * visibility modifier. "Documented" is presence of an adjacent doc — Python: a
 * docstring as the body's first statement; Go/Rust: a comment on the line(s)
 * immediately above (no blank-line gap), mirroring the TS scanner accepting any
 * leading comment range.
 *
 * SECURITY/ROBUSTNESS: the WASM runtime is sandboxed (no host access), the parse
 * is bounded by per-file and cumulative byte budgets (model-generated content
 * runs through here, and a synchronous parse cannot be interrupted by the
 * runner's timer), and a grammar that fails to load DEGRADES to a non-blocking
 * `info` finding — it never throws and never silently passes the files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'web-tree-sitter';
import type { Finding } from '@kernloop/contracts';

/** Directory holding the vendored grammar `.wasm` files. Resolved relative to
 * THIS module, which sits one level under the package root in both `src/` (test)
 * and `dist/` (built) — so `../grammars` is correct in either. */
const GRAMMAR_DIR = fileURLToPath(new URL('../grammars/', import.meta.url));

/** Per-file byte cap: a larger file is recorded and skipped, never parsed —
 * `web-tree-sitter` parse cost grows with size and runs IN-PROCESS on untrusted,
 * model-generated content, so an unbounded parse could block the loop. */
const MAX_FILE_BYTES = 1_000_000;
/** Cumulative byte budget across the tree-sitter scan, bounding the many-files
 * case the per-file cap alone would not. */
const MAX_TOTAL_BYTES = 32_000_000;

/** One public top-level declaration and whether it carries a doc-comment. */
interface Decl {
  readonly name: string;
  readonly kind: string;
  readonly line: number;
  readonly documented: boolean;
}

/** A language the tree-sitter path covers: its display label, grammar filename,
 * and the extractor that enumerates its public declarations. */
interface LangSpec {
  readonly label: string;
  readonly wasm: string;
  readonly extract: (root: Parser.SyntaxNode) => Decl[];
}

/** True for a comment node adjacent to (on the line above, no blank-line gap)
 * the declaration at `declRow` — the Go/Rust "doc comment immediately above"
 * convention. */
function isAdjacentComment(prev: Parser.SyntaxNode | null, declRow: number, types: readonly string[]): boolean {
  return prev !== null && types.includes(prev.type) && declRow - prev.endPosition.row <= 1;
}

/** The 1-based source line of a node (tree-sitter rows are 0-based). */
function lineOf(node: Parser.SyntaxNode): number {
  return node.startPosition.row + 1;
}

/** Python: module-level `def`/`class` whose name is public (no leading `_`),
 * documented iff the body's first statement is a string expression (docstring). */
function extractPython(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) {
    if (node.type !== 'function_definition' && node.type !== 'class_definition') continue;
    const name = node.childForFieldName('name')?.text;
    if (name === undefined || name.startsWith('_')) continue;
    const first = node.childForFieldName('body')?.firstNamedChild;
    const documented =
      first?.type === 'expression_statement' && first.firstNamedChild?.type === 'string';
    const kind = node.type === 'class_definition' ? 'class' : 'function';
    out.push({ name, kind, line: lineOf(node), documented });
  }
  return out;
}

/** True when a Go identifier is EXPORTED — its first character is an uppercase
 * letter (the Go spec's visibility rule), Unicode-aware. */
function isGoExported(name: string): boolean {
  return /^\p{Lu}/u.test(name);
}

/** One Go spec node (type_spec/const_spec/var_spec) → a Decl, doc taken from the
 * enclosing declaration's preceding comment (the whole decl shares one doc). */
function goSpecDecl(spec: Parser.SyntaxNode, kind: string, documented: boolean): Decl | null {
  const name = spec.childForFieldName('name')?.text;
  if (name === undefined || !isGoExported(name)) return null;
  return { name, kind, line: lineOf(spec), documented };
}

/** Go: top-level funcs/methods (named directly) and type/const/var declarations
 * (which wrap one or more specs); exported iff the name is uppercase-initial,
 * documented iff a comment sits on the line immediately above the declaration. */
function extractGo(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) {
    const documented = isAdjacentComment(node.previousNamedSibling, node.startPosition.row, ['comment']);
    if (node.type === 'function_declaration' || node.type === 'method_declaration') {
      const name = node.childForFieldName('name')?.text;
      if (name !== undefined && isGoExported(name)) {
        out.push({ name, kind: 'function', line: lineOf(node), documented });
      }
    } else if (node.type === 'type_declaration' || node.type === 'const_declaration' || node.type === 'var_declaration') {
      const kind = node.type.replace('_declaration', '');
      for (const spec of node.namedChildren) {
        const decl = goSpecDecl(spec, kind, documented);
        if (decl !== null) out.push(decl);
      }
    }
  }
  return out;
}

/** The Rust top-level item types the gate enumerates (each carries a `name`
 * field and may carry a `visibility_modifier` child). */
const RUST_ITEMS = new Set([
  'function_item',
  'struct_item',
  'enum_item',
  'trait_item',
  'mod_item',
  'const_item',
  'static_item',
  'type_item',
  'union_item',
  'macro_definition',
]);

/** Rust: top-level items carrying a `pub` visibility modifier, documented iff a
 * line or block comment (incl. `///` outer-doc and block-doc comments) sits
 * immediately above. */
function extractRust(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) {
    if (!RUST_ITEMS.has(node.type)) continue;
    const isPub = node.namedChildren.some((c) => c.type === 'visibility_modifier');
    if (!isPub) continue;
    const name = node.childForFieldName('name')?.text;
    if (name === undefined) continue;
    const documented = isAdjacentComment(node.previousNamedSibling, node.startPosition.row, [
      'line_comment',
      'block_comment',
    ]);
    out.push({ name, kind: node.type.replace('_item', '').replace('_definition', ''), line: lineOf(node), documented });
  }
  return out;
}

/** Extension → language spec for every tree-sitter-covered source language. */
const LANGS: Record<string, LangSpec> = {
  '.py': { label: 'Python', wasm: 'tree-sitter-python.wasm', extract: extractPython },
  '.go': { label: 'Go', wasm: 'tree-sitter-go.wasm', extract: extractGo },
  '.rs': { label: 'Rust', wasm: 'tree-sitter-rust.wasm', extract: extractRust },
};

/** The set of extensions this scanner covers — consumed by {@link scanDocComments}
 * to partition the walk (these no longer degrade to `info`). */
export const TREE_SITTER_EXTS: ReadonlySet<string> = new Set(Object.keys(LANGS));

/** A loaded grammar + its own reusable parser, or `null` when the grammar failed
 * to load (degraded, not thrown). Cached so each grammar loads at most once. */
type LoadedParser = { parser: Parser; spec: LangSpec } | null;

let initPromise: Promise<void> | undefined;
const parserCache = new Map<string, LoadedParser>();

/** Initialize the WASM runtime exactly once (idempotent across the process). */
async function ensureInit(): Promise<void> {
  initPromise ??= Parser.init();
  await initPromise;
}

/** Load (and cache) the parser for one language spec, or `null` on any failure
 * (missing/corrupt grammar, ABI mismatch) — errors are data, never thrown. */
async function loadParser(spec: LangSpec): Promise<LoadedParser> {
  const cached = parserCache.get(spec.wasm);
  if (cached !== undefined) return cached;
  let loaded: LoadedParser = null;
  try {
    await ensureInit();
    const language = await Parser.Language.load(path.join(GRAMMAR_DIR, spec.wasm));
    const parser = new Parser();
    parser.setLanguage(language);
    loaded = { parser, spec };
  } catch {
    loaded = null;
  }
  parserCache.set(spec.wasm, loaded);
  return loaded;
}

/** Parse one file and return an `error` finding per undocumented public decl.
 * A grammar-load failure yields a single `info` degradation finding. */
async function scanOneFile(file: string, rel: string, ext: string): Promise<Finding[]> {
  const spec = LANGS[ext];
  if (spec === undefined) return [];
  const loaded = await loadParser(spec);
  if (loaded === null) {
    return [
      {
        severity: 'info',
        message: `doc-comment check could not load the ${spec.label} parser; ${spec.label} coverage recorded, not enforced`,
      },
    ];
  }
  let source: string;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const tree = loaded.parser.parse(source);
  const findings: Finding[] = [];
  for (const decl of loaded.spec.extract(tree.rootNode)) {
    if (decl.documented) continue;
    findings.push({
      severity: 'error',
      message: `exported ${decl.kind} "${decl.name}" (${rel}:${String(decl.line)}) has no doc-comment`,
      path: rel,
    });
  }
  return findings;
}

/**
 * Scan the tree-sitter-covered files (Python/Go/Rust) under `rootDir` for
 * undocumented public declarations [CLM-0104]. Bounds its own work (per-file and
 * cumulative byte budgets) so untrusted, model-generated source cannot hang or
 * OOM the in-process scan; an oversized or budget-exceeding file is recorded as
 * a non-blocking `info`, never parsed silently. Async (grammar load + the
 * `web-tree-sitter` runtime); the gate runner awaits and times it out.
 */
export async function scanTreeSitterFiles(
  files: readonly string[],
  rootDir: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  let totalBytes = 0;
  let truncated = 0;
  for (const file of files) {
    const rel = path.relative(rootDir, file);
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_BYTES) {
      findings.push({
        severity: 'info',
        message: `${rel} skipped: ${String(size)} bytes exceeds the ${String(MAX_FILE_BYTES)}-byte per-file doc-scan limit`,
        path: rel,
      });
      continue;
    }
    if (totalBytes + size > MAX_TOTAL_BYTES) {
      truncated += 1;
      continue;
    }
    totalBytes += size;
    findings.push(...(await scanOneFile(file, rel, path.extname(file).toLowerCase())));
  }
  if (truncated > 0) {
    findings.push({
      severity: 'info',
      message: `doc-comment scan truncated: ${String(truncated)} file(s) not scanned after the ${String(MAX_TOTAL_BYTES)}-byte total budget`,
    });
  }
  return findings;
}
