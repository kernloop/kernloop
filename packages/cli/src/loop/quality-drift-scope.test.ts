/**
 * The child quality gate wires the repo's derived-artifact drift checks when
 * the child's writes touch their inputs (#564, closing the #562/DF1 rescue
 * gap: a child edited `claims/registry/CLM-0180.yaml` per its goal, passed
 * its quality gate, and left `docs/CLAIMS.md` stale for CI to catch AFTER
 * merge). This is a REAL end-to-end proof, not a mock: a tiny self-contained
 * fixture repo — a byte-for-byte copy of the actual `scripts/render-claims.mjs`,
 * its own symlinked `yaml`/`prettier`, one claim, and a README — is driven
 * through the real subprocess check the loop's quality node assembles via
 * {@link driftChecksFor}. Mirrors the `quality-doc-scope.test.ts` pattern (#538).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Verdict } from '@kernloop/contracts';
import type { NodeContext } from '@kernloop/workflows';
import { buildLoopExecutors } from './executors.js';
import { boundHelpers, ctxFor, task } from './executors.testkit.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-drift-scope-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const { kernloopFor, bindingsFor } = boundHelpers(scratch);

/** The claim path the fixture repo carries, relative to its own root. */
const CLAIM_REL = path.join('claims', 'registry', 'CLM-9999.yaml');
const CLAIM_V1 =
  'id: CLM-9999\nstatus: verified\nstatement: Fixture claim v1.\nevidence:\n  - ci:test\n';
const CLAIM_V2 =
  'id: CLM-9999\nstatus: verified\nstatement: Fixture claim v2 — EDITED, not re-rendered.\nevidence:\n  - ci:test\n';

/** Symlink a real dependency's install dir into the fixture's own node_modules
 * so the COPIED render-claims.mjs resolves `yaml`/`prettier` regardless of
 * where the OS tmpdir happens to sit relative to this repo checkout. */
function linkRealDep(fixtureNodeModules: string, name: string): void {
  const resolve = createRequire(path.join(repoRoot, 'package.json')).resolve;
  symlinkSync(
    path.dirname(resolve(`${name}/package.json`)),
    path.join(fixtureNodeModules, name),
    'dir',
  );
}

/** Run the fixture's own copy of render-claims.mjs (write mode) — the real regen. */
function renderFixture(root: string): void {
  execFileSync(process.execPath, ['scripts/render-claims.mjs'], { cwd: root });
}

/** A tiny self-contained repo: the real render-claims.mjs, one claim, a README,
 * and a package.json whose `stats:check` trivially passes (#564's stats-drift
 * check also triggers on a claims/registry write; this fixture is isolated to
 * proving the CLAIMS render's real drift detection, not stats.mjs's, which has
 * its own coverage in scripts/__tests__/stats.test.mjs). Rendered once up front
 * so the baseline (CLM-9999 v1) starts clean. */
function seedFixtureRepo(name: string): string {
  const root = path.join(scratch, name);
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  mkdirSync(path.join(root, 'claims', 'registry'), { recursive: true });
  mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  linkRealDep(path.join(root, 'node_modules'), 'yaml');
  linkRealDep(path.join(root, 'node_modules'), 'prettier');
  copyFileSync(
    path.join(repoRoot, 'scripts', 'render-claims.mjs'),
    path.join(root, 'scripts', 'render-claims.mjs'),
  );
  writeFileSync(path.join(root, 'claims', 'registry', 'CLM-9999.yaml'), CLAIM_V1);
  writeFileSync(path.join(root, 'README.md'), '# Fixture\n');
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      private: true,
      scripts: { 'stats:check': 'node -e "process.exit(0)"' },
    }),
  );
  renderFixture(root); // establish the clean v1 baseline
  return root;
}

/** The quality node context for the fan-out child. */
function childCtx(): NodeContext {
  return { ...ctxFor(3), node: 'quality', child: task };
}

/** The check-specific error findings (the runner's generic output-tail fallback, CLM-0031). */
function checkFindings(verdict: Verdict, checkName: string): string[] {
  return verdict.findings.filter((f) => f.message.includes(checkName)).map((f) => f.message);
}

describe('child quality gate wires the claims-render drift check (#564)', () => {
  it('FAILS when the child edited the claim YAML without re-rendering docs/CLAIMS.md, PASSES once rendered', async () => {
    const kern = kernloopFor('drift-scope');
    const ws = seedFixtureRepo('drift-scope-ws');
    const bindings = {
      ...bindingsFor(kern, {
        writtenByChild: { [task.id]: [{ path: CLAIM_REL, content: CLAIM_V2 }] },
      }),
      workspaceDir: ws,
      // Isolate to the checks #564 conditionally adds — the fixture carries
      // no real typecheck/lint/test/doc-comment surface, so the base tool
      // checks would fail unrelatedly and mask the render assertion below.
      checks: [],
    };

    // The child "edits" the claim on disk but never re-renders (the DF1 bug).
    writeFileSync(path.join(ws, 'claims', 'registry', 'CLM-9999.yaml'), CLAIM_V2);

    const failing = (await buildLoopExecutors(bindings)['quality']?.(
      undefined,
      childCtx(),
    )) as Verdict;
    expect(failing.result).toBe('fail');
    expect(checkFindings(failing, 'claims-render-drift').length).toBeGreaterThan(0);

    // Regenerate for real (what the child SHOULD have done), then re-run the
    // identical gate over the identical workspace.
    renderFixture(ws);
    const passing = (await buildLoopExecutors(bindings)['quality']?.(
      undefined,
      childCtx(),
    )) as Verdict;
    expect(checkFindings(passing, 'claims-render-drift')).toEqual([]);
    expect(passing.result).toBe('pass');
    kern.close();
  }, 30_000);
});
