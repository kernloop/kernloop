/**
 * The child quality gate is scoped to the child's OWN written files (#534,
 * CLM-0189): buildLoopExecutors' quality node passes the child's
 * `writtenByChild` emission into the gate, so the default doc-comment check
 * judges only what the child wrote — a pre-existing repo-wide doc gap cannot
 * fail the child. A run-level (no-child) quality gate keeps the whole-workspace
 * scan (the standalone `gate quality` semantics).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Verdict } from '@kernloop/contracts';
import type { NodeContext, RunState } from '@kernloop/workflows';
import { buildLoopExecutors, type LoopRefs } from './executors.js';
import type { LoopInvoke } from './invoke.js';
import { primeWrittenByChild } from './resume-prime.js';
import { COST, boundHelpers, ctxFor, task } from './executors.testkit.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-doc-scope-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const { kernloopFor, bindingsFor } = boundHelpers(scratch);

/** A workspace holding a PRE-EXISTING undocumented export the child never
 * touched, plus the (also undocumented) file the child wrote. */
function seededWorkspace(name: string): string {
  const ws = path.join(scratch, name);
  mkdirSync(path.join(ws, 'src'), { recursive: true });
  writeFileSync(path.join(ws, 'pre-existing.ts'), 'export function legacy() {}\n');
  writeFileSync(path.join(ws, 'src', 'child.ts'), 'export function fresh() {}\n');
  return ws;
}

/** The quality node context for the fan-out child. */
function childCtx(): NodeContext {
  return { ...ctxFor(3), node: 'quality', child: task };
}

/** Only the doc-comment findings of a verdict (tool checks fail separately here). */
function docFindings(verdict: Verdict): string[] {
  return verdict.findings
    .filter((f) => f.message.includes('has no doc-comment'))
    .map((f) => f.message);
}

