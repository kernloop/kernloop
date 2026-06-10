/**
 * `run` — the entry point (spec §3.4): goal/TaskContract → Outcome. Builds a
 * zod-valid TaskContract from the input plus overlay defaults, publishes it
 * on the bus, routes it via manifests (every routing decision is audited
 * kernel-side [CLM-0034]), executes the selected capability's executor,
 * publishes the resulting Outcome, records it to episodic memory, and
 * returns it. `execute: false` returns the routing decision only.
 *
 * Honesty rules: an unknown capability returns the router's typed rejection
 * as data (the audit event exists either way); a routable capability with no
 * run-executor names its real entry point instead of pretending to act.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  TaskContractSchema,
  TierSchema,
  type Outcome,
  type TaskContract,
  type Tier,
  type Verdict,
} from '@kernloop/contracts';
import { RouterError, appendEvent, type RoutingDecision } from '@kernloop/kernel';
import type { QualityCheck } from '@kernloop/faculty-gates';
import type { Kernloop } from '../kernel.js';

/** Input to the `run` tool — a goal plus optional TaskContract overrides. */
export const RunInputSchema = z.strictObject({
  goal: z.string().min(1),
  capability: z.string().min(1),
  workspaceDir: z.string().min(1).optional(),
  execute: z.boolean().default(true),
  id: z.string().min(1).optional(),
  parent: z.string().min(1).optional(),
  constraints: z.array(z.string().min(1)).default([]),
  budget: z
    .strictObject({
      tokens: z.number().int().nonnegative(),
      usd: z.number().nonnegative(),
      wallClockMin: z.number().nonnegative(),
    })
    .optional(),
  authorityCeiling: TierSchema.default('advisory'),
  overlay: z.string().min(1).optional(),
});
export type RunInput = z.input<typeof RunInputSchema>;

/** Serializable form of a routing decision (manifests by identity). */
export interface RoutingReport {
  selected: string | null;
  explored: boolean;
  candidates: Array<{ manifest: string; eligible: boolean; reasons: string[] }>;
}

/** What `run` returns — always honest about how far it got. */
export type RunResult =
  | { kind: 'routing'; task: TaskContract; decision: RoutingReport }
  | {
      kind: 'no_route';
      task: TaskContract;
      error: { code: 'unknown_capability' | 'no_eligible_candidate'; message: string };
      decision: RoutingReport | null;
    }
  | {
      kind: 'unwired';
      task: TaskContract;
      selected: string;
      error: { code: 'no_run_executor'; message: string };
    }
  | { kind: 'outcome'; task: TaskContract; outcome: Outcome; verdict?: Verdict; data?: unknown };

/** Flatten a kernel RoutingDecision into identity facts for callers. */
export function reportDecision(decision: RoutingDecision): RoutingReport {
  return {
    selected:
      decision.selected === null ? null : `${decision.selected.name}@${decision.selected.version}`,
    explored: decision.explored,
    candidates: decision.candidates.map((c) => ({
      manifest: `${c.manifest.name}@${c.manifest.version}`,
      eligible: c.eligible,
      reasons: [...c.reasons],
    })),
  };
}

/** Build the TaskContract from input + overlay defaults (spec §4 fields). */
export function buildTask(kern: Kernloop, input: z.output<typeof RunInputSchema>): TaskContract {
  return TaskContractSchema.parse({
    id: input.id ?? `task-${randomUUID()}`,
    ...(input.parent === undefined ? {} : { parent: input.parent }),
    goal: input.goal,
    constraints: input.constraints,
    budget: input.budget ?? kern.config.budgets,
    evidence: [],
    definitionOfDone: [],
    authorityCeiling: input.authorityCeiling,
    overlay: input.overlay ?? kern.config.id,
  });
}

/**
 * Required tier for a capability: the declared tier of its registered
 * manifest (P1 registers exactly one manifest per capability). Falls back to
 * the ladder floor when nothing is registered — the router then records and
 * rejects the unknown capability honestly.
 */
function requiredTierFor(kern: Kernloop, capability: string): Tier {
  const matches = kern.registry.findByCapability(capability);
  return matches[0]?.tier ?? 'observe';
}

/** Execute the routed capability and close out the task as an Outcome. */
async function executeAndRecord(
  kern: Kernloop,
  task: TaskContract,
  capability: string,
  selected: string,
  options: { workspaceDir?: string; checks?: readonly QualityCheck[] },
): Promise<RunResult> {
  const executor = kern.executors.get(capability);
  if (executor === undefined) {
    return {
      kind: 'unwired',
      task,
      selected,
      error: {
        code: 'no_run_executor',
        message: `capability "${capability}" is wired through its own entry point (remember / Outcome recording), not through run`,
      },
    };
  }
  const started = Date.now();
  const result = await executor({ task, ...options });
  const outcome: Outcome = {
    taskId: task.id,
    status: result.status,
    signals: result.signals,
    cost: { ...result.cost, wallClockMs: result.cost.wallClockMs ?? Date.now() - started },
    traceRef: `audit:${kern.paths.audit}#task=${task.id}`,
    distillCandidates: [],
  };
  await kern.bus.publish('Outcome', outcome);
  kern.memory.recordOutcome(
    outcome,
    `${task.goal} — ${capability} via ${selected}: ${outcome.status}`,
  );
  appendEvent(kern.store, {
    type: 'cli.run.outcome',
    payload: {
      taskId: task.id,
      capability,
      selected,
      status: outcome.status,
      wallClockMs: outcome.cost.wallClockMs ?? 0,
    },
  });
  return result.verdict === undefined
    ? { kind: 'outcome', task, outcome, data: result.data }
    : { kind: 'outcome', task, outcome, verdict: result.verdict, data: result.data };
}

/** The `run` tool. See module docs. */
export async function runTool(
  kern: Kernloop,
  input: RunInput,
  options: { checks?: readonly QualityCheck[] } = {},
): Promise<RunResult> {
  const parsed = RunInputSchema.parse(input);
  const task = buildTask(kern, parsed);
  await kern.bus.publish('TaskContract', task);
  let decision;
  try {
    decision = kern.router.route({
      task,
      capability: parsed.capability,
      requiredTier: requiredTierFor(kern, parsed.capability),
      execute: parsed.execute,
    });
  } catch (error) {
    if (error instanceof RouterError) {
      return {
        kind: 'no_route',
        task,
        error: { code: 'unknown_capability', message: error.message },
        decision: null,
      };
    }
    throw error;
  }
  if (!parsed.execute) {
    return { kind: 'routing', task, decision: reportDecision(decision) };
  }
  if (decision.selected === null) {
    return {
      kind: 'no_route',
      task,
      error: {
        code: 'no_eligible_candidate',
        message: `manifests declare "${parsed.capability}" but none is eligible for this task`,
      },
      decision: reportDecision(decision),
    };
  }
  const selected = `${decision.selected.name}@${decision.selected.version}`;
  return executeAndRecord(kern, task, parsed.capability, selected, {
    ...(parsed.workspaceDir === undefined ? {} : { workspaceDir: parsed.workspaceDir }),
    ...(options.checks === undefined ? {} : { checks: options.checks }),
  });
}
