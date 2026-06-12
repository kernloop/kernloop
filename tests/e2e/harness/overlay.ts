/**
 * Fresh per-test overlay scaffolding for the e2e suite. `freshOverlay` mkdtemps
 * a repo dir and runs the REAL `kernloop init` (no init mock); `withTracker`
 * appends a `tracker:` block at the requested tier while PRESERVING the id that
 * init wrote; `writeSpec` writes a story-spec JSON file; `auditEvents` reads and
 * parses the real `.kernloop/audit.jsonl` chain. Every temp dir is registered
 * for {@link cleanupOverlays} (call it from `afterEach`).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from './run-cli.js';

/** The tracker authority tiers the e2e overlay writes. */
export type TrackerTier = 'suggest' | 'enforce';

/** Temp repo dirs created this run; {@link cleanupOverlays} removes them. */
const overlayDirs: string[] = [];

/** A parsed audit envelope (the fields the e2e assertions read). */
export interface AuditEnvelope {
  readonly seq: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

/** mkdtemp a repo dir, run the REAL `kernloop init`, register it for cleanup. */
export function freshOverlay(): string {
  const repoDir = mkdtempSync(path.join(tmpdir(), 'kernloop-e2e-repo-'));
  overlayDirs.push(repoDir);
  const result = runCli(['init'], { cwd: repoDir });
  if (result.code !== 0) {
    throw new Error(`kernloop init failed (exit ${String(result.code)}): ${result.stderr}`);
  }
  return repoDir;
}

/** Read the id `init` wrote into overlay.yaml (the first `id:` line). */
function readOverlayId(repoDir: string): string {
  const text = readFileSync(path.join(repoDir, '.kernloop', 'overlay.yaml'), 'utf8');
  const match = /^id:\s*(\S+)/m.exec(text);
  return match?.[1] ?? path.basename(repoDir);
}

/**
 * A deliberately NON-EXISTENT sandbox repo for every e2e overlay. The hermetic
 * gh stub is the primary barrier against touching real GitHub, but the repo is
 * fake as DEFENSE IN DEPTH: if the stub ever fails to intercept (PATH dropped,
 * stub non-executable), a real `gh issue create --repo kernloop-e2e/sandbox`
 * errors (repo not found / unauthenticated) instead of mutating a LIVE repo.
 */
export const E2E_SANDBOX_REPO = 'kernloop-e2e/sandbox';

/**
 * Rewrite the overlay with a `tracker:` block at `tier`, preserving the id init
 * derived. The minimal `id + tracker` overlay is byte-valid (every other field
 * defaults), matching the format the tracker CLI test uses. `program emit`
 * REQUIRES a tracker block — without one it exits 1 ("no tracker configured") —
 * so even the suggest-tier dry-run scenarios call this first. The repo defaults
 * to the fake {@link E2E_SANDBOX_REPO} — never a live repo.
 */
export function withTracker(repoDir: string, tier: TrackerTier, repo = E2E_SANDBOX_REPO): void {
  const id = readOverlayId(repoDir);
  writeFileSync(
    path.join(repoDir, '.kernloop', 'overlay.yaml'),
    `id: ${id}\ntracker:\n  provider: github\n  repo: ${repo}\n  tier: ${tier}\n`,
    'utf8',
  );
}

/** Write a story-spec JSON array to `<repoDir>/<name>` and return its abs path. */
export function writeSpec(repoDir: string, specs: unknown, name = 'spec.json'): string {
  const file = path.join(repoDir, name);
  writeFileSync(file, JSON.stringify(specs, null, 2), 'utf8');
  return file;
}

/** Read + parse the real `.kernloop/audit.jsonl` chain into envelopes. */
export function auditEvents(repoDir: string): AuditEnvelope[] {
  const file = path.join(repoDir, '.kernloop', 'audit.jsonl');
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as AuditEnvelope);
}

/** The raw audit.jsonl text (for verbatim-leak assertions and tampering). */
export function auditText(repoDir: string): string {
  return readFileSync(path.join(repoDir, '.kernloop', 'audit.jsonl'), 'utf8');
}

/** Overwrite the audit.jsonl text (used by the tamper invariant). */
export function writeAuditText(repoDir: string, text: string): void {
  writeFileSync(path.join(repoDir, '.kernloop', 'audit.jsonl'), text, 'utf8');
}

/** Remove every temp overlay dir created this run — call from `afterEach`. */
export function cleanupOverlays(): void {
  for (const dir of overlayDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}
