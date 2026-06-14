/**
 * Loop prompt contracts — the prompts that cross a model's output back into the
 * system carry the STRICT shape the executors then parse. These assert the
 * load-bearing instructions are present so a contract can't silently soften.
 */
import { describe, expect, it } from 'vitest';
import { TaskContractSchema } from '@kernloop/contracts';
import { decomposePrompt } from './prompts.js';

const parent = TaskContractSchema.parse({
  id: 'task-prompts',
  goal: 'add a greet function',
  constraints: [],
  budget: { tokens: 100_000, usd: 1, wallClockMin: 30 },
  evidence: [],
  definitionOfDone: [],
  authorityCeiling: 'advisory',
  overlay: 'prompts',
});

describe('decomposePrompt', () => {
  it('states a hard floor of one subtask so a trivial task does not emit an empty list (#144)', () => {
    const prompt = decomposePrompt(parent, 'Ratified plan: write the file.');
    // The >=1 subtasks contract is enforced downstream; the prompt must tell the
    // model the floor, else a capable model returns {"subtasks":[]} on a trivial
    // goal (observed live) and the run fails decompose.
    expect(prompt).toContain('at least one');
    expect(prompt).toContain('Never output an empty list');
  });

  it('demands one raw JSON object with the exact subtasks shape', () => {
    const prompt = decomposePrompt(parent, 'plan');
    expect(prompt).toContain('ONLY one raw JSON object');
    expect(prompt).toContain('"subtasks"');
  });
});
