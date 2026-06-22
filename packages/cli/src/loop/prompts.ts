/**
 * Prompt builders for the canonical-loop node executors — the role prompts
 * and strict output contracts the generative nodes (plan, decompose,
 * implement/coder, research/researcher) assemble, plus the diff rendering the
 * advisory review gate reads. Kept apart from the executors so neither file
 * outgrows the 400-line budget.
 */
import { SHIPPED_TEMPLATES } from '@kernloop/faculty-workforce';
import { COMPACT_PARSIMONY_RULE } from '@kernloop/parsimony';
import type { Brief, Finding, TaskContract } from '@kernloop/contracts';
import { briefText } from './seams.js';

/** A shipped workforce template, or a loud failure naming the gap. */
export function shippedTemplate(name: string) {
  const template = SHIPPED_TEMPLATES[name];
  if (template === undefined) throw new Error(`workforce template "${name}" is not shipped`);
  return template;
}

/** The plan prompt: PM role + compiled brief + prior vote findings. */
export function planPrompt(research: Brief, findings: readonly Finding[]): string {
  const parts = [shippedTemplate('pm').rolePrompt, '## Compiled brief', briefText(research)];
  if (findings.length > 0) {
    parts.push(
      '## Prior vote findings (address every one)',
      findings.map((f) => `- [${f.severity}] ${f.message}`).join('\n'),
    );
  }
  parts.push(
    'Write the implementation plan for this task as concise, reviewable prose. Plain text, no JSON.',
  );
  return parts.join('\n\n');
}

/** The PM decomposition prompt with the strict subtasks contract. */
export function decomposePrompt(parent: TaskContract, planText: string): string {
  return [
    shippedTemplate('pm').rolePrompt,
    '## Parent task',
    JSON.stringify(
      { id: parent.id, goal: parent.goal, constraints: parent.constraints, budget: parent.budget },
      null,
      2,
    ),
    '## Ratified plan',
    planText,
    'Output contract (STRICT): output ONLY one raw JSON object — no markdown fences, no ' +
      'commentary before or after. Exact shape: ' +
      '{"subtasks":[{"goal":"…","budget":{"tokens":N,"usd":N,"wallClockMin":N},' +
      '"assignTo":"pm|coder|reviewer|documenter|researcher"}]}. Subtask budgets must sum ' +
      'within the parent budget on every dimension. Every subtask must be implementable as ' +
      'concrete file changes in the workspace — no review-only, research-only, or process ' +
      'subtasks. Do NOT create verification, test-running, or QA subtasks: an automatic ' +
      'quality gate (typecheck, lint, tests) already runs after every subtask. Create the ' +
      'FEWEST subtasks that produce the file changes — usually one or two, and ALWAYS at ' +
      'least one: a goal that needs no breakdown is exactly ONE subtask covering the whole ' +
      'goal. Never output an empty list.',
  ].join('\n\n');
}

/**
 * The coder prompt with the strict files contract. On a re-iteration the
 * child's accumulated gate findings are folded in [CLM-0043] so the re-running
 * coder fixes every failed check — the actor reading the critic's notes. The
 * single-sourced {@link COMPACT_PARSIMONY_RULE} is appended on EVERY coder call
 * [CLM-0179] so the Prime disposition (climb the ladder, hold the control floor,
 * emit the `kl:parsimony` marker) travels with the implement step.
 */
export function coderPrompt(child: TaskContract, findings: readonly Finding[] = []): string {
  const parts = [
    shippedTemplate('coder').rolePrompt,
    COMPACT_PARSIMONY_RULE,
    '## Child task',
    JSON.stringify({ id: child.id, goal: child.goal, constraints: child.constraints }, null, 2),
  ];
  if (findings.length > 0) {
    parts.push(
      '## Your previous attempt failed these checks — fix every one',
      findings.map((f) => `- [${f.severity}] ${f.message}`).join('\n'),
    );
  }
  parts.push(
    'Output contract (STRICT): output ONLY one raw JSON object — no markdown fences, no ' +
      'commentary before or after. Exact shape: ' +
      '{"files":[{"path":"relative/path.ts","content":"<COMPLETE file content>"}],"notes":"…"}. ' +
      '"files" MUST contain at least one entry; each entry carries the complete final ' +
      'content of that file; paths are relative to the workspace root.',
  );
  return parts.join('\n\n');
}

/** The Researcher template's prompt: role + task + assembled context. */
export function researcherPrompt(task: TaskContract, brief: Brief): string {
  return [
    shippedTemplate('researcher').rolePrompt,
    '## Task',
    task.goal,
    '## Assembled context',
    briefText(brief),
    'Investigate the prior art, constraints, and facts relevant to this task. ' +
      'Output concise research findings as plain prose — no JSON, no markdown fences.',
  ].join('\n\n');
}

/** Render a child's written files as a unified-diff-style review input. */
export function writtenDiff(files: ReadonlyArray<{ path: string; content: string }>): string {
  return files
    .map((f) => {
      const body = f.content
        .split('\n')
        .map((line) => `+${line}`)
        .join('\n');
      return `diff --git a/${f.path} b/${f.path}\n--- /dev/null\n+++ b/${f.path}\n${body}`;
    })
    .join('\n\n');
}