describe('child quality gate doc-comment scoping (#534) [CLM-0189]', () => {
  it('the child quality gate ignores a pre-existing undocumented export outside the child writes (#534)', async () => {
    const kern = kernloopFor('doc-scope-child');
    const bindings = {
      ...bindingsFor(kern, {
        writtenByChild: {
          [task.id]: [
            { path: path.join('src', 'child.ts'), content: 'export function fresh() {}\n' },
          ],
        },
      }),
      workspaceDir: seededWorkspace('doc-scope-child-ws'),
    };
    const verdict = (await buildLoopExecutors(bindings)['quality']?.(
      undefined,
      childCtx(),
    )) as Verdict;
    const docs = docFindings(verdict);
    // The child IS still judged on what it wrote…
    expect(docs.some((m) => m.includes('"fresh"'))).toBe(true);
    // …but the pre-existing repo-wide gap is not the child's to own (#534).
    expect(docs.some((m) => m.includes('"legacy"'))).toBe(false);
    kern.close();
  });

  it('a run-level (no-child) quality gate keeps the whole-workspace doc scan', async () => {
    const kern = kernloopFor('doc-scope-run');
    const bindings = { ...bindingsFor(kern), workspaceDir: seededWorkspace('doc-scope-run-ws') };
    const verdict = (await buildLoopExecutors(bindings)['quality']?.(
      {},
      {
        ...ctxFor(3),
        node: 'quality',
      },
    )) as Verdict;
    const docs = docFindings(verdict);
    expect(docs.some((m) => m.includes('"legacy"'))).toBe(true);
    expect(docs.some((m) => m.includes('"fresh"'))).toBe(true);
    kern.close();
  });

  it('with NO written-files stash (a resume), the child gate falls back to the whole-workspace scan (fail closed)', async () => {
    // writtenByChild is NOT checkpointed. A resume landing after implement has no
    // stash entry for the child — that must NOT read as "child owns nothing":
    // the gate falls back to the whole-workspace scan, never silently skipping
    // files the child really wrote (the review-round blocking finding).
    const kern = kernloopFor('doc-scope-resume');
    const bindings = {
      ...bindingsFor(kern, {}), // empty refs: no writtenByChild at all
      workspaceDir: seededWorkspace('doc-scope-resume-ws'),
    };
    const verdict = (await buildLoopExecutors(bindings)['quality']?.(
      undefined,
      childCtx(),
    )) as Verdict;
    const docs = docFindings(verdict);
    expect(docs.some((m) => m.includes('"legacy"'))).toBe(true);
    expect(docs.some((m) => m.includes('"fresh"'))).toBe(true);
    kern.close();
  });

  it('the doc scope is the UNION of the child emissions across iterations — a re-emit cannot narrow it (#534)', async () => {
    // Iteration 1 writes an UNDOCUMENTED a.ts; iteration 2 re-emits ONLY a
    // documented b.ts. If the stash were the LAST emission, the child would
    // converge past its own undocumented a.ts — the scope must be the union.
    const kern = kernloopFor('doc-scope-union');
    const ws = path.join(scratch, 'doc-scope-union-ws');
    mkdirSync(ws, { recursive: true });
    writeFileSync(path.join(ws, 'pre-existing.ts'), 'export function legacy() {}\n');
    let calls = 0;
    const invoke: LoopInvoke = () => {
      calls += 1;
      const files =
        calls === 1
          ? [{ path: 'src/a.ts', content: 'export function alpha() {}\n' }]
          : [{ path: 'src/b.ts', content: '/** Beta. */\nexport function beta() {}\n' }];
      return Promise.resolve({ output: JSON.stringify({ files }), cost: COST });
    };
    const refs: LoopRefs = {};
    const bindings = { ...bindingsFor(kern, refs, invoke), workspaceDir: ws };
    const executors = buildLoopExecutors(bindings);
    const implCtx = { ...ctxFor(3), node: 'implement', child: task };
    await executors['implement']?.(task, implCtx); // iteration 1: writes a.ts
    await executors['implement']?.(task, implCtx); // iteration 2: re-emits only b.ts
    const verdict = (await executors['quality']?.(undefined, childCtx())) as Verdict;
    const docs = docFindings(verdict);
    // The iteration-1 undocumented write is STILL the child's to own…
    expect(docs.some((m) => m.includes('"alpha"'))).toBe(true);
    // …the documented iteration-2 file is clean, and the scope still excludes
    // the pre-existing repo gap.
    expect(docs.some((m) => m.includes('"beta"'))).toBe(false);
    expect(docs.some((m) => m.includes('"legacy"'))).toBe(false);
    kern.close();
  });

  it('an absent-stash gate TAINTS the child whole-workspace for the rest of the run', async () => {
    // Resume hole (round-4 blocking finding): after the fail-closed whole-
    // workspace pass, a post-resume re-iteration repopulates the stash with a
    // FRESH PARTIAL emission that omits pre-crash writes. The taint must keep
    // the gate whole-workspace for the rest of the run (#543 tracks the
    // durable checkpoint fix).
    const kern = kernloopFor('doc-scope-taint');
    const ws = path.join(scratch, 'doc-scope-taint-ws');
    mkdirSync(ws, { recursive: true });
    writeFileSync(path.join(ws, 'pre-existing.ts'), 'export function legacy() {}\n');
    const invoke: LoopInvoke = () =>
      Promise.resolve({
        output: JSON.stringify({
          files: [{ path: 'src/clean.ts', content: '/** Clean. */\nexport const clean = 1;\n' }],
        }),
        cost: COST,
      });
    const refs: LoopRefs = {}; // a resume: no stash for the child
    const executors = buildLoopExecutors({
      ...bindingsFor(kern, refs, invoke),
      workspaceDir: ws,
    });
    // 1: absent stash → whole-workspace fallback (and the child is tainted).
    const first = (await executors['quality']?.(undefined, childCtx())) as Verdict;
    expect(docFindings(first).some((m) => m.includes('"legacy"'))).toBe(true);
    // 2: the re-iteration stashes a fresh (clean, partial) emission…
    await executors['implement']?.(task, { ...ctxFor(3), node: 'implement', child: task });
    expect(refs.writtenByChild?.[task.id]).toHaveLength(1);
    // 3: …but the tainted child's gate STAYS whole-workspace — the pre-crash
    // write (represented by pre-existing.ts) is still judged.
    const second = (await executors['quality']?.(undefined, childCtx())) as Verdict;
    expect(docFindings(second).some((m) => m.includes('"legacy"'))).toBe(true);
    kern.close();
  });

  it('a resume with CHECKPOINTED writtenPaths rebuilds the stash and SCOPES — no whole-workspace fallback (#543, CLM-0199)', async () => {
    // Mirrors the #538 round-4 resume test above, but this time the run's
    // checkpoint carries the child's durable writtenPaths (#543): the resume
    // priming seam rebuilds refs.writtenByChild from it BEFORE the quality
    // gate ever asks, so childGateScope never sees an absent stash and never
    // taints the child whole-workspace.
    const kern = kernloopFor('doc-scope-resume-checkpoint');
    const ws = seededWorkspace('doc-scope-resume-checkpoint-ws');
    const refs: LoopRefs = {}; // empty in-memory stash — exactly what a resume starts with
    const checkpointed: RunState = {
      task,
      status: 'running',
      cursor: { phase: 'fanout', childIndex: 0, sub: 1 },
      iteration: 0,
      values: {},
      findings: [],
      children: [task],
      childResults: [
        { child: task, iteration: 0, findings: [], writtenPaths: [path.join('src', 'child.ts')] },
      ],
      trace: [],
      observedMaxNodeSpend: { tokens: 0, usd: 0 },
    };
    primeWrittenByChild(refs, checkpointed, ws);
    const bindings = { ...bindingsFor(kern, refs), workspaceDir: ws };
    const verdict = (await buildLoopExecutors(bindings)['quality']?.(
      undefined,
      childCtx(),
    )) as Verdict;
    const docs = docFindings(verdict);
    // The child IS still judged on what the checkpoint says it wrote…
    expect(docs.some((m) => m.includes('"fresh"'))).toBe(true);
    // …but it is NOT whole-workspace: the pre-existing gap is not the child's to own.
    expect(docs.some((m) => m.includes('"legacy"'))).toBe(false);
    kern.close();
  });

  it('a PRESENT-but-empty stash entry (the child wrote nothing) judges nothing', async () => {
    const kern = kernloopFor('doc-scope-empty');
    const bindings = {
      ...bindingsFor(kern, { writtenByChild: { [task.id]: [] } }),
      workspaceDir: seededWorkspace('doc-scope-empty-ws'),
    };
    const verdict = (await buildLoopExecutors(bindings)['quality']?.(
      undefined,
      childCtx(),
    )) as Verdict;
    expect(docFindings(verdict)).toEqual([]);
    kern.close();
  });
});
