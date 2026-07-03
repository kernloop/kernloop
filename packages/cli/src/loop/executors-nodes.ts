/**
 * The child fan-out node executors (spec §6 decompose → implement → integrate),
 * split out of executors.ts for line-count headroom (#58). Pure relocation:
 * each builder takes the same {@link LoopBindings} and produces the identical
 * NodeExecutor it did when defined inline. `sinkFor` and `writeWorkspaceFiles`
 * are imported from their home in executors.ts so there is one definition.
 */
import { OutcomeSchema, TaskContractSchema, type Cost } from '@kernloop/contracts';
import { appendEvent } from '@kernloop/kernel';
import { decomposePlan, type SubtaskSpec } from '@kernloop/faculty-workforce';
import type { ChildResult, NodeExecutor } from '@kernloop/workflows';
import {
  FilesEmissionSchema,
  LoopParseError,
  SubtasksEmissionSchema,
  parseEmission,
  type ViolationSink,
} from './invoke.js';
import { briefText } from './seams.js';
import { coderPrompt, decomposePrompt } from './prompts.js';
import { childSignal, reviewConcernSignals, sumChildCosts } from './aggregate.js';
import { identityRef, servedIdentity, servedRef, type NodeSeam } from './node-seam.js';
import { sinkFor, writeWorkspaceFiles, type LoopBindings, type LoopRefs } from './executors.js';

/**
 * Invoke the coder and parse its files emission, RETRYING ONCE on a contract
 * parse failure (#130) [CLM-0107]. An AGENTIC coder CLI (e.g. headless `claude`)
 * intermittently wraps the contract JSON in reasoning prose, so a second roll
 * usually emits clean output; both attempts' costs accumulate. Only a
 * {@link LoopParseError} is retried — a real failure (e.g. a path escaping the
 * workspace) propagates. If the retry also violates the contract the error
 * propagates: the node fails HONESTLY, never fabricating files. The prompt is
 * identical both times (the gate findings already folded in drive the re-run).
 */
