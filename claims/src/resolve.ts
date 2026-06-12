/**
 * Evidence resolvers for `claims:check`. Each resolver answers one question:
 * does this evidence reference point at something that exists in the tree
 * RIGHT NOW? Resolvers return `null` on success or a precise error message.
 *
 * What "test evidence" proves, in two layers (deliberately, and stated so the
 * gate cannot overclaim):
 *  1. THIS resolver (static, fast): the referenced test EXISTS by exact name,
 *     is not disabled inline (`.skip`/`.only`/`.todo`/`xit`/`xtest`), and does
 *     not have an empty body. It does not execute anything.
 *  2. `scripts/verify-claim-tests.mjs` (the ran-and-passed gate, blocking in
 *     CI's `test` job): every cited test must appear in the actual test-run
 *     results with status `passed`. This is what makes "verified" mean the
 *     test RAN and PASSED — it catches `describe.skip`, CLI `--skip`, renamed
 *     or deleted tests, and failures, none of which a static scan can see.
 * What neither layer claims: that a passing test asserts something *meaningful*
 * (a no-op-but-named test that throws nothing "passes"). The empty-body check
 * here catches the blatant case; assertion quality is a code-review concern,
 * and the gate does not pretend otherwise.
 *
 * The honesty boundary for `code:` evidence (issue #51, READ BEFORE EDITING):
 * a `code:path#symbol[@doc:/regex/]` ref proves only that the symbol EXISTS in
 * that file and, with `@doc:`, that its doc-comment ASSERTS the claim (matches
 * the regex). It NEVER proves the symbol DOES what the claim says — that is the
 * exclusive job of a `test:` ref. `code:` is ADDITIVE: it is a code-anchor, not
 * a behavior proof, and `claims:check` (check.ts) still requires a `test:` ref
 * for any `verified` claim. Do not let `code:` satisfy the verified⇒test rule.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { EvidenceRef } from './schema.js';
import { findSymbol } from './symbols.js';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Locate a `test`/`it` call for `name` and report what it is. Returns the
 * matched leading token (`test`/`it`/`xit`/`xtest`), any modifier chain
 * (`.skip`, `.only`, `.todo`, `.each(...)`), and whether its callback body is
 * empty. `null` means no such named test call exists in the source.
 */
export function findTestCall(
  source: string,
  name: string,
): { token: string; modifiers: string; emptyBody: boolean } | null {
  const head = new RegExp(
    `\\b(test|it|xit|xtest)((?:\\.(?:skip|only|todo|concurrent|sequential|fails|each\\([^)]*\\)))*)\\(\\s*(['"])${escapeRegExp(name)}\\3`,
    'g',
  );
  const m = head.exec(source);
  if (m === null) return null;
  const token = m[1] ?? '';
  const modifiers = m[2] ?? '';
  // Find the callback body's opening `{`. For an arrow callback the body
  // follows `=>`, and arrow params may themselves contain `{` (destructuring),
  // so we jump past `=>` first — but ONLY when that `=>` precedes the next
  // `{`. Otherwise (a `function () {}` callback, whose `{` comes before any
  // arrow) we take the first `{`, so an empty `function` body is not misread
  // by jumping to a LATER test's `=>`.
  const i = head.lastIndex;
  const firstBrace = source.indexOf('{', i);
  const arrow = source.indexOf('=>', i);
  const useArrow = arrow !== -1 && (firstBrace === -1 || arrow < firstBrace);
  const open = useArrow ? source.indexOf('{', arrow) : firstBrace;
  let emptyBody = false;
  if (open !== -1) {
    let depth = 0;
    let bodyChars = '';
    for (let j = open; j < source.length; j++) {
      const ch = source[j];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) break;
      } else if (depth === 1) {
        bodyChars += ch;
      }
    }
    emptyBody =
      bodyChars
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim() === '';
  }
  return { token, modifiers, emptyBody };
}

function resolveTestRef(
  ref: Extract<EvidenceRef, { kind: 'test' }>,
  repoRoot: string,
): string | null {
  const file = path.resolve(repoRoot, ref.path);
  if (!fs.existsSync(file)) {
    return `${ref.raw}: test file not found: ${ref.path}`;
  }
  const source = fs.readFileSync(file, 'utf8');
  const call = findTestCall(source, ref.testName);
  if (call === null) {
    return `${ref.raw}: no test named "${ref.testName}" in ${ref.path} (exact test('…')/it('…') string literal required)`;
  }
  if (call.token === 'xit' || call.token === 'xtest') {
    return `${ref.raw}: test "${ref.testName}" is disabled (${call.token}) — evidence must cite a live test`;
  }
  const disabled = /\.(?:skip|only|todo)\b/.exec(call.modifiers);
  if (disabled !== null) {
    return `${ref.raw}: test "${ref.testName}" is disabled (${disabled[0]}) — evidence must cite a live test`;
  }
  if (call.emptyBody) {
    return `${ref.raw}: test "${ref.testName}" has an empty body — an empty test is not evidence`;
  }
  return null;
}

