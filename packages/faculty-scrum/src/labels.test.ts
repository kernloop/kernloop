/**
 * The program label-map + issue-body suite (CLM-0097). Proves the ONE map turns
 * a TaskContract's constraint tags into tracker-label-safe GitHub labels
 * (assign:agent.<t> → agent:<t>, altitude/track/sprint pass-through), skips
 * free-form constraints, dedupes, and renders a replayable issue body. The
 * tracker LabelSchema is NOT imported (faculty isolation): the charset is
 * asserted inline against the same regex.
 */
import { describe, expect, it } from 'vitest';
import { TaskContractSchema, type TaskContract } from '@kernloop/contracts';
import { decomposeGoal, type StorySpec } from './decompose.js';
import { UnsafeLabelError } from './errors.js';
import { programIssueBody, programLabels } from './labels.js';

/** The tracker LabelSchema regex, re-stated here (faculty-scrum must NOT import
 * the tracker). A label that passes this is accepted at the `gh` sink. */
const TRACKER_LABEL = /^[A-Za-z0-9][A-Za-z0-9 _.\-/:]*$/;

function parent(overrides: Partial<TaskContract> = {}): TaskContract {
  return TaskContractSchema.parse({
    id: 'program-root',
    goal: 'Ship the auth program',
    constraints: [],
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

/** Decompose a single story into one child node for label/body assertions. */
function childOf(overrides: Partial<StorySpec> = {}): TaskContract {
  return decomposeGoal({ parent: parent(), subtasks: [story(overrides)] })[0]!;
}

describe('programLabels — the one constraint-tag → label map', () => {
  it('maps assign:agent.coder to the agent:coder label (assign→agent, .→:)', () => {
    const labels = programLabels(childOf({ assignTo: 'coder' }).constraints);
    expect(labels).toContain('agent:coder');
    expect(labels).not.toContain('assign:agent.coder');
  });

  it('maps altitude, track, and sprint to pass-through labels', () => {
    const labels = programLabels(
      childOf({ altitude: 'epic', track: 'auth', sprint: 's1' }).constraints,
    );
    expect(labels).toContain('altitude:epic');
    expect(labels).toContain('track:auth');
    expect(labels).toContain('sprint:s1');
  });

  it('emits NO label for free-form / unknown constraints (the other bucket)', () => {
    const node = childOf({ constraints: ['touch only src/', 'no new deps'] });
    const labels = programLabels(node.constraints);
    expect(labels).not.toContain('touch only src/');
    expect(labels).not.toContain('no new deps');
    // Only the known program tags surface: altitude + the assign→agent label.
    expect(labels.sort()).toEqual(['agent:coder', 'altitude:story']);
  });

  it('returns a deduped label set (no label appears twice)', () => {
    const labels = programLabels(
      childOf({ altitude: 'epic', track: 'auth', sprint: 's1' }).constraints,
    );
    expect(labels).toEqual([...new Set(labels)]);
  });

  it('emits no label for an assign value that is not agent.<t> shaped', () => {
    expect(programLabels(['assign:not-an-agent'])).toEqual([]);
  });

  it('throws a typed UnsafeLabelError if a tag would yield an unsafe label (assign backstop)', () => {
    // `assign:` is not charset-validated by parseConstraintTags (the documented
    // asymmetry), so an unsafe agent.<t> value is backstopped by assertLabelSafe
    // as a typed, clean-exit error rather than escaping to `gh`.
    expect(() => programLabels(['assign:agent.$(evil)'])).toThrow(UnsafeLabelError);
  });

  it('every emitted label satisfies the tracker LabelSchema charset (≤80, leading alnum)', () => {
    const labels = programLabels(
      childOf({ altitude: 'epic', track: 'auth-flow', sprint: 's1' }).constraints,
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.length).toBeLessThanOrEqual(80);
      expect(TRACKER_LABEL.test(label)).toBe(true);
    }
  });
});

describe('programIssueBody — prose + the replayable payload', () => {
  it('contains the goal and a parseable JSON payload carrying the node id', () => {
    const node = childOf({ goal: 'Build the login flow', track: 'auth' });
    const body = programIssueBody(node);
    expect(body).toContain('Build the login flow');
    expect(body).toContain('kernloop run');
    const fenced = body.slice(body.indexOf('```json') + '```json'.length, body.lastIndexOf('```'));
    const payload = JSON.parse(fenced) as {
      id: string;
      parent?: string;
      goal: string;
      constraints: string[];
    };
    expect(payload.id).toBe(node.id);
    expect(payload.parent).toBe('program-root');
    expect(payload.goal).toBe('Build the login flow');
    expect(payload.constraints).toEqual(node.constraints);
  });
});
