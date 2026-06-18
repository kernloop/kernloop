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
import { identityRef, servedRef, type NodeSeam } from './node-seam.js';
import { sinkFor, writeWorkspaceFiles, type LoopBindings } from './executors.js';

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
export function integrateExecutor(): NodeExecutor {
  return (input, ctx) => {
    const results = input as readonly ChildResult[];
    const signals = results.map((result) => childSignal(result));
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
 * Wrap a node executor so it appends ONE `loop.spend` audit event whenever the
 * node ACTUALLY spent (delta > 0) — the in-flight cost/progress signal `watch`
 * renders (#230·P5, CLM-0137). The event carries the per-node DELTA and the
 * CUMULATIVE run total; it is appended in a `finally`, so a node that spends
 * then THROWS still records spend-to-failure before the error propagates. A
 * zero-spend node appends NOTHING — the #230 vote's load-bearing condition: the
 * financial audit chain is not polluted with heartbeat noise (watch already
 * renders per-node progress from the other loop.* events). Observe-tier: it
 * records, it never acts. Spend is read as a snapshot delta (after − before),
 * correct for the loop's sequential node execution.
 */
export function withSpendAudit(b: LoopBindings, exec: NodeExecutor): NodeExecutor {
  return async (input, ctx) => {
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
            runId: ctx.runId,
            node: ctx.node,
            ...(ctx.child === undefined ? {} : { childId: ctx.child.id }),
            nodeTokens,
            nodeUsd,
            cumulativeTokens: b.totals.tokens,
            cumulativeUsd: b.totals.usd,
          },
        });
      }
    }
  };
}
