/**
 * Unit tests for the shared program helpers. Focus: `taskFromRow` validates a
 * STORED node's taskJson back into a TaskContract, surfacing a malformed/legacy
 * row as a clean ProgramInputError (never a raw zod/JSON throw) — the contract
 * both `program emit` body-rendering and `decompose-node` rely on.
 */
import { describe, expect, it } from 'vitest';
import { TaskContractSchema } from '@kernloop/contracts';
import { ProgramInputError, taskFromRow } from './program-shared.js';

const VALID_TASK = TaskContractSchema.parse({
  id: 'p.1',
  goal: 'Build login',
  constraints: [],
  budget: { tokens: 100, usd: 1, wallClockMin: 5 },
  evidence: [],
  definitionOfDone: [],
  authorityCeiling: 'suggest',
  overlay: 'o',
});

describe('taskFromRow', () => {
  it('returns the parsed TaskContract for a well-formed stored row', () => {
    expect(taskFromRow('p.1', JSON.stringify(VALID_TASK))).toEqual(VALID_TASK);
  });

  it('a stored task that is not valid JSON is a clean ProgramInputError (not a SyntaxError)', () => {
    let caught: unknown;
    try {
      taskFromRow('p.1', '{ not json');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProgramInputError);
    expect((caught as Error).message).toContain('malformed stored task');
  });

  it('valid JSON that is not a TaskContract is a clean ProgramInputError (not a ZodError)', () => {
    let caught: unknown;
    try {
      taskFromRow('p.2', '{"id":"p.2"}'); // missing required contract fields
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProgramInputError);
    expect((caught as Error).message).toContain('not a valid TaskContract');
  });
});
