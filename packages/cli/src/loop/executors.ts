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
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  BriefSchema,
  OutcomeSchema,
  TaskContractSchema,
  VerdictSchema,
  type Brief,
  type TaskContract,
} from '@kernloop/contracts';
import {
  PANEL_DEFAULT,
  PANEL_RATIFICATION,
  REVIEW_PANEL_DEFAULT,
  runReviewGate,
  runVoteGate,
  type QualityCheck,
} from '@kernloop/faculty-gates';
import { decomposePlan, type SubtaskSpec } from '@kernloop/faculty-workforce';
import type { DiscoveredCache } from '@kernloop/faculty-models';
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
import { ballotInvoker, briefText, reviewerInvoker } from './seams.js';
import {
  coderPrompt,
  decomposePrompt,
  planPrompt,
  researcherPrompt,
  writtenDiff,
} from './prompts.js';
import { childSignal, sumChildCosts } from './aggregate.js';
import type { TieredNode } from './node-model.js';
import { identityRef, servedRef, type NodeSeam } from './node-seam.js';

/** Cross-node values the composition root carries between executors —
 * primed from the latest checkpoint on resume so no node re-executes. */
export interface LoopRefs {
  framedTask?: TaskContract;
  researchBrief?: Brief;
  planBrief?: Brief;
  /** Files each child's implement step wrote, keyed by child id — the diff
   * the advisory review gate reads. Not checkpointed: on a resume that lands
   * after implement but before review, the stash is empty and review abstains
   * honestly (it is advisory, so the run is unaffected). */
  writtenByChild?: Record<string, ReadonlyArray<{ path: string; content: string }>>;
}

/** What the executor set is bound to for one run. */
export interface LoopBindings {
  readonly kern: Kernloop;
  /** Workspace the children implement into and quality judges. */
  readonly workspaceDir: string;
  /** The default model seam — already metered by the caller. Used where no
   * node requirement applies; the run adapter at its default. */
  readonly invoke: LoopInvoke;
  /**
   * Per-NODE model seam [CLM-0078]: each model-calling executor asks for its
   * own node, and the composition root returns a metered invoke pre-bound to
   * the model+effort that node's manifest/template requires (resolved through
   * the kernel translation seam) plus the {@link NodeSeam.served} provenance.
   * The node DERIVES its requirement from its single source — there is no
   * parallel tier map (see loop/node-model.ts). When an explicit `invoke` is
   * injected (tests), every node resolves to that same seam.
   */
  readonly invokeFor: (node: TieredNode) => NodeSeam;
  /** Adapter name, recorded as provenance on generated Brief sections. */
  readonly adapter: string;
  /** Quality-check override (tests); real defaults otherwise. */
  readonly checks?: readonly QualityCheck[];
  readonly refs: LoopRefs;
  /** Discovered model cache [CLM-0087] — `identityRef` consults it so a synced model normalizes by table. */
  readonly discovered: DiscoveredCache;
}

/**
 * Write the coder's emitted files into the workspace. Two-layer escape guard,
 * checked before the first write so nothing lands on a partial failure:
 *  1. lexical — the resolved path must stay strictly inside `workspaceDir`
 *     (rejects `..` and absolute paths);
 *  2. symlink — after creating each parent directory we `realpathSync` it and
 *     re-check containment, because `path.resolve` does not follow symlinks.
 *     A model-chosen path through a pre-existing symlink in the workspace
 *     would otherwise escape it. The real workspace root is itself realpath'd
 *     so a workspace that is legitimately under a symlink still works.
 */
export function writeWorkspaceFiles(
  workspaceDir: string,
  files: ReadonlyArray<{ path: string; content: string }>,
): string[] {
  mkdirSync(path.resolve(workspaceDir), { recursive: true });
  const root = realpathSync(path.resolve(workspaceDir));
  const resolved = files.map((file) => {
    const target = path.resolve(root, file.path);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new LoopParseError('files', `path escapes the workspace: ${file.path}`);
    }
    return { target, dir: path.dirname(target), content: file.content };
  });
  for (const file of resolved) {
    mkdirSync(file.dir, { recursive: true });
    const realDir = realpathSync(file.dir);
    if (realDir !== root && !realDir.startsWith(root + path.sep)) {
      throw new LoopParseError(
        'files',
        `path resolves outside the workspace via a symlink: ${path.relative(root, file.target)}`,
      );
    }
  }
  for (const file of resolved) {
    writeFileSync(file.target, file.content, 'utf8');
  }
  return resolved.map((file) => path.relative(root, file.target));
}

/** A violation sink under this run's overlay, labelled with the node. */
function sinkFor(b: LoopBindings, runId: string, node: string): ViolationSink {
  return { overlayDir: b.kern.paths.dir, runId, node };
}