async function coderEmissionWithRetry(seam: NodeSeam, prompt: string, sink: ViolationSink) {
  let tokens = 0;
  let usd = 0;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { output, cost } = await seam.invoke(prompt);
    tokens += cost.tokens;
    usd += cost.usd;
    try {
      const emission = parseEmission(output, FilesEmissionSchema, 'files', sink);
      return { emission, cost: { tokens, usd } satisfies Cost };
    } catch (err) {
      if (!(err instanceof LoopParseError)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

/** The decompose node: PM via invoke, then the MECHANICAL budget invariant. */
export function decomposeExecutor(b: LoopBindings): NodeExecutor {
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

/**
 * Resolve the child quality gate's written-files scope (#534/#541, CLM-0189).
 * A PRESENT stash entry — the union of the child's writes THIS PROCESS — scopes
 * the in-process doc-comment + security checks. An ABSENT entry (the stash is
 * not checkpointed, so a resume lands here) FAILS CLOSED to the whole-workspace
 * scans AND marks the child in {@link LoopRefs.scopeTaintedChildren}: once
 * tainted, the gate stays whole-workspace for the REST of the run, so a fresh
 * PARTIAL stash from a post-resume re-iteration cannot re-narrow the scope past
 * pre-crash writes. The taint set is process-local like the stash — a later
 * resume re-taints via the same absent-stash path. Durable path checkpointing
 * is tracked as #543. Returns undefined for a non-child (run-level) gate.
 */
export function childGateScope(
  refs: LoopRefs,
  childId: string | undefined,
): ReadonlyArray<{ path: string; content: string }> | undefined {
  if (childId === undefined) return undefined;
  const tainted = (refs.scopeTaintedChildren ??= new Set<string>());
  const stashed = refs.writtenByChild?.[childId];
  if (stashed === undefined) tainted.add(childId);
  return tainted.has(childId) ? undefined : stashed;
}

/** Merge one implement emission into the child's written-files stash (#534,
 * CLM-0189): the stash is the UNION by path of the child's emissions across
 * its iterations — a re-iteration that re-emits only SOME files must not
 * narrow the enforcing doc-comment scope past an earlier undocumented write —
 * with the LAST content winning for a re-emitted path. Stored paths are the
 * NORMALIZED workspace-relative ones `writeWorkspaceFiles` returned (one per
 * emitted file, in order), never the raw emitted paths: an absolute-but-inside
 * emitted path must still match the scan's relative walk keys. Any count
 * mismatch is a wiring bug and throws — never a silent raw-path fallback. */
function stashWrittenFiles(
  refs: LoopBindings['refs'],
  childId: string,
  files: ReadonlyArray<{ path: string; content: string }>,
  written: readonly string[],
): void {
  if (written.length !== files.length) {
    throw new Error(
      `writeWorkspaceFiles returned ${String(written.length)} paths for ${String(files.length)} emitted files`,
    );
  }
  const stash = (refs.writtenByChild ??= {});
  const merged = new Map((stash[childId] ?? []).map((f) => [f.path, f.content]));
  files.forEach((file, i) => {
    const rel = written[i];
    if (rel === undefined) throw new Error(`writeWorkspaceFiles returned no path for ${file.path}`);
    merged.set(rel, file.content);
  });
  stash[childId] = [...merged].map(([p, content]) => ({ path: p, content }));
}

/** The implement child node: coder via invoke → files written for real.
 * On a re-iteration `ctx.findings` carries THIS child's accumulated gate
 * findings (the engine scopes findings to the child inside the fan-out); they
 * fold into the coder prompt so the re-run fixes every failed check [CLM-0043]. */
export function implementExecutor(b: LoopBindings): NodeExecutor {
  return async (input, ctx) => {
    const child = TaskContractSchema.parse(input);
    const seam = b.invokeFor('implement');
    const sink = sinkFor(b, ctx.runId, `implement-${child.id}`);
    const { emission, cost } = await coderEmissionWithRetry(
      seam,
      coderPrompt(child, ctx.findings),
      sink,
    );
    const written = writeWorkspaceFiles(b.workspaceDir, emission.files);
    // Stash what this child wrote — the advisory review gate diffs it and the
    // quality gate's doc-comment check scopes to it (#534, CLM-0189): the UNION
    // across this child's iterations, normalized relative paths (see
    // {@link stashWrittenFiles}).
    stashWrittenFiles(b.refs, child.id, emission.files, written);
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
      // The normalized model class that produced this deliverable (#229/#5), so the
      // observer can attribute DELIVERABLE-pass (not just call-success) to a model.
      served: servedIdentity(seam.served, b.discovered),
    });
  };
}

/**
 * Outcome-level identity fitness (#229/#5): attribute one child's DELIVERABLE
 * pass/fail to the model class that produced it (the `served` identity on the
 * implement Outcome — the final, i.e. passing, coder attempt). Feeds the
 * outcome-level series the adapter selector reads. No `served` ⇒ unattributable,
 * skipped (an errored child or a pre-#229 resume).
 */
function recordChildOutcomeFitness(b: LoopBindings, result: ChildResult, passed: boolean): void {
  const parsed = OutcomeSchema.safeParse(result.output);
  if (!parsed.success || parsed.data.served === undefined) return;
  b.kern.observer.ingestOutcomeFitness(parsed.data.served, passed, parsed.data.cost);
}

/** The integrate node: success only if every child implemented AND passed quality. */
export function integrateExecutor(b: LoopBindings): NodeExecutor {
  return (input, ctx) => {
    const results = input as readonly ChildResult[];
    const signals = results.map((result) => childSignal(result));
    results.forEach((result, i) =>
      recordChildOutcomeFitness(b, result, signals[i]?.passed === true),
    );
    // Status is decided by the BLOCKING child signals ONLY. Advisory review rejects
    // are then appended as non-blocking `needs-review` signals (#226 item 5) — they
    // flag residual doubt at the terminal WITHOUT flipping an otherwise-`success` run.
    const succeeded = signals.length > 0 && signals.every((signal) => signal.passed);
    return Promise.resolve(
      OutcomeSchema.parse({
        taskId: ctx.taskId,
        status: succeeded ? 'success' : 'failure',
        signals: [...signals, ...reviewConcernSignals(results)],
        cost: sumChildCosts(results),
        traceRef: `loop:${ctx.runId}`,
        distillCandidates: [],
      }),
    );
  };
}

/**
 * Wrap a node executor so it appends node-lifecycle + spend audit events. EVERY
 * node brackets its execution with `loop.node.start`/`loop.node.finish`
 * (#336 P3, CLM-0149) — a uniform progress heartbeat (now planning / now
 * reviewing) the verbose progress stream renders; these are kept OUT of the
 * default `watch`/progress SIGNIFICANT set so an un-opted transcript is not
 * spammed. WHENEVER the node ACTUALLY spent (delta > 0) it ALSO appends one
 * `loop.spend` (#230·P5, CLM-0137): the per-node DELTA + the CUMULATIVE run
 * total. `finish` and `spend` are appended in a `finally`, so a node that runs
 * then THROWS still records its boundary + spend-to-failure before the error
 * propagates. A zero-spend node appends no `loop.spend` (the #230 condition: the
 * financial chain carries no heartbeat noise — node lifecycle is that heartbeat
 * now). The events carry only already-known facts (taskId, runId, node, childId)
 * — no fabricated ordinal. Both ids are present so a consumer filtering by the
 * caller-known taskId catches the whole run even though the loop's internal
 * runId differs (#343): the progress stream/replay filters by task.id.
 * Observe-tier: it records, it never acts.
 */
export function withSpendAudit(b: LoopBindings, exec: NodeExecutor): NodeExecutor {
  return async (input, ctx) => {
    const nodeRef = {
      taskId: ctx.taskId,
      runId: ctx.runId,
      node: ctx.node,
      ...(ctx.child === undefined ? {} : { childId: ctx.child.id }),
    };
    appendEvent(b.kern.store, { type: 'loop.node.start', payload: nodeRef });
    const beforeTokens = b.totals.tokens;
    const beforeUsd = b.totals.usd;
    try {
      return await exec(input, ctx);
    } finally {
      const nodeTokens = b.totals.tokens - beforeTokens;
      const nodeUsd = b.totals.usd - beforeUsd;
      if (nodeTokens > 0 || nodeUsd > 0) {
        appendEvent(b.kern.store, {
          type: 'loop.spend',
          payload: {
            ...nodeRef,
            nodeTokens,
            nodeUsd,
            cumulativeTokens: b.totals.tokens,
            cumulativeUsd: b.totals.usd,
          },
        });
      }
      appendEvent(b.kern.store, { type: 'loop.node.finish', payload: nodeRef });
    }
  };
}
