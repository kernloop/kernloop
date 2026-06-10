import { describe, expect, it } from 'vitest';
import type { TaskContract } from '@kernloop/contracts';
import {
  DROP_NOTICE_REF,
  SECTION_NAMES,
  compileBrief,
  estimateTokens,
  type BriefSources,
} from './index.js';

function makeTask(): TaskContract {
  return {
    id: 't-budget',
    goal: 'exercise the hard token budget',
    constraints: ['stay deterministic'],
    budget: { tokens: 50_000, usd: 1, wallClockMin: 30 },
    evidence: [],
    definitionOfDone: [{ name: 'tests', command: 'pnpm test' }],
    authorityCeiling: 'observe',
    overlay: 'kernloop',
  };
}

function fullSources(): BriefSources {
  return {
    claims: [
      { id: 'CLM-0001', statement: 'first claim statement', status: 'verified' },
      { id: 'CLM-0002', statement: 'second claim statement', status: 'planned' },
    ],
    semanticFacts: [
      { fact: 'fact one about the repo', provenance: 'fact:one' },
      { fact: 'fact two about the repo', provenance: 'fact:two' },
    ],
    episodicSummaries: [{ taskId: 't-0', summary: 'previous task summary', traceRef: 'trace-0' }],
    repoProbes: [{ name: 'git status', content: 'clean working tree', source: 'git' }],
    skillsIndex: [
      { name: 'release', oneLiner: 'cut a release safely' },
      { name: 'triage', oneLiner: 'order the backlog' },
    ],
  };
}

const SKILL_LINES = ['sk-a', 'sk-b', 'sk-c', 'sk-d', 'sk-e'].map(
  (name) => `${name}: ${'x'.repeat(14)}`,
);

function skillSources(): BriefSources {
  return {
    skillsIndex: ['sk-a', 'sk-b', 'sk-c', 'sk-d', 'sk-e'].map((name) => ({
      name,
      oneLiner: 'x'.repeat(14),
    })),
  };
}

describe('priority-ordered budget drop', () => {
  it('sections drop in reverse priority order as the total budget shrinks', () => {
    const full = compileBrief({
      task: makeTask(),
      sources: fullSources(),
      budget: { totalTokens: 100_000 },
    });
    const fullNames = full.sections.map((s) => s.name);
    expect(fullNames).toEqual([...SECTION_NAMES]);
    for (let keep = 5; keep >= 1; keep -= 1) {
      const totalTokens = full.sections.slice(0, keep).reduce((acc, s) => acc + s.tokens, 0);
      const brief = compileBrief({
        task: makeTask(),
        sources: fullSources(),
        budget: { totalTokens },
      });
      expect(brief.sections.map((s) => s.name)).toEqual(fullNames.slice(0, keep));
      for (const section of brief.sections) {
        expect(section.content).not.toContain('[budget:');
      }
    }
  });

  it('surviving sections always form a priority-order prefix at every budget', () => {
    const full = compileBrief({
      task: makeTask(),
      sources: fullSources(),
      budget: { totalTokens: 100_000 },
    });
    const fullNames = full.sections.map((s) => s.name);
    for (let totalTokens = 0; totalTokens <= full.budget.used + 5; totalTokens += 3) {
      const brief = compileBrief({
        task: makeTask(),
        sources: fullSources(),
        budget: { totalTokens },
      });
      const names = brief.sections.map((s) => s.name);
      expect(names).toEqual(fullNames.slice(0, names.length));
      expect(brief.budget.used).toBeLessThanOrEqual(totalTokens);
    }
  });

  it('a zero total budget yields an empty, schema-valid brief', () => {
    const brief = compileBrief({
      task: makeTask(),
      sources: fullSources(),
      budget: { totalTokens: 0 },
    });
    expect(brief.sections).toEqual([]);
    expect(brief.budget).toEqual({ allotted: 0, used: 0 });
  });

  it('when the total budget is exhausted lower-priority sections drop even if tiny', () => {
    const task = makeTask();
    const taskOnly = compileBrief({ task, budget: { totalTokens: 100_000 } });
    const taskTokens = taskOnly.budget.used;
    const sources: BriefSources = {
      semanticFacts: [{ fact: 'F'.repeat(800), provenance: 'fact:big' }],
      skillsIndex: [{ name: 's', oneLiner: 'tiny' }],
    };
    const brief = compileBrief({ task, sources, budget: { totalTokens: taskTokens + 20 } });
    expect(brief.sections.map((s) => s.name)).toEqual(['task']);
  });
});

describe('per-section caps', () => {
  it('per-section caps drop whole items from the end and record the drop in the section', () => {
    const notice = '[budget: dropped 3 of 5 items]';
    const cap = estimateTokens([SKILL_LINES[0], SKILL_LINES[1], notice].join('\n'));
    const brief = compileBrief({
      task: makeTask(),
      sources: skillSources(),
      budget: { totalTokens: 100_000, perSection: { skillsIndex: cap } },
    });
    const skills = brief.sections.find((s) => s.name === 'skillsIndex');
    expect(skills?.content.split('\n')).toEqual([SKILL_LINES[0], SKILL_LINES[1], notice]);
    expect(skills?.tokens).toBeLessThanOrEqual(cap);
    expect(skills?.provenance).toEqual([
      { ref: 'skill:sk-a' },
      { ref: 'skill:sk-b' },
      { ref: DROP_NOTICE_REF },
    ]);
  });

  it('truncation is item-granular: kept lines are whole rendered items, never chopped', () => {
    for (let cap = 1; cap <= 30; cap += 1) {
      const brief = compileBrief({
        task: makeTask(),
        sources: skillSources(),
        budget: { totalTokens: 100_000, perSection: { skillsIndex: cap } },
      });
      const skills = brief.sections.find((s) => s.name === 'skillsIndex');
      if (skills === undefined) continue;
      const lines = skills.content.split('\n');
      const last = lines[lines.length - 1];
      const kept = last?.startsWith('[budget:') === true ? lines.slice(0, -1) : lines;
      expect(kept).toEqual(SKILL_LINES.slice(0, kept.length));
      expect(kept.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('a per-section cap of zero drops that section without starving lower-priority ones', () => {
    const brief = compileBrief({
      task: makeTask(),
      sources: fullSources(),
      budget: { totalTokens: 100_000, perSection: { claims: 0 } },
    });
    expect(brief.sections.map((s) => s.name)).toEqual([
      'task',
      'semanticFacts',
      'episodicSummaries',
      'repoProbes',
      'skillsIndex',
    ]);
  });

  it('the task section itself respects the hard budget and records its truncation', () => {
    const task: TaskContract = {
      ...makeTask(),
      constraints: Array.from({ length: 10 }, (_, i) => `constraint number ${i} with padding`),
    };
    const full = compileBrief({ task, budget: { totalTokens: 100_000 } });
    const totalTokens = full.budget.used - 10;
    const brief = compileBrief({ task, budget: { totalTokens } });
    const section = brief.sections[0];
    expect(brief.sections).toHaveLength(1);
    expect(section?.tokens).toBeLessThanOrEqual(totalTokens);
    expect(section?.content).toMatch(/\[budget: dropped \d+ of \d+ items\]$/);
    expect(section?.content.startsWith('Goal: exercise the hard token budget')).toBe(true);
    expect(section?.provenance).toEqual([{ ref: 'task:t-budget' }, { ref: DROP_NOTICE_REF }]);
  });
});
