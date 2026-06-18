/**
 * Artifact-level skill fitness attribution (#228 P3·2, CLM-0140). The loop
 * records the skills whose body SURVIVED into the brief against the run Outcome,
 * as a correlational, records-only fitness signal — budget-dropped and
 * proposed/ skills are never attributed, attribution fires once per run, and a
 * skill subject is INERT for routing (never a manifest).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { OutcomeSchema, type Brief, type Outcome } from '@kernloop/contracts';
import { compileBrief } from '@kernloop/faculty-compiler';
import { readEnvelopes } from '../tools/audit.js';
import { runTool } from '../tools/run.js';
import { attributeSkillFitness, survivingSkillNames } from './skill-attribution.js';
import { boundHelpers, task } from './executors.testkit.js';
import {
  GREET_TS,
  fixtureRepo as makeFixtureRepo,
  kernloopFor as loopKernloopFor,
  scriptedInvoke,
  typecheck,
} from '../loop-fixtures.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-skillattr-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const { kernloopFor, bindingsFor } = boundHelpers(scratch);

/** A compiled brief carrying one skill body, under a budget that keeps (big) or drops (tiny) it. */
function briefWithSkill(name: string, body: string, totalTokens: number): Brief {
  return compileBrief({
    task,
    sources: { skillBodies: [{ name, body }] },
    budget: { totalTokens },
  });
}

const outcome = (status: Outcome['status']): Outcome =>
  OutcomeSchema.parse({
    taskId: 'task-attr',
    status,
    signals: [],
    cost: { tokens: 1, usd: 0 },
    traceRef: 'audit:x#task=task-attr',
    distillCandidates: [],
  });

describe('survivingSkillNames (#228 P3·2)', () => {
  it('reads the skills whose body survived into the brief', () => {
    expect(survivingSkillNames(briefWithSkill('release-flow', 'Step 1\nStep 2', 10_000))).toEqual([
      'release-flow',
    ]);
  });

  it('returns nothing when the body was DROPPED by the budget (never presented ⇒ never attributed)', () => {
    // The lowest-priority skillBodies section drops first; the big body cannot fit.
    const dropped = briefWithSkill('release-flow', 'x'.repeat(4000), 40);
    expect(dropped.sections.some((s) => s.name === 'skillBodies')).toBe(false);
    expect(survivingSkillNames(dropped)).toEqual([]);
  });

  it('is empty for an absent brief or a brief with no skill bodies', () => {
    expect(survivingSkillNames(undefined)).toEqual([]);
    expect(survivingSkillNames(compileBrief({ task, budget: { totalTokens: 10_000 } }))).toEqual(
      [],
    );
  });
});

describe('attributeSkillFitness (#228 P3·2, CLM-0140)', () => {
  it('records a correlational fitness row + an audit event, and the skill is INERT for routing', () => {
    const kern = kernloopFor('attr-success');
    const b = bindingsFor(kern);
    b.refs.researchBrief = briefWithSkill('release-flow', 'Step 1: tag', 10_000);

    attributeSkillFitness(b, 'run-ok', outcome('success'));

    const rec = kern.observer.fitness('skill:release-flow');
    expect(rec?.invocations).toBe(1);
    expect(rec?.successRate).toBe(1); // success outcome ⇒ a success-correlated row
    const events = readEnvelopes(kern.paths.audit).filter(
      (e) => e.type === 'loop.skill.attributed',
    );
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as { skills: string[] }).skills).toEqual(['release-flow']);
    // Routing-inertness (the sacred ladder): the subject never became a routable manifest.
    expect(kern.registry.list().some((m) => m.name === 'skill:release-flow')).toBe(false);
    kern.close();
  });

  it('a failing run records a 0-success row (the correlation is honest, not flattering)', () => {
    const kern = kernloopFor('attr-fail');
    const b = bindingsFor(kern);
    b.refs.researchBrief = briefWithSkill('release-flow', 'Step 1', 10_000);
    attributeSkillFitness(b, 'run-bad', outcome('failure'));
    expect(kern.observer.fitness('skill:release-flow')?.successRate).toBe(0);
    kern.close();
  });

  it('fires EXACTLY ONCE per run — a re-run (resume) does not double-count', () => {
    const kern = kernloopFor('attr-idempotent');
    const b = bindingsFor(kern);
    b.refs.researchBrief = briefWithSkill('release-flow', 'Step 1', 10_000);
    attributeSkillFitness(b, 'run-x', outcome('success'));
    attributeSkillFitness(b, 'run-x', outcome('success')); // resume re-runs retrospect
    expect(kern.observer.fitness('skill:release-flow')?.invocations).toBe(1); // not 2
    expect(
      readEnvelopes(kern.paths.audit).filter((e) => e.type === 'loop.skill.attributed'),
    ).toHaveLength(1);
    kern.close();
  });

  it('attributes nothing (no row, no event) when no skill body reached the brief', () => {
    const kern = kernloopFor('attr-none');
    const b = bindingsFor(kern);
    b.refs.researchBrief = compileBrief({ task, budget: { totalTokens: 10_000 } });
    attributeSkillFitness(b, 'run-none', outcome('success'));
    expect(kern.observer.fitnessLedger()).toHaveLength(0);
    expect(readEnvelopes(kern.paths.audit).some((e) => e.type === 'loop.skill.attributed')).toBe(
      false,
    );
    kern.close();
  });
});

describe('end to end: a real canonical-loop run attributes its injected skill (#228 P3·2)', () => {
  it('a run whose brief carried a live skill records that skill against the outcome', async () => {
    const repo = makeFixtureRepo(scratch, 'attr-e2e');
    // A live skill whose name/one-liner overlaps the goal "add a greet feature".
    mkdirSync(path.join(repo, 'skills', 'greet-helper'), { recursive: true });
    writeFileSync(
      path.join(repo, 'skills', 'greet-helper', 'SKILL.md'),
      '# greet-helper\n\nhow to write a greet feature in TypeScript\n\nStep 1: export greet(name).\n',
    );
    const kern = loopKernloopFor(repo);
    await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'e2e-attr',
      },
      {
        checks: [typecheck],
        invoke: scriptedInvoke({
          vote: () => 'approve',
          files: [{ path: 'src/greet.ts', content: GREET_TS }],
        }),
      },
    );
    const attributed = readEnvelopes(kern.paths.audit).filter(
      (e) => e.type === 'loop.skill.attributed',
    );
    expect(attributed).toHaveLength(1);
    expect((attributed[0]!.payload as { skills: string[] }).skills).toContain('greet-helper');
    expect(kern.observer.fitness('skill:greet-helper')?.invocations).toBe(1);
    kern.close();
  }, 120_000);
});
