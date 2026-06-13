/**
 * The MULTI-LANGUAGE half of the doc-comment quality gate (#108, #122; CLM-0104).
 * Where {@link scanDocComments}'s TypeScript path uses the `typescript` compiler
 * API, this module parses non-TS/JS source IN-PROCESS via `web-tree-sitter`
 * (WASM grammars vendored under `../grammars`, see grammars/SOURCE.md) and flags
 * every PUBLIC top-level declaration that carries no leading doc-comment. The
 * per-language declaration/visibility/doc rules live in treesitter-langs.ts;
 * this module owns grammar loading, the byte budgets, and the scan loop. Covered
 * languages (Python, Go, Rust, Java, C, PHP, Ruby) thereby move OUT of the
 * honest-degradation `info` bucket and into real `error` enforcement.
 *
 * The honesty boundary holds (the prime directive): this proves a doc-comment is
 * PRESENT and non-empty, NEVER that it is ACCURATE.
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
import { LANGS, type LangSpec } from './treesitter-langs.js';

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
  // A web-tree-sitter Tree holds WASM linear memory that is NOT auto-reclaimed
  // (no FinalizationRegistry); the parser is a module-level singleton in a
  // long-lived process, so an undeleted tree leaks across runs → eventual OOM.
  // Always free it, even if the extractor throws.
  const tree = loaded.parser.parse(source);
  try {
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
  } finally {
    tree.delete();
  }
}

/**
 * Scan the tree-sitter-covered files under `rootDir` for undocumented public
 * declarations [CLM-0104]. Bounds its own work (per-file and cumulative byte
 * budgets) so untrusted, model-generated source cannot hang or OOM the in-process
 * scan; an oversized or budget-exceeding file is recorded as a non-blocking
 * `info`, never parsed silently. Async (grammar load + the `web-tree-sitter`
 * runtime); the gate runner awaits and times it out.
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
