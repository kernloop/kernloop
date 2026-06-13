import { describe, expect, it } from 'vitest';
import { TaskContractSchema, parseConstraintTags, type TaskContract } from '@kernloop/contracts';
import { decomposeGoal, type StorySpec } from './decompose.js';
import {
  AltitudeDescentError,
  InvalidParentError,
  InvalidStorySpecError,
  ScrumBudgetExceededError,
} from './errors.js';

function parent(overrides: Partial<TaskContract> = {}): TaskContract {
  return TaskContractSchema.parse({
    id: 'program-root',
    goal: 'Ship the auth program',
    constraints: ['no new runtime deps'],
    budget: { tokens: 10_000, usd: 2, wallClockMin: 60 },
    evidence: [],
    definitionOfDone: [],
    authorityCeiling: 'enforce',
    overlay: 'overlay-test',
    ...overrides,
  });
}

function story(overrides: Partial<StorySpec> = {}): StorySpec {
  return {
    goal: 'Build login',
    budget: { tokens: 4_000, usd: 0.5, wallClockMin: 20 },
    assignTo: 'coder',
    altitude: 'story',
    ...overrides,
  };
}

describe('decomposeGoal', () => {
  it('derives id, parent, overlay, and clamped ceiling for each child', () => {
    const children = decomposeGoal({
      parent: parent(),
      subtasks: [story(), story({ goal: 'Build logout', altitude: 'story' })],
    });
    expect(children.map((c) => c.id)).toEqual(['program-root.1', 'program-root.2']);
    expect(children.every((c) => c.parent === 'program-root')).toBe(true);
    expect(children.every((c) => c.overlay === 'overlay-test')).toBe(true);
    // enforce parent → children clamped to suggest.
    expect(children.every((c) => c.authorityCeiling === 'suggest')).toBe(true);
  });

  it('a child never exceeds the parent ceiling below suggest', () => {
    const children = decomposeGoal({
      parent: parent({ authorityCeiling: 'observe' }),
      subtasks: [story()],
    });
    expect(children[0]?.authorityCeiling).toBe('observe');
  });

  it('emits a parseable altitude tag on each child and inherits parent constraints', () => {
    const children = decomposeGoal({
      parent: parent(),
      subtasks: [story({ altitude: 'epic', constraints: ['touch only src/'] })],
    });
    const child = children[0]!;
    expect(TaskContractSchema.safeParse(child).success).toBe(true);
    expect(child.constraints).toEqual([
      'no new runtime deps',
      'touch only src/',
      'altitude:epic',
      'assign:agent.coder',
    ]);
    const parsed = parseConstraintTags(child.constraints);
    expect(parsed.altitude).toBe('epic');
    expect(parsed.assign).toBe('agent.coder');
    expect(parsed.other).toEqual(['no new runtime deps', 'touch only src/']);
  });

  it('emits track/sprint tags when present and omits them when absent', () => {
    const [withTags] = decomposeGoal({
      parent: parent(),
      subtasks: [story({ track: 'auth', sprint: 's1' })],
    });
    const tagged = parseConstraintTags(withTags!.constraints);
    expect(tagged.track).toBe('auth');
    expect(tagged.sprint).toBe('s1');

    const [withoutTags] = decomposeGoal({ parent: parent(), subtasks: [story()] });
    expect(withoutTags!.constraints).not.toContain('track:');
    const bare = parseConstraintTags(withoutTags!.constraints);
    expect(bare.track).toBeUndefined();
    expect(bare.sprint).toBeUndefined();
  });

  it('child budgets summing exactly to the parent pass on every dimension', () => {
    const children = decomposeGoal({
      parent: parent(),
      subtasks: [
        story({ budget: { tokens: 6_000, usd: 1.5, wallClockMin: 45 } }),
        story({ budget: { tokens: 4_000, usd: 0.5, wallClockMin: 15 } }),
      ],
    });
    expect(children).toHaveLength(2);
  });

  it('a token-sum violation throws ScrumBudgetExceededError naming the dimension', () => {
    const run = (): TaskContract[] =>
      decomposeGoal({
        parent: parent(),
        subtasks: [
          story({ budget: { tokens: 6_000, usd: 0.5, wallClockMin: 10 } }),
          story({ budget: { tokens: 4_001, usd: 0.5, wallClockMin: 10 } }),
        ],
      });
    expect(run).toThrow(ScrumBudgetExceededError);
    try {
      run();
      expect.unreachable('must throw');
    } catch (error) {
      const e = error as ScrumBudgetExceededError;
      expect(e.dimension).toBe('tokens');
      expect(e.parentAmount).toBe(10_000);
      expect(e.childSum).toBe(10_001);
    }
  });

  it('a usd-sum violation throws for the usd dimension', () => {
    expect(() =>
      decomposeGoal({
        parent: parent(),
        subtasks: [
          story({ budget: { tokens: 1_000, usd: 1.5, wallClockMin: 10 } }),
          story({ budget: { tokens: 1_000, usd: 0.75, wallClockMin: 10 } }),
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        name: 'ScrumBudgetExceededError',
        dimension: 'usd',
        childSum: 2.25,
      }),
    );
  });

  it('a wall-clock-sum violation throws for the wallClockMin dimension', () => {
    expect(() =>
      decomposeGoal({
        parent: parent(),
        subtasks: [
          story({ budget: { tokens: 1_000, usd: 0.1, wallClockMin: 40 } }),
          story({ budget: { tokens: 1_000, usd: 0.1, wallClockMin: 21 } }),
        ],
      }),
    ).toThrow(
      expect.objectContaining({ dimension: 'wallClockMin', parentAmount: 60, childSum: 61 }),
    );
  });

  it('rejects a zero-budget child as an invalid story spec', () => {
    expect(() =>
      decomposeGoal({
        parent: parent(),
        subtasks: [story({ budget: { tokens: 0, usd: 0.5, wallClockMin: 10 } })],
      }),
    ).toThrow(InvalidStorySpecError);
  });

  it('rejects a bad altitude in a spec with a typed error carrying the index', () => {
    const bad = [story(), story({ altitude: 'saga' as StorySpec['altitude'] })] as StorySpec[];
    try {
      decomposeGoal({ parent: parent(), subtasks: bad });
      expect.unreachable('must throw');
    } catch (error) {
      const e = error as InvalidStorySpecError;
      expect(e.name).toBe('InvalidStorySpecError');
      expect(e.index).toBe(1);
    }
  });

  it('rejects an unsafe track value (defense-in-depth on the emitted tag)', () => {
    expect(() =>
      decomposeGoal({ parent: parent(), subtasks: [story({ track: 'bad value' })] }),
    ).toThrow(InvalidStorySpecError);
  });

  it('rejects an invalid parent contract with InvalidParentError', () => {
    const bad = { ...parent(), goal: '' } as TaskContract;
    expect(() => decomposeGoal({ parent: bad, subtasks: [story()] })).toThrow(InvalidParentError);
  });

  it('an empty story list decomposes to an empty child list', () => {
    expect(decomposeGoal({ parent: parent(), subtasks: [] })).toEqual([]);
  });
});

describe('decomposeGoal — altitude descent (#52 Inc 4)', () => {
  const at = (alt: string): TaskContract => parent({ constraints: [`altitude:${alt}`] });

  it('an epic parent decomposes to story children', () => {
    const children = decomposeGoal({
      parent: at('epic'),
      subtasks: [story({ altitude: 'story' })],
    });
    expect(parseConstraintTags(children[0]!.constraints).altitude).toBe('story');
  });

  it('a story parent decomposes to task children', () => {
    const children = decomposeGoal({
      parent: at('story'),
      subtasks: [story({ altitude: 'task' })],
    });
    expect(parseConstraintTags(children[0]!.constraints).altitude).toBe('task');
  });

  it('rejects an epic parent → epic child (same rung, not one down)', () => {
    try {
      decomposeGoal({ parent: at('epic'), subtasks: [story({ altitude: 'epic' })] });
      expect.unreachable('must throw');
    } catch (error) {
      const e = error as AltitudeDescentError;
      expect(e.name).toBe('AltitudeDescentError');
      expect(e.parentAltitude).toBe('epic');
      expect(e.expected).toBe('story');
      expect(e.actual).toBe('epic');
      expect(e.index).toBe(0);
    }
  });

  it('rejects an epic parent → task child (skips a rung)', () => {
    expect(() =>
      decomposeGoal({ parent: at('epic'), subtasks: [story({ altitude: 'task' })] }),
    ).toThrow(AltitudeDescentError);
  });

  it('rejects a story parent → story child', () => {
    expect(() =>
      decomposeGoal({ parent: at('story'), subtasks: [story({ altitude: 'story' })] }),
    ).toThrow(AltitudeDescentError);
  });

  it('rejects decomposing a task parent — a task is a leaf', () => {
    try {
      decomposeGoal({ parent: at('task'), subtasks: [story({ altitude: 'task' })] });
      expect.unreachable('must throw');
    } catch (error) {
      const e = error as AltitudeDescentError;
      expect(e.name).toBe('AltitudeDescentError');
      expect(e.parentAltitude).toBe('task');
      expect(e.index).toBe(-1);
      expect(e.expected).toBeUndefined();
    }
  });

  it('a no-altitude root parent is the unconstrained entry — any child altitude is allowed', () => {
    // The default parent() carries no altitude tag (the program root).
    const children = decomposeGoal({
      parent: parent(),
      subtasks: [story({ altitude: 'epic' }), story({ goal: 'B', altitude: 'task' })],
    });
    expect(children.map((c) => parseConstraintTags(c.constraints).altitude)).toEqual([
      'epic',
      'task',
    ]);
  });

  it('reports the FIRST offending child index under an altitude-bearing parent', () => {
    try {
      decomposeGoal({
        parent: at('epic'),
        subtasks: [story({ altitude: 'story' }), story({ goal: 'B', altitude: 'epic' })],
      });
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as AltitudeDescentError).index).toBe(1);
    }
  });
});