/** The plan node: PM template over the research Brief → a plan-Brief. */
function planExecutor(b: LoopBindings): NodeExecutor {
  return async (input, ctx) => {
    const research = BriefSchema.parse(input);
    b.refs.researchBrief = research;
    const seam = b.invokeFor('plan');
    const { output } = await seam.invoke(planPrompt(research, ctx.findings));
    const used = estimateTokens(output);
    const plan = BriefSchema.parse({
      taskId: ctx.taskId,
      sections: [
        {
          name: 'plan',
          content: output,
          tokens: used,
          priority: 1,
          provenance: [
            { ref: `adapter:${b.adapter}` },
            { ref: 'template:pm' },
            { ref: servedRef(seam.served) },
            { ref: identityRef(seam.served, b.discovered) },
          ],
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
        invoke: b.invokeFor('vote').invoke,
      }),
    });
    await publishVerdict(b.kern, verdict);
    return verdict;
  };
}

/**
 * The review child node (spec §6 "implement → quality gate → review gate").
 * ADVISORY: an adversarial reviewer panel judges the diff this child wrote;
 * its Verdict is published (audited) but never blocks integration. If the
 * diff stash is empty (a resume that landed after implement), the gate
 * abstains honestly rather than reviewing nothing.
 */
function reviewExecutor(b: LoopBindings): NodeExecutor {
  return async (_input, ctx) => {
    const childId = ctx.child?.id ?? ctx.taskId;
    const files = b.refs.writtenByChild?.[childId] ?? [];
    if (files.length === 0) {
      const verdict = VerdictSchema.parse({
        taskId: childId,
        gate: 'review',
        result: 'abstain',
        confidence: 0,
        findings: [],
        cost: { tokens: 0, usd: 0, wallClockMs: 0 },
      });
      await publishVerdict(b.kern, verdict);
      return verdict;
    }
    const verdict = await runReviewGate({
      taskId: childId,
      diff: writtenDiff(files),
      panel: REVIEW_PANEL_DEFAULT,
      invokeReviewer: reviewerInvoker({
        overlayDir: b.kern.paths.dir,
        runId: ctx.runId,
        invoke: b.invokeFor('review').invoke,
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
    const { output } = await b
      .invokeFor('decompose')
      .invoke(decomposePrompt(parent, briefText(plan)));
    const sink = sinkFor(b, ctx.runId, 'decompose');
    const emission = parseEmission(output, SubtasksEmissionSchema, 'subtasks', sink);
    return decomposePlan({ parent, subtasks: emission.subtasks as SubtaskSpec[] });
  };
}

/** The implement child node: coder via invoke → files written for real.
 * On a re-iteration `ctx.findings` carries THIS child's accumulated gate
 * findings (the engine scopes findings to the child inside the fan-out); they
 * fold into the coder prompt so the re-run fixes every failed check [CLM-0043]. */
function implementExecutor(b: LoopBindings): NodeExecutor {
  return async (input, ctx) => {
    const child = TaskContractSchema.parse(input);
    const seam = b.invokeFor('implement');
    const { output, cost } = await seam.invoke(coderPrompt(child, ctx.findings));
    const sink = sinkFor(b, ctx.runId, `implement-${child.id}`);
    const emission = parseEmission(output, FilesEmissionSchema, 'files', sink);
    const written = writeWorkspaceFiles(b.workspaceDir, emission.files);
    // Stash what this child wrote so the advisory review gate can diff it.
    (b.refs.writtenByChild ??= {})[child.id] = emission.files;
    const notes = emission.notes === '' ? '' : ` — ${emission.notes}`;
    return OutcomeSchema.parse({
      taskId: child.id,
      status: 'success',
      signals: [
        {
          name: 'implement',
          passed: true,
          // Provenance names the model+effort that truly served (degradation
          // recorded) AND the normalized model class behind the served alias
          // [CLM-0081], so the trace never implies more than ran [CLM-0078].
          detail: `[${servedRef(seam.served)} ${identityRef(seam.served, b.discovered)}] wrote ${String(written.length)} file(s): ${written.join(', ')}${notes}`,
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
 * The research node (spec §6 Research / §5.8 Researcher template). Compiles
 * the deterministic context Brief, then invokes the Researcher template
 * through the model seam and folds its findings in as a provenance-tagged
 * `research` section. If the Researcher returns nothing, the mechanical Brief
 * stands on its own (additive, never fail-closed).
 */
function researchExecutor(b: LoopBindings): NodeExecutor {
  return async (input) => {
    const task = TaskContractSchema.parse(input);
    const base = await assembleBrief(b.kern, task);
    const seam = b.invokeFor('research');
    const { output } = await seam.invoke(researcherPrompt(task, base));
    const findings = output.trim();
    if (findings.length === 0) return base;
    return BriefSchema.parse({
      ...base,
      sections: [
        ...base.sections,
        {
          name: 'research',
          content: findings,
          tokens: estimateTokens(findings),
          priority: 2,
          provenance: [
            { ref: `adapter:${b.adapter}` },
            { ref: 'template:researcher' },
            { ref: servedRef(seam.served) },
            { ref: identityRef(seam.served, b.discovered) },
          ],
        },
      ],
    });
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
    research: researchExecutor(b),
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
    review: reviewExecutor(b),
    integrate: integrateExecutor(),
    retrospect: retrospectExecutor(b),
  };
}
