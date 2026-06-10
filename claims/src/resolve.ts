/**
 * Evidence resolvers for `claims:check`. Each resolver answers one question:
 * does this evidence reference point at something that exists in the tree
 * RIGHT NOW? Resolvers return `null` on success or a precise error message.
 *
 * NOTE on "test passes" semantics: the test resolver verifies the referenced
 * test EXISTS by exact name in the referenced file. The CI pipeline orders
 * the `claims:check` job after the test job, so a green `claims:check` run
 * implies the referenced tests also ran green — existence here plus ordering
 * there is what makes a claim's test evidence mean "passing test".
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { EvidenceRef } from './schema.js';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `test:<path>::<name>` — the file must exist and contain a `test('name')`,
 * `it('name')`, or parameterized `test.each(…)('name')` / `it.each(…)('name')`
 * call with that exact name as a plain string literal (single or double
 * quotes; for `.each` the literal printf-style template, e.g. `seed %i: …`,
 * is the name). Template-literal test names are deliberately unresolvable:
 * a name the checker cannot read statically is not evidence.
 */
function resolveTestRef(
  ref: Extract<EvidenceRef, { kind: 'test' }>,
  repoRoot: string,
): string | null {
  const file = path.resolve(repoRoot, ref.path);
  if (!fs.existsSync(file)) {
    return `${ref.raw}: test file not found: ${ref.path}`;
  }
  const source = fs.readFileSync(file, 'utf8');
  const pattern = new RegExp(
    `\\b(?:test|it)(?:\\.each\\([^)]*\\))?\\(\\s*(['"])${escapeRegExp(ref.testName)}\\1`,
  );
  if (!pattern.test(source)) {
    return `${ref.raw}: no test named "${ref.testName}" in ${ref.path} (exact test('…')/it('…') string literal required)`;
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
  }
}
