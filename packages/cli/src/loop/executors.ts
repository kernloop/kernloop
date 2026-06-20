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
import { mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { SymlinkWriteError, writeFileNoFollow } from './safe-write.js';
import {
  BriefSchema,
  OutcomeSchema,
  TaskContractSchema,
  VerdictSchema,
  type Brief,
  type TaskContract,
  type Verdict,
} from '@kernloop/contracts';
import {
  REVIEW_PANEL_DEFAULT,
  REVIEWER_GROUNDEDNESS,
  runReviewGate,
  type QualityCheck,
} from '@kernloop/faculty-gates';
import type { DiscoveredCache } from '@kernloop/faculty-models';
import { estimateTokens } from '@kernloop/faculty-compiler';
import type { NodeExecutor } from '@kernloop/workflows';
import type { Kernloop } from '../kernel.js';
import { assembleBrief } from '../gather.js';
import { executeQualityGate, publishVerdict } from '../executors.js';
import { attributeSkillFitness } from './skill-attribution.js';
import { LoopParseError, type ViolationSink } from './invoke.js';
import { reviewerInvoker } from './seams.js';
import { type VoteDiversity } from './vote-diversity.js';
import { labelVoterOutcomes, voteExecutor } from './vote-executor.js';
import { planPrompt, researcherPrompt, writtenDiff } from './prompts.js';
import type { TieredNode } from './node-model.js';
import { identityRef, servedRef, type NodeSeam } from './node-seam.js';
import {
  decomposeExecutor,
  implementExecutor,
  integrateExecutor,
  withSpendAudit,
} from './executors-nodes.js';

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
  /** The proceeding plan-vote Verdict (#369 Inc3a) — its VoterRecords are labeled
   * at retrospect against the run's eventual success. Not checkpointed: a resume
   * landing after the vote simply skips labeling (advisory, run unaffected). */
  planVoteVerdict?: Verdict;
}

/** What the executor set is bound to for one run. */
export interface LoopBindings {
  readonly kern: Kernloop;
  /** Workspace the children implement into and quality judges. */
  readonly workspaceDir: string;
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
  /**
   * The run's live metered-spend accumulator (the same object `meteredInvoke`
   * mutates). `withSpendAudit` snapshots it around each node to emit a
   * `loop.spend` audit event when that node spent (#230, CLM-0137).
   */
  readonly totals: { tokens: number; usd: number };
  /** Provider-DIVERSE vote panel support (#369): a panel-7 ratification vote
   * round-robins its voters across these adapters so the panel is not one model
   * role-playing N personas. Absent on the injected path (panel-7 stays single). */
  readonly voteDiversity?: VoteDiversity;
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
    // The dir realpath above cannot catch a symlink AT the leaf; O_NOFOLLOW
    // refuses to write through one (#161). A model that named a symlinked path
    // violated the files contract → surface it as one (retryable).
    try {
      writeFileNoFollow(file.target, file.content);
    } catch (error) {
      if (error instanceof SymlinkWriteError) {
        throw new LoopParseError(
          'files',
          `path resolves outside the workspace via a symlink: ${path.relative(root, file.target)}`,
        );
      }
      throw error;
    }
  }
  return resolved.map((file) => path.relative(root, file.target));
}

/** A violation sink under this run's overlay, labelled with the node. */
export function sinkFor(b: LoopBindings, runId: string, node: string): ViolationSink {
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

/**
 * The review child node (spec §6 "implement → quality gate → review gate").
 * ADVISORY: an adversarial reviewer panel judges the diff this child wrote;
 * its Verdict is published (audited) but never blocks integration. If the
 * diff stash is empty (a resume that landed after implement), the gate
 * abstains honestly rather than reviewing nothing.
 */
/**
 * The review CONTEXT shared with every reviewer (#226 item 3): the child's GOAL
 * and its acceptance criteria, so the groundedness reviewer can judge whether the
 * diff actually achieves them. Undefined when there is no child task (the
 * groundedness lens is then not convened). NOTE: this string is sent to the model
 * provider in the review prompt — never inline a secret in a definitionOfDone
 * `command` (it would be transmitted here, as it already is to the gate subprocess).
 */
function reviewContext(child: TaskContract | undefined): string | undefined {
  if (child === undefined) return undefined;
  const criteria = child.definitionOfDone.map((c) => `- ${c.name}: ${c.command}`).join('\n');
  return [
    '## Goal',
    child.goal,
    ...(criteria === '' ? [] : ['## Acceptance criteria', criteria]),
  ].join('\n');
}

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
    // Goal-fidelity review (#226 item 3) is an OPT-IN, UNPROVEN model-judge: under
    // `gates.review.groundedness` (default off) thread the goal + criteria into the
    // context and convene the groundedness lens; off ⇒ byte-identical to before (no
    // goal, defect lenses only). Convened only when a goal/context actually exists.
    const context = b.kern.config.gates.review.groundedness ? reviewContext(ctx.child) : undefined;
    const panel =
      context === undefined
        ? REVIEW_PANEL_DEFAULT
        : [...REVIEW_PANEL_DEFAULT, REVIEWER_GROUNDEDNESS];
    const verdict = await runReviewGate({
      taskId: childId,
      diff: writtenDiff(files),
      panel,
      ...(context === undefined ? {} : { context }),
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
    // Attribute the outcome to the skills whose body reached the brief (#228 P3·2).
    attributeSkillFitness(b, ctx.runId, final);
    labelVoterOutcomes(b, final);
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
 *
 * Every node is wrapped in {@link withSpendAudit} so a spending node emits an
 * in-flight `loop.spend` audit event (#230, CLM-0137) — uniform, one wrap point.
 */
export function buildLoopExecutors(b: LoopBindings): Record<string, NodeExecutor> {
  const executors: Record<string, NodeExecutor> = {
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
        // The child's OWN definition-of-done runs alongside the base checks (#226).
        ...(ctx.child === undefined ? {} : { definitionOfDone: ctx.child.definitionOfDone }),
        // The files this child wrote, so diff-coverage flags an untested module (#226
        // item 2) — only under the opt-in flag (default off; a new gate behavior).
        ...(ctx.child !== undefined && b.kern.config.gates.quality.diffCoverage
          ? { writtenFiles: b.refs.writtenByChild?.[ctx.child.id] ?? [] }
          : {}),
        ...(b.checks === undefined ? {} : { checks: b.checks }),
        envAllow: b.kern.config.gates.quality.envAllow, // least-privilege check env (#235)
        sandbox: b.kern.config.gates.quality.sandbox, // Docker isolation policy (#236)
        ...(b.kern.config.gates.quality.timeoutMsPerCheck === undefined
          ? {}
          : { timeoutMsPerCheck: b.kern.config.gates.quality.timeoutMsPerCheck }),
      }),
    review: reviewExecutor(b),
    integrate: integrateExecutor(b),
    retrospect: retrospectExecutor(b),
  };
  return Object.fromEntries(
    Object.entries(executors).map(([node, exec]) => [node, withSpendAudit(b, exec)]),
  );
}