/** Collect job identifiers (keys and display names) from one workflow file. */
function workflowJobNames(file: string): string[] {
  const doc: unknown = YAML.parse(fs.readFileSync(file, 'utf8'));
  if (typeof doc !== 'object' || doc === null) return [];
  const jobs = (doc as Record<string, unknown>)['jobs'];
  if (typeof jobs !== 'object' || jobs === null) return [];
  const names: string[] = [];
  for (const [key, job] of Object.entries(jobs as Record<string, unknown>)) {
    names.push(key);
    if (typeof job === 'object' && job !== null) {
      const display = (job as Record<string, unknown>)['name'];
      if (typeof display === 'string') names.push(display);
    }
  }
  return names;
}

/** `ci:<job>` — a job with that key or display name in .github/workflows/*.yml. */
function resolveCiRef(ref: Extract<EvidenceRef, { kind: 'ci' }>, repoRoot: string): string | null {
  const dir = path.resolve(repoRoot, '.github', 'workflows');
  if (!fs.existsSync(dir)) {
    return `${ref.raw}: no .github/workflows directory`;
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => path.join(dir, f));
  for (const file of files) {
    if (workflowJobNames(file).includes(ref.job)) return null;
  }
  return `${ref.raw}: no CI job named "${ref.job}" in .github/workflows/*.yml`;
}

/** GitHub heading slug: strip markup, lowercase, drop punctuation, spaces→hyphens. */
export function githubSlug(heading: string): string {
  const text = heading
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '');
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

/** All anchors in a markdown file: slugged headings (deduped GitHub-style) + explicit <a id/name>. */
function docAnchors(source: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  let inFence = false;
  for (const line of source.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1] !== undefined) {
      const base = githubSlug(heading[1]);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${count}`);
    }
  }
  for (const m of source.matchAll(/<a\s+(?:id|name)\s*=\s*["']([^"']+)["']/g)) {
    if (m[1] !== undefined) anchors.add(m[1]);
  }
  return anchors;
}

/** `doc:<path>#<anchor>` — file exists and contains the anchor. */
function resolveDocRef(
  ref: Extract<EvidenceRef, { kind: 'doc' }>,
  repoRoot: string,
): string | null {
  const file = path.resolve(repoRoot, ref.path);
  if (!fs.existsSync(file)) {
    return `${ref.raw}: doc file not found: ${ref.path}`;
  }
  const anchors = docAnchors(fs.readFileSync(file, 'utf8'));
  if (!anchors.has(ref.anchor)) {
    return `${ref.raw}: anchor "#${ref.anchor}" not found in ${ref.path} (no matching heading slug or <a id=…>)`;
  }
  return null;
}

/** `eval:<artifact path>` — the artifact file exists. */
function resolveEvalRef(
  ref: Extract<EvidenceRef, { kind: 'eval' }>,
  repoRoot: string,
): string | null {
  if (!fs.existsSync(path.resolve(repoRoot, ref.path))) {
    return `${ref.raw}: eval artifact not found: ${ref.path}`;
  }
  return null;
}

/**
 * `code:<path>#<symbol>[@doc:/regex/]` — the symbol must EXIST in the file, and
 * with `@doc:` its doc-comment must exist and match the regex. This proves the
 * code-anchor (symbol + asserting doc) only; behavior is a `test:` ref's job
 * (see the honesty boundary in this module's header). `null` = resolves.
 */
function resolveCodeRef(
  ref: Extract<EvidenceRef, { kind: 'code' }>,
  repoRoot: string,
): string | null {
  const file = path.resolve(repoRoot, ref.path);
  const result = findSymbol(file, ref.symbol);
  if (!result.found) {
    return `${ref.raw}: no exported/declared symbol "${ref.symbol}" in ${ref.path} (${result.reason ?? 'not found'})`;
  }
  if (ref.docPattern === undefined) return null;
  if (result.doc === undefined) {
    return `${ref.raw}: symbol "${ref.symbol}" has no doc-comment to match /${ref.docPattern}/`;
  }
  let re: RegExp;
  try {
    re = new RegExp(ref.docPattern);
  } catch (err) {
    return `${ref.raw}: invalid @doc regex /${ref.docPattern}/: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (!re.test(result.doc)) {
    return `${ref.raw}: doc-comment of "${ref.symbol}" does not match /${ref.docPattern}/ — code: must anchor a doc that ASSERTS the claim`;
  }
  return null;
}

/** Resolve one evidence ref against the repo. `null` = resolves; string = why not. */
export function resolveEvidence(ref: EvidenceRef, repoRoot: string): string | null {
  switch (ref.kind) {
    case 'test':
      return resolveTestRef(ref, repoRoot);
    case 'ci':
      return resolveCiRef(ref, repoRoot);
    case 'doc':
      return resolveDocRef(ref, repoRoot);
    case 'eval':
      return resolveEvalRef(ref, repoRoot);
    case 'code':
      return resolveCodeRef(ref, repoRoot);
  }
}
