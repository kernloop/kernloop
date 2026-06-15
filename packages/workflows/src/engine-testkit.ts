/**
 * Shared scripted-executor harness for the engine tests (child iteration,
 * budget, per-child spend). A deterministic stand-in for the real faculties:
 * every node returns a canned contract so a test drives the loop's CONTROL
 * flow (re-iterate, escalate, attribute) without any model call. Not test code
 * itself — it carries no `describe`/`it`; the `.test.ts` files import it.
 */
import type { Brief, Finding, Outcome, TaskContract, Verdict } from '@kernloop/contracts';
import type { NodeContext, NodeExecutor } from './engine.js';

/** The root task every engine test decomposes. */
export const task: TaskContract = {
  id: 'task-1',
  goal: 'ship the feature',
  constraints: [],
  budget: { tokens: 1000, usd: 1, wallClockMin: 10 },
  evidence: [],
  definitionOfDone: [],
  authorityCeiling: 'suggest',
  overlay: 'repo',
};

/** A scripted compiler Brief for `taskId`. */
export const brief = (taskId: string): Brief => ({
  taskId,
  sections: [],
  budget: { allotted: 10, used: 0 },
  compilerVersion: 'scripted-1',
});

/** A scripted gate Verdict; a non-pass result carries one finding to fold. */
export const verdict = (taskId: string, gate: string, result: Verdict['result']): Verdict => ({
  taskId,
  gate,
  result,
  confidence: 1,
  findings:
    result === 'approve' || result === 'pass'
      ? []
      : [{ severity: 'error', message: `${gate} wants ${taskId} fixed` } satisfies Finding],
  cost: { tokens: 0, usd: 0 },
});

/** A scripted success Outcome for `taskId`. */
export const outcome = (taskId: string): Outcome => ({
  taskId,
  status: 'success',
  signals: [],
  cost: { tokens: 0, usd: 0 },
  traceRef: `trace-${taskId}`,
  distillCandidates: [],
});

/** Render a trace as `node[:childId]` labels for order assertions. */
export const names = (trace: readonly { node: string; childId?: string }[]): string[] =>
  trace.map((t) => (t.childId === undefined ? t.node : `${t.node}:${t.childId}`));

/**
 * A scripted executor set. `qualityByChild` maps a child id to the sequence of
 * quality results it returns (last entry repeats). Records every implement's
 * NodeContext so tests can assert the folded child findings + childIteration.
 */
export function scripted(qualityByChild: Record<string, Array<Verdict['result']>> = {}) {
  const qualityCalls: Record<string, number> = {};
  const implementCtx: Array<{ childId: string; iteration: number; findings: readonly Finding[] }> =
    [];
  const executors: Record<string, NodeExecutor> = {
    frame: () => Promise.resolve(task),
    research: () => Promise.resolve(brief(task.id)),
    plan: () => Promise.resolve(brief(task.id)),
    vote: (_i, ctx) => Promise.resolve(verdict(ctx.taskId, 'vote', 'approve')),
    decompose: () =>
      Promise.resolve([
        { ...task, id: `${task.id}.c1`, parent: task.id },
        { ...task, id: `${task.id}.c2`, parent: task.id },
      ]),
    implement: (input, ctx) => {
      const c = input as TaskContract;
      implementCtx.push({
        childId: c.id,
        iteration: ctx.childIteration ?? -1,
        findings: ctx.findings,
      });
      return Promise.resolve(outcome(c.id));
    },
    quality: (_i, ctx) => {
      const id = ctx.child?.id ?? ctx.taskId;
      const seq = qualityByChild[id] ?? ['pass'];
      const n = qualityCalls[id] ?? 0;
      qualityCalls[id] = n + 1;
      return Promise.resolve(verdict(id, 'quality', seq[Math.min(n, seq.length - 1)] ?? 'pass'));
    },
    review: (_i, ctx) => Promise.resolve(verdict(ctx.child?.id ?? ctx.taskId, 'review', 'approve')),
    integrate: () => Promise.resolve(outcome(task.id)),
    retrospect: (input) => Promise.resolve(input),
  };
  return { executors, qualityCalls, implementCtx };
}

/** Wrap executors to count calls per node name. */
export function counted(executors: Record<string, NodeExecutor>) {
  const calls: Record<string, number> = {};
  const wrapped = Object.fromEntries(
    Object.entries(executors).map(([key, fn]) => [
      key,
      (input: unknown, ctx: NodeContext) => {
        calls[key] = (calls[key] ?? 0) + 1;
        return fn(input, ctx);
      },
    ]),
  );
  return { executors: wrapped, calls };
}
