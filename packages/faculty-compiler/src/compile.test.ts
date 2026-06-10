import { describe, expect, it } from 'vitest';
import { BriefSchema, type TaskContract } from '@kernloop/contracts';
import { COMPILER_VERSION, compileBrief, type BriefSources } from './index.js';

function makeTask(): TaskContract {
  return {
    id: 't-1',
    goal: 'ship the deterministic context compiler',
    constraints: ['no I/O in the compile path', 'imports contracts only'],
    budget: { tokens: 50_000, usd: 1, wallClockMin: 30 },
    evidence: [{ kind: 'test', ref: 'test:packages/faculty-compiler/src/compile.test.ts::x' }],
    definitionOfDone: [{ name: 'tests', command: 'pnpm test' }],
    authorityCeiling: 'observe',
    overlay: 'kernloop',
  };
}

function fullSources(): BriefSources {
  return {
    claims: [
      { id: 'CLM-0029', statement: 'compiler is deterministic', status: 'planned' },
      { id: 'CLM-0030', statement: 'budgets are hard with priority drop', status: 'planned' },
    ],
    semanticFacts: [
      { fact: 'repo uses pnpm workspaces', provenance: 'fact:repo/tooling', confidence: 0.9 },
      { fact: 'node 22 is the floor', provenance: 'fact:repo/engines' },
    ],
    episodicSummaries: [
      { taskId: 't-0', summary: 'memory faculty landed green', traceRef: 'trace-0' },
    ],
    repoProbes: [{ name: 'git status', content: 'clean working tree', source: 'git' }],
    skillsIndex: [
      { name: 'release', oneLiner: 'cut a release safely' },
      { name: 'triage', oneLiner: 'order the backlog by claims' },
    ],
  };
}

describe('compileBrief', () => {
  it('identical inputs produce byte-identical briefs across repeated compiles', () => {
    const a = compileBrief({
      task: makeTask(),
      sources: fullSources(),
      budget: { totalTokens: 500 },
    });
    const b = compileBrief({
      task: makeTask(),
      sources: fullSources(),
      budget: { totalTokens: 500 },
    });
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('permuted input object key order produces a byte-identical brief', () => {
    const t = makeTask();
    const permutedTask = {
      overlay: t.overlay,
      authorityCeiling: t.authorityCeiling,
      definitionOfDone: t.definitionOfDone,
      evidence: t.evidence,
      budget: { wallClockMin: t.budget.wallClockMin, usd: t.budget.usd, tokens: t.budget.tokens },
      constraints: t.constraints,
      goal: t.goal,
      id: t.id,
    };
    const s = fullSources();
    const permutedSources = {
      skillsIndex: s.skillsIndex,
      repoProbes: s.repoProbes,
      episodicSummaries: s.episodicSummaries,
      semanticFacts: s.semanticFacts,
      claims: s.claims,
    };
    const a = compileBrief({ task: t, sources: s, budget: { totalTokens: 500 } });
    const b = compileBrief({
      budget: { totalTokens: 500 },
      sources: permutedSources,
      task: permutedTask,
    });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('brief.compilerVersion is the pinned COMPILER_VERSION constant', () => {
    const brief = compileBrief({ task: makeTask(), budget: { totalTokens: 500 } });
    expect(COMPILER_VERSION).toBe('0.1.0');
    expect(brief.compilerVersion).toBe(COMPILER_VERSION);
  });

  it('an explicit compilerVersion overrides the pinned default', () => {
    const brief = compileBrief({
      task: makeTask(),
      budget: { totalTokens: 500 },
      compilerVersion: '0.1.0-rc.1',
    });
    expect(brief.compilerVersion).toBe('0.1.0-rc.1');
  });

  it('every compiled section carries at least one provenance source', () => {
    const brief = compileBrief({
      task: makeTask(),
      sources: fullSources(),
      budget: { totalTokens: 5000 },
    });
    expect(brief.sections).toHaveLength(6);
    for (const section of brief.sections) {
      expect(section.provenance.length).toBeGreaterThanOrEqual(1);
    }
    const refs = Object.fromEntries(
      brief.sections.map((s) => [s.name, s.provenance.map((p) => p.ref)]),
    );
    expect(refs['task']).toEqual(['task:t-1']);
    expect(refs['claims']).toEqual(['claim:CLM-0029', 'claim:CLM-0030']);
    expect(refs['semanticFacts']).toEqual(['fact:repo/tooling', 'fact:repo/engines']);
    expect(refs['episodicSummaries']).toEqual(['trace:trace-0']);
    expect(refs['repoProbes']).toEqual(['probe:git']);
    expect(refs['skillsIndex']).toEqual(['skill:release', 'skill:triage']);
  });

  it('empty sources yield a brief with only the task section', () => {
    const omitted = compileBrief({ task: makeTask(), budget: { totalTokens: 500 } });
    const explicit = compileBrief({ task: makeTask(), sources: {}, budget: { totalTokens: 500 } });
    for (const brief of [omitted, explicit]) {
      expect(brief.sections.map((s) => s.name)).toEqual(['task']);
      expect(brief.sections[0]?.priority).toBe(1);
      expect(brief.sections[0]?.content).toContain('Goal: ship the deterministic context compiler');
      expect(brief.sections[0]?.content).toContain('Constraint: no I/O in the compile path');
      expect(brief.sections[0]?.content).toContain('Done: tests (pnpm test)');
    }
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(omitted));
  });

  it('the compiled brief validates against BriefSchema', () => {
    const brief = compileBrief({
      task: makeTask(),
      sources: fullSources(),
      budget: { totalTokens: 5000 },
    });
    const result = BriefSchema.safeParse(brief);
    expect(result.success).toBe(true);
    expect(brief.taskId).toBe('t-1');
  });

  it('budget.used equals the sum of section token estimates and never exceeds allotted', () => {
    for (const totalTokens of [0, 25, 60, 5000]) {
      const brief = compileBrief({
        task: makeTask(),
        sources: fullSources(),
        budget: { totalTokens },
      });
      const sum = brief.sections.reduce((acc, s) => acc + s.tokens, 0);
      expect(brief.budget).toEqual({ allotted: totalTokens, used: sum });
      expect(brief.budget.used).toBeLessThanOrEqual(totalTokens);
    }
  });

  it('semantic facts preserve caller-provided ranking order and render confidence when present', () => {
    const brief = compileBrief({
      task: makeTask(),
      sources: fullSources(),
      budget: { totalTokens: 5000 },
    });
    const facts = brief.sections.find((s) => s.name === 'semanticFacts');
    expect(facts?.content.split('\n')).toEqual([
      'repo uses pnpm workspaces (confidence: 0.9)',
      'node 22 is the floor',
    ]);
  });

  it('rejects malformed inputs at the boundary', () => {
    const task = makeTask();
    expect(() =>
      compileBrief({ task: { ...task, goal: '' }, budget: { totalTokens: 100 } }),
    ).toThrow();
    expect(() => compileBrief({ task, budget: { totalTokens: -1 } })).toThrow();
    expect(() =>
      compileBrief({
        task,
        sources: { semanticFacts: [{ fact: 'no provenance', provenance: '' }] },
        budget: { totalTokens: 100 },
      }),
    ).toThrow();
  });
});
