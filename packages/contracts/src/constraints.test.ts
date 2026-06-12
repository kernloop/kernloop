import { describe, expect, it } from 'vitest';
import { constraintTag, parseConstraintTags } from './constraints.js';
import { InvalidConstraintTagError } from './errors.js';

describe('constraintTag', () => {
  it('builds the canonical key:value carrier', () => {
    expect(constraintTag('altitude', 'epic')).toBe('altitude:epic');
    expect(constraintTag('assign', 'agent.coder')).toBe('assign:agent.coder');
  });
});

describe('parseConstraintTags', () => {
  it('parses each recognized tag into its typed field', () => {
    const parsed = parseConstraintTags([
      'altitude:story',
      'track:auth',
      'sprint:2026-Q2',
      'assign:agent.pm',
    ]);
    expect(parsed.altitude).toBe('story');
    expect(parsed.track).toBe('auth');
    expect(parsed.sprint).toBe('2026-Q2');
    expect(parsed.assign).toBe('agent.pm');
    expect(parsed.other).toEqual([]);
  });

  it('passes free-form constraints and unknown keys through to other', () => {
    const parsed = parseConstraintTags([
      'no new runtime deps',
      'touch only src/',
      'priority:high',
      'assign:agent.coder',
    ]);
    // assign is a known tag, captured; the rest are free-form/unknown-key.
    expect(parsed.assign).toBe('agent.coder');
    expect(parsed.other).toEqual(['no new runtime deps', 'touch only src/', 'priority:high']);
  });

  it('treats a string with no colon as free-form (other)', () => {
    expect(parseConstraintTags(['justaword']).other).toEqual(['justaword']);
  });

  it('rejects an altitude value outside the enum', () => {
    expect(() => parseConstraintTags(['altitude:saga'])).toThrow(InvalidConstraintTagError);
    try {
      parseConstraintTags(['altitude:saga']);
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as InvalidConstraintTagError).key).toBe('altitude');
    }
  });

  it('rejects a duplicate altitude tag', () => {
    expect(() => parseConstraintTags(['altitude:epic', 'altitude:story'])).toThrow(
      InvalidConstraintTagError,
    );
  });

  it('rejects track/sprint values with spaces or metacharacters', () => {
    for (const bad of ['track:auth flow', 'track:a;b', 'sprint:a$b', 'sprint:a/b']) {
      expect(() => parseConstraintTags([bad])).toThrow(InvalidConstraintTagError);
    }
  });

  it('rejects a track/sprint value with a leading non-alphanumeric (label-sink parity)', () => {
    // The charset requires a leading alnum so the value can never be read as a
    // flag at the tracker label sink (which also forbids a leading `-`/`.`/`_`).
    for (const bad of ['track:-flag', 'track:.hidden', 'sprint:_x']) {
      expect(() => parseConstraintTags([bad])).toThrow(InvalidConstraintTagError);
    }
  });

  it('rejects a duplicate track and a duplicate sprint', () => {
    expect(() => parseConstraintTags(['track:a', 'track:b'])).toThrow(InvalidConstraintTagError);
    expect(() => parseConstraintTags(['sprint:1', 'sprint:2'])).toThrow(InvalidConstraintTagError);
  });

  it('round-trips constraintTag through parseConstraintTags', () => {
    const constraints = [
      constraintTag('altitude', 'task'),
      constraintTag('track', 'core'),
      constraintTag('sprint', 's1'),
    ];
    const parsed = parseConstraintTags(constraints);
    expect(parsed).toEqual({ altitude: 'task', track: 'core', sprint: 's1', other: [] });
  });
});
