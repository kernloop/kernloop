/**
 * The canonical loop's node executors, bound to REAL components (spec §6):
 * frame is mechanical TaskContract normalization; research compiles a Brief
 * through the existing brief-tool source gathering; plan and decompose are
 * the PM template through the one injected invoke; vote is the faculty vote
 * gate with model voters under the strict ballot contract; implement is the
 * coder template whose emitted files are written into the workspace
 * (path-traversal guarded); quality is the real quality gate over that
 * workspace; integrate is mechanical aggregation; retrospect persists the
 * Outcome and a semantic fact per signal (provenance `loop:retrospect`).
 * Every gate Verdict is published on the bus — audited (rule 7).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  BriefSchema,
  OutcomeSchema,
  TaskContractSchema,
  type Brief,
  type Cost,
  type Finding,
  type Signal,
  type TaskContract,
} from '@kernloop/contracts';
import {
  PANEL_DEFAULT,
  PANEL_RATIFICATION,
  runVoteGate,
  type QualityCheck,
} from '@kernloop/faculty-gates';
import { SHIPPED_TEMPLATES, decomposePlan, type SubtaskSpec } from '@kernloop/faculty-workforce';
import { estimateTokens } from '@kernloop/faculty-compiler';
import type { ChildResult, NodeExecutor } from '@kernloop/workflows';
import type { Kernloop } from '../kernel.js';
import { assembleBrief } from '../gather.js';
import { executeQualityGate, publishVerdict } from '../executors.js';
import {
  FilesEmissionSchema,
  LoopParseError,
  SubtasksEmissionSchema,
  parseEmission,
  type LoopInvoke,
  type ViolationSink,
} from './invoke.js';
import { ballotInvoker, briefText } from './seams.js';

/** Cross-node values the composition root carries between executors —
 * primed from the latest checkpoint on resume so no node re-executes. */
export interface LoopRefs {
  framedTask?: TaskContract;
  researchBrief?: Brief;
  planBrief?: Brief;
}

/** What the executor set is bound to for one run. */
export interface LoopBindings {
  readonly kern: Kernloop;
  /** Workspace the children implement into and quality judges. */
  readonly workspaceDir: string;
  /** The ONE model seam — already metered by the caller. */
  readonly invoke: LoopInvoke;
  /** Adapter name, recorded as provenance on generated Brief sections. */
  readonly adapter: string;
  /** Quality-check override (tests); real defaults otherwise. */
  readonly checks?: readonly QualityCheck[];
  readonly refs: LoopRefs;
}

/** A shipped workforce template, or a loud failure naming the gap. */
function shippedTemplate(name: string) {
  const template = SHIPPED_TEMPLATES[name];
  if (template === undefined) throw new Error(`workforce template "${name}" is not shipped`);
  return template;
}

/** The plan prompt: PM role + compiled brief + prior vote findings. */
function planPrompt(research: Brief, findings: readonly Finding[]): string {
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
function decomposePrompt(parent: TaskContract, planText: string): string {
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
      'FEWEST subtasks that produce the file changes — usually one or two.',
  ].join('\n\n');
}

/** The coder prompt with the strict files contract. */
function coderPrompt(child: TaskContract): string {
  return [
    shippedTemplate('coder').rolePrompt,
    '## Child task',
    JSON.stringify({ id: child.id, goal: child.goal, constraints: child.constraints }, null, 2),
    'Output contract (STRICT): output ONLY one raw JSON object — no markdown fences, no ' +
      'commentary before or after. Exact shape: ' +
      '{"files":[{"path":"relative/path.ts","content":"<COMPLETE file content>"}],"notes":"…"}. ' +
      '"files" MUST contain at least one entry; each entry carries the complete final ' +
      'content of that file; paths are relative to the workspace root.',
  ].join('\n\n');
}

/**
 * Write the coder's emitted files into the workspace. Path-traversal
 * guarded: every resolved path must stay strictly inside `workspaceDir`,
 * else a typed error and NOTHING is written (checked before the first write).
 */
