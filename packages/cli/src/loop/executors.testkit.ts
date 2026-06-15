/**
 * Shared fixtures for the loop-executor tests (#132) — a NON-test module (the
 * loop-fixtures.ts pattern) so the executor suite and any sibling split share ONE
 * definition of the scripted invoke, the framed task, the per-node bindings, and
 * the node context. Extracted to keep each test file under its 400-LOC budget;
 * imported only by tests.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BriefSchema, TaskContractSchema, type Cost } from '@kernloop/contracts';
import { type QualityCheck } from '@kernloop/faculty-gates';
import { emptyDiscoveredCache } from '@kernloop/faculty-models';
import { type NodeContext } from '@kernloop/workflows';
import { createKernloop, type Kernloop } from '../kernel.js';
import { type LoopBindings, type LoopRefs } from './executors.js';
import { type LoopInvoke } from './invoke.js';
import { resolveServed, type NodeSeam } from './node-seam.js';

/** Wrap a scripted invoke as a NodeSeam with honest served provenance (medium/medium on claude). */
export function seamOf(invoke: LoopInvoke): NodeSeam {
  return {
    invoke,
    served: resolveServed({ tier: 'medium', effort: 'medium', capabilities: [] }, 'claude'),
  };
}

/** The framed unit task every executor test runs against. */
export const task = TaskContractSchema.parse({
  id: 'task-unit',
  goal: 'unit goal',
  constraints: [],
  budget: { tokens: 100_000, usd: 1, wallClockMin: 30 },
  evidence: [],
  definitionOfDone: [],
  authorityCeiling: 'advisory',
  overlay: 'unit',
});

/** The fixed metered cost a scripted invoke reports. */
export const COST: Cost = { tokens: 3, usd: 0.001 };

/** Scripted invoke for the direct executor tests (always approves). */
export const scripted: LoopInvoke = (prompt) => {
  let output = 'Plan: do the thing.';
  if (prompt.includes('Diff under review')) {
    output = JSON.stringify({ findings: [], summary: 'clean' });
  } else if (prompt.includes('Investigate the prior art')) {
    output = 'Research: no prior-art conflicts; the change is self-contained.';
  } else if (prompt.includes('Proposal under vote')) {
    output = JSON.stringify({ vote: 'approve', reasoning: 'sound' });
  } else if (prompt.includes('"subtasks"')) {
    output = JSON.stringify({
      subtasks: [
        {
          goal: 'write the feature file',
          budget: { tokens: 1_000, usd: 0.01, wallClockMin: 5 },
          assignTo: 'coder',
        },
      ],
    });
  } else if (prompt.includes('"files"')) {
    output = JSON.stringify({ files: [{ path: 'src/feature.ts', content: 'export {};\n' }] });
  }
  return Promise.resolve({ output, cost: COST });
};

/** A trivially real quality check (the platform node binary, exit 0). */
export const noop: QualityCheck = {
  name: 'noop',
  command: process.execPath,
  args: ['-e', 'process.exit(0)'],
  parse: () => [],
};

/** The vote node context at a given panel size. */
export function ctxFor(panel: 3 | 7): NodeContext {
  return {
    runId: 'run-unit',
    taskId: task.id,
    iteration: 0,
    config: {
      K: 3,
      Kc: 1,
      reviewDrivesIteration: false,
      gates: { vote: { strategy: 'unanimous', panel } },
      nodeOverrides: {},
    },
    node: 'vote',
    findings: [],
  };
}

/** A minimal plan Brief the vote/decompose nodes thread as a fallback. */
export const planBrief = BriefSchema.parse({
  taskId: task.id,
  sections: [
    { name: 'plan', content: 'the plan', tokens: 2, priority: 1, provenance: [{ ref: 'x' }] },
  ],
  budget: { allotted: 100, used: 2 },
  compilerVersion: 'unit',
});

/**
 * The fixtures that need a test-owned `scratch` dir, bound to it: a kernloop over
 * a fresh overlay, and the executor bindings (workspace + injected-invoke parity,
 * so a custom invoke reaches per-node executors too, CLM-0078).
 */
export function boundHelpers(scratch: string): {
  kernloopFor: (name: string, overlayYaml?: string) => Kernloop;
  bindingsFor: (kern: Kernloop, refs?: LoopRefs, invoke?: LoopInvoke) => LoopBindings;
} {
  const kernloopFor = (name: string, overlayYaml?: string): Kernloop => {
    const repo = path.join(scratch, name);
    mkdirSync(path.join(repo, '.kernloop'), { recursive: true });
    if (overlayYaml !== undefined) {
      writeFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), overlayYaml);
    }
    return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
  };
  const bindingsFor = (
    kern: Kernloop,
    refs: LoopRefs = {},
    invoke: LoopInvoke = scripted,
  ): LoopBindings => {
    const workspaceDir = path.join(scratch, 'unit-ws');
    mkdirSync(workspaceDir, { recursive: true }); // quality checks spawn with cwd = workspace
    return {
      kern,
      workspaceDir,
      invoke,
      invokeFor: () => seamOf(invoke),
      adapter: 'claude',
      refs,
      discovered: emptyDiscoveredCache('test'),
    };
  };
  return { kernloopFor, bindingsFor };
}