export function writeWorkspaceFiles(
  workspaceDir: string,
  files: ReadonlyArray<{ path: string; content: string }>,
): string[] {
  const root = path.resolve(workspaceDir);
  const resolved = files.map((file) => {
    const target = path.resolve(root, file.path);
    if (!target.startsWith(root + path.sep)) {
      throw new LoopParseError('files', `path escapes the workspace: ${file.path}`);
    }
    return { target, content: file.content };
  });
  for (const file of resolved) {
    mkdirSync(path.dirname(file.target), { recursive: true });
    writeFileSync(file.target, file.content, 'utf8');
  }
  return resolved.map((file) => path.relative(root, file.target));
}

/** A violation sink under this run's overlay, labelled with the node. */
function sinkFor(b: LoopBindings, runId: string, node: string): ViolationSink {
  return { overlayDir: b.kern.paths.dir, runId, node };
}

/** Mechanical per-child verdict signal for integrate. */
function childSignal(result: ChildResult): Signal {
  if (result.error !== undefined) {
    return { name: `child:${result.child.id}`, passed: false, detail: result.error };
  }
  const implemented = OutcomeSchema.safeParse(result.output);
  const implementStatus = implemented.success ? implemented.data.status : 'missing';
  const passed = implementStatus === 'success' && result.verdict?.result === 'pass';
  return {
    name: `child:${result.child.id}`,
    passed,
    detail: `implement ${implementStatus}; quality ${result.verdict?.result ?? 'not run'}`,
  };
}

/** Sum the real child costs (implement outcomes + quality verdicts). */
function sumChildCosts(results: readonly ChildResult[]): Cost {
  const sum = { tokens: 0, usd: 0, wallClockMs: 0 };
  for (const result of results) {
    const implemented = OutcomeSchema.safeParse(result.output);
    for (const cost of [
      implemented.success ? implemented.data.cost : undefined,
      result.verdict?.cost,
    ]) {
      if (cost === undefined) continue;
      sum.tokens += cost.tokens;
      sum.usd += cost.usd;
      sum.wallClockMs += cost.wallClockMs ?? 0;
    }
  }
  return sum;
}

/** The plan node: PM template over the research Brief → a plan-Brief. */
function planExecutor(b: LoopBindings): NodeExecutor {
  return async (input, ctx) => {
    const research = BriefSchema.parse(input);
    b.refs.researchBrief = research;
    const { output } = await b.invoke(planPrompt(research, ctx.findings));
    const used = estimateTokens(output);
    const plan = BriefSchema.parse({
      taskId: ctx.taskId,
      sections: [
        {
          name: 'plan',
          content: output,
          tokens: used,
          priority: 1,
          provenance: [{ ref: `adapter:${b.adapter}` }, { ref: 'template:pm' }],
        },
      ],
      budget: { allotted: b.kern.config.briefTokens, used },
      compilerVersion: `loop-plan/${b.adapter}`,
    });
    b.refs.planBrief = plan;
    return plan;
  };
}

/** The vote gate node: faculty panel over ONE shared Brief (spec §8.3). */
function voteExecutor(b: LoopBindings): NodeExecutor {
  return async (input, ctx) => {
    const planBrief = BriefSchema.parse(input);
    const verdict = await runVoteGate({
      taskId: ctx.taskId,
      proposal: planBrief.sections.map((s) => s.content).join('\n\n'),
      brief: b.refs.researchBrief ?? planBrief,
      panel: ctx.config.gates.vote.panel === 7 ? PANEL_RATIFICATION : PANEL_DEFAULT,
      strategy: ctx.config.gates.vote.strategy,
      invokeVoter: ballotInvoker({
        overlayDir: b.kern.paths.dir,
        runId: ctx.runId,
        invoke: b.invoke,
      }),
    });
    await publishVerdict(b.kern, verdict);
    return verdict;
  };
}

/** The decompose node: PM via invoke, then the MECHANICAL budget invariant. */
function decomposeExecutor(b: LoopBindings): NodeExecutor {
  return async (_input, ctx) => {
    const parent = b.refs.framedTask;
    const plan = b.refs.planBrief;
    if (parent === undefined || plan === undefined) {
      throw new Error(`decompose reached without framed task + plan (run ${ctx.runId})`);
    }
    const { output } = await b.invoke(decomposePrompt(parent, briefText(plan)));
    const sink = sinkFor(b, ctx.runId, 'decompose');
    const emission = parseEmission(output, SubtasksEmissionSchema, 'subtasks', sink);
    return decomposePlan({ parent, subtasks: emission.subtasks as SubtaskSpec[] });
  };
}

/** The implement child node: coder via invoke → files written for real. */
function implementExecutor(b: LoopBindings): NodeExecutor {
  return async (input, ctx) => {
    const child = TaskContractSchema.parse(input);
    const { output, cost } = await b.invoke(coderPrompt(child));
    const sink = sinkFor(b, ctx.runId, `implement-${child.id}`);
    const emission = parseEmission(output, FilesEmissionSchema, 'files', sink);
    const written = writeWorkspaceFiles(b.workspaceDir, emission.files);
    const notes = emission.notes === '' ? '' : ` — ${emission.notes}`;
    return OutcomeSchema.parse({
      taskId: child.id,
      status: 'success',
      signals: [
        {
          name: 'implement',
          passed: true,
          detail: `wrote ${String(written.length)} file(s): ${written.join(', ')}${notes}`,
        },
      ],
      cost,
      traceRef: `loop:${ctx.runId}#child=${child.id}`,
      distillCandidates: [],
    });
  };
}

/** The integrate node: success only if every child implemented AND passed quality. */
function integrateExecutor(): NodeExecutor {
  return (input, ctx) => {
    const results = input as readonly ChildResult[];
    const signals = results.map((result) => childSignal(result));
    const succeeded = signals.length > 0 && signals.every((signal) => signal.passed);
    return Promise.resolve(
      OutcomeSchema.parse({
        taskId: ctx.taskId,
        status: succeeded ? 'success' : 'failure',
        signals,
        cost: sumChildCosts(results),
        traceRef: `loop:${ctx.runId}`,
        distillCandidates: [],
      }),
    );
  };
}

/** The retrospect node: Outcome → episodic memory + per-signal semantic facts. */
function retrospectExecutor(b: LoopBindings): NodeExecutor {
  return (input, ctx) => {
    const outcome = OutcomeSchema.parse(input);
    const final = OutcomeSchema.parse({
      ...outcome,
      // Mechanical distill heuristic: a fully successful loop trace is a candidate.
      distillCandidates: outcome.status === 'success' ? [outcome.traceRef] : [],
    });
    b.kern.memory.recordOutcome(
      final,
      `canonical loop run ${ctx.runId}: ${final.status} across ${String(final.signals.length)} child signal(s)`,
    );
    for (const signal of final.signals) {
      const detail = signal.detail === undefined ? '' : ` — ${signal.detail}`;
      b.kern.memory.rememberFact({
        fact: `loop ${final.taskId} ${signal.name}: ${signal.passed ? 'passed' : 'failed'}${detail}`,
        provenance: 'loop:retrospect',
      });
    }
    return Promise.resolve(final);
  };
}

/**
 * The complete executor set for the CANONICAL_LOOP — every executable node
 * resolves (the engine refuses to start otherwise: wiring-complete or
 * absent). `fanout` is structural; the engine runs the child chain itself.
 */
export function buildLoopExecutors(b: LoopBindings): Record<string, NodeExecutor> {
  return {
    frame: (input) => {
      const task = TaskContractSchema.parse(input);
      const framed = TaskContractSchema.parse({
        ...task,
        goal: task.goal.trim(),
        constraints: [...new Set(task.constraints)],
      });
      b.refs.framedTask = framed;
      return Promise.resolve(framed);
    },
    research: (input) => assembleBrief(b.kern, TaskContractSchema.parse(input)),
    plan: planExecutor(b),
    vote: voteExecutor(b),
    decompose: decomposeExecutor(b),
    implement: implementExecutor(b),
    quality: (_input, ctx) =>
      executeQualityGate(b.kern, {
        taskId: ctx.child?.id ?? ctx.taskId,
        workspaceDir: b.workspaceDir,
        ...(b.checks === undefined ? {} : { checks: b.checks }),
        ...(b.kern.config.gates.quality.timeoutMsPerCheck === undefined
          ? {}
          : { timeoutMsPerCheck: b.kern.config.gates.quality.timeoutMsPerCheck }),
      }),
    integrate: integrateExecutor(),
    retrospect: retrospectExecutor(b),
  };
}
